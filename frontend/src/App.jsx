import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';

// Lazy-load: cada página só é carregada (e só dispara seus fetches) quando a
// rota é aberta. Antes o App montava as 7 páginas de uma vez (todas faziam
// fetch no load, mesmo as nunca abertas).
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Licenses = lazy(() => import('./pages/Licenses.jsx'));
const Docusign = lazy(() => import('./pages/Docusign.jsx'));
const Google = lazy(() => import('./pages/Google.jsx'));
const Microsoft365 = lazy(() => import('./pages/Microsoft365.jsx'));
const Import = lazy(() => import('./pages/Import.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));

export default function App() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem 2.5rem', overflowY: 'auto', maxHeight: '100vh', background: 'var(--bg)' }}>
        <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--text3)', fontSize: '0.85rem' }}>Carregando…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/licenses" element={<Licenses />} />
            <Route path="/docusign" element={<Docusign />} />
            <Route path="/google" element={<Google />} />
            <Route path="/microsoft365" element={<Microsoft365 />} />
            <Route path="/import" element={<Import />} />
            <Route path="/users" element={<Users />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
