import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ArrowRight } from 'lucide-react';
import { api } from '../hooks/api.js';
import { Badge, CountUp, Skeleton } from './ui.jsx';

// Saúde de licenças: resumo por sistema.
// Só o DocuSign Professional tem alerta (contrato por assento). No M365, 100% de
// uso é normal: mostramos só uso/total das licenças pagas, sem alarme.
const M365_LIMIT = 6;

function Bar({ ratio, color }) {
  return (
    <div style={{ height: 6, background: 'var(--sunken)', borderRadius: 3, overflow: 'hidden' }}>
      <div className="bar-fill" style={{ height: '100%', width: `${Math.min(100, ratio * 100)}%`, background: color, borderRadius: 3 }} />
    </div>
  );
}

function DocusignBlock({ ds }) {
  if (!ds) return <div className="small muted">DocuSign sem dados. Rode o sync.</div>;
  const { professional: used = 0, seats, gaps = 0 } = ds;
  const over = seats != null && used > seats;
  const full = seats != null && !over && used === seats;
  const color = over ? 'var(--danger)' : full ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">Professional atribuídas</span>
        {seats != null && (over ? <Badge tone="danger">{used - seats} acima do contrato</Badge>
          : full ? <Badge tone="warning">Sem licença livre</Badge> : <Badge tone="success">{seats - used} livres</Badge>)}
      </div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, lineHeight: 1.1 }}>
        <CountUp value={used} />{seats != null && <span className="muted" style={{ fontSize: 'var(--text-md)', fontWeight: 500 }}> de {seats} contratadas</span>}
      </div>
      {seats != null && <Bar ratio={seats ? used / seats : 0} color={color} />}
      {gaps > 0 && (
        <Link to="/sistemas/docusign" className="row small" style={{ gap: 6, color: 'var(--priority)', textDecoration: 'none', fontWeight: 600 }}>
          {gaps} gap{gaps > 1 ? 's' : ''} podem liberar licença Professional <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

function M365Block({ list }) {
  const [all, setAll] = useState(false);
  if (!list?.length) return <div className="small muted">Microsoft 365 sem dados. Rode o sync.</div>;
  const shown = all ? list : list.slice(0, M365_LIMIT);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {shown.map(l => (
        <div key={l.name} className="stack" style={{ gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span className="small" style={{ fontWeight: l.office ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>{l.name}</span>
            <span className="mono small" style={{ flexShrink: 0 }}><CountUp value={l.consumed} /><span className="muted"> / {l.total.toLocaleString('pt-BR')}</span></span>
          </div>
          <Bar ratio={l.total ? l.consumed / l.total : 0} color="var(--p-365)" />
        </div>
      ))}
      {list.length > M365_LIMIT && (
        <button type="button" className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(v => !v)}>
          {all ? 'Mostrar menos' : `Ver todas (${list.length})`}
        </button>
      )}
    </div>
  );
}

function GoogleBlock({ g }) {
  if (!g) return <div className="small muted">Google Workspace sem dados. Rode o sync.</div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="small muted">Contas ativas</span>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, lineHeight: 1.1 }}><CountUp value={g.active} /></div>
      <Bar ratio={g.total ? g.active / g.total : 0} color="var(--p-google)" />
      <span className="xs muted"><CountUp value={g.suspended} /> suspensas · {g.total.toLocaleString('pt-BR')} no total</span>
    </div>
  );
}

export default function LicenseHealth() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.get('/licenses/health', { noCache: true }).then(setData).catch(() => setFailed(true)); }, []);
  if (failed) return null;

  const ds = data?.docusign;
  const dsOver = ds?.seats != null && ds.professional > ds.seats;
  const col = (title, color, children) => (
    <section className="card" style={{ padding: 16 }}>
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
        <h3 className="small" style={{ fontWeight: 600 }}>{title}</h3>
      </div>
      {children}
    </section>
  );

  return (
    <div className="card" style={{ padding: 20, marginBottom: '1.25rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="row" style={{ gap: 8 }}><BadgeCheck size={16} color="var(--brand)" /><h2 className="h2">Saúde de licenças</h2></div>
        {ds && (dsOver ? <Badge tone="danger">DocuSign acima do contrato</Badge> : <Badge tone="success">DocuSign dentro do contrato</Badge>)}
      </div>
      {!data ? <Skeleton rows={2} height={90} /> : (
        <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {col('DocuSign · Professional', 'var(--p-docusign)', <DocusignBlock ds={ds} />)}
          {col('Microsoft 365 · licenças pagas', 'var(--p-365)', <M365Block list={data.m365} />)}
          {col('Google Workspace', 'var(--p-google)', <GoogleBlock g={data.google} />)}
        </div>
      )}
    </div>
  );
}
