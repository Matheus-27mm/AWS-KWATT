'use client';

// Rosca com a participação de cada medidor na demanda atual. Anima só na primeira renderização.

import { useState } from 'react';
import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { fmtKw, fmtNumber } from '@/lib/format';
import { useReducedMotion } from '@/lib/prefs';

export const SHARE_COLORS = [
  '#b8ff65',
  '#22d3ee',
  '#fbbf24',
  '#a78bfa',
  '#f472b6',
  '#64748b',
];

export type Share = { id: string; name: string; kw: number; pct: number };

function Tip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Share }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#141c25] px-3 py-2 shadow-xl">
      <p className="text-[11px] text-[#8b98a8]">{item.name}</p>
      <p className="num mt-1 text-sm font-medium text-white">
        {fmtKw(item.kw)} · {fmtNumber(item.pct, 0)}%
      </p>
    </div>
  );
}

export function ShareDonut({
  shares,
  totalKw,
  height = 200,
}: {
  shares: Share[];
  totalKw: number | null;
  height?: number;
}) {
  const reduced = useReducedMotion();
  const [animate, setAnimate] = useState(true);

  const slices = shares.map((s, i) => ({
    ...s,
    fill: SHARE_COLORS[i % SHARE_COLORS.length],
  }));
  if (!shares.length) {
    return (
      <div className="grid min-h-[200px] w-full place-items-center text-sm text-[#6b7887]">
        Sem leituras para distribuir.
      </div>
    );
  }
  return (
    <div className="grid w-full items-center gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(160px,auto)]">
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="kw"
              nameKey="name"
              innerRadius="70%"
              outerRadius="100%"
              paddingAngle={3}
              cornerRadius={3}
              stroke="none"
              isAnimationActive={animate && !reduced}
              onAnimationEnd={() => setAnimate(false)}
              animationDuration={900}
              animationEasing="ease-out"
            />
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="num text-2xl font-semibold text-white">
              {totalKw != null ? fmtNumber(totalKw, 0) : '—'}
            </p>
            <p className="eyebrow mt-0.5">kW agora</p>
          </div>
        </div>
      </div>
      <ul className="row-list text-sm">
        {slices.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2 text-[#c7d0da]">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: s.fill }}
              />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="num flex gap-3 text-[#8b98a8]">
              <span>{fmtKw(s.kw, 0)}</span>
              <span className="w-9 text-right text-white">
                {fmtNumber(s.pct, 0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
