// Estado compartilhado do offboarding: resumo (números das etapas) e o modo
// real/simulação. Um só fetch para o cabeçalho, as etapas e as telas.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);

export function OffboardingProvider({ children }) {
  const [summary, setSummary] = useState(null);
  const [config, setConfig] = useState(null);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([
      api.get('/offboarding/summary', { noCache: true }).catch(() => null),
      api.get('/offboarding/actions/config', { noCache: true }).catch(() => null),
    ]);
    if (s) setSummary(s);
    if (c) setConfig(c);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setMode = useCallback(async (enabled) => {
    setConfig(await api.post('/offboarding/actions/mode', { enabled }));
  }, []);

  return <Ctx.Provider value={{ summary, config, refresh, setMode }}>{children}</Ctx.Provider>;
}

export const useOffboarding = () => useContext(Ctx);
