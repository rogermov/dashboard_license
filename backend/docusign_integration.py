"""
DocuSign JWT Grant Integration
1 Integration Key + 1 RSA Key → acessa múltiplos Account IDs
"""
import os, time, json, requests
from datetime import datetime
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
    
    url = f"{base_uri}/restapi/v2.1/accounts/{account_id}/envelopes?from_date={sd}T00:00:00Z&to_date={ed}T23:59:59Z&user_filter=all"
    resp = requests.get(url, headers=headers, timeout=20)
    
    error_msg = None
    if resp.status_code != 200:
        url_fallback = f"{base_uri}/restapi/v2.1/accounts/{account_id}/envelopes?from_date={sd}T00:00:00Z&to_date={ed}T23:59:59Z"
        resp = requests.get(url_fallback, headers=headers, timeout=20)
        if resp.status_code != 200:
            error_msg = resp.text
            return {"total": 0, "users": [], "error": error_msg}

    data = resp.json()
    total = int(data.get("totalSetSize", 0))
    envelopes = data.get("envelopes", [])

    user_counts = {}
    for env in envelopes:
        sender = env.get("sender", {})
        email = (sender.get("email") or "Desconhecido").lower().strip()
        name = sender.get("userName") or "Desconhecido"

        if email not in user_counts:
            user_counts[email] = {"name": name, "email": email, "count": 0}
        user_counts[email]["count"] += 1

    users_list = sorted(list(user_counts.values()), key=lambda x: x["count"], reverse=True)
    return {"total": total, "users": users_list, "error": None}