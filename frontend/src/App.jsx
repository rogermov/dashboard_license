import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import TopNav from './components/TopNav.jsx';
import { OffboardingProvider } from './hooks/useOffboarding.jsx';
import { Spinner } from './components/ui.jsx';

// Lazy-load: cada tela só carrega (e só busca dados) quando é aberta.
const OffboardingLayout = lazy(() => import('./pages/offboarding/OffboardingLayout.jsx'));
const Importar = lazy(() => import('./pages/offboarding/Importar.jsx'));
const Revisar = lazy(() => import('./pages/offboarding/Revisar.jsx'));
const Remover = lazy(() => import('./pages/offboarding/Remover.jsx'));
const Verificar = lazy(() => import('./pages/offboarding/Verificar.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Licenses = lazy(() => import('./pages/Licenses.jsx'));
const Sistemas = lazy(() => import('./pages/Sistemas.jsx'));

// Páginas antigas (fora do Offboarding) ainda usam o próprio espaçamento.
const Legacy = ({ children }) => <div className="page">{children}</div>;

export default function App() {
  return (
    <OffboardingProvider>
      <TopNav />
      <main>
        <Suspense fallback={<div className="empty"><Spinner /> Carregando…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/offboarding" replace />} />
            <Route path="/offboarding" element={<OffboardingLayout />}>
              <Route index element={<Navigate to="remover" replace />} />
              <Route path="importar" element={<Importar />} />
              <Route path="revisar" element={<Revisar />} />
              <Route path="remover" element={<Remover />} />
              <Route path="verificar" element={<Verificar />} />
            </Route>
            <Route path="/visao-geral" element={<Legacy><Dashboard /></Legacy>} />
            <Route path="/licencas" element={<Legacy><Licenses /></Legacy>} />
            <Route path="/sistemas" element={<Navigate to="/sistemas/m365" replace />} />
            <Route path="/sistemas/:sistema" element={<Sistemas />} />

            {/* Endereços antigos (favoritos) */}
            <Route path="/dashboard" element={<Navigate to="/visao-geral" replace />} />
            <Route path="/licenses" element={<Navigate to="/licencas" replace />} />
            <Route path="/import" element={<Navigate to="/offboarding/importar" replace />} />
            <Route path="/users" element={<Navigate to="/offboarding/remover" replace />} />
            <Route path="/microsoft365" element={<Navigate to="/sistemas/m365" replace />} />
            <Route path="/google" element={<Navigate to="/sistemas/google" replace />} />
            <Route path="/docusign" element={<Navigate to="/sistemas/docusign" replace />} />
            <Route path="*" element={<Navigate to="/offboarding" replace />} />
          </Routes>
        </Suspense>
      </main>
    </OffboardingProvider>
  );
}
