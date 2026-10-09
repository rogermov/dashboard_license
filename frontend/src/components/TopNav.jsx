import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useOffboarding } from '../hooks/useOffboarding.jsx';

const LINKS = [
  { to: '/offboarding', label: 'Offboarding' },
  { to: '/visao-geral', label: 'Visão geral' },
  { to: '/licencas', label: 'Licenças' },
  { to: '/sistemas', label: 'Sistemas' },
];

function ModeToggle() {
  const { config, setMode } = useOffboarding();
  if (!config) return null;
  if (!config.allowed) {
    return <span className="mode-toggle" title="Travado no servidor (OFFBOARDING_ACTIONS_ENABLED=false)">Simulação</span>;
  }
  const on = !!config.enabled;
  const toggle = async () => {
    if (!on && !window.confirm('Ligar o MODO REAL? A partir daqui, "Desativar" altera as contas de verdade no M365, Google e DocuSign.')) return;
    try { await setMode(!on); } catch (e) { window.alert(e.message || 'Não foi possível trocar o modo.'); }
  };
  return (
    <button type="button" role="switch" aria-checked={on} className="mode-toggle" onClick={toggle}
      title={on ? 'Ações alteram contas de verdade. Clique para voltar à simulação.' : 'Nada é alterado nos sistemas. Clique para ligar o modo real.'}>
      <span className="mode-toggle__track" aria-hidden="true" />
      {on ? 'Modo real' : 'Simulação'}
    </button>
  );
}

export default function TopNav() {
  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link to="/offboarding" className="topnav__brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--brand-on-dark)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" />
          </svg>
          <span>AccessGuard<small>Comporte · gestão de acessos</small></span>
        </Link>
        <nav className="topnav__links" aria-label="Menu principal">
          {LINKS.map(l => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => 'topnav__link' + (isActive ? ' active' : '')}>{l.label}</NavLink>
          ))}
        </nav>
        <div className="topnav__right"><ModeToggle /></div>
      </div>
    </header>
  );
}
