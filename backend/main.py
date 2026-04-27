from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import sqlite3, pandas as pd, requests, io, re, os, unicodedata, json
from typing import Optional
from datetime import datetime

load_dotenv()

app = FastAPI(title="AccessGuard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_PATH   = "/data/accessguard.db"
PLATFORMS = ["365", "docusign", "lucid", "bitbucket", "jira", "google"]

EMAIL_COLUMN_HINTS = {
    "365": ["nome do usuario principal","nome do usuário principal","userprincipalname","user principal name","email","e-mail","mail","login"],
    "default": ["email","e-mail","mail","userprincipalname","login","username","usuario","usuário"]
}
NAME_COLUMN_HINTS = ["nome de exibicao","nome de exibição","display name","nome completo","full name","nome do usuario","nome do usuário","name","nome","sobrenome"]

# ─── DB ───────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA cache_size=-32000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn

def init_db():
    os.makedirs("/data", exist_ok=True)
    conn = get_db()
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS terminated_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
        name TEXT, termination_date TEXT, department TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS platform_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, platform TEXT NOT NULL,
        display_name TEXT, extra_data TEXT, imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(email, platform))""")
    c.execute("""CREATE TABLE IF NOT EXISTS azure_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
        name TEXT, department TEXT, imported_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS import_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, platform TEXT,
        records_imported INTEGER, imported_at TEXT DEFAULT CURRENT_TIMESTAMP, notes TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS docusign_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT,
        status TEXT, account_id TEXT NOT NULL, account_name TEXT,
        user_id_ds TEXT, raw_json TEXT, imported_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS docusign_sync_log (
        account_id TEXT PRIMARY KEY, account_name TEXT,
        total INTEGER DEFAULT 0, active INTEGER DEFAULT 0, pending INTEGER DEFAULT 0,
        synced_at TEXT, error TEXT)""")

    # Indexes
    for sql in [
        "CREATE INDEX IF NOT EXISTS idx_terminated_email ON terminated_users(email)",
        "CREATE INDEX IF NOT EXISTS idx_platform_email ON platform_users(email)",
        "CREATE INDEX IF NOT EXISTS idx_platform_platform ON platform_users(platform)",
        "CREATE INDEX IF NOT EXISTS idx_platform_email_platform ON platform_users(email, platform)",
        "CREATE INDEX IF NOT EXISTS idx_azure_email ON azure_users(email)",
        "CREATE INDEX IF NOT EXISTS idx_ds_email ON docusign_users(email)",
        "CREATE INDEX IF NOT EXISTS idx_ds_account ON docusign_users(account_id)",
    ]:
        c.execute(sql)

    # Migrations
    for col_sql in [
        "ALTER TABLE platform_users ADD COLUMN display_name TEXT",
    ]:
        try: c.execute(col_sql)
        except: pass

    conn.commit()
    conn.close()

init_db()

# ─── HELPERS ──────────────────────────────────────────────────────────────────

def normalize_email(email: str) -> str:
    return str(email).strip().lower().replace("\ufeff","") if email else ""

def normalize_str(s: str) -> str:
    s = str(s).strip().lower().replace("\ufeff","")
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")

def find_column(cols, hints):
    cols_norm = [normalize_str(c) for c in cols]
    for hint in hints:
        hn = normalize_str(hint)
        for i, cn in enumerate(cols_norm):
            if hn == cn or hn in cn or cn in hn:
                return cols[i]
    return None

def read_csv_flexible(content: bytes) -> pd.DataFrame:
    for kwargs in [
        {"encoding":"utf-8-sig","sep":","}, {"encoding":"utf-8","sep":","},
        {"encoding":"latin1","sep":","}, {"encoding":"utf-8-sig","sep":";"},
        {"encoding":"utf-8","sep":";"}, {"encoding":"latin1","sep":";"},
    ]:
        try:
            df = pd.read_csv(io.BytesIO(content), **kwargs)
            if len(df.columns) > 1: return df
        except: continue
    raise HTTPException(status_code=400, detail="Não foi possível ler o CSV.")

def extract_sheet_id(url: str) -> Optional[str]:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    return m.group(1) if m else None

# ─── CORE ENDPOINTS ───────────────────────────────────────────────────────────

@app.get("/health")
def health(): return {"status":"ok","timestamp":datetime.now().isoformat()}

@app.get("/stats")
def get_stats():
    conn = get_db(); c = conn.cursor()
    total_terminated = c.execute("SELECT COUNT(*) FROM terminated_users").fetchone()[0]
    total_azure      = c.execute("SELECT COUNT(*) FROM azure_users").fetchone()[0]
    plat_rows = c.execute("SELECT platform, COUNT(*) as cnt FROM platform_users GROUP BY platform").fetchall()
    platform_counts = {p:0 for p in PLATFORMS}
    for r in plat_rows: platform_counts[r["platform"]] = r["cnt"]
    exposure_rows = c.execute("""
        SELECT pu.platform, COUNT(DISTINCT t.email) as cnt
        FROM terminated_users t INNER JOIN platform_users pu ON t.email=pu.email
        GROUP BY pu.platform""").fetchall()
    exposure = {p:0 for p in PLATFORMS}
    for r in exposure_rows: exposure[r["platform"]] = r["cnt"]
    active_accesses = c.execute("""
        SELECT COUNT(DISTINCT t.email) FROM terminated_users t
        INNER JOIN platform_users pu ON t.email=pu.email""").fetchone()[0]
    last_imports = c.execute("SELECT * FROM import_logs ORDER BY imported_at DESC LIMIT 5").fetchall()
    conn.close()
    return {"total_terminated":total_terminated,"total_azure_users":total_azure,
            "platform_users":platform_counts,"terminated_with_active_access":active_accesses,
            "exposure_by_platform":exposure,"last_imports":[dict(r) for r in last_imports]}

@app.get("/users/risk")
def get_risk_users(search: str="", platform: str=""):
    conn = get_db(); c = conn.cursor()
    query = """SELECT t.email,t.name,t.department,t.termination_date,
               GROUP_CONCAT(DISTINCT pu.platform) as active_platforms
               FROM terminated_users t INNER JOIN platform_users pu ON t.email=pu.email WHERE 1=1"""
    params = []
    if search:
        query += " AND (LOWER(t.email) LIKE ? OR LOWER(t.name) LIKE ?)"
        params += [f"%{search.lower()}%",f"%{search.lower()}%"]
    if platform:
        query += " AND pu.platform=?"; params.append(platform)
    query += " GROUP BY t.email ORDER BY t.termination_date DESC"
    rows = c.execute(query,params).fetchall(); conn.close()
    result = []
    for r in rows:
        plats = r["active_platforms"].split(",") if r["active_platforms"] else []
        result.append({"email":r["email"],"name":r["name"] or r["email"],"department":r["department"],
                       "termination_date":r["termination_date"],"active_platforms":plats,
                       "risk_level":"high" if len(plats)>=3 else "medium" if plats else "low"})
    return result

@app.get("/users/terminated")
def get_all_terminated(search: str=""):
    conn = get_db(); c = conn.cursor()
    if search:
        rows = c.execute("SELECT * FROM terminated_users WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ? ORDER BY imported_at DESC",
                         (f"%{search.lower()}%",f"%{search.lower()}%")).fetchall()
    else:
        rows = c.execute("SELECT * FROM terminated_users ORDER BY imported_at DESC").fetchall()
    conn.close(); return [dict(r) for r in rows]

@app.get("/licenses/by-domain")
def licenses_by_domain():
    conn = get_db(); c = conn.cursor()
    rows = c.execute("SELECT email, platform FROM platform_users").fetchall(); conn.close()
    from collections import defaultdict
    by_domain = defaultdict(lambda: defaultdict(int)); platforms_found = set()
    for row in rows:
        email,platform = row["email"],row["platform"]
        if "@" in email:
            domain = "@"+email.split("@")[1].lower()
            by_domain[domain][platform] += 1; platforms_found.add(platform)
    order = ["365","docusign","lucid","bitbucket","jira","google"]
    platforms = [p for p in order if p in platforms_found]+[p for p in platforms_found if p not in order]
    return {"platforms":platforms,"by_domain":{d:dict(v) for d,v in by_domain.items()}}

# ─── IMPORT ENDPOINTS ─────────────────────────────────────────────────────────

@app.post("/import/platform/csv")
async def import_platform_csv(platform: str=Form(...), file: UploadFile=File(...)):
    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Plataforma inválida: {PLATFORMS}")
    content = await file.read(); df = read_csv_flexible(content)
    hints = EMAIL_COLUMN_HINTS.get(platform,[]) + EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns), hints) or df.columns[0]
    name_col  = find_column(list(df.columns), NAME_COLUMN_HINTS)
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM platform_users WHERE platform=?", (platform,))
    count = skipped = 0
    for _, row in df.iterrows():
        email = normalize_email(row.get(email_col,""))
        if not email or "@" not in email: skipped+=1; continue
        display_name = str(row.get(name_col,"")) if name_col else None
        try:
            c.execute("INSERT INTO platform_users (email,platform,display_name) VALUES (?,?,?) ON CONFLICT(email,platform) DO UPDATE SET display_name=excluded.display_name,imported_at=CURRENT_TIMESTAMP",
                      (email,platform,display_name)); count+=1
        except Exception as e: skipped+=1; print(f"INSERT ERROR: {e} | {email}")
    c.execute("INSERT INTO import_logs (source,platform,records_imported,notes) VALUES (?,?,?,?)",
              ("csv_upload",platform,count,f"coluna={email_col},pulados={skipped}"))
    conn.commit(); conn.close()
    return {"imported":count,"skipped":skipped,"email_column_used":email_col,"platform":platform,
            "message":f"{count} usuários importados para {platform} (coluna: '{email_col}')."}

@app.post("/import/azure/csv")
async def import_azure_csv(file: UploadFile=File(...)):
    content = await file.read(); df = read_csv_flexible(content)
    hints = EMAIL_COLUMN_HINTS["365"]+EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns),hints) or df.columns[0]
    name_col  = find_column(list(df.columns),NAME_COLUMN_HINTS)
    dept_col  = find_column(list(df.columns),["departamento","department","depto","setor"])
    conn = get_db(); c = conn.cursor(); count = 0
    for _, row in df.iterrows():
        email = normalize_email(row.get(email_col,""))
        if not email or "@" not in email: continue
        name = str(row.get(name_col,"")).strip() if name_col else None
        dept = str(row.get(dept_col,"")).strip() if dept_col else None
        try:
            c.execute("INSERT INTO azure_users (email,name,department) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,department=excluded.department,imported_at=CURRENT_TIMESTAMP",
                      (email,name,dept)); count+=1
        except: pass
    c.execute("INSERT INTO import_logs (source,records_imported,notes) VALUES (?,?,?)",("azure_csv",count,f"coluna={email_col}"))
    conn.commit(); conn.close()
    return {"imported":count,"email_column_used":email_col,"message":f"{count} usuários Azure importados."}

@app.post("/import/terminated/gsheet")
async def import_terminated_gsheet(url: str=Form(...)):
    sheet_id = extract_sheet_id(url)
    if not sheet_id: raise HTTPException(status_code=400, detail="URL inválida.")
    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid=0"
    resp = requests.get(export_url, timeout=15)
    if resp.status_code != 200: raise HTTPException(status_code=400, detail="Não foi possível acessar a planilha.")
    df = pd.read_csv(io.StringIO(resp.text))
    return await _process_terminated_df(df, f"gsheet:{url[:60]}")

@app.post("/import/terminated/csv")
async def import_terminated_csv(file: UploadFile=File(...)):
    content = await file.read(); df = read_csv_flexible(content)
    return await _process_terminated_df(df, "csv_rh")

async def _process_terminated_df(df, source):
    hints = EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns), hints)
    name_col  = find_column(list(df.columns), NAME_COLUMN_HINTS)
    dept_col  = find_column(list(df.columns), ["departamento","department","depto","setor","área","area"])
    date_col  = find_column(list(df.columns), ["data desligamento","data","desligamento","termination","demissão","saída"])
    conn = get_db(); c = conn.cursor()
    azure_by_name = {r["name"].lower().strip(): r["email"] for r in c.execute("SELECT email,name FROM azure_users").fetchall() if r["name"]}
    count = matched = not_found = 0
    for _, row in df.iterrows():
        email = None
        name  = str(row.get(name_col,"")).strip() if name_col else None
        dept  = str(row.get(dept_col,"")).strip() if dept_col else None
        date  = str(row.get(date_col,"")).strip() if date_col else None
        if email_col:
            raw = str(row.get(email_col,"")).strip()
            if "@" in raw: email = normalize_email(raw)
        if not email and name:
            email = azure_by_name.get(name.lower())
            if email: matched+=1
        if not email: not_found+=1; continue
        try:
            c.execute("INSERT INTO terminated_users (email,name,department,termination_date) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,department=excluded.department,termination_date=excluded.termination_date,imported_at=CURRENT_TIMESTAMP",
                      (email,name,dept,date)); count+=1
        except: pass
    c.execute("INSERT INTO import_logs (source,records_imported,notes) VALUES (?,?,?)",
              (source,count,f"por_nome={matched},nao_encontrados={not_found}"))
    conn.commit(); conn.close()
    msg = f"{count} desligados importados."
    if matched: msg += f" {matched} encontrados por nome via Azure."
    if not_found: msg += f" ⚠ {not_found} sem e-mail."
    return {"imported":count,"matched_by_name":matched,"not_found":not_found,"message":msg}

@app.post("/preview/csv")
async def preview_csv(file: UploadFile=File(...), platform: str=Form(default="365")):
    content = await file.read(); df = read_csv_flexible(content)
    cols = list(df.columns)
    hints = EMAIL_COLUMN_HINTS.get(platform,[]) + EMAIL_COLUMN_HINTS["default"]
    detected = find_column(cols, hints)
    name_det  = find_column(cols, NAME_COLUMN_HINTS)
    sample = [str(v) for v in df[detected].dropna().head(5).tolist()] if detected and len(df)>0 else []
    return {"columns":cols,"email_column_detected":detected,"name_column_detected":name_det,"sample_emails":sample,"total_rows":len(df)}

@app.delete("/data/reset")
def reset_all():
    conn = get_db(); c = conn.cursor()
    for t in ["terminated_users","platform_users","azure_users","import_logs","docusign_users","docusign_sync_log"]:
        c.execute(f"DELETE FROM {t}")
    conn.commit(); conn.close()
    return {"message":"Banco limpo com sucesso."}

# ─── DOCUSIGN ENDPOINTS ───────────────────────────────────────────────────────

from docusign_integration import get_config, sync_account, generate_consent_url, get_jwt_token, get_envelopes_count

@app.get("/docusign/status")
def docusign_status():
    config = get_config(); conn = get_db(); c = conn.cursor()
    result = []
    for account in config["accounts"]:
        if not account["id"]: continue
        log = c.execute("SELECT * FROM docusign_sync_log WHERE account_id=?", (account["id"],)).fetchone()
        counts = {r["status"]:r["cnt"] for r in c.execute(
            "SELECT status, COUNT(*) as cnt FROM docusign_users WHERE account_id=? GROUP BY status",
            (account["id"],)).fetchall()}
        result.append({
            "account_id":   account["id"],
            "account_name": account["name"],
            "configured":   bool(account["id"]),
            "last_sync":    log["synced_at"] if log else None,
            "last_error":   log["error"] if log else None,
            "active":       counts.get("active",0),
            "pending":      counts.get("pending",0),
            "total":        sum(counts.values()),
        })
    conn.close()
    return {"accounts":result, "consent_url":generate_consent_url(config["integration_key"])}

@app.post("/docusign/sync")
def docusign_sync(account_id: Optional[str] = ""):
    config = get_config()
    if not config["integration_key"]:
        raise HTTPException(status_code=400, detail="DocuSign não configurado. Preencha o .env")

    # --- INÍCIO DA LIMPEZA ---
    if not account_id:
        conn = get_db()
        conn.execute("DELETE FROM platform_users WHERE platform='docusign'")
        conn.commit()
        conn.close()
    # --- FIM DA LIMPEZA ---

    accounts_to_sync = [a for a in config["accounts"] if a["id"]] if not account_id \
                       else [a for a in config["accounts"] if a["id"]==account_id]



    results = []; errors = []
    for account in accounts_to_sync:
        try:
            r = sync_account(account, config, DB_PATH); results.append(r)
            conn = get_db()
            conn.execute("INSERT INTO import_logs (source,platform,records_imported,notes) VALUES (?,?,?,?)",
                         ("docusign_api","docusign",r["total"],f"conta:{account['name']}"))
            conn.commit(); conn.close()
        except Exception as e:
            err = str(e); errors.append({"account":account["name"],"error":err})
            conn = get_db()
            conn.execute("INSERT INTO docusign_sync_log (account_id,account_name,total,active,pending,synced_at,error) VALUES (?,?,0,0,0,CURRENT_TIMESTAMP,?) ON CONFLICT(account_id) DO UPDATE SET error=excluded.error,synced_at=CURRENT_TIMESTAMP",
                         (account["id"],account["name"],err))
            conn.commit(); conn.close()
    if not results and errors:
        raise HTTPException(status_code=500, detail=str(errors))
    return {"synced":results,"errors":errors,"message":f"{len(results)} conta(s) sincronizada(s). {len(errors)} erro(s)."}

@app.get("/docusign/users")
def docusign_users(account_id: str="", status: str="", search: str=""):
    conn = get_db(); c = conn.cursor()
    query = "SELECT email,name,status,account_name,imported_at,raw_json FROM docusign_users WHERE 1=1"
    params = []
    if account_id: query+=" AND account_id=?"; params.append(account_id)
    if status:     query+=" AND status=?"; params.append(status)
    if search:
        query+=" AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)"
        params+=[f"%{search.lower()}%",f"%{search.lower()}%"]
    query+=" ORDER BY account_name,status,email"
    rows = c.execute(query,params).fetchall(); conn.close()
    
    result = []
    for r in rows:
        d = dict(r)
        raw_data = json.loads(d.pop("raw_json") or "{}")
        # Puxa APENAS o perfil real
        d["permission_profile"] = raw_data.get("permissionProfileName") or "Sem Perfil"
        result.append(d)
    return result

@app.get("/docusign/envelopes")
def docusign_envelopes(start: str, end: str):
    config = get_config()
    if not config["integration_key"]: raise HTTPException(status_code=400, detail="DocuSign não configurado.")
        
    token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
    results = []; total = 0
    conn = get_db()
    
    for account in config["accounts"]:
        if not account["id"]: continue
        try:
            data = get_envelopes_count(account, token, start, end)
            env_dict = {u["email"]: u["count"] for u in data["users"]}
            
            db_users = conn.execute("SELECT email, name, raw_json FROM docusign_users WHERE account_id=?", (account["id"],)).fetchall()
            
            account_users = []
            for row in db_users:
                raw_data = json.loads(row["raw_json"] or "{}")
                perm = raw_data.get("permissionProfileName") or "Sem Perfil"
                count = env_dict.get(row["email"], 0) 
                
                account_users.append({
                    "email": row["email"], "name": row["name"], 
                    "count": count, "permission_profile": perm
                })
                
            results.append({
                "account_id": account["id"], "account_name": account["name"], 
                "envelopes_sent": data["total"], "users": account_users
            })
            total += data["total"]
        except Exception as e:
            results.append({"account_id": account["id"], "account_name": account["name"], "envelopes_sent": 0, "users": []})
            
    conn.close()
    return {"total_sent": total, "accounts": results}

# ─── DEBUG ENDPOINT (remover após resolver) ───────────────────────────────────
@app.get("/docusign/debug")
def docusign_debug():
    """Mostra as configurações carregadas (sem expor credenciais) e testa token."""
    from docusign_integration import get_config, get_jwt_token
    config = get_config()
    result = {"accounts": [], "integration_key_set": bool(config["integration_key"]), "user_id_set": bool(config["user_id"]), "rsa_key_path": config["rsa_key_path"]}
    
    import os
    result["rsa_key_exists"] = os.path.exists(config["rsa_key_path"])
    
    try:
        token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
        result["token_ok"] = True
    except Exception as e:
        result["token_ok"] = False
        result["token_error"] = str(e)
        return result

    import requests
    for account in config["accounts"]:
        if not account["id"]:
            continue
        acc_info = {"name": account["name"], "id": account["id"], "base_uri": account["base_uri"]}
        try:
            # Testa buscar só 1 usuário para ver o que retorna
            url = f"{account['base_uri']}/restapi/v2.1/accounts/{account['id']}/users?count=2&additional_info=true"
            resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
            data = resp.json()
            acc_info["http_status"] = resp.status_code
            acc_info["total_set_size"] = data.get("totalSetSize", "?")
            acc_info["result_set_size"] = data.get("resultSetSize", "?")
            # Mostra os status dos primeiros usuários sem expor dados pessoais
            users_sample = data.get("users", [])
            acc_info["sample_statuses"] = [u.get("status") for u in users_sample[:5]]
            if resp.status_code != 200:
                acc_info["error"] = data
        except Exception as e:
            acc_info["error"] = str(e)
        result["accounts"].append(acc_info)
    
    return result

@app.get("/docusign/debug_user")
def docusign_debug_user(email: str = ""):
    conn = get_db()
    if email:
        row = conn.execute("SELECT raw_json FROM docusign_users WHERE email LIKE ? LIMIT 1", (f"%{email}%",)).fetchone()
    else:
        row = conn.execute("SELECT raw_json FROM docusign_users LIMIT 1").fetchone()
    conn.close()
    
    return json.loads(row["raw_json"]) if row else {"erro": "Nenhum usuario encontrado"}