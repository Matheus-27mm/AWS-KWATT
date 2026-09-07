from datetime import timedelta

import pytest
from pydantic import ValidationError

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.domain.models import Alert, AlertKind, MeterConfig, Reading, Severity, TariffModality, TenantConfig
from energia.services.processor import process_reading, sweep_stale_meter
from tests.conftest import utc


def test_alerta_tem_id_deterministico():
    key = MeterConfig(
        tenant_id="acme", site_id="fabrica", meter_id="linha-1", name="Linha", contracted_kw=100
    ).key
    args = (key, utc(2026, 9, 7, 12), AlertKind.PROJECAO, Severity.WARNING, "mensagem")
    assert Alert.for_meter(*args, projected_kw=110).id == Alert.for_meter(*args, projected_kw=110).id


def test_configuracao_rejeita_contrato_incompleto_e_fuso_invalido():
    with pytest.raises(ValidationError):
        MeterConfig(tenant_id="acme", site_id="s", meter_id="m", name="M", modality=TariffModality.AZUL)
    with pytest.raises(ValidationError):
        TenantConfig(tenant_id="acme", name="ACME", tz="Marte/Olympus")


def test_commit_em_memoria_nao_deixa_efeitos_quando_versao_conflita(monkeypatch):
    tenant = TenantConfig(tenant_id="acme", name="ACME")
    meter = MeterConfig(tenant_id="acme", site_id="s", meter_id="m", name="M", contracted_kw=10)
    repo, sink = MemoryRepository(), MemorySink()
    first = Reading(tenant_id="acme", site_id="s", meter_id="m", ts=utc(2026, 9, 7, 12), kw=20)
    assert process_reading(first, meter, tenant, repo, sink, now=first.ts).accepted
    before = repo.get_state(meter.key).model_dump()
    monkeypatch.setattr(repo, "save_state", lambda state, expected_version: False)
    later = first.model_copy(update={"ts": first.ts + timedelta(minutes=20)})
    result = process_reading(later, meter, tenant, repo, sink, now=later.ts + timedelta(minutes=2))
    assert not result.accepted
    assert repo.get_state(meter.key).model_dump() == before
    assert repo.windows[meter.key.pk] == []


def test_sweeper_alerta_uma_vez_e_fecha_so_depois_de_duas_horas():
    tenant = TenantConfig(tenant_id="acme", name="ACME")
    meter = MeterConfig(tenant_id="acme", site_id="s", meter_id="m", name="M", contracted_kw=100)
    repo, sink = MemoryRepository(), MemorySink()
    ts = utc(2026, 9, 7, 12)
    reading = Reading(tenant_id="acme", site_id="s", meter_id="m", ts=ts, kw=50)
    process_reading(reading, meter, tenant, repo, sink, now=ts)

    first = sweep_stale_meter(repo.get_state(meter.key), meter, tenant, repo, sink, now=ts + timedelta(minutes=3))
    assert [a.kind for a in first.alerts] == [AlertKind.MEDIDOR_OFFLINE]
    assert repo.windows[meter.key.pk] == []

    again = sweep_stale_meter(repo.get_state(meter.key), meter, tenant, repo, sink, now=ts + timedelta(minutes=10))
    assert again.alerts == []

    final = sweep_stale_meter(
        repo.get_state(meter.key), meter, tenant, repo, sink, now=ts + timedelta(hours=2, minutes=1)
    )
    assert len(final.closed_windows) == 1
    assert final.closed_windows[0].samples == 1


def test_nova_leitura_rearma_alerta_offline():
    tenant = TenantConfig(tenant_id="acme", name="ACME")
    meter = MeterConfig(tenant_id="acme", site_id="s", meter_id="m", name="M", contracted_kw=100)
    repo, sink = MemoryRepository(), MemorySink()
    ts = utc(2026, 9, 7, 12)
    first = Reading(tenant_id="acme", site_id="s", meter_id="m", ts=ts, kw=50)
    process_reading(first, meter, tenant, repo, sink, now=ts)
    sweep_stale_meter(repo.get_state(meter.key), meter, tenant, repo, sink, now=ts + timedelta(minutes=3))

    resumed = first.model_copy(update={"ts": ts + timedelta(minutes=4)})
    process_reading(resumed, meter, tenant, repo, sink, now=resumed.ts)
    assert repo.get_state(meter.key).offline_alerted_at is None
