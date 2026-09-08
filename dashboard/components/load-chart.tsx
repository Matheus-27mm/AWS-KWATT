'use client';

// Curva de carga: demanda por janela de 15 min com a linha do contrato. Eixo calculado em passos
// redondos, animação só na primeira renderização (as atualizações de 15 s não devem pular).

import { useMemo, useState } from 'react';
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

import {
  fmtDayShort,
  fmtKw,
  fmtNumber,
  fmtTime,
  windowLabel,
} from '@/lib/format';
import { useReducedMotion } from '@/lib/prefs';

export type ChartPoint = { start: string; kw: number };

/** Ticks redondos: 0 até um teto acima do máximo, em 4 ou 5 passos "bonitos". */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max * 1.12;
  const rough = raw / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) *
    mag;
  const top = Math.ceil(raw / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

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
    <div className="rounded-lg border border-white/10 bg-[#141c25] px-3 py-2 shadow-xl">
      <p className="text-[11px] text-[#8b98a8]">
        {fmtDayShort(point.start, tz)} · {windowLabel(point.start, tz)}
      </p>
      <p className="num mt-1 text-sm font-medium text-white">
        {fmtKw(point.kw)}
      </p>
    </div>
  );
}

export function LoadChart({
  data,
  contracted,
  tz,
  range,
  height = 280,
}: {
  data: ChartPoint[];
  contracted: number | null;
  tz: string;
  range: '24h' | '7d';
  height?: number;
}) {
  const reduced = useReducedMotion();
  // Anima só na primeira renderização com dados; as atualizações periódicas trocam sem saltar.
  const [animate, setAnimate] = useState(true);

  const ticks = useMemo(
    () => niceTicks(Math.max(...data.map((p) => p.kw), contracted ?? 0)),
    [data, contracted],
  );

  if (!data.length) {
    return (
      <div className="grid h-full min-h-[200px] place-items-center text-sm text-[#6b7887]">
        Sem janelas fechadas neste período.
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 4, left: -16, bottom: 0 }}
        >
          <defs>
            <linearGradient id="loadArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b8ff65" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#b8ff65" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="start"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#6b7887', fontSize: 11 }}
            minTickGap={48}
            interval="preserveStartEnd"
            tickFormatter={(v: string) =>
              range === '7d' ? fmtDayShort(v, tz).slice(0, 8) : fmtTime(v, tz)
            }
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
            tick={{ fill: '#6b7887', fontSize: 11 }}
            tickFormatter={(v: number) => fmtNumber(v, 0)}
            width={44}
          />
          <ChartTooltip
            content={<Tip tz={tz} />}
            cursor={{ stroke: 'rgba(255,255,255,0.15)' }}
          />
          {contracted != null && (
            <ReferenceLine
              y={contracted}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              strokeOpacity={0.9}
            />
          )}
          <Area
            type="monotone"
            dataKey="kw"
            stroke="#b8ff65"
            strokeWidth={2}
            fill="url(#loadArea)"
            dot={false}
            activeDot={{
              r: 4,
              fill: '#b8ff65',
              stroke: '#10171f',
              strokeWidth: 2,
            }}
            isAnimationActive={animate && !reduced}
            onAnimationEnd={() => setAnimate(false)}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-4 pl-7 text-[11px] text-[#8b98a8]">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-lime-300" /> Demanda
        </span>
        {contracted != null && (
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-amber-300" />{' '}
            Contrato {fmtKw(contracted, 0)}
          </span>
        )}
      </div>
    </div>
  );
}
