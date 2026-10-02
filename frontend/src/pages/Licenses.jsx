
import React,{useEffect,useState} from 'react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,Legend,Cell} from 'recharts';
import {RefreshCw,Download,Building2} from 'lucide-react';
import {api} from '../hooks/api.js';
import { PLATFORM_COLORS as PC, PLATFORM_LABELS as PL } from '../lib/platforms.js';
import { exportCSV } from '../lib/csv.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
export default function Licenses(){
  const[data,setData]=useState(null);const[loading,setLoading]=useState(true);const[sel,setSel]=useState('all');const[error,setError]=useState(null);
  const load=async()=>{setLoading(true);setError(null);try{setData(await api.get('/licenses/by-domain',{noCache:true}));}catch(e){setError(e.message||'Erro ao carregar as licenças.');setData(null);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const domains=data?Object.keys(data.by_domain).sort((a,b)=>{const ta=Object.values(data.by_domain[a]).reduce((s,v)=>s+v,0);const tb=Object.values(data.by_domain[b]).reduce((s,v)=>s+v,0);return tb-ta;}):[];
  const platforms=data?data.platforms:[];const active=sel==='all'?platforms:[sel];
  const chartData=domains.map(d=>{const r={domain:d.replace('@','')};active.forEach(p=>{r[p]=data.by_domain[d][p]||0;});return r;});
  const totalByPlatform={};platforms.forEach(p=>{totalByPlatform[p]=domains.reduce((s,d)=>s+(data?.by_domain[d][p]||0),0);});
  const csvData=domains.map(d=>{const r={dominio:d};platforms.forEach(p=>{r[PL[p]||p]=data?.by_domain[d][p]||0;});r['total']=platforms.reduce((s,p)=>s+(data?.by_domain[d][p]||0),0);return r;});
  return<div style={{animation:'fadeIn 0.3s ease'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.75rem'}}>
      <div><h1 style={{fontWeight:700,fontSize:'1.5rem',color:'var(--text)'}}>Licenças por Unidade</h1><p style={{color:'var(--text2)',fontSize:'0.85rem',marginTop:3}}>Distribuição por domínio e plataforma</p></div>
      <div style={{display:'flex',gap:'0.5rem'}}>
        <button onClick={()=>exportCSV(csvData,`licencas-${new Date().toISOString().slice(0,10)}.csv`)} disabled={!csvData.length} style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 1rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.82rem',boxShadow:'var(--shadow-sm)',opacity:csvData.length?1:0.5}}><Download size={13}/>Exportar</button>
        <button onClick={load} style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 1rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.82rem',boxShadow:'var(--shadow-sm)'}}><RefreshCw size={13}/>Atualizar</button>
      </div>
    </div>
    <ErrorBanner message={error} onRetry={load}/>
    {data&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:'0.75rem',marginBottom:'1.5rem'}}>
      {platforms.map(p=><div key={p} onClick={()=>setSel(sel===p?'all':p)} style={{background:sel===p?`${PC[p]}12`:'var(--bg2)',border:`1px solid ${sel===p?PC[p]:'var(--border)'}`,borderRadius:'var(--radius)',padding:'0.9rem 1rem',cursor:'pointer',boxShadow:'var(--shadow-sm)',borderTop:`3px solid ${PC[p]||'var(--accent)'}`}}>
        <div style={{fontSize:'0.7rem',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:0.6,marginBottom:'0.4rem'}}>{PL[p]||p}</div>
        <div style={{fontSize:'1.6rem',fontWeight:700,color:PC[p]||'var(--text)',lineHeight:1}}>{(totalByPlatform[p]||0).toLocaleString()}</div>
        <div style={{fontSize:'0.68rem',color:'var(--text3)',marginTop:'0.25rem'}}>usuários</div>
      </div>)}
    </div>}
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.5rem',boxShadow:'var(--shadow-sm)',marginBottom:'1.25rem'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
        <h2 style={{fontSize:'0.85rem',fontWeight:600}}>Usuários por Domínio{sel !== 'all' ? ` — ${PL[sel]||sel}` : ' — Todas as Plataformas'}</h2>
        {sel!=='all'&&<button onClick={()=>setSel('all')} style={{fontSize:'0.72rem',color:'var(--accent)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>Ver todas</button>}
      </div>
      {loading?<div style={{height:260,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)'}}>Carregando...</div>:!data||domains.length===0?<div style={{height:260,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'0.5rem',color:'var(--text3)'}}><Building2 size={32} strokeWidth={1}/><span style={{fontSize:'0.85rem'}}>Importe os CSVs das plataformas</span></div>:
      <ResponsiveContainer width="100%" height={260}><BarChart data={chartData} barCategoryGap="25%" barGap={2}>
        <XAxis dataKey="domain" tick={{fill:'var(--text2)',fontSize:10}} axisLine={false} tickLine={false}/>
        <YAxis tick={{fill:'var(--text2)',fontSize:10}} axisLine={false} tickLine={false} allowDecimals={false}/>
        <Tooltip contentStyle={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}} formatter={(v,n)=>[v,PL[n]||n]}/>
        <Legend formatter={n=>PL[n]||n} iconType="circle" iconSize={8} wrapperStyle={{fontSize:'0.75rem'}}/>
        {active.map(p=><Bar key={p} dataKey={p} fill={PC[p]||'#888'} radius={[3,3,0,0]}/>)}
      </BarChart></ResponsiveContainer>}
    </div>
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-sm)'}}>
      <div style={{padding:'1rem 1.5rem',borderBottom:'1px solid var(--border)'}}><h2 style={{fontSize:'0.85rem',fontWeight:600}}>Detalhamento por Domínio</h2></div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
        <thead><tr style={{background:'var(--bg3)'}}><th style={{padding:'0.65rem 1rem',textAlign:'left',color:'var(--text2)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:0.7}}>Domínio / Unidade</th>{platforms.map(p=><th key={p} style={{padding:'0.65rem 1rem',textAlign:'right',color:PC[p]||'var(--text2)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:0.7,whiteSpace:'nowrap'}}>{PL[p]||p}</th>)}<th style={{padding:'0.65rem 1rem',textAlign:'right',color:'var(--text2)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:0.7}}>Total</th></tr></thead>
        <tbody>
          {loading?<tr><td colSpan={platforms.length+2} style={{textAlign:'center',padding:'2.5rem',color:'var(--text3)'}}>Carregando...</td></tr>:domains.length===0?<tr><td colSpan={platforms.length+2} style={{textAlign:'center',padding:'2.5rem',color:'var(--text3)',fontSize:'0.85rem'}}>Nenhum dado. Importe os CSVs.</td></tr>:<>
            {domains.map((d,i)=>{const total=platforms.reduce((s,p)=>s+(data?.by_domain[d][p]||0),0);return<tr key={i} style={{borderTop:'1px solid var(--border)',transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--blue-50)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><td style={{padding:'0.7rem 1rem',fontFamily:'var(--font-mono)',fontSize:'0.78rem',fontWeight:500}}>{d}</td>{platforms.map(p=><td key={p} style={{padding:'0.7rem 1rem',textAlign:'right',fontFamily:'var(--font-mono)',fontSize:'0.78rem',color:(data.by_domain[d][p]||0)>0?'var(--text)':'var(--text3)'}}>{(data.by_domain[d][p]||0).toLocaleString()}</td>)}<td style={{padding:'0.7rem 1rem',textAlign:'right',fontFamily:'var(--font-mono)',fontSize:'0.78rem',fontWeight:700,color:'var(--accent)'}}>{total.toLocaleString()}</td></tr>;})}
            <tr style={{borderTop:'2px solid var(--border2)',background:'var(--bg3)'}}><td style={{padding:'0.7rem 1rem',fontWeight:700,fontSize:'0.78rem'}}>TOTAL</td>{platforms.map(p=><td key={p} style={{padding:'0.7rem 1rem',textAlign:'right',fontFamily:'var(--font-mono)',fontSize:'0.78rem',fontWeight:700,color:PC[p]||'var(--text)'}}>{(totalByPlatform[p]||0).toLocaleString()}</td>)}<td style={{padding:'0.7rem 1rem',textAlign:'right',fontFamily:'var(--font-mono)',fontSize:'0.78rem',fontWeight:700,color:'var(--accent)'}}>{platforms.reduce((s,p)=>s+(totalByPlatform[p]||0),0).toLocaleString()}</td></tr>
          </>}
        </tbody>
      </table></div>
    </div>
  </div>;
}
