"""
DocuSign JWT Grant Integration
1 Integration Key + 1 RSA Key → acessa múltiplos Account IDs
"""
import os, time, json, csv, io, requests
from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt

DS_AUTH_SERVER = "account.docusign.com"
DS_BASE_URL    = "https://account.docusign.com"

_token_cache: dict = {}

def get_config():
    return {
        "integration_key": os.getenv("DS_INTEGRATION_KEY", ""),
        "user_id":         os.getenv("DS_USER_ID", ""),
        "rsa_key_path":    os.getenv("DS_RSA_KEY_PATH", "/secrets/docusign.pem"),
        "accounts": [
            {"id": os.getenv("DS_ACCOUNT_ID_1",""), "name": os.getenv("DS_ACCOUNT_NAME_1","Viação Piracicabana"), "base_uri": os.getenv("DS_BASE_URI_1","")},
            {"id": os.getenv("DS_ACCOUNT_ID_2",""), "name": os.getenv("DS_ACCOUNT_NAME_2","MetroBH"),             "base_uri": os.getenv("DS_BASE_URI_2","")},
            {"id": os.getenv("DS_ACCOUNT_ID_3",""), "name": os.getenv("DS_ACCOUNT_NAME_3","Tic Trens"),           "base_uri": os.getenv("DS_BASE_URI_3","")},
            {"id": os.getenv("DS_ACCOUNT_ID_4",""), "name": os.getenv("DS_ACCOUNT_NAME_4","Trivia Trens"),        "base_uri": os.getenv("DS_BASE_URI_4","")},
        ]
    }

def get_jwt_token(integration_key: str, user_id: str, rsa_key_path: str) -> str:
    cache_key = f"{integration_key}:{user_id}"
    cached = _token_cache.get(cache_key)
    if cached and time.time() < cached["expires_at"] - 60:
        return cached["token"]

    try:
        with open(rsa_key_path, "r") as f:
            private_key = f.read()
    except FileNotFoundError:
        raise Exception(f"RSA key não encontrada: {rsa_key_path}")

    now = int(time.time())
    payload = {
        "iss": integration_key,
        "sub": user_id,
        "aud": DS_AUTH_SERVER,
        "iat": now,
        "exp": now + 3600,
        "scope": "signature impersonation",
    }

    assertion = jwt.encode(payload, private_key, algorithm="RS256")
    if isinstance(assertion, bytes):
        assertion = assertion.decode("utf-8")

    resp = requests.post(
        f"{DS_BASE_URL}/oauth/token",
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=15,
    )

    if resp.status_code != 200:
        raise Exception(f"Erro ao obter token: {resp.status_code} — {resp.text}")

    data = resp.json()
    token = data["access_token"]
    _token_cache[cache_key] = {"token": token, "expires_at": now + data.get("expires_in", 3600)}
    return token

def get_users_for_account(account: dict, access_token: str) -> list:
    base_uri = (account.get("base_uri") or "").rstrip("/")
    account_id = account["id"]
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

    all_users = []
    start = 0
    page_size = 100

    while True:
        url = f"{base_uri}/restapi/v2.1/accounts/{account_id}/users?count={page_size}&start_position={start}&additional_info=true"
        resp = requests.get(url, headers=headers, timeout=30)

        if resp.status_code != 200:
            raise Exception(f"Erro DocuSign API ({resp.status_code}): {resp.text[:400]}")

        data = resp.json()
        batch = data.get("users", [])

        for u in batch:
            s = (u.get("userStatus") or u.get("status") or "").lower()
            if s in ("active", "pending", "activationsent", "activationrequired", "created", "closed"):
                all_users.append(u)

        total = int(data.get("totalSetSize", 0))
        start += len(batch)
        if start >= total or not batch:
            break

    return all_users

_seats_cache: dict = {}

def get_included_seats(account: dict, access_token: str) -> int:
    """Total de seats do plano (compartilhado entre as contas da mesma assinatura). Cacheado por 1h."""
    account_id = account["id"]
    cached = _seats_cache.get(account_id)
    if cached and time.time() < cached["expires_at"]:
        return cached["total"]

    base_uri = (account.get("base_uri") or "").rstrip("/")
    headers = {"Authorization": f"Bearer {access_token}"}
    url = f"{base_uri}/restapi/v2.1/accounts/{account_id}/billing_plan"
    resp = requests.get(url, headers=headers, timeout=15)
    total = int(resp.json().get("billingPlan", {}).get("includedSeats", 0)) if resp.status_code == 200 else 0

    _seats_cache[account_id] = {"total": total, "expires_at": time.time() + 3600}
    return total

def generate_consent_url(integration_key: str) -> str:
    return (
        f"{DS_BASE_URL}/oauth/auth"
        f"?response_type=code&scope=signature%20impersonation"
        f"&client_id={integration_key}"
        f"&redirect_uri=https://account.docusign.com"
    )

def get_envelopes_count(account: dict, access_token: str, start_date: str, end_date: str) -> dict:
    base_uri = (account.get("base_uri") or "").rstrip("/")
    account_id = account["id"]
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

    sd = start_date.split("T")[0]
    ed = end_date.split("T")[0]

    # O relatório nativo do DocuSign roda no fuso de Brasília (UTC-3). "De 00:00 até 23:59"
    # em BRT equivale a "03:00 até 02:59:59 do dia seguinte" em UTC — sem essa conversão,
    # envelopes enviados no fim da noite (21h-23h59 BRT) do último dia ficavam de fora.
    from_utc_dt = datetime.strptime(sd, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(hours=3)
    to_utc_dt = datetime.strptime(ed, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1, hours=2, minutes=59, seconds=59)
    from_utc = from_utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_utc = to_utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    # from_date/to_date filtram pela data da ÚLTIMA MUDANÇA DE STATUS, não pela data de envio.
    # Um envelope enviado dentro do período mas anulado/concluído semanas depois "pertence" à
    # data da mudança de status na visão da API — e fica fora dessa busca, mesmo tendo sido
    # enviado dentro da janela. O relatório nativo do DocuSign ("Data do envio") não tem esse
    # problema. Para replicar esse comportamento, buscamos com uma janela extra à frente e
    # filtramos localmente pela data real de envio (sentDateTime) de cada envelope.
    query_to_utc = (to_utc_dt + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")

    url = f"{base_uri}/restapi/v2.1/accounts/{account_id}/envelopes?from_date={from_utc}&to_date={query_to_utc}&count=1000"
    user_counts = {}
    matched_total = 0
    pages = 0

    def parse_iso(s):
        if not s: return None
        try: return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError: return None

    # A API do DocuSign pagina os resultados (por padrão até 1000 por página).
    # Sem seguir o nextUri, contas com mais de 1000 envelopes no período ficavam
    # com o volume subcontado — e de forma arbitrária, dependendo de em qual
    # página cada envelope caía. Aqui seguimos nextUri até esgotar as páginas.
    while url:
        resp = requests.get(url, headers=headers, timeout=20)

        if resp.status_code != 200:
            if pages == 0:
                return {"total": 0, "users": [], "error": resp.text}
            break  # já temos dados parciais das páginas anteriores; não descarta

        data = resp.json()

        for env in data.get("envelopes", []):
            sent = parse_iso(env.get("sentDateTime"))
            if not sent or not (from_utc_dt <= sent <= to_utc_dt):
                continue  # enviado fora do período real (a janela extra trouxe mudanças de status de fora)

            sender = env.get("sender", {})
            email = (sender.get("email") or "Desconhecido").lower().strip()
            name = sender.get("userName") or "Desconhecido"

            if email not in user_counts:
                user_counts[email] = {"name": name, "email": email, "count": 0}
            user_counts[email]["count"] += 1
            matched_total += 1

        pages += 1
        next_uri = data.get("nextUri")
        url = f"{base_uri}/restapi/v2.1{next_uri}" if next_uri else None
        if pages >= 80:  # trava de segurança contra loop infinito
            break

    users_list = sorted(list(user_counts.values()), key=lambda x: x["count"], reverse=True)
    return {"total": matched_total, "users": users_list, "error": None}

# ─── ADMIN API (LicenseType real) ─────────────────────────────────────────────
# A eSignature API não deixa LER o tipo de licença (só gravar via PUT). O valor real
# (Free / Full - Professional) só existe na Admin API do DocuSign, via o mesmo export
# que a tela Admin → Usuários → Exportar gera manualmente — aqui disparamos e lemos
# esse export por API, para todas as contas da organização de uma vez.

ADMIN_SCOPE = "signature impersonation organization_read user_read account_read"
_admin_token_cache: dict = {}

def get_admin_token(integration_key: str, user_id: str, rsa_key_path: str) -> str:
    cache_key = f"admin:{integration_key}:{user_id}"
    cached = _admin_token_cache.get(cache_key)
    if cached and time.time() < cached["expires_at"] - 60:
        return cached["token"]

    try:
        with open(rsa_key_path, "r") as f:
            private_key = f.read()
    except FileNotFoundError:
        raise Exception(f"RSA key não encontrada: {rsa_key_path}")

    now = int(time.time())
    payload = {
        "iss": integration_key,
        "sub": user_id,
        "aud": DS_AUTH_SERVER,
        "iat": now,
        "exp": now + 3600,
        "scope": ADMIN_SCOPE,
    }
    assertion = jwt.encode(payload, private_key, algorithm="RS256")
    if isinstance(assertion, bytes):
        assertion = assertion.decode("utf-8")

    resp = requests.post(
        f"{DS_BASE_URL}/oauth/token",
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=15,
    )
    if resp.status_code != 200:
        raise Exception(f"Erro ao obter token Admin API: {resp.status_code} — {resp.text}")

    data = resp.json()
    token = data["access_token"]
    _admin_token_cache[cache_key] = {"token": token, "expires_at": now + data.get("expires_in", 3600)}
    return token

def generate_admin_consent_url(integration_key: str) -> str:
    """Consentimento (uma vez, no navegador) para os escopos extras da Admin API."""
    return (
        f"{DS_BASE_URL}/oauth/auth"
        f"?response_type=code&scope={ADMIN_SCOPE.replace(' ', '%20')}"
        f"&client_id={integration_key}"
        f"&redirect_uri=https://account.docusign.com"
    )

def sync_real_licenses(integration_key: str, user_id: str, rsa_key_path: str) -> list:
    """
    Busca, via Admin API, o LicenseType real de todos os usuários de todas as contas
    da organização em uma única chamada — substitui o import manual de CSV.
    Retorna uma lista de dicts: {account_id (external, numérico), email, license_type, status}.
    """
    token = get_admin_token(integration_key, user_id, rsa_key_path)
    headers = {"Authorization": f"Bearer {token}"}

    userinfo = requests.get(f"{DS_BASE_URL}/oauth/userinfo", headers=headers, timeout=15)
    if userinfo.status_code != 200:
        raise Exception(f"Erro ao buscar userinfo: {userinfo.status_code} — {userinfo.text[:300]}")
    org_id = None
    for acc in userinfo.json().get("accounts", []):
        org = acc.get("organization")
        if org:
            org_id = org["organization_id"]
            break
    if not org_id:
        raise Exception("Organization ID não encontrado — verifique o consentimento da Admin API.")

    orgs_resp = requests.get("https://api.docusign.net/Management/v2/organizations", headers=headers, timeout=20)
    if orgs_resp.status_code != 200:
        raise Exception(f"Erro ao listar organizações: {orgs_resp.status_code} — {orgs_resp.text[:300]}")
    org_data = next((o for o in orgs_resp.json().get("organizations", []) if o["id"] == org_id), None)
    account_map = {a["id"]: str(a["external_account_id"]) for a in (org_data.get("accounts", []) if org_data else [])}

    create_resp = requests.post(
        f"https://api.docusign.net/Management/v2/organizations/{org_id}/exports/user_list",
        headers={**headers, "Content-Type": "application/json"},
        json={"type": "organization_memberships_export"},
        timeout=20,
    )
    if create_resp.status_code != 200:
        raise Exception(f"Erro ao criar export de usuários: {create_resp.status_code} — {create_resp.text[:300]}")
    metadata_url = create_resp.json()["metadata_url"]

    data = None
    for _ in range(30):  # até ~90s esperando o export ficar pronto
        poll = requests.get(metadata_url, headers=headers, timeout=20)
        poll.raise_for_status()
        data = poll.json()
        status = data.get("status")
        if status == "completed":
            break
        if status == "failed":
            raise Exception("Export de usuários falhou no DocuSign.")
        time.sleep(3)
    else:
        raise Exception("Timeout esperando o export de licenças ficar pronto no DocuSign.")

    download_url = data["results"][0]["url"]
    csv_resp = requests.get(download_url, headers=headers, timeout=30)
    if csv_resp.status_code != 200:
        raise Exception(f"Erro ao baixar export: {csv_resp.status_code}")

    reader = csv.DictReader(io.StringIO(csv_resp.content.decode("utf-8-sig")))
    records = []
    for row in reader:
        email = (row.get("UserEmail") or "").lower().strip()
        if not email:
            continue
        guid = row.get("AccountID")
        records.append({
            "account_id": account_map.get(guid, guid),
            "email": email,
            "license_type": row.get("LicenseType"),
            "status": row.get("UserStatus"),
        })
    return records