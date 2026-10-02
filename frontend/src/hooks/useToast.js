import { useState, useCallback, useRef, useEffect } from 'react';

// Hook de toast: showToast(msg, ok) mostra e esconde sozinho após `timeout` ms.
// Antes cada página tinha seu próprio useState + setTimeout (sem limpar o timer).
export function useToast(timeout = 5000) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((msg, ok = true) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, ok });
    timer.current = setTimeout(() => setToast(null), timeout);
  }, [timeout]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { toast, showToast };
}
