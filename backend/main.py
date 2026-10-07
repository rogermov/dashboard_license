from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import sqlite3, pandas as pd, requests, io, re, os, unicodedata, json
from typing import Optional
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

def to_brt(utc_str):
    if not utc_str: return utc_str
    try:
        dt = datetime.strptime(utc_str[:19], "%Y-%m-%d %H:%M:%S") - timedelta(hours=3)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return utc_str

from docusign_integration import get_config, get_jwt_token, get_users_for_account, get_envelopes_count, generate_admin_consent_url, get_included_seats, sync_real_licenses
from graph_integration import get_config as get_graph_config, get_graph_token, get_users as get_graph_users, get_subscribed_skus, sku_friendly_name
from pydantic import BaseModel
import offboarding

load_dotenv()

app = FastAPI(title="AccessGuard API")

# CORS: o frontend é servido pelo mesmo host/origin via nginx (chama /api), então
# não precisa de CORS no uso normal. Mantemos configurável por env para casos
# cross-origin legítimos (ex.: front em outro domínio), mas SEM "*" por padrão —
# o backend não tem auth própria e tem endpoints DELETE destrutivos.
_cors_origins = [o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=_cors_origins, allow_methods=["*"], allow_headers=["*"])

DB_PATH   = "/data/accessguard.db"
PLATFORMS = ["365", "docusign", "lucid", "bitbucket", "jira", "google"]

EMAIL_COLUMN_HINTS = {
    "365": ["nome do usuario principal","nome do usuário principal","userprincipalname","user principal name","email","e-mail","mail","login"],
    "default": ["email","e-mail","mail","userprincipalname","login","username","usuario","usuário"]
}
NAME_COLUMN_HINTS = ["nome de exibicao","nome de exibição","display name","nome completo","full name","nome do usuario","nome do usuário","name","nome","sobrenome"]

@app.on_event("startup")
def otimizar_banco():
    conn = get_db()
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_plat_email ON platform_users(email COLLATE NOCASE)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_term_email ON terminated_users(email COLLATE NOCASE)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_az_email ON azure_users(email COLLATE NOCASE)")
        conn.commit()
    except Exception as e:
        print("Erro ao criar índices de otimização:", e)
    finally:
        conn.close()

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    # busy_timeout evita "database is locked" imediato quando duas escritas coincidem
    # (ex.: dois syncs, ou sync + import): a conexão espera até 5s pelo lock em vez
    # de falhar na hora. Essencial com múltiplos workers/threads sobre o mesmo SQLite.
    conn.execute("PRAGMA busy_timeout=5000")
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
    c.execute("""CREATE TABLE IF NOT EXISTS ms365_users (
        email TEXT PRIMARY KEY, name TEXT, upn TEXT, account_enabled INTEGER,
        licenses TEXT, imported_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS ms365_licenses (
        sku_id TEXT PRIMARY KEY, sku_part_number TEXT, friendly_name TEXT,
        total INTEGER DEFAULT 0, consumed INTEGER DEFAULT 0, synced_at TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS ms365_sync_log (
        id INTEGER PRIMARY KEY CHECK (id=1), synced_at TEXT, error TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS docusign_license_import (
        account_id TEXT NOT NULL, email TEXT NOT NULL, license_type TEXT, status TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id, email))""")
    # Foto do estado dos usuários por plataforma, para detectar movimentações
    # (novos / alteração de atribuição / removidos) entre uma checagem e a próxima.
    c.execute("""CREATE TABLE IF NOT EXISTS user_snapshot (
        platform TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT, label TEXT,
        PRIMARY KEY(platform, key))""")

    # ─── Offboarding (motor de identidade, ver offboarding.py) ───
    c.execute("""CREATE TABLE IF NOT EXISTS hr_terminations (
        matricula TEXT PRIMARY KEY, name TEXT, company TEXT, cargo TEXT, termination_date TEXT,
        email_rh TEXT, motivo TEXT, rehire_status TEXT, rehire_detail TEXT,
        match_status TEXT, match_detail TEXT, source TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS offboarding_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, matricula TEXT, person_name TEXT, company TEXT,
        termination_date TEXT, platform TEXT, account_email TEXT, account_name TEXT,
        account_status TEXT, confidence TEXT, method TEXT, detail TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS offboarding_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, matricula TEXT, person_name TEXT, platform TEXT,
        account_email TEXT, action TEXT, status TEXT, detail TEXT, extra TEXT, actor TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    c.execute("""CREATE TABLE IF NOT EXISTS offboarding_decisions (
        matricula TEXT NOT NULL, platform TEXT NOT NULL, account_email TEXT NOT NULL,
        decision TEXT NOT NULL, decided_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(matricula, platform, account_email))""")

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

    for col_sql in ["ALTER TABLE platform_users ADD COLUMN display_name TEXT",
                    "ALTER TABLE ms365_users ADD COLUMN employee_id TEXT",   # matrícula SAP
                    "ALTER TABLE ms365_users ADD COLUMN aliases TEXT",
                    "ALTER TABLE ms365_users ADD COLUMN on_prem INTEGER DEFAULT 0",   # sincronizada do AD local
                    "CREATE INDEX IF NOT EXISTS idx_ms365_employee ON ms365_users(employee_id)"]:
        try: c.execute(col_sql)
        except: pass
    conn.commit()
    conn.close()

init_db()

# Palavras que identificam uma licen\u00e7a 365 como GRATUITA ou TESTE (n\u00e3o conta como licen\u00e7a paga)
FREE_LICENSE_KEYWORDS = ['viral', 'exploratory', 'free', 'standard', 'dev', 'stream', 'spza', 'trial', 'adhoc', 'unlicensed']

def has_paid_license(license_names: list) -> bool:
    for l in license_names:
        l_clean = str(l).strip().lower()
        if l_clean and not any(k in l_clean for k in FREE_LICENSE_KEYWORDS):
            return True
    return False

def normalize_email(email: str) -> str:
    return str(email).strip().lower().replace("\ufeff","") if email else ""

def normalize_str(s: str) -> str:
    s = str(s).strip().lower().replace("\ufeff","")
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")

def find_column(cols, hints):
    cols_norm = [normalize_str(c) for c in cols]
    
    # 1. Primeiro tenta achar a coluna com o nome EXATO
    for hint in hints:
        hn = normalize_str(hint)
        for i, cn in enumerate(cols_norm):
            if hn == cn:
                return cols[i]
                
    # 2. Se não achar exato, tenta achar por aproximação (substring)
    for hint in hints:
        hn = normalize_str(hint)
        for i, cn in enumerate(cols_norm):
            if hn in cn or cn in hn:
                return cols[i]
                
    return None

def read_csv_flexible(content: bytes) -> pd.DataFrame:
    for kwargs in [
        {"encoding":"utf-8-sig","sep":","}, {"encoding":"utf-8","sep":","},
        {"encoding":"latin1","sep":","}, {"encoding":"utf-16","sep":","},
        {"encoding":"utf-8-sig","sep":";"}, {"encoding":"utf-8","sep":";"},
        {"encoding":"latin1","sep":";"}, {"encoding":"utf-16","sep":";"},
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
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM hr_terminations "
                             "WHERE COALESCE(match_status,'') != 'fora_da_gestao'").fetchone()[0]
        st = {r[0]: r[1] for r in conn.execute("SELECT match_status, COUNT(*) FROM hr_terminations GROUP BY match_status")}
        exposure = conn.execute("SELECT platform, COUNT(DISTINCT matricula) AS count FROM offboarding_matches "
                                "WHERE confidence='agir' GROUP BY platform").fetchall()
        platform_rows = conn.execute("SELECT platform, COUNT(*) as count FROM platform_users GROUP BY platform").fetchall()
        return {
            "total_terminated": total,
            "terminated_with_active_access": st.get("agir", 0),   # certeza total (agir)
            "to_review": st.get("revisar", 0),
            "rehired": st.get("recontratado", 0),
            "no_account": st.get("sem_conta", 0),
            "exposure_by_platform": {r["platform"]: r["count"] for r in exposure},
            "platform_users": {r["platform"]: r["count"] for r in platform_rows},
        }
    finally:
        conn.close()

@app.get("/users/risk")
def get_risk_users(search: str="", platform: str=""):
    """Desligados com acesso ativo CONFIRMADO (matrícula, e-mail do RH ou revisão aprovada)."""
    conn = get_db()
    try:
        q = "SELECT * FROM offboarding_matches WHERE confidence='agir'"
        params = []
        if search:
            q += " AND (LOWER(person_name) LIKE ? OR LOWER(account_email) LIKE ? OR matricula LIKE ?)"
            params += [f"%{search.lower()}%"] * 3
        rows = conn.execute(q + " ORDER BY termination_date DESC, person_name", params).fetchall()
        guests = {r[0] for r in conn.execute("SELECT LOWER(email) FROM ms365_users WHERE upn LIKE '%#EXT#%'")}
        ad_local = {r[0] for r in conn.execute("SELECT LOWER(email) FROM ms365_users WHERE on_prem=1")}
    finally:
        conn.close()
    people = {}
    for r in rows:
        p = people.setdefault(r["matricula"], {
            "matricula": r["matricula"], "email": r["account_email"], "name": r["person_name"],
            "department": r["company"], "termination_date": r["termination_date"],
            "active_platforms": [], "accounts": []})
        if r["platform"] == "365":
            p["email"] = r["account_email"]
        if r["platform"] not in p["active_platforms"]:
            p["active_platforms"].append(r["platform"])
        p["accounts"].append({"platform": r["platform"], "email": r["account_email"],
                              "name": r["account_name"], "method": r["method"],
                              "guest": r["platform"] == "365" and r["account_email"] in guests,
                              "ad_local": r["platform"] == "365" and r["account_email"] in ad_local})
    result = [p for p in people.values() if not platform or platform in p["active_platforms"]]
    for p in result:
        n = len(p["active_platforms"])
        p["risk_level"] = "high" if n >= 3 else "medium" if n else "low"
    return result

@app.get("/users/terminated")
def get_all_terminated(search: str=""):
    """Todos os desligados importados, com o resultado do cruzamento."""
    conn = get_db()
    try:
        q = ("SELECT matricula, name, company AS department, cargo, termination_date, email_rh AS email, "
             "match_status, match_detail, rehire_status, imported_at FROM hr_terminations")
        params = []
        if search:
            q += " WHERE LOWER(name) LIKE ? OR matricula LIKE ? OR LOWER(email_rh) LIKE ?"
            params = [f"%{search.lower()}%"] * 3
        rows = [dict(r) for r in conn.execute(q + " ORDER BY termination_date DESC, name", params).fetchall()]
        done = {}
        for a in conn.execute("SELECT matricula, platform, account_email, created_at FROM offboarding_actions a "
                              f"WHERE action='desativar' AND status IN ('ok','manual') AND NOT EXISTS ({_UNDONE_SQL}) "
                              "ORDER BY id"):
            done.setdefault(a["matricula"], []).append(f'{a["platform"]}: {a["account_email"]} ({a["created_at"][:10]})')
        for r in rows:
            r["deactivated"] = done.get(r["matricula"], [])
        return rows
    finally:
        conn.close()

@app.delete("/users/terminated/clear")
def clear_terminated_users():
    conn = get_db()
    try:
        # Apaga só a lista de desligados e os cruzamentos. As decisões manuais da revisão
        # ficam guardadas (valem de novo se a pessoa reaparecer numa planilha futura).
        for t in ("terminated_users", "hr_terminations", "offboarding_matches"):
            conn.execute(f"DELETE FROM {t}")
        conn.commit()
        return {"message": "Lista de desligados limpa com sucesso!"}
    finally:
        conn.close()

@app.get("/licenses/by-domain")
def licenses_by_domain():
    conn = get_db()
    try:
        c = conn.cursor()
        rows = c.execute("SELECT email, platform FROM platform_users").fetchall()
    finally:
        conn.close()
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
    if platform not in PLATFORMS: raise HTTPException(status_code=400, detail=f"Plataforma inválida: {PLATFORMS}")
    content = await file.read(); df = read_csv_flexible(content)
    
    hints = EMAIL_COLUMN_HINTS.get(platform,[]) + EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns), hints) or df.columns[0]
    name_col  = find_column(list(df.columns), NAME_COLUMN_HINTS)
    
    # ─── NOVIDADE: IDENTIFICA A COLUNA DE LICENÇAS NO 365 ───
    lic_col = None
    if platform == "365":
        lic_col = find_column(list(df.columns), ["licenca", "licença", "licenses", "licencasnomes", "assigned licenses"])
        
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM platform_users WHERE platform=?", (platform,))
    count = skipped = 0

    for _, row in df.iterrows():
        email = normalize_email(row.get(email_col,""))
        if not email or "@" not in email:
            skipped+=1
            continue

        # REGRA DO 365: Só entra se tiver ao menos UMA licença paga
        if platform == "365" and lic_col:
            raw_lic = str(row.get(lic_col, ""))
            if not raw_lic or raw_lic.strip().lower() == "nan":
                skipped += 1
                continue

            lics = re.split(r'[;,]', raw_lic)
            if not has_paid_license(lics):
                skipped += 1 # O usuário só tem tranqueira gratuita, é ignorado!
                continue

        display_name = str(row.get(name_col,"")) if name_col else None
        try:
            c.execute("INSERT INTO platform_users (email,platform,display_name) VALUES (?,?,?) ON CONFLICT(email,platform) DO UPDATE SET display_name=excluded.display_name,imported_at=CURRENT_TIMESTAMP", (email,platform,display_name))
            count+=1
        except Exception as e: 
            skipped+=1
            print(f"INSERT ERROR: {e} | {email}")
            
    c.execute("INSERT INTO import_logs (source,platform,records_imported,notes) VALUES (?,?,?,?)", ("csv_upload",platform,count,f"col_email={email_col},col_lic={lic_col},pulados={skipped}"))
    conn.commit(); conn.close()
    _safe_rebuild_offboarding()

    msg = f"{count} usuários importados."
    if platform == "365":
        msg = f"{count} usuários com licenças PAGAS importados com sucesso! ({skipped} gratuitos/sem licença ignorados)."
        
    return {"imported":count,"skipped":skipped,"email_column_used":email_col,"platform":platform,"message":msg}

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
            c.execute("INSERT INTO azure_users (email,name,department) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,department=excluded.department,imported_at=CURRENT_TIMESTAMP", (email,name,dept)); count+=1
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
            c.execute("INSERT INTO terminated_users (email,name,department,termination_date) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,department=excluded.department,termination_date=excluded.termination_date,imported_at=CURRENT_TIMESTAMP", (email,name,dept,date)); count+=1
        except: pass
    c.execute("INSERT INTO import_logs (source,records_imported,notes) VALUES (?,?,?)", (source,count,f"por_nome={matched},nao_encontrados={not_found}"))
    conn.commit(); conn.close()
    msg = f"{count} desligados importados."
    if matched: msg += f" {matched} encontrados via Azure."
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
    for t in ["terminated_users","platform_users","azure_users","import_logs","docusign_users","docusign_sync_log","docusign_license_import","ms365_users","ms365_licenses","ms365_sync_log","hr_terminations","offboarding_matches","offboarding_decisions"]:
        c.execute(f"DELETE FROM {t}")
    conn.commit(); conn.close()
    return {"message":"Banco limpo."}

# ─── DOCUSIGN ENDPOINTS ───────────────────────────────────────────────────────

@app.get("/docusign/status")
def docusign_status():
    config = get_config(); conn = get_db(); c = conn.cursor()
    result = []
    for account in config["accounts"]:
        if not account["id"]: continue
        log = c.execute("SELECT * FROM docusign_sync_log WHERE account_id=?", (account["id"],)).fetchone()
        counts = {r["status"]:r["cnt"] for r in c.execute("SELECT status, COUNT(*) as cnt FROM docusign_users WHERE account_id=? GROUP BY status", (account["id"],)).fetchall()}
        result.append({
            "account_id": account["id"], "account_name": account["name"], "configured": bool(account["id"]),
            "last_sync": to_brt(log["synced_at"]) if log else None, "last_error": log["error"] if log else None,
            "active": counts.get("active",0), "pending": counts.get("pending",0), "total": sum(counts.values()),
        })

    # Resumo de licenças (Free/Professional) — usa a licença REAL quando importada via CSV oficial
    # do DocuSign (a API não deixa ler isso); cai para a estimativa por canSendEnvelope quando não há import.
    imported_map = {(r["account_id"], r["email"]): r["license_type"]
                     for r in c.execute("SELECT account_id, email, license_type FROM docusign_license_import").fetchall()}
    imported_accounts = {r["account_id"] for r in c.execute("SELECT DISTINCT account_id FROM docusign_license_import").fetchall()}

    # Conta licenças por PESSOA (e-mail único), não por conta. Um assento DocuSign é
    # por pessoa e compartilhado entre as contas da assinatura — quem está em 2+ contas
    # consome 1 assento, não N. Somar por conta inflava o número (ex.: 276 em vez dos
    # 254 reais que a própria DocuSign mostra). Agregamos por e-mail: a pessoa é
    # Professional se tiver licença Professional em QUALQUER conta.
    per_email = {}  # email -> {"pro": bool, "can_send": bool}
    for row in c.execute("SELECT account_id, email, raw_json FROM docusign_users").fetchall():
        email = (row["email"] or "").lower().strip()
        if not email: continue
        raw = json.loads(row["raw_json"] or "{}")
        can_send = raw.get("userSettings", {}).get("canSendEnvelope") in ("true", True)
        real = imported_map.get((row["account_id"], email))
        real_norm = "Professional" if real and "professional" in real.lower() else ("Free" if real else None)
        is_pro = (real_norm == "Professional") if real_norm else can_send
        e = per_email.setdefault(email, {"pro": False, "can_send": False})
        if is_pro: e["pro"] = True
        if can_send: e["can_send"] = True

    professional = sum(1 for e in per_email.values() if e["pro"])
    free = sum(1 for e in per_email.values() if not e["pro"])
    # GAP: paga Professional mas em nenhuma conta tem perfil que permite enviar.
    gap_count = sum(1 for e in per_email.values() if e["pro"] and not e["can_send"])

    for r in result:
        r["license_imported"] = r["account_id"] in imported_accounts

    included_seats = None
    first_account = next((a for a in config["accounts"] if a["id"]), None)
    if first_account:
        try:
            token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
            included_seats = get_included_seats(first_account, token)
        except Exception as e:
            print(f"Erro ao buscar seats do plano: {e}")

    conn.close()
    return {
        "accounts": result, "consent_url": generate_admin_consent_url(config["integration_key"]),
        "license_summary": {"professional": professional, "free": free, "included_seats": included_seats, "gap_count": gap_count},
    }

@app.post("/docusign/sync")
def docusign_sync(account_id: str = ""):
    config = get_config()
    token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
    conn = get_db()
    total_proc = 0

    try:
        # Apenas remove do dashboard geral os que vamos reimportar
        if not account_id: conn.execute("DELETE FROM platform_users WHERE platform='docusign'")

        for acc in config["accounts"]:
            if account_id and acc["id"] != account_id: continue

            try:
                users = get_users_for_account(acc, token)

                conn.execute("DELETE FROM docusign_users WHERE account_id=?", (acc["id"],))
                if account_id:
                    conn.execute("DELETE FROM platform_users WHERE platform='docusign' AND email IN (SELECT email FROM docusign_users WHERE account_id=?)", (account_id,))

                for u in users:
                    email = str(u.get("email", "")).lower().strip()
                    name = str(u.get("userName", "")).strip()
                    s_raw = str(u.get("userStatus", "Active")).lower().strip()

                    # ─── A CORREÇÃO CIRÚRGICA AQUI ───
                    if s_raw in ["active", "ativo"]:
                        status = "active"
                    elif s_raw == "closed":
                        status = "closed"  # Agora os fechados ficam como fechados e somem dos pendentes!
                    else:
                        status = "pending"

                    conn.execute("INSERT INTO docusign_users (account_id, account_name, email, name, status, raw_json) VALUES (?, ?, ?, ?, ?, ?)", (acc["id"], acc["name"], email, name, status, json.dumps(u)))

                    # Filtro para não estourar licenças falsas
                    if status == "active" and email:
                        conn.execute("""INSERT INTO platform_users (email, platform, display_name) VALUES (?, ?, ?) ON CONFLICT(email, platform) DO UPDATE SET display_name=excluded.display_name, imported_at=CURRENT_TIMESTAMP""", (email, "docusign", name))

                    total_proc += 1

                conn.execute("INSERT INTO docusign_sync_log (account_id, account_name, synced_at, error) VALUES (?, ?, CURRENT_TIMESTAMP, NULL) ON CONFLICT(account_id) DO UPDATE SET synced_at=CURRENT_TIMESTAMP, error=NULL", (acc["id"], acc["name"]))

            except Exception as e:
                print(f"Erro na conta {acc['name']}: {e}")
                conn.execute("INSERT INTO docusign_sync_log (account_id, account_name, error) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET error=?", (acc["id"], acc["name"], str(e), str(e)))

        conn.commit()

        # Licença real (Free/Professional) via Admin API — cobre a organização inteira
        # (todas as contas) em uma chamada só, então roda sempre, mesmo se account_id
        # filtrar uma conta específica. Falha aqui não deve derrubar o resto da sincronização
        # (ex.: consentimento da Admin API ainda não concedido).
        license_msg = ""
        try:
            records = sync_real_licenses(config["integration_key"], config["user_id"], config["rsa_key_path"])
            conn.execute("DELETE FROM docusign_license_import")
            for r in records:
                conn.execute("""INSERT INTO docusign_license_import (account_id, email, license_type, status, imported_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(account_id, email) DO UPDATE SET license_type=excluded.license_type, status=excluded.status, imported_at=CURRENT_TIMESTAMP""",
                    (r["account_id"], r["email"], r["license_type"], r["status"]))
            conn.commit()
            license_msg = f" {len(records)} licenças reais atualizadas."
        except Exception as e:
            print(f"Erro ao sincronizar licenças reais (Admin API): {e}")
            license_msg = " (licenças reais não atualizadas — verifique o consentimento da Admin API)"

        _safe_rebuild_offboarding()
        return {"message": f"Sincronização Finalizada! {total_proc} usuários atualizados.{license_msg}"}
    finally:
        conn.close()

@app.get("/docusign/users")
def docusign_users(account_id: str="", status: str="", search: str="", profile: str="", license: str="", gap_only: bool=False):
    conn = get_db()
    try:
        query = "SELECT account_id, email, name, status, account_name, imported_at, raw_json FROM docusign_users WHERE 1=1"
        params = []
        if account_id: query+=" AND account_id=?"; params.append(account_id)
        if status:     query+=" AND status=?"; params.append(status)
        if search:
            query+=" AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)"
            params.extend([f"%{search.lower()}%", f"%{search.lower()}%"])

        rows = conn.execute(query, params).fetchall()

        # Licença real, quando importada via CSV oficial do DocuSign (a API não deixa ler isso)
        imported = {(r["account_id"], r["email"]): r["license_type"]
                    for r in conn.execute("SELECT account_id, email, license_type FROM docusign_license_import").fetchall()}

        result = []
        for r in rows:
            d = dict(r)
            acc_id = d.pop("account_id")
            raw = json.loads(d.pop("raw_json") or "{}")
            p = raw.get("permissionProfileName", "Sem Perfil")
            if profile and profile != p: continue

            # A API do DocuSign não expõe "licenseType" na leitura (só aceita gravar via PUT).
            # A tela deles deriva a licença de userSettings.canSendEnvelope: quem pode enviar
            # é "Full - Professional", quem só visualiza é "Free" — reproduzimos essa mesma regra
            # como ESTIMATIVA. Quando o CSV oficial foi importado, usamos o valor REAL no lugar.
            can_send = raw.get("userSettings", {}).get("canSendEnvelope") in ("true", True)
            estimated = "Professional" if can_send else "Free"
            real = imported.get((acc_id, d["email"].lower().strip()))
            real_norm = "Professional" if real and "professional" in real.lower() else ("Free" if real else None)
            license_type = real_norm or estimated
            if license and license != license_type: continue

            # GAP: paga Professional mas o perfil não permite enviar — TI atribuiu a licença errada
            is_gap = bool(real_norm == "Professional" and not can_send)
            if gap_only and not is_gap: continue

            d["permission_profile"] = p
            d["license_type"] = license_type
            d["license_source"] = "real" if real_norm else "estimado"
            d["license_gap"] = is_gap
            d["imported_at"] = to_brt(d["imported_at"])
            result.append(d)
        return result
    finally:
        conn.close()

@app.post("/docusign/sync-licenses")
def docusign_sync_licenses():
    """Atualiza só as licenças reais (Free/Professional) via Admin API, sem rodar o sync completo de usuários/envelopes."""
    config = get_config()
    records = sync_real_licenses(config["integration_key"], config["user_id"], config["rsa_key_path"])
    conn = get_db()
    try:
        conn.execute("DELETE FROM docusign_license_import")
        for r in records:
            conn.execute("""INSERT INTO docusign_license_import (account_id, email, license_type, status, imported_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(account_id, email) DO UPDATE SET license_type=excluded.license_type, status=excluded.status, imported_at=CURRENT_TIMESTAMP""",
                (r["account_id"], r["email"], r["license_type"], r["status"]))
        conn.commit()
        return {"imported": len(records), "message": f"{len(records)} licenças reais atualizadas (todas as contas)."}
    finally:
        conn.close()

@app.get("/docusign/envelopes")
def docusign_envelopes(start: str, end: str):
    config = get_config()
    token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
    accounts = [acc for acc in config["accounts"] if acc["id"]]
    results = []; grand_total = 0
    conn = get_db()

    try:
        # get_envelopes_count busca uma janela estendida (30 dias extras) e pagina os resultados,
        # então cada conta pode levar vários segundos. Buscar as contas em paralelo em vez de uma
        # a uma corta o tempo total de ~N contas sequenciais para ~1 conta (a mais lenta).
        with ThreadPoolExecutor(max_workers=max(1, len(accounts))) as pool:
            api_data_by_account = dict(zip(
                [acc["id"] for acc in accounts],
                pool.map(lambda acc: get_envelopes_count(acc, token, start, end), accounts),
            ))

        for acc in accounts:
            db_users = conn.execute("SELECT email, name, raw_json FROM docusign_users WHERE account_id=?", (acc["id"],)).fetchall()

            env_map = {}
            acc_total = 0

            try:
                api_data = api_data_by_account.get(acc["id"]) or {}
                acc_total = api_data.get("total", 0)

                if api_data.get("error"):
                    print(f"Erro API Envelopes ({acc['name']}): {api_data['error']}")

                for item in api_data.get("users", []):
                    clean_email = str(item.get("email", "")).lower().strip()
                    env_map[clean_email] = item.get("count", 0)
            except Exception as e:
                print(f"Erro API Envelopes ({acc['name']}): {e}")

            user_list = []
            for row in db_users:
                email_db = str(row["email"]).lower().strip()
                raw = json.loads(row["raw_json"] or "{}")
                env_count = env_map.get(email_db, 0)
                
                user_list.append({
                    "email": row["email"], 
                    "name": row["name"], 
                    "count": env_count, 
                    "permission_profile": raw.get("permissionProfileName", "Sem Perfil")
                })

            results.append({"account_id": acc["id"], "account_name": acc["name"], "envelopes_sent": acc_total, "users": user_list})
            grand_total += acc_total

        return {"total_sent": grand_total, "accounts": results}
    finally:
        conn.close()

# ─── GOOGLE WORKSPACE ENDPOINTS ───

@app.post("/google/sync")
def google_sync():
    url = os.getenv("GOOGLE_APPS_SCRIPT_URL")
    if not url: raise HTTPException(status_code=400, detail="URL do Apps Script não configurada")

    conn = get_db()
    try:
        # Timeout folgado: o Apps Script busca milhares de usuários do Workspace
        # (6k+), e com 45s estourava de vez em quando. 120s dá margem.
        resp = requests.get(url, timeout=120)
        data = resp.json()
        if not data.get("success"): raise Exception(data.get("error", "Erro na API Google"))

        users = data.get("users", [])
        conn.execute('''CREATE TABLE IF NOT EXISTS google_users (email TEXT PRIMARY KEY, name TEXT, status TEXT, org_unit TEXT, last_login TEXT, imported_at DATETIME DEFAULT (datetime('now', 'localtime')))''')
        try:   # tabelas antigas não têm a coluna
            conn.execute("ALTER TABLE google_users ADD COLUMN employee_id TEXT")
        except sqlite3.OperationalError:
            pass
        conn.execute("DELETE FROM google_users")
        conn.execute("DELETE FROM platform_users WHERE platform='google'")

        count = 0
        for u in users:
            email = (u.get("email") or "").lower().strip()
            if not email: continue  # evita IntegrityError (email é PK) e lixo
            name, status = u.get("name"), str(u.get("status")).lower()
            # ON CONFLICT: se o Apps Script devolver o mesmo e-mail 2x, atualiza em vez de quebrar.
            conn.execute("""INSERT INTO google_users (email, name, status, org_unit, last_login, employee_id) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET name=excluded.name, status=excluded.status, org_unit=excluded.org_unit,
                last_login=excluded.last_login, employee_id=excluded.employee_id""",
                (email, name, status, u.get("org_unit"), u.get("last_login", ""), (u.get("employee_id") or "").strip()))
            if status == "active":
                conn.execute("INSERT INTO platform_users (email, platform, display_name) VALUES (?, ?, ?) ON CONFLICT(email, platform) DO UPDATE SET display_name=excluded.display_name, imported_at=CURRENT_TIMESTAMP", (email, "google", name)); count += 1

        conn.commit()
        _safe_rebuild_offboarding()
        return {"message": f"Google Atualizado! {count} injetados."}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Erro no google_sync: {e}")
        raise HTTPException(status_code=500, detail="Falha ao sincronizar o Google Workspace. Verifique os logs do servidor.")
    finally:
        conn.close()

@app.get("/google/users")
def google_users(status: str = "", search: str = ""):
    conn = get_db()
    try: conn.execute("SELECT 1 FROM google_users LIMIT 1")
    except: return []
        
    query = "SELECT * FROM google_users WHERE 1=1"
    params = []
    if status: query += " AND status = ?"; params.append(status)
    if search: query += " AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)"; params.extend([f"%{search.lower()}%", f"%{search.lower()}%"])
    query += " ORDER BY name ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ─── MICROSOFT 365 / ENTRA ID ENDPOINTS ───────────────────────────────────────

@app.get("/microsoft365/status")
def microsoft365_status():
    conn = get_db()
    try:
        c = conn.cursor()
        log = c.execute("SELECT * FROM ms365_sync_log WHERE id=1").fetchone()
        active = c.execute("SELECT COUNT(*) FROM ms365_users WHERE account_enabled=1").fetchone()[0]
        disabled = c.execute("SELECT COUNT(*) FROM ms365_users WHERE account_enabled=0").fetchone()[0]
    finally:
        conn.close()
    return {
        "last_sync": to_brt(log["synced_at"]) if log else None,
        "last_error": log["error"] if log else None,
        "active": active, "disabled": disabled, "total": active + disabled,
        "configured": bool(get_graph_config()["tenant_id"]),
    }

@app.get("/microsoft365/licenses")
def microsoft365_licenses():
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM ms365_licenses ORDER BY total DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@app.get("/microsoft365/users")
def microsoft365_users(status: str = "", search: str = "", license: str = ""):
    conn = get_db()
    try:
        query = "SELECT * FROM ms365_users WHERE 1=1"
        params = []
        if status: query += " AND account_enabled=?"; params.append(1 if status == "active" else 0)
        if search: query += " AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)"; params.extend([f"%{search.lower()}%", f"%{search.lower()}%"])
        if license: query += " AND licenses LIKE ?"; params.append(f"%{license}%")
        query += " ORDER BY name ASC"
        # Tenant tem ~47k contas (a maioria sem licença); sem busca/filtro, limita para não travar a tabela no navegador
        if not search and not status and not license: query += " LIMIT 500"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@app.post("/microsoft365/sync")
def microsoft365_sync():
    config = get_graph_config()
    if not config["tenant_id"] or not config["client_id"] or not config["client_secret"]:
        raise HTTPException(status_code=400, detail="Credenciais do Microsoft Graph não configuradas no .env")

    conn = get_db()
    try:
        token = get_graph_token(config["tenant_id"], config["client_id"], config["client_secret"])
        skus = get_subscribed_skus(token)
        sku_part_by_id = {s["skuId"]: s["skuPartNumber"] for s in skus}

        users = get_graph_users(token)

        conn.execute("DELETE FROM ms365_users")
        conn.execute("DELETE FROM platform_users WHERE platform='365'")

        count = 0
        for u in users:
            email = normalize_email(u.get("mail") or u.get("userPrincipalName") or "")
            if not email: continue
            name = u.get("displayName") or ""
            enabled = 1 if u.get("accountEnabled") else 0
            part_numbers = [sku_part_by_id.get(a["skuId"], a["skuId"]) for a in (u.get("assignedLicenses") or [])]
            friendly = [sku_friendly_name(p) for p in part_numbers]

            emp_id = (u.get("employeeId") or "").strip()
            aliases = sorted({p.split(":", 1)[1].lower() for p in (u.get("proxyAddresses") or []) if p.lower().startswith("smtp:")}
                             | {m.lower() for m in (u.get("otherMails") or []) if m})
            conn.execute("""INSERT INTO ms365_users (email, name, upn, account_enabled, licenses, employee_id, aliases, on_prem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET name=excluded.name, upn=excluded.upn, account_enabled=excluded.account_enabled,
                licenses=excluded.licenses, employee_id=excluded.employee_id, aliases=excluded.aliases,
                on_prem=excluded.on_prem, imported_at=CURRENT_TIMESTAMP""",
                (email, name, u.get("userPrincipalName"), enabled, ";".join(friendly), emp_id, ";".join(aliases),
                 1 if u.get("onPremisesSyncEnabled") else 0))

            if enabled and has_paid_license(part_numbers):
                conn.execute("""INSERT INTO platform_users (email, platform, display_name) VALUES (?, '365', ?)
                    ON CONFLICT(email, platform) DO UPDATE SET display_name=excluded.display_name, imported_at=CURRENT_TIMESTAMP""",
                    (email, name))
                count += 1

        conn.execute("DELETE FROM ms365_licenses")
        for s in skus:
            part_number = s["skuPartNumber"]
            conn.execute("""INSERT INTO ms365_licenses (sku_id, sku_part_number, friendly_name, total, consumed, synced_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                (s["skuId"], part_number, sku_friendly_name(part_number),
                 s.get("prepaidUnits", {}).get("enabled", 0), s.get("consumedUnits", 0)))

        conn.execute("""INSERT INTO ms365_sync_log (id, synced_at, error) VALUES (1, CURRENT_TIMESTAMP, NULL)
            ON CONFLICT(id) DO UPDATE SET synced_at=CURRENT_TIMESTAMP, error=NULL""")
        revertidas = _reconcile_m365_actions(conn)
        conn.commit()
        _safe_rebuild_offboarding()
        aviso = f" ⚠ {revertidas} conta(s) desativada(s) pelo painel voltaram a ficar ativas (ver Histórico)." if revertidas else ""
        return {"message": f"Microsoft 365 sincronizado! {len(users)} usuários processados, {count} com licença paga.{aviso}"}
    except Exception as e:
        print(f"Erro no microsoft365_sync: {e}")
        conn.execute("""INSERT INTO ms365_sync_log (id, error) VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET error=?""", (str(e), str(e)))
        conn.commit()
        raise HTTPException(status_code=500, detail="Falha ao sincronizar o Microsoft 365. Verifique os logs do servidor.")
    finally:
        conn.close()

# ─── ALERTAS DE LICENÇA (Google Chat) ──────────────────────────────────────────

def _license_alerts(conn):
    """Linhas de alerta para licenças perto/acima do limite (threshold em %)."""
    threshold = float(os.getenv("ALERT_THRESHOLD_PCT", "90")) / 100.0
    alerts = []
    # DocuSign: assentos Professional (e-mails distintos) vs included_seats do plano.
    prof = conn.execute("SELECT COUNT(DISTINCT email) FROM docusign_license_import WHERE license_type LIKE '%Professional%'").fetchone()[0]
    seats = None
    try:
        config = get_config()
        first = next((a for a in config["accounts"] if a["id"]), None)
        if first:
            token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
            seats = get_included_seats(first, token)
    except Exception as e:
        print(f"Erro ao buscar seats p/ alerta: {e}")
    if seats and prof >= seats * threshold:
        extra = f" — ACIMA DO LIMITE em {prof - seats}" if prof > seats else ""
        alerts.append(f"*DocuSign Professional:* {prof}/{seats} assentos{extra}")
    # Microsoft 365: desligado por padrão (o pedido foi receber só limites do DocuSign).
    # Ative com ALERT_INCLUDE_M365=true. SKUs com tamanho relevante (>=5 assentos).
    if os.getenv("ALERT_INCLUDE_M365", "false").lower() == "true":
        for r in conn.execute("SELECT friendly_name, total, consumed FROM ms365_licenses WHERE total>=5 AND total<1000000").fetchall():
            if r["consumed"] >= r["total"] * threshold:
                extra = f" — ACIMA em {r['consumed'] - r['total']}" if r["consumed"] > r["total"] else ""
                alerts.append(f"*M365 — {r['friendly_name']}:* {r['consumed']}/{r['total']}{extra}")
    return alerts

@app.get("/alerts/license-status")
def alerts_license_status():
    """Só lista o que está perto/acima do limite, SEM notificar (para testar)."""
    conn = get_db()
    try:
        return {"alerts": _license_alerts(conn), "threshold_pct": float(os.getenv("ALERT_THRESHOLD_PCT", "90"))}
    finally:
        conn.close()

@app.post("/alerts/license-check")
def alerts_license_check():
    """Checa as licenças e, se houver algo perto/acima do limite, notifica no Google
    Chat (webhook em GOOGLE_CHAT_WEBHOOK_URL). Pensado para rodar junto do sync diário."""
    webhook = os.getenv("GOOGLE_CHAT_WEBHOOK_URL")
    conn = get_db()
    try:
        alerts = _license_alerts(conn)
    finally:
        conn.close()
    if not alerts:
        return {"notified": False, "reason": "nada perto do limite", "alerts": []}
    if not webhook:
        return {"notified": False, "reason": "GOOGLE_CHAT_WEBHOOK_URL não configurado", "alerts": alerts}
    text = "⚠️ *AccessGuard — Alerta de Licenças*\n\n" + "\n".join(alerts)
    try:
        resp = requests.post(webhook, json={"text": text}, timeout=15)
        ok = resp.status_code == 200
        if not ok:
            print(f"Google Chat webhook retornou {resp.status_code}: {resp.text[:200]}")
        return {"notified": ok, "alerts": alerts, "webhook_status": resp.status_code}
    except Exception as e:
        print(f"Erro ao notificar Google Chat: {e}")
        raise HTTPException(status_code=502, detail="Falha ao enviar notificação ao Google Chat. Veja os logs.")

# ─── MOVIMENTAÇÕES DE USUÁRIOS (Google Chat) ──────────────────────────────────

def _docusign_change_items(conn):
    """Estado atual dos usuários DocuSign (por conta+e-mail) para detectar mudanças.
    A 'impressão digital' inclui status + perfil + licença (estimada por canSendEnvelope,
    que vem na API leve de usuários) — assim um downgrade Professional→Free é detectado."""
    items = []
    for r in conn.execute("SELECT account_id, account_name, email, name, status, raw_json FROM docusign_users").fetchall():
        email = (r["email"] or "").lower().strip()
        if not email:
            continue
        raw = json.loads(r["raw_json"] or "{}")
        prof = raw.get("permissionProfileName", "Sem Perfil")
        can_send = raw.get("userSettings", {}).get("canSendEnvelope") in ("true", True)
        lic = "Professional" if can_send else "Free"
        name = r["name"] or email
        items.append({
            "key": f'{r["account_id"]}:{email}',
            "fp": f'{r["status"]}|{prof}|{lic}',   # status | perfil de permissão | licença
            "label": f'{name} · {r["account_name"]}',
        })
    return items

def _describe_change(old_fp, new_fp):
    """Descreve, de forma legível, o que mudou entre duas impressões digitais."""
    campos = ["status", "perfil", "licença"]
    o, n = old_fp.split("|"), new_fp.split("|")
    difs = []
    for i, c in enumerate(campos):
        ov = o[i] if i < len(o) else ""
        nv = n[i] if i < len(n) else ""
        if ov != nv:
            difs.append(f"{c}: {ov} → {nv}")
    return "; ".join(difs) if difs else "alterado"

def _diff_and_update_snapshot(conn, platform, items):
    """Compara o estado atual com o último snapshot, atualiza-o e retorna
    (first_run, novos, alterados, removidos). first_run=True quando não havia snapshot
    (baseline — não notificar, senão listaria todo mundo como 'novo')."""
    prev = {r["key"]: (r["fingerprint"], r["label"])
            for r in conn.execute("SELECT key, fingerprint, label FROM user_snapshot WHERE platform=?", (platform,)).fetchall()}
    first_run = len(prev) == 0
    cur = {it["key"]: it for it in items}
    novos = [cur[k]["label"] for k in cur if k not in prev]
    removidos = [prev[k][1] for k in prev if k not in cur]
    alterados = [(cur[k]["label"], prev[k][0], cur[k]["fp"]) for k in cur if k in prev and prev[k][0] != cur[k]["fp"]]
    conn.execute("DELETE FROM user_snapshot WHERE platform=?", (platform,))
    # usa cur.values() (dict por key) para não duplicar quando o export do DocuSign
    # traz a mesma conta+email mais de uma vez.
    conn.executemany("INSERT OR REPLACE INTO user_snapshot (platform, key, fingerprint, label) VALUES (?,?,?,?)",
                     [(platform, it["key"], it["fp"], it["label"]) for it in cur.values()])
    conn.commit()
    return first_run, novos, alterados, removidos

def _format_changes(novos, alterados, removidos, titulo, limite=20):
    def bloco(lst, head, fmt):
        if not lst:
            return []
        out = [head.format(n=len(lst))] + ["• " + fmt(x) for x in lst[:limite]]
        if len(lst) > limite:
            out.append(f"… e mais {len(lst) - limite}")
        return out
    linhas = [titulo, ""]
    linhas += bloco(novos, "🆕 *Novos ({n}):*", lambda x: x)
    linhas += bloco(alterados, "✏️ *Alteração de atribuição ({n}):*", lambda x: f"{x[0]} — {_describe_change(x[1], x[2])}")
    linhas += bloco(removidos, "🗑️ *Removidos ({n}):*", lambda x: x)
    return "\n".join(linhas)

@app.get("/alerts/changes-status")
def alerts_changes_status():
    """Mostra as movimentações detectadas SEM notificar e SEM atualizar o baseline."""
    conn = get_db()
    try:
        items = _docusign_change_items(conn)
        prev = {r["key"]: r["fingerprint"] for r in conn.execute("SELECT key, fingerprint FROM user_snapshot WHERE platform='docusign'").fetchall()}
        cur = {it["key"]: it for it in items}
        novos = [cur[k]["label"] for k in cur if k not in prev]
        removidos = [v for k, v in [(k, None) for k in prev if k not in cur]]
        alterados = [cur[k]["label"] for k in cur if k in prev and prev[k] != cur[k]["fp"]]
        return {"baseline_existe": len(prev) > 0, "novos": len(novos), "alterados": len(alterados), "removidos": len([k for k in prev if k not in cur])}
    finally:
        conn.close()

@app.post("/alerts/docusign-live-check")
def alerts_docusign_live_check():
    """Opção 2 (near real-time): atualiza SÓ os usuários do DocuSign via API leve por
    conta (get_users_for_account, sem o export pesado de licenças) e checa movimentações,
    notificando no Chat. Feito para rodar com frequência (ex.: a cada 15 min) sem
    sobrecarregar a API. A contagem de licenças continua vindo do sync completo diário."""
    config = get_config()
    token = get_jwt_token(config["integration_key"], config["user_id"], config["rsa_key_path"])
    conn = get_db()
    try:
        for acc in config["accounts"]:
            if not acc["id"]:
                continue
            try:
                users = get_users_for_account(acc, token)
                conn.execute("DELETE FROM docusign_users WHERE account_id=?", (acc["id"],))
                for u in users:
                    email = str(u.get("email", "")).lower().strip()
                    name = str(u.get("userName", "")).strip()
                    s_raw = str(u.get("userStatus", "Active")).lower().strip()
                    status = "active" if s_raw in ("active", "ativo") else ("closed" if s_raw == "closed" else "pending")
                    conn.execute("INSERT INTO docusign_users (account_id, account_name, email, name, status, raw_json) VALUES (?, ?, ?, ?, ?, ?)",
                                 (acc["id"], acc["name"], email, name, status, json.dumps(u)))
                conn.execute("INSERT INTO docusign_sync_log (account_id, account_name, synced_at, error) VALUES (?, ?, CURRENT_TIMESTAMP, NULL) ON CONFLICT(account_id) DO UPDATE SET synced_at=CURRENT_TIMESTAMP, error=NULL",
                             (acc["id"], acc["name"]))
            except Exception as e:
                print(f"[live-check] erro na conta {acc['name']}: {e}")
                conn.execute("INSERT INTO docusign_sync_log (account_id, account_name, error) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET error=?", (acc["id"], acc["name"], str(e), str(e)))
        conn.commit()
        items = _docusign_change_items(conn)
        first_run, novos, alterados, removidos = _diff_and_update_snapshot(conn, "docusign", items)
    finally:
        conn.close()
    _safe_rebuild_offboarding()
    resumo = {"novos": len(novos), "alterados": len(alterados), "removidos": len(removidos)}
    if first_run:
        return {"notified": False, "reason": "baseline criado (primeira execução)", **resumo}
    if not (novos or alterados or removidos):
        return {"notified": False, "reason": "sem movimentações", **resumo}
    webhook = os.getenv("GOOGLE_CHAT_WEBHOOK_URL")
    text = _format_changes(novos, alterados, removidos, "👤 *AccessGuard — Movimentações DocuSign*")
    if not webhook:
        return {"notified": False, "reason": "GOOGLE_CHAT_WEBHOOK_URL não configurado", **resumo}
    try:
        resp = requests.post(webhook, json={"text": text}, timeout=15)
        return {"notified": resp.status_code == 200, "webhook_status": resp.status_code, **resumo}
    except Exception as e:
        print(f"Erro ao notificar movimentações no Chat: {e}")
        raise HTTPException(status_code=502, detail="Falha ao enviar notificação ao Google Chat.")

@app.post("/alerts/changes-check")
def alerts_changes_check():
    """Detecta movimentações de usuários do DocuSign (novos / mudança de atribuição /
    removidos) desde a última checagem e notifica no Google Chat. Roda no sync diário."""
    webhook = os.getenv("GOOGLE_CHAT_WEBHOOK_URL")
    conn = get_db()
    try:
        items = _docusign_change_items(conn)
        first_run, novos, alterados, removidos = _diff_and_update_snapshot(conn, "docusign", items)
    finally:
        conn.close()
    resumo = {"novos": len(novos), "alterados": len(alterados), "removidos": len(removidos)}
    if first_run:
        return {"notified": False, "reason": "baseline criado (primeira execução)", **resumo}
    if not (novos or alterados or removidos):
        return {"notified": False, "reason": "sem movimentações", **resumo}
    text = _format_changes(novos, alterados, removidos, "👤 *AccessGuard — Movimentações DocuSign*")
    if not webhook:
        return {"notified": False, "reason": "GOOGLE_CHAT_WEBHOOK_URL não configurado", **resumo}
    try:
        resp = requests.post(webhook, json={"text": text}, timeout=15)
        return {"notified": resp.status_code == 200, "webhook_status": resp.status_code, **resumo}
    except Exception as e:
        print(f"Erro ao notificar movimentações no Chat: {e}")
        raise HTTPException(status_code=502, detail="Falha ao enviar notificação ao Google Chat.")

# ─── OFFBOARDING (motor de identidade) ─────────────────────────────────────────

def _offboarding_summary(conn):
    st = {r[0]: r[1] for r in conn.execute("SELECT match_status, COUNT(*) FROM hr_terminations GROUP BY match_status")}
    return {"pessoas": sum(st.values()), "agir": st.get("agir", 0), "revisar": st.get("revisar", 0),
            "recontratados": st.get("recontratado", 0), "sem_conta": st.get("sem_conta", 0),
            "fora_da_gestao": st.get("fora_da_gestao", 0)}

def rebuild_offboarding():
    """Recalcula offboarding_matches a partir dos desligados importados e do estado atual
    de cada sistema. Idempotente; aplica as decisões manuais salvas."""
    conn = get_db()
    try:
        terms = [dict(r) for r in conn.execute("SELECT * FROM hr_terminations").fetchall()]
        m365 = [{"email": r["email"], "upn": r["upn"], "name": r["name"], "enabled": bool(r["account_enabled"]),
                 "employee_id": r["employee_id"] or "", "aliases": [a for a in (r["aliases"] or "").split(";") if a]}
                for r in conn.execute("SELECT email, upn, name, account_enabled, employee_id, aliases FROM ms365_users")]
        try:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(google_users)")}
            emp = "employee_id" if "employee_id" in cols else "'' AS employee_id"
            google = [{"email": r["email"], "name": r["name"], "active": (r["status"] or "") == "active", "status": "ativa",
                       "employee_id": r["employee_id"] or ""}
                      for r in conn.execute(f"SELECT email, name, status, {emp} FROM google_users")]
        except sqlite3.OperationalError:     # a tabela só existe depois do 1º sync do Google
            google = []
        docusign = [{"email": r["email"], "name": r["name"], "active": r["status"] in ("active", "pending"),
                     "status": "ativa" if r["status"] == "active" else "pendente",
                     "label": f'{r["name"] or r["email"]} · {r["account_name"]}'}
                    for r in conn.execute("SELECT email, name, status, account_name FROM docusign_users")]
        others = [{"email": r["email"], "name": r["display_name"] or "", "platform": r["platform"]}
                  for r in conn.execute("SELECT email, platform, display_name FROM platform_users "
                                        "WHERE platform NOT IN ('365','google','docusign')")]
        decisions = {(r["matricula"], r["platform"], r["account_email"]): r["decision"]
                     for r in conn.execute("SELECT matricula, platform, account_email, decision FROM offboarding_decisions")}
        dmap_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "company_domains.json")
        dmap = offboarding.load_domain_map(dmap_path) if os.path.exists(dmap_path) else None
        matches, people = offboarding.build_matches(terms, m365, google, docusign, others, decisions, dmap)
        conn.execute("DELETE FROM offboarding_matches")
        conn.executemany("""INSERT INTO offboarding_matches (matricula, person_name, company, termination_date, platform,
            account_email, account_name, account_status, confidence, method, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [(m["matricula"], m["person_name"], m["company"], m["termination_date"], m["platform"], m["account_email"],
              m["account_name"], m["account_status"], m["confidence"], m["method"], m["detail"]) for m in matches])
        conn.executemany("UPDATE hr_terminations SET match_status=?, match_detail=? WHERE matricula=?",
                         [(st, det, mat) for mat, (st, det) in people.items()])
        conn.commit()
        return _offboarding_summary(conn)
    finally:
        conn.close()

def _safe_rebuild_offboarding():
    """Usado ao fim dos syncs: falha aqui não pode derrubar o sync."""
    try:
        rebuild_offboarding()
    except Exception as e:
        print(f"Erro ao recalcular offboarding: {e}")

@app.post("/offboarding/import")
def offboarding_import(url: str = Form(...)):
    """Importa a planilha mensal do RH (link do Google Sheets). Acumula o histórico: quem
    saiu em meses anteriores e ainda tem acesso continua aparecendo."""
    try:
        deslig_rows, geral_rows = offboarding.read_hr_sheet(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except requests.RequestException as e:
        print(f"Erro ao baixar planilha do RH: {e}")
        raise HTTPException(status_code=502, detail="Não consegui baixar a planilha do Google. Tente de novo.")
    terms = offboarding.parse_terminations(deslig_rows)
    census = offboarding.census_index(geral_rows)
    conn = get_db()
    try:
        for t in terms:
            rehire, rdetail = offboarding.classify_rehire(t, census)
            d = offboarding.parse_date(t["termination_date"])
            conn.execute("""INSERT INTO hr_terminations (matricula, name, company, cargo, termination_date, email_rh, motivo,
                rehire_status, rehire_detail, source, imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(matricula) DO UPDATE SET name=excluded.name, company=excluded.company, cargo=excluded.cargo,
                termination_date=excluded.termination_date, email_rh=excluded.email_rh, motivo=excluded.motivo,
                source=excluded.source, imported_at=CURRENT_TIMESTAMP""",
                (t["matricula"], t["name"], t["company"], t["cargo"], d.isoformat() if d else t["termination_date"],
                 t["email_rh"], t["motivo"], rehire, rdetail, url[:300]))
        # Censo novo reavalia TODO o histórico: alguém desligado em agosto pode ter sido
        # readmitido em setembro.
        if census:
            for r in conn.execute("SELECT matricula, name, termination_date FROM hr_terminations").fetchall():
                rehire, rdetail = offboarding.classify_rehire(dict(r), census)
                conn.execute("UPDATE hr_terminations SET rehire_status=?, rehire_detail=? WHERE matricula=?",
                             (rehire, rdetail, r["matricula"]))
        conn.execute("INSERT INTO import_logs (source, records_imported, notes) VALUES (?,?,?)",
                     ("rh_gsheet", len(terms), f"censo={'sim' if geral_rows else 'nao'}"))
        conn.commit()
    finally:
        conn.close()
    summary = rebuild_offboarding()
    aviso = "" if geral_rows else " ⚠ Aba Geral (censo) não encontrada: recontratações NÃO foram verificadas."
    return {**summary, "importados": len(terms), "censo": bool(geral_rows),
            "message": (f"{len(terms)} desligados importados. {summary['agir']} com acesso a remover (certeza), "
                        f"{summary['revisar']} para revisar, {summary['recontratados']} recontratados.{aviso}")}

@app.post("/offboarding/rebuild")
def offboarding_rebuild():
    return rebuild_offboarding()

@app.get("/offboarding/summary")
def offboarding_summary():
    conn = get_db()
    try:
        return _offboarding_summary(conn)
    finally:
        conn.close()

@app.get("/offboarding/review")
def offboarding_review(search: str = "", platform: str = ""):
    """Fila de revisão: correspondências sem certeza total."""
    conn = get_db()
    try:
        q = "SELECT * FROM offboarding_matches WHERE confidence='revisar'"
        params = []
        if platform:
            q += " AND platform=?"
            params.append(platform)
        if search:
            q += " AND (LOWER(person_name) LIKE ? OR LOWER(account_email) LIKE ? OR matricula LIKE ?)"
            params += [f"%{search.lower()}%"] * 3
        return [dict(r) for r in conn.execute(q + " ORDER BY person_name, platform", params).fetchall()]
    finally:
        conn.close()

class OffboardingDecision(BaseModel):
    matricula: str
    platform: str
    account_email: str
    decision: str          # confirmar | rejeitar | desfazer

@app.post("/offboarding/decision")
def offboarding_decision(d: OffboardingDecision):
    if d.decision not in ("confirmar", "rejeitar", "desfazer"):
        raise HTTPException(status_code=400, detail="Decisão inválida.")
    key = (d.matricula, d.platform, d.account_email.lower())
    conn = get_db()
    try:
        if d.decision == "desfazer":
            conn.execute("DELETE FROM offboarding_decisions WHERE matricula=? AND platform=? AND account_email=?", key)
        else:
            conn.execute("""INSERT INTO offboarding_decisions (matricula, platform, account_email, decision) VALUES (?,?,?,?)
                ON CONFLICT(matricula, platform, account_email) DO UPDATE SET decision=excluded.decision,
                decided_at=CURRENT_TIMESTAMP""", (*key, d.decision))
        conn.commit()
    finally:
        conn.close()
    return rebuild_offboarding()

# Pacotes que incluem os apps do Office (Word/Excel/Outlook...). Prioridade na remoção:
# é licença paga parada em conta de desligado.
OFFICE_LICENSE_KEYWORDS = ["business standard", "business basic", "business premium", "office 365",
                           "microsoft 365 e", "microsoft 365 f", "apps for"]
# Não usa FREE_LICENSE_KEYWORDS: lá 'standard' marcaria o Business Standard como grátis.
M365_FREE_KEYWORDS = ["grátis", "gratis", "free", "viral", "exploratory", "trial", "dev", "adhoc",
                      "unlicensed", "stream"]

def _is_office(lic):
    return any(k in lic.lower() for k in OFFICE_LICENSE_KEYWORDS)

def _is_paid_m365(lic):
    return _is_office(lic) or not any(k in lic.lower() for k in M365_FREE_KEYWORDS)

@app.get("/offboarding/m365-licensed")
def offboarding_m365_licensed(search: str = ""):
    """Contas M365 de desligados (remover ou revisar) que ainda têm licença paga. Office primeiro."""
    conn = get_db()
    try:
        lic_by_mail = {}
        for r in conn.execute("SELECT email, upn, licenses FROM ms365_users WHERE COALESCE(licenses,'') != ''"):
            for a in (r["email"], r["upn"]):
                if a:
                    lic_by_mail[a.lower()] = r["licenses"]
        q = "SELECT * FROM offboarding_matches WHERE platform='365' AND confidence IN ('agir','revisar')"
        params = []
        if search:
            q += " AND (LOWER(person_name) LIKE ? OR LOWER(account_email) LIKE ? OR matricula LIKE ?)"
            params += [f"%{search.lower()}%"] * 3
        rows = conn.execute(q, params).fetchall()
    finally:
        conn.close()
    result = []
    for r in rows:
        paid = [l for l in (lic_by_mail.get(r["account_email"]) or "").split(";") if l and _is_paid_m365(l)]
        if not paid:
            continue
        office = [l for l in paid if _is_office(l)]
        result.append({**dict(r), "licenses": paid, "office": office})
    result.sort(key=lambda x: (not x["office"], x["confidence"] != "agir", x["person_name"] or ""))
    return result

# ─── OFFBOARDING: AÇÕES (desativar / reativar via API) ───────────────────────
# Regras de segurança:
# - Só age em contas que estão em "Remover" (confidence='agir') NO MOMENTO da execução.
# - Só desativa/suspende (reversível). Nunca exclui conta.
# - OFFBOARDING_ACTIONS_ENABLED != "true" → tudo roda como simulação.
# - Toda tentativa (simulada, ok ou erro) vai para offboarding_actions, com quem pediu.

import graph_integration as graph_api
import docusign_integration as ds_api
from fastapi import Request

API_PLATFORMS = ("365", "google", "docusign")
MAX_BATCH = 25

def _actions_allowed() -> bool:
    """Trava do servidor (.env). Se false, nem o botão da tela consegue ligar o modo real."""
    return os.getenv("OFFBOARDING_ACTIONS_ENABLED", "false").strip().lower() == "true"

def _actions_enabled() -> bool:
    if not _actions_allowed():
        return False
    conn = get_db()
    try:
        r = conn.execute("SELECT value FROM app_settings WHERE key='offboarding_live'").fetchone()
    finally:
        conn.close()
    return bool(r) and r["value"] == "true"

def _m365_key(conn, email):
    """Graph endereça por id/UPN. Convidados (#EXT#) não são achados pelo e-mail."""
    r = conn.execute("SELECT upn FROM ms365_users WHERE LOWER(email)=? OR LOWER(upn)=?", (email, email)).fetchone()
    return (r["upn"] if r and r["upn"] else email)

def _protected_emails() -> set:
    return {e.strip().lower() for e in os.getenv("OFFBOARDING_PROTECTED_EMAILS", "").split(",") if e.strip()}

def _actor(request: Request) -> str:
    # nginx repassa o usuário do Basic Auth (frontend/nginx.conf)
    return request.headers.get("x-remote-user") or "desconhecido"

def _log_action(conn, m, action, status, detail, actor, extra=None):
    conn.execute("""INSERT INTO offboarding_actions (matricula, person_name, platform, account_email, action,
        status, detail, extra, actor) VALUES (?,?,?,?,?,?,?,?,?)""",
        (m["matricula"], m["person_name"], m["platform"], m["account_email"], action, status, detail,
         json.dumps(extra) if extra else None, actor))

def _google_post(action, email):
    url, token = os.getenv("GOOGLE_APPS_SCRIPT_URL"), os.getenv("GOOGLE_APPS_SCRIPT_TOKEN")
    if not url or not token:
        raise Exception("GOOGLE_APPS_SCRIPT_TOKEN não configurado (veja google_apps_script.gs, passo 4).")
    resp = requests.post(url, json={"token": token, "action": action, "email": email}, timeout=60)
    try:
        data = resp.json()
    except ValueError:
        raise Exception(f"Apps Script respondeu algo inesperado ({resp.status_code}). Publicou a versão nova?")
    if not data.get("success"):
        raise Exception(f"Google: {data.get('error')}")

def _docusign_targets(conn, email):
    """Todas as contas DocuSign ativas com esse e-mail (a pessoa pode estar em mais de uma)."""
    out = []
    for r in conn.execute("SELECT id, account_id, account_name, user_id_ds, raw_json FROM docusign_users "
                          "WHERE LOWER(email)=? AND status IN ('active','pending')", (email,)):
        uid = r["user_id_ds"]
        if not uid:
            try:
                uid = json.loads(r["raw_json"] or "{}").get("userId")
            except ValueError:
                uid = None
        out.append((r["id"], r["account_id"], r["account_name"], uid))
    return out

def _deactivate(conn, m, remove_licenses):
    """Executa de verdade. Devolve (detalhe, extra) ou levanta exceção."""
    email = m["account_email"]
    if m["platform"] == "365":
        cfg = get_graph_config()
        onp = conn.execute("SELECT on_prem FROM ms365_users WHERE LOWER(email)=? OR LOWER(upn)=?", (email, email)).fetchone()
        if onp and onp["on_prem"]:
            raise Exception("Conta sincronizada do AD local: desative no Active Directory (o Entra replica).")
        token = get_graph_token(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
        key = _m365_key(conn, email)
        graph_api.set_account_enabled(token, key, False)
        graph_api.revoke_sessions(token, key)
        skus = graph_api.remove_all_licenses(token, key) if remove_licenses else []
        conn.execute("UPDATE ms365_users SET account_enabled=0 WHERE LOWER(email)=? OR LOWER(upn)=?", (email, email))
        det = "Entrada bloqueada e sessões revogadas" + (f"; {len(skus)} licença(s) removida(s)" if skus else "")
        if "#ext#" in key.lower():
            det += " (conta convidada: só perde o acesso à holding)"
        return det, {"licenses_removed": skus}
    if m["platform"] == "google":
        _google_post("suspend", email)
        conn.execute("UPDATE google_users SET status='suspended' WHERE LOWER(email)=?", (email,))
        conn.execute("DELETE FROM platform_users WHERE platform='google' AND LOWER(email)=?", (email,))
        return "Conta suspensa no Google Workspace", None
    if m["platform"] == "docusign":
        targets = _docusign_targets(conn, email)
        if not targets:
            raise Exception("Nenhuma conta DocuSign ativa com esse e-mail (já foi fechada?)")
        cfg = ds_api.get_config()
        token = get_jwt_token(cfg["integration_key"], cfg["user_id"], cfg["rsa_key_path"])
        accounts = {a["id"]: a for a in cfg["accounts"]}
        closed = []
        for row_id, acc_id, acc_name, uid in targets:
            if not uid or acc_id not in accounts:
                raise Exception(f"Sem userId/conta configurada para {acc_name}; rode o sync do DocuSign")
            ds_api.close_user(accounts[acc_id], token, uid)
            conn.execute("UPDATE docusign_users SET status='closed' WHERE id=?", (row_id,))
            closed.append(acc_name)
        conn.execute("DELETE FROM platform_users WHERE platform='docusign' AND LOWER(email)=?", (email,))
        return f"Acesso fechado no DocuSign: {', '.join(closed)}", {"accounts": closed}
    # Plataformas sem API (Lucid, Jira, Bitbucket): registra que foi feito à mão.
    conn.execute("DELETE FROM platform_users WHERE platform=? AND LOWER(email)=?", (m["platform"], email))
    return "Marcado como desativado manualmente", None

class DeactivateItem(BaseModel):
    matricula: str
    platform: str
    account_email: str

class DeactivateRequest(BaseModel):
    items: list[DeactivateItem]
    remove_licenses: bool = False
    dry_run: bool = False

@app.get("/offboarding/actions/config")
def offboarding_actions_config():
    return {"enabled": _actions_enabled(), "allowed": _actions_allowed(), "max_batch": MAX_BATCH,
            "google_ready": bool(os.getenv("GOOGLE_APPS_SCRIPT_TOKEN")),
            "protected": len(_protected_emails())}

class ModeRequest(BaseModel):
    enabled: bool

@app.post("/offboarding/actions/mode")
def offboarding_actions_mode(req: ModeRequest, request: Request):
    """Liga/desliga o modo real pela tela. Fica registrado no histórico."""
    if req.enabled and not _actions_allowed():
        raise HTTPException(status_code=400, detail="O servidor não permite ações reais (OFFBOARDING_ACTIONS_ENABLED=false no .env).")
    actor = _actor(request)
    conn = get_db()
    try:
        conn.execute("""INSERT INTO app_settings (key, value, updated_by) VALUES ('offboarding_live', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP""",
            ("true" if req.enabled else "false", actor))
        conn.execute("""INSERT INTO offboarding_actions (matricula, person_name, platform, account_email, action, status, detail, actor)
            VALUES ('', '', '-', '', 'modo', 'ok', ?, ?)""",
            ("Modo real LIGADO" if req.enabled else "Modo real desligado (simulação)", actor))
        conn.commit()
    finally:
        conn.close()
    return offboarding_actions_config()

@app.post("/offboarding/deactivate")
def offboarding_deactivate(req: DeactivateRequest, request: Request):
    if not req.items:
        raise HTTPException(status_code=400, detail="Nenhuma conta selecionada.")
    if len(req.items) > MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"Máximo de {MAX_BATCH} contas por vez.")
    simulate = req.dry_run or not _actions_enabled()
    actor, protected = _actor(request), _protected_emails()
    results = []
    conn = get_db()
    try:
        for it in req.items:
            email = it.account_email.lower()
            row = conn.execute("SELECT * FROM offboarding_matches WHERE matricula=? AND platform=? AND account_email=? "
                               "AND confidence='agir'", (it.matricula, it.platform, email)).fetchone()
            base = {"matricula": it.matricula, "platform": it.platform, "account_email": email}
            if not row:
                results.append({**base, "status": "erro", "detail": "Não está em 'Remover' (confirme na revisão ou recarregue)"})
                continue
            m = dict(row)
            if email in protected:
                _log_action(conn, m, "desativar", "bloqueado", "Conta protegida (OFFBOARDING_PROTECTED_EMAILS)", actor)
                results.append({**base, "status": "bloqueado", "detail": "Conta protegida"})
                continue
            if simulate:
                det = "Simulação: nada foi alterado" + ("" if _actions_enabled() else " (ações desligadas no servidor)")
                _log_action(conn, m, "desativar", "simulado", det, actor)
                results.append({**base, "status": "simulado", "detail": det})
                continue
            try:
                det, extra = _deactivate(conn, m, req.remove_licenses and m["platform"] == "365")
                status = "ok" if m["platform"] in API_PLATFORMS else "manual"
                _log_action(conn, m, "desativar", status, det, actor, extra)
                results.append({**base, "status": status, "detail": det})
            except Exception as e:
                _log_action(conn, m, "desativar", "erro", str(e)[:500], actor)
                results.append({**base, "status": "erro", "detail": str(e)[:300]})
            conn.commit()      # cada conta é gravada na hora: uma falha no meio não perde o histórico
        conn.commit()
    finally:
        conn.close()
    if not simulate:
        _safe_rebuild_offboarding()
    return {"simulated": simulate, "results": results,
            "ok": sum(r["status"] in ("ok", "manual") for r in results),
            "errors": sum(r["status"] == "erro" for r in results)}

@app.get("/offboarding/actions")
def offboarding_actions(search: str = "", limit: int = 500):
    conn = get_db()
    try:
        q, params = "SELECT * FROM offboarding_actions", []
        if search:
            q += " WHERE LOWER(person_name) LIKE ? OR LOWER(account_email) LIKE ? OR matricula LIKE ?"
            params = [f"%{search.lower()}%"] * 3
        rows = [dict(r) for r in conn.execute(q + " ORDER BY id DESC LIMIT ?", (*params, min(limit, 2000)))]
        undone = {r[0] for r in conn.execute("SELECT CAST(extra AS INTEGER) FROM offboarding_actions "
                                            "WHERE (action='reativar' AND status='ok') OR action='revertido'")}
    finally:
        conn.close()
    for r in rows:
        r["can_reactivate"] = (r["action"] == "desativar" and r["status"] == "ok"
                               and r["platform"] in ("365", "google") and r["id"] not in undone)
    return rows

class ReactivateRequest(BaseModel):
    action_id: int

@app.post("/offboarding/reactivate")
def offboarding_reactivate(req: ReactivateRequest, request: Request):
    """Desfaz uma desativação (365: desbloqueia e devolve licenças; Google: tira a suspensão).
    Grava 'Não é a pessoa' para o match, senão ele voltaria para a lista de remoção."""
    if not _actions_enabled():
        raise HTTPException(status_code=400, detail="Ações desligadas no servidor (OFFBOARDING_ACTIONS_ENABLED).")
    actor = _actor(request)
    conn = get_db()
    try:
        a = conn.execute("SELECT * FROM offboarding_actions WHERE id=? AND action='desativar' AND status='ok'",
                         (req.action_id,)).fetchone()
        if not a or a["platform"] not in ("365", "google"):
            raise HTTPException(status_code=400, detail="Essa ação não pode ser desfeita por aqui.")
        if conn.execute("SELECT 1 FROM offboarding_actions WHERE action='reativar' AND status='ok' AND extra=?",
                        (str(a["id"]),)).fetchone():
            raise HTTPException(status_code=400, detail="Já foi reativada.")
        m, email = dict(a), a["account_email"]
        try:
            if a["platform"] == "365":
                cfg = get_graph_config()
                token = get_graph_token(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
                key = _m365_key(conn, email)
                graph_api.set_account_enabled(token, key, True)
                skus = (json.loads(a["extra"] or "{}") or {}).get("licenses_removed") or []
                graph_api.add_licenses(token, key, skus)
                conn.execute("UPDATE ms365_users SET account_enabled=1 WHERE LOWER(email)=? OR LOWER(upn)=?", (email, email))
                det = "Entrada liberada" + (f"; {len(skus)} licença(s) devolvida(s)" if skus else "")
            else:
                _google_post("unsuspend", email)
                conn.execute("UPDATE google_users SET status='active' WHERE LOWER(email)=?", (email,))
                det = "Suspensão removida no Google"
        except Exception as e:
            conn.execute("""INSERT INTO offboarding_actions (matricula, person_name, platform, account_email, action,
                status, detail, extra, actor) VALUES (?,?,?,?,?,?,?,?,?)""",
                (m["matricula"], m["person_name"], m["platform"], email, "reativar", "erro", str(e)[:500], str(a["id"]), actor))
            conn.commit()
            raise HTTPException(status_code=502, detail=str(e)[:300])
        conn.execute("""INSERT INTO offboarding_actions (matricula, person_name, platform, account_email, action,
            status, detail, extra, actor) VALUES (?,?,?,?,?,?,?,?,?)""",
            (m["matricula"], m["person_name"], m["platform"], email, "reativar", "ok", det, str(a["id"]), actor))
        conn.execute("""INSERT INTO offboarding_decisions (matricula, platform, account_email, decision) VALUES (?,?,?,'rejeitar')
            ON CONFLICT(matricula, platform, account_email) DO UPDATE SET decision='rejeitar', decided_at=CURRENT_TIMESTAMP""",
            (m["matricula"], m["platform"], email))
        conn.commit()
    finally:
        conn.close()
    _safe_rebuild_offboarding()
    return {"message": det}


# Desfeito = reativado pelo painel OU revertido por sincronização externa (AD local).
_UNDONE_SQL = ("SELECT 1 FROM offboarding_actions r WHERE r.extra=CAST(a.id AS TEXT) AND "
               "((r.action='reativar' AND r.status='ok') OR r.action='revertido')")

def _reconcile_m365_actions(conn) -> int:
    """Depois do sync do M365: conta que o painel desativou e voltou a ficar ativa
    (ex.: Entra Connect sobrescrevendo a partir do AD local) vira um alerta no Histórico."""
    rows = conn.execute(f"""SELECT a.*, u.on_prem FROM offboarding_actions a
        JOIN ms365_users u ON LOWER(u.email)=a.account_email OR LOWER(u.upn)=a.account_email
        WHERE a.platform='365' AND a.action='desativar' AND a.status='ok' AND u.account_enabled=1
        AND NOT EXISTS ({_UNDONE_SQL})""").fetchall()
    for a in rows:
        det = "Voltou a ficar ATIVA no Azure após a desativação"
        det += (": conta sincronizada do AD local, desative no Active Directory (use o script PowerShell)"
                if a["on_prem"] else ": verifique se alguém a reativou")
        conn.execute("""INSERT INTO offboarding_actions (matricula, person_name, platform, account_email, action,
            status, detail, extra, actor) VALUES (?,?,?,?,'revertido','alerta',?,?,'sync')""",
            (a["matricula"], a["person_name"], "365", a["account_email"], det, str(a["id"])))
    return len(rows)

@app.get("/offboarding/ad-local-script")
def offboarding_ad_local_script():
    """Script PowerShell para desativar no AD local as contas em 'Remover' que vêm do AD
    (o Graph não consegue: o Entra Connect sobrescreve a nuvem)."""
    conn = get_db()
    try:
        rows = conn.execute("""SELECT DISTINCT m.matricula, m.person_name, u.upn FROM offboarding_matches m
            JOIN ms365_users u ON LOWER(u.email)=m.account_email OR LOWER(u.upn)=m.account_email
            WHERE m.platform='365' AND m.confidence='agir' AND u.on_prem=1 AND u.account_enabled=1
            ORDER BY u.upn""").fetchall()
    finally:
        conn.close()
    lines = "\n".join(f"    '{r['upn']}'   # mat. {r['matricula']} - {(r['person_name'] or '').replace(chr(39), '')}" for r in rows)
    from fastapi.responses import PlainTextResponse
    script = f"""# AccessGuard - desativar no AD LOCAL contas de desligados ({datetime.now():%d/%m/%Y %H:%M})
# {len(rows)} conta(s). O Entra Connect replica para o Azure/M365 no próximo ciclo (~30 min).
#
# Rodar num servidor do domínio com o módulo ActiveDirectory (RSAT), como admin do AD.
# 1) Primeiro SEM parâmetro: só mostra o que faria.
#      .\\desativar-ad-local.ps1
# 2) Conferiu? Rode de verdade:
#      .\\desativar-ad-local.ps1 -Executar
param([switch]$Executar)
Import-Module ActiveDirectory

$contas = @(
{lines}
)

foreach ($upn in $contas) {{
    $u = Get-ADUser -Filter "UserPrincipalName -eq '$upn'" -Properties Enabled
    if (-not $u) {{ Write-Warning "Não encontrado no AD: $upn"; continue }}
    if (-not $u.Enabled) {{ Write-Host "Já desativada: $upn"; continue }}
    if ($Executar) {{
        Disable-ADAccount -Identity $u
        Write-Host "DESATIVADA: $upn" -ForegroundColor Yellow
    }} else {{
        Write-Host "[simulação] desativaria: $upn" -ForegroundColor Cyan
    }}
}}
if (-not $Executar) {{ Write-Host "`nNada foi alterado. Rode com -Executar para desativar." }}
"""
    return PlainTextResponse(script, headers={"Content-Disposition": 'attachment; filename="desativar-ad-local.ps1"'})
