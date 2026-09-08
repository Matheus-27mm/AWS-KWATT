'use client';

// Redireciona no cliente. Usado pelas rotas antigas do painel, que passaram a viver em /painel.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return (
    <main className="grid min-h-screen place-items-center bg-background text-sm text-slate-400">
      <p>
        Esta página mudou de endereço.{' '}
        <a href={to} className="text-lime-300 underline underline-offset-4">
          Ir para {to}
        </a>
      </p>
    </main>
  );
}
