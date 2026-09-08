import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center text-foreground">
      <div>
        <p className="num text-sm font-medium text-lime-300">404</p>
        <h1 className="mt-3 text-3xl font-medium text-white">
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-[#8b98a8]">
          O endereço que você abriu não existe. O painel fica em{' '}
          <span className="text-[#e6ebf0]">/painel</span>.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="landing-btn landing-btn-ghost">
            Página inicial
          </Link>
          <Link href="/painel" className="landing-btn landing-btn-solid">
            Abrir o painel
          </Link>
        </div>
      </div>
    </main>
  );
}
