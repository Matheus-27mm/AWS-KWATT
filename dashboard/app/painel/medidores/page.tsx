'use client';

import { useMemo, useState } from 'react';

import { LoadChart } from '@/components/load-chart';
import { AppShell, useSearch } from '@/components/shell';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

const STATUS: Record<
  MeterView['status'],
  { text: string; chip: string; dot: string }
> = {
  online: { text: 'Online', chip: 'chip-lime', dot: 'status-dot' },
  atencao: {
    text: 'Atenção',
    chip: 'chip-amber',
    dot: 'status-dot status-dot-warn',
  },
  critico: {
    text: 'Risco',
    chip: 'chip-crit',
    dot: 'status-dot status-dot-crit',
  },
  mudo: { text: 'Sem leitura', chip: '', dot: 'status-dot status-dot-off' },
  sem_dados: { text: 'Sem dados', chip: '', dot: 'status-dot status-dot-off' },
};

export default function MedidoresPage() {
  const { data, loading, error } = useDashboard('24h');
  const search = useSearch().trim().toLowerCase();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const meters = useMemo(
    () =>
      (data?.meters ?? []).filter(
        (m) =>
          !search ||
          m.name.toLowerCase().includes(search) ||
          m.id.includes(search),
      ),
    [data, search],
  );
  const selected = useMemo(
    () => meters.find((m) => m.id === selectedId) ?? meters[0] ?? null,
    [meters, selectedId],
  );
  const now = data?.updatedAt ?? new Date();
  const tz = data?.tenant.tz ?? 'America/Manaus';
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const recent = selected
    ? selected.windows.filter((w) => w.start >= since)
    : [];

  return (
    <AppShell
      title="Medidores"
      subtitle={
        data ? `${data.meters.length} medidores em ${data.siteName}` : undefined
      }
      data={data}
      error={error}
      loading={loading}
    >
      {!data ? (
        <Skeleton className="h-64 rounded-xl bg-white/[.04]" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,.85fr)]">
          <Card className="fade-up">
            <CardHeader>
              <CardTitle>Todos os medidores</CardTitle>
              <CardDescription>
                Selecione um para ver a curva das últimas 24 horas
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-[11px] text-[#6b7887]">
                  <tr className="border-b border-white/[.07]">
                    <th className="px-4 py-2 font-normal">Medidor</th>
                    <th className="px-3 py-2 font-normal">Estado</th>
                    <th className="px-3 py-2 text-right font-normal">Agora</th>
                    <th className="px-3 py-2 text-right font-normal">
                      Projeção
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      Contrato
                    </th>
                    <th className="px-3 py-2 text-right font-normal">FP</th>
                    <th className="px-4 py-2 text-right font-normal">
                      Última leitura
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {meters.map((m) => {
                    const s = STATUS[m.status];
                    const active = selected?.id === m.id;
                    return (
                      <tr
                        key={m.id}
                        className={`border-b border-white/[.07] transition-colors hover:bg-white/[.03] ${active ? 'bg-white/[.04]' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-label={`Selecionar ${m.name}`}
                            aria-pressed={active}
                            onClick={() => setSelectedId(m.id)}
                            className="flex w-full items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-lime-300/40 focus-visible:outline-none"
                          >
                            <span className={s.dot} />
                            <span>
                              <span className="block text-[#e6ebf0]">
                                {m.name}
                              </span>
                              <span className="block text-xs text-[#6b7887]">
                                {m.line ?? m.id} · {m.modality}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`chip ${s.chip}`}>{s.text}</span>
                        </td>
                        <td className="num px-3 py-3 text-right text-[#e6ebf0]">
                          {fmtKw(m.currentKw)}
                        </td>
                        <td
                          className={`num px-3 py-3 text-right ${m.status === 'critico' ? 'text-amber-300' : 'text-[#c7d0da]'}`}
                        >
                          {fmtKw(m.projectedKw)}
                        </td>
                        <td className="num px-3 py-3 text-right text-[#c7d0da]">
                          {fmtKw(m.contractedKw, 0)}
                        </td>
                        <td
                          className={`num px-3 py-3 text-right ${m.currentPf != null && Math.abs(m.currentPf) < data.tenant.pf_reference ? 'text-amber-300' : 'text-[#c7d0da]'}`}
                        >
                          {fmtPf(m.currentPf)}
                        </td>
                        <td className="px-4 py-3 text-right text-[#8b98a8]">
                          {m.lastReadingAt
                            ? relativeTime(m.lastReadingAt, now)
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {meters.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-sm text-[#6b7887]"
                      >
                        Nenhum medidor corresponde à busca.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {selected && (
            <Card className="fade-up" style={{ animationDelay: '80ms' }}>
              <CardHeader>
                <CardTitle>{selected.name}</CardTitle>
                <CardDescription>
                  {selected.windowStart
                    ? `Janela ${windowLabel(selected.windowStart, tz)} · ${periodLabel(selected.periodNow)}`
                    : 'sem janela aberta'}
                  {selected.secondsInWindow != null
                    ? ` · fecha em ${fmtDuration(Math.max(0, 900 - selected.secondsInWindow))}`
                    : ''}
                </CardDescription>
                <CardAction>
                  <span className={`chip ${STATUS[selected.status].chip}`}>
                    {STATUS[selected.status].text}
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <LoadChart
                  data={recent.map((w) => ({
                    start: w.start,
                    kw: Number(w.demand_kw.toFixed(1)),
                  }))}
                  contracted={selected.contractedKw}
                  tz={tz}
                  range="24h"
                  height={220}
                />
              </CardContent>
              <div className="grid grid-cols-3 gap-4 border-t border-white/[.07] px-4 pt-4">
                <div>
                  <p className="stat-label">Janelas em 24 h</p>
                  <p className="stat-value">{recent.length}</p>
                </div>
                <div>
                  <p className="stat-label">Ultrapassagens</p>
                  <p
                    className={`stat-value ${recent.some((w) => w.exceeded) ? 'text-amber-300' : ''}`}
                  >
                    {recent.filter((w) => w.exceeded).length}
                  </p>
                </div>
                <div>
                  <p className="stat-label">Energia em 24 h</p>
                  <p className="stat-value">
                    {fmtKwh(recent.reduce((s, w) => s + w.kwh, 0))}
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
