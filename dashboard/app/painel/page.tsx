'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bolt,
  Check,
  CircleGauge,
  Clock3,
  Radio,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react';

import { LoadChart } from '@/components/load-chart';
import { ShareDonut } from '@/components/share-donut';
import { AppShell, useSearch } from '@/components/shell';
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
import type { DashboardData, Range } from '@/lib/model';

type Tone = 'lime' | 'cyan' | 'amber' | 'violet';

function Delta({
  pct,
  suffix,
  invert = false,
}: {
  pct: number | null;
  suffix: string;
  invert?: boolean;
}) {
  if (pct == null)
    return <span className="text-slate-500">sem comparativo</span>;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`flex items-center gap-1 ${good ? 'text-lime-300' : 'text-amber-300'}`}
    >
      <Icon className="size-3.5" />
      {up ? '+' : ''}
      {fmtNumber(pct, 1)}% <span className="text-slate-500">{suffix}</span>
    </span>
  );
}

function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
  foot,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  foot: React.ReactNode;
}) {
  return (
    <Card className="kpi-card border-0">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="kpi-label">{label}</p>
          <div className="mt-2 flex items-end gap-1.5">
            <strong className="kpi-value">{value}</strong>
            {unit && (
              <span className="mb-1 text-sm font-medium text-slate-500">
                {unit}
              </span>
            )}
          </div>
          <div className="mt-2 text-xs">{foot}</div>
        </div>
        <span className={`kpi-tile kpi-tile-${tone}`}>
          <Icon className="size-[18px]" />
        </span>
      </CardContent>
    </Card>
  );
}

function headline(data: DashboardData): string {
  if (data.consolidated.riskyMeters.length)
    return 'A fábrica está próxima do limite.';
  if (data.meters.some((m) => m.status === 'mudo'))
    return 'Há medidor sem leitura recente.';
  if (data.meters.every((m) => m.status === 'sem_dados'))
    return 'Aguardando as primeiras leituras.';
  return 'Operação dentro do contrato.';
}

export default function Home() {
  const [range, setRange] = useState<Range>('24h');
  const [ack, setAck] = useState<string[]>([]);
  const { data, loading, error } = useDashboard(range);
  const search = useSearch().trim().toLowerCase();

  const c = data?.consolidated;
  const tz = data?.tenant.tz ?? 'America/Manaus';
  const now = data?.updatedAt ?? new Date();
  const tolerance = data?.tenant.demand_tolerance ?? 0.05;
  const limit =
    c?.contractedKw != null ? c.contractedKw * (1 + tolerance) : null;
  const atRisk =
    c?.projectedKw != null && limit != null && c.projectedKw > limit;
  const projectionPct =
    c?.projectedKw != null && c.contractedKw
      ? (c.projectedKw / c.contractedKw) * 100
      : null;
  const usagePct =
    c?.currentKw != null && c.contractedKw
      ? (c.currentKw / c.contractedKw) * 100
      : null;
  const excess =
    atRisk && c?.projectedKw != null && c.contractedKw != null
      ? c.projectedKw - c.contractedKw
      : 0;

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
  const visibleAlerts = useMemo(
    () =>
      (data?.alerts ?? [])
        .filter((a) => !ack.includes(a.id))
        .filter(
          (a) =>
            !search ||
            a.meterName.toLowerCase().includes(search) ||
            a.title.toLowerCase().includes(search),
        )
        .slice(0, 5),
    [data, ack, search],
  );

  // WebMCP: expõe ações do painel a assistentes que rodem no navegador.
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool || !data) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'set_range',
          title: 'Definir período do gráfico',
          description:
            'Escolhe 24h ou 7d para a curva de carga do painel energético.',
          inputSchema: {
            type: 'object',
            properties: { range: { type: 'string', enum: ['24h', '7d'] } },
            required: ['range'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const r = (input as { range?: string }).range;
            if (r !== '24h' && r !== '7d') throw new Error('Período inválido.');
            setRange(r);
            return { range: r };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(console.error);
    return () => lifecycle.abort();
  }, [data]);

  return (
    <AppShell
      title="Visão geral"
      subtitle={
        data
          ? `${headline(data)} ${fmtDateLong(now, tz)}, ${fmtTime(now, tz)}.`
          : undefined
      }
      data={data}
      error={error}
      loading={loading}
    >
      {!data || !c ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <>
          <section
            aria-label="Indicadores principais"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <KpiCard
              label="Demanda atual"
              value={c.currentKw != null ? fmtNumber(c.currentKw) : '—'}
              unit="kW"
              icon={Zap}
              tone="lime"
              foot={
                <Delta
                  pct={c.currentDeltaPct}
                  suffix="contra uma hora atrás"
                  invert
                />
              }
            />
            <KpiCard
              label="Projeção da janela"
              value={c.projectedKw != null ? fmtNumber(c.projectedKw) : '—'}
              unit="kW"
              icon={CircleGauge}
              tone={atRisk ? 'amber' : 'cyan'}
              foot={
                projectionPct != null ? (
                  <span className={atRisk ? 'text-amber-300' : 'text-lime-300'}>
                    {Math.round(projectionPct)}% do contrato
                    <span className="text-slate-500">
                      {c.secondsInWindow != null
                        ? ` · fecha em ${fmtDuration(Math.max(0, 900 - c.secondsInWindow))}`
                        : ''}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500">
                    aguardando 5 min de janela
                  </span>
                )
              }
            />
            <KpiCard
              label="Consumo hoje"
              value={fmtNumber(c.kwhToday, 0)}
              unit="kWh"
              icon={Bolt}
              tone="violet"
              foot={
                <Delta
                  pct={c.kwhTodayDeltaPct}
                  suffix="contra ontem até agora"
                  invert
                />
              }
            />
            <KpiCard
              label="Fator de potência"
              value={fmtPf(c.worstPf)}
              icon={Activity}
              tone={
                c.worstPf != null &&
                Math.abs(c.worstPf) < data.tenant.pf_reference
                  ? 'amber'
                  : 'lime'
              }
              foot={
                <span
                  className={
                    c.worstPf != null &&
                    Math.abs(c.worstPf) < data.tenant.pf_reference
                      ? 'text-amber-300'
                      : 'text-slate-500'
                  }
                >
                  referência {fmtNumber(data.tenant.pf_reference, 2)}
                  {c.worstPfMeter ? ` · ${c.worstPfMeter}` : ''}
                </span>
              }
            />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    Curva de carga
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Demanda consolidada por janela de 15 min
                  </p>
                </div>
                <Select
                  value={range}
                  onValueChange={(v) => setRange((v as Range) ?? '24h')}
                >
                  <SelectTrigger className="h-8 w-[150px] border-white/10 bg-white/[.04] text-xs text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">Últimas 24 horas</SelectItem>
                    <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="h-[280px] pt-2">
                <LoadChart
                  data={data.curve.map((p) => ({ start: p.start, kw: p.kw }))}
                  contracted={c.contractedKw}
                  tz={tz}
                  range={range}
                  height={270}
                />
              </CardContent>
              <div className="grid grid-cols-3 border-t border-white/6 px-5 py-3">
                <div>
                  <p className="chart-stat-label">Mínima</p>
                  <p className="chart-stat">
                    {data.curveStats ? fmtKw(data.curveStats.min) : '—'}
                  </p>
                </div>
                <div>
                  <p className="chart-stat-label">Média</p>
                  <p className="chart-stat">
                    {data.curveStats ? fmtKw(data.curveStats.avg) : '—'}
                  </p>
                </div>
                <div>
                  <p className="chart-stat-label">Pico</p>
                  <p
                    className={`chart-stat ${data.curveStats && c.contractedKw != null && data.curveStats.peak > c.contractedKw ? 'text-amber-300' : ''}`}
                  >
                    {data.curveStats ? fmtKw(data.curveStats.peak) : '—'}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="panel-card border-0">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-white">
                    Distribuição da carga
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Participação de cada medidor na demanda agora
                  </p>
                </div>
                <Link
                  href="/painel/medidores"
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Ver todos
                </Link>
              </CardHeader>
              <CardContent className="pt-2">
                <ShareDonut shares={c.shares} totalKw={c.currentKw} />
              </CardContent>
            </Card>
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
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
                  render={<Link href="/painel/medidores" />}
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
                  {meters.length === 0 && (
                    <p className="px-5 py-6 text-sm text-slate-500">
                      Nenhum medidor corresponde à busca.
                    </p>
                  )}
                  {meters.map((m) => (
                    <Link
                      key={m.id}
                      href="/painel/medidores"
                      className="meter-row"
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
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card className="panel-card border-0">
                <CardHeader className="flex-row items-start justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold text-white">
                      Janela atual
                    </CardTitle>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.windowStart
                        ? `${windowLabel(c.windowStart, tz)} · ${periodLabel(c.periodNow)}`
                        : 'sem janela aberta'}
                    </p>
                  </div>
                  <Badge
                    className={
                      atRisk
                        ? 'border border-amber-400/20 bg-amber-400/10 text-amber-300'
                        : 'border border-lime-400/20 bg-lime-400/10 text-lime-300'
                    }
                  >
                    {atRisk ? 'Risco' : 'Normal'}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 flex justify-between text-xs text-slate-400">
                    <span>
                      uso {usagePct != null ? `${Math.round(usagePct)}%` : '—'}
                    </span>
                    <span>
                      projeção{' '}
                      {projectionPct != null
                        ? `${Math.round(projectionPct)}%`
                        : '—'}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(projectionPct ?? 0, 100)}
                    className="projection-progress"
                    aria-label="Projeção em relação ao contrato"
                  />
                  <div className="mt-4 space-y-2.5">
                    <div className="detail-row">
                      <span>Contratada</span>
                      <strong>{fmtKw(c.contractedKw, 0)}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Projetada</span>
                      <strong className={atRisk ? 'text-amber-300' : ''}>
                        {fmtKw(c.projectedKw)}
                      </strong>
                    </div>
                  </div>
                  <div className="action-note mt-4">
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-amber-300" />
                    <p>
                      {atRisk ? (
                        <>
                          Reduzir ao menos{' '}
                          <strong>{fmtNumber(excess)} kW</strong> agora mantém a
                          janela dentro da tolerância.
                        </>
                      ) : (
                        <>
                          Dentro do contrato. Ultrapassagem custa o dobro da
                          tarifa de demanda.
                        </>
                      )}
                    </p>
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
                      Eventos que pedem atenção
                    </p>
                  </div>
                  <Link
                    href="/painel/alertas"
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Ver todos
                  </Link>
                </CardHeader>
                <CardContent className="space-y-2">
                  {visibleAlerts.length ? (
                    visibleAlerts.map((a) => {
                      const Icon =
                        a.tone === 'critical' ? TriangleAlert : Activity;
                      return (
                        <div
                          className={`alert-item alert-${a.tone}`}
                          key={a.id}
                        >
                          <span className="alert-icon">
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between gap-3">
                              <strong>{a.title}</strong>
                              <time dateTime={a.ts} title={fmtTime(a.ts, tz)}>
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
                    <div className="grid min-h-28 place-items-center text-center">
                      <div>
                        <ShieldCheck className="mx-auto size-6 text-lime-300" />
                        <p className="mt-2 text-sm text-slate-300">
                          Nenhum alerta
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
