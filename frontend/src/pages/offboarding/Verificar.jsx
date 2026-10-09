import React, { useEffect, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { api } from '../../hooks/api.js';
import { useOffboarding } from '../../hooks/useOffboarding.jsx';
import { exportCSV } from '../../lib/csv.js';
import { PLATFORM_LABELS as PL } from '../../lib/platforms.js';
import { Badge, Empty, Notice, PlatformTag, SearchInput, Spinner, Tabs, fmtDate, fmtDateTime, useDebounced, useToast } from '../../components/ui.jsx';

const ACT_STATUS = {
  ok: ['Feito', 'success'], manual: ['Feito (manual)', 'success'], simulado: ['Simulado', 'info'],
  erro: ['Erro', 'danger'], bloqueado: ['Bloqueado', 'warning'], alerta: ['Voltou a ficar ativa', 'priority'],
};
const ACTION_LABEL = { desativar: 'Desativar', reativar: 'Reativar', modo: 'Modo', revertido: 'Verificação' };
const PERSON_STATUS = {
  agir: ['Remover', 'danger'], revisar: ['Revisar', 'warning'], recontratado: ['Recontratado', 'success'],
  sem_conta: ['Sem conta ativa', undefined], fora_da_gestao: ['Fora da gestão', undefined],
};

function ActionsTable({ rows, onReactivate, busy }) {
  return (
    <div className="table-wrap">
      <table className="table" style={{ minWidth: 820 }}>
        <thead><tr><th>Quando</th><th>Pessoa</th><th>Conta</th><th>Ação</th><th>Resultado</th><th>Por</th><th><span className="sr-only">Desfazer</span></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7}><Empty title="Nada registrado" /></td></tr>}
          {rows.map(a => {
            const [label, tone] = ACT_STATUS[a.status] || [a.status];
            return (
              <tr key={a.id}>
                <td className="mono xs" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td>
                <td>{a.person_name || '—'}{a.matricula && <div className="xs muted mono">{a.matricula}</div>}</td>
                <td>{a.action === 'modo' ? '—' : <div className="row" style={{ gap: 6 }}><PlatformTag platform={a.platform} /><span className="mono xs">{a.account_email}</span></div>}</td>
                <td className="small">{ACTION_LABEL[a.action] || a.action}</td>
                <td style={{ maxWidth: 340 }}><Badge tone={tone}>{label}</Badge><div className="xs muted" style={{ marginTop: 4 }}>{a.detail}</div></td>
                <td className="mono xs muted">{a.actor}</td>
                <td>{a.can_reactivate && <button type="button" className="btn btn--sm" disabled={busy === a.id} onClick={() => onReactivate(a)}><RotateCcw size={13} />Reativar</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Verificar() {
  const { refresh } = useOffboarding();
  const [tab, setTab] = useState('alerts');
  const [actions, setActions] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [toast, showToast] = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    const p = q ? `?search=${encodeURIComponent(q)}` : '';
    try {
      const [a, t] = await Promise.all([api.get(`/offboarding/actions${p}`, { noCache: true }), api.get(`/users/terminated${p}`, { noCache: true })]);
      setActions(a); setPeople(t);
    } catch (e) { setError(e.message || 'Erro ao carregar.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [q]);

  const alerts = actions.filter(a => a.status === 'alerta' || a.status === 'erro');

  const reactivate = async (a) => {
    if (!window.confirm(`Reativar ${a.account_email} (${PL[a.platform] || a.platform})? O match será marcado como "Não é a pessoa".`)) return;
    setBusy(a.id);
    try { const r = await api.post('/offboarding/reactivate', { action_id: a.id }); showToast(r.message || 'Reativada.'); load(); refresh(); }
    catch (e) { showToast(e.message || 'Erro ao reativar.', true); }
    finally { setBusy(null); }
  };

  const downloadAdScript = async () => {
    const r = await fetch('/api/offboarding/ad-local-script');
    const url = URL.createObjectURL(await r.blob());
    const el = document.createElement('a'); el.href = url; el.download = 'desativar-ad-local.ps1';
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const exportReport = () => exportCSV(people.map(u => ({
    matricula: u.matricula, nome: u.name, empresa: u.department, cargo: u.cargo, desligamento: fmtDate(u.termination_date),
    situacao: (PERSON_STATUS[u.match_status] || [u.match_status])[0], detalhe: u.match_detail, contas_desativadas: (u.deactivated || []).join(' | '),
  })), `relatorio-desligados-${new Date().toISOString().slice(0, 10)}.csv`);

  return (
    <>
      {toast}
      <div className="page-header">
        <div>
          <h1 className="h1">Verificar</h1>
          <p className="lead">Confira se o que foi desativado continua desativado, veja o histórico de tudo que foi feito e exporte o relatório do mês.</p>
        </div>
        <SearchInput value={search} onChange={setSearch} />
      </div>

      <Tabs label="Seções" value={tab} onChange={setTab} tabs={[
        { value: 'alerts', label: 'Alertas', count: alerts.length, tone: alerts.length ? 'priority' : undefined },
        { value: 'history', label: 'Histórico' },
        { value: 'report', label: 'Relatório dos desligados' },
      ]} />

      {error && <Notice tone="danger" action={<button className="btn btn--sm" onClick={load}>Tentar de novo</button>}>{error}</Notice>}
      {loading ? <div className="empty"><Spinner /> Carregando…</div> : !error && (
        <>
          {tab === 'alerts' && (
            <div className="stack" style={{ gap: 12 }}>
              {alerts.some(a => a.status === 'alerta') && (
                <Notice tone="warning" action={<button type="button" className="btn btn--sm btn--dark" onClick={downloadAdScript}><Download size={14} />Script AD local</button>}>
                  Contas que voltaram a ficar ativas depois de desativadas pelo painel. Quase sempre são do <strong>AD local</strong>: o Entra Connect reativa pela nuvem. Desative no Active Directory com o script.
                </Notice>
              )}
              {alerts.length === 0 ? <div className="card"><Empty title="Nenhum alerta">Tudo que foi desativado continua desativado.</Empty></div>
                : <ActionsTable rows={alerts} onReactivate={reactivate} busy={busy} />}
            </div>
          )}
          {tab === 'history' && <ActionsTable rows={actions} onReactivate={reactivate} busy={busy} />}
          {tab === 'report' && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="small muted">Todos os desligados importados, com a situação de cada um. Bom para devolver ao RH.</span>
                <button type="button" className="btn" onClick={exportReport} disabled={!people.length}><Download size={15} />Exportar relatório</button>
              </div>
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 860 }}>
                  <thead><tr><th>Pessoa</th><th>Cargo</th><th>Situação</th><th>Detalhe</th><th>Desativadas</th></tr></thead>
                  <tbody>
                    {people.length === 0 && <tr><td colSpan={5}><Empty title="Nenhum desligado importado">Importe a planilha do RH na etapa 1.</Empty></td></tr>}
                    {people.map(u => {
                      const [label, tone] = PERSON_STATUS[u.match_status] || [u.match_status || '—'];
                      return (
                        <tr key={u.matricula}>
                          <td><div style={{ fontWeight: 600 }}>{u.name}</div><div className="xs muted">{u.department} · saiu {fmtDate(u.termination_date)} · <span className="mono">{u.matricula}</span></div></td>
                          <td className="small muted">{u.cargo || '—'}</td>
                          <td><Badge tone={tone}>{label}</Badge></td>
                          <td className="small muted" style={{ maxWidth: 360 }}>{u.match_detail || '—'}</td>
                          <td className="mono xs" style={{ color: 'var(--success)' }}>{(u.deactivated || []).map(d => <div key={d}>{d}</div>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="table__foot">{people.length} desligados</div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
