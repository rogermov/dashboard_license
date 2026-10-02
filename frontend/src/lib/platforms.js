// Catálogo único das plataformas monitoradas — cores e rótulos.
// Antes esses mapas (PC/PL) estavam duplicados em Dashboard, Users, Licenses e Import,
// às vezes divergindo (ex.: "Google" vs "Google Workspace"). Fonte única agora.
export const PLATFORMS = ['365', 'docusign', 'lucid', 'bitbucket', 'jira', 'google'];

export const PLATFORM_LABELS = {
  '365': 'Microsoft 365',
  docusign: 'DocuSign',
  lucid: 'Lucid',
  bitbucket: 'Bitbucket',
  jira: 'Jira',
  google: 'Google',
};

export const PLATFORM_COLORS = {
  '365': '#1e5fad',
  docusign: '#7c3aed',
  lucid: '#d97706',
  bitbucket: '#059669',
  jira: '#0284c7',
  google: '#dc2626',
};
