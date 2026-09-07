"""Canais de notificação: SNS (e-mail) e WhatsApp via Meta Cloud API (template aprovado)."""

from __future__ import annotations

from typing import Any

import boto3
import httpx

from ..domain.models import Alert, Severity

_SEVERITY_LABEL = {Severity.INFO: "Info", Severity.WARNING: "Atenção", Severity.CRITICAL: "Crítico"}


def format_alert(alert: Alert) -> str:
    when = alert.ts.strftime("%d/%m %H:%M UTC")
    return f"[{_SEVERITY_LABEL[alert.severity]}] {alert.site_id}/{alert.meter_id} {when}: {alert.message}"


class SnsNotifier:
    def __init__(self, topic_arn: str, client: Any | None = None) -> None:
        self._topic = topic_arn
        self._client = client or boto3.client("sns")

    def send(self, alert: Alert) -> None:
        self._client.publish(
            TopicArn=self._topic,
            Subject=f"Energia: {alert.kind.value} em {alert.site_id}/{alert.meter_id}"[:100],
            Message=format_alert(alert),
        )


class WhatsAppNotifier:
    """Envia um template com um parâmetro de texto. O template precisa estar aprovado na Meta."""

    def __init__(self, token: str, phone_id: str, template: str, to: str, timeout: float = 10.0) -> None:
        self._url = f"https://graph.facebook.com/v20.0/{phone_id}/messages"
        self._headers = {"Authorization": f"Bearer {token}"}
        self._template = template
        self._to = to
        self._timeout = timeout

    def send(self, alert: Alert) -> None:
        body = {
            "messaging_product": "whatsapp",
            "to": self._to,
            "type": "template",
            "template": {
                "name": self._template,
                "language": {"code": "pt_BR"},
                "components": [{"type": "body", "parameters": [{"type": "text", "text": format_alert(alert)}]}],
            },
        }
        resp = httpx.post(self._url, headers=self._headers, json=body, timeout=self._timeout)
        resp.raise_for_status()
