import React from 'react';

// Selo de nível de risco (alto/médio/baixo). Antes duplicado em Dashboard e Users.
const LEVELS = {
  high: ['var(--red)', 'var(--red-bg)', 'ALTO'],
  medium: ['var(--yellow)', 'var(--yellow-bg)', 'MÉDIO'],
  low: ['var(--green)', 'var(--green-bg)', 'BAIXO'],
};

export default function RiskBadge({ level }) {
  const [color, bg, text] = LEVELS[level] || ['var(--text3)', 'var(--bg3)', level];
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, fontFamily: 'var(--font-mono)', background: bg, color }}>
      {text}
    </span>
  );
}
