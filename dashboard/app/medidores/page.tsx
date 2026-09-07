'use client';

import { useMemo, useState } from 'react';
import { Radio } from 'lucide-react';

import { LoadChart } from '@/components/load-chart';
import { AppShell } from '@/components/shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/hooks/use-dashboard';
import {
  fmtDuration,
  fmtKw,
  fmtKwh,
  fmtPf,
  periodLabel,
  relativeTime,
  windowLabel,
} from '@/lib/format';
import type { MeterView } from '@/lib/model';

const STATUS_BADGE: Record<
  MeterView['status'],
  { text: string; className: string }
> = {
  online: {
    text: 'Online',
    className: 'border-lime-400/20 bg-lime-400/10 text-lime-300',
  },
  atencao: {
    text: 'Atenção',
    className: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  },
  critico: {
    text: 'Risco',
    className: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
  },
  mudo: {
    text: 'Sem leitura',
    className: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
  },
  sem_dados: {
    text: 'Sem dados',
    className: 'border-slate-400/20 bg-slate-400/10 text-slate-400',
  },
};

export default function MedidoresPage() {
  const { data, loading, error } = useDashboard('24h');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () =>
      data?.meters.find((m) => m.id === selectedId) ?? data?.meters[0] ?? null,
    [data, selectedId],
  );
  const now = data?.updatedAt ?? new Date();
  const tz = data?.tenant.tz ?? 'America/Manaus';
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();

  return (
    <AppShell title="Medidores" data={data} error={error} loading={loading}>
      {!data ? (
        <Skeleton className="h-64 rounded-xl bg-white/5" />
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.9fr)]">
          <Card className="panel-card border-0">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-white">
                {data.meters.length} medidores em {data.siteName}
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Toque num medidor para ver a curva das últimas 24 horas.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr className="border-b border-white/6">
                    <th className="px-5 py-3 font-medium">Medidor</th>
                    <th className="px-3 py-3 font-medium">Estado</th>
                    <th className="px-3 py-3 text-right font-medium">Agora</th>
                    <th className="px-3 py-3 text-right font-medium">
                      Projeção
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      Contrato
                    </th>
                    <th className="px-3 py-3 text-right font-medium">FP</th>
                    <th className="px-5 py-3 text-right font-medium">
                      Última leitura
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.meters.map((m) => {
                    const badge = STATUS_BADGE[m.status];
                    const active = selected?.id === m.id;
                    return (
                      <tr
                        key={m.id}
                        className={`border-b border-white/6 transition-colors hover:bg-white/[.03] ${active ? 'bg-white/[.04]' : ''}`}
                      >
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            aria-label={`Selecionar ${m.name}`}
                            aria-pressed={active}
                            onClick={() => setSelectedId(m.id)}
                            className="flex w-full items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/40"
                          >
                            <span
                              className={`status-ring ${m.status === 'atencao' || m.status === 'critico' ? 'status-warning' : ''}`}
                            >
                              <Radio className="size-3.5" />
                            </span>
                            <span>
                              <span className="block font-medium text-slate-100">
                                {m.name}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {m.line ?? m.id} · modalidade {m.modality}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            className={`border text-[11px] ${badge.className}`}
                          >
                            {badge.text}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-200">
                          {fmtKw(m.currentKw)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-mono ${m.status === 'critico' ? 'text-amber-300' : 'text-slate-300'}`}
                        >
                          {fmtKw(m.projectedKw)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-300">
                          {fmtKw(m.contractedKw, 0)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-mono ${m.currentPf != null && Math.abs(m.currentPf) < data.tenant.pf_reference ? 'text-amber-300' : 'text-slate-300'}`}
                        >
                          {fmtPf(m.currentPf)}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-400">
                          {m.lastReadingAt
                            ? relativeTime(m.lastReadingAt, now)
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {selected && (
            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    {selected.name}
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.windowStart
                      ? `Janela ${windowLabel(selected.windowStart, tz)} · ${periodLabel(selected.periodNow)}`
                      : 'sem janela aberta'}
                    {selected.secondsInWindow != null
                      ? ` · fecha em ${fmtDuration(Math.max(0, 900 - selected.secondsInWindow))}`
                      : ''}
                  </p>
                </div>
                <Badge
                  className={`border text-[11px] ${STATUS_BADGE[selected.status].className}`}
                >
                  {STATUS_BADGE[selected.status].text}
                </Badge>
              </CardHeader>
              <CardContent className="h-[260px] pt-2">
                <LoadChart
                  data={selected.windows
                    .filter((w) => w.start >= since)
                    .map((w) => ({
                      start: w.start,
                      kw: Number(w.demand_kw.toFixed(1)),
                    }))}
                  contracted={selected.contractedKw}
                  tz={tz}
                  range="24h"
                  height={240}
                />
              </CardContent>
              <div className="grid grid-cols-3 gap-2 border-t border-white/6 px-5 py-4 text-sm">
                <div>
                  <p className="chart-stat-label">Janelas em 24 h</p>
                  <p className="chart-stat">
                    {selected.windows.filter((w) => w.start >= since).length}
                  </p>
                </div>
                <div>
                  <p className="chart-stat-label">Ultrapassagens</p>
                  <p
                    className={`chart-stat ${selected.windows.some((w) => w.exceeded && w.start >= since) ? 'text-amber-300' : ''}`}
                  >
                    {
                      selected.windows.filter(
                        (w) => w.exceeded && w.start >= since,
                      ).length
                    }
                  </p>
                </div>
                <div>
                  <p className="chart-stat-label">Energia em 24 h</p>
                  <p className="chart-stat">
                    {fmtKwh(
                      selected.windows
                        .filter((w) => w.start >= since)
                        .reduce((s, w) => s + w.kwh, 0),
                    )}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
