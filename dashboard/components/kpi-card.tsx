'use client';

// Cartão de indicador: rótulo, valor com contagem animada, ícone tonal e uma linha de contexto.

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useCountUp } from '@/hooks/use-count-up';
import { fmtNumber } from '@/lib/format';

export type Tone = 'lime' | 'cyan' | 'amber' | 'violet';

export function Delta({
  pct,
  suffix,
  invert = false,
}: {
  pct: number | null;
  suffix: string;
  invert?: boolean;
}) {
  if (pct == null) return <span className="label">sem comparativo</span>;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-1 text-xs">
      <span
        className={`flex items-center gap-0.5 num ${good ? 'text-lime-300' : 'text-amber-300'}`}
      >
        <Icon className="size-3.5" />
        {up ? '+' : ''}
        {fmtNumber(pct, 1)}%
      </span>
      <span className="text-[#6b7887]">{suffix}</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  digits = 1,
  unit,
  icon: Icon,
  tone,
  foot,
  delay = 0,
  animate = true,
}: {
  label: string;
  value: number | null;
  digits?: number;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  foot: React.ReactNode;
  delay?: number;
  animate?: boolean;
}) {
  const shown = useCountUp(value);
  const display = animate ? shown : value;
  return (
    <Card
      className={animate ? 'fade-up' : ''}
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">{label}</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="kpi-value">
              {display == null ? '—' : fmtNumber(display, digits)}
            </span>
            {unit && <span className="text-sm text-[#6b7887]">{unit}</span>}
          </div>
          <div className="mt-2.5 text-xs">{foot}</div>
        </div>
        <span className={`kpi-tile kpi-tile-${tone}`}>
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}
