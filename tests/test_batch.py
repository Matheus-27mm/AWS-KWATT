"""Aplicar um lote por medidor tem de dar o mesmo resultado que uma leitura por vez, gastando uma gravação."""

from __future__ import annotations

import random
from datetime import timedelta

import pytest

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.domain.models import Reading
from energia.services.processor import process_batch, process_batch_with_retry, process_reading
from tests.conftest import utc

START = utc(2026, 9, 4, 12, 0)


def _readings(n: int, meter_id: str = "linha-1") -> list[Reading]:
    return [
        Reading(
            tenant_id="acme",
            site_id="fabrica",
            meter_id=meter_id,
            ts=START + timedelta(seconds=10 * i),
            kw=80 + (i % 7) * 5,
            kvar=20.0,
            pf=0.9,
        )
        for i in range(n)
    ]


def test_lote_equivale_a_uma_leitura_por_vez(tenant, meter):
    readings = _readings(102)  # 17 min: fecha a janela das 12:00
    clock = readings[-1].ts

    one_by_one = MemoryRepository()
    for r in readings:
        process_reading(r, meter, tenant, one_by_one, MemorySink(), now=clock)

    batched = MemoryRepository()
    sink = MemorySink()
    shuffled = readings[:]
    random.Random(3).shuffle(shuffled)  # a ordem dentro do lote também não importa
    batch = process_batch(shuffled, meter, tenant, batched, sink, now=clock)

    assert batch.accepted == 102 and not batch.conflict
    # relógio parado: a carência não correu, ninguém fechou janela ainda, e os estados são idênticos
    assert batch.closed_windows == [] and one_by_one.windows[meter.key.pk] == []
    assert batched.get_state(meter.key).model_dump(exclude={"version"}) == one_by_one.get_state(meter.key).model_dump(
        exclude={"version"}
    )
    assert batched.get_state(meter.key).version == 1  # uma gravação para o lote inteiro
    assert one_by_one.get_state(meter.key).version == 102

    # 61 s depois, uma leitura fecha a janela das 12:00 nos dois, com o mesmo resultado
    extra = Reading(tenant_id="acme", site_id="fabrica", meter_id="linha-1", ts=START + timedelta(minutes=17), kw=80)
    later = clock + timedelta(seconds=61)
    process_reading(extra, meter, tenant, one_by_one, MemorySink(), now=later)
    batch = process_batch([extra], meter, tenant, batched, sink, now=later)
    assert len(batch.closed_windows) == 1
    assert [w.model_dump() for w in batched.windows[meter.key.pk]] == [
        w.model_dump() for w in one_by_one.windows[meter.key.pk]
    ]
    assert batched.windows[meter.key.pk][0].samples == 90
    assert {t for t, _ in sink.events} == {"JanelaDemanda", "Alerta"}


def test_lote_so_de_duplicatas_nao_grava(tenant, meter):
    readings = _readings(12)
    repo, sink = MemoryRepository(), MemorySink()
    process_batch(readings, meter, tenant, repo, sink, now=readings[-1].ts)
    version = repo.get_state(meter.key).version
    again = process_batch(readings, meter, tenant, repo, sink, now=readings[-1].ts)
    assert again.accepted == 0
    assert {reason for _, reason in again.outcomes} == {"duplicada"}
    assert repo.get_state(meter.key).version == version


def test_lote_com_conflito_transitorio_reaplica_inteiro(tenant, meter, monkeypatch):
    readings = _readings(30)
    repo, sink = MemoryRepository(), MemorySink()
    original = repo.save_state
    calls = {"n": 0}

    def flaky(state, expected_version):
        calls["n"] += 1
        return False if calls["n"] == 1 else original(state, expected_version)

    monkeypatch.setattr(repo, "save_state", flaky)
    monkeypatch.setattr("energia.services.processor.time.sleep", lambda s: None)
    batch = process_batch_with_retry(readings, meter, tenant, repo, sink, now=readings[-1].ts)
    assert not batch.conflict
    assert batch.accepted == 30
    assert calls["n"] == 2
    assert len(repo.get_state(meter.key).open[0].samples) == 30


def test_lote_com_conflito_persistente_devolve_tudo(tenant, meter, monkeypatch):
    readings = _readings(5)
    repo, sink = MemoryRepository(), MemorySink()
    monkeypatch.setattr(repo, "save_state", lambda state, expected_version: False)
    monkeypatch.setattr("energia.services.processor.time.sleep", lambda s: None)
    batch = process_batch_with_retry(readings, meter, tenant, repo, sink, attempts=3, now=readings[-1].ts)
    assert batch.conflict
    assert batch.outcomes == [(False, "conflito_de_versao")] * 5
    assert repo.get_state(meter.key) is None
    assert sink.events == []


def test_lote_vazio(tenant, meter):
    batch = process_batch([], meter, tenant, MemoryRepository(), MemorySink())
    assert batch.outcomes == [] and not batch.conflict


@pytest.mark.parametrize("block", [6, 18])
def test_rajada_em_lotes_fora_de_ordem_da_as_mesmas_janelas(tenant, meter, block):
    readings = _readings(720)  # 2 h
    ordered = MemoryRepository()
    for r in readings:
        process_reading(r, meter, tenant, ordered, MemorySink(), now=r.ts)

    blocks = [readings[i : i + block] for i in range(0, len(readings), block)]
    random.Random(5).shuffle(blocks)
    repo, sink = MemoryRepository(), MemorySink()
    wall = utc(2026, 9, 7, 19, 0)
    for b in blocks:
        assert not process_batch(b, meter, tenant, repo, sink, now=wall).conflict
    # a carência corre no relógio: 61 s depois, qualquer leitura nova fecha tudo o que tem "algo depois"
    process_batch(
        [Reading(tenant_id="acme", site_id="fabrica", meter_id="linha-1", ts=START + timedelta(hours=2), kw=80)],
        meter,
        tenant,
        repo,
        sink,
        now=wall + timedelta(seconds=61),
    )
    got = {w.start: w for w in repo.windows[meter.key.pk]}
    want = {w.start: w for w in ordered.windows[meter.key.pk]}
    assert set(want) <= set(got)
    for start, w in want.items():
        assert got[start].samples == w.samples == 90
        assert got[start].kwh == pytest.approx(w.kwh, abs=1e-9)
