"""
DocuSign JWT Grant Integration
1 Integration Key + 1 RSA Key → acessa múltiplos Account IDs
"""
import os, time, json, requests
from datetime import datetime
from typing import Optional

import jwt  # PyJWT

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
    """Busca TODOS os usuários da conta com paginação. Filtra ativos/pendentes localmente."""
    base_uri = (account.get("base_uri") or "").rstrip("/")
    account_id = account["id"]
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

    all_users = []
    start = 0
    page_size = 100

    while True:
        url = (
            f"{base_uri}/restapi/v2.1/accounts/{account_id}/users"
            f"?count={page_size}&start_position={start}&additional_info=true"
        )
        resp = requests.get(url, headers=headers, timeout=30)

        if resp.status_code == 401:
            raise Exception("Token inválido ou sem consentimento para esta conta.")
        if resp.status_code != 200:
            raise Exception(f"Erro DocuSign API ({resp.status_code}): {resp.text[:400]}")

        data = resp.json()
        batch = data.get("users", [])

        # Filtra ativos e pendentes localmente
        for u in batch:
            s = (u.get("userStatus") or u.get("status") or "").lower()
            if s in ("active", "pending", "activationsent", "activationrequired"):
                all_users.append(u)

        total = int(data.get("totalSetSize", 0))
        start += len(batch)
        if start >= total or not batch:
            break

    return all_users


def sync_account(account: dict, config: dict, db_path: str) -> dict:
    import sqlite3
    token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
    raw_users = get_users_for_account(account, token)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("DELETE FROM docusign_users WHERE account_id = ?", (account["id"],))

    active = pending = 0
    for u in raw_users:
        email = (u.get("email") or "").strip().lower()
        if not email:
            continue
        s = (u.get("userStatus") or u.get("status") or "").lower()
        if s == "active":
            active += 1
        else:
            pending += 1
            s = "pending"

        conn.execute("""
            INSERT INTO docusign_users (email, name, status, account_id, account_name, user_id_ds, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (email, u.get("userName") or u.get("name") or "", s,
              account["id"], account["name"], u.get("userId") or "", json.dumps(u)))

        conn.execute("""
            INSERT INTO platform_users (email, platform, display_name)
            VALUES (?, 'docusign', ?)
            ON CONFLICT(email, platform) DO UPDATE SET
                display_name=excluded.display_name, imported_at=CURRENT_TIMESTAMP
        """, (email, u.get("userName") or ""))

    conn.execute("""
        INSERT INTO docusign_sync_log (account_id, account_name, total, active, pending, synced_at, error)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT(account_id) DO UPDATE SET
            total=excluded.total, active=excluded.active, pending=excluded.pending,
            synced_at=CURRENT_TIMESTAMP, error=NULL
    """, (account["id"], account["name"], len(raw_users), active, pending))

    conn.commit()
    conn.close()

    return {"account_id": account["id"], "account_name": account["name"],
            "total": len(raw_users), "active": active, "pending": pending,
            "synced_at": datetime.now().isoformat()}


def generate_consent_url(integration_key: str) -> str:
    return (
        f"{DS_BASE_URL}/oauth/auth"
        f"?response_type=code&scope=signature%20impersonation"
        f"&client_id={integration_key}"
        f"&redirect_uri=https://account.docusign.com"
    )
