'use client';

// Página de entrada no layout de referência: barra superior, faixa de anúncio, título em degradê,
// subtítulo, botão principal e a prévia do painel. Cores do KWATT: azul-marinho e verde-limão.

import Link from 'next/link';
import { ArrowRight, Bolt, Menu, X } from 'lucide-react';
import { useState } from 'react';

import { DashboardPreview } from '@/components/dashboard-preview';

const REPO = 'https://github.com/Matheus-27mm/AWS-KWATT';

const LINKS = [
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#para-quem', label: 'Para quem' },
  { href: `${REPO}#readme`, label: 'Documentação', external: true },
];

function NavLink({
  href,
  label,
  external,
  onClick,
  className = '',
}: {
  href: string;
  label: string;
  external?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className={`text-sm text-white/60 transition-colors hover:text-white ${className}`}
    >
      {label}
    </a>
  );
}

function Navigation() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed top-0 z-50 w-full border-b border-white/[.07] bg-[#0b1117]/80 backdrop-blur-md">
      <nav className="mx-auto max-w-7xl px-6 py-4">
        <div className="relative flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-xl font-semibold text-white"
          >
            <span
              className="brand-mark"
              style={{ width: 32, height: 32 }}
              aria-hidden
            >
              <Bolt className="size-4" fill="currentColor" />
            </span>
            KWATT
          </Link>

          <div className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 md:flex">
            {LINKS.map((l) => (
              <NavLink key={l.href} {...l} />
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <Link href="/painel" className="landing-btn landing-btn-ghost">
              Entrar
            </Link>
            <Link href="/painel" className="landing-btn landing-btn-solid">
              Ver demonstração
            </Link>
          </div>

          <button
            type="button"
            className="text-white md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={open}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-white/[.07] bg-[#0b1117]/95 backdrop-blur-md md:hidden animate-[slideDown_0.3s_ease-out]">
          <div className="flex flex-col gap-4 px-6 py-4">
            {LINKS.map((l) => (
              <NavLink
                key={l.href}
                {...l}
                onClick={() => setOpen(false)}
                className="py-2"
              />
            ))}
            <div className="flex flex-col gap-2 border-t border-white/[.07] pt-4">
              <Link href="/painel" className="landing-btn landing-btn-ghost">
                Entrar
              </Link>
              <Link href="/painel" className="landing-btn landing-btn-solid">
                Ver demonstração
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-start px-6 py-20 md:py-24 animate-[fadeIn_0.6s_ease-out]">
      <aside className="mb-8 inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-4 py-2 backdrop-blur-sm">
        <span className="text-center text-xs whitespace-nowrap text-[#8b98a8]">
          Alertas de demanda pelo WhatsApp, antes de a janela fechar
        </span>
        <a
          href="#como-funciona"
          className="flex items-center gap-1 text-xs whitespace-nowrap text-lime-300 transition-all hover:text-lime-200 active:scale-95"
        >
          Como funciona
          <ArrowRight className="size-3" />
        </a>
      </aside>

      <h1 className="landing-title mb-6 max-w-5xl px-6 text-center text-4xl leading-tight font-medium md:text-5xl lg:text-6xl">
        Sua fábrica dentro do contrato, <br className="hidden sm:block" />
        janela por janela
      </h1>

      <p className="mb-10 max-w-2xl px-6 text-center text-sm text-[#8b98a8] md:text-base">
        Medição por linha e turno, janelas de 15 minutos iguais às da
        distribuidora <br className="hidden md:block" />e aviso a tempo de
        desligar carga. Feito para a indústria média do Polo Industrial de
        Manaus.
      </p>

      <div className="relative z-10 mb-16 flex items-center gap-4">
        <Link
          href="/painel"
          className="landing-btn landing-btn-gradient h-12 rounded-lg px-8 text-base"
        >
          Ver o painel
        </Link>
      </div>

      <div className="relative w-full max-w-5xl pb-20">
        <div
          className="pointer-events-none absolute left-1/2 z-0 h-[420px] w-[90%] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            top: '-18%',
            background:
              'radial-gradient(closest-side, rgba(184,255,101,0.22), rgba(34,211,238,0.12) 55%, transparent 100%)',
          }}
          aria-hidden
        />
        <div className="relative z-10">
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Medidor na linha',
    text: 'Um medidor Modbus por linha ou máquina, lido a cada 10 segundos por um gateway na fábrica. Sem obra: aproveita o quadro que já existe.',
  },
  {
    n: '02',
    title: 'A nuvem fecha a janela',
    text: 'Cada 15 minutos vira uma janela de demanda igual à que a distribuidora fatura. Aos 5 minutos o sistema já projeta como ela vai fechar.',
  },
  {
    n: '03',
    title: 'Aviso a tempo de agir',
    text: 'Projeção acima do contrato, ultrapassagem confirmada e fator de potência abaixo de 0,92 chegam pelo WhatsApp e ficam no painel.',
  },
];

function Sections() {
  return (
    <>
      <section
        id="como-funciona"
        className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-20"
      >
        <p className="mb-3 text-center text-xs font-medium tracking-[.18em] text-lime-300/80 uppercase">
          Como funciona
        </p>
        <h2 className="mb-10 text-center text-3xl font-medium text-white md:text-4xl">
          Do medidor ao aviso em três passos
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-xl border border-white/[.08] bg-[#10171f] p-6"
            >
              <p className="num text-xs font-medium text-lime-300">{s.n}</p>
              <h3 className="mt-3 text-lg font-semibold text-white">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#8b98a8]">
                {s.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="para-quem"
        className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-24"
      >
        <div className="grid gap-8 rounded-2xl border border-white/[.08] bg-[#10171f] p-8 md:grid-cols-2 md:p-12">
          <div>
            <p className="mb-3 text-xs font-medium tracking-[.18em] text-lime-300/80 uppercase">
              Para quem
            </p>
            <h2 className="text-3xl font-medium text-white md:text-4xl">
              A segunda camada do Polo
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[#8b98a8] md:text-base">
              Injeção plástica, metalurgia leve, embalagem e componentes:
              fábricas do Grupo A, em tarifa verde ou azul, que pagam demanda
              contratada e ultrapassagem sem enxergar a janela em que
              estouraram.
            </p>
          </div>
          <ul className="grid gap-3 self-center text-sm text-[#c7d0da]">
            {[
              'Uma única janela acima do contrato custa o dobro da tarifa de demanda no mês inteiro.',
              'Fator de potência abaixo de 0,92 vira excedente reativo na fatura.',
              'A curva de carga de 12 meses é o que decide a migração para o mercado livre em 2027.',
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-lime-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t border-white/[.07] px-6 py-8 text-center text-xs text-[#6b7887]">
        <span>KWATT · inteligência energética industrial · Manaus</span>
        <span className="mx-2">·</span>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="hover:text-[#c7d0da]"
        >
          GitHub
        </a>
      </footer>
    </>
  );
}

export default function Landing() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navigation />
      <Hero />
      <Sections />
    </main>
  );
}
