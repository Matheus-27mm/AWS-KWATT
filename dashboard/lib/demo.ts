// Modo demonstração: dados plausíveis de uma fábrica de três turnos, com a mesma forma dos dados reais.
// Aparece enquanto o painel não tem uma chave de API configurada.

import type { DemandWindow, TariffPeriod } from './api';
import {
  buildDashboard,
  type AlertView,
  type DashboardData,
  type MeterView,
  type Range,
} from './model';

const TENANT = {
  name: 'Demo Plásticos',
  tz: 'America/Manaus',
  pf_reference: 0.92,
  demand_tolerance: 0.05,
  ponta_start: '18:00',
  ponta_end: '21:00',
};

type Profile = {
  id: string;
  name: string;
  line: string;
  contracted: number;
  base: number;
  peak: number;
  pf: number;
  pfDip: number;
  pontaSpike: number;
};

const PROFILES: Profile[] = [
  {
    id: 'injetoras',
    name: 'Injetoras',
    line: 'Linha 1',
    contracted: 115,
    base: 20,
    peak: 110,
    pf: 0.94,
    pfDip: 0.86,
    pontaSpike: 0.25,
  },
  {
    id: 'compressores',
    name: 'Compressores',
    line: 'Utilidades',
    contracted: 57,
    base: 15,
    peak: 60,
    pf: 0.94,
    pfDip: 0.8,
    pontaSpike: 0,
  },
  {
    id: 'climatizacao',
    name: 'Climatização',
    line: 'Predial',
    contracted: 50,
    base: 10,
    peak: 45,
    pf: 0.94,
    pfDip: 0.86,
    pontaSpike: 0,
  },
];

function localHour(date: Date, tz: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { hour, weekday };
}

function loadFactor(hour: number, weekday: number): number {
  if (weekday === 0 || weekday === 6) return 0.3;
  if (hour >= 6 && hour < 14) return 1.0;
  if (hour >= 14 && hour < 22) return 0.85;
  return 0.4;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function periodFor(hour: number, weekday: number): TariffPeriod {
  return weekday >= 1 && weekday <= 5 && hour >= 18 && hour < 21
    ? 'ponta'
    : 'fora_ponta';
}

function demandAt(
  p: Profile,
  date: Date,
  rnd: () => number,
): { kw: number; pf: number } {
  const { hour, weekday } = localHour(date, TENANT.tz);
  let kw = p.base + (p.peak - p.base) * loadFactor(hour, weekday);
  if (p.pontaSpike && weekday >= 1 && weekday <= 5 && hour >= 18 && hour < 21)
    kw *= 1 + p.pontaSpike;
  kw *= 1 + (rnd() - 0.5) * 0.06;
  const pf = (hour === 12 ? p.pfDip : p.pf) + (rnd() - 0.5) * 0.02;
  return { kw, pf };
}

export function demoDashboard(range: Range, now = new Date()): DashboardData {
  const hours = range === '7d' ? 7 * 24 : 24;
  const windowMs = 15 * 60_000;
  const firstStart =
    Math.floor((now.getTime() - hours * 3600_000) / windowMs) * windowMs;
  const currentStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const secondsInWindow = Math.floor((now.getTime() - currentStart) / 1000);

  const meters: MeterView[] = PROFILES.map((p, i) => {
    const rnd = seeded(11 + i * 7);
    const windows: DemandWindow[] = [];
    for (let t = firstStart; t < currentStart; t += windowMs) {
      const start = new Date(t);
      const { kw, pf } = demandAt(p, start, rnd);
      const { hour, weekday } = localHour(start, TENANT.tz);
      windows.push({
        key: { tenant_id: 'demo', site_id: 'fabrica', meter_id: p.id },
        start: start.toISOString(),
        end: new Date(t + windowMs).toISOString(),
        period: periodFor(hour, weekday),
        kwh: kw / 4,
        kvarh: (kw / 4) * 0.33,
        demand_kw: kw,
        max_kw: kw * 1.04,
        samples: 90,
        pf_avg: pf,
        contracted_kw: p.contracted,
        exceeded: kw > p.contracted * 1.05,
      });
    }
    const nowDemand = demandAt(p, now, rnd);
    const { hour, weekday } = localHour(now, TENANT.tz);
    const projected = nowDemand.kw * (1 + (rnd() - 0.5) * 0.02);
    const limit = p.contracted * 1.05;
    const status: MeterView['status'] =
      projected > limit
        ? 'critico'
        : nowDemand.kw > p.contracted * 0.9
          ? 'atencao'
          : 'online';
    return {
      id: p.id,
      name: p.name,
      line: p.line,
      modality: 'verde',
      contractedKw: p.contracted,
      currentKw: nowDemand.kw,
      currentPf: nowDemand.pf,
      projectedKw: projected,
      periodNow: periodFor(hour, weekday),
      windowStart: new Date(currentStart).toISOString(),
      secondsInWindow,
      lastReadingAt: new Date(now.getTime() - 8000).toISOString(),
      silentForS: 8,
      loadPct: Math.round((nowDemand.kw / p.contracted) * 100),
      status,
      statusText:
        status === 'critico'
          ? 'projeção acima do contrato'
          : status === 'atencao'
            ? 'próximo do limite'
            : 'online',
      windows,
    };
  });

  const names = Object.fromEntries(PROFILES.map((p) => [p.id, p.name]));
  const alerts: AlertView[] = [];
  for (const m of meters) {
    for (const w of m.windows.slice(-40)) {
      if (w.exceeded) {
        alerts.push({
          id: `demo-${m.id}-${w.start}`,
          kind: 'ultrapassagem_demanda',
          tone: 'critical',
          title: 'Demanda ultrapassou o contrato',
          detail: `Demanda de ${w.demand_kw.toFixed(1)} kW na janela ultrapassou os ${w.contracted_kw} kW contratados em ${(w.demand_kw - (w.contracted_kw ?? 0)).toFixed(1)} kW.`,
          meterId: m.id,
          meterName: names[m.id],
          ts: w.end,
        });
      }
      if (
        (w.pf_avg ?? 1) < TENANT.pf_reference &&
        alerts.filter((a) => a.kind === 'fator_potencia').length < 3
      ) {
        alerts.push({
          id: `demo-pf-${m.id}-${w.start}`,
          kind: 'fator_potencia',
          tone: 'warning',
          title: 'Fator de potência abaixo da referência',
          detail: `Fator de potência médio ${(w.pf_avg ?? 0).toFixed(3)} na janela, abaixo da referência ${TENANT.pf_reference.toFixed(2)}. Excedente reativo será cobrado.`,
          meterId: m.id,
          meterName: names[m.id],
          ts: w.end,
        });
      }
    }
  }

  return buildDashboard({
    source: 'demo',
    tenant: TENANT,
    siteName: 'Fábrica Distrito Industrial',
    meters,
    alerts: alerts.slice(-30),
    range,
    now,
  });
}
