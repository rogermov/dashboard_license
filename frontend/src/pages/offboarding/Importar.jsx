import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, RefreshCw, Link2, ArrowRight } from 'lucide-react';
import { api } from '../../hooks/api.js';
import { useOffboarding } from '../../hooks/useOffboarding.jsx';
import { Notice, Spinner, cx, useToast } from '../../components/ui.jsx';

// Sistemas sem API: lista de usuários exportada à mão.
const CSV_PLATFORMS = [
  { id: 'lucid', label: 'Lucid', hint: 'Admin → Usuários → Export' },
  { id: 'bitbucket', label: 'Bitbucket', hint: 'Settings → User management → Export' },
  { id: 'jira', label: 'Jira', hint: 'Admin → User management → Export users' },
];
const SYNCS = [
  { endpoint: '/microsoft365/sync', label: 'Microsoft 365' },
  { endpoint: '/google/sync', label: 'Google Workspace' },
  { endpoint: '/docusign/sync', label: 'DocuSign' },
];

function DropZone({ platform, hint, onDone }) {
  const [state, setState] = useState(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef();
  const upload = async (file) => {
    if (!file) return;
    setState({ loading: true });
    const fd = new FormData(); fd.append('platform', platform); fd.append('file', file);
    try { const r = await api.postForm('/import/platform/csv', fd); setState({ ok: true, msg: r.message }); onDone(r.message); }
    catch (e) { setState({ ok: false, msg: e.message || 'Erro ao importar.' }); }
  };
  return (
    <button type="button" className="card" onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}
      style={{ width: '100%', padding: 16, borderStyle: 'dashed', cursor: 'pointer', textAlign: 'center', background: dragging ? 'var(--brand-soft)' : 'var(--surface-2)' }}>
      <input ref={ref} type="file" accept=".csv,.xlsx" hidden onChange={e => upload(e.target.files[0])} />
      {state?.loading ? <span className="row" style={{ justifyContent: 'center' }}><Spinner />Importando…</span>
        : state ? <span className="small" style={{ color: state.ok ? 'var(--success)' : 'var(--danger)' }}>{state.msg}</span>
        : <span className="stack" style={{ alignItems: 'center', gap: 2 }}><Upload size={18} color="var(--muted)" /><span className="small">Arraste o CSV ou clique</span><span className="xs muted">{hint}</span></span>}
    </button>
  );
}

function SyncButton({ endpoint, label, onDone }) {
  const [state, setState] = useState(null);
  const run = async () => {
    setState('loading');
    try { const r = await api.post(endpoint); setState('ok'); onDone(r.message); }
    catch (e) { setState('error'); onDone(e.message || `Erro no sync do ${label}`, true); }
  };
  return (
    <button type="button" className="btn btn--block" onClick={run} disabled={state === 'loading'}>
      {state === 'loading' ? <Spinner size={15} /> : <RefreshCw size={15} />}{label}{state === 'ok' && ' ✓'}
    </button>
  );
}

export default function Importar() {
  const { refresh } = useOffboarding();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [toast, showToast] = useToast();
  const done = (msg, err) => { showToast(msg, err); refresh(); };

  const importSheet = async (e) => {
    e.preventDefault();
    if (!url.includes('docs.google.com/spreadsheets')) { setError('Cole o link da planilha do Google Sheets (docs.google.com/spreadsheets/...).'); return; }
    setLoading(true); setError(null); setResult(null);
    const fd = new FormData(); fd.append('url', url);
    try { setResult(await api.postForm('/offboarding/import', fd)); refresh(); }
    catch (err) { setError(err.message || 'Erro ao importar. Verifique se a planilha está compartilhada por link.'); }
    finally { setLoading(false); }
  };

  const tiles = result && [
    ['Remover (certeza)', result.agir, 'var(--danger)'], ['Revisar', result.revisar, 'var(--priority)'],
    ['Recontratados', result.recontratados, 'var(--success)'], ['Sem conta ativa', result.sem_conta, 'var(--muted)'],
  ];

  return (
    <>
      {toast}
      <div className="page-header">
        <div>
          <h1 className="h1">Importar planilha do RH</h1>
          <p className="lead">Cole o link que chega todo mês. As abas são reconhecidas sozinhas (Desligados e Geral) e o cruzamento com os sistemas é feito na hora.</p>
        </div>
      </div>

      <form className="card card__body stack" style={{ gap: 12 }} onSubmit={importSheet}>
        <label className="field">
          <span className="field__label">Link da planilha do mês</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="search" style={{ flex: 1 }}>
              <Link2 size={16} aria-hidden="true" />
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
            </span>
            <button type="submit" className="btn btn--primary" disabled={loading}>{loading ? <Spinner size={15} /> : <Upload size={15} />}{loading ? 'Importando…' : 'Importar'}</button>
          </div>
        </label>
        <span className="xs muted">Importar de novo é seguro: o histórico é acumulado e as decisões da revisão são mantidas.</span>
        {error && <Notice tone="danger">{error}</Notice>}
        {result && (
          <div className="stack" style={{ gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {tiles.map(([l, v, c]) => (
                <div key={l} className="card" style={{ padding: '12px 14px', background: 'var(--surface-2)' }}>
                  <div className="xs muted">{l}</div><div style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: c }}>{v ?? 0}</div>
                </div>
              ))}
            </div>
            <span className="small muted">{result.importados} desligados lidos da planilha · histórico acumulado: {result.pessoas} pessoas</span>
            {!result.censo && <Notice tone="warning">Aba <strong>Geral</strong> (censo) não encontrada: recontratações não foram verificadas.</Notice>}
            <div className="row">
              {result.revisar > 0 && <Link to="/offboarding/revisar" className="btn">Revisar {result.revisar} casos <ArrowRight size={15} /></Link>}
              <Link to="/offboarding/remover" className={cx('btn', 'btn--primary')}>Ir para Remover acesso <ArrowRight size={15} /></Link>
            </div>
          </div>
        )}
      </form>

      <div className="page-header"><div><h2 className="h2">Atualizar os sistemas agora</h2><p className="lead">Roda sozinho às 07h30 em dias úteis. Use se precisar do estado atual antes disso.</p></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {SYNCS.map(s => <SyncButton key={s.endpoint} {...s} onDone={done} />)}
      </div>

      <div className="page-header"><div><h2 className="h2">Sistemas sem integração</h2><p className="lead">Exporte a lista de usuários e solte aqui. O cruzamento usa os e-mails descobertos no Microsoft 365.</p></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {CSV_PLATFORMS.map(p => (
          <div key={p.id} className="stack" style={{ gap: 6 }}>
            <span className="small" style={{ fontWeight: 600 }}>{p.label}</span>
            <DropZone platform={p.id} hint={p.hint} onDone={done} />
          </div>
        ))}
      </div>
    </>
  );
}
