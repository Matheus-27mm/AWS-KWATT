"""Varredor agendado: alerta medidor silencioso e finaliza janelas após o limite de atraso."""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

from ..adapters.dynamodb import DynamoRepository
from ..adapters.eventbridge import EventBridgeSink
from ..services.processor import OFFLINE_AFTER, sweep_stale_meter

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict, context: Any) -> dict:
    now = datetime.now(UTC)
    repo = DynamoRepository(os.environ["ENERGIA_TABLE_NAME"])
    sink = EventBridgeSink(os.environ["ENERGIA_EVENT_BUS"])
    states = repo.list_states_ingested_before(now - OFFLINE_AFTER)
    changed = conflicts = 0
    for state in states:
        tenant = repo.get_tenant(state.key.tenant_id)
        meter = repo.get_meter(state.key)
        if tenant is None or meter is None:
            log.warning("estado órfão ignorado: %s", state.key)
            continue
        result = sweep_stale_meter(state, meter, tenant, repo, sink, now=now)
        if result.reason == "conflito_de_versao":
            conflicts += 1
        elif result.alerts or result.closed_windows:
            changed += 1
    log.info("sweeper: candidatos=%d alterados=%d conflitos=%d", len(states), changed, conflicts)
    return {"candidates": len(states), "changed": changed, "conflicts": conflicts}
