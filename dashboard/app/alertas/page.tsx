import { Redirect } from '@/components/redirect';

// Rota antiga: o painel vive em /painel/alertas.
export default function Page() {
  return <Redirect to="/painel/alertas" />;
}
