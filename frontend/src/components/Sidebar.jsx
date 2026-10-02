import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Upload, Users, BarChart2, Shield, FileSignature, Chrome, Building2 } from 'lucide-react';

const nav = [
  { to: '/dashboard',    label: 'Dashboard',     icon: LayoutDashboard },
  { to: '/licenses',     label: 'Licenças',      icon: BarChart2 },
  { to: '/docusign',     label: 'DocuSign',      icon: FileSignature },
  { to: '/google',       label: 'Google',        icon: Chrome },
  { to: '/microsoft365', label: 'Microsoft 365', icon: Building2 },
  { to: '/import',       label: 'Importar',      icon: Upload },
  { to: '/users',        label: 'Usuários',      icon: Users },
];

export default function Sidebar() {
  return (
    <aside style={{ width: 220, minHeight: '100vh', background: 'var(--blue-900)', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
      <div style={{ padding: '1.5rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ width: 34, height: 34, background: 'var(--blue-400)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={18} color="#fff" strokeWidth={2.5} /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>Comporte</div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-mono)' }}>Gestão de Acessos</div>
          </div>
        </div>
      </div>
      <nav style={{ padding: '1rem 0.75rem', flex: 1 }}>
        {nav.map(({ to, label, icon: Icon }) => (
          // NavLink marca sozinho o item ativo (aria-current="page") pela rota atual.
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', padding: '0.6rem 0.75rem', marginBottom: '0.15rem', boxSizing: 'border-box',
              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent', borderRadius: 6, textDecoration: 'none',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.55)', fontSize: '0.85rem', fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid var(--blue-300)' : '3px solid transparent',
            })}
          >
            <Icon size={15} /> {label}
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-mono)' }}>v1.0.0 · <span style={{ color: '#34d399' }}>● online</span></div>
      </div>
    </aside>
  );
}
