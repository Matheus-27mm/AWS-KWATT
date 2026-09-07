import random
from datetime import timedelta

import pytest

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.domain.models import AlertKind, Reading, TariffPeriod
from energia.services.processor import process_reading, process_with_retry
from tests.conftest import utc

# 12:00 UTC de sexta = 08:00 em Manaus: fora ponta, dia útil
START = utc(2026, 9, 4, 12, 0)


def _windows(results):
    return [w for r in results for w in r.closed_windows]


def _alerts(results):
    return [a for r in results for a in r.alerts]


def _r(ts, kw=50.0, meter_id="linha-1", pf=None) -> Reading:
    return Reading(tenant_id="acme", site_id="fabrica", meter_id=meter_id, ts=ts, kw=kw, kvar=kw * 0.3, pf=pf)


def _process(reading, meter, tenant, repo, sink, now=None):
    """Relógio da nuvem = timestamp da leitura, salvo indicação contrária."""
    return process_reading(reading, meter, tenant, repo, sink, now=now or reading.ts)


def test_carga_constante_fecha_janelas_com_demanda_correta(feed, repo, sink, meter):
    results = feed(meter, START, minutes=35, kw=120.0, pf=0.95)
    assert all(r.accepted for r in results)

    windows = _windows(results)
    assert len(windows) == 2
    assert [w.start for w in windows] == [START, START + timedelta(minutes=15)]
    for w in windows:
        assert w.demand_kw == pytest.approx(120.0, abs=0.01)
        assert w.kwh == pytest.approx(30.0, abs=0.01)
        assert w.period == TariffPeriod.FORA_PONTA
        assert w.samples == 90
        assert w.exceeded is True

    alerts = _alerts(results)
    kinds = [a.kind for a in alerts]
    assert kinds.count(AlertKind.ULTRAPASSAGEM) == 2
    assert kinds.count(AlertKind.PROJECAO) == 2  # uma por janela, 5 min depois do início
    assert kinds.count(AlertKind.FATOR_POTENCIA) == 0

    rollup = repo.get_month(meter.key, "2026-09")
    assert rollup is not None
    assert rollup.windows == 2
    assert rollup.exceeded_windows == 2
    assert rollup.max_demand_kw["fora_ponta"] == pytest.approx(120.0, abs=0.01)
    assert rollup.kwh["fora_ponta"] == pytest.approx(60.0, abs=0.02)

    types = [t for t, _ in sink.events]
    assert types.count("JanelaDemanda") == 2
    assert types.count("Alerta") == 4


def test_janela_so_fecha_depois_da_carencia(feed, meter):
    # última amostra às 12:15:50 (relógio idem): a primeira leitura além das 12:15 chegou às 12:15:00,
    # então a janela das 12:00 só fecha quando o relógio passar de 12:16:00
    assert _windows(feed(meter, START, minutes=16, kw=90.0)) == []
    later = feed(meter, START + timedelta(minutes=16), minutes=1, kw=90.0)
    windows = _windows(later)
    assert len(windows) == 1
    assert windows[0].start == START
    assert windows[0].samples == 90


def test_dentro_do_contrato_nao_alerta(feed, meter):
    results = feed(meter, START, minutes=17, kw=90.0, pf=0.96)
    windows = _windows(results)
    assert len(windows) == 1
    assert windows[0].exceeded is False
    assert _alerts(results) == []


def test_tolerancia_de_cinco_por_cento(feed, meter):
    # 104 kW está dentro da tolerância de 5% sobre 100 kW; 106 não
    assert _windows(feed(meter, START, minutes=17, kw=104.0))[0].exceeded is False
    later = START + timedelta(hours=1)
    windows = {w.start: w for w in _windows(feed(meter, later, minutes=17, kw=106.0))}
    assert windows[later].exceeded is True


def test_duplicada_e_rejeitada_e_atrasada_entra_no_lugar_certo(feed, repo, sink, tenant, meter):
    feed(meter, START, minutes=1, kw=50.0)  # amostras em 0, 10, ..., 50 s

    dup = _r(START + timedelta(seconds=50))
    r = _process(dup, meter, tenant, repo, sink)
    assert (r.accepted, r.reason) == (False, "duplicada")

    late = _r(START + timedelta(seconds=5), kw=500)
    r = _process(late, meter, tenant, repo, sink)
    assert (r.accepted, r.reason) == (True, "atrasada")
    state = repo.get_state(meter.key)
    assert len(state.open) == 1
    assert len(state.open[0].samples) == 7
    assert state.last_ts == START + timedelta(seconds=50)  # o maior timestamp não muda

    again = _process(late, meter, tenant, repo, sink)
    assert (again.accepted, again.reason) == (False, "duplicada")


def test_leitura_de_janela_fechada_e_rejeitada(feed, repo, sink, tenant, meter):
    feed(meter, START, minutes=17, kw=50.0)  # fecha a janela das 12:00
    r = _process(_r(START + timedelta(minutes=7)), meter, tenant, repo, sink)
    assert (r.accepted, r.reason) == (False, "janela_ja_fechada")


def test_medidor_mudo_fecha_janela_parcial_sem_ponte(feed, meter):
    first = feed(meter, START, minutes=5, kw=120.0)
    assert _windows(first) == []
    # volta 55 min depois: a janela das 12:00 fecha (carência de 60 s no relógio) sem preencher o buraco
    later = feed(meter, START + timedelta(hours=1), minutes=2, kw=120.0)
    windows = _windows(later)
    assert len(windows) == 1
    assert windows[0].start == START
    assert windows[0].samples == 30
    assert windows[0].demand_kw == pytest.approx(120.0 * 290 / 900, abs=0.01)  # só 4 min 50 s integrados


def test_conflito_de_versao_nao_grava(feed, repo, sink, tenant, meter, monkeypatch):
    feed(meter, START, minutes=1, kw=50.0)
    monkeypatch.setattr(repo, "save_state", lambda state, expected_version: False)
    result = _process(_r(START + timedelta(minutes=2)), meter, tenant, repo, sink)
    assert result.accepted is False
    assert result.reason == "conflito_de_versao"


def test_retry_resolve_conflito_transitorio(feed, repo, sink, tenant, meter, monkeypatch):
    feed(meter, START, minutes=1, kw=50.0)
    original = repo.save_state
    calls = {"n": 0}

    def flaky(state, expected_version):
        calls["n"] += 1
        if calls["n"] <= 2:  # outro consumidor "ganhou" duas vezes seguidas
            return False
        return original(state, expected_version)

    monkeypatch.setattr(repo, "save_state", flaky)
    monkeypatch.setattr("energia.services.processor.time.sleep", lambda s: None)
    result = process_with_retry(_r(START + timedelta(minutes=2)), meter, tenant, repo, sink)
    assert result.accepted is True
    assert calls["n"] == 3
    assert len(repo.get_state(meter.key).open[0].samples) == 7


def test_retry_desiste_depois_das_tentativas(feed, repo, sink, tenant, meter, monkeypatch):
    feed(meter, START, minutes=1, kw=50.0)
    monkeypatch.setattr(repo, "save_state", lambda state, expected_version: False)
    monkeypatch.setattr("energia.services.processor.time.sleep", lambda s: None)
    result = process_with_retry(_r(START + timedelta(minutes=2)), meter, tenant, repo, sink, attempts=3)
    assert (result.accepted, result.reason) == (False, "conflito_de_versao")


def test_fator_de_potencia_alerta_uma_vez_por_hora(feed, meter):
    results = feed(meter, START, minutes=35, kw=80.0, pf=0.85)
    alerts = [a for a in _alerts(results) if a.kind == AlertKind.FATOR_POTENCIA]
    assert len(alerts) == 1  # duas janelas na mesma hora local, um alerta
    assert alerts[0].data["pf_avg"] == pytest.approx(0.85)


def test_modalidade_azul_usa_contrato_do_posto(feed, meter_azul):
    w_fora = _windows(feed(meter_azul, START, minutes=17, kw=100.0))[0]
    assert w_fora.period == TariffPeriod.FORA_PONTA
    assert w_fora.contracted_kw == 150.0
    assert w_fora.exceeded is False

    ponta = utc(2026, 9, 4, 22, 0)  # 18:00 local, sexta; leituras posteriores às da manhã
    windows = {w.start: w for w in _windows(feed(meter_azul, ponta, minutes=17, kw=100.0))}
    w_ponta = windows[ponta]
    assert w_ponta.period == TariffPeriod.PONTA
    assert w_ponta.contracted_kw == 80.0
    assert w_ponta.exceeded is True


def test_projecao_avisa_antes_da_janela_fechar(feed, meter):
    results = feed(meter, START, minutes=6, kw=130.0)
    alerts = _alerts(results)
    assert len(alerts) == 1
    a = alerts[0]
    assert a.kind == AlertKind.PROJECAO
    assert a.data["projected_kw"] == pytest.approx(130.0, abs=0.5)
    assert 0 < a.data["seconds_remaining"] <= 600


def _run(readings, meter, tenant, now=None):
    repo, sink = MemoryRepository(), MemorySink()
    for r in readings:
        process_reading(r, meter, tenant, repo, sink, now=now or r.ts)
    return repo, sink


def _variable(n: int):
    return [_r(START + timedelta(seconds=10 * i), kw=80 + (i % 7) * 5, pf=0.9) for i in range(n)]


def test_desordem_leve_em_tempo_real_da_a_mesma_janela(tenant, meter):
    # 17 min; embaralha dentro de blocos de 60 s (o que a fila padrão faz em fluxo normal)
    readings = _variable(102)
    ordered, _ = _run(readings, meter, tenant)

    shuffled = readings[:]
    rng = random.Random(7)
    for i in range(0, len(shuffled), 6):
        block = shuffled[i : i + 6]
        rng.shuffle(block)
        shuffled[i : i + 6] = block
    # relógio da nuvem avança com o maior timestamp visto até aqui (fluxo em tempo real)
    repo, _ = MemoryRepository(), None
    sink = MemorySink()
    clock = shuffled[0].ts
    for r in shuffled:
        clock = max(clock, r.ts)
        process_reading(r, meter, tenant, repo, sink, now=clock)

    w_ordered = ordered.windows[meter.key.pk]
    w_disordered = repo.windows[meter.key.pk]
    assert [w.start for w in w_ordered] == [START] == [w.start for w in w_disordered]
    assert w_disordered[0].kwh == pytest.approx(w_ordered[0].kwh, abs=1e-9)
    assert w_disordered[0].samples == w_ordered[0].samples == 90
    assert w_disordered[0].pf_avg == pytest.approx(w_ordered[0].pf_avg)


def test_rajada_de_reenvio_embaralhada_em_minutos_nao_perde_amostras(tenant, meter):
    """Gateway volta de uma queda e descarrega 2 h em segundos; a fila embaralha lotes de 3 min."""
    readings = _variable(720)  # 2 h
    ordered, _ = _run(readings, meter, tenant)

    burst = readings[:]
    rng = random.Random(11)
    block = 18  # 3 min de dado por lote
    blocks = [burst[i : i + block] for i in range(0, len(burst), block)]
    rng.shuffle(blocks)  # os lotes chegam em ordem qualquer...
    burst = [r for b in blocks for r in b]
    wall = utc(2026, 9, 7, 19, 0)  # ...todos no mesmo minuto de relógio
    repo, sink = _run(burst, meter, tenant, now=wall)

    # durante a rajada nada fecha: a carência é no relógio, e ele não andou
    assert repo.windows[meter.key.pk] == []
    state = repo.get_state(meter.key)
    assert len(state.open) == 8  # 2 h = 8 janelas de 15 min, todas abertas (teto MAX_OPEN)

    # 61 s depois, uma leitura nova qualquer fecha tudo que já tinha "algo depois" e cabe na carência
    process_reading(
        _r(START + timedelta(hours=2, seconds=10), kw=80), meter, tenant, repo, sink, now=wall + timedelta(seconds=61)
    )
    closed = {w.start: w for w in repo.windows[meter.key.pk]}
    expected = {w.start: w for w in ordered.windows[meter.key.pk]}
    # 7 das 8: a das 13:45 só ganhou "algo depois" agora, e fecha daqui a 60 s de relógio
    assert len(closed) == len(expected) == 7
    for start, want in expected.items():
        got = closed[start]
        assert got.samples == want.samples == 90
        assert got.kwh == pytest.approx(want.kwh, abs=1e-9)

    process_reading(
        _r(START + timedelta(hours=2, seconds=20), kw=80), meter, tenant, repo, sink, now=wall + timedelta(seconds=122)
    )
    closed = {w.start: w for w in repo.windows[meter.key.pk]}
    assert len(closed) == 8
    assert closed[START + timedelta(hours=1, minutes=45)].samples == 90


def test_teto_de_janelas_abertas_forca_fechamento(tenant, meter):
    readings = _variable(9 * 90)  # 9 janelas e um pouco, todas "no mesmo instante"
    wall = utc(2026, 9, 7, 19, 0)
    repo, _ = _run(readings, meter, tenant, now=wall)
    state = repo.get_state(meter.key)
    assert len(state.open) == 8
    assert len(repo.windows[meter.key.pk]) == 1  # a mais antiga fechou pelo teto, com 90 amostras
    assert repo.windows[meter.key.pk][0].samples == 90


def test_redelivery_do_lote_inteiro_nao_muda_nada(tenant, meter):
    readings = [_r(START + timedelta(seconds=10 * i), kw=100) for i in range(102)]
    repo, sink = MemoryRepository(), MemorySink()
    for r in readings:
        process_reading(r, meter, tenant, repo, sink, now=r.ts)
    before = (repo.get_state(meter.key).model_dump(), len(repo.windows[meter.key.pk]), len(sink.events))

    outcomes = {process_reading(r, meter, tenant, repo, sink, now=readings[-1].ts).reason for r in readings}
    assert outcomes == {"duplicada", "janela_ja_fechada"}
    after = (repo.get_state(meter.key).model_dump(), len(repo.windows[meter.key.pk]), len(sink.events))
    assert before == after
