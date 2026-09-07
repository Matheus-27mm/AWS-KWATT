'use client';

// Casca do painel: barra lateral com navegação nomeada, cabeçalho com título, busca e sino.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bell,
  Bolt,
  Gauge,
  LayoutDashboard,
  Menu,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/format';
import type { DashboardData } from '@/lib/model';

const NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Visão geral' },
  { href: '/medidores', icon: Gauge, label: 'Medidores' },
  { href: '/analises', icon: Activity, label: 'Análises' },
  { href: '/alertas', icon: Bell, label: 'Alertas' },
];

const SearchContext = createContext<string>('');

/** Texto digitado na busca do cabeçalho; as páginas filtram medidores e alertas por ele. */
export function useSearch(): string {
  return useContext(SearchContext);
}

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1">
      {NAV.map(({ href, icon: Icon, label }) => {
        const active =
          href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`nav-item ${active ? 'nav-item-active' : ''}`}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({
  pathname,
  data,
  onNavigate,
}: {
  pathname: string;
  data: DashboardData | null;
  onNavigate?: () => void;
}) {
  const settingsActive = pathname.startsWith('/configuracoes');
  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex h-[72px] items-center gap-3 border-b border-white/6 px-5"
      >
        <span className="brand-mark" aria-hidden>
          <Bolt className="size-4" fill="currentColor" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">
          KWATT
        </span>
      </Link>
      <div className="flex-1 px-3 py-4">
        <NavList pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-white/6 px-3 py-4">
        <Link
          href="/configuracoes"
          onClick={onNavigate}
          aria-current={settingsActive ? 'page' : undefined}
          className={`nav-item ${settingsActive ? 'nav-item-active' : ''}`}
        >
          <Settings2 className="size-4" />
          <span>Configurações</span>
        </Link>
        <div className="mt-3 flex items-center gap-3 px-2 text-xs text-slate-500">
          <span className="grid size-8 place-items-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-300 ring-1 ring-white/10">
            {(data?.tenant.name ?? 'KW')
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-slate-300">
              {data?.tenant.name ?? 'Sem cliente'}
            </span>
            <span className="block truncate">{data?.siteName ?? ''}</span>
          </span>
        </div>
      </div>
    </div>
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
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 5000);
    return () => window.clearInterval(t);
  }, []);

  const isDemo = data?.source === 'demo';
  const recentAlerts = useMemo(() => {
    if (!data) return 0;
    const cutoff = data.updatedAt.getTime() - 3600_000;
    return data.alerts.filter((a) => new Date(a.ts).getTime() >= cutoff).length;
  }, [data]);

  const status =
    loading && !data
      ? 'Carregando'
      : error
        ? 'Sem conexão'
        : data
          ? `Atualizado ${relativeTime(data.updatedAt, now)}`
          : 'Sem dados';

  return (
    <SearchContext.Provider value={search}>
      <div className="min-h-screen bg-background text-foreground">
        <aside className="sidebar fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-white/6 lg:block">
          <Sidebar pathname={pathname} data={data} />
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Fechar menu"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMenuOpen(false)}
            />
            <div className="sidebar absolute inset-y-0 left-0 w-[232px] border-r border-white/6">
              <button
                type="button"
                aria-label="Fechar"
                className="absolute top-5 right-3 grid size-8 place-items-center rounded-md text-slate-400 hover:bg-white/5"
                onClick={() => setMenuOpen(false)}
              >
                <X className="size-4" />
              </button>
              <Sidebar
                pathname={pathname}
                data={data}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
          </div>
        )}

        <main className="lg:pl-[232px]">
          <header className="sticky top-0 z-20 border-b border-white/6 bg-[#081018]/88 backdrop-blur-xl">
            <div className="mx-auto flex min-h-[72px] max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
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
                    <h1 className="truncate text-lg font-semibold text-white sm:text-xl">
                      {title}
                    </h1>
                    {isDemo && (
                      <Badge className="border border-cyan-400/20 bg-cyan-400/10 text-[10px] text-cyan-300">
                        DEMO
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {subtitle ?? status}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                {actions}
                <label className="search-box hidden md:flex">
                  <Search className="size-4 text-slate-500" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar medidor ou alerta"
                    aria-label="Buscar"
                  />
                </label>
                <Link
                  href="/alertas"
                  aria-label={
                    recentAlerts
                      ? `${recentAlerts} alertas na última hora`
                      : 'Alertas'
                  }
                  className="nav-icon relative"
                  title={
                    recentAlerts
                      ? `${recentAlerts} alertas na última hora`
                      : 'Sem alertas na última hora'
                  }
                >
                  <Bell className="size-[18px]" />
                  {recentAlerts > 0 && <span className="bell-dot" />}
                </Link>
                <span
                  className={`live-dot ml-1 hidden md:block ${error ? 'live-dot-off' : ''}`}
                  title={status}
                />
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
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
    </SearchContext.Provider>
  );
}
