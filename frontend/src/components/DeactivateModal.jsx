import React,{useState} from 'react';
import {X,Loader,ShieldAlert,CheckCircle,XCircle} from 'lucide-react';
import {api} from '../hooks/api.js';
import {PLATFORM_LABELS as PL} from '../lib/platforms.js';

// Plataformas com desativação via API; as demais só são marcadas como feitas à mão.
export const API_PLATFORMS=['365','google','docusign'];
const ACTION_TEXT={'365':'bloquear entrada + derrubar sessões',google:'suspender conta',docusign:'fechar acesso (todas as contas)'};
const STATUS_STYLE={ok:['var(--green)',CheckCircle],manual:['var(--green)',CheckCircle],simulado:['var(--blue-500)',CheckCircle],erro:['var(--red)',XCircle],bloqueado:['#d97706',XCircle]};

export default function DeactivateModal({items,config,onClose,onDone}){
  const[removeLic,setRemoveLic]=useState(false);const[typed,setTyped]=useState('');
  const[running,setRunning]=useState(false);const[progress,setProgress]=useState(0);const[result,setResult]=useState(null);const[error,setError]=useState(null);
  const real=!!config?.enabled;const has365=items.some(i=>i.platform==='365');
  const canRun=!running&&(!real||typed.trim().toUpperCase()==='DESATIVAR');

  const run=async(dryRun)=>{
    setRunning(true);setError(null);setProgress(0);
    const size=config?.max_batch||25;const all=[];let simulated=false;
    try{
      for(let i=0;i<items.length;i+=size){
        const chunk=items.slice(i,i+size).map(({matricula,platform,account_email})=>({matricula,platform,account_email}));
        const r=await api.post('/offboarding/deactivate',{items:chunk,remove_licenses:removeLic,dry_run:dryRun});
        all.push(...r.results);simulated=r.simulated;setProgress(Math.min(i+size,items.length));
      }
      setResult({simulated,results:all});
    }catch(e){setError(e.message||'Erro ao executar.');if(all.length)setResult({simulated,results:all});}
    finally{setRunning(false);}
  };
  const byKey=Object.fromEntries((result?.results||[]).map(r=>[`${r.matricula}|${r.platform}|${r.account_email}`,r]));

  return<div style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{if(e.target===e.currentTarget&&!running)(result?onDone:onClose)();}}>
    <div style={{background:'var(--bg2)',borderRadius:'var(--radius-lg)',width:'min(760px,100%)',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 50px rgba(0,0,0,0.25)'}}>
      <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',gap:8,alignItems:'center'}}><ShieldAlert size={18} color="var(--red)"/><h2 style={{fontSize:'1rem',fontWeight:700}}>Desativar {items.length} conta{items.length>1?'s':''}</h2></div>
        <button onClick={result?onDone:onClose} disabled={running} style={{background:'none',border:'none',color:'var(--text2)'}}><X size={18}/></button>
      </div>
      {!real&&<div style={{margin:'0.9rem 1.25rem 0',padding:'0.6rem 0.9rem',background:'var(--accent-bg)',border:'1px solid var(--blue-200)',borderRadius:'var(--radius)',fontSize:'0.78rem',color:'var(--blue-700)'}}>Modo <strong>simulação</strong>: nada será alterado nos sistemas, só registrado no histórico. Para valer de verdade, ligue o <strong>Modo real</strong> na barra da aba Remover acesso.</div>}
      <div style={{overflowY:'auto',padding:'0.9rem 1.25rem',flex:1}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8rem'}}>
          <thead><tr>{['Pessoa','Sistema','Conta',result?'Resultado':'O que será feito'].map(h=><th key={h} style={{textAlign:'left',padding:'0.4rem 0.5rem',fontSize:'0.7rem',color:'var(--text2)',textTransform:'uppercase',letterSpacing:0.6}}>{h}</th>)}</tr></thead>
          <tbody>{items.map(i=>{const k=`${i.matricula}|${i.platform}|${i.account_email}`;const r=byKey[k];const[c,Icon]=STATUS_STYLE[r?.status]||[];return<tr key={k} style={{borderTop:'1px solid var(--border)'}}>
            <td style={{padding:'0.45rem 0.5rem'}}>{i.person_name}<div style={{fontSize:'0.7rem',color:'var(--text3)',fontFamily:'var(--font-mono)'}}>mat. {i.matricula}</div></td>
            <td style={{padding:'0.45rem 0.5rem',whiteSpace:'nowrap'}}>{PL[i.platform]||i.platform}</td>
            <td style={{padding:'0.45rem 0.5rem',fontFamily:'var(--font-mono)',fontSize:'0.72rem',color:'var(--text2)'}}>{i.account_email}</td>
            <td style={{padding:'0.45rem 0.5rem',fontSize:'0.75rem',color:r?c:'var(--text2)'}}>{r?<span style={{display:'flex',gap:4,alignItems:'flex-start'}}><Icon size={13} style={{flexShrink:0,marginTop:2}}/>{r.detail}</span>:API_PLATFORMS.includes(i.platform)?ACTION_TEXT[i.platform]+(i.platform==='365'&&removeLic?' + remover licenças':''):'sem API: marcar como feito à mão'}</td>
          </tr>;})}</tbody>
        </table>
      </div>
      <div style={{padding:'0.9rem 1.25rem',borderTop:'1px solid var(--border)'}}>
        {error&&<div style={{color:'var(--red)',fontSize:'0.8rem',marginBottom:'0.6rem'}}>{error}</div>}
        {result?<div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:'0.82rem',color:'var(--text2)'}}>{result.simulated?'Simulação concluída':'Concluído'}: {result.results.filter(r=>['ok','manual','simulado'].includes(r.status)).length} ok, {result.results.filter(r=>r.status==='erro').length} erro(s). Tudo foi registrado no Histórico.</span>
          <button onClick={onDone} style={{padding:'0.5rem 1.1rem',background:'var(--accent)',border:'none',borderRadius:'var(--radius)',color:'#fff',fontWeight:600,fontSize:'0.82rem'}}>Fechar</button>
        </div>:<>
          {has365&&<label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:'0.8rem',marginBottom:'0.75rem',color:'var(--text)'}}><input type="checkbox" checked={removeLic} onChange={e=>setRemoveLic(e.target.checked)} style={{marginTop:3}}/><span>Também <strong>remover as licenças</strong> do Microsoft 365 (libera o custo). <span style={{color:'var(--red)'}}>A caixa de e-mail é apagada 30 dias depois</span>; dá para devolver as licenças pelo Histórico antes disso.</span></label>}
          {real&&<div style={{fontSize:'0.8rem',marginBottom:'0.75rem'}}>As contas serão desativadas <strong>agora</strong> nos sistemas. Para confirmar, digite <strong>DESATIVAR</strong>: <input value={typed} onChange={e=>setTyped(e.target.value)} style={{marginLeft:6,padding:'0.3rem 0.5rem',border:'1px solid var(--border)',borderRadius:6,fontSize:'0.8rem',width:130}}/></div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',alignItems:'center'}}>
            {running&&<span style={{fontSize:'0.78rem',color:'var(--text2)',display:'flex',gap:6,alignItems:'center'}}><Loader size={14} style={{animation:'spin 1s linear infinite'}}/>{progress}/{items.length}</span>}
            <button onClick={onClose} disabled={running} style={{padding:'0.5rem 1rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.82rem'}}>Cancelar</button>
            {real&&<button onClick={()=>run(true)} disabled={running} style={{padding:'0.5rem 1rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text)',fontSize:'0.82rem'}}>Só simular</button>}
            <button onClick={()=>run(!real)} disabled={!canRun} style={{padding:'0.5rem 1.1rem',background:real?'var(--red)':'var(--accent)',border:'none',borderRadius:'var(--radius)',color:'#fff',fontWeight:600,fontSize:'0.82rem',opacity:canRun?1:0.5}}>{real?'Desativar agora':'Simular'}</button>
          </div>
        </>}
      </div>
    </div>
  </div>;
}
