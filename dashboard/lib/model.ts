// Modelo de visão do painel: o que as telas mostram, calculado a partir da API (ou do modo demo).

import type {
  Alert,
  AlertKind,
  DemandWindow,
  Meter,
  MeterStatus,
  TariffPeriod,
  Tenant,
} from './api';
import { startOfLocalDay } from './format';

export type Range = '24h' | '7d';

export type MeterView = {
  id: string;
  name: string;
  line: string | null;
  modality: 'verde' | 'azul';
  contractedKw: number | null;
  currentKw: number | null;
  currentPf: number | null;
  projectedKw: number | null;
  periodNow: TariffPeriod;
  windowStart: string | null;
  secondsInWindow: number | null;
  lastReadingAt: string | null;
  silentForS: number | null;
  loadPct: number | null;
  status: 'online' | 'atencao' | 'critico' | 'mudo' | 'sem_dados';
  statusText: string;
  windows: DemandWindow[];
};

export type CurvePoint = {
  start: string;
  kw: number;
  meters: number;
};

export type AlertView = {
  id: string;
  kind: AlertKind;
  tone: 'critical' | 'warning' | 'neutral';
  title: string;
  detail: string;
  meterId: string;
  meterName: string;
  ts: string;
};

export type DashboardData = {
  source: 'demo' | 'live';
  updatedAt: Date;
  tenant: Pick<
    Tenant,
    | 'name'
    | 'tz'
    | 'pf_reference'
    | 'demand_tolerance'
    | 'ponta_start'
    | 'ponta_end'
  >;
  siteName: string;
  meters: MeterView[];
  consolidated: {
    currentKw: number | null;
    contractedKw: number | null;
    projectedKw: number | null;
    kwhToday: number;
    worstPf: number | null;
    worstPfMeter: string | null;
    periodNow: TariffPeriod;
    windowStart: string | null;
    secondsInWindow: number | null;
    excessKw: number;
    riskyMeters: MeterView[];
  };
  curve: CurvePoint[];
  curveStats: { min: number; avg: number; peak: number } | null;
  alerts: AlertView[];
};

export const ALERT_TITLES: Record<AlertKind, string> = {
  ultrapassagem_demanda: 'Demanda ultrapassou o contrato',
  projecao_demanda: 'Projeção acima do contrato',
  fator_potencia: 'Fator de potência abaixo da referência',
};

export const ALERT_TONES: Record<AlertKind, AlertView['tone']> = {
  ultrapassagem_demanda: 'critical',
  projecao_demanda: 'warning',
  fator_potencia: 'warning',
};

const SILENT_AFTER_S = 120;
const NEWEST = (a: { start: string }, b: { start: string }) =>
  a.start < b.start ? 1 : a.start > b.start ? -1 : 0;

export function meterView(
  meter: Meter,
  status: MeterStatus | null,
  windows: DemandWindow[],
  tolerance: number,
): MeterView {
  const open = status?.state?.open ? [...status.state.open].sort(NEWEST) : [];
  const newest = open[0] ?? null;
  const last = newest
    ? newest.samples.reduce<(typeof newest.samples)[number] | null>(
        (best, s) => (best == null || s.o > best.o ? s : best),
        null,
      )
    : null;
  const contracted = status?.contracted_kw_now ?? meter.contracted_kw ?? null;
  const currentKw = last?.kw ?? null;
  const projectedKw = status?.projected_kw ?? null;
  const silent = status?.silent_for_s ?? null;
  const loadPct =
    currentKw != null && contracted
      ? Math.round((currentKw / contracted) * 100)
      : null;

  let state: MeterView['status'] = 'sem_dados';
  let statusText = 'sem leituras';
  if (currentKw != null) {
    const limit = contracted != null ? contracted * (1 + tolerance) : null;
    if (silent != null && silent > SILENT_AFTER_S) {
      state = 'mudo';
      statusText = 'sem leitura recente';
    } else if (limit != null && projectedKw != null && projectedKw > limit) {
      state = 'critico';
      statusText = 'projeção acima do contrato';
    } else if (contracted != null && currentKw > contracted * 0.9) {
      state = 'atencao';
      statusText = 'próximo do limite';
    } else {
      state = 'online';
      statusText = 'online';
    }
  }

  return {
    id: meter.meter_id,
    name: meter.name,
    line: meter.line,
    modality: meter.modality,
    contractedKw: contracted,
    currentKw,
    currentPf: last?.pf ?? null,
    projectedKw,
    periodNow: status?.period_now ?? 'fora_ponta',
    windowStart: newest?.start ?? null,
    secondsInWindow: status?.seconds_in_window ?? null,
    lastReadingAt: status?.state?.last_ts ?? null,
    silentForS: silent,
    loadPct,
    status: state,
    statusText,
    windows: [...windows].sort((a, b) => (a.start < b.start ? -1 : 1)),
  };
}

export function consolidatedCurve(
  meters: MeterView[],
  sinceIso: string,
): CurvePoint[] {
  const byStart = new Map<string, { kw: number; meters: number }>();
  for (const m of meters) {
    for (const w of m.windows) {
      if (w.start < sinceIso) continue;
      const cur = byStart.get(w.start) ?? { kw: 0, meters: 0 };
      cur.kw += w.demand_kw;
      cur.meters += 1;
      byStart.set(w.start, cur);
    }
  }
  return [...byStart.entries()]
    .map(([start, v]) => ({
      start,
      kw: Number(v.kw.toFixed(1)),
      meters: v.meters,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function alertView(
  alert: Alert,
  meterNames: Record<string, string>,
): AlertView {
  return {
    id: alert.id,
    kind: alert.kind,
    tone: ALERT_TONES[alert.kind] ?? 'neutral',
    title: ALERT_TITLES[alert.kind] ?? alert.kind,
    detail: alert.message,
    meterId: alert.meter_id,
    meterName: meterNames[alert.meter_id] ?? alert.meter_id,
    ts: alert.ts,
  };
}

export function buildDashboard(input: {
  source: 'demo' | 'live';
  tenant: DashboardData['tenant'];
  siteName: string;
  meters: MeterView[];
  alerts: AlertView[];
  range: Range;
  now?: Date;
}): DashboardData {
  const now = input.now ?? new Date();
  const { meters, tenant } = input;
  const since = new Date(
    now.getTime() - (input.range === '7d' ? 7 * 24 : 24) * 3600_000,
  );
  const curve = consolidatedCurve(meters, since.toISOString());
  const curveStats = curve.length
    ? {
        min: Math.min(...curve.map((p) => p.kw)),
        avg: curve.reduce((s, p) => s + p.kw, 0) / curve.length,
        peak: Math.max(...curve.map((p) => p.kw)),
      }
    : null;

  const withCurrent = meters.filter((m) => m.currentKw != null);
  const sum = (xs: Array<number | null>) =>
    xs.every((x) => x != null) && xs.length
      ? xs.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)
      : null;
  const currentKw = withCurrent.length
    ? sum(withCurrent.map((m) => m.currentKw))
    : null;
  const contractedKw = meters.length
    ? sum(meters.map((m) => m.contractedKw))
    : null;
  const projectedKw = withCurrent.length
    ? sum(withCurrent.map((m) => m.projectedKw))
    : null;

  const dayStart = startOfLocalDay(now, tenant.tz).toISOString();
  const kwhToday = meters.reduce(
    (total, m) =>
      total +
      m.windows
        .filter((w) => w.start >= dayStart)
        .reduce((s, w) => s + w.kwh, 0),
    0,
  );

  const pfs = withCurrent.filter((m) => m.currentPf != null);
  const worst = pfs.length
    ? pfs.reduce((a, b) =>
        Math.abs(b.currentPf ?? 1) < Math.abs(a.currentPf ?? 1) ? b : a,
      )
    : null;

  const riskyMeters = meters.filter((m) => m.status === 'critico');
  const excessKw = riskyMeters.reduce(
    (s, m) => s + Math.max(0, (m.projectedKw ?? 0) - (m.contractedKw ?? 0)),
    0,
  );
  const reference = riskyMeters[0] ?? withCurrent[0] ?? meters[0];

  return {
    source: input.source,
    updatedAt: now,
    tenant,
    siteName: input.siteName,
    meters,
    consolidated: {
      currentKw,
      contractedKw,
      projectedKw,
      kwhToday,
      worstPf: worst?.currentPf ?? null,
      worstPfMeter: worst?.name ?? null,
      periodNow: reference?.periodNow ?? 'fora_ponta',
      windowStart: reference?.windowStart ?? null,
      secondsInWindow: reference?.secondsInWindow ?? null,
      excessKw,
      riskyMeters,
    },
    curve,
    curveStats,
    alerts: [...input.alerts].sort((a, b) => (a.ts < b.ts ? 1 : -1)),
  };
}
