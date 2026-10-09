import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Download } from 'lucide-react';
import { api } from '../../hooks/api.js';
import { useOffboarding } from '../../hooks/useOffboarding.jsx';
import { exportCSV } from '../../lib/csv.js';
import { PLATFORMS, PLATFORM_LABELS as PL } from '../../lib/platforms.js';
import { Badge, Empty, Notice, PlatformTag, SearchInput, Spinner, fmtDate, useDebounced, useToast } from '../../components/ui.jsx';

export default function Revisar() {
  const { refresh } = useOffboarding();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [busy, setBusy] = useState(null);
  const q = useDebounced(search);
  const [toast, showToast] = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    const p = new URLSearchParams(); if (q) p.append('search', q); if (platform) p.append('platform', platform);
    try { setItems(await api.get(`/offboarding/review?${p}`, { noCache: true })); }
    catch (e) { setError(e.message || 'Erro ao carregar.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [q, platform]);

  // Agrupa por pessoa: decidir olhando todas as contas candidatas dela juntas.
  const groups = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!m.has(it.matricula)) m.set(it.matricula, { ...it, matches: [] });
      m.get(it.matricula).matches.push(it);
    }
    return [...m.values()];
  }, [items]);

  const decide = async (m, decision) => {
    const k = `${m.matricula}|${m.platform}|${m.account_email}`; setBusy(k);
    try {
      await api.post('/offboarding/decision', { matricula: m.matricula, platform: m.platform, account_email: m.account_email, decision });
      setItems(list => list.filter(x => `${x.matricula}|${x.platform}|${x.account_email}` !== k));
      showToast(decision === 'confirmar' ? `Confirmado: ${m.account_email} foi para "Remover acesso".` : `Descartado: ${m.account_email} não é ${m.person_name}.`);
      refresh();
    } catch (e) { showToast(e.message || 'Erro ao salvar a decisão.', true); }
    finally { setBusy(null); }
  };

  return (
    <>
      {toast}
      <div className="page-header">
        <div>
          <h1 className="h1">Revisar casos incertos</h1>
          <p className="lead">Contas achadas só pelo nome, ou de pessoas que ainda aparecem ativas no censo. Confira e decida — as decisões valem para as próximas planilhas.</p>
        </div>
        <div className="row">
          <SearchInput value={search} onChange={setSearch} />
          <label className="sr-only" htmlFor="rv-platform">Plataforma</label>
          <select id="rv-platform" className="select" value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="">Todas as plataformas</option>
            {PLATFORMS.map(p => <option key={p} value={p}>{PL[p]}</option>)}
          </select>
          <button type="button" className="btn btn--ghost" disabled={!items.length} onClick={() => exportCSV(items.map(m => ({
            matricula: m.matricula, nome: m.person_name, empresa: m.company, desligamento: fmtDate(m.termination_date),
            plataforma: PL[m.platform] || m.platform, conta: m.account_email, nome_na_conta: m.account_name, motivo: m.method, observacao: m.detail,
          })), `revisar-${new Date().toISOString().slice(0, 10)}.csv`)}><Download size={15} />CSV</button>
        </div>
      </div>

      {error && <Notice tone="danger" action={<button className="btn btn--sm" onClick={load}>Tentar de novo</button>}>{error}</Notice>}
      {loading ? <div className="empty"><Spinner /> Carregando…</div> : !error && groups.length === 0 ? (
        <div className="card"><Empty title="Nada para revisar">Todos os casos incertos já foram decididos.</Empty></div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {groups.map(g => (
            <article key={g.matricula} className="card">
              <div className="card__head">
                <div>
                  <div style={{ fontWeight: 600 }}>{g.person_name}</div>
                  <div className="xs muted">{g.company} · saiu {fmtDate(g.termination_date)} · <span className="mono">mat. {g.matricula}</span></div>
                </div>
                {g.detail && <Badge tone="warning">{g.detail.length > 70 ? g.detail.slice(0, 70) + '…' : g.detail}</Badge>}
              </div>
              <div>
                {g.matches.map(m => {
                  const k = `${m.matricula}|${m.platform}|${m.account_email}`;
                  return (
                    <div key={k} className="row" style={{ padding: '14px 20px', borderTop: '1px solid var(--line-soft)', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ minWidth: 260, flex: '1 1 300px' }}>
                        <div className="row" style={{ gap: 6 }}><PlatformTag platform={m.platform} /><span style={{ fontWeight: 500 }}>{m.account_name || '—'}</span></div>
                        <div className="mono small" style={{ color: 'var(--ink-2)', marginTop: 2 }}>{m.account_email}{m.account_status ? ` · ${m.account_status}` : ''}</div>
                      </div>
                      <div className="small muted" style={{ flex: '2 1 320px' }}>{m.method}</div>
                      <div className="row">
                        <button type="button" className="btn btn--sm btn--danger" disabled={busy === k} onClick={() => decide(m, 'confirmar')}><Check size={14} />É a pessoa</button>
                        <button type="button" className="btn btn--sm" disabled={busy === k} onClick={() => decide(m, 'rejeitar')}><X size={14} />Não é</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
