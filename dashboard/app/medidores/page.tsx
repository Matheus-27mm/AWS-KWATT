import { Redirect } from '@/components/redirect';

// Rota antiga: o painel vive em /painel/medidores.
export default function Page() {
  return <Redirect to="/painel/medidores" />;
}
