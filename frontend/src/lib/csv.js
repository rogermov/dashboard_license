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
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
