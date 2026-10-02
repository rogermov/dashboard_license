import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, Search, Download, Loader, User, BadgeCheck } from 'lucide-react';
import { api } from '../hooks/api.js';
import { exportCSV } from '../lib/csv.js';
import Toast from '../components/Toast.jsx';
import { useToast } from '../hooks/useToast.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

export default function Microsoft365() {
  const [status, setStatus] = useState(null);
  const [licenses, setLicenses] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLicense, setFilterLicense] = useState('');
  const [error, setError] = useState(null);
  const { toast, showToast } = useToast();

  const loadStatus = async () => { setLoading(true); try { setStatus(await api.get('/microsoft365/status', { noCache: true })); } catch { showToast('Erro ao carregar status.', false); } finally { setLoading(false); } };
  const loadLicenses = async () => { try { setLicenses(await api.get('/microsoft365/licenses', { noCache: true })); } catch { setLicenses([]); } };

  const loadUsers = async () => {
    setUsersLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (filterStatus) p.append('status', filterStatus);
      if (filterLicense) p.append('license', filterLicense);
      if (search) p.append('search', search);
      setUsers(await api.get(`/microsoft365/users?${p}`, { noCache: true }));
    } catch (e) {
      setError(e.message || 'Erro ao carregar os usuários.');
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => { loadStatus(); loadLicenses(); loadUsers(); }, []);
  useEffect(() => { loadUsers(); }, [filterStatus, filterLicense]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await api.postForm('/microsoft365/sync', new FormData());
      showToast(res.message, true);
      await loadStatus(); await loadLicenses(); await loadUsers();
    } catch (e) {
      showToast('Erro na sincronização. Verifique as credenciais no .env.', false);
    } finally {
      setSyncing(false);
    }
  };

  const uniqueLicenses = [...new Set(licenses.map(l => l.friendly_name))].filter(Boolean).sort();

  const renderLicenseBadges = (licStr) => {
    const names = (licStr || '').split(';').filter(Boolean);
    if (!names.length) return <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>Sem licença</span>;
    return <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{names.map((n, i) => (
      <span key={i} style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 600, fontFamily: 'var(--font-mono)', background: 'var(--blue-100)', color: 'var(--blue-600)', border: '1px solid color-mix(in srgb, var(--blue-600) 25%, transparent)' }}>{n}</span>
    ))}</div>;
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <Toast toast={toast} />
      <ErrorBanner message={error} onRetry={loadUsers} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div><h1 style={{ fontWeight: 700, fontSize: '1.5rem', color: 'var(--text)' }}>Microsoft 365</h1><p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginTop: 3 }}>Gestão de acessos e licenças do tenant</p></div>
        <button onClick={sync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}>{syncing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}Revalidar</button>
      </div>

      {!loading && status && !status.configured && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 'var(--radius-lg)', padding: '1rem 1.25rem', marginBottom: '1.25rem', color: 'var(--red)', fontSize: '0.85rem' }}>
          ⚠ Credenciais do Microsoft Graph não configuradas. Preencha MS_TENANT_ID, MS_CLIENT_ID e MS_CLIENT_SECRET no .env.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        {loading ? [1, 2, 3].map(i => <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', height: 90, boxShadow: 'var(--shadow-sm)' }} />) : status && (
          <>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', boxShadow: 'var(--shadow-sm)', borderTop: '3px solid var(--green)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}><CheckCircle size={14} color="var(--green)" /><span style={{ fontSize: '0.75rem', color: 'var(--text2)', fontWeight: 600 }}>ATIVOS</span></div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{status.active}</div>
            </div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', boxShadow: 'var(--shadow-sm)', borderTop: '3px solid var(--text3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}><XCircle size={14} color="var(--text3)" /><span style={{ fontSize: '0.75rem', color: 'var(--text2)', fontWeight: 600 }}>DESATIVADOS</span></div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{status.disabled}</div>
            </div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', boxShadow: 'var(--shadow-sm)' }}>
              {status.last_error ? <div style={{ fontSize: '0.7rem', color: 'var(--red)' }}>⚠ {status.last_error.slice(0, 100)}</div> : status.last_sync ? <div style={{ fontSize: '0.7rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>Sync: {status.last_sync.slice(0, 16).replace('T', ' ')}</div> : <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>Nunca sincronizado</div>}
            </div>
          </>
        )}
      </div>

      {licenses.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.85rem', marginBottom: '1.5rem' }}>
          {licenses.map(l => {
            const total = l.total || 0;
            const ratio = total > 0 ? l.consumed / total : 0;
            const pct = Math.min(100, ratio * 100);
            const over = total > 0 && l.consumed > total;      // estourou o limite
            const near = !over && ratio >= 0.9;                 // 90%+ dos assentos usados
            const color = over ? 'var(--red)' : near ? 'var(--yellow)' : 'var(--blue-400)';
            return (
              <div key={l.sku_id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.1rem', boxShadow: 'var(--shadow-sm)', borderTop: `3px solid ${color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}><BadgeCheck size={14} color="var(--blue-600)" /><span style={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.3 }}>{l.friendly_name}</span></div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{l.consumed} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text3)' }}>/ {total}</span></div>
                <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, marginTop: '0.5rem', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color }} />
                </div>
                {(over || near) && (
                  <div style={{ fontSize: '0.66rem', fontWeight: 600, color, marginTop: '0.4rem' }}>
                    {over ? `⚠ ${l.consumed - total} acima do limite` : '⚠ perto do limite (90%+)'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}><Search size={13} color="var(--text3)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }} /><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadUsers()} placeholder="Buscar por e-mail ou nome..." style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.82rem', color: 'var(--text)', outline: 'none' }} /></div>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '0.55rem 0.75rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.82rem', color: 'var(--text)', outline: 'none' }}><option value="">Todos os status</option><option value="active">Ativos</option><option value="disabled">Desativados</option></select>

          <select value={filterLicense} onChange={e => setFilterLicense(e.target.value)} style={{ padding: '0.55rem 0.75rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.82rem', color: 'var(--text)', outline: 'none' }}>
            <option value="">Todas as Licenças</option>
            {uniqueLicenses.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <button onClick={() => exportCSV(users, `microsoft365-${new Date().toISOString().slice(0, 10)}.csv`)} disabled={!users.length} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.85rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text2)', fontSize: '0.78rem', cursor: 'pointer', opacity: users.length ? 1 : 0.5 }}><Download size={13} />CSV</button>
        </div>
        {!search && !filterStatus && !filterLicense && status?.total > 500 && (
          <div style={{ padding: '0.6rem 1.25rem', fontSize: '0.75rem', color: 'var(--text3)', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
            Mostrando os primeiros 500 de {status.total} usuários. Use a busca ou os filtros para encontrar outros.
          </div>
        )}
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead><tr style={{ background: 'var(--bg3)' }}>{['Email', 'Nome', 'Status', 'Licenças', 'Sincronizado em'].map(h => <th key={h} style={{ padding: '0.65rem 1rem', textAlign: 'left', color: 'var(--text2)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.7, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>{usersLoading ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text3)' }}>Carregando...</td></tr> : users.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text3)', fontSize: '0.85rem' }}>{status?.total ? 'Nenhum utilizador encontrado' : 'Clique em "Revalidar" para procurar'}</td></tr> :
            users.map((u) => <tr key={u.email} style={{ borderTop: '1px solid var(--border)', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={{ padding: '0.7rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text2)' }}>{u.email}</td>
              <td style={{ padding: '0.7rem 1rem', fontWeight: 500 }}>{u.name || '—'}</td>
              <td style={{ padding: '0.7rem 1rem' }}>{u.account_enabled ? <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: 'var(--green-bg)', color: 'var(--green)' }}>Ativo</span> : <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: 'var(--bg3)', color: 'var(--text3)' }}>Desativado</span>}</td>
              <td style={{ padding: '0.7rem 1rem' }}>{renderLicenseBadges(u.licenses)}</td>
              <td style={{ padding: '0.7rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: 'var(--text3)' }}>{u.imported_at?.slice(0, 16) || '—'}</td>
            </tr>)}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
