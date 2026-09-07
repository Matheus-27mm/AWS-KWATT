"""Lambda de notificação: recebe eventos 'Alerta' do EventBridge e envia por SNS e WhatsApp."""

from __future__ import annotations

import logging
from typing import Any

from ..adapters.notify import SnsNotifier, WhatsAppNotifier, format_alert
from ..config import get_settings
from ..domain.models import Alert

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict, context: Any) -> dict:
    alert = Alert.model_validate(event.get("detail", {}))
    settings = get_settings()
    text = format_alert(alert)
    log.info(text)
    sent: list[str] = []
    if settings.sns_topic_arn:
        SnsNotifier(settings.sns_topic_arn).send(alert)
        sent.append("sns")
    if settings.whatsapp_token and settings.whatsapp_phone_id and settings.whatsapp_to:
        WhatsAppNotifier(
            settings.whatsapp_token, settings.whatsapp_phone_id, settings.whatsapp_template, settings.whatsapp_to
        ).send(alert)
        sent.append("whatsapp")
    return {"alert_id": alert.id, "sent": sent}
