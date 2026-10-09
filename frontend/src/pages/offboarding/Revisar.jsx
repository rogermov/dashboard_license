import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Download, Undo2 } from 'lucide-react';
import { api } from '../../hooks/api.js';
import { useOffboarding } from '../../hooks/useOffboarding.jsx';
import { exportCSV } from '../../lib/csv.js';
import { PLATFORMS, PLATFORM_LABELS as PL } from '../../lib/platforms.js';
import { Badge, Empty, Notice, PlatformTag, SearchInput, Segmented, Skeleton, Tabs, cx, fmtDate, fmtDateTime, useDebounced, useToast } from '../../components/ui.jsx';

const mkey = m => `${m.matricula}|${m.platform}|${m.account_email}`;
const LEAVE_MS = 260; // casa com --dur-med (animação de saída)
const CARGO = { confere: ['Cargo confere', 'success'], diferente: ['Cargo diferente', 'priority'] };

export default function Revisar() {
  const { refresh } = useOffboarding();
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [busy, setBusy] = useState(null);
  const [leaving, setLeaving] = useState(() => new Set());
  const [cargo, setCargo] = useState('all');
  const q = useDebounced(search);
  const [toast, showToast] = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    const p = new URLSearchParams(); if (q) p.append('search', q); if (platform) p.append('platform', platform);
    try {
      const [rv, dc] = await Promise.all([
        api.get(`/offboarding/review?${p}`, { noCache: true }),
        api.get(`/offboarding/decisions${q ? `?search=${encodeURIComponent(q)}` : ''}`, { noCache: true }),
      ]);
      setItems(rv); setDecisions(platform ? dc.filter(d => d.platform === platform) : dc);
    } catch (e) { setError(e.message || 'Erro ao carregar.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [q, platform]);

  // Agrupa por pessoa: decidir olhando todas as contas candidatas dela juntas.
  const groups = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (cargo !== 'all' && (it.cargo_check || 'sem') !== cargo) continue;
      if (!m.has(it.matricula)) m.set(it.matricula, { ...it, matches: [] });
      m.get(it.matricula).matches.push(it);
    }
    return [...m.values()];
  }, [items, cargo]);
  const cargoCount = v => items.filter(i => (i.cargo_check || 'sem') === v).length;
  const visible = groups.flatMap(g => g.matches);

  // "Não é a pessoa" para todos os visíveis (ex.: filtro Cargo diferente). Desfaz pela aba Decididos.
  const rejectAll = async () => {
    if (!window.confirm(`Marcar ${visible.length} conta(s) como "Não é a pessoa"? Dá para desfazer na aba Decididos.`)) return;
    const done = [];
    for (const m of visible) {
      try {
        await api.post('/offboarding/decision', { matricula: m.matricula, platform: m.platform, account_email: m.account_email, decision: 'rejeitar' });
        done.push(m);
      } catch { /* segue com os demais */ }
    }
    showToast(`${done.length} conta(s) marcadas como "Não é a pessoa".`, done.length < visible.length, {
      label: 'Desfazer', onClick: async () => {
        for (const m of done) await api.post('/offboarding/decision', { matricula: m.matricula, platform: m.platform, account_email: m.account_email, decision: 'desfazer' }).catch(() => {});
        load(); refresh();
      },
    });
    load(); refresh();
  };

  const undo = async (d) => {
    try {
      await api.post('/offboarding/decision', { matricula: d.matricula, platform: d.platform, account_email: d.account_email, decision: 'desfazer' });
      showToast(`Decisão desfeita: ${d.account_email} voltou para a revisão.`);
      await load(); refresh();
    } catch (e) { showToast(e.message || 'Erro ao desfazer.', true); }
  };

  const decide = async (m, decision) => {
    const k = mkey(m); setBusy(k);
    try {
      await api.post('/offboarding/decision', { matricula: m.matricula, platform: m.platform, account_email: m.account_email, decision });
      setLeaving(s => new Set(s).add(k));
      setTimeout(() => {
        setItems(list => list.filter(x => mkey(x) !== k));
        setLeaving(s => { const n = new Set(s); n.delete(k); return n; });
      }, LEAVE_MS);
      setDecisions(list => [{ ...m, decision, decided_at: new Date().toISOString().replace('T', ' ').slice(0, 19), decided_by: 'você' },
        ...list.filter(x => mkey(x) !== k)]);
      showToast(decision === 'confirmar' ? `Confirmado: ${m.account_email} foi para "Remover acesso".` : `Descartado: ${m.account_email} não é ${m.person_name}.`,
        false, { label: 'Desfazer', onClick: () => undo(m) });
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
          <p className="lead">Contas achadas só pelo nome, ou de pessoas que ainda aparecem ativas no censo. Clicou errado? Use <strong>Desfazer</strong> no aviso ou na aba Decididos.</p>
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

      <Tabs label="Revisão" value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: 'Pendentes', count: items.length, tone: items.length ? 'warning' : undefined },
        { value: 'decided', label: 'Decididos', count: decisions.length },
      ]} />

      {error && <Notice tone="danger" action={<button className="btn btn--sm" onClick={load}>Tentar de novo</button>}>{error}</Notice>}
      {!loading && !error && tab === 'pending' && items.length > 0 && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <Segmented label="Cargo" value={cargo} onChange={setCargo} options={[
            { value: 'all', label: 'Todos', count: items.length },
            { value: 'diferente', label: 'Cargo diferente', count: cargoCount('diferente') },
            { value: 'confere', label: 'Cargo confere', count: cargoCount('confere') },
            { value: 'sem', label: 'Sem cargo na conta', count: cargoCount('sem') },
          ]} />
          {cargo === 'diferente' && visible.length > 0 && (
            <button type="button" className="btn" onClick={rejectAll}><X size={15} />Não é a pessoa — todos os {visible.length}</button>
          )}
        </div>
      )}
      {loading ? <Skeleton rows={4} height={96} /> : !error && tab === 'pending' && (
        groups.length === 0 ? <div className="card"><Empty title="Nada para revisar">Todos os casos incertos já foram decididos.</Empty></div> : (
          <div className="stack stagger" style={{ gap: 12 }}>
            {groups.map(g => (
              <article key={g.matricula} className={cx('card', g.matches.every(m => leaving.has(mkey(m))) && 'is-leaving')}>
                <div className="card__head">
                  <div>
                    <div style={{ fontWeight: 600 }}>{g.person_name}</div>
                    <div className="xs muted">{g.company} · saiu {fmtDate(g.termination_date)} · <span className="mono">mat. {g.matricula}</span></div>
                    {g.person_cargo && <div className="small" style={{ marginTop: 2 }}>Cargo no RH: <strong>{g.person_cargo}</strong></div>}
                  </div>
                  {g.detail && <Badge tone="warning">{g.detail.length > 70 ? g.detail.slice(0, 70) + '…' : g.detail}</Badge>}
                </div>
                <div>
                  {g.matches.map(m => {
                    const k = mkey(m);
                    return (
                      <div key={k} className={cx('row', leaving.has(k) && 'is-leaving')} style={{ padding: '14px 20px', borderTop: '1px solid var(--line-soft)', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ minWidth: 260, flex: '1 1 300px' }}>
                          <div className="row" style={{ gap: 6 }}><PlatformTag platform={m.platform} /><span style={{ fontWeight: 500 }}>{m.account_name || '—'}</span></div>
                          <div className="mono small" style={{ color: 'var(--ink-2)', marginTop: 2 }}>{m.account_email}{m.account_status ? ` · ${m.account_status}` : ''}</div>
                          <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                            <span className="muted">Cargo na conta:</span><span>{m.account_title || '—'}</span>
                            {CARGO[m.cargo_check] && <Badge tone={CARGO[m.cargo_check][1]}>{CARGO[m.cargo_check][0]}</Badge>}
                          </div>
                        </div>
                        <div className="small muted" style={{ flex: '2 1 320px' }}>{m.method.replace(/ · (⚠ )?cargo (confere|diferente)/, '')}</div>
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
        )
      )}

      {!loading && !error && tab === 'decided' && (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 820 }}>
            <thead><tr><th>Pessoa</th><th>Conta</th><th>Decisão</th><th>Quando / por</th><th><span className="sr-only">Desfazer</span></th></tr></thead>
            <tbody>
              {decisions.length === 0 && <tr><td colSpan={5}><Empty title="Nenhuma decisão ainda" /></td></tr>}
              {decisions.map(d => (
                <tr key={mkey(d)}>
                  <td><div style={{ fontWeight: 600 }}>{d.person_name || '—'}</div><div className="xs muted">{d.company} · <span className="mono">{d.matricula}</span></div></td>
                  <td><div className="row" style={{ gap: 6 }}><PlatformTag platform={d.platform} /><span className="mono xs">{d.account_email}</span></div></td>
                  <td>{d.decision === 'confirmar' ? <Badge tone="danger">É a pessoa → Remover</Badge> : <Badge>Não é a pessoa</Badge>}</td>
                  <td className="xs muted"><span className="mono">{fmtDateTime(d.decided_at)}</span>{d.decided_by ? ` · ${d.decided_by}` : ''}</td>
                  <td><button type="button" className="btn btn--sm" onClick={() => undo(d)}
                    title={d.decision === 'confirmar' ? 'Volta para a revisão. Se a conta já foi desativada, reative em Verificar → Histórico.' : 'Volta para a revisão.'}>
                    <Undo2 size={14} />Desfazer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table__foot">{decisions.length} decisões</div>
        </div>
      )}
    </>
  );
}
