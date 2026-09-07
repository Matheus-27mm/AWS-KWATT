// Formatação em pt-BR. Números com vírgula, horários no fuso do cliente (padrão America/Manaus).

export function fmtNumber(value: number, digits = 1): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtKw(value: number | null | undefined, digits = 1): string {
  return value == null ? '—' : `${fmtNumber(value, digits)} kW`;
}

export function fmtKwh(value: number | null | undefined): string {
  return value == null ? '—' : `${fmtNumber(value, 0)} kWh`;
}

export function fmtPf(value: number | null | undefined): string {
  return value == null ? '—' : fmtNumber(Math.abs(value), 2);
}

export function fmtPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function fmtTime(iso: string | Date, tz: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function fmtDateTime(iso: string | Date, tz: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function fmtDateLong(date: Date, tz: string): string {
  const text = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function fmtDayShort(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));
}

/** "há 8 s", "há 3 min", "há 2 h", "ontem" */
export function relativeTime(iso: string | Date, now = new Date()): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - date.getTime()) / 1000),
  );
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function periodLabel(period: 'ponta' | 'fora_ponta'): string {
  return period === 'ponta' ? 'ponta' : 'fora ponta';
}

export function windowLabel(startIso: string, tz: string): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 15 * 60_000);
  return `${fmtTime(start, tz)}–${fmtTime(end, tz)}`;
}

export function monthKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const text = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Início do dia local (no fuso do cliente) como instante UTC. */
export function startOfLocalDay(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const secondsIntoDay =
    get('hour') * 3600 + get('minute') * 60 + get('second');
  return new Date(
    now.getTime() - secondsIntoDay * 1000 - now.getMilliseconds(),
  );
}
