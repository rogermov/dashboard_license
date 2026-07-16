import React,{useState,useRef} from 'react';
import {Upload,Link,CheckCircle,XCircle,Loader,Info,RefreshCw,Chrome,FileSignature} from 'lucide-react';
import {api} from '../hooks/api.js';

// Removemos Google e DocuSign daqui porque agora eles têm botões automáticos via API!
const PLATFORMS=[
  {id:'365',label:'Microsoft 365',color:'#1e5fad',hint:'Admin Center → Usuários → Exportar'},
  {id:'lucid',label:'Lucid',color:'#d97706',hint:'Admin → Usuários → Export'},
  {id:'bitbucket',label:'Bitbucket',color:'#059669',hint:'Settings → User management → Export'},
  {id:'jira',label:'Jira',color:'#0284c7',hint:'Admin → User management → Export users'},
];

function Toast({msg,ok}){if(!msg)return null;return<div style={{position:'fixed',bottom:24,right:24,zIndex:9999,background:'var(--bg2)',border:`1px solid ${ok?'var(--green)':'var(--red)'}`,borderRadius:'var(--radius-lg)',padding:'0.9rem 1.25rem',display:'flex',alignItems:'center',gap:'0.6rem',fontSize:'0.82rem',boxShadow:'var(--shadow-lg)',maxWidth:400}}>{ok?<CheckCircle size={17} color="var(--green)"/>:<XCircle size={17} color="var(--red)"/>}<span>{msg}</span></div>;}

function DropZone({platform,endpoint,onSuccess,hint,color}){
  const[dragging,setDragging]=useState(false);const[loading,setLoading]=useState(false);const[done,setDone]=useState(null);const fileRef=useRef();
  const upload=async(file)=>{if(!file)return;setLoading(true);setDone(null);const fd=new FormData();if(platform)fd.append('platform',platform);fd.append('file',file);
    try{const res=await api.postForm(endpoint,fd);setDone({ok:true,msg:res.message});onSuccess&&onSuccess(res);}catch(e){setDone({ok:false,msg:'Erro ao importar.'});}finally{setLoading(false);}};
  const c=color||'var(--accent)';
  return<div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);upload(e.dataTransfer.files[0]);}} onClick={()=>fileRef.current.click()}
    style={{border:`1.5px dashed ${dragging?c:done?.ok?'var(--green)':'var(--border2)'}`,borderRadius:'var(--radius)',padding:'1.1rem',cursor:'pointer',background:dragging?`${c}08`:done?.ok?'var(--green-bg)':'var(--bg3)',transition:'all 0.2s',textAlign:'center'}}>
    <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{display:'none'}} onChange={e=>upload(e.target.files[0])}/>
    {loading?<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.35rem'}}><Loader size={20} color={c} style={{animation:'spin 1s linear infinite'}}/><span style={{fontSize:'0.78rem',color:'var(--text2)'}}>Importando...</span></div>:
     done?<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.35rem'}}>{done.ok?<CheckCircle size={20} color="var(--green)"/>:<XCircle size={20} color="var(--red)"/>}<span style={{fontSize:'0.78rem',color:done.ok?'var(--green)':'var(--red)',fontWeight:500}}>{done.msg}</span><span style={{fontSize:'0.68rem',color:'var(--text3)'}}>clique para importar outro</span></div>:
     <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.3rem'}}><Upload size={18} color="var(--text3)"/><span style={{fontSize:'0.78rem',color:'var(--text2)'}}>Arraste ou <span style={{color:c,textDecoration:'underline'}}>clique</span></span>{hint&&<span style={{fontSize:'0.68rem',color:'var(--text3)'}}>{hint}</span>}</div>}
  </div>;
}

// Novo componente para botões de API Direta
function ApiSyncBtn({label, icon:Icon, endpoint, color, onSuccess}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null);
  
  const handleSync = async () => {
    setLoading(true); setDone(null);
    try {
      const res = await api.post(endpoint); // Supondo que a api.post não precisa de form-data para o google
      setDone({ok:true, msg: "Sincronizado!"});
      if(onSuccess) onSuccess(res);
    } catch(e) {
      setDone({ok:false, msg: "Erro na Sync"});
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleSync} disabled={loading} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', border: `1.5px solid ${done?.ok ? 'var(--green)' : 'var(--border2)'}`, borderRadius: 'var(--radius)', padding: '1.1rem', cursor: loading ? 'wait' : 'pointer', background: done?.ok ? 'var(--green-bg)' : 'var(--bg3)', transition: 'all 0.2s', color: 'var(--text)' }}>
      {loading ? <Loader size={20} color={color} style={{animation:'spin 1s linear infinite'}}/> : done?.ok ? <CheckCircle size={20} color="var(--green)" /> : <RefreshCw size={20} color={color} />}
      <span style={{fontSize:'0.82rem', fontWeight:600}}>{label}</span>
      <span style={{fontSize:'0.68rem', color: done?.ok ? 'var(--green)' : 'var(--text3)'}}>{done?.ok ? done.msg : 'Sincronizar via API'}</span>
    </button>
  );
}

function Card({children,style}){return<div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.5rem',boxShadow:'var(--shadow-sm)',marginBottom:'1rem',...style}}>{children}</div>;}
function Step({n,title,tag}){return<div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.75rem'}}><div style={{width:24,height:24,borderRadius:'50%',background:'var(--accent)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.72rem',fontWeight:700,flexShrink:0}}>{n}</div><h2 style={{fontSize:'0.95rem',fontWeight:600,color:'var(--text)'}}>{title}</h2>{tag&&<span style={{fontSize:'0.65rem',fontFamily:'var(--font-mono)',color:'var(--text2)',background:'var(--bg3)',padding:'2px 8px',borderRadius:4,border:'1px solid var(--border)'}}>{tag}</span>}</div>;}

export default function Import(){
  const[sheetUrl,setSheetUrl]=useState('');const[sheetLoading,setSheetLoading]=useState(false);const[sheetResult,setSheetResult]=useState(null);const[toast,setToast]=useState(null);
  const showToast=(msg,ok)=>{setToast({msg,ok});setTimeout(()=>setToast(null),5000);};
  const importSheet=async()=>{if(!sheetUrl.includes('docs.google.com')){showToast('Cole um link válido do Google Sheets.',false);return;}
    setSheetLoading(true);setSheetResult(null);const fd=new FormData();fd.append('url',sheetUrl);
    try{const res=await api.postForm('/import/terminated/gsheet',fd);setSheetResult({ok:true,...res});showToast(res.message,true);}
    catch(e){showToast('Erro ao importar. Verifique se a planilha está pública.',false);}finally{setSheetLoading(false);}};
    
  return<div style={{animation:'fadeIn 0.3s ease',maxWidth:860}}>
    <Toast msg={toast?.msg} ok={toast?.ok}/>
    <div style={{marginBottom:'1.75rem'}}><h1 style={{fontWeight:700,fontSize:'1.5rem',color:'var(--text)'}}>Revalidação e Importação</h1><p style={{color:'var(--text2)',fontSize:'0.85rem',marginTop:3}}>Siga a ordem abaixo para o cruzamento funcionar corretamente no Dashboard</p></div>
    
    <div style={{display:'flex',gap:'0.6rem',background:'var(--accent-bg)',border:'1px solid var(--blue-200)',borderRadius:'var(--radius)',padding:'0.75rem 1rem',marginBottom:'1.25rem',fontSize:'0.8rem',color:'var(--blue-700)'}}><Info size={15} style={{flexShrink:0,marginTop:1}}/><span>Importe primeiro o <strong>Azure AD</strong>, depois os <strong>desligados do RH</strong>, e por último sincronize as <strong>Plataformas</strong>.</span></div>
    
    <Card><Step n="1" title="Relatório Azure AD — base de e-mails"/><p style={{fontSize:'0.8rem',color:'var(--text2)',marginBottom:'1rem',lineHeight:1.7}}>Mesmo formato do 365. Cria a base para cruzar <strong>nome → e-mail</strong> quando o RH mandar só o nome.</p><DropZone endpoint="/import/azure/csv" color="var(--blue-500)" hint="Azure Portal → Usuários → Baixar usuários (CSV)" onSuccess={r=>showToast(r.message,true)}/></Card>
    
    <Card><Step n="2" title="Desligados — RH" tag="Google Sheets ou CSV"/><p style={{fontSize:'0.8rem',color:'var(--text2)',marginBottom:'1rem',lineHeight:1.7}}>Se o RH mandar <strong>só o nome</strong>, o sistema busca o e-mail na base Azure automaticamente.</p>
      <div style={{marginBottom:'1rem'}}><div style={{fontSize:'0.7rem',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:0.8,marginBottom:'0.5rem'}}>Via Google Sheets</div>
        <div style={{display:'flex',gap:'0.6rem'}}><div style={{flex:1,position:'relative'}}><Link size={14} color="var(--text3)" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)'}}/><input value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={{width:'100%',padding:'0.6rem 0.75rem 0.6rem 2.1rem',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text)',fontSize:'0.82rem',outline:'none'}} onFocus={e=>e.target.style.borderColor='var(--accent)'} onBlur={e=>e.target.style.borderColor='var(--border)'}/></div>
          <button onClick={importSheet} disabled={sheetLoading} style={{padding:'0.6rem 1.1rem',background:'var(--accent)',border:'none',borderRadius:'var(--radius)',color:'#fff',fontWeight:600,fontSize:'0.85rem',display:'flex',alignItems:'center',gap:'0.4rem',opacity:sheetLoading?0.7:1}}>{sheetLoading?<Loader size={14} style={{animation:'spin 1s linear infinite'}}/>:<Upload size={14}/>}Importar</button>
        </div>{sheetResult?.ok&&<div style={{marginTop:'0.6rem',padding:'0.6rem 0.9rem',background:'var(--green-bg)',border:'1px solid #bbf7d0',borderRadius:'var(--radius)',fontSize:'0.78rem',color:'var(--green)',fontWeight:500}}>✓ {sheetResult.message}</div>}
      </div>
      <div><div style={{fontSize:'0.7rem',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:0.8,marginBottom:'0.5rem'}}>Via CSV</div><DropZone endpoint="/import/terminated/csv" color="var(--accent)" hint="Aceita nome ou e-mail — cruza com Azure automaticamente" onSuccess={r=>showToast(r.message,true)}/></div>
    </Card>
    
    <Card><Step n="3" title="Sincronização de Plataformas"/><p style={{fontSize:'0.8rem',color:'var(--text2)',marginBottom:'1.25rem',lineHeight:1.7}}>Atualize os dados para cruzar os acessos ativos com os desligados. Cada sincronização substitui os dados anteriores.</p>
      
      {/* Botões de API Automática (Sem CSV!) */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'1rem', marginBottom: '1rem'}}>
        <ApiSyncBtn label="Sincronizar Google" icon={Chrome} endpoint="/google/sync" color="#dc2626" onSuccess={r=>showToast(r.message,true)} />
        <ApiSyncBtn label="Sincronizar DocuSign" icon={FileSignature} endpoint="/docusign/sync" color="#7c3aed" onSuccess={r=>showToast(r.message,true)} />
      </div>

      <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '1.5rem 0' }} />
      <div style={{fontSize:'0.75rem',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:0.8,marginBottom:'0.8rem'}}>Importação Manual (CSV)</div>
      
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'1rem'}}>
        {PLATFORMS.map(p=><div key={p.id}>
          <div style={{display:'flex',alignItems:'center',gap:'0.4rem',marginBottom:'0.4rem'}}><div style={{width:8,height:8,borderRadius:'50%',background:p.color}}/><span style={{fontSize:'0.82rem',fontWeight:600}}>{p.label}</span></div>
          <DropZone platform={p.id} endpoint="/import/platform/csv" color={p.color} hint={p.hint} onSuccess={r=>showToast(r.message,true)}/>
        </div>)}
      </div>
    </Card>
  </div>;
}