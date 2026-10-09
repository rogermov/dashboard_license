import React, { Suspense, lazy } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { Spinner } from '../components/ui.jsx';

// Uma tela por sistema integrado, em abas. As telas em si continuam as mesmas.
const SYSTEMS = {
  m365: { label: 'Microsoft 365', Page: lazy(() => import('./Microsoft365.jsx')) },
  google: { label: 'Google Workspace', Page: lazy(() => import('./Google.jsx')) },
  docusign: { label: 'DocuSign', Page: lazy(() => import('./Docusign.jsx')) },
};

export default function Sistemas() {
  const { sistema } = useParams();
  const current = SYSTEMS[sistema];
  if (!current) return <Navigate to="/sistemas/m365" replace />;
  const { Page } = current;
  return (
    <div className="page">
      <nav className="tabs" aria-label="Sistemas">
        {Object.entries(SYSTEMS).map(([id, s]) => (
          <NavLink key={id} to={`/sistemas/${id}`} className="tabs__btn" aria-selected={id === sistema} style={{ textDecoration: 'none' }}>{s.label}</NavLink>
        ))}
      </nav>
      <Suspense fallback={<div className="empty"><Spinner /> Carregando…</div>}>
        <Page />
      </Suspense>
    </div>
  );
}
