'use client';

// Rosca com a participação de cada medidor na demanda atual.

import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { fmtKw, fmtNumber } from '@/lib/format';

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
    <div className="rounded-lg border border-slate-700 bg-[#101923]/95 px-3 py-2 shadow-2xl">
      <p className="text-xs text-slate-400">{item.name}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">
        {fmtKw(item.kw)} · {fmtNumber(item.pct, 0)}%
      </p>
    </div>
  );
}

export function ShareDonut({
  shares,
  totalKw,
}: {
  shares: Share[];
  totalKw: number | null;
}) {
  const slices = shares.map((s, i) => ({
    ...s,
    fill: SHARE_COLORS[i % SHARE_COLORS.length],
  }));
  if (!shares.length) {
    return (
      <div className="grid h-full min-h-[220px] place-items-center text-sm text-slate-500">
        Sem leituras para distribuir.
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(150px,auto)]">
      <div className="relative h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="kw"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="#0d1721"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-mono text-xl font-semibold text-white">
              {totalKw != null ? fmtNumber(totalKw, 0) : '—'}
            </p>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              kW agora
            </p>
          </div>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {shares.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-slate-300">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }}
              />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="font-mono text-slate-200">
              {fmtNumber(s.pct, 0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
