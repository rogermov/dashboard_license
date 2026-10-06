import React,{useState,useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Search,Download,Check,X,Power,RotateCcw} from 'lucide-react';
import {api} from '../hooks/api.js';
import { PLATFORMS, PLATFORM_LABELS as PL, PLATFORM_COLORS as PC } from '../lib/platforms.js';
import { exportCSV } from '../lib/csv.js';
import RiskBadge from '../components/RiskBadge.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import DeactivateModal,{API_PLATFORMS} from '../components/DeactivateModal.jsx';

const TABS=[{id:'risk',label:'Remover acesso'},{id:'review',label:'Revisar'},{id:'licensed',label:'Licenças M365'},{id:'all',label:'Todos desligados'},{id:'history',label:'Histórico'}];
const ENDPOINT={risk:'/users/risk',review:'/offboarding/review',licensed:'/offboarding/m365-licensed',all:'/users/terminated',history:'/offboarding/actions'};
const STATUS={agir:['Remover','var(--red)'],revisar:['Revisar','#d97706'],recontratado:['Recontratado','var(--green)'],sem_conta:['Sem conta ativa','var(--text3)'],fora_da_gestao:['Fora da gestão','var(--text3)']};
const ACT_STATUS={ok:['Feito','var(--green)'],manual:['Feito (manual)','var(--green)'],simulado:['Simulado','var(--blue-500)'],erro:['Erro','var(--red)'],bloqueado:['Bloqueado','#d97706']};
const accKey=(mat,platform,email)=>`${mat}|${platform}|${email}`;
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
  const[selected,setSelected]=useState(new Set());const[config,setConfig]=useState(null);const[modalItems,setModalItems]=useState(null);
  useEffect(()=>{api.get('/offboarding/actions/config',{noCache:true}).then(setConfig).catch(()=>{});},[]);

  const load=async()=>{
    setLoading(true);setError(null);
    try{
      const p=new URLSearchParams();if(search)p.append('search',search);
      if(platform&&(tab==='risk'||tab==='review'))p.append('platform',platform);
      setSelected(new Set());
      setData(await api.get(`${ENDPOINT[tab]}?${p}`,{noCache:true}));
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

  // Contas visíveis na aba Remover (respeita o filtro de plataforma)
  const visibleAccounts=tab==='risk'?data.flatMap(u=>(u.accounts||[]).filter(a=>!platform||a.platform===platform).map(a=>({matricula:u.matricula,person_name:u.name,platform:a.platform,account_email:a.email}))):[];
  const toggle=k=>setSelected(s=>{const n=new Set(s);n.has(k)?n.delete(k):n.add(k);return n;});
  const allSelected=visibleAccounts.length>0&&visibleAccounts.every(a=>selected.has(accKey(a.matricula,a.platform,a.account_email)));
  const toggleAll=()=>setSelected(allSelected?new Set():new Set(visibleAccounts.map(a=>accKey(a.matricula,a.platform,a.account_email))));
  const openModal=()=>setModalItems(visibleAccounts.filter(a=>selected.has(accKey(a.matricula,a.platform,a.account_email))));
  const toggleMode=async()=>{
    const on=!config?.enabled;
    if(on&&!window.confirm('Ligar o MODO REAL? A partir daqui, "Desativar" altera as contas de verdade no M365, Google e DocuSign.'))return;
    try{setConfig(await api.post('/offboarding/actions/mode',{enabled:on}));}catch(e){setError(e.message||'Erro ao trocar o modo.');}
  };
  const reactivate=async a=>{
    if(!window.confirm(`Reativar ${a.account_email} (${PL[a.platform]||a.platform})? O match será marcado como "Não é a pessoa".`))return;
    setBusy(a.id);try{await api.post('/offboarding/reactivate',{action_id:a.id});load();}catch(e){setError(e.message||'Erro ao reativar.');}finally{setBusy(null);}
  };

  // CSV: uma linha por conta — é o que quem vai desativar precisa.
  const exportRows=()=>{
    if(tab==='review')return data.map(m=>({matricula:m.matricula,nome:m.person_name,empresa:m.company,desligamento:fmtDate(m.termination_date),plataforma:PL[m.platform]||m.platform,conta:m.account_email,nome_na_conta:m.account_name,status_conta:m.account_status,motivo:m.method,observacao:m.detail}));
    if(tab==='licensed')return data.map(m=>({matricula:m.matricula,nome:m.person_name,empresa:m.company,desligamento:fmtDate(m.termination_date),conta:m.account_email,office:m.office.length?'sim':'não',licencas:m.licenses.join('; '),situacao:m.confidence==='agir'?'Remover':'Revisar'}));
    if(tab==='all')return data.map(u=>({matricula:u.matricula,nome:u.name,empresa:u.department,cargo:u.cargo,desligamento:fmtDate(u.termination_date),situacao:(STATUS[u.match_status]||[u.match_status])[0],detalhe:u.match_detail,desativadas:(u.deactivated||[]).join(' | ')}));
    if(tab==='history')return data.map(a=>({quando:a.created_at,matricula:a.matricula,nome:a.person_name,plataforma:PL[a.platform]||a.platform,conta:a.account_email,acao:a.action,resultado:(ACT_STATUS[a.status]||[a.status])[0],detalhe:a.detail,por:a.actor}));
    return data.flatMap(u=>(u.accounts||[]).map(a=>({matricula:u.matricula,nome:u.name,empresa:u.department,desligamento:fmtDate(u.termination_date),plataforma:PL[a.platform]||a.platform,conta:a.email,nome_na_conta:a.name,como_identificado:a.method})));
  };
  const fileName={licensed:'licencas-m365',risk:'remover-acesso',review:'revisar',all:'desligados',history:'historico-desativacoes'}[tab];

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

    {tab==='risk'&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem',padding:'0.6rem 0.9rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'var(--shadow-sm)'}}>
      <label style={{display:'flex',gap:8,alignItems:'center',fontSize:'0.8rem',color:'var(--text2)'}}><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!visibleAccounts.length}/>Selecionar todas ({visibleAccounts.length} contas{platform?` · ${PL[platform]}`:''})</label>
      <div style={{display:'flex',gap:10,alignItems:'center'}}>
        {config&&(config.allowed
          ?<button onClick={toggleMode} title={config.enabled?'Clique para voltar à simulação':'Clique para ligar as ações reais'} style={{display:'flex',alignItems:'center',gap:8,padding:'0.3rem 0.7rem',borderRadius:20,border:`1px solid ${config.enabled?'var(--red)':'var(--border)'}`,background:config.enabled?'#fee2e2':'var(--bg3)',color:config.enabled?'var(--red)':'var(--text2)',fontSize:'0.75rem',fontWeight:600}}>
              <span style={{width:28,height:16,borderRadius:8,background:config.enabled?'var(--red)':'var(--border2, #cbd5e1)',position:'relative',transition:'background 0.15s'}}><span style={{position:'absolute',top:2,left:config.enabled?14:2,width:12,height:12,borderRadius:'50%',background:'#fff',transition:'left 0.15s'}}/></span>
              {config.enabled?'Modo real':'Simulação'}
            </button>
          :<span title="OFFBOARDING_ACTIONS_ENABLED=false no .env do servidor" style={{fontSize:'0.72rem',padding:'2px 8px',borderRadius:10,border:'1px solid var(--blue-500)',color:'var(--blue-500)'}}>Simulação (travado no servidor)</span>)}
        <button onClick={openModal} disabled={!selected.size} style={{display:'flex',alignItems:'center',gap:6,padding:'0.45rem 1rem',background:'var(--red)',border:'none',borderRadius:'var(--radius)',color:'#fff',fontWeight:600,fontSize:'0.8rem',opacity:selected.size?1:0.45}}><Power size={14}/>Desativar selecionadas ({selected.size})</button>
      </div>
    </div>}
    {modalItems&&<DeactivateModal items={modalItems} config={config} onClose={()=>setModalItems(null)} onDone={()=>{setModalItems(null);load();}}/>}

    {tab==='risk'&&<Table headers={['Pessoa','Contas ativas','Risco']} loading={loading} count={data.length} empty="✓ Nenhum desligado com acesso ativo confirmado" emptyColor="var(--green)">
      {data.map(u=><Row key={u.matricula}>
        <td style={td}><Person name={u.name} matricula={u.matricula} company={u.department} date={u.termination_date}/></td>
        <td style={td}><div style={{display:'flex',flexDirection:'column',gap:4}}>{(u.accounts||[]).filter(a=>!platform||a.platform===platform).map((a,i)=>{const k=accKey(u.matricula,a.platform,a.email);return<label key={i} style={{display:'flex',gap:6,alignItems:'center',cursor:'pointer'}}><input type="checkbox" checked={selected.has(k)} onChange={()=>toggle(k)}/><Chip platform={a.platform}/><span style={{...mono,color:'var(--text2)'}} title={a.method}>{a.email}</span>{!API_PLATFORMS.includes(a.platform)&&<span style={{fontSize:'0.65rem',color:'var(--text3)'}}>(manual)</span>}{a.guest&&<span title="Conta convidada (#EXT#) no tenant da holding: desativar só tira o acesso à holding. A caixa de e-mail real fica em outro tenant." style={{fontSize:'0.65rem',color:'#d97706',border:'1px solid #fcd34d',borderRadius:4,padding:'0 4px'}}>convidado</span>}</label>;})}</div></td>
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

    {tab==='licensed'&&<><div style={{background:'var(--accent-bg)',border:'1px solid var(--blue-200)',borderRadius:'var(--radius)',padding:'0.7rem 1rem',marginBottom:'1rem',fontSize:'0.78rem',color:'var(--blue-700)',lineHeight:1.6}}>Contas do Microsoft 365 de desligados que ainda consomem <strong>licença paga</strong>. Pacotes com <strong>Office</strong> aparecem primeiro: são a prioridade. Itens "Revisar" precisam ser confirmados na aba Revisar antes de remover.</div>
    <Table headers={['Pessoa','Conta M365','Licenças','Situação']} loading={loading} count={data.length} empty="✓ Nenhum desligado com licença paga no M365" emptyColor="var(--green)">
      {data.map(m=><Row key={`${m.matricula}|${m.account_email}`}>
        <td style={td}><Person name={m.person_name} matricula={m.matricula} company={m.company} date={m.termination_date}/></td>
        <td style={{...td,...mono,color:'var(--text2)'}}>{m.account_email}</td>
        <td style={td}><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{m.licenses.map(l=>{const o=m.office.includes(l);return<span key={l} style={{padding:'2px 8px',borderRadius:4,fontSize:'0.7rem',fontWeight:o?600:400,background:o?'#fee2e2':'var(--bg3)',color:o?'var(--red)':'var(--text2)',border:`1px solid ${o?'#fca5a5':'var(--border)'}`}}>{o?'★ ':''}{l}</span>;})}</div></td>
        <td style={td}><StatusBadge status={m.confidence}/></td>
      </Row>)}
    </Table></>}

    {tab==='all'&&<Table headers={['Pessoa','Cargo','Situação','Detalhe','Desativadas']} loading={loading} count={data.length} empty="Nenhum desligado importado. Importe a planilha do RH em Importação.">
      {data.map(u=><Row key={u.matricula}>
        <td style={td}><Person name={u.name} matricula={u.matricula} company={u.department} date={u.termination_date}/></td>
        <td style={{...td,color:'var(--text2)',fontSize:'0.78rem'}}>{u.cargo||'—'}</td>
        <td style={td}><StatusBadge status={u.match_status}/></td>
        <td style={{...td,color:'var(--text2)',fontSize:'0.78rem',maxWidth:380}}>{u.match_detail||'—'}</td>
        <td style={{...td,...mono,color:'var(--green)',fontSize:'0.7rem'}}>{(u.deactivated||[]).map(d=><div key={d}>{d}</div>)}</td>
      </Row>)}
    </Table>}

    {tab==='history'&&<Table headers={['Quando','Pessoa','Conta','Ação','Resultado','Por','']} loading={loading} count={data.length} empty="Nenhuma ação registrada ainda.">
      {data.map(a=>{const[l,c]=ACT_STATUS[a.status]||[a.status,'var(--text3)'];return<Row key={a.id}>
        <td style={{...td,...mono,whiteSpace:'nowrap',color:'var(--text2)'}}>{a.created_at?.slice(0,16)}</td>
        <td style={td}><div style={{fontWeight:500}}>{a.person_name||'—'}</div><div style={{...mono,color:'var(--text3)'}}>mat. {a.matricula}</div></td>
        <td style={td}>{a.action==='modo'?'—':<div style={{display:'flex',gap:6,alignItems:'center'}}><Chip platform={a.platform}/><span style={{...mono,color:'var(--text2)'}}>{a.account_email}</span></div>}</td>
        <td style={{...td,fontSize:'0.78rem'}}>{{reativar:'Reativar',modo:'Modo'}[a.action]||'Desativar'}</td>
        <td style={{...td,fontSize:'0.75rem',maxWidth:320}}><span style={{color:c,fontWeight:600}}>{l}</span><div style={{color:'var(--text2)',marginTop:2}}>{a.detail}</div></td>
        <td style={{...td,...mono,color:'var(--text3)'}}>{a.actor}</td>
        <td style={td}>{a.can_reactivate&&<button disabled={busy===a.id} onClick={()=>reactivate(a)} title="Desfazer" style={{display:'flex',alignItems:'center',gap:4,padding:'0.3rem 0.6rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text2)',fontSize:'0.72rem',whiteSpace:'nowrap'}}><RotateCcw size={12}/>Reativar</button>}</td>
      </Row>;})}
    </Table>}
  </div>;
}
