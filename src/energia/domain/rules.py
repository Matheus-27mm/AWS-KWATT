"""Regras de alerta. Cada função devolve alertas, nunca grava nada."""

from __future__ import annotations

from datetime import datetime, timedelta

from .models import Alert, AlertKind, DemandWindow, MeterConfig, MeterState, Severity, TenantConfig
from .tariff import hour_key, period_for


def check_window(window: DemandWindow, meter: MeterConfig, tenant: TenantConfig) -> list[Alert]:
    """Ultrapassagem de demanda: a janela fechou acima do contratado mais a tolerância."""
    alerts: list[Alert] = []
    contracted = meter.contracted_for(window.period)
    if contracted is None:
        return alerts
    limit = contracted * (1.0 + tenant.demand_tolerance)
    if window.demand_kw > limit:
        excess = window.demand_kw - contracted
        alerts.append(
            Alert.for_meter(
                window.key,
                window.end,
                AlertKind.ULTRAPASSAGEM,
                Severity.CRITICAL,
                (
                    f"Demanda de {window.demand_kw:.1f} kW na janela {window.start:%H:%M}-{window.end:%H:%M} UTC "
                    f"({window.period.value}) ultrapassou os {contracted:.0f} kW contratados em {excess:.1f} kW."
                ),
                demand_kw=round(window.demand_kw, 2),
                contracted_kw=contracted,
                period=window.period.value,
                window_start=window.start.isoformat(),
            )
        )
    return alerts


def check_projection(
    state: MeterState,
    meter: MeterConfig,
    tenant: TenantConfig,
    window_start: datetime,
    elapsed: int,
    projected: float | None,
) -> Alert | None:
    """Projeção dentro da janela: avisa cedo o suficiente para desligar carga antes de fechar.

    `elapsed` é o offset da última amostra; `projected` é a demanda que a janela fecharia mantendo
    a média até aqui (None se cedo demais). Um aviso por janela.
    """
    if state.projection_alerted_window == window_start or projected is None:
        return None
    if elapsed < tenant.projection_min_elapsed_s:
        return None
    period = period_for(window_start, tenant)
    contracted = meter.contracted_for(period)
    if contracted is None:
        return None
    limit = contracted * (1.0 + tenant.demand_tolerance)
    if projected <= limit:
        return None
    remaining = max(0, 900 - int(elapsed))
    now = window_start + timedelta(seconds=elapsed)
    return Alert.for_meter(
        state.key,
        now,
        AlertKind.PROJECAO,
        Severity.WARNING,
        (
            f"Janela atual projeta {projected:.1f} kW contra {contracted:.0f} kW contratados ({period.value}). "
            f"Faltam {remaining // 60} min para fechar: reduza carga agora."
        ),
        projected_kw=round(projected, 2),
        contracted_kw=contracted,
        period=period.value,
        seconds_remaining=remaining,
        window_start=window_start.isoformat(),
    )


def check_power_factor(
    window: DemandWindow, meter: MeterConfig, tenant: TenantConfig, state: MeterState
) -> Alert | None:
    """Fator de potência abaixo da referência. Um alerta por hora e por medidor, para não inundar."""
    if window.pf_avg is None or abs(window.pf_avg) >= tenant.pf_reference:
        return None
    hour = hour_key(window.start, tenant.tz)
    if state.pf_alert_hour == hour:
        return None
    state.pf_alert_hour = hour
    return Alert.for_meter(
        window.key,
        window.end,
        AlertKind.FATOR_POTENCIA,
        Severity.WARNING,
        (
            f"Fator de potência médio {abs(window.pf_avg):.3f} na janela {window.start:%H:%M} UTC, "
            f"abaixo da referência {tenant.pf_reference:.2f}. Excedente reativo será cobrado."
        ),
        pf_avg=round(window.pf_avg, 4),
        pf_reference=tenant.pf_reference,
        kvarh=round(window.kvarh, 3),
        hour=hour,
    )
