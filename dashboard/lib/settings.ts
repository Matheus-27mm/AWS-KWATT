// Configuração do painel guardada no navegador. A chave da API identifica o cliente (tenant)
// e nunca sai do dispositivo de quem opera o painel.

import { useSyncExternalStore } from 'react';

export type Settings = {
  apiUrl: string;
  tenant: string;
  site: string;
  apiKey: string;
};

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: 'https://f8ao6lq2w9.execute-api.sa-east-1.amazonaws.com',
  tenant: 'demo',
  site: 'fabrica',
  apiKey: '',
};

const STORAGE_KEY = 'kwatt.settings';

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event('kwatt:settings'));
}

export function isConfigured(settings: Settings): boolean {
  return settings.apiKey.trim().length > 0 && settings.apiUrl.trim().length > 0;
}

// Leitura reativa das configurações. Snapshot estável enquanto o localStorage não muda, para o
// useSyncExternalStore não re-renderizar à toa; no servidor devolve o padrão.
let cachedRaw: string | null | undefined;
let cachedValue: Settings = DEFAULT_SETTINGS;

function snapshot(): Settings {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = loadSettings();
  }
  return cachedValue;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('kwatt:settings', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('kwatt:settings', onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_SETTINGS);
}
