"""Simulador de medidores industriais. É o gerador de carga do projeto.

Perfil de uma fábrica de três turnos: carga cheia das 06h às 14h, 85% das 14h às 22h, 40% à noite,
30% no fim de semana. Fator de potência cai por volta do meio-dia (motores em vazio no almoço),
o que dispara o alerta de excedente reativo. Um dos medidores tem um pico na ponta para provocar
ultrapassagem de demanda.

Modos:
  print  imprime JSON por linha (debug)
  http   envia lotes para o endpoint /tenants/{t}/ingest da API
  mqtt   publica em energia/{tenant}/{site}/{meter}, com TLS e certificado quando informados

Exemplos:
  python -m simulator.simulate --mode print --hours 1 --interval 60
  python -m simulator.simulate --mode http --http-url http://127.0.0.1:8000 --api-key ek_...
  python -m simulator.simulate --mode mqtt --mqtt-host xxxx-ats.iot.sa-east-1.amazonaws.com \
      --ca edge/certs/AmazonRootCA1.pem --cert edge/certs/gw-01/cert.pem --key edge/certs/gw-01/private.key \
      --speed 1
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from energia.domain.models import Reading


@dataclass
class MeterProfile:
    tenant_id: str
    site_id: str
    meter_id: str
    base_kw: float
    peak_kw: float
    pf_base: float = 0.94
    pf_dip: float = 0.86
    noise: float = 0.04
    ponta_spike: float = 0.0  # fração extra de carga entre 18h e 21h locais
    seed: int = 1


def default_profiles(tenant_id: str = "demo", site_id: str = "fabrica", n: int = 3) -> list[MeterProfile]:
    catalog = [
        MeterProfile(tenant_id, site_id, "injetoras", base_kw=20, peak_kw=110, ponta_spike=0.25, seed=11),
        MeterProfile(tenant_id, site_id, "compressores", base_kw=15, peak_kw=60, pf_dip=0.80, seed=22),
        MeterProfile(tenant_id, site_id, "climatizacao", base_kw=10, peak_kw=45, seed=33),
        MeterProfile(tenant_id, site_id, "extrusoras", base_kw=25, peak_kw=90, seed=44),
    ]
    return catalog[:n]


def load_factor(local: datetime) -> float:
    if local.weekday() >= 5:
        return 0.30
    h = local.hour + local.minute / 60
    if 6 <= h < 14:
        return 1.0
    if 14 <= h < 22:
        return 0.85
    return 0.40


def pf_for(local: datetime, p: MeterProfile, rng: random.Random) -> float:
    pf = p.pf_dip if 12 <= local.hour < 13 else p.pf_base
    return max(0.5, min(1.0, pf + rng.gauss(0, 0.01)))


def generate(
    profiles: list[MeterProfile],
    start: datetime,
    end: datetime,
    interval_s: int = 10,
    speed: float = 0.0,
    tz: str = "America/Manaus",
) -> Iterator[Reading]:
    """Gera leituras em ordem cronológica. speed=0 é o mais rápido possível; speed=1 é tempo real."""
    rngs = {p.meter_id: random.Random(p.seed) for p in profiles}
    zone = ZoneInfo(tz)
    ts = start
    seq = 0
    while ts < end:
        local = ts.astimezone(zone)
        factor = load_factor(local)
        for p in profiles:
            rng = rngs[p.meter_id]
            kw = p.base_kw + (p.peak_kw - p.base_kw) * factor
            if p.ponta_spike and local.weekday() < 5 and 18 <= local.hour < 21:
                kw *= 1.0 + p.ponta_spike
            kw = max(0.0, kw * (1.0 + rng.gauss(0, p.noise)))
            pf = pf_for(local, p, rng)
            kvar = kw * math.tan(math.acos(pf))
            yield Reading(
                tenant_id=p.tenant_id,
                site_id=p.site_id,
                meter_id=p.meter_id,
                ts=ts,
                kw=round(kw, 3),
                kvar=round(kvar, 3),
                pf=round(pf, 4),
                v=round(380 + rng.gauss(0, 2), 1),
                a=round(kw * 1000 / (math.sqrt(3) * 380 * pf), 2) if pf else None,
                hz=60.0,
                seq=seq,
            )
        seq += 1
        ts += timedelta(seconds=interval_s)
        if speed > 0:
            time.sleep(interval_s / speed)


def _publish_mqtt(args: argparse.Namespace, readings: Iterator[Reading]) -> None:
    """Publica como um gateway real: espera o CONNACK, uma mensagem por vez, PUBACK de sucesso ou reenvio.

    A espera pelo PUBACK limita a taxa a uma mensagem por ida e volta (~10/s até São Paulo). Foi
    deliberado: ver energia/mqtt_client.py para as duas lições que motivaram isso.
    """
    from energia.mqtt_client import ReliablePublisher

    pub = ReliablePublisher(
        args.mqtt_host, args.client_id, port=args.mqtt_port, ca=args.ca, cert=args.cert, key=args.key
    )
    pub.connect()
    min_interval = 1.0 / args.max_rate if args.max_rate > 0 else 0.0
    t0 = time.monotonic()
    try:
        for r in readings:
            topic = f"{args.topic_prefix}/{r.tenant_id}/{r.site_id}/{r.meter_id}"
            pub.publish(topic, r.model_dump_json())
            if min_interval:
                time.sleep(min_interval)
            if pub.stats.sent % 500 == 0:
                s = pub.stats
                print(f"enviadas {s.sent}, entregues {s.delivered}, {time.monotonic() - t0:.0f}s", file=sys.stderr)
    finally:
        pub.close()
    s = pub.stats
    print(
        f"total enviado: {s.sent}; entregues (PUBACK de sucesso): {s.delivered}; reenviadas: {s.retried}; "
        f"falhas: {s.failed}; {time.monotonic() - t0:.0f}s; desconexões: {len(s.disconnects)}",
        file=sys.stderr,
    )
    if s.failed:
        sys.exit(2)


def _post_http(args: argparse.Namespace, readings: Iterator[Reading]) -> None:
    import httpx

    batch: list[dict] = []
    tenant = None
    totals = {"accepted": 0, "rejected": 0, "closed_windows": 0, "alerts": 0}

    def flush() -> None:
        nonlocal batch
        if not batch:
            return
        resp = httpx.post(
            f"{args.http_url}/tenants/{tenant}/ingest",
            json=batch,
            headers={"X-API-Key": args.api_key},
            timeout=60,
        )
        resp.raise_for_status()
        out = resp.json()
        for k in ("accepted", "rejected", "closed_windows"):
            totals[k] += out[k]
        totals["alerts"] += len(out["alerts"])
        batch = []

    for r in readings:
        tenant = r.tenant_id
        batch.append(json.loads(r.model_dump_json()))
        if len(batch) >= 500:
            flush()
    flush()
    print(json.dumps(totals), file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["print", "http", "mqtt"], default="print")
    ap.add_argument("--tenant", default="demo")
    ap.add_argument("--site", default="fabrica")
    ap.add_argument("--meters", type=int, default=3)
    ap.add_argument("--interval", type=int, default=10, help="segundos entre amostras")
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--start", help="início em UTC, ISO 8601; padrão = agora menos --hours")
    ap.add_argument("--speed", type=float, default=0.0, help="0 = sem espera; 1 = tempo real; 60 = 60x")
    ap.add_argument("--http-url", default="http://127.0.0.1:8000")
    ap.add_argument("--api-key")
    ap.add_argument("--mqtt-host", default="127.0.0.1")
    ap.add_argument("--mqtt-port", type=int, default=1883)
    ap.add_argument("--topic-prefix", default="energia")
    ap.add_argument("--client-id", default="simulador-01")
    ap.add_argument(
        "--max-rate", type=float, default=0.0, help="teto extra de mensagens/s no modo mqtt; 0 = só o PUBACK"
    )
    ap.add_argument("--ca")
    ap.add_argument("--cert")
    ap.add_argument("--key")
    args = ap.parse_args(argv)

    end_default = datetime.now(UTC).replace(microsecond=0)
    start = datetime.fromisoformat(args.start) if args.start else end_default - timedelta(hours=args.hours)
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    end = start + timedelta(hours=args.hours)
    profiles = default_profiles(args.tenant, args.site, args.meters)
    readings = generate(profiles, start, end, args.interval, args.speed)

    if args.mode == "print":
        for r in readings:
            print(r.model_dump_json())
    elif args.mode == "http":
        if not args.api_key:
            ap.error("--api-key é obrigatório no modo http")
        _post_http(args, readings)
    else:
        if args.cert and args.mqtt_port == 1883:
            args.mqtt_port = 8883
        _publish_mqtt(args, readings)


if __name__ == "__main__":
    main()
