'use client';

// Prévia do painel para a página de entrada: o painel real em modo demonstração, reduzido e sem
// interação. O que se vê é o produto, não um mock.

import { Activity, Bolt, CircleGauge, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { KpiCard } from '@/components/kpi-card';
import { LoadChart } from '@/components/load-chart';
import { ShareDonut } from '@/components/share-donut';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { demoDashboard } from '@/lib/demo';
import { fmtNumber } from '@/lib/format';

const INNER_WIDTH = 1180;

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
  const pfLow = c.worstPf != null && c.worstPf < data.tenant.pf_reference;

  return (
    <div
      ref={outer}
      className="w-full overflow-hidden"
      style={{ height: height || undefined }}
      aria-hidden
    >
      <div
        ref={inner}
        className="pointer-events-none origin-top-left select-none"
        style={{ width: INNER_WIDTH, transform: `scale(${scale})` }}
      >
        <div className="grid grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-xl border border-white/[.08] bg-[#0b1117] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="sidebar border-r border-white/[.07] px-3 py-3">
            <div className="mb-3 flex h-10 items-center gap-3 px-1">
              <span className="brand-mark">
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
                  <span className="size-1.5 rounded-full bg-current opacity-60" />
                  <span>{label}</span>
                </div>
              ),
            )}
          </div>
          <div className="p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-[17px] font-semibold text-white">
                  Visão geral
                </p>
                <p className="text-xs text-[#6b7887]">
                  {atRisk
                    ? 'Fábrica próxima do limite'
                    : 'Operação dentro do contrato'}{' '}
                  · {data.siteName}
                </p>
              </div>
              <span className="search-box" style={{ width: 200, height: 32 }}>
                <span className="text-xs text-[#6b7887]">
                  Buscar medidor ou alerta
                </span>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <KpiCard
                label="Demanda atual"
                value={c.currentKw}
                unit="kW"
                icon={Zap}
                tone="lime"
                animate={false}
                foot={
                  <span className="label">
                    {c.contractedKw != null
                      ? `${Math.round(((c.currentKw ?? 0) / c.contractedKw) * 100)}% do contrato`
                      : ''}
                  </span>
                }
              />
              <KpiCard
                label="Projeção da janela"
                value={c.projectedKw}
                unit="kW"
                icon={CircleGauge}
                tone={atRisk ? 'amber' : 'cyan'}
                animate={false}
                foot={
                  <span className="label">
                    {atRisk ? 'acima do contrato' : 'dentro do contrato'}
                  </span>
                }
              />
              <KpiCard
                label="Consumo hoje"
                value={c.kwhToday}
                digits={0}
                unit="kWh"
                icon={Bolt}
                tone="violet"
                animate={false}
                foot={
                  <span className="label">
                    janelas fechadas desde a meia-noite
                  </span>
                }
              />
              <KpiCard
                label="Fator de potência"
                value={c.worstPf != null ? Math.abs(c.worstPf) : null}
                digits={2}
                icon={Activity}
                tone={pfLow ? 'amber' : 'lime'}
                animate={false}
                foot={
                  <span className="label">
                    referência {fmtNumber(data.tenant.pf_reference, 2)}
                  </span>
                }
              />
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
              <Card>
                <CardHeader>
                  <CardTitle>Curva de carga</CardTitle>
                  <CardDescription>
                    Demanda consolidada por janela de 15 min
                  </CardDescription>
                  <CardAction>
                    <span className="chip">Últimas 24 horas</span>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <LoadChart
                    data={data.curve}
                    contracted={c.contractedKw}
                    tz={data.tenant.tz}
                    range="24h"
                    height={200}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Distribuição da carga</CardTitle>
                  <CardDescription>
                    Participação de cada medidor agora
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 items-center">
                  <ShareDonut
                    shares={c.shares}
                    totalKw={c.currentKw}
                    height={170}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
