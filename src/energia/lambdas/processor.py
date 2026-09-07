"""Lambda consumidora da fila de leituras (IoT Core -> SQS -> aqui).

Cada registro SQS carrega o JSON publicado pelo gateway no tópico MQTT. O lote é agrupado por
medidor e cada grupo é aplicado com uma leitura e uma gravação de estado (process_batch). Devolvemos
falhas parciais por item, então uma leitura envenenada não trava o lote: leitura inválida ou de
medidor não cadastrado é descartada com log; um grupo que não conseguiu gravar depois das
tentativas volta para a fila e, depois de 5 vezes, cai na DLQ.

O mesmo lote alimenta a camada bruta do lake: toda leitura que passou na validação vai para o S3
em JSON Lines, particionada por cliente, unidade e dia. É o que o Athena consulta.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from functools import partial
from typing import Any

from pydantic import ValidationError

from ..adapters.dynamodb import DynamoRepository
from ..adapters.eventbridge import EventBridgeSink
from ..adapters.lake import S3Lake
from ..domain.models import Reading
from ..services.processor import process_batch_with_retry

log = logging.getLogger()
log.setLevel(logging.INFO)

CACHE_TTL_S = 300
_repo: DynamoRepository | None = None
_sink: EventBridgeSink | None = None
_lake: S3Lake | None = None
_cache: dict[tuple[str, str], tuple[float, Any]] = {}


def _deps() -> tuple[DynamoRepository, EventBridgeSink, S3Lake | None]:
    global _repo, _sink, _lake
    if _repo is None:
        _repo = DynamoRepository(os.environ["ENERGIA_TABLE_NAME"])
        _sink = EventBridgeSink(os.environ["ENERGIA_EVENT_BUS"])
        bucket = os.environ.get("ENERGIA_LAKE_BUCKET")
        _lake = S3Lake(bucket) if bucket else None
    assert _sink is not None
    return _repo, _sink, _lake


def _cached(kind: str, ident: str, loader: Callable[[], Any]) -> Any:
    now = time.monotonic()
    hit = _cache.get((kind, ident))
    if hit and hit[0] > now:
        return hit[1]
    value = loader()
    _cache[(kind, ident)] = (now + CACHE_TTL_S, value)
    return value


def handler(event: dict, context: Any) -> dict:
    repo, sink, lake = _deps()
    now = datetime.now(UTC)
    failures: list[dict[str, str]] = []
    groups: dict[str, list[tuple[str, Reading]]] = defaultdict(list)
    accepted = rejected = late = 0

    for record in event.get("Records", []):
        message_id = record["messageId"]
        try:
            reading = Reading.model_validate(json.loads(record["body"]))
        except (ValueError, ValidationError) as exc:
            log.warning("leitura inválida descartada (%s): %s", message_id, exc)
            rejected += 1
            continue
        groups[reading.key.pk].append((message_id, reading))

    valid = [reading for items in groups.values() for _, reading in items]

    # O lake é a fonte bruta e precisa existir antes de confirmar qualquer mensagem. A chave do
    # objeto é determinística, portanto uma reentrega idêntica apenas sobrescreve o mesmo objeto.
    lake_keys: list[str] = []
    if lake is not None and valid:
        try:
            lake_keys = lake.write_batch(valid)
        except Exception:
            log.exception("falha ao gravar lote no lake; nenhuma leitura será confirmada")
            return {
                "batchItemFailures": [
                    {"itemIdentifier": message_id} for items in groups.values() for message_id, _ in items
                ]
            }

    for pk, items in groups.items():
        first = items[0][1]
        try:
            tenant = _cached("tenant", first.tenant_id, partial(repo.get_tenant, first.tenant_id))
            meter = _cached("meter", pk, partial(repo.get_meter, first.key))
            if tenant is None or meter is None:
                log.warning("medidor não cadastrado, %d leitura(s) descartada(s): %s", len(items), first.key)
                rejected += len(items)
                continue
            items.sort(key=lambda item: item[1].ts)
            batch = process_batch_with_retry([r for _, r in items], meter, tenant, repo, sink, now=now)
            if batch.conflict:
                log.warning("conflito persistente em %s: %d leitura(s) voltam para a fila", first.key, len(items))
                failures.extend({"itemIdentifier": mid} for mid, _ in items)
                continue
            accepted += batch.accepted
            late += batch.late
            rejected += len(items) - batch.accepted
        except Exception:
            log.exception("falha ao processar grupo %s", pk)
            failures.extend({"itemIdentifier": mid} for mid, _ in items)

    log.info(
        "lote: aceitas=%d (atrasadas=%d) rejeitadas=%d reentregar=%d lake=%d arquivo(s) grupos=%d",
        accepted,
        late,
        rejected,
        len(failures),
        len(lake_keys),
        len(groups),
    )
    return {"batchItemFailures": failures}
