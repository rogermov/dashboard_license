import React, { useState } from 'react';
import { X, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../hooks/api.js';
import { Notice, PlatformTag, Spinner, cx } from './ui.jsx';

// Plataformas com desativação via API; as demais só são marcadas como feitas à mão.
export const API_PLATFORMS = ['365', 'google', 'docusign'];
const ACTION_TEXT = { '365': 'Bloquear entrada e derrubar sessões', google: 'Suspender conta', docusign: 'Fechar acesso (todas as contas)' };
const RESULT = {
  ok: ['var(--success)', CheckCircle2], manual: ['var(--success)', CheckCircle2], simulado: ['var(--info)', CheckCircle2],
  erro: ['var(--danger)', XCircle], bloqueado: ['var(--warning)', XCircle],
};

export default function DeactivateModal({ items, config, onClose, onDone }) {
  const [removeLic, setRemoveLic] = useState(false);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const real = !!config?.enabled;
  const has365 = items.some(i => i.platform === '365');
  const canRun = !running && (!real || typed.trim().toUpperCase() === 'DESATIVAR');
  const close = result ? onDone : onClose;

  const run = async (dryRun) => {
    setRunning(true); setError(null); setProgress(0);
    const size = config?.max_batch || 25; const all = []; let simulated = false;
    try {
      for (let i = 0; i < items.length; i += size) {
        const chunk = items.slice(i, i + size).map(({ matricula, platform, account_email }) => ({ matricula, platform, account_email }));
        const r = await api.post('/offboarding/deactivate', { items: chunk, remove_licenses: removeLic, dry_run: dryRun });
        all.push(...r.results); simulated = r.simulated; setProgress(Math.min(i + size, items.length));
      }
      setResult({ simulated, results: all });
    } catch (e) { setError(e.message || 'Erro ao executar.'); if (all.length) setResult({ simulated, results: all }); }
    finally { setRunning(false); }
  };
  const byKey = Object.fromEntries((result?.results || []).map(r => [`${r.matricula}|${r.platform}|${r.account_email}`, r]));
  const okCount = (result?.results || []).filter(r => ['ok', 'manual', 'simulado'].includes(r.status)).length;
  const errCount = (result?.results || []).filter(r => r.status === 'erro').length;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !running) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="deact-title">
        <div className="modal__head">
          <div className="row"><ShieldAlert size={18} color="var(--danger)" /><h2 id="deact-title" className="h2">Desativar {items.length} conta{items.length > 1 ? 's' : ''}</h2></div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={close} disabled={running} aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="modal__body">
          {!real && <div style={{ marginBottom: 12 }}><Notice>Modo <strong>simulação</strong>: nada será alterado nos sistemas, só registrado no histórico. Para valer, ligue o <strong>Modo real</strong> no topo da página.</Notice></div>}
          <table className="table">
            <thead><tr><th>Pessoa</th><th>Sistema</th><th>Conta</th><th>{result ? 'Resultado' : 'O que será feito'}</th></tr></thead>
            <tbody>
              {items.map(i => {
                const k = `${i.matricula}|${i.platform}|${i.account_email}`; const r = byKey[k]; const [c, Icon] = RESULT[r?.status] || [];
                return (
                  <tr key={k}>
                    <td>{i.person_name}<div className="xs muted mono">{i.matricula}</div></td>
                    <td><PlatformTag platform={i.platform} /></td>
                    <td className="mono xs">{i.account_email}</td>
                    <td className="small" style={{ color: r ? c : 'var(--muted)' }}>
                      {r ? <span className="row" style={{ gap: 4, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Icon size={14} style={{ flexShrink: 0, marginTop: 3 }} />{r.detail}</span>
                        : API_PLATFORMS.includes(i.platform) ? ACTION_TEXT[i.platform] + (i.platform === '365' && removeLic ? ' + remover licenças' : '') : 'Sem API: marcar como feito à mão'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal__foot">
          {error && <div style={{ marginBottom: 10 }}><Notice tone="danger">{error}</Notice></div>}
          {result ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">{result.simulated ? 'Simulação concluída' : 'Concluído'}: <strong>{okCount} ok</strong>{errCount ? `, ${errCount} com erro` : ''}. Tudo ficou registrado em Verificar → Histórico.</span>
              <button type="button" className="btn btn--primary" onClick={onDone}>Fechar</button>
            </div>
          ) : (
            <>
              {has365 && (
                <label className="row small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', marginBottom: 12 }}>
                  <input type="checkbox" className="checkbox" checked={removeLic} onChange={e => setRemoveLic(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>Também <strong>remover as licenças</strong> do Microsoft 365 (libera o custo). <span style={{ color: 'var(--danger)' }}>A caixa de e-mail é apagada 30 dias depois</span>; dá para devolver pelo Histórico antes disso.</span>
                </label>
              )}
              {real && (
                <label className="row small" style={{ marginBottom: 12 }}>
                  As contas serão desativadas <strong>agora</strong>. Para confirmar, digite <strong>DESATIVAR</strong>:
                  <input className="input" style={{ height: 34, width: 150 }} value={typed} onChange={e => setTyped(e.target.value)} aria-label="Digite DESATIVAR para confirmar" />
                </label>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                {running && <span className="row small muted"><Spinner size={14} />{progress}/{items.length}</span>}
                <button type="button" className="btn" onClick={onClose} disabled={running}>Cancelar</button>
                {real && <button type="button" className="btn" onClick={() => run(true)} disabled={running}>Só simular</button>}
                <button type="button" className={cx('btn', real ? 'btn--danger' : 'btn--primary')} onClick={() => run(!real)} disabled={!canRun}>{real ? 'Desativar agora' : 'Simular'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
