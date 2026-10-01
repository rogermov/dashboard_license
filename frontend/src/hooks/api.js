const BASE = '/api';
const cache = new Map();
const TTL = 30_000;
async function fetchJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Falha de conexão com o servidor. Verifique sua rede.');
  }
  if (!res.ok) {
    // FastAPI devolve erros como {"detail": "..."} — mostra a mensagem real do backend
    // em vez de um "HTTP 500" genérico.
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch { /* corpo não-JSON: mantém o status */ }
    if (res.status === 401) msg = 'Não autenticado (sessão expirou?). Recarregue a página para entrar de novo.';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
export const api = {
  get: async (path, { noCache } = {}) => {
    const key = BASE + path;
    if (!noCache) { const c = cache.get(key); if (c && Date.now()-c.ts<TTL) return c.data; }
    const data = await fetchJson(key);
    cache.set(key, { data, ts: Date.now() });
    return data;
  },
  post: (path, data) => { cache.clear(); return fetchJson(BASE+path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); },
  postForm: (path, fd) => { cache.clear(); return fetchJson(BASE+path, { method:'POST', body:fd }); },
  delete: (path) => { cache.clear(); return fetchJson(BASE+path, { method:'DELETE' }); },
  invalidate: () => cache.clear(),
};
