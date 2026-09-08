'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bolt,
  Check,
  CircleGauge,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react';

import { Delta, KpiCard } from '@/components/kpi-card';
import { LoadChart } from '@/components/load-chart';
import { ShareDonut } from '@/components/share-donut';
import { AppShell, useSearch } from '@/components/shell';
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
import type { DashboardData, MeterView, Range } from '@/lib/model';

const RANGE_ITEMS: Record<Range, string> = {
  '24h': 'Últimas 24 horas',
  '7d': 'Últimos 7 dias',
};

function headline(data: DashboardData): string {
  if (data.consolidated.riskyMeters.length) return 'Fábrica próxima do limite';
  if (data.meters.some((m) => m.status === 'mudo'))
    return 'Medidor sem leitura recente';
  if (data.meters.every((m) => m.status === 'sem_dados'))
    return 'Aguardando as primeiras leituras';
  return 'Operação dentro do contrato';
}

function dotClass(status: MeterView['status']): string {
  if (status === 'critico') return 'status-dot status-dot-crit';
  if (status === 'atencao') return 'status-dot status-dot-warn';
  if (status === 'mudo' || status === 'sem_dados')
    return 'status-dot status-dot-off';
  return 'status-dot';
}

export default function Home() {
  const [range, setRange] = useState<Range>('24h');
  const [hidden, setHidden] = useState<string[]>([]);
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
  const excess =
    atRisk && c?.projectedKw != null && c.contractedKw != null
      ? c.projectedKw - c.contractedKw
      : 0;
  const pfLow =
    c?.worstPf != null &&
    data != null &&
    Math.abs(c.worstPf) < data.tenant.pf_reference;

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
  const alerts = useMemo(
    () =>
      (data?.alerts ?? [])
        .filter((a) => !hidden.includes(a.id))
        .filter(
          (a) =>
            !search ||
            a.meterName.toLowerCase().includes(search) ||
            a.title.toLowerCase().includes(search),
        )
        .slice(0, 5),
    [data, hidden, search],
  );

  // WebMCP: expõe uma ação do painel a assistentes que rodem no navegador.
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
          ? `${headline(data)} · ${fmtDateLong(now, tz)}, ${fmtTime(now, tz)}`
          : undefined
      }
      data={data}
      error={error}
      loading={loading}
    >
      {!data || !c ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl bg-white/[.04]" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <section
            aria-label="Indicadores principais"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <KpiCard
              label="Demanda atual"
              value={c.currentKw}
              unit="kW"
              icon={Zap}
              tone="lime"
              delay={0}
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
              value={c.projectedKw}
              unit="kW"
              icon={CircleGauge}
              tone={atRisk ? 'amber' : 'cyan'}
              delay={60}
              foot={
                projectionPct != null ? (
                  <span className="flex items-center gap-1">
                    <span
                      className={`num ${atRisk ? 'text-amber-300' : 'text-lime-300'}`}
                    >
                      {Math.round(projectionPct)}% do contrato
                    </span>
                    {c.secondsInWindow != null && (
                      <span className="text-[#6b7887]">
                        · fecha em{' '}
                        {fmtDuration(Math.max(0, 900 - c.secondsInWindow))}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="label">aguardando 5 min de janela</span>
                )
              }
            />
            <KpiCard
              label="Consumo hoje"
              value={c.kwhToday}
              digits={0}
              unit="kWh"
              icon={Bolt}
              tone="violet"
              delay={120}
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
              value={c.worstPf != null ? Math.abs(c.worstPf) : null}
              digits={2}
              icon={Activity}
              tone={pfLow ? 'amber' : 'lime'}
              delay={180}
              foot={
                <span className={pfLow ? 'text-amber-300' : 'label'}>
                  referência {fmtNumber(data.tenant.pf_reference, 2)}
                  {c.worstPfMeter ? ` · ${c.worstPfMeter}` : ''}
                </span>
              }
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)]">
            <Card className="fade-up" style={{ animationDelay: '240ms' }}>
              <CardHeader>
                <CardTitle>Curva de carga</CardTitle>
                <CardDescription>
                  Demanda consolidada por janela de 15 min
                </CardDescription>
                <CardAction>
                  <Select
                    items={RANGE_ITEMS}
                    value={range}
                    onValueChange={(v) => setRange((v as Range) ?? '24h')}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[150px] border-white/10 bg-white/[.03] text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">Últimas 24 horas</SelectItem>
                      <SelectItem value="7d">Últimos 7 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </CardAction>
              </CardHeader>
              <CardContent>
                <LoadChart
                  data={data.curve.map((p) => ({ start: p.start, kw: p.kw }))}
                  contracted={c.contractedKw}
                  tz={tz}
                  range={range}
                  height={260}
                />
              </CardContent>
              <div className="grid grid-cols-3 gap-4 border-t border-white/[.07] px-4 pt-4">
                <div>
                  <p className="stat-label">Mínima</p>
                  <p className="stat-value">
                    {data.curveStats ? fmtKw(data.curveStats.min) : '—'}
                  </p>
                </div>
                <div>
                  <p className="stat-label">Média</p>
                  <p className="stat-value">
                    {data.curveStats ? fmtKw(data.curveStats.avg) : '—'}
                  </p>
                </div>
                <div>
                  <p className="stat-label">Pico</p>
                  <p
                    className={`stat-value ${data.curveStats && c.contractedKw != null && data.curveStats.peak > c.contractedKw ? 'text-amber-300' : ''}`}
                  >
                    {data.curveStats ? fmtKw(data.curveStats.peak) : '—'}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="fade-up" style={{ animationDelay: '300ms' }}>
              <CardHeader>
                <CardTitle>Distribuição da carga</CardTitle>
                <CardDescription>
                  Participação de cada medidor agora
                </CardDescription>
                <CardAction>
                  <Link
                    href="/painel/medidores"
                    className="text-xs text-[#8b98a8] hover:text-white"
                  >
                    Ver todos
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 items-center">
                <ShareDonut shares={c.shares} totalKw={c.currentKw} />
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)]">
            <Card className="fade-up" style={{ animationDelay: '360ms' }}>
              <CardHeader>
                <CardTitle>Medidores</CardTitle>
                <CardDescription>
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
                </CardDescription>
                <CardAction>
                  <Link
                    href="/painel/medidores"
                    className="text-xs text-[#8b98a8] hover:text-white"
                  >
                    Ver todos
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="row-list -mx-4">
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(90px,1fr)_88px_56px] items-center gap-4 px-4 pb-2 text-[11px] text-[#6b7887]">
                    <span>Equipamento</span>
                    <span>Carga</span>
                    <span className="text-right">Potência</span>
                    <span className="text-right">FP</span>
                  </div>
                  {meters.length === 0 && (
                    <p className="px-4 py-6 text-sm text-[#6b7887]">
                      Nenhum medidor corresponde à busca.
                    </p>
                  )}
                  {meters.map((m) => (
                    <Link
                      key={m.id}
                      href="/painel/medidores"
                      className="grid grid-cols-[minmax(0,1.4fr)_minmax(90px,1fr)_88px_56px] items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[.03]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={dotClass(m.status)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-[#e6ebf0]">
                            {m.name}
                          </span>
                          <span className="block truncate text-xs text-[#6b7887]">
                            {m.statusText}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className={`load-bar ${m.status === 'atencao' || m.status === 'critico' ? 'load-bar-warn' : ''}`}
                        >
                          <i
                            style={{
                              width: `${Math.min(m.loadPct ?? 0, 100)}%`,
                            }}
                          />
                        </span>
                        <span className="num w-9 text-right text-xs text-[#8b98a8]">
                          {m.loadPct != null ? `${m.loadPct}%` : '—'}
                        </span>
                      </span>
                      <span className="num text-right text-sm text-[#e6ebf0]">
                        {fmtKw(m.currentKw)}
                      </span>
                      <span
                        className={`num text-right text-sm ${m.currentPf != null && Math.abs(m.currentPf) < data.tenant.pf_reference ? 'text-amber-300' : 'text-[#c7d0da]'}`}
                      >
                        {fmtPf(m.currentPf)}
                      </span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card className="fade-up" style={{ animationDelay: '420ms' }}>
                <CardHeader>
                  <CardTitle>Janela atual</CardTitle>
                  <CardDescription>
                    {c.windowStart
                      ? `${windowLabel(c.windowStart, tz)} · ${periodLabel(c.periodNow)}`
                      : 'sem janela aberta'}
                  </CardDescription>
                  <CardAction>
                    <span
                      className={`chip ${atRisk ? 'chip-amber' : 'chip-lime'}`}
                    >
                      {atRisk ? 'Risco' : 'Normal'}
                    </span>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="load-bar">
                    <i
                      className={atRisk ? 'bg-amber-300' : ''}
                      style={{
                        width: `${Math.min(projectionPct ?? 0, 100)}%`,
                        background: atRisk ? '#fbbf24' : undefined,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-[#6b7887]">
                    <span>0%</span>
                    <span className="num">
                      {projectionPct != null
                        ? `${Math.round(projectionPct)}% do contrato`
                        : '—'}
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="detail-row">
                      <span>Contratada</span>
                      <strong>{fmtKw(c.contractedKw, 0)}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Atual</span>
                      <strong>{fmtKw(c.currentKw)}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Projetada</span>
                      <strong className={atRisk ? 'text-amber-300' : ''}>
                        {fmtKw(c.projectedKw)}
                      </strong>
                    </div>
                  </div>
                  <div className={`note mt-4 ${atRisk ? 'note-warn' : ''}`}>
                    <p>
                      {atRisk ? (
                        <>
                          Reduzir <strong>{fmtNumber(excess)} kW</strong> agora
                          mantém a janela dentro da tolerância de{' '}
                          {Math.round(tolerance * 100)}%.
                        </>
                      ) : (
                        <>
                          Dentro do contrato. Uma janela acima da tolerância
                          custa o dobro da tarifa de demanda no mês.
                        </>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="fade-up" style={{ animationDelay: '480ms' }}>
                <CardHeader>
                  <CardTitle>Alertas recentes</CardTitle>
                  <CardDescription>Eventos que pedem atenção</CardDescription>
                  <CardAction>
                    <Link
                      href="/painel/alertas"
                      className="text-xs text-[#8b98a8] hover:text-white"
                    >
                      Ver todos
                    </Link>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alerts.length ? (
                    alerts.map((a) => {
                      const Icon =
                        a.tone === 'critical' ? TriangleAlert : Activity;
                      return (
                        <div
                          className={`alert-row alert-row-${a.tone}`}
                          key={a.id}
                        >
                          <Icon
                            className={`mt-0.5 size-4 shrink-0 ${a.tone === 'critical' ? 'text-rose-400' : 'text-amber-300'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
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
                            className="icon-button -mr-2 size-7"
                            aria-label={`Ocultar: ${a.title}`}
                            title="Ocultar neste navegador"
                            onClick={() => setHidden((x) => [...x, a.id])}
                          >
                            <Check className="size-3.5" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="grid min-h-24 place-items-center text-center">
                      <div>
                        <ShieldCheck className="mx-auto size-5 text-lime-300" />
                        <p className="mt-2 text-sm text-[#c7d0da]">
                          Nenhum alerta
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
