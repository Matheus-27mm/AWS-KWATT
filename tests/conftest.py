from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.domain.models import MeterConfig, Reading, TariffModality, TenantConfig
from energia.services.processor import ProcessResult, process_reading


def utc(y: int, m: int, d: int, h: int = 0, mi: int = 0, s: int = 0) -> datetime:
    return datetime(y, m, d, h, mi, s, tzinfo=UTC)


@pytest.fixture
def tenant() -> TenantConfig:
    return TenantConfig(tenant_id="acme", name="ACME Plásticos", api_key_hash="x")


@pytest.fixture
def meter() -> MeterConfig:
    return MeterConfig(tenant_id="acme", site_id="fabrica", meter_id="linha-1", name="Linha 1", contracted_kw=100.0)


@pytest.fixture
def meter_azul() -> MeterConfig:
    return MeterConfig(
        tenant_id="acme",
        site_id="fabrica",
        meter_id="linha-2",
        name="Linha 2",
        modality=TariffModality.AZUL,
        contracted_kw_ponta=80.0,
        contracted_kw_fora_ponta=150.0,
    )


@pytest.fixture
def repo() -> MemoryRepository:
    return MemoryRepository()


@pytest.fixture
def sink() -> MemorySink:
    return MemorySink()


@pytest.fixture
def feed(repo: MemoryRepository, sink: MemorySink, tenant: TenantConfig):
    """Alimenta o processador com amostras regulares a partir de `start` por `minutes`.

    O relógio da nuvem acompanha o timestamp da leitura (fluxo em tempo real), a menos que `now`
    seja dado, caso em que todas chegam "no mesmo instante" (rajada).
    """

    def _feed(
        meter: MeterConfig,
        start: datetime,
        minutes: int,
        kw: Callable[[datetime], float] | float,
        interval_s: int = 10,
        pf: float | None = None,
        now: datetime | None = None,
    ) -> list[ProcessResult]:
        results: list[ProcessResult] = []
        ts = start
        end = start + timedelta(minutes=minutes)
        while ts < end:
            value = kw(ts) if callable(kw) else kw
            reading = Reading(
                tenant_id=meter.tenant_id,
                site_id=meter.site_id,
                meter_id=meter.meter_id,
                ts=ts,
                kw=value,
                kvar=value * 0.3,
                pf=pf,
            )
            results.append(process_reading(reading, meter, tenant, repo, sink, now=now or ts))
            ts += timedelta(seconds=interval_s)
        return results

    return _feed
