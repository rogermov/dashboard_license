const BASE = '/api';
const cache = new Map();
const TTL = 30_000;
async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error('HTTP ' + res.status);
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
