import React, { useEffect, useState } from 'react';
import { RefreshCw, Search, Download, Loader, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../hooks/api.js';
import { exportCSV } from '../lib/csv.js';
import Toast from '../components/Toast.jsx';
import { useToast } from '../hooks/useToast.js';

const SM = {
  active: { label: 'Ativo', color: 'var(--green)', bg: 'var(--green-bg)' },
  suspended: { label: 'Suspenso', color: 'var(--red)', bg: 'var(--red-bg)' }
};

export default function Google() {
  const [users, setUsers] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const { toast, showToast } = useToast();

  // Filtros e Paginação
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOrgUnit, setFilterOrgUnit] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50; // Quantidade de usuários por página

  // Agora puxamos todos de uma vez para paginar no frontend de forma instantânea
  const loadUsers = async () => { 
    setUsersLoading(true); 
    try { 
      const res = await api.get(`/google/users`, { noCache: true });
      setUsers(res);
    } catch { setUsers([]); } finally { setUsersLoading(false); } 
  };

  useEffect(() => { loadUsers(); }, []);

  // Voltar para a página 1 sempre que o usuário digitar ou mudar algum filtro
  useEffect(() => { setCurrentPage(1); }, [search, filterStatus, filterOrgUnit]);

  const sync = async () => { 
    setSyncing(true); 
    try { 
      const res = await api.post('/google/sync'); 
      showToast(res.message, true); 
      await loadUsers(); 
    } catch (e) { 
      showToast('Erro na sincronização. Verifique o Apps Script.', false); 
    } finally { setSyncing(false); } 
  };

  const totalActive = users.filter(u => u.status === 'active').length;
  const totalSuspended = users.filter(u => u.status === 'suspended').length;

  // Extrai as Unidades Organizacionais únicas para montar o menu suspenso
  const uniqueOrgUnits = [...new Set(users.map(u => u.org_unit || '/'))].sort();

  // Aplica os filtros localmente
  const filteredUsers = users.filter(u => {
    const matchSearch = search === '' || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === '' || u.status === filterStatus;
    const matchOrg = filterOrgUnit === '' || (u.org_unit || '/') === filterOrgUnit;
    return matchSearch && matchStatus && matchOrg;
  });

  // Calcula a paginação
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <Toast toast={toast} />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontWeight: 700, fontSize: '1.5rem', color: 'var(--text)' }}>Google Workspace</h1>
          <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginTop: 3 }}>Diretório de usuários e unidades organizacionais</p>
        </div>
        <button onClick={sync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.7 : 1 }}>
          {syncing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />} 
          Sincronizar Google
        </button>
      </div>

      {!usersLoading && users.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem 1.25rem', marginBottom: '1.25rem', boxShadow: 'var(--shadow-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>Resumo Geral:</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--green)' }}>✓ {totalActive} ativos</span>
          <span style={{ color: 'var(--text3)' }}>·</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--red)' }}>⛔ {totalSuspended} suspensos</span>
          <span style={{ color: 'var(--text3)' }}>·</span>
          <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>{users.length} contas no total</span>
        </div>
      )}

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
        
        {/* BARRA DE FILTROS */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={13} color="var(--text3)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar e-mail ou nome..." style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.82rem', color: 'var(--text)', outline: 'none' }} />
          </div>

          {/* NOVO: Filtro de Unidades Organizacionais */}
          <select value={filterOrgUnit} onChange={e => setFilterOrgUnit(e.target.value)} style={{ padding: '0.55rem 0.75rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.82rem', color: 'var(--text)', outline: 'none', cursor: 'pointer', maxWidth: '250px' }}>
            <option value="">Todas as Unidades</option>
            {uniqueOrgUnits.map(org => <option key={org} value={org}>{org}</option>)}
          </select>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '0.55rem 0.75rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.82rem', color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
            <option value="">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="suspended">Suspensos</option>
          </select>

          <button onClick={() => exportCSV(filteredUsers.map(u => ({ Email: u.email, Nome: u.name, Unidade: u.org_unit || '/', Status: u.status, 'Ultimo Login': u.last_login })), `google_workspace_export.csv`)} disabled={!filteredUsers.length} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.85rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text2)', fontSize: '0.78rem', cursor: 'pointer', opacity: filteredUsers.length ? 1 : 0.5 }}>
            <Download size={13} /> CSV
          </button>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                {['Email', 'Nome', 'Unidade', 'Status', 'Último Login', 'Sincronizado'].map(h => <th key={h} style={{ padding: '0.65rem 1rem', textAlign: 'left', color: 'var(--text2)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.7 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {usersLoading ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text3)' }}>Carregando diretório...</td></tr> : 
               paginatedUsers.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text3)' }}>Nenhum usuário encontrado neste filtro.</td></tr> :
               paginatedUsers.map((u) => {
                 const s = SM[u.status] || SM.active;
                 return (
                  <tr key={u.email} style={{ borderTop: '1px solid var(--border)', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '0.7rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text2)' }}>{u.email}</td>
                    <td style={{ padding: '0.7rem 1rem', fontWeight: 500 }}>{u.name}</td>
                    <td style={{ padding: '0.7rem 1rem', color: 'var(--text2)', fontSize: '0.75rem' }}>{u.org_unit || '/'}</td>
                    <td style={{ padding: '0.7rem 1rem' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: s.bg, color: s.color }}>{s.label}</span></td>
                    <td style={{ padding: '0.7rem 1rem', color: 'var(--text2)', fontSize: '0.73rem' }}>{u.last_login?.split('T')[0] || 'Nunca'}</td>
                    <td style={{ padding: '0.7rem 1rem', color: 'var(--text3)', fontSize: '0.73rem' }}>{u.imported_at?.slice(0, 16)}</td>
                  </tr>
                 ); 
               })}
            </tbody>
          </table>
        </div>

        {/* CONTROLES DE PAGINAÇÃO */}
        {filteredUsers.length > itemsPerPage && (
          <div style={{ padding: '0.8rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
              Mostrando {paginatedUsers.length} de {filteredUsers.length} usuários
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                disabled={currentPage === 1}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent', border: 'none', color: currentPage === 1 ? 'var(--text3)' : 'var(--text)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
              >
                <ChevronLeft size={16} /> Anterior
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                Página {currentPage} de {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                disabled={currentPage === totalPages}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent', border: 'none', color: currentPage === totalPages ? 'var(--text3)' : 'var(--text)', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
              >
                Próxima <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}