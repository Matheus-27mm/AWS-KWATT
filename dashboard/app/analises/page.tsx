import { Redirect } from '@/components/redirect';

// Rota antiga: o painel vive em /painel/analises.
export default function Page() {
  return <Redirect to="/painel/analises" />;
}
