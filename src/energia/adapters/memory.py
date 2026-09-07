"""Adaptadores em memória: testes, runner local e API em modo de desenvolvimento."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

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


class MemoryRepository:
    events_are_durable = False

    def __init__(self) -> None:
        self.tenants: dict[str, TenantConfig] = {}
        self.sites: dict[tuple[str, str], SiteConfig] = {}
        self.meters: dict[str, MeterConfig] = {}
        self.states: dict[str, MeterState] = {}
        self.windows: dict[str, list[DemandWindow]] = defaultdict(list)
        self.months: dict[tuple[str, str], MonthRollup] = {}
        self.alerts: dict[str, list[Alert]] = defaultdict(list)

    def get_tenant(self, tenant_id: str) -> TenantConfig | None:
        t = self.tenants.get(tenant_id)
        return t.model_copy(deep=True) if t else None

    def put_tenant(self, tenant: TenantConfig) -> None:
        self.tenants[tenant.tenant_id] = tenant.model_copy(deep=True)

    def put_site(self, site: SiteConfig) -> None:
        self.sites[(site.tenant_id, site.site_id)] = site.model_copy(deep=True)

    def list_sites(self, tenant_id: str) -> list[SiteConfig]:
        return [s for (t, _), s in self.sites.items() if t == tenant_id]

    def get_meter(self, key: MeterKey) -> MeterConfig | None:
        m = self.meters.get(key.pk)
        return m.model_copy(deep=True) if m else None

    def put_meter(self, meter: MeterConfig) -> None:
        self.meters[meter.key.pk] = meter.model_copy(deep=True)

    def list_meters(self, tenant_id: str) -> list[MeterConfig]:
        return [m for m in self.meters.values() if m.tenant_id == tenant_id]

    def get_state(self, key: MeterKey) -> MeterState | None:
        s = self.states.get(key.pk)
        return s.model_copy(deep=True) if s else None

    def list_states_ingested_before(self, cutoff):
        return [
            state.model_copy(deep=True)
            for state in self.states.values()
            if state.last_ingested_at is not None and state.last_ingested_at <= cutoff
        ]

    def save_state(self, state: MeterState, expected_version: int) -> bool:
        current = self.states.get(state.key.pk)
        current_version = current.version if current else 0
        if current_version != expected_version:
            return False
        self.states[state.key.pk] = state.model_copy(deep=True)
        return True

    def commit_processing(self, state, expected_version, windows, rollups, alerts) -> bool:
        if not self.save_state(state, expected_version):
            return False
        for window in windows:
            self.save_window(window)
        for rollup in rollups:
            self.save_month(rollup)
        for alert in alerts:
            self.save_alert(alert)
        return True

    def save_window(self, window: DemandWindow) -> None:
        self.windows[window.key.pk].append(window)

    def list_windows(self, key: MeterKey, day: date) -> list[DemandWindow]:
        return [w for w in self.windows[key.pk] if w.start.date() == day]

    def get_month(self, key: MeterKey, month: str) -> MonthRollup | None:
        r = self.months.get((key.pk, month))
        return r.model_copy(deep=True) if r else None

    def save_month(self, rollup: MonthRollup) -> None:
        self.months[(rollup.key.pk, rollup.month)] = rollup.model_copy(deep=True)

    def save_alert(self, alert: Alert) -> None:
        self.alerts[alert.tenant_id].append(alert)

    def list_alerts(self, tenant_id: str, limit: int = 50) -> list[Alert]:
        items = sorted(self.alerts[tenant_id], key=lambda a: a.ts, reverse=True)
        return items[:limit]


class MemorySink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def emit(self, detail_type: str, detail: dict) -> None:
        self.events.append((detail_type, detail))
