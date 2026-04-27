import React, { useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import Import from './pages/Import.jsx';
import Users from './pages/Users.jsx';
import Licenses from './pages/Licenses.jsx';
import Docusign from './pages/Docusign.jsx';
import Sidebar from './components/Sidebar.jsx';
export default function App() {
  const [page, setPage] = useState('dashboard');
  const pages = { dashboard: Dashboard, import: Import, users: Users, licenses: Licenses, docusign: Docusign };
  const Page = pages[page] || Dashboard;
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar current={page} onChange={setPage} />
      <main style={{ flex: 1, padding: '2rem 2.5rem', overflowY: 'auto', maxHeight: '100vh', background: 'var(--bg)' }}>
        <Page />
      </main>
    </div>
  );
}
