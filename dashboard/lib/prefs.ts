'use client';

// Preferências de interface guardadas no navegador (ex.: barra lateral recolhida).

import { useCallback, useSyncExternalStore } from 'react';

const EVENT = 'kwatt:prefs';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function usePersistedFlag(
  key: string,
  fallback = false,
): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const raw = read(key);
      return raw == null ? fallback : raw === '1';
    },
    () => fallback,
  );
  const set = useCallback(
    (v: boolean) => {
      try {
        window.localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* sem armazenamento: só não persiste */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
