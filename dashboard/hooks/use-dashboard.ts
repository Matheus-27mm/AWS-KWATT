'use client';

// Carrega o painel da API em intervalos regulares. Sem chave configurada, mostra o modo demonstração.

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient, utcDaysBack, type DemandWindow } from '@/lib/api';
import { demoDashboard } from '@/lib/demo';
import {
  alertView,
  buildDashboard,
  meterView,
  type DashboardData,
  type Range,
} from '@/lib/model';
import { isConfigured, useSettings, type Settings } from '@/lib/settings';

export type DashboardStatus = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  settings: Settings;
  refresh: () => void;
};

async function loadLive(
  settings: Settings,
  range: Range,
): Promise<DashboardData> {
  const api = createClient(settings);
  const now = new Date();
  const [tenant, sites, meters, alerts] = await Promise.all([
    api.tenant(),
    api.sites(),
    api.meters(),
    api.alerts(300),
  ]);
  // 48 h na visão de 24 h: o comparativo "contra ontem no mesmo horário" precisa do dia anterior
  const days = utcDaysBack(range === '7d' ? 7 * 24 : 48, now);
  const views = await Promise.all(
    meters.map(async (meter) => {
      const [status, perDay] = await Promise.all([
        api.state(meter.meter_id).catch(() => null),
        Promise.all(
          days.map((day) =>
            api.windows(meter.meter_id, day).catch(() => [] as DemandWindow[]),
          ),
        ),
      ]);
      return meterView(meter, status, perDay.flat(), tenant.demand_tolerance);
    }),
  );
  const names = Object.fromEntries(meters.map((m) => [m.meter_id, m.name]));
  const site = sites.find((s) => s.site_id === settings.site);
  return buildDashboard({
    source: 'live',
    tenant,
    siteName: site?.name ?? settings.site,
    meters: views,
    alerts: alerts
      .filter((a) => a.site_id === settings.site)
      .map((a) => alertView(a, names)),
    range,
    now,
  });
}

export function useDashboard(range: Range): DashboardStatus {
  const settings = useSettings();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        if (!isConfigured(settings)) {
          setData(demoDashboard(range));
          setError(null);
        } else {
          const live = await loadLive(settings, range);
          if (!cancelled) {
            setData(live);
            setError(null);
          }
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    void run();
    const every = isConfigured(settings)
      ? range === '7d'
        ? 60_000
        : 15_000
      : 30_000;
    const timer = window.setInterval(run, every);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings, range, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, settings, refresh };
}
