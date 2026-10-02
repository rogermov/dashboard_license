// Exporta uma lista de objetos como CSV e dispara o download no navegador.
// Os cabeçalhos são as chaves do primeiro objeto — para colunas customizadas,
// mapeie os dados antes de chamar (ex.: data.map(u => ({ Email: u.email, ... }))).
// Antes essa função estava copiada em 5 páginas.
export function exportCSV(data, filename) {
  if (!data || !data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(k => `"${(row[k] ?? '').toString().replace(/"/g, '""')}"`).join(',')
  );
  // BOM (﻿) para o Excel abrir acentos corretamente.
  const blob = new Blob(['﻿' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });

  // Edge/IE legado
  if (typeof window !== 'undefined' && window.navigator && window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  // Precisa estar no DOM para o .click() disparar o download em vários navegadores.
  document.body.appendChild(a);
  a.click();
  // IMPORTANTE: revogar a URL / remover o <a> só DEPOIS, com um pequeno atraso.
  // Revogar imediatamente após o click() faz vários navegadores CANCELAREM o
  // download (a URL do blob some antes de o download começar) — era o motivo de
  // o botão não baixar mesmo com o <a> no DOM.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1000);
}
