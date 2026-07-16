import React, { useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import Import from './pages/Import.jsx';
import Users from './pages/Users.jsx';
import Licenses from './pages/Licenses.jsx';
import Docusign from './pages/Docusign.jsx';
import Google from './pages/Google.jsx';
import Sidebar from './components/Sidebar.jsx';

export default function App() {
  const [page, setPage] = useState('dashboard');
  
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar current={page} onChange={setPage} />
      
      {/* O React vai carregar todas as telas, mas só mostrar a que você clicou! */}
      <main style={{ flex: 1, padding: '2rem 2.5rem', overflowY: 'auto', maxHeight: '100vh', background: 'var(--bg)' }}>
        <div style={{ display: page === 'dashboard' ? 'block' : 'none' }}><Dashboard /></div>
        <div style={{ display: page === 'licenses' ? 'block' : 'none' }}><Licenses /></div>
        <div style={{ display: page === 'docusign' ? 'block' : 'none' }}><Docusign /></div>
        <div style={{ display: page === 'google' ? 'block' : 'none' }}><Google /></div>
        <div style={{ display: page === 'import' ? 'block' : 'none' }}><Import /></div>
        <div style={{ display: page === 'users' ? 'block' : 'none' }}><Users /></div>
      </main>
    </div>
  );
}