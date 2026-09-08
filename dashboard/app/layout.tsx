import type { Metadata } from 'next';
import { Geist, Geist_Mono, Poppins } from 'next/font/google';
import './globals.css';

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});
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
      <body
        className={`${sans.variable} ${mono.variable} ${poppins.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
