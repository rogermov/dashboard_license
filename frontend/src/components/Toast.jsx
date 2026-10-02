import React from 'react';
import { CheckCircle, AlertTriangle } from 'lucide-react';

// Toast de feedback (sucesso/erro). Antes reimplementado inline em 4 páginas.
// role="alert" + aria-live faz leitores de tela anunciarem a mensagem.
export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: 'var(--bg2)', border: `1px solid ${toast.ok ? 'var(--green)' : 'var(--red)'}`, borderRadius: 'var(--radius-lg)', padding: '0.9rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.82rem', boxShadow: 'var(--shadow-lg)', maxWidth: 420 }}
    >
      {toast.ok ? <CheckCircle size={16} color="var(--green)" /> : <AlertTriangle size={16} color="var(--red)" />}
      <span>{toast.msg}</span>
    </div>
  );
}
