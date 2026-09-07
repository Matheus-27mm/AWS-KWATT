"""Ida e volta pelo DynamoDB (moto): o repositório real, sem AWS."""

from __future__ import annotations

import json
from datetime import timedelta

import boto3
import pytest
from moto import mock_aws

from energia.adapters.dynamodb import DynamoRepository
from energia.adapters.memory import MemorySink
from energia.domain.models import Reading
from energia.services.processor import process_reading
from tests.conftest import utc

START = utc(2026, 9, 4, 12, 0)


@pytest.fixture
def dynamo_repo():
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="sa-east-1")
        resource.create_table(
            TableName="energia-test",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield DynamoRepository("energia-test", resource=resource), resource.Table("energia-test")


def test_estado_janela_mes_e_alerta_fazem_ida_e_volta(dynamo_repo, tenant, meter):
    repo, table = dynamo_repo
    repo.put_tenant(tenant)
    repo.put_meter(meter)
    sink = MemorySink()
    ts = START
    for _ in range(102):  # 17 min a 120 kW: fecha a janela das 12:00 com ultrapassagem e projeção
        r = Reading(tenant_id="acme", site_id="fabrica", meter_id="linha-1", ts=ts, kw=120.0, kvar=36.0, pf=0.95)
        assert process_reading(r, meter, tenant, repo, sink, now=ts).accepted
        ts += timedelta(seconds=10)

    state = repo.get_state(meter.key)
    assert state is not None
    assert state.version == 102
    assert [w.start for w in state.open] == [START + timedelta(minutes=15)]
    assert len(state.open[0].samples) == 12
    assert state.anchor is not None and state.anchor.o == -10

    windows = repo.list_windows(meter.key, START.date())
    assert len(windows) == 1
    assert windows[0].demand_kw == pytest.approx(120.0, abs=0.01)
    assert windows[0].samples == 90

    rollup = repo.get_month(meter.key, "2026-09")
    assert rollup is not None and rollup.exceeded_windows == 1

    alerts = repo.list_alerts("acme")
    assert {a.kind.value for a in alerts} == {"ultrapassagem_demanda", "projecao_demanda"}

    outbox = [item for item in table.scan()["Items"] if item.get("type") == "OutboxEvent"]
    assert {item["detail_type"] for item in outbox} == {"JanelaDemanda", "Alerta"}
    assert sink.events == []  # produção publica exclusivamente pela outbox transacional

    # o item bruto guarda amostras compactas, e cabe folgado no limite de 400 KB do DynamoDB
    raw = table.get_item(Key={"PK": meter.key.pk, "SK": "STATE"})["Item"]
    assert isinstance(raw["open"][0]["samples"][0], list)
    assert len(json.dumps(raw, default=str)) < 4000

    assert repo.get_tenant("acme").name == tenant.name
    assert repo.list_meters("acme")[0].meter_id == "linha-1"


def test_escrita_condicional_detecta_conflito(dynamo_repo, tenant, meter):
    repo, _ = dynamo_repo
    r = Reading(tenant_id="acme", site_id="fabrica", meter_id="linha-1", ts=START, kw=10.0)
    assert process_reading(r, meter, tenant, repo, MemorySink(), now=START).accepted
    stale = repo.get_state(meter.key)
    stale.version = 0  # finge que outro consumidor gravou depois da nossa leitura
    assert repo.save_state(stale, expected_version=0) is False
