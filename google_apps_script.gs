/**
 * AccessGuard — Google Workspace users export (Apps Script Web App)
 *
 * Publica isto como "Web App" e coloque a URL /exec em GOOGLE_APPS_SCRIPT_URL (.env).
 * O backend faz um GET simples (sem auth) e espera:
 *   { "success": true, "users": [ {email, name, status, org_unit, last_login}, ... ] }
 *
 * PRÉ-REQUISITOS:
 *  1) A conta que roda o script precisa ser ADMIN do Google Workspace.
 *  2) Ative o serviço avançado "Admin SDK API":
 *     Editor do Apps Script → Services (+) → "Admin SDK API" → Add  (identifier: AdminDirectory)
 *  3) Deploy → New deployment → tipo "Web app":
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Copie a "Web app URL" (termina em /exec) e ponha no .env.
 *     (Como o acesso é "Anyone", trate a URL como segredo — ela lista seus usuários.)
 */
function doGet() {
  try {
    var users = [];
    var pageToken;
    do {
      var resp = AdminDirectory.Users.list({
        customer: 'my_customer',
        maxResults: 500,
        orderBy: 'email',
        projection: 'full',
        pageToken: pageToken
      });
      (resp.users || []).forEach(function (u) {
        users.push({
          email: u.primaryEmail,
          name: u.name ? u.name.fullName : '',
          status: u.suspended ? 'suspended' : 'active',
          org_unit: u.orgUnitPath || '',
          last_login: u.lastLoginTime || ''
        });
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, users: users }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(e) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
