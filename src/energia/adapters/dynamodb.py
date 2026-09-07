"""Repositório DynamoDB, tabela única.

Chaves:
  TENANT#{t}                 META                      TenantConfig
  TENANT#{t}                 SITE#{s}                  SiteConfig
  TENANT#{t}                 METER#{s}#{m}             MeterConfig
  TENANT#{t}                 ALERT#{ts}#{id}           Alert          (TTL 180 dias)
  METER#{t}#{s}#{m}          STATE                     MeterState     (escrita condicional por versão)
  METER#{t}#{s}#{m}          WINDOW#{inicio ISO}       DemandWindow   (TTL 90 dias; o lake guarda o histórico)
  METER#{t}#{s}#{m}          MONTH#{AAAA-MM}           MonthRollup
  OUTBOX#{event_id}          EVENT                     OutboxEvent    (publicação confiável no EventBridge)

Por que essas partições: o item de estado recebe uma escrita por grupo do medidor no lote.
Janelas são 96 por dia por medidor. Alertas ficam sob o tenant para a listagem do painel ser uma
única query. Estado, derivados e outbox são gravados numa transação.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from pydantic import BaseModel

from ..domain.models import (
    Alert,
    DemandWindow,
    MeterConfig,
    MeterKey,
    MeterState,
    MonthRollup,
    SiteConfig,
    TenantConfig,
)

WINDOW_TTL = timedelta(days=90)
ALERT_TTL = timedelta(days=180)


def _to_item(model: BaseModel) -> dict[str, Any]:
    return json.loads(json.dumps(model.model_dump(mode="json")), parse_float=Decimal)


def _clean(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _pack_sample(s: dict) -> list:
    return [s["o"], s["kw"], s.get("kvar", 0), s.get("pf")]


def _unpack_sample(v: list) -> dict:
    return {"o": v[0], "kw": v[1], "kvar": v[2], "pf": v[3]}


def _pack_state(item: dict) -> dict:
    """Amostras como listas [o, kw, kvar, pf] em vez de mapas com nome de campo.

    O item de estado é reescrito a cada grupo do medidor e o DynamoDB cobra por KB gravado; os nomes dos
    campos repetidos 90 vezes por janela custariam mais que os próprios números.
    """
    item = dict(item)
    if item.get("anchor"):
        item["anchor"] = _pack_sample(item["anchor"])
    item["open"] = [{**w, "samples": [_pack_sample(s) for s in w["samples"]]} for w in item.get("open", [])]
    return item


def _unpack_state(item: dict) -> dict:
    item = dict(item)
    if isinstance(item.get("anchor"), list):
        item["anchor"] = _unpack_sample(item["anchor"])
    item["open"] = [
        {**w, "samples": [_unpack_sample(s) if isinstance(s, list) else s for s in w["samples"]]}
        for w in item.get("open", [])
    ]
    return item


class DynamoRepository:
    events_are_durable = True

    def __init__(self, table_name: str, resource: Any | None = None) -> None:
        self._table = (resource or boto3.resource("dynamodb")).Table(table_name)
        # Cliente low-level sem os transformadores do resource; TransactWriteItems exige AttributeValue.
        self._client = boto3.client("dynamodb", region_name=self._table.meta.client.meta.region_name)
        self._table_name = table_name
        self._serializer = TypeSerializer()

    # --- helpers -------------------------------------------------------
    def _get(self, pk: str, sk: str) -> dict | None:
        item = self._table.get_item(Key={"PK": pk, "SK": sk}).get("Item")
        return _clean(item) if item else None

    def _put(self, pk: str, sk: str, model: BaseModel, ttl_at: int | None = None) -> None:
        item = {"PK": pk, "SK": sk, "type": type(model).__name__, **_to_item(model)}
        if ttl_at is not None:
            item["ttl"] = ttl_at
        self._table.put_item(Item=item)

    def _query_prefix(self, pk: str, prefix: str, limit: int | None = None, newest_first: bool = False) -> list[dict]:
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with(prefix),
            "ScanIndexForward": not newest_first,
        }
        if limit:
            kwargs["Limit"] = limit
        return [_clean(i) for i in self._table.query(**kwargs).get("Items", [])]

    # --- cadastro ------------------------------------------------------
    def get_tenant(self, tenant_id: str) -> TenantConfig | None:
        item = self._get(f"TENANT#{tenant_id}", "META")
        return TenantConfig.model_validate(item) if item else None

    def put_tenant(self, tenant: TenantConfig) -> None:
        self._put(f"TENANT#{tenant.tenant_id}", "META", tenant)

    def put_site(self, site: SiteConfig) -> None:
        self._put(f"TENANT#{site.tenant_id}", f"SITE#{site.site_id}", site)

    def list_sites(self, tenant_id: str) -> list[SiteConfig]:
        return [SiteConfig.model_validate(i) for i in self._query_prefix(f"TENANT#{tenant_id}", "SITE#")]

    def get_meter(self, key: MeterKey) -> MeterConfig | None:
        item = self._get(f"TENANT#{key.tenant_id}", f"METER#{key.site_id}#{key.meter_id}")
        return MeterConfig.model_validate(item) if item else None

    def put_meter(self, meter: MeterConfig) -> None:
        self._put(f"TENANT#{meter.tenant_id}", f"METER#{meter.site_id}#{meter.meter_id}", meter)

    def list_meters(self, tenant_id: str) -> list[MeterConfig]:
        return [MeterConfig.model_validate(i) for i in self._query_prefix(f"TENANT#{tenant_id}", "METER#")]

    # --- operação ------------------------------------------------------
    def get_state(self, key: MeterKey) -> MeterState | None:
        item = self._get(key.pk, "STATE")
        return MeterState.model_validate(_unpack_state(item)) if item else None

    def list_states_ingested_before(self, cutoff) -> list[MeterState]:
        response = self._table.query(
            IndexName="states-by-ingestion",
            KeyConditionExpression=Key("GSI1PK").eq("STATE") & Key("GSI1SK").lte(cutoff.isoformat()),
        )
        items = response.get("Items", [])
        while response.get("LastEvaluatedKey"):
            response = self._table.query(
                IndexName="states-by-ingestion",
                KeyConditionExpression=Key("GSI1PK").eq("STATE") & Key("GSI1SK").lte(cutoff.isoformat()),
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))
        return [MeterState.model_validate(_unpack_state(_clean(item))) for item in items]

    def save_state(self, state: MeterState, expected_version: int) -> bool:
        item = {
            "PK": state.key.pk,
            "SK": "STATE",
            "type": "MeterState",
            "GSI1PK": "STATE",
            "GSI1SK": state.last_ingested_at.isoformat() if state.last_ingested_at else "1970-01-01T00:00:00+00:00",
            **_pack_state(_to_item(state)),
        }
        try:
            self._table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(PK) OR #v = :expected",
                ExpressionAttributeNames={"#v": "version"},
                ExpressionAttributeValues={":expected": expected_version},
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise
        return True

    def _serialized(self, item: dict[str, Any]) -> dict[str, Any]:
        return {key: self._serializer.serialize(value) for key, value in item.items()}

    def commit_processing(
        self,
        state: MeterState,
        expected_version: int,
        windows: list[DemandWindow],
        rollups: list[MonthRollup],
        alerts: list[Alert],
    ) -> bool:
        """Estado e efeitos derivados entram numa única TransactWriteItems.

        Os eventos são itens de outbox na mesma transação. O DynamoDB Stream os entrega à Lambda
        publicadora; assim, uma falha entre salvar estado e publicar EventBridge não perde eventos.
        """
        state_item = {
            "PK": state.key.pk,
            "SK": "STATE",
            "type": "MeterState",
            "GSI1PK": "STATE",
            "GSI1SK": state.last_ingested_at.isoformat() if state.last_ingested_at else "1970-01-01T00:00:00+00:00",
            **_pack_state(_to_item(state)),
        }
        actions: list[dict[str, Any]] = [
            {
                "Put": {
                    "TableName": self._table_name,
                    "Item": self._serialized(state_item),
                    "ConditionExpression": "attribute_not_exists(PK) OR #v = :expected",
                    "ExpressionAttributeNames": {"#v": "version"},
                    "ExpressionAttributeValues": {":expected": self._serializer.serialize(expected_version)},
                }
            }
        ]

        events: list[tuple[str, str, dict[str, Any]]] = []
        for window in windows:
            item = {
                "PK": window.key.pk,
                "SK": f"WINDOW#{window.start.isoformat()}",
                "type": "DemandWindow",
                **_to_item(window),
                "ttl": int((window.end + WINDOW_TTL).timestamp()),
            }
            actions.append({"Put": {"TableName": self._table_name, "Item": self._serialized(item)}})
            events.append(
                (
                    "JanelaDemanda",
                    f"window|{window.key.pk}|{window.start.isoformat()}",
                    window.model_dump(mode="json"),
                )
            )
        for rollup in rollups:
            item = {
                "PK": rollup.key.pk,
                "SK": f"MONTH#{rollup.month}",
                "type": "MonthRollup",
                **_to_item(rollup),
            }
            actions.append({"Put": {"TableName": self._table_name, "Item": self._serialized(item)}})
        for alert in alerts:
            item = {
                "PK": f"TENANT#{alert.tenant_id}",
                "SK": f"ALERT#{alert.ts.isoformat()}#{alert.id}",
                "type": "Alert",
                **_to_item(alert),
                "ttl": int((alert.ts + ALERT_TTL).timestamp()),
            }
            actions.append({"Put": {"TableName": self._table_name, "Item": self._serialized(item)}})
            events.append(("Alerta", f"alert|{alert.id}", alert.model_dump(mode="json")))
        for detail_type, event_id, detail in events:
            item = {
                "PK": f"OUTBOX#{event_id}",
                "SK": "EVENT",
                "type": "OutboxEvent",
                "event_id": event_id,
                "detail_type": detail_type,
                "detail": json.loads(json.dumps(detail), parse_float=Decimal),
            }
            actions.append({"Put": {"TableName": self._table_name, "Item": self._serialized(item)}})

        if len(actions) > 100:
            raise ValueError(f"transação de processamento excede 100 ações: {len(actions)}")
        try:
            self._client.transact_write_items(TransactItems=actions)
        except ClientError as exc:
            if exc.response["Error"]["Code"] in {"TransactionCanceledException", "ConditionalCheckFailedException"}:
                reasons = exc.response.get("CancellationReasons", [])
                if not reasons or any(reason.get("Code") == "ConditionalCheckFailed" for reason in reasons):
                    return False
            raise
        return True

    def save_window(self, window: DemandWindow) -> None:
        ttl_at = int((window.end + WINDOW_TTL).timestamp())
        self._put(window.key.pk, f"WINDOW#{window.start.isoformat()}", window, ttl_at=ttl_at)

    def list_windows(self, key: MeterKey, day: date) -> list[DemandWindow]:
        lo = f"WINDOW#{day.isoformat()}T00:00:00"
        hi = f"WINDOW#{day.isoformat()}T23:59:59+00:00"
        resp = self._table.query(KeyConditionExpression=Key("PK").eq(key.pk) & Key("SK").between(lo, hi))
        return [DemandWindow.model_validate(_clean(i)) for i in resp.get("Items", [])]

    def get_month(self, key: MeterKey, month: str) -> MonthRollup | None:
        item = self._get(key.pk, f"MONTH#{month}")
        return MonthRollup.model_validate(item) if item else None

    def save_month(self, rollup: MonthRollup) -> None:
        self._put(rollup.key.pk, f"MONTH#{rollup.month}", rollup)

    def save_alert(self, alert: Alert) -> None:
        ttl_at = int((alert.ts + ALERT_TTL).timestamp())
        self._put(f"TENANT#{alert.tenant_id}", f"ALERT#{alert.ts.isoformat()}#{alert.id}", alert, ttl_at=ttl_at)

    def list_alerts(self, tenant_id: str, limit: int = 50) -> list[Alert]:
        items = self._query_prefix(f"TENANT#{tenant_id}", "ALERT#", limit=limit, newest_first=True)
        return [Alert.model_validate(i) for i in items]
