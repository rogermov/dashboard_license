import React,{useState,useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Search,Download,Check,X} from 'lucide-react';
import {api} from '../hooks/api.js';
import { PLATFORMS, PLATFORM_LABELS as PL, PLATFORM_COLORS as PC } from '../lib/platforms.js';
import { exportCSV } from '../lib/csv.js';
import RiskBadge from '../components/RiskBadge.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const TABS=[{id:'risk',label:'Remover acesso'},{id:'review',label:'Revisar'},{id:'all',label:'Todos desligados'},{id:'azure',label:'Exportar M365'}];
const ENDPOINT={risk:'/users/risk',review:'/offboarding/review',all:'/users/terminated'};
const STATUS={agir:['Remover','var(--red)'],revisar:['Revisar','#d97706'],recontratado:['Recontratado','var(--green)'],sem_conta:['Sem conta ativa','var(--text3)']};
const fmtDate=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||'');return m?`${m[3]}/${m[2]}/${m[1]}`:(d||'—');};
const today=()=>new Date().toISOString().slice(0,10);

const th={padding:'0.65rem 1rem',textAlign:'left',color:'var(--text2)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:0.7,whiteSpace:'nowrap'};
const td={padding:'0.7rem 1rem',verticalAlign:'top'};
const mono={fontFamily:'var(--font-mono)',fontSize:'0.75rem'};
const inputStyle={padding:'0.6rem 0.75rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text)',fontSize:'0.82rem',outline:'none',boxShadow:'var(--shadow-sm)'};

function Chip({platform}){const c=PC[platform]||'#888';return<span style={{padding:'2px 7px',borderRadius:4,fontSize:'0.65rem',fontFamily:'var(--font-mono)',background:`${c}15`,color:c,border:`1px solid ${c}30`,whiteSpace:'nowrap'}}>{PL[platform]||platform}</span>;}
function StatusBadge({status}){const[l,c]=STATUS[status]||[status||'—','var(--text3)'];return<span style={{padding:'2px 8px',borderRadius:10,fontSize:'0.7rem',fontWeight:600,color:c,border:`1px solid ${c}`,whiteSpace:'nowrap'}}>{l}</span>;}
function Row({children}){return<tr style={{borderTop:'1px solid var(--border)',transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--blue-50)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{children}</tr>;}
function Person({name,matricula,company,date}){return<><div style={{fontWeight:500}}>{name||'—'}</div><div style={{...mono,color:'var(--text3)',marginTop:2}}>mat. {matricula}{company?` · ${company}`:''}{date?` · saiu ${fmtDate(date)}`:''}</div></>;}

function Table({headers,loading,empty,emptyColor,children,count}){
  return<div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-sm)'}}>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
      <thead><tr style={{background:'var(--bg3)'}}>{headers.map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{loading?<tr><td colSpan={headers.length} style={{textAlign:'center',padding:'2.5rem',color:'var(--text3)'}}>Carregando...</td></tr>
        :count===0?<tr><td colSpan={headers.length} style={{textAlign:'center',padding:'2.5rem',color:emptyColor||'var(--text3)',fontSize:'0.85rem'}}>{empty}</td></tr>:children}</tbody>
    </table></div>
    <div style={{padding:'0.65rem 1rem',borderTop:'1px solid var(--border)',fontSize:'0.72rem',color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{count} registros</div>
  </div>;
}

export default function Users(){
  const[params,setParams]=useSearchParams();
  const tab=TABS.some(t=>t.id===params.get('tab'))?params.get('tab'):'risk';
  const setTab=id=>setParams(id==='risk'?{}:{tab:id});
  const[search,setSearch]=useState('');const[platform,setPlatform]=useState('');
  const[data,setData]=useState([]);const[loading,setLoading]=useState(false);const[error,setError]=useState(null);
  const[busy,setBusy]=useState(null);

  const load=async()=>{
    setLoading(true);setError(null);
    try{
      const p=new URLSearchParams();if(search)p.append('search',search);
      if(tab==='azure')p.append('platform','365');else if(platform&&tab!=='all')p.append('platform',platform);
      setData(await api.get(`${ENDPOINT[tab==='azure'?'risk':tab]}?${p}`,{noCache:true}));
    }catch(e){setError(e.message||'Erro ao carregar usuários.');setData([]);}finally{setLoading(false);}
  };
  useEffect(()=>{load();},[tab,platform]);

  const decide=async(m,decision)=>{
    const key=`${m.matricula}|${m.platform}|${m.account_email}`;setBusy(key);
    try{
      await api.post('/offboarding/decision',{matricula:m.matricula,platform:m.platform,account_email:m.account_email,decision});
      setData(d=>d.filter(x=>`${x.matricula}|${x.platform}|${x.account_email}`!==key));
    }catch(e){setError(e.message||'Erro ao salvar a decisão.');}finally{setBusy(null);}
  };

  // CSV: uma linha por conta — é o que quem vai desativar precisa.
  const exportRows=()=>{
    if(tab==='review')return data.map(m=>({matricula:m.matricula,nome:m.person_name,empresa:m.company,desligamento:fmtDate(m.termination_date),plataforma:PL[m.platform]||m.platform,conta:m.account_email,nome_na_conta:m.account_name,status_conta:m.account_status,motivo:m.method,observacao:m.detail}));
    if(tab==='all')return data.map(u=>({matricula:u.matricula,nome:u.name,empresa:u.department,cargo:u.cargo,desligamento:fmtDate(u.termination_date),situacao:(STATUS[u.match_status]||[u.match_status])[0],detalhe:u.match_detail}));
    return data.flatMap(u=>(u.accounts||[]).filter(a=>tab!=='azure'||a.platform==='365').map(a=>({matricula:u.matricula,nome:u.name,empresa:u.department,desligamento:fmtDate(u.termination_date),plataforma:PL[a.platform]||a.platform,conta:a.email,nome_na_conta:a.name,como_identificado:a.method})));
  };
  const fileName={risk:'remover-acesso',review:'revisar',all:'desligados',azure:'desativar-m365'}[tab];

  return<div style={{animation:'fadeIn 0.3s ease'}}>
    <div style={{marginBottom:'1.75rem'}}><h1 style={{fontWeight:700,fontSize:'1.5rem',color:'var(--text)'}}>Usuários</h1><p style={{color:'var(--text2)',fontSize:'0.85rem',marginTop:3}}>Desligados e seus acessos ativos por plataforma</p></div>
    <div style={{display:'flex',gap:'0.4rem',marginBottom:'1.25rem',background:'var(--bg3)',padding:'0.3rem',borderRadius:'var(--radius)',width:'fit-content',border:'1px solid var(--border)'}}>
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'0.45rem 1rem',borderRadius:6,fontSize:'0.82rem',fontWeight:tab===t.id?600:400,background:tab===t.id?'var(--bg2)':'transparent',border:tab===t.id?'1px solid var(--border)':'1px solid transparent',color:tab===t.id?'var(--accent)':'var(--text2)',boxShadow:tab===t.id?'var(--shadow-sm)':'none'}}>{t.label}</button>)}
    </div>
    {tab==='review'&&<div style={{background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:'var(--radius)',padding:'0.7rem 1rem',marginBottom:'1rem',fontSize:'0.78rem',color:'#92400e',lineHeight:1.6}}>Contas encontradas <strong>sem certeza total</strong> (só pelo nome, ou pessoa ainda presente no censo). Confira e decida: <strong>Confirmar</strong> move para "Remover acesso"; <strong>Não é a pessoa</strong> descarta. As decisões ficam salvas para as próximas importações.</div>}
    <ErrorBanner message={error} onRetry={load}/>
    <div style={{display:'flex',gap:'0.6rem',marginBottom:'1rem'}}>
      <div style={{position:'relative',flex:1}}><Search size={14} color="var(--text3)" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)'}}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} placeholder="Buscar por nome, matrícula ou e-mail... (Enter)" style={{...inputStyle,width:'100%',padding:'0.6rem 0.75rem 0.6rem 2.1rem'}} onFocus={e=>e.target.style.borderColor='var(--accent)'} onBlur={e=>e.target.style.borderColor='var(--border)'}/></div>
      {(tab==='risk'||tab==='review')&&<select value={platform} onChange={e=>setPlatform(e.target.value)} style={inputStyle}><option value="">Todas plataformas</option>{PLATFORMS.map(p=><option key={p} value={p}>{PL[p]}</option>)}</select>}
      <button onClick={()=>exportCSV(exportRows(),`${fileName}-${today()}.csv`)} disabled={!data.length} style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.6rem 0.9rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.82rem',boxShadow:'var(--shadow-sm)',opacity:data.length?1:0.5}}><Download size={13}/>CSV</button>
    </div>

    {(tab==='risk'||tab==='azure')&&<Table headers={['Pessoa',tab==='azure'?'Conta M365':'Contas ativas','Risco']} loading={loading} count={data.length} empty="✓ Nenhum desligado com acesso ativo confirmado" emptyColor="var(--green)">
      {data.map(u=><Row key={u.matricula}>
        <td style={td}><Person name={u.name} matricula={u.matricula} company={u.department} date={u.termination_date}/></td>
        <td style={td}><div style={{display:'flex',flexDirection:'column',gap:4}}>{(u.accounts||[]).filter(a=>tab!=='azure'||a.platform==='365').map((a,i)=><div key={i} style={{display:'flex',gap:6,alignItems:'center'}}><Chip platform={a.platform}/><span style={{...mono,color:'var(--text2)'}} title={a.method}>{a.email}</span></div>)}</div></td>
        <td style={td}><RiskBadge level={u.risk_level}/></td>
      </Row>)}
    </Table>}

    {tab==='review'&&<Table headers={['Pessoa (RH)','Conta encontrada','Por que revisar','Decisão']} loading={loading} count={data.length} empty="✓ Nada para revisar" emptyColor="var(--green)">
      {data.map(m=>{const key=`${m.matricula}|${m.platform}|${m.account_email}`;return<Row key={key}>
        <td style={td}><Person name={m.person_name} matricula={m.matricula} company={m.company} date={m.termination_date}/></td>
        <td style={td}><div style={{display:'flex',gap:6,alignItems:'center',marginBottom:3}}><Chip platform={m.platform}/><span style={{fontWeight:500}}>{m.account_name||'—'}</span></div><div style={{...mono,color:'var(--text2)'}}>{m.account_email}{m.account_status?` · ${m.account_status}`:''}</div></td>
        <td style={{...td,color:'var(--text2)',fontSize:'0.78rem',maxWidth:320}}>{m.method}{m.detail&&<div style={{marginTop:4,color:'#92400e'}}>{m.detail}</div>}</td>
        <td style={{...td,whiteSpace:'nowrap'}}><div style={{display:'flex',gap:6}}>
          <button disabled={busy===key} onClick={()=>decide(m,'confirmar')} style={{display:'flex',alignItems:'center',gap:4,padding:'0.35rem 0.7rem',background:'var(--red)',border:'none',borderRadius:6,color:'#fff',fontSize:'0.75rem',fontWeight:600,opacity:busy===key?0.6:1}}><Check size={13}/>Confirmar</button>
          <button disabled={busy===key} onClick={()=>decide(m,'rejeitar')} style={{display:'flex',alignItems:'center',gap:4,padding:'0.35rem 0.7rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text2)',fontSize:'0.75rem',opacity:busy===key?0.6:1}}><X size={13}/>Não é a pessoa</button>
        </div></td>
      </Row>;})}
    </Table>}

    {tab==='all'&&<Table headers={['Pessoa','Cargo','Situação','Detalhe']} loading={loading} count={data.length} empty="Nenhum desligado importado. Importe a planilha do RH em Importação.">
      {data.map(u=><Row key={u.matricula}>
        <td style={td}><Person name={u.name} matricula={u.matricula} company={u.department} date={u.termination_date}/></td>
        <td style={{...td,color:'var(--text2)',fontSize:'0.78rem'}}>{u.cargo||'—'}</td>
        <td style={td}><StatusBadge status={u.match_status}/></td>
        <td style={{...td,color:'var(--text2)',fontSize:'0.78rem',maxWidth:380}}>{u.match_detail||'—'}</td>
      </Row>)}
    </Table>}
  </div>;
}
