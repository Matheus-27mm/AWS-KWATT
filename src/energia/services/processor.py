"""Processamento de uma leitura: acumula amostras, fecha janelas, consolida o mês e dispara alertas.

É a única função que muda estado. Roda igual no Lambda (SQS), no endpoint HTTP de ingestão e no
runner local, porque só conversa com as portas de energia.ports.

Ordem e idempotência: a fila SQS padrão pode entregar fora de ordem e mais de uma vez, e uma
rajada de reenvio (gateway voltando de uma queda de internet) chega em lotes embaralhados em
escala de minutos. O estado guarda as janelas abertas com suas amostras; a energia é integrada no
fechamento (domain/window.py), então leitura atrasada entra no lugar certo e duplicata (mesmo
offset) é descartada. Uma janela fecha GRACE depois, no relógio da nuvem, de vermos a primeira
leitura posterior ao fim dela: em fluxo normal é ~70 s depois do fim; numa rajada, é 60 s depois
de a rajada passar por ela. Leitura de janela já fechada é descartada do plano operacional; o lake
bruto tem todas. Silêncio maior que MAX_GAP entre a última amostra de uma janela e a primeira da
seguinte não é preenchido: a janela fecha sem ponte e a seguinte começa sem âncora.

A gravação de estado, janelas, consolidados, alertas e outbox é uma transação condicional à versão
lida: dois consumidores concorrentes não corrompem a janela, um deles falha, relê e reaplica.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from ..domain.demand import MAX_GAP, demand_kw, projected_demand_kw
from ..domain.models import (
    Alert,
    AlertKind,
    DemandWindow,
    MeterConfig,
    MeterState,
    MonthRollup,
    OpenWindow,
    Reading,
    Severity,
    TenantConfig,
)
from ..domain.rules import check_power_factor, check_projection, check_window
from ..domain.tariff import WINDOW, month_key, period_for, window_start
from ..domain.window import GRACE, MAX_OPEN, Sample, integrate, pf_average
from ..ports import EventSink, StateRepository

OFFLINE_AFTER = timedelta(minutes=2)
FINALIZE_AFTER = timedelta(hours=2)


@dataclass
class ProcessResult:
    accepted: bool
    reason: str | None = None
    closed_windows: list[DemandWindow] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    rollups: dict[str, MonthRollup] = field(default_factory=dict)


def _seconds(a: datetime, b: datetime) -> int:
    return int((a - b).total_seconds())


def _sample(reading: Reading, start: datetime) -> Sample:
    # arredondado: cada dígito a mais custa bytes no item de estado, gravado a cada leitura
    return Sample(
        o=_seconds(reading.ts, start),
        kw=round(reading.kw, 3),
        kvar=round(reading.kvar, 3),
        pf=round(reading.pf, 4) if reading.pf is not None else None,
    )


def _reframe(s: Sample, from_start: datetime, to_start: datetime) -> Sample:
    """Expressa uma amostra de uma janela no frame de offsets de outra."""
    return Sample(o=s.o + _seconds(from_start, to_start), kw=s.kw, kvar=s.kvar, pf=s.pf)


def _anchor_for(state: MeterState, index: int) -> Sample | None:
    """Âncora da janela aberta `index`: a última amostra da janela anterior, no frame desta."""
    if index == 0:
        return state.anchor
    prev = state.open[index - 1]
    last = prev.last_sample
    return _reframe(last, prev.start, state.open[index].start) if last else None


def _close_oldest(
    state: MeterState, meter: MeterConfig, tenant: TenantConfig, repo: StateRepository, result: ProcessResult
) -> None:
    w = state.open[0]
    nxt = state.open[1] if len(state.open) > 1 else None
    last = w.last_sample
    next_first = _reframe(nxt.first_sample, nxt.start, w.start) if nxt and nxt.first_sample else None
    # Silêncio longo entre a última amostra e a próxima janela: não inventamos energia no buraco.
    # A janela fecha com o que tem e `samples` menor que o esperado denuncia o furo.
    bridged = next_first is not None and last is not None and (next_first.o - last.o) <= MAX_GAP.total_seconds()
    kwh, kvarh = integrate(w.samples, state.anchor, next_first if bridged else None)
    period = period_for(w.start, tenant)
    contracted = meter.contracted_for(period)
    demand = demand_kw(kwh)
    exceeded = contracted is not None and demand > contracted * (1.0 + tenant.demand_tolerance)
    window = DemandWindow(
        key=state.key,
        start=w.start,
        end=w.start + WINDOW,
        period=period,
        kwh=kwh,
        kvarh=kvarh,
        demand_kw=demand,
        max_kw=max((s.kw for s in w.samples), default=0.0),
        samples=len(w.samples),
        pf_avg=pf_average(w.samples),
        contracted_kw=contracted,
        exceeded=exceeded,
    )
    result.closed_windows.append(window)
    result.alerts.extend(check_window(window, meter, tenant))
    pf_alert = check_power_factor(window, meter, tenant, state)
    if pf_alert is not None:
        result.alerts.append(pf_alert)

    month = month_key(w.start, tenant.tz)
    rollup = result.rollups.get(month) or repo.get_month(state.key, month) or MonthRollup(key=state.key, month=month)
    rollup.apply(window, tenant.pf_reference)
    result.rollups[month] = rollup

    state.anchor = _reframe(last, w.start, nxt.start) if (bridged and nxt and last) else None
    state.closed_before = w.start + WINDOW
    state.open.pop(0)


def _insert(state: MeterState, reading: Reading) -> str | None:
    """Coloca a leitura na janela dela (criando se preciso). Devolve motivo de rejeição ou None."""
    ws = window_start(reading.ts)
    if state.closed_before is not None and ws < state.closed_before:
        return "janela_ja_fechada"
    target = next((w for w in state.open if w.start == ws), None)
    if target is None:
        target = OpenWindow(start=ws)
        if state.open and ws < state.open[0].start and state.anchor is not None:
            # a janela nova passa a ser a mais antiga aberta: a âncora muda de frame
            state.anchor = _reframe(state.anchor, state.open[0].start, ws)
        state.open.append(target)
        state.open.sort(key=lambda w: w.start)
    s = _sample(reading, ws)
    if any(existing.o == s.o for existing in target.samples):
        return "duplicada"
    target.samples.append(s)
    return None


@dataclass
class BatchResult:
    """Resultado de aplicar várias leituras do mesmo medidor com uma só leitura e gravação de estado."""

    outcomes: list[tuple[bool, str | None]] = field(default_factory=list)
    """(aceita, motivo) por leitura, na ordem recebida"""
    closed_windows: list[DemandWindow] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    conflict: bool = False

    @property
    def accepted(self) -> int:
        return sum(1 for ok, _ in self.outcomes if ok)

    @property
    def late(self) -> int:
        return sum(1 for ok, reason in self.outcomes if ok and reason == "atrasada")


def _apply(
    state: MeterState,
    reading: Reading,
    meter: MeterConfig,
    tenant: TenantConfig,
    repo: StateRepository,
    result: ProcessResult,
    now: datetime,
) -> tuple[bool, str | None]:
    """Aplica uma leitura ao estado em memória. Não grava nada; devolve (aceita, motivo)."""
    late = state.last_ts is not None and reading.ts <= state.last_ts
    rejection = _insert(state, reading)
    if rejection is not None:
        return False, rejection
    if state.last_ts is None or reading.ts > state.last_ts:
        state.last_ts = reading.ts
    state.last_ingested_at = now
    state.offline_alerted_at = None

    # Toda janela anterior à desta leitura já tem "algo depois dela": começa a contar a carência.
    ws = window_start(reading.ts)
    for w in state.open:
        if w.start < ws and w.beyond_seen_at is None:
            w.beyond_seen_at = now

    while len(state.open) > 1 and (
        len(state.open) > MAX_OPEN
        or (state.open[0].beyond_seen_at is not None and now >= state.open[0].beyond_seen_at + GRACE)
    ):
        _close_oldest(state, meter, tenant, repo, result)

    current = state.current
    if current is not None and current.samples and current.start == ws:
        last = current.last_sample
        assert last is not None
        anchor = _anchor_for(state, len(state.open) - 1)
        kwh_so_far, _ = integrate(current.samples, anchor, None, until=last.o)
        projected = projected_demand_kw(kwh_so_far, last.o)
        projection = check_projection(state, meter, tenant, current.start, last.o, projected)
        if projection is not None:
            result.alerts.append(projection)
            state.projection_alerted_window = current.start
    return True, ("atrasada" if late else None)


def _commit(
    state: MeterState, expected_version: int, result: ProcessResult, repo: StateRepository, sink: EventSink
) -> bool:
    """Grava estado e efeitos atomicamente; produção publica eventos pela outbox transacional."""
    state.version += 1
    if not repo.commit_processing(
        state, expected_version, result.closed_windows, list(result.rollups.values()), result.alerts
    ):
        return False
    if not getattr(repo, "events_are_durable", False):
        for window in result.closed_windows:
            sink.emit("JanelaDemanda", window.model_dump(mode="json"))
        for alert in result.alerts:
            sink.emit("Alerta", alert.model_dump(mode="json"))
    return True


def process_batch(
    readings: list[Reading],
    meter: MeterConfig,
    tenant: TenantConfig,
    repo: StateRepository,
    sink: EventSink,
    now: datetime | None = None,
) -> BatchResult:
    """Aplica todas as leituras de um medidor com uma leitura e uma gravação de estado.

    É assim que o Lambda consome a fila: agrupa o lote por medidor. Numa rajada, um lote de 100
    mensagens de 3 medidores vira 3 gravações em vez de 100, o que corta o custo do DynamoDB e as
    chances de conflito com o outro consumidor. Em conflito, quem chama relê e reaplica o grupo
    inteiro; é idempotente porque duplicatas são rejeitadas pelo offset.
    """
    now = now or datetime.now(UTC)
    if not readings:
        return BatchResult()
    key = readings[0].key
    state = repo.get_state(key) or MeterState(key=key)
    expected_version = state.version
    result = ProcessResult(accepted=True)
    batch = BatchResult()
    for reading in sorted(readings, key=lambda r: r.ts):
        batch.outcomes.append(_apply(state, reading, meter, tenant, repo, result, now))
    if not any(ok for ok, _ in batch.outcomes):
        return batch  # nada mudou: não gasta uma gravação
    if not _commit(state, expected_version, result, repo, sink):
        return BatchResult(outcomes=[(False, "conflito_de_versao")] * len(readings), conflict=True)
    batch.closed_windows = result.closed_windows
    batch.alerts = result.alerts
    return batch


def process_batch_with_retry(
    readings: list[Reading],
    meter: MeterConfig,
    tenant: TenantConfig,
    repo: StateRepository,
    sink: EventSink,
    attempts: int = 8,
    now: datetime | None = None,
) -> BatchResult:
    """Repete na hora em caso de conflito de versão.

    Conflito significa que outro consumidor gravou o mesmo medidor entre a nossa leitura e a nossa
    escrita. Reler e reaplicar leva milissegundos. Devolver a mensagem à fila custaria o visibility
    timeout, e a leitura voltaria depois da carência da janela, para ser descartada. No primeiro
    dia em produção isso perdeu de 1 a 13 amostras por janela.
    """
    batch = BatchResult(conflict=True)
    for attempt in range(attempts):
        batch = process_batch(readings, meter, tenant, repo, sink, now=now)
        if not batch.conflict:
            return batch
        time.sleep(min(0.02 * (2**attempt), 0.5) * (0.5 + random.random()))
    return batch


def process_reading(
    reading: Reading,
    meter: MeterConfig,
    tenant: TenantConfig,
    repo: StateRepository,
    sink: EventSink,
    now: datetime | None = None,
) -> ProcessResult:
    """Uma leitura, uma gravação. `now` é o relógio da nuvem (injetável nos testes)."""
    now = now or datetime.now(UTC)
    key = reading.key
    state = repo.get_state(key) or MeterState(key=key)
    expected_version = state.version
    result = ProcessResult(accepted=True)
    ok, reason = _apply(state, reading, meter, tenant, repo, result, now)
    if not ok:
        return ProcessResult(accepted=False, reason=reason)
    result.reason = reason
    if not _commit(state, expected_version, result, repo, sink):
        return ProcessResult(accepted=False, reason="conflito_de_versao")
    return result


def process_with_retry(
    reading: Reading,
    meter: MeterConfig,
    tenant: TenantConfig,
    repo: StateRepository,
    sink: EventSink,
    attempts: int = 8,
    now: datetime | None = None,
) -> ProcessResult:
    """Versão de uma leitura de process_batch_with_retry."""
    result = ProcessResult(accepted=False, reason="conflito_de_versao")
    for attempt in range(attempts):
        result = process_reading(reading, meter, tenant, repo, sink, now=now)
        if result.reason != "conflito_de_versao":
            return result
        time.sleep(min(0.02 * (2**attempt), 0.5) * (0.5 + random.random()))
    return result


def energy_so_far(state: MeterState) -> tuple[float, int] | None:
    """(kWh, segundos decorridos) da janela mais recente, para a API mostrar a projeção."""
    current = state.current
    if current is None or not current.samples:
        return None
    last = current.last_sample
    assert last is not None
    anchor = _anchor_for(state, len(state.open) - 1)
    kwh, _ = integrate(current.samples, anchor, None, until=last.o)
    return kwh, last.o


def sweep_stale_meter(
    state: MeterState,
    meter: MeterConfig,
    tenant: TenantConfig,
    repo: StateRepository,
    sink: EventSink,
    now: datetime | None = None,
) -> ProcessResult:
    """Alerta silêncio rapidamente e finaliza janelas só após o horizonte aceito de atraso."""
    now = now or datetime.now(UTC)
    result = ProcessResult(accepted=True)
    if state.last_ingested_at is None or now < state.last_ingested_at + OFFLINE_AFTER:
        return result
    expected_version = state.version
    if state.offline_alerted_at is None:
        alert_ts = state.last_ts or state.last_ingested_at
        result.alerts.append(
            Alert.for_meter(
                state.key,
                alert_ts,
                AlertKind.MEDIDOR_OFFLINE,
                Severity.WARNING,
                f"Medidor {state.key.meter_id} sem enviar leituras há mais de 2 minutos.",
                last_ingested_at=state.last_ingested_at.isoformat(),
            )
        )
        state.offline_alerted_at = now
    if now >= state.last_ingested_at + FINALIZE_AFTER:
        while state.open and state.open[0].start + WINDOW + GRACE <= now:
            _close_oldest(state, meter, tenant, repo, result)
    if not result.alerts and not result.closed_windows:
        return result
    if not _commit(state, expected_version, result, repo, sink):
        return ProcessResult(accepted=False, reason="conflito_de_versao")
    return result
