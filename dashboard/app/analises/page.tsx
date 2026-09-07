'use client';

// Análises: o consolidado mensal por medidor, que é o que aparece na fatura da distribuidora.

import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/hooks/use-dashboard';
import { createClient, type MonthRollup } from '@/lib/api';
import {
  fmtDateTime,
  fmtKw,
  fmtKwh,
  fmtNumber,
  monthKey,
  monthLabel,
} from '@/lib/format';
import type { MeterView } from '@/lib/model';
import { isConfigured } from '@/lib/settings';

function rollupFromWindows(
  meter: MeterView,
  month: string,
): MonthRollup | null {
  const windows = meter.windows.filter((w) => w.start.slice(0, 7) === month);
  if (!windows.length) return null;
  const r: MonthRollup = {
    month,
    max_demand_kw: {},
    max_demand_at: {},
    kwh: {},
    windows: 0,
    exceeded_windows: 0,
    pf_below_windows: 0,
  };
  for (const w of windows) {
    r.kwh[w.period] = (r.kwh[w.period] ?? 0) + w.kwh;
    if (w.demand_kw > (r.max_demand_kw[w.period] ?? 0)) {
      r.max_demand_kw[w.period] = w.demand_kw;
      r.max_demand_at[w.period] = w.start;
    }
    r.windows += 1;
    if (w.exceeded) r.exceeded_windows += 1;
    if (w.pf_avg != null && Math.abs(w.pf_avg) < 0.92) r.pf_below_windows += 1;
  }
  return r;
}

export default function AnalisesPage() {
  const { data, loading, error, settings } = useDashboard('7d');
  const tz = data?.tenant.tz ?? 'America/Manaus';
  const months = useMemo(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    return [monthKey(now, tz), monthKey(prev, tz)];
  }, [tz]);
  const [month, setMonth] = useState<string>('');
  const activeMonth = month || months[0];
  const [rollups, setRollups] = useState<Record<string, MonthRollup | null>>(
    {},
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    async function run() {
      if (!data) return;
      setBusy(true);
      try {
        if (!isConfigured(settings)) {
          setRollups(
            Object.fromEntries(
              data.meters.map((m) => [m.id, rollupFromWindows(m, activeMonth)]),
            ),
          );
          return;
        }
        const api = createClient(settings);
        const entries = await Promise.all(
          data.meters.map(
            async (m) =>
              [
                m.id,
                await api.month(m.id, activeMonth).catch(() => null),
              ] as const,
          ),
        );
        if (!cancelled) setRollups(Object.fromEntries(entries));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [data, settings, activeMonth]);

  const totals = useMemo(() => {
    const list = Object.values(rollups).filter((r): r is MonthRollup => !!r);
    return {
      kwh: list.reduce(
        (s, r) => s + (r.kwh.ponta ?? 0) + (r.kwh.fora_ponta ?? 0),
        0,
      ),
      exceeded: list.reduce((s, r) => s + r.exceeded_windows, 0),
      pfBelow: list.reduce((s, r) => s + r.pf_below_windows, 0),
      windows: list.reduce((s, r) => s + r.windows, 0),
    };
  }, [rollups]);

  return (
    <AppShell
      title="Análises"
      subtitle="O que a fatura da distribuidora vai mostrar"
      data={data}
      error={error}
      loading={loading}
      actions={
        <Select
          value={activeMonth}
          onValueChange={(v) => setMonth(v ?? months[0])}
        >
          <SelectTrigger className="h-9 w-[180px] border-white/10 bg-white/[.04] text-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {!data ? (
        <Skeleton className="h-64 rounded-xl bg-white/5" />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="metric-card border-0">
              <CardHeader>
                <p className="metric-label">Energia no mês</p>
                <div className="mt-3 flex items-end gap-1.5">
                  <strong className="metric-value">
                    {fmtNumber(totals.kwh, 0)}
                  </strong>
                  <span className="mb-1 text-sm font-medium text-slate-500">
                    kWh
                  </span>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-slate-400">
                soma dos medidores · {totals.windows} janelas
              </CardContent>
            </Card>
            <Card className="metric-card border-0">
              <CardHeader>
                <p className="metric-label">Janelas com ultrapassagem</p>
                <div className="mt-3 flex items-end gap-1.5">
                  <strong
                    className={`metric-value ${totals.exceeded ? 'text-amber-300' : ''}`}
                  >
                    {totals.exceeded}
                  </strong>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-slate-400">
                uma basta para pagar ultrapassagem no mês
              </CardContent>
            </Card>
            <Card className="metric-card border-0">
              <CardHeader>
                <p className="metric-label">Janelas com FP baixo</p>
                <div className="mt-3 flex items-end gap-1.5">
                  <strong
                    className={`metric-value ${totals.pfBelow ? 'text-amber-300' : ''}`}
                  >
                    {totals.pfBelow}
                  </strong>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-slate-400">
                abaixo de {fmtNumber(data.tenant.pf_reference, 2)} · excedente
                reativo
              </CardContent>
            </Card>
            <Card className="metric-card border-0">
              <CardHeader>
                <p className="metric-label">Horário de ponta</p>
                <div className="mt-3 flex items-end gap-1.5">
                  <strong className="metric-value">
                    {data.tenant.ponta_start}–{data.tenant.ponta_end}
                  </strong>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-slate-400">
                dias úteis · tolerância de{' '}
                {Math.round(data.tenant.demand_tolerance * 100)}%
              </CardContent>
            </Card>
          </section>

          <section className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {data.meters.map((m) => {
              const r = rollups[m.id];
              const contractedFora = m.contractedKw;
              const maxFora = r?.max_demand_kw.fora_ponta ?? null;
              const maxPonta = r?.max_demand_kw.ponta ?? null;
              const pct =
                maxFora != null && contractedFora
                  ? (maxFora / contractedFora) * 100
                  : null;
              return (
                <Card key={m.id} className="panel-card border-0">
                  <CardHeader className="flex-row items-start justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold text-white">
                        {m.name}
                      </CardTitle>
                      <p className="mt-1 text-xs text-slate-500">
                        {monthLabel(activeMonth)} · contrato{' '}
                        {fmtKw(m.contractedKw, 0)}
                      </p>
                    </div>
                    {r && r.exceeded_windows > 0 ? (
                      <Badge className="border border-amber-400/20 bg-amber-400/10 text-amber-300">
                        {r.exceeded_windows} ultrapass.
                      </Badge>
                    ) : (
                      <Badge className="border border-lime-400/20 bg-lime-400/10 text-lime-300">
                        no contrato
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent>
                    {busy && !r ? (
                      <Skeleton className="h-28 bg-white/5" />
                    ) : !r ? (
                      <p className="text-sm text-slate-500">
                        Sem janelas fechadas neste mês.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="detail-row">
                          <span>Demanda máxima fora ponta</span>
                          <strong
                            className={
                              pct != null && pct > 105 ? 'text-amber-300' : ''
                            }
                          >
                            {fmtKw(maxFora)}
                            {pct != null ? (
                              <small className="ml-1 text-slate-500">
                                {Math.round(pct)}%
                              </small>
                            ) : null}
                          </strong>
                        </div>
                        {r.max_demand_at.fora_ponta && (
                          <p className="-mt-2 text-xs text-slate-500">
                            em {fmtDateTime(r.max_demand_at.fora_ponta, tz)}
                          </p>
                        )}
                        <div className="detail-row">
                          <span>Demanda máxima na ponta</span>
                          <strong>{fmtKw(maxPonta)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>Energia fora ponta</span>
                          <strong>{fmtKwh(r.kwh.fora_ponta ?? 0)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>Energia na ponta</span>
                          <strong>{fmtKwh(r.kwh.ponta ?? 0)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>Janelas com FP abaixo da referência</span>
                          <strong
                            className={
                              r.pf_below_windows ? 'text-amber-300' : ''
                            }
                          >
                            {r.pf_below_windows}
                          </strong>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        </>
      )}
    </AppShell>
  );
}
