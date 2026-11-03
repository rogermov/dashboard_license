import React, { useEffect, useMemo, useState } from 'react';
import { X, UserMinus, CheckCircle2, XCircle, ShieldCheck, Info, Download } from 'lucide-react';
import { api } from '../hooks/api.js';
import { exportCSV } from '../lib/csv.js';
import { useOffboarding } from '../hooks/useOffboarding.jsx';
import { Badge, Notice, Skeleton, Spinner, cx } from './ui.jsx';

// Revisão mensal do DocuSign (substitui o script de downgrade): quem enviou menos de N
// envelopes no mês anterior vai para licença Free + perfil DocuSign Viewer.
// A lista já vem pronta; protegidos aparecem travados. Simula ou aplica só o que foi marcado.
const RESULT = {
  simulado: ['Simulado', 'info', CheckCircle2], ok: ['Alterado', 'success', CheckCircle2],
  erro: ['Erro', 'danger', XCircle], bloqueado: ['Protegido', 'warning', ShieldCheck],
};

export default function SemUsoModal({ onClose, onDone, onLoaded }) {
  const { config } = useOffboarding();
  const real = !!config?.enabled;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [conta, setConta] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    api.get('/docusign/sem-uso', { noCache: true })
      .then(d => { setData(d); setSel(new Set(d.rows.filter(r => r.status === 'elegivel').map(r => r.key))); onLoaded?.(d); })
      .catch(e => setError(e.message || 'Não foi possível montar a lista.'));
  }, []);

  const contas = useMemo(() => [...new Set((data?.rows || []).map(r => r.account_name))].sort(), [data]);
  const rows = (data?.rows || []).filter(r => !conta || r.account_name === conta);
  const visiveis = rows.filter(r => r.status === 'elegivel');
  const todosMarcados = visiveis.length > 0 && visiveis.every(r => sel.has(r.key));
  const escolhidos = (data?.rows || []).filter(r => r.status === 'elegivel' && sel.has(r.key));
  const canRun = !running && escolhidos.length > 0 && (!real || typed.trim().toUpperCase() === 'APLICAR');

  const toggle = key => setSel(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleAll = () => setSel(s => { const n = new Set(s); visiveis.forEach(r => todosMarcados ? n.delete(r.key) : n.add(r.key)); return n; });

  const run = async () => {
    setRunning(true); setError(null);
    try { setResult(await api.post('/docusign/sem-uso/aplicar', { mode: real ? 'aplicar' : 'simular', keys: escolhidos.map(r => r.key) })); }
    catch (e) { setError(e.message || 'Erro ao aplicar.'); }
    finally { setRunning(false); }
  };
  const close = result ? onDone : onClose;
  const exportar = () => exportCSV(rows.map(r => ({ Nome: r.name, Email: r.email, Conta: r.account_name, Licenca: r.licenca, Perfil: r.perfil,
    Envios: r.envios, 'Envios nesta conta': r.envios_conta, Situacao: r.status === 'elegivel' ? 'Na regra' : r.detalhe })), `docusign-sem-uso-${(data?.periodo || '').replace('/', '-')}.csv`);

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !running) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="semuso-title" style={{ width: 'min(980px, 100%)' }}>
        <div className="modal__head">
          <div className="row"><UserMinus size={18} color="var(--priority)" />
            <h2 id="semuso-title" className="h2">Licenças sem uso{data ? ` · ${data.periodo}` : ''}</h2></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={close} disabled={running} aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="modal__body">
          <div style={{ marginBottom: 12 }}>
            <Notice>Quem enviou <strong>menos de {data?.limite ?? 5} envelopes</strong> em {data?.periodo || 'o mês anterior'} (somando o maior volume entre as contas) vai para licença <strong>Free</strong> e perfil <strong>DocuSign Viewer</strong>.
              Ficam de fora: quem já é Viewer, quem entrou na conta durante o mês{data?.novos_ignorados ? ` (${data.novos_ignorados})` : ''}, o grupo <strong>nao_modificar</strong>, administradores e as contas protegidas do painel.
              Dá para desfazer em Offboarding → Verificar → Histórico.</Notice>
          </div>
          {!real && <div style={{ marginBottom: 12 }}><Notice tone="warning">Modo <strong>simulação</strong>: nada será alterado no DocuSign. Para valer, ligue o <strong>Modo real</strong> no topo.</Notice></div>}
          {error && <div style={{ marginBottom: 12 }}><Notice tone="danger">{error}</Notice></div>}

          {!data && !error && (
            <div className="stack" style={{ gap: 10 }}>
              <span className="small muted row" style={{ gap: 8 }}><Spinner size={14} />Contando os envelopes do mês em cada conta. Na primeira vez do mês pode levar até 2 minutos.</span>
              <Skeleton rows={6} height={40} />
            </div>
          )}

          {data && !result && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 8 }}>
                  <select className="input" style={{ height: 34 }} value={conta} onChange={e => setConta(e.target.value)} aria-label="Filtrar por conta">
                    <option value="">Todas as contas</option>{contas.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="small muted">{data.resumo.elegiveis} na regra ({data.resumo.professional} Professional) · {data.resumo.protegidos} protegidos</span>
                </div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={exportar}><Download size={14} />CSV</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr>
                    <th style={{ width: 36 }}><input type="checkbox" className="checkbox" checked={todosMarcados} onChange={toggleAll} aria-label="Marcar todos" disabled={!visiveis.length} /></th>
                    <th>Usuário</th><th>Conta</th><th>Hoje</th><th style={{ textAlign: 'right' }}>Envios</th><th>Situação</th>
                  </tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={6} className="small muted">Ninguém abaixo de {data.limite} envios em {data.periodo}.</td></tr>}
                    {rows.map(r => {
                      const ok = r.status === 'elegivel';
                      return (
                        <tr key={r.key} className={cx(ok && sel.has(r.key) && 'is-selected')} style={ok ? { cursor: 'pointer' } : { opacity: .6 }} onClick={() => ok && toggle(r.key)}>
                          <td><input type="checkbox" className="checkbox" checked={ok && sel.has(r.key)} disabled={!ok} onChange={() => toggle(r.key)} onClick={e => e.stopPropagation()} aria-label={`Marcar ${r.email}`} /></td>
                          <td>{r.name || '—'}<div className="mono xs muted">{r.email}</div></td>
                          <td className="small">{r.account_name}</td>
                          <td className="small">{r.licenca || '—'}<div className="xs muted">{r.perfil || '—'}</div></td>
                          <td className="mono small" style={{ textAlign: 'right' }}>{r.envios}{r.envios !== r.envios_conta && <div className="xs muted">{r.envios_conta} nesta</div>}</td>
                          <td className="small">{ok ? <Badge tone="info"><Info size={12} />Free + Viewer</Badge> : <><Badge tone={r.status === 'protegido' ? 'warning' : 'danger'}><ShieldCheck size={12} />{r.status === 'protegido' ? 'Protegido' : 'Erro'}</Badge><div className="xs muted" style={{ marginTop: 3 }}>{r.detalhe}</div></>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <table className="table">
              <thead><tr><th>Usuário</th><th>Conta</th><th>Resultado</th></tr></thead>
              <tbody>
                {result.results.map(r => {
                  const [label, tone, Icon] = RESULT[r.status] || [r.status];
                  return (
                    <tr key={r.account_name + r.email}>
                      <td>{r.name || '—'}<div className="mono xs muted">{r.email}</div></td>
                      <td className="small">{r.account_name}</td>
                      <td className="small" style={{ maxWidth: 360 }}><Badge tone={tone}>{Icon && <Icon size={12} />}{label}</Badge><div className="xs muted" style={{ marginTop: 3 }}>{r.detail}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal__foot">
          {result ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">{result.real ? 'Concluído' : 'Simulação concluída'}: <strong>{result.real ? result.ok : result.results.filter(r => r.status === 'simulado').length} {result.real ? 'alterados' : 'simulados'}</strong>
                {result.errors ? `, ${result.errors} com erro` : ''}{result.ignorados ? `, ${result.ignorados} saíram da regra desde a abertura` : ''}. Registrado em Verificar → Histórico.</span>
              <button type="button" className="btn btn--primary" onClick={onDone}>Fechar</button>
            </div>
          ) : (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{data ? `${escolhidos.length} marcado(s)` : ''}</span>
              <div className="row">
                {real && escolhidos.length > 0 && (
                  <label className="row small">Digite <strong>APLICAR</strong>:
                    <input className="input" style={{ height: 34, width: 120 }} value={typed} onChange={e => setTyped(e.target.value)} aria-label="Digite APLICAR para confirmar" />
                  </label>
                )}
                <button type="button" className="btn" onClick={onClose} disabled={running}>Cancelar</button>
                <button type="button" className={cx('btn', real ? 'btn--priority' : 'btn--primary')} onClick={run} disabled={!canRun}>
                  {running && <Spinner size={14} />}{real ? `Aplicar em ${escolhidos.length}` : `Simular ${escolhidos.length}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
