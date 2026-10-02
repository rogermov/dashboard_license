import { useState, useEffect, useCallback } from 'react';
import { api } from './api.js';

// Hook central de leitura: encapsula loading / erro / dados e um reload().
// Resolve o padrão perigoso que existia nas páginas (catch { setX([]) }), onde
// uma falha de API virava "lista vazia" — indistinguível de "nada encontrado".
// Agora o erro é explícito e a tela pode oferecer "tentar novamente".
export function useApi(path, { enabled = true, noCache = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get(path, { noCache }));
    } catch (e) {
      setError(e.message || 'Erro ao carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, [path, noCache]);

  useEffect(() => { if (enabled) reload(); }, [reload, enabled]);

  return { data, loading, error, reload, setData };
}
