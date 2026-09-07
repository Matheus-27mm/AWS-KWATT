"""Publicador MQTT 5 confiável para o AWS IoT Core, usado pelo gateway de campo e pelo simulador.

Duas lições do primeiro dia em produção que este módulo encapsula:

1. Publicar antes do CONNACK: o IoT Core responde PUBACK com "Unspecified error" e descarta a
   mensagem, mas a biblioteca marca `is_published()` como verdadeiro. Aqui só publicamos depois do
   CONNACK e só consideramos entregue o PUBACK com código de sucesso.
2. Centenas de mensagens em voo derrubam a conexão (limite de 100 publicações/s) e o cliente entra
   em espiral de reenvio ao reconectar. Aqui cada publicação espera o seu PUBACK.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

import paho.mqtt.client as mqtt

log = logging.getLogger("energia.mqtt")


@dataclass
class PublishStats:
    sent: int = 0
    delivered: int = 0
    retried: int = 0
    failed: int = 0
    disconnects: list[str] = field(default_factory=list)


class ReliablePublisher:
    def __init__(
        self,
        host: str,
        client_id: str,
        port: int = 8883,
        ca: str | None = None,
        cert: str | None = None,
        key: str | None = None,
        keepalive: int = 60,
    ) -> None:
        self.stats = PublishStats()
        self._connected = threading.Event()
        self._acks: dict[int, str] = {}
        self._ack_cv = threading.Condition()
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=mqtt.MQTTv5)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_publish = self._on_publish
        if cert:
            self._client.tls_set(ca_certs=ca, certfile=cert, keyfile=key)
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._host, self._port, self._keepalive = host, port, keepalive

    # --- callbacks -------------------------------------------------------
    def _on_connect(self, client, userdata, flags, rc, props=None) -> None:
        if str(rc) == "Success":
            self._connected.set()
        else:
            log.error("CONNACK recusado: %s", rc)

    def _on_disconnect(self, client, userdata, flags, rc, props=None) -> None:
        self._connected.clear()
        reason = getattr(props, "ReasonString", None) if props else None
        text = f"{time.strftime('%H:%M:%S')} {rc} {reason or ''}".strip()
        self.stats.disconnects.append(text)
        if str(rc) != "Normal disconnection":
            log.warning("desconectado pelo broker: %s", text)

    def _on_publish(self, client, userdata, mid, rc=None, props=None) -> None:
        with self._ack_cv:
            self._acks[mid] = str(rc) if rc is not None else "Success"
            self._ack_cv.notify_all()

    # --- API ---------------------------------------------------------------
    def connect(self, timeout: float = 15.0) -> None:
        self._client.connect_async(self._host, self._port, keepalive=self._keepalive)
        self._client.loop_start()
        if not self._connected.wait(timeout):
            raise TimeoutError(f"sem CONNACK de {self._host} em {timeout:.0f}s")

    def close(self) -> None:
        self._client.disconnect()
        self._client.loop_stop()

    @property
    def connected(self) -> bool:
        return self._connected.is_set()

    def publish(self, topic: str, payload: str, timeout: float = 15.0, retries: int = 2) -> bool:
        """Publica com QoS 1 e devolve True só com PUBACK de sucesso. Reenvia até `retries` vezes."""
        self.stats.sent += 1
        for attempt in range(retries + 1):
            if not self._connected.wait(timeout):
                continue
            info = self._client.publish(topic, payload, qos=1)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                time.sleep(0.2 * (attempt + 1))
                continue
            deadline = time.monotonic() + timeout
            with self._ack_cv:
                while info.mid not in self._acks and time.monotonic() < deadline:
                    self._ack_cv.wait(deadline - time.monotonic())
                reason = self._acks.pop(info.mid, None)
            if reason == "Success":
                self.stats.delivered += 1
                if attempt:
                    self.stats.retried += 1
                return True
            log.warning("PUBACK %s para %s (tentativa %d)", reason or "ausente", topic, attempt + 1)
            time.sleep(0.2 * (attempt + 1))
        self.stats.failed += 1
        return False
