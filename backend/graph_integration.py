"""
Microsoft Graph API Integration (App Registration + Client Credentials)
1 App Registration (consentido pelo Global Admin) → acessa todos os usuários e licenças do tenant
"""
import os, time
import requests

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

_token_cache: dict = {}

def get_config():
    return {
        "tenant_id":     os.getenv("MS_TENANT_ID", ""),
        "client_id":     os.getenv("MS_CLIENT_ID", ""),
        "client_secret": os.getenv("MS_CLIENT_SECRET", ""),
    }

def get_graph_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    cache_key = f"{tenant_id}:{client_id}"
    cached = _token_cache.get(cache_key)
    if cached and time.time() < cached["expires_at"] - 60:
        return cached["token"]

    resp = requests.post(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise Exception(f"Erro ao obter token Graph ({resp.status_code}): {resp.text[:400]}")

    data = resp.json()
    token = data["access_token"]
    _token_cache[cache_key] = {"token": token, "expires_at": time.time() + data.get("expires_in", 3600)}
    return token

def get_users(token: str) -> list:
    headers = {"Authorization": f"Bearer {token}"}
    # employeeId = matrícula do SAP (chave do offboarding); proxyAddresses/otherMails =
    # aliases, usados para achar a pessoa nos outros sistemas.
    url = (f"{GRAPH_BASE}/users?$select=id,displayName,mail,userPrincipalName,"
           f"accountEnabled,assignedLicenses,employeeId,proxyAddresses,otherMails,onPremisesSyncEnabled,jobTitle&$top=999")
    all_users = []
    while url:
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code != 200:
            raise Exception(f"Erro Graph API /users ({resp.status_code}): {resp.text[:400]}")
        data = resp.json()
        all_users.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
    return all_users

def get_subscribed_skus(token: str) -> list:
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{GRAPH_BASE}/subscribedSkus", headers=headers, timeout=30)
    if resp.status_code != 200:
        raise Exception(f"Erro Graph API /subscribedSkus ({resp.status_code}): {resp.text[:400]}")
    return resp.json().get("value", [])

# Microsoft não expõe nome amigável via Graph — só o skuPartNumber (identificador interno).
SKU_FRIENDLY_NAMES = {
    "SPE_E3": "Microsoft 365 E3",
    "SPE_E5": "Microsoft 365 E5",
    "ENTERPRISEPACK": "Office 365 E3",
    "ENTERPRISEPREMIUM": "Office 365 E5",
    "ENTERPRISEWITHSCAL": "Office 365 E4",
    "O365_BUSINESS_PREMIUM": "Microsoft 365 Business Standard",
    "SPB": "Microsoft 365 Business Premium",
    "O365_BUSINESS_ESSENTIALS": "Microsoft 365 Business Basic",
    "O365_BUSINESS": "Microsoft 365 Apps for Business",
    "EMS": "Enterprise Mobility + Security E3",
    "EMSPREMIUM": "Enterprise Mobility + Security E5",
    "POWER_BI_PRO": "Power BI Pro",
    "POWER_BI_STANDARD": "Power BI (Grátis)",
    "FLOW_FREE": "Power Automate (Grátis)",
    "TEAMS_EXPLORATORY": "Teams Exploratory",
    "STREAM": "Microsoft Stream",
    "VISIOCLIENT": "Visio Plan 2",
    "PROJECTPROFESSIONAL": "Project Plan 3",
    "PROJECTPREMIUM": "Project Plan 5",
    "AAD_PREMIUM": "Azure AD Premium P1",
    "AAD_PREMIUM_P2": "Azure AD Premium P2",
    "SPZA_IW": "App Connect (Grátis)",
    "WACONEDRIVESTANDARD": "OneDrive for Business (Plan 1)",
    "WACONEDRIVEENTERPRISE": "OneDrive for Business (Plan 2)",
}

def sku_friendly_name(sku_part_number: str) -> str:
    return SKU_FRIENDLY_NAMES.get(sku_part_number, sku_part_number)


# ─── Ações de offboarding (escrita) ──────────────────────────────────────────
# Permissões de APLICAÇÃO necessárias (com consentimento de admin), mínimas:
#   User.EnableDisableAccount.All  → bloquear/desbloquear entrada
#   User.RevokeSessions.All        → derrubar sessões abertas
#   LicenseAssignment.ReadWrite.All → só se for remover licenças

def _write_error(resp, what):
    if "on-premise" in resp.text.lower() or "directory sync" in resp.text.lower():
        return Exception("Conta sincronizada do AD local: desative no Active Directory (o Entra replica).")
    if resp.status_code in (401, 403):
        return Exception(f"Sem permissão no Microsoft Graph para {what} ({resp.status_code}). "
                         f"Conceda a permissão de aplicação no App Registration e o consentimento de admin.")
    return Exception(f"Erro Graph ao {what} ({resp.status_code}): {resp.text[:300]}")

def _user_url(key: str) -> str:
    # '#' de convidados (#EXT#) precisa virar %23; '@' pode ficar
    return f"{GRAPH_BASE}/users/{requests.utils.quote(key, safe='@')}"

def set_account_enabled(token: str, key: str, enabled: bool) -> None:
    resp = requests.patch(_user_url(key), json={"accountEnabled": enabled},
                          headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if resp.status_code not in (200, 204):
        raise _write_error(resp, "desativar a conta" if not enabled else "reativar a conta")

def revoke_sessions(token: str, key: str) -> None:
    resp = requests.post(_user_url(key) + "/revokeSignInSessions",
                         headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if resp.status_code not in (200, 204):
        raise _write_error(resp, "revogar as sessões")

def remove_all_licenses(token: str, key: str) -> list:
    """Remove todas as licenças e devolve os skuIds removidos (para poder devolver depois)."""
    h = {"Authorization": f"Bearer {token}"}
    resp = requests.get(_user_url(key) + "?$select=assignedLicenses", headers=h, timeout=20)
    if resp.status_code != 200:
        raise _write_error(resp, "ler as licenças")
    skus = [l["skuId"] for l in resp.json().get("assignedLicenses", [])]
    if skus:
        resp = requests.post(_user_url(key) + "/assignLicense", json={"addLicenses": [], "removeLicenses": skus},
                             headers=h, timeout=20)
        if resp.status_code != 200:
            raise _write_error(resp, "remover as licenças")
    return skus

def add_licenses(token: str, key: str, skus: list) -> None:
    if not skus:
        return
    resp = requests.post(_user_url(key) + "/assignLicense",
                         json={"addLicenses": [{"skuId": s, "disabledPlans": []} for s in skus], "removeLicenses": []},
                         headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if resp.status_code != 200:
        raise _write_error(resp, "devolver as licenças")
