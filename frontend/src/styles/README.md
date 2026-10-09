# Visual do AccessGuard — onde mexer

| Quero mudar…                         | Arquivo                                 |
|--------------------------------------|-----------------------------------------|
| Cores, fontes, raios, sombras        | `styles/tokens.css` (só variáveis)      |
| Aparência de botão, card, tabela, selo, faixa, etapas | `styles/ui.css` (classes)  |
| Estrutura de uma peça reutilizável (Badge, Notice, busca, abas, toast) | `components/ui.jsx` |
| Menu do topo                         | `components/TopNav.jsx`                 |
| As 4 etapas do mês                   | `pages/offboarding/OffboardingLayout.jsx` |
| Uma tela do offboarding              | `pages/offboarding/{Importar,Revisar,Remover,Verificar}.jsx` |

Regras simples:

- Em telas novas, use classes (`className="btn btn--primary"`), não `style={{...}}` com cores.
  Inline só para layout pontual (largura, margem).
- Cor nova? Crie a variável em `tokens.css` e use `var(--nome)`.
- Botões: `btn` + uma variação (`--primary` ação principal, `--priority` prioridade,
  `--danger` destrutiva, `--dark`, `--ghost`) + opcional `--sm` / `--block`.
- Selos: `<Badge tone="danger|warning|success|info|priority">`.
- As telas antigas (Visão geral, Licenças, Sistemas) ainda usam estilo inline com os nomes
  antigos (`--bg2`, `--text2`, `--accent`…). Eles apontam para os tokens novos no fim de
  `tokens.css`, então já seguem o visual. Migre para classes quando mexer nelas.
