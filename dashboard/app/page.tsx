'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bolt,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Factory,
  Radio,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react';

import { LoadChart } from '@/components/load-chart';
import { AppShell } from '@/components/shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/hooks/use-dashboard';
import {
  fmtDateLong,
  fmtDuration,
  fmtKw,
  fmtNumber,
  fmtPf,
  fmtTime,
  periodLabel,
  relativeTime,
  windowLabel,
} from '@/lib/format';
import type { Range } from '@/lib/model';

const ALL = '__todos__';

function MetricCard({
  label,
  value,
  unit,
  meta,
  icon: Icon,
  warning = false,
}: {
  label: string;
  value: string;
  unit?: string;
  meta: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  warning?: boolean;
}) {
  return (
    <Card className="metric-card border-0">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <p className="metric-label">{label}</p>
          <div className="mt-3 flex items-end gap-1.5">
            <strong className="metric-value">{value}</strong>
            {unit && (
              <span className="mb-1 text-sm font-medium text-slate-500">
                {unit}
              </span>
            )}
          </div>
        </div>
        <span className={`metric-icon ${warning ? 'metric-icon-warning' : ''}`}>
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>{meta}</CardContent>
    </Card>
  );
}

export default function Home() {
  const [range, setRange] = useState<Range>('24h');
  const [selected, setSelected] = useState<string>(ALL);
  const [ack, setAck] = useState<string[]>([]);
  const { data, loading, error } = useDashboard(range);

  const view = useMemo(() => {
    if (!data) return null;
    const tz = data.tenant.tz;
    const tolerance = data.tenant.demand_tolerance;
    const meter =
      selected === ALL
        ? null
        : (data.meters.find((m) => m.id === selected) ?? null);
    const label = meter ? meter.name : 'Visão consolidada';
    const current = meter ? meter.currentKw : data.consolidated.currentKw;
    const contracted = meter
      ? meter.contractedKw
      : data.consolidated.contractedKw;
    const projected = meter ? meter.projectedKw : data.consolidated.projectedKw;
    const since = new Date(
      data.updatedAt.getTime() - (range === '7d' ? 7 * 24 : 24) * 3600_000,
    ).toISOString();
    const curve = meter
      ? meter.windows
          .filter((w) => w.start >= since)
          .map((w) => ({ start: w.start, kw: Number(w.demand_kw.toFixed(1)) }))
      : data.curve.map((p) => ({ start: p.start, kw: p.kw }));
    const stats = curve.length
      ? {
          min: Math.min(...curve.map((p) => p.kw)),
          avg: curve.reduce((s, p) => s + p.kw, 0) / curve.length,
          peak: Math.max(...curve.map((p) => p.kw)),
        }
      : null;
    const limit = contracted != null ? contracted * (1 + tolerance) : null;
    const usage =
      current != null && contracted ? (current / contracted) * 100 : null;
    const projection =
      projected != null && contracted ? (projected / contracted) * 100 : null;
    const excess =
      projected != null && limit != null
        ? Math.max(0, projected - contracted!)
        : 0;
    const atRisk = projected != null && limit != null && projected > limit;
    const secondsIn = meter
      ? meter.secondsInWindow
      : data.consolidated.secondsInWindow;
    const windowStart = meter
      ? meter.windowStart
      : data.consolidated.windowStart;
    const period = meter ? meter.periodNow : data.consolidated.periodNow;
    const kwhToday = meter
      ? meter.windows
          .filter(
            (w) =>
              w.start >= new Date(data.updatedAt).toISOString().slice(0, 10),
          )
          .reduce((s, w) => s + w.kwh, 0)
      : data.consolidated.kwhToday;
    const pf = meter ? meter.currentPf : data.consolidated.worstPf;
    const pfMeter = meter ? null : data.consolidated.worstPfMeter;
    const headline = data.consolidated.riskyMeters.length
      ? 'A fábrica está próxima do limite.'
      : data.meters.some((m) => m.status === 'mudo')
        ? 'Há medidor sem leitura recente.'
        : data.meters.every((m) => m.status === 'sem_dados')
          ? 'Aguardando as primeiras leituras.'
          : 'Operação dentro do contrato.';
    return {
      tz,
      label,
      current,
      contracted,
      projected,
      curve,
      stats,
      usage,
      projection,
      excess,
      atRisk,
      secondsIn,
      windowStart,
      period,
      kwhToday,
      pf,
      pfMeter,
      headline,
    };
  }, [data, selected, range]);

  // WebMCP: expõe ações do painel a assistentes que rodem no navegador.
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool || !data) return;
    const lifecycle = new AbortController();
    const ids = [ALL, ...data.meters.map((m) => m.id)];
    void Promise.resolve(
      context.registerTool(
        {
          name: 'select_meter',
          title: 'Selecionar medidor',
          description:
            'Seleciona a visão consolidada ou um medidor no painel energético.',
          inputSchema: {
            type: 'object',
            properties: { meterId: { type: 'string', enum: ids } },
            required: ['meterId'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const meter = (input as { meterId?: string }).meterId;
            if (!meter || !ids.includes(meter))
              throw new Error('Medidor inválido.');
            setSelected(meter);
            return { selected: meter };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(console.error);
    return () => lifecycle.abort();
  }, [data]);

  const visibleAlerts = (data?.alerts ?? [])
    .filter((a) => !ack.includes(a.id))
    .slice(0, 6);
  const now = data?.updatedAt ?? new Date();

  return (
    <AppShell
      title="Operação energética"
      data={data}
      error={error}
      loading={loading}
      actions={
        data && (
          <Select value={selected} onValueChange={(v) => setSelected(v ?? ALL)}>
            <SelectTrigger className="h-9 w-[155px] border-white/10 bg-white/[.04] text-slate-200 sm:w-[190px]">
              <Factory className="size-4 text-slate-500" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Visão consolidada</SelectItem>
              {data.meters.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      {!data || !view ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <>
          <section className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[.18em] text-slate-500">
                <span className="h-px w-5 bg-lime-300/60" />
                {fmtDateLong(now, view.tz)} · {fmtTime(now, view.tz)}
              </div>
              <h2 className="text-2xl font-semibold tracking-[-.03em] text-white sm:text-[2rem]">
                {view.headline}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {data.consolidated.riskyMeters.length ? (
                  <>
                    A projeção indica{' '}
                    <span className="font-medium text-amber-300">
                      {fmtNumber(data.consolidated.excessKw)} kW acima
                    </span>{' '}
                    da demanda contratada em{' '}
                    {data.consolidated.riskyMeters
                      .map((m) => m.name)
                      .join(', ')}
                    .
                  </>
                ) : (
                  <>
                    {data.meters.length} medidores em {data.siteName}. Contrato
                    somado de {fmtKw(data.consolidated.contractedKw, 0)}.
                  </>
                )}
              </p>
            </div>
            <Button
              className="h-9 self-start bg-lime-300 px-4 text-[#10170b] hover:bg-lime-200 md:self-auto"
              render={<Link href="/alertas" />}
            >
              Ver alertas <ChevronRight data-icon="inline-end" />
            </Button>
          </section>

          <section
            aria-label="Indicadores principais"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <MetricCard
              label="Demanda atual"
              value={view.current != null ? fmtNumber(view.current) : '—'}
              unit="kW"
              icon={Zap}
              meta={
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  {view.usage != null ? (
                    <>
                      <span
                        className={
                          view.usage > 90 ? 'text-amber-300' : 'text-lime-300'
                        }
                      >
                        {Math.round(view.usage)}%
                      </span>{' '}
                      do contrato de {fmtKw(view.contracted, 0)}
                    </>
                  ) : (
                    'sem leitura'
                  )}
                </div>
              }
            />
            <MetricCard
              label="Projeção da janela"
              value={view.projected != null ? fmtNumber(view.projected) : '—'}
              unit="kW"
              icon={CircleGauge}
              warning={view.atRisk}
              meta={
                <div>
                  <div className="mb-2 flex justify-between text-xs text-slate-400">
                    <span>
                      {view.projection != null
                        ? `${Math.round(view.projection)}% do contrato`
                        : 'aguardando 5 min de janela'}
                    </span>
                    <span>
                      {view.secondsIn != null
                        ? `fecha em ${fmtDuration(Math.max(0, 900 - view.secondsIn))}`
                        : ''}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(view.projection ?? 0, 100)}
                    className="projection-progress"
                    aria-label={`${Math.round(view.projection ?? 0)}% do contrato`}
                  />
                </div>
              }
            />
            <MetricCard
              label="Consumo hoje"
              value={fmtNumber(view.kwhToday, 0)}
              unit="kWh"
              icon={Bolt}
              meta={
                <div className="text-xs text-slate-400">
                  Soma das janelas fechadas desde a meia-noite em{' '}
                  {view.tz.split('/')[1]}
                </div>
              }
            />
            <MetricCard
              label="Fator de potência"
              value={fmtPf(view.pf)}
              icon={Activity}
              warning={
                view.pf != null && Math.abs(view.pf) < data.tenant.pf_reference
              }
              meta={
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  {view.pf != null &&
                    Math.abs(view.pf) < data.tenant.pf_reference && (
                      <AlertTriangle className="size-3.5 text-amber-300" />
                    )}
                  Referência {fmtNumber(data.tenant.pf_reference, 2)}
                  {view.pfMeter ? ` · pior medidor: ${view.pfMeter}` : ''}
                </div>
              }
            />
          </section>

          <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,.75fr)]">
            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    Curva de carga
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Demanda por janela de 15 min · {view.label}
                  </p>
                </div>
                <div className="range-switch" aria-label="Período do gráfico">
                  {(['24h', '7d'] as Range[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRange(r)}
                      className={range === r ? 'range-active' : ''}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="h-[300px] pt-4">
                <LoadChart
                  data={view.curve}
                  contracted={view.contracted}
                  tz={view.tz}
                  range={range}
                />
              </CardContent>
              <div className="grid grid-cols-3 border-t border-white/6 px-4 py-3 sm:px-5">
                <div>
                  <p className="chart-stat-label">Mínima</p>
                  <p className="chart-stat">
                    {view.stats ? fmtKw(view.stats.min) : '—'}
                  </p>
                </div>
                <div>
                  <p className="chart-stat-label">Média</p>
                  <p className="chart-stat">
                    {view.stats ? fmtKw(view.stats.avg) : '—'}
                  </p>
                </div>
                <div>
                  <p className="chart-stat-label">Pico</p>
                  <p
                    className={`chart-stat ${view.stats && view.contracted != null && view.stats.peak > view.contracted ? 'text-amber-300' : ''}`}
                  >
                    {view.stats ? fmtKw(view.stats.peak) : '—'}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    Janela atual
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {view.windowStart
                      ? `${windowLabel(view.windowStart, view.tz)} · ${periodLabel(view.period)}`
                      : 'sem janela aberta'}
                  </p>
                </div>
                <Badge
                  className={
                    view.atRisk
                      ? 'border border-amber-400/20 bg-amber-400/10 text-amber-300'
                      : 'border border-lime-400/20 bg-lime-400/10 text-lime-300'
                  }
                >
                  {view.atRisk ? 'Risco' : 'Normal'}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div
                  className="demand-gauge mx-auto mt-3"
                  style={
                    {
                      '--gauge': `${Math.min(view.projection ?? 0, 100) * 3}deg`,
                    } as React.CSSProperties
                  }
                >
                  <div>
                    <span>
                      {view.projection != null
                        ? `${Math.round(view.projection)}%`
                        : '—'}
                    </span>
                    <small>do contrato</small>
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <div className="detail-row">
                    <span>Contratada</span>
                    <strong>{fmtKw(view.contracted)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Atual</span>
                    <strong>{fmtKw(view.current)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Projetada</span>
                    <strong className={view.atRisk ? 'text-amber-300' : ''}>
                      {fmtKw(view.projected)}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>Tolerância</span>
                    <strong>
                      {Math.round(data.tenant.demand_tolerance * 100)}%
                    </strong>
                  </div>
                </div>
                <div className="action-note mt-auto">
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-amber-300" />
                  <p>
                    {view.atRisk ? (
                      <>
                        Reduzir ao menos{' '}
                        <strong>{fmtNumber(view.excess)} kW</strong> agora
                        mantém a janela dentro da tolerância.
                      </>
                    ) : (
                      <>
                        A janela está dentro do contrato. Ultrapassagem custa o
                        dobro da tarifa de demanda.
                      </>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    Medidores
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {data.meters.length} cadastrados
                    {data.meters.some((m) => m.lastReadingAt)
                      ? ` · última leitura ${relativeTime(
                          data.meters
                            .map((m) => m.lastReadingAt)
                            .filter((x): x is string => !!x)
                            .sort()
                            .at(-1)!,
                          now,
                        )}`
                      : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:bg-white/5 hover:text-white"
                  render={<Link href="/medidores" />}
                >
                  Ver todos
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="meter-table">
                  <div className="meter-head">
                    <span>Equipamento</span>
                    <span>Carga</span>
                    <span>Potência</span>
                    <span>FP</span>
                  </div>
                  {data.meters.map((m) => (
                    <button
                      key={m.id}
                      className="meter-row"
                      type="button"
                      onClick={() => setSelected(m.id)}
                    >
                      <span className="flex items-center gap-3 text-left">
                        <span
                          className={`status-ring ${m.status === 'atencao' || m.status === 'critico' ? 'status-warning' : ''} ${m.status === 'mudo' || m.status === 'sem_dados' ? 'status-off' : ''}`}
                        >
                          <Radio className="size-3.5" />
                        </span>
                        <span>
                          <strong>{m.name}</strong>
                          <small>{m.statusText}</small>
                        </span>
                      </span>
                      <span className="load-cell">
                        <i
                          style={{ width: `${Math.min(m.loadPct ?? 0, 100)}%` }}
                        />
                        <small>
                          {m.loadPct != null ? `${m.loadPct}%` : '—'}
                        </small>
                      </span>
                      <span className="font-mono text-sm text-slate-200">
                        {fmtKw(m.currentKw)}
                      </span>
                      <span
                        className={`font-mono text-sm ${m.currentPf != null && Math.abs(m.currentPf) < data.tenant.pf_reference ? 'text-amber-300' : 'text-slate-300'}`}
                      >
                        {fmtPf(m.currentPf)}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    Alertas recentes
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Eventos que pedem atenção da operação
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-white/10 text-slate-400"
                >
                  {visibleAlerts.length} recentes
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {visibleAlerts.length ? (
                  visibleAlerts.map((a) => {
                    const Icon =
                      a.tone === 'critical' ? TriangleAlert : Activity;
                    return (
                      <div className={`alert-item alert-${a.tone}`} key={a.id}>
                        <span className="alert-icon">
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-3">
                            <strong>{a.title}</strong>
                            <time
                              dateTime={a.ts}
                              title={fmtTime(a.ts, view.tz)}
                            >
                              {relativeTime(a.ts, now)}
                            </time>
                          </div>
                          <p>
                            {a.meterName} · {a.detail}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="ack-button"
                          aria-label={`Ocultar: ${a.title}`}
                          title="Ocultar neste navegador"
                          onClick={() => setAck((x) => [...x, a.id])}
                        >
                          <Check className="size-3.5" />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="grid min-h-44 place-items-center text-center">
                    <div>
                      <ShieldCheck className="mx-auto size-7 text-lime-300" />
                      <p className="mt-3 text-sm font-medium text-slate-200">
                        Nenhum alerta
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        A operação está dentro do contrato.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </AppShell>
  );
}
