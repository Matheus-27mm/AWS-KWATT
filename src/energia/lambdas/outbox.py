"""Publica a outbox transacional do DynamoDB no EventBridge."""

from __future__ import annotations

import logging
import os
from typing import Any

import boto3
from boto3.dynamodb.types import TypeDeserializer

from ..adapters.eventbridge import EventBridgeSink

log = logging.getLogger()
log.setLevel(logging.INFO)
_deserializer = TypeDeserializer()
_sink: EventBridgeSink | None = None
_dynamo: Any | None = None


def _deps() -> tuple[EventBridgeSink, Any]:
    global _sink, _dynamo
    if _sink is None:
        _sink = EventBridgeSink(os.environ["ENERGIA_EVENT_BUS"])
        _dynamo = boto3.client("dynamodb")
    return _sink, _dynamo


def handler(event: dict, context: Any) -> dict:
    sink, dynamo = _deps()
    failures: list[dict[str, str]] = []
    published = 0
    for record in event.get("Records", []):
        event_id = record["eventID"]
        if record.get("eventName") not in {"INSERT", "MODIFY"}:
            continue
        raw = record.get("dynamodb", {}).get("NewImage", {})
        item = {key: _deserializer.deserialize(value) for key, value in raw.items()}
        if item.get("type") != "OutboxEvent":
            continue
        try:
            sink.emit(item["detail_type"], item["detail"])
            dynamo.delete_item(
                TableName=os.environ["ENERGIA_TABLE_NAME"],
                Key={"PK": raw["PK"], "SK": raw["SK"]},
                ConditionExpression="#type = :outbox",
                ExpressionAttributeNames={"#type": "type"},
                ExpressionAttributeValues={":outbox": {"S": "OutboxEvent"}},
            )
            published += 1
        except Exception:
            log.exception("falha ao publicar outbox %s", item.get("event_id"))
            failures.append({"itemIdentifier": event_id})
    return {"batchItemFailures": failures, "published": published}
