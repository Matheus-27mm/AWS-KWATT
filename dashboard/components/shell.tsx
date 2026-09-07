'use client';

// Casca do painel: barra lateral com navegação, cabeçalho com estado da conexão e o conteúdo.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bell,
  Bolt,
  Gauge,
  LayoutDashboard,
  Menu,
  Settings2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { relativeTime } from '@/lib/format';
import type { DashboardData } from '@/lib/model';

const NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Visão geral' },
  { href: '/medidores', icon: Gauge, label: 'Medidores' },
  { href: '/analises', icon: Activity, label: 'Análises' },
  { href: '/alertas', icon: Bell, label: 'Alertas' },
];

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV.map(({ href, icon: Icon, label }) => {
        const active =
          href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Tooltip key={href}>
            <TooltipTrigger
              render={
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                  className={`nav-icon ${active ? 'nav-icon-active' : ''}`}
                />
              }
            >
              <Icon className="size-[19px]" />
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}

export function AppShell({
  title,
  subtitle,
  data,
  error,
  loading,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  data: DashboardData | null;
  error?: string | null;
  loading?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 5000);
    return () => window.clearInterval(t);
  }, []);

  const isDemo = data?.source === 'demo';
  const initials = (data?.tenant.name ?? 'KW')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <aside className="sidebar fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center border-r border-white/6 lg:flex">
          <div className="flex h-20 items-center">
            <Link href="/" className="brand-mark" aria-label="KWATT">
              <Bolt className="size-5" fill="currentColor" />
            </Link>
          </div>
          <nav
            aria-label="Navegação principal"
            className="mt-5 flex flex-1 flex-col gap-3"
          >
            <NavLinks pathname={pathname} />
          </nav>
          <div className="mb-6 flex flex-col items-center gap-3">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    href="/configuracoes"
                    aria-label="Configurações"
                    className={`nav-icon ${pathname.startsWith('/configuracoes') ? 'nav-icon-active' : ''}`}
                  />
                }
              >
                <Settings2 className="size-[19px]" />
              </TooltipTrigger>
              <TooltipContent side="right">Configurações</TooltipContent>
            </Tooltip>
            <div
              className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-slate-300 ring-1 ring-white/10"
              title={data?.tenant.name}
            >
              {initials}
            </div>
          </div>
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Fechar menu"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMenuOpen(false)}
            />
            <nav
              aria-label="Navegação"
              className="sidebar absolute inset-y-0 left-0 flex w-[76px] flex-col items-center gap-3 border-r border-white/6 pt-6"
            >
              <NavLinks
                pathname={pathname}
                onNavigate={() => setMenuOpen(false)}
              />
              <Link
                href="/configuracoes"
                aria-label="Configurações"
                onClick={() => setMenuOpen(false)}
                className="nav-icon mt-auto mb-6"
              >
                <Settings2 className="size-[19px]" />
              </Link>
            </nav>
          </div>
        )}

        <main className="lg:pl-[76px]">
          <header className="sticky top-0 z-20 border-b border-white/6 bg-[#081018]/88 backdrop-blur-xl">
            <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-7 lg:px-9">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  className="nav-icon lg:hidden"
                  aria-label="Abrir menu"
                  type="button"
                  onClick={() => setMenuOpen(true)}
                >
                  <Menu className="size-5" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-base font-semibold text-white sm:text-lg">
                      {title}
                    </h1>
                    {isDemo && (
                      <Badge className="border border-cyan-400/20 bg-cyan-400/10 text-[10px] text-cyan-300">
                        DEMO
                      </Badge>
                    )}
                    {error && (
                      <Badge className="border border-rose-400/20 bg-rose-400/10 text-[10px] text-rose-300">
                        SEM CONEXÃO
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">
                    {subtitle ??
                      (data ? `${data.siteName} · ${data.tenant.name}` : '')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden items-center gap-2 text-xs text-slate-400 md:flex">
                  <span className={`live-dot ${error ? 'live-dot-off' : ''}`} />
                  {loading && !data
                    ? 'Carregando'
                    : data
                      ? `Atualizado ${relativeTime(data.updatedAt, now)}`
                      : 'Sem dados'}
                </div>
                {actions}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">
            {error && (
              <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                <strong className="font-semibold">
                  Não consegui falar com a API.
                </strong>{' '}
                {error} {data ? 'Mostrando os últimos dados recebidos.' : ''}
                <Link
                  href="/configuracoes"
                  className="ml-2 underline underline-offset-4"
                >
                  Revisar configurações
                </Link>
              </div>
            )}
            {children}
            <footer className="mt-6 flex flex-col justify-between gap-2 border-t border-white/6 pt-5 text-xs text-slate-600 sm:flex-row">
              <span>KWATT · inteligência energética industrial</span>
              <span>
                {isDemo
                  ? 'Dados demonstrativos. Configure a chave da API para ver a sua fábrica.'
                  : data
                    ? `${data.tenant.name} · fuso ${data.tenant.tz}`
                    : ''}
              </span>
            </footer>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
