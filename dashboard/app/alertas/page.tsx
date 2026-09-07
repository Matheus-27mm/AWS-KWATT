'use client';

import { useMemo, useState } from 'react';
import { Activity, ShieldCheck, TriangleAlert } from 'lucide-react';

import { AppShell } from '@/components/shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const [kind, setKind] = useState<string>(ALL);
  const [meter, setMeter] = useState<string>(ALL);
  const now = data?.updatedAt ?? new Date();
  const tz = data?.tenant.tz ?? 'America/Manaus';

  const filtered = useMemo(
    () =>
      (data?.alerts ?? []).filter(
        (a) =>
          (kind === ALL || a.kind === kind) &&
          (meter === ALL || a.meterId === meter),
      ),
    [data, kind, meter],
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
      data={data}
      error={error}
      loading={loading}
      actions={
        data && (
          <>
            <Select value={meter} onValueChange={(v) => setMeter(v ?? ALL)}>
              <SelectTrigger className="h-9 w-[150px] border-white/10 bg-white/[.04] text-slate-200">
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
              <SelectTrigger className="h-9 w-[170px] border-white/10 bg-white/[.04] text-slate-200">
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
          </>
        )
      }
    >
      {!data ? (
        <Skeleton className="h-64 rounded-xl bg-white/5" />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(ALERT_TITLES) as AlertKind[]).map((k) => (
              <Card key={k} className="metric-card border-0">
                <CardHeader>
                  <p className="metric-label">{ALERT_TITLES[k]}</p>
                  <div className="mt-3 flex items-end gap-1.5">
                    <strong className="metric-value">{counts[k] ?? 0}</strong>
                    <span className="mb-1 text-sm font-medium text-slate-500">
                      no histórico
                    </span>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </section>

          <Card className="panel-card mt-3 border-0">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-white">
                  Histórico
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {filtered.length} de {data.alerts.length} alertas · os alertas
                  ficam 180 dias no sistema
                </p>
              </div>
              <Badge
                variant="outline"
                className="border-white/10 text-slate-400"
              >
                {data.source === 'demo' ? 'demonstração' : 'ao vivo'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              {byDay.length === 0 && (
                <div className="grid min-h-44 place-items-center text-center">
                  <div>
                    <ShieldCheck className="mx-auto size-7 text-lime-300" />
                    <p className="mt-3 text-sm font-medium text-slate-200">
                      Nenhum alerta com esses filtros
                    </p>
                  </div>
                </div>
              )}
              {byDay.map(([day, items]) => (
                <div key={day}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-[.18em] text-slate-500">
                    {day}
                  </p>
                  <div className="space-y-2">
                    {items.map((a) => {
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
        </>
      )}
    </AppShell>
  );
}
