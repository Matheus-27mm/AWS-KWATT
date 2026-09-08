'use client';

import { useMemo, useState } from 'react';
import { Activity, ShieldCheck, TriangleAlert } from 'lucide-react';

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
import type { AlertKind } from '@/lib/api';
import { fmtDateTime, fmtDayShort, relativeTime } from '@/lib/format';
import { ALERT_TITLES } from '@/lib/model';

const ALL = '__todos__';

export default function AlertasPage() {
  const { data, loading, error } = useDashboard('24h');
  const search = useSearch().trim().toLowerCase();
  const [kind, setKind] = useState<string>(ALL);
  const [meter, setMeter] = useState<string>(ALL);
  const now = data?.updatedAt ?? new Date();
  const tz = data?.tenant.tz ?? 'America/Manaus';

  const filtered = useMemo(
    () =>
      (data?.alerts ?? []).filter(
        (a) =>
          (kind === ALL || a.kind === kind) &&
          (meter === ALL || a.meterId === meter) &&
          (!search ||
            a.meterName.toLowerCase().includes(search) ||
            a.title.toLowerCase().includes(search)),
      ),
    [data, kind, meter, search],
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const a of filtered) {
      const day = fmtDayShort(a.ts, tz);
      groups.set(day, [...(groups.get(day) ?? []), a]);
    }
    return [...groups.entries()];
  }, [filtered, tz]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of data?.alerts ?? []) c[a.kind] = (c[a.kind] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <AppShell
      title="Alertas"
      subtitle={
        data ? `${data.alerts.length} no histórico · ficam 180 dias` : undefined
      }
      data={data}
      error={error}
      loading={loading}
      actions={
        data && (
          <div className="hidden items-center gap-2 lg:flex">
            <Select value={meter} onValueChange={(v) => setMeter(v ?? ALL)}>
              <SelectTrigger
                size="sm"
                className="w-[160px] border-white/10 bg-white/[.03] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os medidores</SelectItem>
                {data.meters.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(v) => setKind(v ?? ALL)}>
              <SelectTrigger
                size="sm"
                className="w-[190px] border-white/10 bg-white/[.03] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os tipos</SelectItem>
                {(Object.keys(ALERT_TITLES) as AlertKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ALERT_TITLES[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      }
    >
      {!data ? (
        <Skeleton className="h-64 rounded-xl bg-white/[.04]" />
      ) : (
        <div className="space-y-4">
          <section className="grid gap-4 sm:grid-cols-3">
            {(Object.keys(ALERT_TITLES) as AlertKind[]).map((k, i) => (
              <Card
                key={k}
                className="fade-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <CardContent>
                  <p className="label">{ALERT_TITLES[k]}</p>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="kpi-value">{counts[k] ?? 0}</span>
                    <span className="text-sm text-[#6b7887]">no histórico</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          <Card className="fade-up" style={{ animationDelay: '200ms' }}>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
              <CardDescription>
                {filtered.length} de {data.alerts.length} alertas
              </CardDescription>
              <CardAction>
                <span
                  className={`chip ${data.source === 'demo' ? 'chip-cyan' : 'chip-lime'}`}
                >
                  {data.source === 'demo' ? 'demonstração' : 'ao vivo'}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              {byDay.length === 0 && (
                <div className="grid min-h-40 place-items-center text-center">
                  <div>
                    <ShieldCheck className="mx-auto size-5 text-lime-300" />
                    <p className="mt-2 text-sm text-[#c7d0da]">
                      Nenhum alerta com esses filtros
                    </p>
                  </div>
                </div>
              )}
              {byDay.map(([day, items]) => (
                <div key={day}>
                  <p className="eyebrow mb-2">{day}</p>
                  <div className="space-y-2">
                    {items.map((a) => {
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
                              <strong>
                                {a.title} · {a.meterName}
                              </strong>
                              <time
                                dateTime={a.ts}
                                title={relativeTime(a.ts, now)}
                              >
                                {fmtDateTime(a.ts, tz)}
                              </time>
                            </div>
                            <p>{a.detail}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
