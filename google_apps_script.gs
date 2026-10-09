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
 *  5) PERMISSÃO PARA SUSPENDER (erro "You do not have permission to call directory.users.update"):
 *     o script foi autorizado quando só LIA usuários. Selecione a função autorizar() no topo do
 *     editor e clique em Executar ▶; aceite a tela do Google (ela pede "ver e gerenciar usuários").
 *     A conta precisa ser Super Admin ou ter o papel de admin "Gerenciamento de usuários".
 *  Depois de colar uma versão nova: Deploy → Manage deployments → editar → Version: New version
 *  (assim a URL /exec continua a mesma).
 */

// Execute UMA vez pelo editor (▶ Executar) para conceder a permissão de alterar usuários.
// Não altera nada: só lê o próprio usuário. O Google pede todas as permissões que o
// script usa (inclusive a de suspender, usada no doPost).
function autorizar() {
  var me = Session.getEffectiveUser().getEmail();
  var u = AdminDirectory.Users.get(me);
  Logger.log('Autorizado como ' + u.primaryEmail + '. Admin: ' + u.isAdmin + ' / admin delegado: ' + u.isDelegatedAdmin);
  if (false) AdminDirectory.Users.update({}, me); // nunca roda: só declara o uso do escopo de escrita
}

// Cargo do Admin Console (organizations[].title; o primário, se houver).
function jobTitle_(u) {
  var orgs = u.organizations || [];
  for (var i = 0; i < orgs.length; i++) if (orgs[i].primary && orgs[i].title) return String(orgs[i].title);
  for (var j = 0; j < orgs.length; j++) if (orgs[j].title) return String(orgs[j].title);
  return '';
}

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
          employee_id: employeeId_(u),
          job_title: jobTitle_(u)
        });
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);

    return json_({ success: true, users: users });
  } catch (e) {
    return json_({ success: false, error: String(e) });
  }
}
