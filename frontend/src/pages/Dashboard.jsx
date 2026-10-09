
import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, Users, Shield, RefreshCw, TrendingUp, Activity, BadgeCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../hooks/api.js';
import { PLATFORM_COLORS as PC, PLATFORM_LABELS as PL } from '../lib/platforms.js';
import RiskBadge from '../components/RiskBadge.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { CountUp } from '../components/ui.jsx';
function StatCard({label,value,sub,color,icon:Icon,loading}){
  return(<div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem 1.5rem',boxShadow:'var(--shadow-sm)',borderTop:`3px solid ${color||'var(--accent)'}`}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
      <div>
        <div style={{fontSize:'0.72rem',color:'var(--text2)',fontWeight:600,textTransform:'uppercase',letterSpacing:0.8,marginBottom:'0.5rem'}}>{label}</div>
        <div style={{fontSize:'2rem',fontWeight:700,color:'var(--text)',lineHeight:1}}>{loading?'—':<CountUp value={value}/>}</div>
        {sub&&<div style={{fontSize:'0.75rem',color:'var(--text3)',marginTop:'0.35rem'}}>{sub}</div>}
      </div>
      {Icon&&<div style={{width:40,height:40,borderRadius:10,background:`${color||'var(--accent)'}18`,display:'flex',alignItems:'center',justifyContent:'center'}}><Icon size={20} color={color||'var(--accent)'} strokeWidth={1.8}/></div>}
    </div>
  </div>);
}
export default function Dashboard(){
  const[stats,setStats]=useState(null);const[risk,setRisk]=useState([]);const[loading,setLoading]=useState(true);const[error,setError]=useState(null);const[licHealth,setLicHealth]=useState([]);
  const load=async()=>{
    setLoading(true);setError(null);
    try{const[s,r]=await Promise.all([api.get('/stats',{noCache:true}),api.get('/users/risk',{noCache:true})]);setStats(s);setRisk(r.slice(0,10));}catch(e){setError(e.message||'Erro ao carregar o dashboard.');}finally{setLoading(false);}
    // Saúde de licenças — agrega assentos do DocuSign + SKUs do M365. Não bloqueia o
    // dashboard se qualquer uma falhar (cada chamada tem seu proprio catch).
    try{
      const[ds,m365]=await Promise.all([api.get('/docusign/status',{noCache:true}).catch(()=>null),api.get('/microsoft365/licenses',{noCache:true}).catch(()=>null)]);
      const items=[];
      const seats=ds?.license_summary?.included_seats;
      if(seats){items.push({name:'DocuSign — Professional',used:ds.license_summary.professional,total:seats});}
      (m365||[]).forEach(l=>{if(l.total>0&&l.total<1000000)items.push({name:l.friendly_name,used:l.consumed,total:l.total});});
      setLicHealth(items);
    }catch{/* mantem o que ja tem */}
  };
  useEffect(()=>{load();},[]);
const handleClearTerminated = async () => {
    if (!window.confirm("Tem certeza que deseja limpar a lista de desligados? As contas nas plataformas não serão afetadas.")) return;
    try {
      // Usa o cliente api (passa pelo proxy /api do nginx + Basic Auth e limpa o cache).
      // Antes isto chamava http://host:8000 direto, furando o proxy/auth e quebrando em
      // produção (a porta 8000 não é exposta ao navegador).
      await api.delete('/users/terminated/clear');
      load(); // Atualiza os gráficos na hora
    } catch (e) {
      console.error(e);
      alert(e.message || "Erro ao limpar a lista de desligados.");
    }
  };
  const chartData=Object.entries(stats?.exposure_by_platform||{}).map(([k,v])=>({name:PL[k]||k,key:k,value:v})).sort((a,b)=>b.value-a.value);
  return(<div style={{animation:'fadeIn 0.3s ease'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.75rem'}}>
      <div><h1 className="h1">Visão geral</h1><p style={{color:'var(--text2)',fontSize:'0.85rem',marginTop:3}}>Visão geral de acessos de usuários desligados</p></div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={handleClearTerminated} style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 1rem',background:'var(--red)',border:'none',borderRadius:'var(--radius)',color:'#fff',fontSize:'0.82rem',boxShadow:'var(--shadow-sm)', cursor:'pointer'}}>
          Limpar Desligados
        </button>
        <button onClick={load} style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 1rem',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',color:'var(--text2)',fontSize:'0.82rem',boxShadow:'var(--shadow-sm)', cursor:'pointer'}}>
          <RefreshCw size={13}/>Atualizar
        </button>
      </div>
    </div>
    <ErrorBanner message={error} onRetry={load}/>
    <div className="stagger" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem',marginBottom:'1.5rem'}}>
      <StatCard label="Desligados na base" icon={Users} loading={loading} value={stats?.total_terminated??0} sub="total importado do RH" color="var(--blue-500)"/>
      <StatCard label="Com acesso ativo" icon={AlertTriangle} loading={loading} value={stats?.terminated_with_active_access??0} sub="certeza (matrícula/e-mail) — remover" color="var(--red)"/>
      <Link to="/offboarding/revisar" style={{textDecoration:'none'}}><StatCard label="A revisar" icon={Activity} loading={loading} value={stats?.to_review??0} sub={`sem certeza total · ${stats?.rehired??0} recontratados`} color="#d97706"/></Link>
    </div>
    {licHealth.length>0&&(()=>{
      const withPct=licHealth.map(l=>({...l,ratio:l.total>0?l.used/l.total:0}));
      const alerts=withPct.filter(l=>l.ratio>=0.9).sort((a,b)=>b.ratio-a.ratio);
      return <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.5rem',boxShadow:'var(--shadow-sm)',marginBottom:'1.25rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:alerts.length?'1rem':0}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}><BadgeCheck size={15} color="var(--accent)"/><h2 style={{fontSize:'0.82rem',fontWeight:600,color:'var(--text)',textTransform:'uppercase',letterSpacing:0.8}}>Saúde de Licenças</h2></div>
          <span style={{fontSize:'0.75rem',fontWeight:600,color:alerts.length?'var(--red)':'var(--green)'}}>{alerts.length?`⚠ ${alerts.length} perto/acima do limite`:`✓ ${withPct.length} licenças dentro do limite`}</span>
        </div>
        {alerts.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',gap:'0.75rem'}}>
          {alerts.map((l,i)=>{const over=l.used>l.total;const color=over?'var(--red)':'var(--yellow)';return(
            <div key={i} style={{border:`1px solid ${color}`,borderRadius:'var(--radius)',padding:'0.75rem 0.9rem',background:over?'var(--red-bg)':'var(--yellow-bg)'}}>
              <div title={l.name} style={{fontSize:'0.75rem',fontWeight:600,marginBottom:'0.35rem',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l.name}</div>
              <div style={{fontSize:'0.95rem',fontWeight:700,color:'var(--text)'}}>{l.used} <span style={{fontSize:'0.72rem',fontWeight:500,color:'var(--text3)'}}>/ {l.total}</span></div>
              <div style={{height:4,background:'var(--border)',borderRadius:2,marginTop:'0.4rem',overflow:'hidden'}}><div className="bar-fill" style={{height:'100%',width:`${Math.min(100,l.ratio*100)}%`,background:color}}/></div>
              <div style={{fontSize:'0.64rem',fontWeight:600,color,marginTop:'0.3rem'}}>{over?`${l.used-l.total} acima do limite`:'perto do limite (90%+)'}</div>
            </div>
          );})}
        </div>}
      </div>;
    })()}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem',marginBottom:'1.25rem'}}>
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.5rem',boxShadow:'var(--shadow-sm)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'1.25rem'}}><TrendingUp size={15} color="var(--accent)"/><h2 style={{fontSize:'0.82rem',fontWeight:600,color:'var(--text)',textTransform:'uppercase',letterSpacing:0.8}}>Exposição por Plataforma</h2></div>
        {loading?<div style={{height:200,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)'}}>Carregando...</div>:
        <ResponsiveContainer width="100%" height={200}><BarChart data={chartData} barCategoryGap="35%">
          <XAxis dataKey="name" tick={{fill:'var(--text2)',fontSize:10}} axisLine={false} tickLine={false}/>
          <YAxis tick={{fill:'var(--text2)',fontSize:10}} axisLine={false} tickLine={false} allowDecimals={false}/>
          <Tooltip contentStyle={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
          <Bar dataKey="value" radius={[4,4,0,0]}>{chartData.map((e,i)=><Cell key={i} fill={PC[e.key]||'var(--accent)'}/>)}</Bar>
        </BarChart></ResponsiveContainer>}
      </div>
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.5rem',boxShadow:'var(--shadow-sm)'}}>
        <h2 style={{fontSize:'0.82rem',fontWeight:600,color:'var(--text)',textTransform:'uppercase',letterSpacing:0.8,marginBottom:'1.25rem'}}>Usuários por Plataforma</h2>
        <div style={{display:'flex',flexDirection:'column',gap:'0.75rem'}}>
          {Object.entries(stats?.platform_users||{}).map(([plat,count])=>{
            const max=Math.max(...Object.values(stats?.platform_users||{}),1);
            const pct=Math.round((count/max)*100);const color=PC[plat]||'var(--accent)';
            return(<div key={plat}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:'0.8rem',fontWeight:500}}>{PL[plat]||plat}</span><span style={{fontSize:'0.78rem',fontFamily:'var(--font-mono)',color:'var(--text2)'}}><CountUp value={count}/></span></div><div style={{height:5,background:'var(--bg3)',borderRadius:3}}><div className="bar-fill" style={{height:'100%',width:`${pct}%`,background:color,borderRadius:3}}/></div></div>);
          })}
          {!stats&&<div style={{color:'var(--text3)',fontSize:'0.82rem'}}>Importe os CSVs para ver dados.</div>}
        </div>
      </div>
    </div>
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-sm)'}}>
      <div style={{padding:'1.25rem 1.5rem',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}><AlertTriangle size={15} color="var(--red)"/><h2 style={{fontSize:'0.85rem',fontWeight:600}}>Desligados com Acesso Ativo</h2></div>
        <span style={{fontSize:'0.72rem',color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{risk.length} registros</span>
      </div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
        <thead><tr style={{background:'var(--bg3)'}}>{['Email','Nome','Departamento','Desligamento','Plataformas','Risco'].map(h=><th key={h} style={{padding:'0.65rem 1rem',textAlign:'left',color:'var(--text2)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:0.7,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>
          {loading?<tr><td colSpan={6} style={{textAlign:'center',padding:'2.5rem',color:'var(--text3)'}}>Carregando...</td></tr>:
          risk.length===0?<tr><td colSpan={6} style={{textAlign:'center',padding:'2.5rem',color:'var(--green)',fontSize:'0.85rem'}}>✓ Nenhum usuário desligado com acesso ativo</td></tr>:
          risk.map((u)=><tr key={u.email} style={{borderTop:'1px solid var(--border)',transition:'background 0.1s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--blue-50)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <td style={{padding:'0.7rem 1rem',fontFamily:'var(--font-mono)',fontSize:'0.75rem',color:'var(--text2)'}}>{u.email}</td>
            <td style={{padding:'0.7rem 1rem',fontWeight:500}}>{u.name||'—'}</td>
            <td style={{padding:'0.7rem 1rem',color:'var(--text2)'}}>{u.department||'—'}</td>
            <td style={{padding:'0.7rem 1rem',fontFamily:'var(--font-mono)',fontSize:'0.75rem'}}>{u.termination_date||'—'}</td>
            <td style={{padding:'0.7rem 1rem'}}><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{u.active_platforms.map(p=><span key={p} style={{padding:'2px 7px',borderRadius:4,fontSize:'0.65rem',fontFamily:'var(--font-mono)',background:`${PC[p]||'#888'}15`,color:PC[p]||'var(--text2)',border:`1px solid ${PC[p]||'#888'}30`}}>{PL[p]||p}</span>)}</div></td>
            <td style={{padding:'0.7rem 1rem'}}><RiskBadge level={u.risk_level}/></td>
          </tr>)}
        </tbody>
      </table></div>
    </div>
  </div>);
}
