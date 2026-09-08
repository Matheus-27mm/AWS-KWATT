'use client';

// Prévia do painel para a página de entrada: o painel real em modo demonstração, reduzido e sem
// interação. Substitui a imagem estática do modelo; o que se vê é o produto, não um mock.

import { Activity, Bolt, CircleGauge, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LoadChart } from '@/components/load-chart';
import { ShareDonut } from '@/components/share-donut';
import { demoDashboard } from '@/lib/demo';
import { fmtKw, fmtNumber, fmtPf } from '@/lib/format';

const INNER_WIDTH = 1180;

function Kpi({
  label,
  value,
  unit,
  foot,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit?: string;
  foot: string;
  tone: 'lime' | 'cyan' | 'amber' | 'violet';
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="kpi-card flex items-start justify-between gap-3 p-5">
      <div>
        <p className="kpi-label">{label}</p>
        <div className="mt-2 flex items-end gap-1.5">
          <strong className="kpi-value">{value}</strong>
          {unit && <span className="mb-1 text-sm text-slate-500">{unit}</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500">{foot}</p>
      </div>
      <span className={`kpi-tile kpi-tile-${tone}`}>
        <Icon className="size-[18px]" />
      </span>
    </div>
  );
}

export function DashboardPreview() {
  const data = useMemo(() => demoDashboard('24h'), []);
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = outer.current;
    const content = inner.current;
    if (!el || !content) return;
    const measure = () => {
      const s = Math.min(1, el.clientWidth / INNER_WIDTH);
      setScale(s);
      setHeight(content.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const c = data.consolidated;
  const atRisk = c.riskyMeters.length > 0;

  return (
    <div
      ref={outer}
      className="w-full overflow-hidden"
      style={{ height: height || undefined }}
      aria-hidden
    >
      <div
        ref={inner}
        className="pointer-events-none select-none origin-top-left"
        style={{ width: INNER_WIDTH, transform: `scale(${scale})` }}
      >
        <div className="grid grid-cols-[212px_minmax(0,1fr)] rounded-xl border border-white/8 bg-[#081018] shadow-2xl">
          <div className="sidebar border-r border-white/6 px-3 py-4">
            <div className="mb-4 flex items-center gap-3 px-2">
              <span className="brand-mark" style={{ width: 32, height: 32 }}>
                <Bolt className="size-4" fill="currentColor" />
              </span>
              <span className="text-sm font-semibold text-white">KWATT</span>
            </div>
            {['Visão geral', 'Medidores', 'Análises', 'Alertas'].map(
              (label, i) => (
                <div
                  key={label}
                  className={`nav-item ${i === 0 ? 'nav-item-active' : ''}`}
                >
                  <span className="size-2 rounded-full bg-current opacity-60" />
                  <span>{label}</span>
                </div>
              ),
            )}
          </div>
          <div className="p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-base font-semibold text-white">
                  Visão geral
                </p>
                <p className="text-xs text-slate-500">
                  {atRisk
                    ? 'A fábrica está próxima do limite.'
                    : 'Operação dentro do contrato.'}{' '}
                  {data.siteName}.
                </p>
              </div>
              <span className="search-box" style={{ width: 200, height: 32 }}>
                <span className="text-xs text-slate-500">
                  Buscar medidor ou alerta
                </span>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Kpi
                label="Demanda atual"
                value={c.currentKw != null ? fmtNumber(c.currentKw) : '—'}
                unit="kW"
                foot={`${c.contractedKw != null ? Math.round(((c.currentKw ?? 0) / c.contractedKw) * 100) : 0}% do contrato`}
                tone="lime"
                icon={Zap}
              />
              <Kpi
                label="Projeção da janela"
                value={c.projectedKw != null ? fmtNumber(c.projectedKw) : '—'}
                unit="kW"
                foot={atRisk ? 'acima do contrato' : 'dentro do contrato'}
                tone={atRisk ? 'amber' : 'cyan'}
                icon={CircleGauge}
              />
              <Kpi
                label="Consumo hoje"
                value={fmtNumber(c.kwhToday, 0)}
                unit="kWh"
                foot="janelas fechadas desde a meia-noite"
                tone="violet"
                icon={Bolt}
              />
              <Kpi
                label="Fator de potência"
                value={fmtPf(c.worstPf)}
                foot={`referência ${fmtNumber(data.tenant.pf_reference, 2)}`}
                tone={
                  c.worstPf != null && c.worstPf < data.tenant.pf_reference
                    ? 'amber'
                    : 'lime'
                }
                icon={Activity}
              />
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-3">
              <div className="panel-card rounded-xl p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Curva de carga
                    </p>
                    <p className="text-xs text-slate-500">
                      Demanda consolidada por janela de 15 min
                    </p>
                  </div>
                  <span className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-xs text-slate-300">
                    Últimas 24 horas
                  </span>
                </div>
                <div className="h-[220px]">
                  <LoadChart
                    data={data.curve}
                    contracted={c.contractedKw}
                    tz={data.tenant.tz}
                    range="24h"
                    height={210}
                  />
                </div>
                <div className="mt-2 grid grid-cols-3 border-t border-white/6 pt-2">
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
                    <p className="chart-stat text-amber-300">
                      {data.curveStats ? fmtKw(data.curveStats.peak) : '—'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="panel-card rounded-xl p-4">
                <p className="text-sm font-semibold text-white">
                  Distribuição da carga
                </p>
                <p className="mb-2 text-xs text-slate-500">
                  Participação de cada medidor agora
                </p>
                <ShareDonut shares={c.shares} totalKw={c.currentKw} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
