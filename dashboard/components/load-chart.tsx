'use client';

// Curva de carga: demanda por janela de 15 min, com a linha do contrato.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { fmtDayShort, fmtNumber, fmtTime, windowLabel } from '@/lib/format';

export type ChartPoint = { start: string; kw: number };

function Tip({
  active,
  payload,
  tz,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  tz: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-[#101923]/95 px-3 py-2 shadow-2xl">
      <p className="text-xs text-slate-400">
        {fmtDayShort(point.start, tz)} · {windowLabel(point.start, tz)}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">
        {fmtNumber(point.kw)} kW
      </p>
    </div>
  );
}

export function LoadChart({
  data,
  contracted,
  tz,
  range,
  height = 300,
}: {
  data: ChartPoint[];
  contracted: number | null;
  tz: string;
  range: '24h' | '7d';
  height?: number;
}) {
  if (!data.length) {
    return (
      <div className="grid h-full min-h-[200px] place-items-center text-sm text-slate-500">
        Sem janelas fechadas neste período.
      </div>
    );
  }
  const tickEvery =
    range === '7d'
      ? Math.max(1, Math.floor(data.length / 7))
      : Math.max(1, Math.floor(data.length / 8));
  const maxKw = Math.max(...data.map((p) => p.kw), contracted ?? 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
      >
        <defs>
          <linearGradient id="loadArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b8ff65" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#b8ff65" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="#243140"
          strokeDasharray="3 7"
          vertical={false}
        />
        <XAxis
          dataKey="start"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#64748b', fontSize: 11 }}
          interval={tickEvery - 1}
          tickFormatter={(v: string) =>
            range === '7d' ? fmtDayShort(v, tz).slice(0, 9) : fmtTime(v, tz)
          }
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#64748b', fontSize: 11 }}
          domain={[0, Math.ceil(maxKw * 1.15)]}
        />
        <ChartTooltip content={<Tip tz={tz} />} />
        {contracted != null && (
          <ReferenceLine
            y={contracted}
            stroke="#fbbf24"
            strokeDasharray="5 5"
            label={{
              value: 'Contrato',
              fill: '#fbbf24',
              fontSize: 11,
              position: 'insideTopRight',
            }}
          />
        )}
        <Area
          type="monotone"
          dataKey="kw"
          stroke="#b8ff65"
          strokeWidth={2.5}
          fill="url(#loadArea)"
          activeDot={{
            r: 4,
            fill: '#b8ff65',
            stroke: '#081018',
            strokeWidth: 2,
          }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
