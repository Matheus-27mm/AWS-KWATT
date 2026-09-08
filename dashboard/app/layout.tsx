import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KWATT | Inteligência energética industrial',
  description:
    'Medição por linha e turno, janelas de demanda de 15 minutos e alertas a tempo de desligar carga.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
