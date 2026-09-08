'use client';

// Análises: o consolidado mensal por medidor, que é o que aparece na fatura da distribuidora.

import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/shell';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

  const summary = [
    {
      label: 'Energia no mês',
      value: fmtNumber(totals.kwh, 0),
      unit: 'kWh',
      foot: `soma dos medidores · ${totals.windows} janelas`,
      warn: false,
    },
    {
      label: 'Janelas com ultrapassagem',
      value: String(totals.exceeded),
      unit: '',
      foot: 'uma basta para pagar ultrapassagem no mês',
      warn: totals.exceeded > 0,
    },
    {
      label: 'Janelas com FP baixo',
      value: String(totals.pfBelow),
      unit: '',
      foot: `abaixo de ${fmtNumber(data?.tenant.pf_reference ?? 0.92, 2)} · excedente reativo`,
      warn: totals.pfBelow > 0,
    },
    {
      label: 'Horário de ponta',
      value: data ? `${data.tenant.ponta_start}–${data.tenant.ponta_end}` : '—',
      unit: '',
      foot: `dias úteis · tolerância de ${Math.round((data?.tenant.demand_tolerance ?? 0.05) * 100)}%`,
      warn: false,
    },
  ];

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
          <SelectTrigger
            size="sm"
            className="w-[170px] border-white/10 bg-white/[.03] text-xs"
          >
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
        <Skeleton className="h-64 rounded-xl bg-white/[.04]" />
      ) : (
        <div className="space-y-4">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summary.map((s, i) => (
              <Card
                key={s.label}
                className="fade-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <CardContent>
                  <p className="label">{s.label}</p>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span
                      className={`kpi-value ${s.warn ? 'text-amber-300' : ''}`}
                    >
                      {s.value}
                    </span>
                    {s.unit && (
                      <span className="text-sm text-[#6b7887]">{s.unit}</span>
                    )}
                  </div>
                  <p className="label mt-2.5">{s.foot}</p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {data.meters.map((m, i) => {
              const r = rollups[m.id];
              const maxFora = r?.max_demand_kw.fora_ponta ?? null;
              const maxPonta = r?.max_demand_kw.ponta ?? null;
              const pct =
                maxFora != null && m.contractedKw
                  ? (maxFora / m.contractedKw) * 100
                  : null;
              return (
                <Card
                  key={m.id}
                  className="fade-up"
                  style={{ animationDelay: `${240 + i * 60}ms` }}
                >
                  <CardHeader>
                    <CardTitle>{m.name}</CardTitle>
                    <CardDescription>
                      {monthLabel(activeMonth)} · contrato{' '}
                      {fmtKw(m.contractedKw, 0)}
                    </CardDescription>
                    <CardAction>
                      {r && r.exceeded_windows > 0 ? (
                        <span className="chip chip-amber">
                          {r.exceeded_windows} ultrapass.
                        </span>
                      ) : (
                        <span className="chip chip-lime">no contrato</span>
                      )}
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    {busy && !r ? (
                      <Skeleton className="h-28 bg-white/[.04]" />
                    ) : !r ? (
                      <p className="text-sm text-[#6b7887]">
                        Sem janelas fechadas neste mês.
                      </p>
                    ) : (
                      <div>
                        <div className="detail-row">
                          <span>Demanda máxima fora ponta</span>
                          <strong
                            className={
                              pct != null && pct > 105 ? 'text-amber-300' : ''
                            }
                          >
                            {fmtKw(maxFora)}
                            {pct != null && (
                              <span className="ml-1.5 text-xs font-normal text-[#6b7887]">
                                {Math.round(pct)}%
                              </span>
                            )}
                          </strong>
                        </div>
                        {r.max_demand_at.fora_ponta && (
                          <p className="-mt-1 pb-2 text-[11px] text-[#6b7887]">
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
        </div>
      )}
    </AppShell>
  );
}
