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
 *  4) Para SUSPENDER/REATIVAR contas pelo AccessGuard (doPost):
 *     Project Settings → Script Properties → adicione ACCESSGUARD_TOKEN = <valor longo aleatório>
 *     e coloque o mesmo valor em GOOGLE_APPS_SCRIPT_TOKEN no .env do servidor.
 *     Sem essa propriedade o doPost recusa tudo.
 *  Depois de colar uma versão nova: Deploy → Manage deployments → editar → Version: New version
 *  (assim a URL /exec continua a mesma).
 */

// Employee ID do Admin Console (externalIds tipo "organization") = matrícula do SAP.
function employeeId_(u) {
  var ids = u.externalIds || [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i].type === 'organization' && ids[i].value) return String(ids[i].value);
  }
  return '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * POST {token, action: "suspend" | "unsuspend", email}
 * Só suspende (reversível) — nunca exclui conta.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('ACCESSGUARD_TOKEN');
    if (!expected || body.token !== expected) return json_({ success: false, error: 'token inválido' });
    if (['suspend', 'unsuspend'].indexOf(body.action) < 0 || !body.email) {
      return json_({ success: false, error: 'requisição inválida' });
    }
    var u = AdminDirectory.Users.update({ suspended: body.action === 'suspend' }, body.email);
    return json_({ success: true, email: u.primaryEmail, suspended: u.suspended });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}
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
          last_login: u.lastLoginTime || '',
          employee_id: employeeId_(u)
        });
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);

    return json_({ success: true, users: users });
  } catch (e) {
    return json_({ success: false, error: String(e) });
  }
}
