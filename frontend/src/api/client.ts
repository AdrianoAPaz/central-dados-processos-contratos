import { useCallback } from 'react';

// Cliente de API mínimo: chama sempre caminhos relativos (/api/...), que em
// dev o Vite repassa pro backend e em produção já são a mesma origem — nunca
// precisa de URL de API configurável (CLAUDE.md 1.2).
export function useApi() {
  return useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`Erro na API: ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }, []);
}
