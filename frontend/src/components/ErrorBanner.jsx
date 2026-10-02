import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Banner de erro com ação de "tentar novamente". Usado quando uma leitura falha,
// para o usuário não confundir falha de API com "nada encontrado".
export default function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--red)', fontSize: '0.82rem' }}>
      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button onClick={onRetry} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent', border: '1px solid var(--red)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: '0.75rem', fontWeight: 600, padding: '0.3rem 0.6rem', cursor: 'pointer' }}>
          <RefreshCw size={12} />Tentar novamente
        </button>
      )}
    </div>
  );
}
