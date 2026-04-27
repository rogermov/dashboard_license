
import React,{useEffect,useState} from 'react';
import {RefreshCw,CheckCircle,Clock,AlertTriangle,ExternalLink,Search,Download,Loader} from 'lucide-react';
import {api} from '../hooks/api.js';
const SM={active:{label:'Ativo',color:'var(--green)',bg:'var(--green-bg)'},pending:{label:'Pendente',color:'var(--yellow)',bg:'var(--yellow-bg)'}};
function exportCSV(data,filename){if(!data.length)return;const h=Object.keys(data[0]);const rows=data.map(r=>h.map(k=>`"${(r[k]||'').toString().replace(/"/g,'""')}"`).join(','));const blob=new Blob([[h.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}
export default function Docusign(){
  const[status,setStatus]=useState(null);const[users,setUsers]=useState([]);const[loading,setLoading]=useState(true);
  const[syncing,setSyncing]=useState(null);const[search,setSearch]=useState('');
  const[filterAccount,setFilterAccount]=useState('');const[filterStatus,setFilterStatus]=useState('');
  const[usersLoading,setUsersLoading]=useState(false);const[toast,setToast]=useState(null);
  const showToast=(msg,ok)=>{setToast({msg,ok});setTimeout(()=>setToast(null),5000);};
  const loadStatus=async()=>{setLoading(true);try{setStatus(await api.get('/docusign/status',{noCache:true}));}catch{showToast('Erro ao carregar status.',false);}finally{setLoading(false);}};
  const loadUsers=async()=>{setUsersLoading(true);try{const p=new URLSearchParams();if(filterAccount)p.append('account_id',filterAccount);if(filterStatus)p.append('status',filterStatus);if(search)p.append('search',search);setUsers(await api.get(`/docusign/users?${p}`,{noCache:true}));}catch{setUsers([]);}finally{setUsersLoading(false);}};
  useEffect(()=>{loadStatus();loadUsers();},[]);
  useEffect(()=>{loadUsers();},[filterAccount,filterStatus]);
  const sync=async(accountId='')=>{setSyncing(accountId||'all');try{const qs=accountId?`?account_id=${encodeURIComponent(accountId)}`:'';const res=await api.postForm(`/docusign/sync${qs}`,new FormData());showToast(res.message,!res.errors?.length);await loadStatus();await loadUsers();}catch(e){showToast('Erro na sincronização. Verifique as credenciais no .env',false);}finally{setSyncing(null);}};
  const accounts=status?.accounts||[];
  const totalActive=accounts.reduce((s,a)=>s+(a.active||0),0);
  const totalPending=accounts.reduce((s,a)=>s+(a.pending||0),0);
  return<div style={{animation:'fadeIn 0.3s ease'}}>
    {toast&&<div style={{position:'fixed',bottom:24,right:24,zIndex:9999,background:'var(--bg2)',border:`1px solid ${toast.ok?'var(--green)':'var(--red)'}`,borderRadius:'var(--radius-lg)',padding:'0.9rem 1.25rem',display:'flex',alignItems:'center',gap:'0.6rem',fontSize:'0.82rem',boxShadow:'var(--shadow-lg)',maxWidth:420}}>{toast.ok?<CheckCircle size={16} color="var(--green)"/>:<AlertTriangle size={16} color="var(--red)"/>}<span>{toast.msg}</span></div>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.75rem'}}>
      <div><h1 style={{fontWeight:700,fontSize:'1.5rem',color:'var(--text)'}}>DocuSign</h1><p style={{color:'var(--text2)',fontSize:'0.85rem',marginTop:3}}>Usuários ativos e pendentes nas 4 contas</p></div>
      <div style={{display:'flex',gap:'0.5rem'}}>
        {status?.consent_url&&<a href={status.consent_url} target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 0.9rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.78rem',fontWeight:500,textDecoration:'none',boxShadow:'var(--shadow-sm)'}}><ExternalLink size={13}/>Consentimento</a>}
        <button onClick={()=>sync()} disabled={!!syncing} style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 1rem',background:'var(--accent)',border:'none',borderRadius:'var(--radius)',color:'#fff',fontWeight:600,fontSize:'0.82rem',opacity:syncing?0.7:1}}>{syncing==='all'?<Loader size={14} style={{animation:'spin 1s linear infinite'}}/>:<RefreshCw size={14}/>}Revalidar Todas</button>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'0.85rem',marginBottom:'1.5rem'}}>
      {loading?[1,2,3,4].map(i=><div key={i} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem',height:120,boxShadow:'var(--shadow-sm)'}}/>):
      accounts.map(acc=><div key={acc.account_id} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem',boxShadow:'var(--shadow-sm)',borderTop:'3px solid var(--blue-400)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.75rem'}}>
          <div style={{fontWeight:600,fontSize:'0.88rem',lineHeight:1.3}}>{acc.account_name}</div>
          <button onClick={()=>sync(acc.account_id)} disabled={!!syncing} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',padding:2}}>{syncing===acc.account_id?<Loader size={13} style={{animation:'spin 1s linear infinite'}}/>:<RefreshCw size={13}/>}</button>
        </div>
        <div style={{display:'flex',gap:'0.75rem',marginBottom:'0.65rem'}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.3rem'}}><CheckCircle size={13} color="var(--green)"/><span style={{fontSize:'1rem',fontWeight:700}}>{acc.active}</span><span style={{fontSize:'0.7rem',color:'var(--text3)'}}>ativos</span></div>
          <div style={{display:'flex',alignItems:'center',gap:'0.3rem'}}><Clock size={13} color="var(--yellow)"/><span style={{fontSize:'1rem',fontWeight:700}}>{acc.pending}</span><span style={{fontSize:'0.7rem',color:'var(--text3)'}}>pendentes</span></div>
        </div>
        {acc.last_error?<div style={{fontSize:'0.68rem',color:'var(--red)',background:'var(--red-bg)',padding:'3px 7px',borderRadius:4,lineHeight:1.4}}>⚠ {acc.last_error.slice(0,100)}</div>:acc.last_sync?<div style={{fontSize:'0.68rem',color:'var(--text3)',fontFamily:'var(--font-mono)'}}>Sync: {acc.last_sync.slice(0,16).replace('T',' ')}</div>:<div style={{fontSize:'0.68rem',color:'var(--text3)'}}>Nunca sincronizado — clique em Revalidar</div>}
      </div>)}
    </div>
    {!loading&&accounts.length>0&&<div style={{display:'flex',gap:'1rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'0.75rem 1.25rem',marginBottom:'1.25rem',boxShadow:'var(--shadow-sm)',flexWrap:'wrap',alignItems:'center'}}>
      <span style={{fontSize:'0.82rem',color:'var(--text2)'}}>Total geral:</span>
      <span style={{fontSize:'0.82rem',fontWeight:700,color:'var(--green)'}}>✓ {totalActive} ativos</span>
      <span style={{color:'var(--text3)'}}>·</span>
      <span style={{fontSize:'0.82rem',fontWeight:700,color:'var(--yellow)'}}>⏳ {totalPending} pendentes</span>
      <span style={{color:'var(--text3)'}}>·</span>
      <span style={{fontSize:'0.82rem',color:'var(--text2)'}}>{totalActive+totalPending} total</span>
    </div>}
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-sm)'}}>
      <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',gap:'0.6rem',flexWrap:'wrap',alignItems:'center'}}>
        <div style={{position:'relative',flex:1,minWidth:200}}><Search size={13} color="var(--text3)" style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)'}}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadUsers()} placeholder="Buscar por e-mail ou nome..." style={{width:'100%',padding:'0.55rem 0.75rem 0.55rem 2rem',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:'0.82rem',color:'var(--text)',outline:'none'}} onFocus={e=>e.target.style.borderColor='var(--accent)'} onBlur={e=>e.target.style.borderColor='var(--border)'}/></div>
        <select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)} style={{padding:'0.55rem 0.75rem',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:'0.82rem',color:'var(--text)',outline:'none'}}><option value="">Todas as contas</option>{accounts.map(a=><option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}</select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{padding:'0.55rem 0.75rem',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:'0.82rem',color:'var(--text)',outline:'none'}}><option value="">Todos os status</option><option value="active">Ativos</option><option value="pending">Pendentes</option></select>
        <button onClick={()=>exportCSV(users,`docusign-${new Date().toISOString().slice(0,10)}.csv`)} disabled={!users.length} style={{display:'flex',alignItems:'center',gap:'0.35rem',padding:'0.55rem 0.85rem',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.78rem',opacity:users.length?1:0.5}}><Download size={13}/>CSV</button>
      </div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
        <thead><tr style={{background:'var(--bg3)'}}>{['Email','Nome','Conta','Status','Sincronizado em'].map(h=><th key={h} style={{padding:'0.65rem 1rem',textAlign:'left',color:'var(--text2)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:0.7,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{usersLoading?<tr><td colSpan={5} style={{textAlign:'center',padding:'2.5rem',color:'var(--text3)'}}>Carregando...</td></tr>:users.length===0?<tr><td colSpan={5} style={{textAlign:'center',padding:'2.5rem',color:'var(--text3)',fontSize:'0.85rem'}}>{accounts.some(a=>a.last_sync)?'Nenhum usuário encontrado':'Clique em "Revalidar Todas" para buscar os usuários'}</td></tr>:
        users.map((u,i)=>{const s=SM[u.status]||SM.active;return<tr key={i} style={{borderTop:'1px solid var(--border)',transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--blue-50)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <td style={{padding:'0.7rem 1rem',fontFamily:'var(--font-mono)',fontSize:'0.75rem',color:'var(--text2)'}}>{u.email}</td>
          <td style={{padding:'0.7rem 1rem',fontWeight:500}}>{u.name||'—'}</td>
          <td style={{padding:'0.7rem 1rem',color:'var(--text2)',fontSize:'0.78rem'}}>{u.account_name}</td>
          <td style={{padding:'0.7rem 1rem'}}><span style={{padding:'2px 8px',borderRadius:4,fontSize:'0.65rem',fontWeight:700,fontFamily:'var(--font-mono)',background:s.bg,color:s.color}}>{s.label}</span></td>
          <td style={{padding:'0.7rem 1rem',fontFamily:'var(--font-mono)',fontSize:'0.73rem',color:'var(--text3)'}}>{u.imported_at?.slice(0,16)||'—'}</td>
        </tr>;})}
        </tbody>
      </table></div>
      <div style={{padding:'0.65rem 1rem',borderTop:'1px solid var(--border)',fontSize:'0.72rem',color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{users.length} usuários</div>
    </div>
  </div>;
}
