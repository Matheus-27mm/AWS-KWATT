// Cliente da API KWATT (FastAPI no Lambda). Os tipos espelham src/energia/domain/models.py.

import type { Settings } from './settings';

export type TariffPeriod = 'ponta' | 'fora_ponta';
export type AlertKind =
  | 'ultrapassagem_demanda'
  | 'projecao_demanda'
  | 'fator_potencia';
export type Severity = 'info' | 'warning' | 'critical';

export type Tenant = {
  tenant_id: string;
  name: string;
  tz: string;
  ponta_start: string;
  ponta_end: string;
  pf_reference: number;
  demand_tolerance: number;
};

export type Site = { site_id: string; name: string; distributor: string };

export type Meter = {
  tenant_id: string;
  site_id: string;
  meter_id: string;
  name: string;
  line: string | null;
  modality: 'verde' | 'azul';
  contracted_kw: number | null;
  contracted_kw_ponta: number | null;
  contracted_kw_fora_ponta: number | null;
  sample_interval_s: number;
};

export type Sample = { o: number; kw: number; kvar: number; pf: number | null };

export type OpenWindow = {
  start: string;
  samples: Sample[];
  beyond_seen_at: string | null;
};

export type MeterState = {
  last_ts: string | null;
  open: OpenWindow[];
  closed_before: string | null;
  version: number;
};

export type MeterStatus = {
  meter: Meter;
  state: MeterState | null;
  period_now: TariffPeriod;
  contracted_kw_now: number | null;
  projected_kw: number | null;
  seconds_in_window: number | null;
  silent_for_s: number | null;
};

export type DemandWindow = {
  key: { tenant_id: string; site_id: string; meter_id: string };
  start: string;
  end: string;
  period: TariffPeriod;
  kwh: number;
  kvarh: number;
  demand_kw: number;
  max_kw: number;
  samples: number;
  pf_avg: number | null;
  contracted_kw: number | null;
  exceeded: boolean;
};

export type MonthRollup = {
  month: string;
  max_demand_kw: Partial<Record<TariffPeriod, number>>;
  max_demand_at: Partial<Record<TariffPeriod, string>>;
  kwh: Partial<Record<TariffPeriod, number>>;
  windows: number;
  exceeded_windows: number;
  pf_below_windows: number;
};

export type Alert = {
  id: string;
  tenant_id: string;
  site_id: string;
  meter_id: string;
  ts: string;
  kind: AlertKind;
  severity: Severity;
  message: string;
  data: Record<string, unknown>;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createClient(settings: Settings) {
  const base = settings.apiUrl.replace(/\/+$/, '');
  const tenant = encodeURIComponent(settings.tenant);
  const site = encodeURIComponent(settings.site);
  const headers = { 'X-API-Key': settings.apiKey };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${base}${path}`, { headers, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(
        res.status,
        res.status === 401
          ? 'Chave da API recusada. Confira o cliente e a chave em Configurações.'
          : `A API respondeu ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}`,
      );
    }
    return (await res.json()) as T;
  }

  const meterPath = (meterId: string) =>
    `/tenants/${tenant}/meters/${site}/${encodeURIComponent(meterId)}`;

  return {
    health: () => get<{ status: string; version: string }>('/health'),
    tenant: () => get<Tenant>(`/tenants/${tenant}`),
    sites: () => get<Site[]>(`/tenants/${tenant}/sites`),
    meters: async () =>
      (await get<Meter[]>(`/tenants/${tenant}/meters`)).filter(
        (m) => m.site_id === settings.site,
      ),
    state: (meterId: string) => get<MeterStatus>(`${meterPath(meterId)}/state`),
    windows: (meterId: string, dayUtc: string) =>
      get<DemandWindow[]>(`${meterPath(meterId)}/windows?day=${dayUtc}`),
    month: async (meterId: string, month: string) => {
      try {
        return await get<MonthRollup>(`${meterPath(meterId)}/months/${month}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    alerts: (limit = 200) =>
      get<Alert[]>(`/tenants/${tenant}/alerts?limit=${limit}`),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

/** Dia UTC (AAAA-MM-DD) de um instante, como a API particiona as janelas. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Lista de dias UTC cobrindo as últimas `hours` horas até agora. */
export function utcDaysBack(hours: number, now = new Date()): string[] {
  const days = new Set<string>();
  const start = new Date(now.getTime() - hours * 3600_000);
  for (let t = start.getTime(); t <= now.getTime(); t += 86_400_000) {
    days.add(utcDay(new Date(t)));
  }
  days.add(utcDay(now));
  return [...days];
}
