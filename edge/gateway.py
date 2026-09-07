"""Gateway de campo: lê medidores Modbus TCP e publica leituras no AWS IoT Core por MQTT.

Roda num mini-PC industrial ou Raspberry Pi dentro da fábrica. Um processo, um arquivo de
configuração (edge/config.yaml), certificados X.509 emitidos por scripts/provision_device.py.

  pip install "energia-industrial[edge]"
  python edge/gateway.py --config edge/config.yaml

Se a conexão cair, as leituras ficam numa fila em disco (SQLite) e são reenviadas depois, em ordem.
O processador na nuvem descarta duplicatas, então reenviar é sempre seguro.
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import struct
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger("gateway")


# --- decodificação de registradores ------------------------------------------


def decode(regs: list[int], kind: str, scale: float = 1.0, word_order: str = "big") -> float:
    """Converte registradores Modbus (16 bits) num número.

    kind: u16 | s16 | u32 | s32 | f32
    word_order: 'big' (palavra alta primeiro) ou 'little' (alguns medidores invertem)
    """
    if kind in ("u16", "s16"):
        raw = regs[0]
        if kind == "s16" and raw >= 0x8000:
            raw -= 0x10000
        return raw * scale
    hi, lo = (regs[0], regs[1]) if word_order == "big" else (regs[1], regs[0])
    packed = struct.pack(">HH", hi, lo)
    if kind == "u32":
        return struct.unpack(">I", packed)[0] * scale
    if kind == "s32":
        return struct.unpack(">i", packed)[0] * scale
    if kind == "f32":
        return struct.unpack(">f", packed)[0] * scale
    raise ValueError(f"tipo desconhecido: {kind}")


class ModbusMeter:
    def __init__(self, cfg: dict[str, Any]) -> None:
        from pymodbus.client import ModbusTcpClient

        self.cfg = cfg
        self.meter_id: str = cfg["meter_id"]
        self.unit: int = int(cfg.get("unit", 1))
        self.client = ModbusTcpClient(cfg["host"], port=int(cfg.get("port", 502)), timeout=3)
        self.registers: dict[str, dict[str, Any]] = cfg["registers"]
        self.word_order: str = cfg.get("word_order", "big")

    def read(self) -> dict[str, float | None]:
        if not self.client.connected and not self.client.connect():
            raise ConnectionError(f"sem conexão Modbus com {self.cfg['host']}")
        out: dict[str, float | None] = {}
        for field, spec in self.registers.items():
            count = 1 if spec["type"] in ("u16", "s16") else 2
            fn = self.client.read_input_registers if spec.get("input", False) else self.client.read_holding_registers
            rr = fn(int(spec["address"]), count=count, slave=self.unit)
            if rr.isError():
                out[field] = None
                continue
            out[field] = decode(rr.registers, spec["type"], float(spec.get("scale", 1.0)), self.word_order)
        return out


# --- fila em disco --------------------------------------------------------------


class DiskQueue:
    def __init__(self, path: Path) -> None:
        self.conn = sqlite3.connect(path)
        self.conn.execute("CREATE TABLE IF NOT EXISTS q (id INTEGER PRIMARY KEY, topic TEXT, payload TEXT)")
        self.conn.commit()

    def push(self, topic: str, payload: str) -> None:
        self.conn.execute("INSERT INTO q (topic, payload) VALUES (?, ?)", (topic, payload))
        self.conn.commit()

    def drain(self, publish) -> int:
        rows = self.conn.execute("SELECT id, topic, payload FROM q ORDER BY id LIMIT 500").fetchall()
        sent = 0
        for row_id, topic, payload in rows:
            if not publish(topic, payload):
                break
            self.conn.execute("DELETE FROM q WHERE id = ?", (row_id,))
            sent += 1
        self.conn.commit()
        return sent

    def size(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM q").fetchone()[0]


# --- MQTT -----------------------------------------------------------------------


class Publisher:
    """Publicador MQTT 5 que só considera entregue o PUBACK de sucesso (ver energia/mqtt_client.py)."""

    def __init__(self, cfg: dict[str, Any]) -> None:
        from energia.mqtt_client import ReliablePublisher

        self._pub = ReliablePublisher(
            cfg["host"],
            cfg["client_id"],
            port=int(cfg.get("port", 8883 if cfg.get("cert") else 1883)),
            ca=cfg.get("ca"),
            cert=cfg.get("cert"),
            key=cfg.get("key"),
        )
        try:
            self._pub.connect(timeout=20)
        except TimeoutError as exc:
            log.warning("%s; as leituras ficam na fila em disco até conectar", exc)

    def publish(self, topic: str, payload: str) -> bool:
        if not self._pub.connected:
            return False
        return self._pub.publish(topic, payload, timeout=10, retries=1)


# --- laço principal ---------------------------------------------------------------


def run(config_path: Path) -> None:
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    tenant_id, site_id = cfg["tenant_id"], cfg["site_id"]
    interval = int(cfg.get("interval_s", 10))
    prefix = cfg.get("topic_prefix", "energia")
    meters = [ModbusMeter(m) for m in cfg["meters"]]
    queue = DiskQueue(Path(cfg.get("queue_path", "edge/queue.sqlite")))
    publisher = Publisher(cfg["mqtt"])
    seq = 0
    log.info("gateway iniciado: %d medidores, intervalo %ds, fila pendente %d", len(meters), interval, queue.size())

    while True:
        tick = time.monotonic()
        ts = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        for meter in meters:
            try:
                values = meter.read()
            except Exception as exc:  # registrar e seguir para o próximo medidor
                log.warning("falha ao ler %s: %s", meter.meter_id, exc)
                continue
            if values.get("kw") is None:
                log.warning("%s sem leitura de kW, amostra descartada", meter.meter_id)
                continue
            payload = {
                "tenant_id": tenant_id,
                "site_id": site_id,
                "meter_id": meter.meter_id,
                "ts": ts,
                "seq": seq,
                **{k: v for k, v in values.items() if v is not None},
            }
            topic = f"{prefix}/{tenant_id}/{site_id}/{meter.meter_id}"
            queue.push(topic, json.dumps(payload))
        sent = queue.drain(publisher.publish)
        pending = queue.size()
        if pending:
            log.warning("enviadas %d, pendentes na fila %d", sent, pending)
        seq += 1
        time.sleep(max(0.0, interval - (time.monotonic() - tick)))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Gateway Modbus -> MQTT")
    ap.add_argument("--config", type=Path, default=Path("edge/config.yaml"))
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    run(args.config)


if __name__ == "__main__":
    main()
