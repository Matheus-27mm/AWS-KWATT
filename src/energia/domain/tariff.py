"""Calendário tarifário: posto (ponta / fora ponta), janelas de 15 minutos e chaves de mês e hora.

As janelas são alinhadas ao relógio em UTC. Manaus é UTC-4 sem horário de verão, então a grade
de 15 minutos em UTC coincide com a grade local. Se um cliente estiver em fuso com deslocamento
fracionário isso precisaria de revisão; nenhum estado brasileiro tem.
"""

from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from .models import TariffPeriod, TenantConfig
from .window import WINDOW, WINDOW_SECONDS

__all__ = ["WINDOW", "WINDOW_SECONDS", "hour_key", "month_key", "period_for", "to_local", "window_start"]


def to_local(ts_utc: datetime, tz: str) -> datetime:
    return ts_utc.astimezone(ZoneInfo(tz))


def _parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


def period_for(ts_utc: datetime, tenant: TenantConfig) -> TariffPeriod:
    """Classifica um instante como ponta ou fora ponta segundo o calendário do cliente."""
    local = to_local(ts_utc, tenant.tz)
    if tenant.ponta_only_weekdays and local.weekday() >= 5:
        return TariffPeriod.FORA_PONTA
    if local.date() in tenant.holidays:
        return TariffPeriod.FORA_PONTA
    start = _parse_hhmm(tenant.ponta_start)
    end = _parse_hhmm(tenant.ponta_end)
    t = local.time().replace(second=0, microsecond=0)
    if start <= t < end:
        return TariffPeriod.PONTA
    return TariffPeriod.FORA_PONTA


def window_start(ts_utc: datetime) -> datetime:
    """Início da janela de 15 minutos que contém o instante (UTC)."""
    minute = (ts_utc.minute // 15) * 15
    return ts_utc.replace(minute=minute, second=0, microsecond=0)


def month_key(ts_utc: datetime, tz: str) -> str:
    return to_local(ts_utc, tz).strftime("%Y-%m")


def hour_key(ts_utc: datetime, tz: str) -> str:
    return to_local(ts_utc, tz).strftime("%Y-%m-%dT%H")
