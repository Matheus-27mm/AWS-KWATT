"""Leitura operacional de um medidor: estado atual, janelas do dia e consolidado do mês."""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ...domain.demand import projected_demand_kw
from ...domain.models import (
    DemandWindow,
    MeterConfig,
    MeterKey,
    MeterState,
    MonthRollup,
    TariffPeriod,
    TenantConfig,
)
from ...domain.tariff import period_for
from ...ports import StateRepository
from ...services.processor import energy_so_far
from ..deps import get_repo, require_tenant

router = APIRouter(prefix="/tenants/{tenant_id}/meters/{site_id}/{meter_id}", tags=["medidores"])


class MeterStatus(BaseModel):
    meter: MeterConfig
    state: MeterState | None
    period_now: TariffPeriod
    contracted_kw_now: float | None
    projected_kw: float | None
    seconds_in_window: int | None
    silent_for_s: int | None


def _load_meter(tenant: TenantConfig, site_id: str, meter_id: str, repo: StateRepository) -> MeterConfig:
    meter = repo.get_meter(MeterKey(tenant_id=tenant.tenant_id, site_id=site_id, meter_id=meter_id))
    if meter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "medidor não encontrado")
    return meter


@router.get("/state", response_model=MeterStatus)
def meter_state(
    site_id: str,
    meter_id: str,
    tenant: TenantConfig = Depends(require_tenant),
    repo: StateRepository = Depends(get_repo),
) -> MeterStatus:
    meter = _load_meter(tenant, site_id, meter_id, repo)
    state = repo.get_state(meter.key)
    now = datetime.now(UTC)
    period = period_for(now, tenant)
    projected = None
    seconds_in_window = None
    silent = None
    if state is not None:
        so_far = energy_so_far(state)
        if so_far is not None:
            kwh_so_far, seconds_in_window = so_far
            projected = projected_demand_kw(kwh_so_far, seconds_in_window)
        if state.last_ts is not None:
            silent = int((now - state.last_ts).total_seconds())
    return MeterStatus(
        meter=meter,
        state=state,
        period_now=period,
        contracted_kw_now=meter.contracted_for(period),
        projected_kw=round(projected, 2) if projected is not None else None,
        seconds_in_window=seconds_in_window,
        silent_for_s=silent,
    )


@router.get("/windows", response_model=list[DemandWindow])
def meter_windows(
    site_id: str,
    meter_id: str,
    day: date = Query(description="dia em UTC, AAAA-MM-DD"),
    tenant: TenantConfig = Depends(require_tenant),
    repo: StateRepository = Depends(get_repo),
):
    meter = _load_meter(tenant, site_id, meter_id, repo)
    return repo.list_windows(meter.key, day)


@router.get("/months/{month}", response_model=MonthRollup)
def meter_month(
    site_id: str,
    meter_id: str,
    month: str,
    tenant: TenantConfig = Depends(require_tenant),
    repo: StateRepository = Depends(get_repo),
) -> MonthRollup:
    meter = _load_meter(tenant, site_id, meter_id, repo)
    rollup = repo.get_month(meter.key, month)
    if rollup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sem dados para o mês")
    return rollup
