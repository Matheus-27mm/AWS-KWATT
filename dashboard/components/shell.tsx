'use client';

// Casca do painel: barra lateral recolhível (preferência salva no navegador), cabeçalho com
// título, busca e alertas. Uma superfície, bordas de 1 px, um acento.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bell,
  Bolt,
  ChevronsLeft,
  ChevronsRight,
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

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { relativeTime } from '@/lib/format';
import type { DashboardData } from '@/lib/model';
import { usePersistedFlag } from '@/lib/prefs';

const NAV = [
  { href: '/painel', icon: LayoutDashboard, label: 'Visão geral' },
  { href: '/painel/medidores', icon: Gauge, label: 'Medidores' },
  { href: '/painel/analises', icon: Activity, label: 'Análises' },
  { href: '/painel/alertas', icon: Bell, label: 'Alertas' },
];

const SearchContext = createContext<string>('');

/** Texto digitado na busca do cabeçalho; as páginas filtram medidores e alertas por ele. */
export function useSearch(): string {
  return useContext(SearchContext);
}

function isActive(href: string, pathname: string): boolean {
  if (href === '/painel')
    return pathname === '/painel' || pathname === '/painel/';
  return pathname.startsWith(href);
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  onNavigate,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={`nav-item ${active ? 'nav-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
    >
      <Icon className="size-4" />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Sidebar({
  pathname,
  data,
  collapsed,
  onToggle,
  onNavigate,
}: {
  pathname: string;
  data: DashboardData | null;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const initials = (data?.tenant.name ?? 'KW')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        onClick={onNavigate}
        className={`flex h-16 items-center gap-3 border-b border-white/[.07] ${collapsed ? 'justify-center px-0' : 'px-4'}`}
        aria-label="KWATT, página inicial"
      >
        <span className="brand-mark" aria-hidden>
          <Bolt className="size-4" fill="currentColor" />
        </span>
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-white">
            KWATT
          </span>
        )}
      </Link>
      <nav
        aria-label="Navegação principal"
        className="flex flex-1 flex-col gap-1 px-3 py-3"
      >
        {NAV.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={isActive(item.href, pathname)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/[.07] px-3 py-3">
        <NavItem
          href="/painel/configuracoes"
          icon={Settings2}
          label="Configurações"
          active={pathname.startsWith('/painel/configuracoes')}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={`nav-item ${collapsed ? 'justify-center px-0' : ''}`}
            aria-label={
              collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'
            }
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            {collapsed ? (
              <ChevronsRight className="size-4" />
            ) : (
              <ChevronsLeft className="size-4" />
            )}
            {!collapsed && <span>Recolher</span>}
          </button>
        )}
        <div
          className={`mt-2 flex items-center gap-3 ${collapsed ? 'justify-center' : 'px-2'}`}
          title={data?.tenant.name}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-[11px] font-semibold text-[#c7d0da]">
            {initials}
          </span>
          {!collapsed && (
            <span className="min-w-0 text-xs">
              <span className="block truncate text-[#e6ebf0]">
                {data?.tenant.name ?? 'Sem cliente'}
              </span>
              <span className="block truncate text-[#6b7887]">
                {data?.siteName ?? ''}
              </span>
            </span>
          )}
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
  const [collapsed, setCollapsed] = usePersistedFlag('kwatt.sidebar.collapsed');
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
          : '';
  const alertsTitle = recentAlerts
    ? `${recentAlerts} alertas na última hora`
    : 'Sem alertas na última hora';

  return (
    <SearchContext.Provider value={search}>
      <TooltipProvider delay={200}>
        <div className="min-h-screen bg-background text-foreground">
          <aside
            className={`sidebar fixed inset-y-0 left-0 z-30 hidden border-r border-white/[.07] lg:block ${collapsed ? 'w-16' : 'w-60'}`}
          >
            <Sidebar
              pathname={pathname}
              data={data}
              collapsed={collapsed}
              onToggle={() => setCollapsed(!collapsed)}
            />
          </aside>

          {menuOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                aria-label="Fechar menu"
                className="absolute inset-0 bg-black/60"
                onClick={() => setMenuOpen(false)}
              />
              <div className="sidebar absolute inset-y-0 left-0 w-60 border-r border-white/[.07]">
                <button
                  type="button"
                  aria-label="Fechar"
                  className="icon-button absolute top-3 right-3"
                  onClick={() => setMenuOpen(false)}
                >
                  <X className="size-4" />
                </button>
                <Sidebar
                  pathname={pathname}
                  data={data}
                  collapsed={false}
                  onNavigate={() => setMenuOpen(false)}
                />
              </div>
            </div>
          )}

          <div
            className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-16' : 'lg:pl-60'}`}
          >
            <header className="sticky top-0 z-20 border-b border-white/[.07] bg-[#0b1117]/85 backdrop-blur-md">
              <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    className="icon-button lg:hidden"
                    aria-label="Abrir menu"
                    type="button"
                    onClick={() => setMenuOpen(true)}
                  >
                    <Menu className="size-5" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h1 className="truncate text-[17px] font-semibold text-white">
                        {title}
                      </h1>
                      {isDemo && <span className="chip chip-cyan">Demo</span>}
                      {error && (
                        <span className="chip chip-crit">Sem conexão</span>
                      )}
                    </div>
                    {(subtitle ?? status) && (
                      <p className="mt-0.5 truncate text-xs text-[#6b7887]">
                        {subtitle ?? status}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {actions}
                  <label className="search-box hidden md:flex">
                    <Search className="size-4 text-[#6b7887]" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar medidor ou alerta"
                      aria-label="Buscar"
                    />
                  </label>
                  <Link
                    href="/painel/alertas"
                    className="icon-button relative"
                    aria-label={recentAlerts ? alertsTitle : 'Alertas'}
                    title={alertsTitle}
                  >
                    <Bell className="size-[18px]" />
                    {recentAlerts > 0 && <span className="bell-dot" />}
                  </Link>
                  <span
                    className="ml-1 hidden items-center gap-2 text-xs text-[#8b98a8] md:flex"
                    title={status}
                  >
                    <span
                      className={`live-dot ${error ? 'live-dot-off' : ''}`}
                    />
                    {error ? 'offline' : 'ao vivo'}
                  </span>
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
              {error && (
                <div className="mb-4 rounded-lg border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-sm text-rose-200">
                  <span className="font-medium">
                    Não consegui falar com a API.
                  </span>{' '}
                  {error} {data ? 'Mostrando os últimos dados recebidos.' : ''}
                  <Link
                    href="/painel/configuracoes"
                    className="ml-2 underline underline-offset-4"
                  >
                    Revisar configurações
                  </Link>
                </div>
              )}
              {children}
              <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-white/[.07] pt-4 text-[11px] text-[#6b7887] sm:flex-row">
                <span>KWATT · inteligência energética industrial</span>
                <span>
                  {isDemo
                    ? 'Dados demonstrativos. Configure a chave da API para ver a sua fábrica.'
                    : data
                      ? `${data.tenant.name} · fuso ${data.tenant.tz}`
                      : ''}
                </span>
              </footer>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </SearchContext.Provider>
  );
}
