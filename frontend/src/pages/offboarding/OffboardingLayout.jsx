import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useOffboarding } from '../../hooks/useOffboarding.jsx';
import { CountUp, fmtDateTime } from '../../components/ui.jsx';

// As 4 etapas do mês. Também são o menu do Offboarding: clicar leva à etapa.
function steps(s) {
  const n = v => (s ? v ?? 0 : '—');
  return [
    { to: 'importar', num: 1, label: 'Importar planilha do RH', value: n(s?.pessoas), hint: 'desligados' },
    { to: 'revisar', num: 2, label: 'Revisar casos incertos', value: n(s?.revisar), hint: s?.revisar ? 'pendentes' : 'nada pendente' },
    { to: 'remover', num: 3, label: 'Remover acesso', value: n(s?.agir), hint: 'pessoas' },
    { to: 'verificar', num: 4, label: 'Verificar', value: n(s?.alertas), hint: s?.alertas ? 'voltaram a ativar' : 'tudo certo', alert: !!s?.alertas },
  ];
}

export default function OffboardingLayout() {
  const { summary } = useOffboarding();
  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="small muted">
          {summary?.ultima_importacao ? `Última planilha importada em ${fmtDateTime(summary.ultima_importacao)}` : 'Nenhuma planilha importada ainda'}
        </span>
      </div>
      <nav aria-label="Etapas do offboarding">
        <ol className="stepper">
          {steps(summary).map(s => (
            <li key={s.to} style={{ display: 'contents' }}>
              <NavLink to={s.to} className={({ isActive }) => 'step' + (isActive ? ' active' : '') + (s.alert ? ' step--alert' : '')}>
                <div className="step__top"><span className="step__num">{s.num}</span><span className="step__label">{s.label}</span></div>
                <div className="step__value"><strong><CountUp value={s.value} /></strong><span>{s.hint}</span></div>
              </NavLink>
            </li>
          ))}
        </ol>
      </nav>
      <Outlet />
    </div>
  );
}
