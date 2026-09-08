'use client';

import { useState } from 'react';
import { CheckCircle2, KeyRound, XCircle } from 'lucide-react';

import { AppShell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDashboard } from '@/hooks/use-dashboard';
import { createClient } from '@/lib/api';
import {
  DEFAULT_SETTINGS,
  saveSettings,
  useSettings,
  type Settings,
} from '@/lib/settings';

export default function ConfiguracoesPage() {
  const { data, error } = useDashboard('24h');
  const stored = useSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const form = draft ?? stored;
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  const update =
    (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setDraft((f) => ({ ...(f ?? stored), [key]: value }));
      setSaved(false);
      setTest(null);
    };

  async function testConnection() {
    setTesting(true);
    setTest(null);
    try {
      const api = createClient(form);
      const health = await api.health();
      const tenant = await api.tenant();
      const meters = await api.meters();
      setTest({
        ok: true,
        text: `API ${health.version} respondeu. Cliente "${tenant.name}", ${meters.length} medidor(es) em ${form.site}.`,
      });
    } catch (err) {
      setTest({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    saveSettings({
      apiUrl: form.apiUrl.trim(),
      tenant: form.tenant.trim(),
      site: form.site.trim(),
      apiKey: form.apiKey.trim(),
    });
    setDraft(null);
    setSaved(true);
  }

  function clear() {
    saveSettings({ ...DEFAULT_SETTINGS });
    setDraft(null);
    setTest(null);
    setSaved(true);
  }

  return (
    <AppShell
      title="Configurações"
      subtitle="Conexão do painel com a API"
      data={data}
      error={error}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.65fr)]">
        <Card className="fade-up">
          <CardHeader>
            <CardTitle>Conexão</CardTitle>
            <CardDescription>
              Guardada só neste navegador. A chave identifica o cliente e vai
              apenas para a API.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2">
              <Label htmlFor="apiUrl">Endereço da API</Label>
              <Input
                id="apiUrl"
                value={form.apiUrl}
                onChange={update('apiUrl')}
                placeholder="https://..."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="tenant">Cliente (tenant)</Label>
                <Input
                  id="tenant"
                  value={form.tenant}
                  onChange={update('tenant')}
                  placeholder="demo"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="site">Unidade (site)</Label>
                <Input
                  id="site"
                  value={form.site}
                  onChange={update('site')}
                  placeholder="fabrica"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apiKey">Chave da API</Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={update('apiKey')}
                placeholder="ek_..."
              />
              <p className="label">
                Gerada ao criar o cliente na API. Sem chave, o painel mostra
                dados demonstrativos.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="bg-lime-300 text-[#0f1a06] hover:bg-lime-200"
                onClick={save}
                disabled={!form.apiUrl.trim()}
              >
                Salvar
              </Button>
              <Button
                variant="outline"
                className="border-white/10"
                onClick={testConnection}
                disabled={testing}
              >
                <KeyRound data-icon="inline-start" />{' '}
                {testing ? 'Testando…' : 'Testar conexão'}
              </Button>
              <Button
                variant="ghost"
                className="text-[#8b98a8]"
                onClick={clear}
              >
                Voltar ao modo demonstração
              </Button>
              {saved && (
                <span className="text-xs text-lime-300">
                  Salvo. As telas já usam a nova conexão.
                </span>
              )}
            </div>
            {test && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                  test.ok
                    ? 'border-lime-400/25 bg-lime-400/[.06] text-lime-200'
                    : 'border-rose-400/25 bg-rose-400/[.06] text-rose-200'
                }`}
              >
                {test.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <span>{test.text}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="fade-up" style={{ animationDelay: '80ms' }}>
          <CardHeader>
            <CardTitle>Como funciona</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-[#8b98a8]">
            <p>
              Os medidores publicam leituras a cada 10 segundos. A nuvem fecha
              janelas de 15 minutos iguais às da distribuidora e calcula a
              demanda de cada uma.
            </p>
            <p>
              A <span className="text-[#e6ebf0]">projeção</span> aparece a
              partir de 5 minutos de janela e é o aviso que chega a tempo de
              desligar carga. A{' '}
              <span className="text-[#e6ebf0]">ultrapassagem</span> é registrada
              quando a janela fecha acima do contrato mais a tolerância.
            </p>
            <p>
              O painel atualiza a cada 15 segundos na visão de 24 horas e a cada
              minuto na de 7 dias. Os alertas ficam 180 dias e as janelas 90
              dias na API; o histórico completo fica no lake.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
