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
           f"accountEnabled,assignedLicenses,employeeId,proxyAddresses,otherMails&$top=999")
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
