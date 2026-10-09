// Peças de interface reutilizáveis. O visual vem de styles/ui.css (classes) e
// styles/tokens.css (cores/fontes): aqui só fica a estrutura e o comportamento.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Info, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { PLATFORM_LABELS } from '../lib/platforms.js';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function PlatformTag({ platform }) {
  return <span className="ptag" data-p={platform}>{PLATFORM_LABELS[platform] || platform}</span>;
}

export function Badge({ tone, children, title }) {
  return <span className={cx('badge', tone && `badge--${tone}`)} title={title}>{children}</span>;
}

const NOTICE_ICON = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 };
export function Notice({ tone = 'info', children, action }) {
  const Icon = NOTICE_ICON[tone] || Info;
  return (
    <div className={cx('notice', tone !== 'info' && `notice--${tone}`)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} aria-hidden="true" />
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><div className="empty__title">{title}</div>{children && <div>{children}</div>}</div>;
}

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="spin" aria-hidden="true" />;
}

// Busca com "Enter" ou automaticamente após uma pausa na digitação.
export function SearchInput({ value, onChange, placeholder = 'Buscar nome, matrícula ou e-mail', label = 'Buscar' }) {
  return (
    <label className="search">
      <Search size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" className="seg__btn" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="mono muted xs">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.value} type="button" role="tab" className="tabs__btn" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}{t.count ? <Badge tone={t.tone}>{t.count}</Badge> : null}
        </button>
      ))}
    </div>
  );
}

// Toast: const [toast, show] = useToast();
//   show('ok')  ·  show('falhou', true)  ·  show('feito', false, { label: 'Desfazer', onClick })
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const show = useCallback((msg, error = false, action = null) => {
    clearTimeout(timer.current);
    setToast({ msg, error, action, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), action ? 8000 : 5000);
  }, []);
  const node = toast ? (
    <div key={toast.id} className={cx('toast', toast.error && 'toast--error')} role="status" aria-live="polite">
      {toast.error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}<span style={{ flex: 1 }}>{toast.msg}</span>
      {toast.action && (
        <button type="button" className="btn btn--sm btn--on-dark" onClick={() => { setToast(null); toast.action.onClick(); }}>{toast.action.label}</button>
      )}
    </div>
  ) : null;
  return [node, show];
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Número que "conta" até o valor ao aparecer e ao mudar. Texto não numérico passa direto.
export function CountUp({ value, duration = 700 }) {
  const target = typeof value === 'number' ? value : Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : null;
  const [shown, setShown] = useState(target === null ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === null) { setShown(value); return undefined; }
    if (reducedMotion()) { setShown(target); from.current = target; return undefined; }
    const start = performance.now(); const a = from.current; let raf;
    const tick = now => {
      const t = Math.min(1, (now - start) / duration); const e = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + (target - a) * e));
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return <>{typeof shown === 'number' ? shown.toLocaleString('pt-BR') : shown}</>;
}

// Esqueleto de carregamento: <Skeleton rows={4} height={64} />
export function Skeleton({ rows = 3, height = 56, gap = 8 }) {
  return (
    <div className="stack" style={{ gap }} aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.12 }} />)}
    </div>
  );
}

export const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '—'); };
export const fmtDateTime = d => (d ? `${fmtDate(d)} ${d.slice(11, 16)}` : '—');
