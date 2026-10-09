import React, { useEffect, useMemo, useState } from 'react';
import { Download, Power, X } from 'lucide-react';
import { api } from '../../hooks/api.js';
import { useOffboarding } from '../../hooks/useOffboarding.jsx';
import { exportCSV } from '../../lib/csv.js';
import { PLATFORMS, PLATFORM_LABELS as PL } from '../../lib/platforms.js';
import DeactivateModal from '../../components/DeactivateModal.jsx';
import { Badge, Empty, Notice, PlatformTag, SearchInput, Segmented, Spinner, cx, fmtDate, useDebounced, useToast } from '../../components/ui.jsx';

// Em qual faixa cada conta cai. A ordem das faixas é a ordem de prioridade.
const isTenant = e => /onmicrosoft\.com$/i.test(e || '');
const laneOf = a => (a.ad_local ? 'ad' : isTenant(a.email) ? 'tenant' : 'priority');
const LANES = [
  { id: 'priority', title: 'Com domínio da empresa', desc: 'E-mail corporativo ainda ativo. Comece por aqui.', selectable: true },
  { id: 'ad', title: 'AD local — via script', desc: 'O Entra Connect reativa pela nuvem. Desative no Active Directory.', selectable: false },
  { id: 'tenant', title: 'Contas @onmicrosoft', desc: 'Contas por matrícula, sem e-mail corporativo.', selectable: true },
];
const LANE_PREVIEW = 6;
const key = (mat, a) => `${mat}|${a.platform}|${a.email}`;

function AccountLine({ a }) {
  return (
    <div className="acc">
      <PlatformTag platform={a.platform} />
      <span className="acc__email" title={a.email}>{a.email}</span>
      {a.guest && <Badge tone="warning" title="Conta convidada (#EXT#): desativar só tira o acesso à holding; a caixa real fica em outro tenant.">convidado</Badge>}
      {a.ad_local && <Badge tone="danger" title="Sincronizada do AD local: desative no Active Directory.">AD local</Badge>}
    </div>
  );
}

function PersonCard({ p, accounts, selectable, selected, onToggle }) {
  const content = (
    <>
      <div className="pcard__top">
        <div>
          <div className="pcard__name">{p.name}</div>
          <div className="pcard__meta">{p.department} · saiu {fmtDate(p.termination_date)} · <span className="mono">{p.matricula}</span></div>
        </div>
        {selectable && <input type="checkbox" className="checkbox" checked={selected} onChange={onToggle} onClick={e => e.stopPropagation()} aria-label={`Selecionar ${p.name}`} />}
      </div>
      <div className="pcard__accounts">{accounts.map(a => <AccountLine key={a.platform + a.email} a={a} />)}</div>
    </>
  );
  if (!selectable) return <article className="pcard" style={{ cursor: 'default' }}>{content}</article>;
  return <article className={cx('pcard', selected && 'is-selected')} onClick={onToggle}>{content}</article>;
}

export default function Remover() {
  const { config, refresh } = useOffboarding();
  const [view, setView] = useState('board');
  const [laneFilter, setLaneFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const q = useDebounced(search);
  const [people, setPeople] = useState([]);
  const [licensed, setLicensed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [modalItems, setModalItems] = useState(null);
  const [toast, showToast] = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    const p = new URLSearchParams(); if (q) p.append('search', q); if (platform) p.append('platform', platform);
    try {
      const [risk, lic] = await Promise.all([
        api.get(`/users/risk?${p}`, { noCache: true }),
        api.get(`/offboarding/m365-licensed?${q ? `search=${encodeURIComponent(q)}` : ''}`, { noCache: true }).catch(() => []),
      ]);
      setPeople(risk); setLicensed(lic);
    } catch (e) { setError(e.message || 'Erro ao carregar.'); setPeople([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [q, platform]);

  // Pessoa → contas por faixa (respeitando o filtro de plataforma)
  const byLane = useMemo(() => {
    const out = { priority: [], ad: [], tenant: [] };
    for (const p of people) {
      const groups = {};
      for (const a of p.accounts || []) {
        if (platform && a.platform !== platform) continue;
        (groups[laneOf(a)] ||= []).push(a);
      }
      for (const [lane, accounts] of Object.entries(groups)) out[lane].push({ p, accounts });
    }
    return out;
  }, [people, platform]);
  const counts = Object.fromEntries(Object.entries(byLane).map(([k, v]) => [k, v.reduce((n, x) => n + x.accounts.length, 0)]));

  const toggleKeys = (keys, on) => setSelected(prev => {
    const n = new Set(prev); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n;
  });
  // Contas do AD local nunca entram na seleção (o painel não consegue desativá-las).
  const entryKeys = e => e.accounts.filter(a => !a.ad_local).map(a => key(e.p.matricula, a));
  const isEntrySelected = e => { const k = entryKeys(e); return k.length > 0 && k.every(x => selected.has(x)); };
  const laneKeys = id => byLane[id].flatMap(entryKeys);
  const laneAllSelected = id => laneKeys(id).length > 0 && laneKeys(id).every(k => selected.has(k));

  const selectedItems = useMemo(() => people.flatMap(p => (p.accounts || [])
    .filter(a => selected.has(key(p.matricula, a)))
    .map(a => ({ matricula: p.matricula, person_name: p.name, platform: a.platform, account_email: a.email }))), [people, selected]);
  const selectedPeople = new Set(selectedItems.map(i => i.matricula)).size;

  const downloadAdScript = async () => {
    try {
      const r = await fetch('/api/offboarding/ad-local-script');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const el = document.createElement('a'); el.href = url; el.download = 'desativar-ad-local.ps1';
      document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Script baixado. Abra no PowerShell ISE e siga as instruções do topo do arquivo.');
    } catch (e) { showToast(e.message || 'Erro ao gerar o script.', true); }
  };

  const exportRows = () => exportCSV(people.flatMap(p => (p.accounts || []).map(a => ({
    matricula: p.matricula, nome: p.name, empresa: p.department, desligamento: fmtDate(p.termination_date),
    plataforma: PL[a.platform] || a.platform, conta: a.email, faixa: LANES.find(l => l.id === laneOf(a)).title,
    como_identificado: a.method,
  }))), `remover-acesso-${new Date().toISOString().slice(0, 10)}.csv`);

  const listRows = laneFilter === 'all' ? people.map(p => ({ p, accounts: (p.accounts || []).filter(a => !platform || a.platform === platform) })).filter(e => e.accounts.length) : byLane[laneFilter];

  return (
    <>
      {toast}
      <div className="page-header">
        <div>
          <h1 className="h1">Remover acesso</h1>
          <p className="lead">Desligados com conta ainda ativa, identificados com certeza (matrícula ou e-mail do RH). Selecione e desative.</p>
        </div>
        <div className="row">
          <SearchInput value={search} onChange={setSearch} />
          <label className="sr-only" htmlFor="flt-platform">Plataforma</label>
          <select id="flt-platform" className="select" value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="">Todas as plataformas</option>
            {PLATFORMS.map(p => <option key={p} value={p}>{PL[p]}</option>)}
          </select>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <Segmented label="Visualização" value={view} onChange={setView} options={[
          { value: 'board', label: 'Por prioridade' },
          { value: 'list', label: 'Lista' },
          { value: 'licensed', label: 'Licenças pagas', count: licensed.length },
        ]} />
        <button type="button" className="btn btn--ghost" onClick={exportRows} disabled={!people.length}><Download size={15} />Exportar CSV</button>
      </div>

      {error && <Notice tone="danger" action={<button className="btn btn--sm" onClick={load}>Tentar de novo</button>}>{error}</Notice>}
      {loading && <div className="empty"><Spinner /> Carregando…</div>}

      {!loading && !error && view === 'board' && (
        people.length === 0 ? <div className="card"><Empty title="Nenhum desligado com acesso ativo">Tudo limpo por aqui.</Empty></div> :
        <div className="lanes">
          {LANES.map(l => {
            const entries = byLane[l.id];
            return (
              <section key={l.id} className={`lane lane--${l.id}`} aria-labelledby={`lane-${l.id}`}>
                <div className="lane__head">
                  <div className="lane__title"><span className="lane__dot" /><h2 id={`lane-${l.id}`}>{l.title}</h2><span className="mono small muted">{counts[l.id]}</span></div>
                  <p className="lane__desc">{l.desc}</p>
                </div>
                <div className="lane__list">
                  {entries.length === 0 && <div className="small muted" style={{ padding: '8px 4px' }}>Nenhuma conta nesta faixa.</div>}
                  {entries.slice(0, LANE_PREVIEW).map(e => (
                    <PersonCard key={e.p.matricula} p={e.p} accounts={e.accounts} selectable={l.selectable}
                      selected={isEntrySelected(e)} onToggle={() => toggleKeys(entryKeys(e), !isEntrySelected(e))} />
                  ))}
                  {entries.length > LANE_PREVIEW && (
                    <button type="button" className="lane__more" onClick={() => { setLaneFilter(l.id); setView('list'); }}>
                      Ver todas ({entries.length} pessoas)
                    </button>
                  )}
                </div>
                {entries.length > 0 && (
                  <div className="lane__foot">
                    {l.selectable ? (
                      <button type="button" className={cx('btn btn--block', l.id === 'priority' ? 'btn--priority' : '')}
                        onClick={() => toggleKeys(laneKeys(l.id), !laneAllSelected(l.id))}>
                        {laneAllSelected(l.id) ? 'Desmarcar todas' : `Selecionar todas (${counts[l.id]})`}
                      </button>
                    ) : (
                      <button type="button" className="btn btn--dark btn--block" onClick={downloadAdScript}><Download size={15} />Baixar script PowerShell</button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {!loading && !error && view === 'list' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Segmented label="Faixa" value={laneFilter} onChange={setLaneFilter} options={[
              { value: 'all', label: 'Todas' },
              ...LANES.map(l => ({ value: l.id, label: l.title, count: counts[l.id] })),
            ]} />
          </div>
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 760 }}>
              <thead><tr><th style={{ width: 40 }}><span className="sr-only">Selecionar</span></th><th>Pessoa</th><th>Contas ativas</th><th>Saiu em</th></tr></thead>
              <tbody>
                {listRows.length === 0 && <tr><td colSpan={4}><Empty title="Nada nesta faixa" /></td></tr>}
                {listRows.map(e => {
                  const sel = isEntrySelected(e);
                  const selectable = e.accounts.some(a => !a.ad_local);
                  return (
                    <tr key={e.p.matricula + laneFilter} className={sel ? 'is-selected' : ''}>
                      <td>{selectable && <input type="checkbox" className="checkbox" checked={sel} onChange={() => toggleKeys(entryKeys(e), !sel)} aria-label={`Selecionar ${e.p.name}`} />}</td>
                      <td><div style={{ fontWeight: 600 }}>{e.p.name}</div><div className="xs muted">{e.p.department} · <span className="mono">{e.p.matricula}</span></div></td>
                      <td><div className="stack" style={{ gap: 4 }}>{e.accounts.map(a => <AccountLine key={a.platform + a.email} a={a} />)}</div></td>
                      <td className="mono small">{fmtDate(e.p.termination_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="table__foot">{listRows.length} pessoas</div>
          </div>
        </>
      )}

      {!loading && !error && view === 'licensed' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Notice>Contas do Microsoft 365 de desligados que ainda consomem <strong>licença paga</strong>. Pacotes com Office aparecem primeiro. Itens "Revisar" precisam ser confirmados na etapa 2.</Notice>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 720 }}>
              <thead><tr><th>Pessoa</th><th>Conta</th><th>Licenças</th><th>Situação</th></tr></thead>
              <tbody>
                {licensed.length === 0 && <tr><td colSpan={4}><Empty title="Nenhum desligado com licença paga">Nada consumindo licença por aqui.</Empty></td></tr>}
                {licensed.map(m => (
                  <tr key={m.matricula + m.account_email}>
                    <td><div style={{ fontWeight: 600 }}>{m.person_name}</div><div className="xs muted">{m.company} · <span className="mono">{m.matricula}</span></div></td>
                    <td className="mono small">{m.account_email}</td>
                    <td><div className="row" style={{ gap: 4 }}>{m.licenses.map(l => <Badge key={l} tone={m.office.includes(l) ? 'priority' : undefined}>{m.office.includes(l) ? '★ ' : ''}{l}</Badge>)}</div></td>
                    <td>{m.confidence === 'agir' ? <Badge tone="danger">Remover</Badge> : <Badge tone="warning">Revisar</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedItems.length > 0 && (
        <div className="selbar" role="region" aria-label="Contas selecionadas">
          <span className="small"><strong>{selectedItems.length} conta{selectedItems.length > 1 ? 's' : ''}</strong> · {selectedPeople} pessoa{selectedPeople > 1 ? 's' : ''}</span>
          <button type="button" className="btn btn--sm btn--on-dark" onClick={() => setSelected(new Set())}><X size={14} />Limpar</button>
          <button type="button" className={cx('btn', config?.enabled ? 'btn--danger' : 'btn--primary')} onClick={() => setModalItems(selectedItems)}>
            <Power size={15} />{config?.enabled ? `Desativar ${selectedItems.length} conta${selectedItems.length > 1 ? 's' : ''}` : `Simular ${selectedItems.length}`}
          </button>
        </div>
      )}

      {modalItems && (
        <DeactivateModal items={modalItems} config={config} onClose={() => setModalItems(null)}
          onDone={() => { setModalItems(null); setSelected(new Set()); load(); refresh(); }} />
      )}
    </>
  );
}
