import React, { useEffect, useState } from 'react';
import { X, Wrench, CheckCircle2, XCircle, ShieldCheck, Info } from 'lucide-react';
import { api } from '../hooks/api.js';
import { useOffboarding } from '../hooks/useOffboarding.jsx';
import { Badge, Notice, Skeleton, Spinner, cx } from './ui.jsx';

// Corrige gaps de licença do DocuSign: licença Free + perfil DocuSign Viewer.
// 1º mostra a prévia (não registra nada); depois aplica (ou simula, no modo simulação).
const STATUS = {
  previsto: ['Será corrigido', 'info', Info], simulado: ['Simulado', 'info', CheckCircle2], ok: ['Corrigido', 'success', CheckCircle2],
  erro: ['Erro', 'danger', XCircle], bloqueado: ['Protegido', 'warning', ShieldCheck],
};

export default function GapFixModal({ onClose, onDone }) {
  const { config } = useOffboarding();
  const real = !!config?.enabled;
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    api.post('/docusign/gaps/fix', { mode: 'preview' }).then(setPlan).catch(e => setError(e.message || 'Erro ao montar a prévia.'));
  }, []);

  const rows = (result || plan)?.results || [];
  const toFix = (plan?.results || []).filter(r => r.status === 'previsto');
  const canRun = !running && toFix.length > 0 && (!real || typed.trim().toUpperCase() === 'CORRIGIR');

  const run = async () => {
    setRunning(true); setError(null);
    try { setResult(await api.post('/docusign/gaps/fix', { mode: real ? 'aplicar' : 'simular', emails: toFix.map(r => r.email) })); }
    catch (e) { setError(e.message || 'Erro ao corrigir.'); }
    finally { setRunning(false); }
  };
  const close = result ? onDone : onClose;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !running) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gap-title">
        <div className="modal__head">
          <div className="row"><Wrench size={18} color="var(--priority)" /><h2 id="gap-title" className="h2">Corrigir gaps de licença</h2></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={close} disabled={running} aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="modal__body">
          <div style={{ marginBottom: 12 }}>
            <Notice>Contas com licença <strong>Professional</strong> cujo perfil não permite enviar. Cada uma vai para licença <strong>Free</strong> e perfil <strong>DocuSign Viewer</strong>.
              Ficam de fora: o grupo <strong>nao_modificar</strong> (conta sem o grupo é pulada inteira), administradores e as contas protegidas do painel. Dá para desfazer em Offboarding → Verificar → Histórico.</Notice>
          </div>
          {!real && <div style={{ marginBottom: 12 }}><Notice tone="warning">Modo <strong>simulação</strong>: nada será alterado no DocuSign. Para valer, ligue o <strong>Modo real</strong> no topo.</Notice></div>}
          {error && <div style={{ marginBottom: 12 }}><Notice tone="danger">{error}</Notice></div>}
          {!plan && !error ? <Skeleton rows={5} height={40} /> : (
            <table className="table">
              <thead><tr><th>Usuário</th><th>Conta</th><th>Perfil atual</th><th>{result ? 'Resultado' : 'O que acontece'}</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={4} className="small muted">Nenhum gap de licença. 🎉</td></tr>}
                {rows.map(r => {
                  const [label, tone, Icon] = STATUS[r.status] || [r.status];
                  return (
                    <tr key={r.account_name + r.email}>
                      <td>{r.name || '—'}<div className="mono xs muted">{r.email}</div></td>
                      <td className="small">{r.account_name}</td>
                      <td className="small">{r.profile || '—'}</td>
                      <td className="small" style={{ maxWidth: 300 }}><Badge tone={tone}>{Icon && <Icon size={12} />}{label}</Badge><div className="xs muted" style={{ marginTop: 3 }}>{r.detail}</div></td>
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
              <span className="small">{result.real ? 'Concluído' : 'Simulação concluída'}: <strong>{result.real ? result.ok : rows.filter(r => r.status === 'simulado').length} {result.real ? 'corrigidos' : 'simulados'}</strong>
                {result.errors ? `, ${result.errors} com erro` : ''}. Registrado em Verificar → Histórico.</span>
              <button type="button" className="btn btn--primary" onClick={onDone}>Fechar</button>
            </div>
          ) : (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{plan ? `${toFix.length} para corrigir · ${plan.protegidos} protegidos${plan.errors ? ` · ${plan.errors} com erro` : ''}` : ''}</span>
              <div className="row">
                {real && toFix.length > 0 && (
                  <label className="row small">Digite <strong>CORRIGIR</strong>:
                    <input className="input" style={{ height: 34, width: 130 }} value={typed} onChange={e => setTyped(e.target.value)} aria-label="Digite CORRIGIR para confirmar" />
                  </label>
                )}
                <button type="button" className="btn" onClick={onClose} disabled={running}>Cancelar</button>
                <button type="button" className={cx('btn', real ? 'btn--priority' : 'btn--primary')} onClick={run} disabled={!canRun}>
                  {running && <Spinner size={14} />}{real ? `Corrigir ${toFix.length}` : `Simular ${toFix.length}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
