from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import pandas as pd
import requests
import io
import re
from typing import Optional
from datetime import datetime
import os

app = FastAPI(title="AccessGuard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "/data/accessguard.db"
PLATFORMS = ["365", "docusign", "lucid", "bitbucket", "jira", "google"]

# Mapeamento de colunas de email por plataforma (português e inglês)
EMAIL_COLUMN_HINTS = {
    "365": ["nome do usuário principal", "userprincipalname", "user principal name", "email", "e-mail", "mail"],
    "default": ["email", "e-mail", "mail", "userprincipalname", "login", "username", "usuario", "usuário"]
}

# Mapeamento de colunas de nome
NAME_COLUMN_HINTS = [
    "nome de exibição", "display name", "nome", "name", "nome completo", "full name",
    "nome do usuário", "sobrenome", "last name"
]

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs("/data", exist_ok=True)
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS terminated_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            termination_date TEXT,
            department TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS platform_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            platform TEXT NOT NULL,
            display_name TEXT,
            extra_data TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(email, platform)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS azure_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            department TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS import_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            platform TEXT,
            records_imported INTEGER,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

def normalize_email(email: str) -> str:
    return str(email).strip().lower() if email else ""

def find_column(df_columns, hints):
    """Encontra coluna pelo nome (case-insensitive, sem acento aproximado)"""
    cols_lower = [c.lower().strip() for c in df_columns]
    for hint in hints:
        for i, col in enumerate(cols_lower):
            if hint.lower() in col or col in hint.lower():
                return df_columns[i]
    return None

def read_csv_flexible(content: bytes) -> pd.DataFrame:
    """Tenta ler CSV com diferentes encodings e separadores"""
    attempts = [
        {"encoding": "utf-8", "sep": ","},
        {"encoding": "utf-8-sig", "sep": ","},  # BOM utf-8
        {"encoding": "latin1", "sep": ","},
        {"encoding": "utf-8", "sep": ";"},
        {"encoding": "latin1", "sep": ";"},
    ]
    for kwargs in attempts:
        try:
            df = pd.read_csv(io.BytesIO(content), **kwargs)
            if len(df.columns) > 1:
                return df
        except Exception:
            continue
    raise HTTPException(status_code=400, detail="Não foi possível ler o CSV. Verifique o formato.")

def extract_sheet_id(url: str) -> Optional[str]:
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    return match.group(1) if match else None

def fetch_gsheet_as_df(sheet_id: str, gid: str = "0") -> pd.DataFrame:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    resp = requests.get(url, timeout=15)
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Não foi possível acessar a planilha. Verifique se está pública.")
    return pd.read_csv(io.StringIO(resp.text))

# ─── ENDPOINTS ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@app.get("/stats")
def get_stats():
    conn = get_db()
    c = conn.cursor()
    total_terminated = c.execute("SELECT COUNT(*) FROM terminated_users").fetchone()[0]
    total_azure = c.execute("SELECT COUNT(*) FROM azure_users").fetchone()[0]

    platform_counts = {}
    for p in PLATFORMS:
        platform_counts[p] = c.execute(
            "SELECT COUNT(*) FROM platform_users WHERE platform=?", (p,)
        ).fetchone()[0]

    active_accesses = c.execute("""
        SELECT COUNT(DISTINCT t.email) FROM terminated_users t
        INNER JOIN platform_users p ON LOWER(t.email) = LOWER(p.email)
    """).fetchone()[0]

    exposure = {}
    for p in PLATFORMS:
        count = c.execute("""
            SELECT COUNT(*) FROM terminated_users t
            INNER JOIN platform_users pu ON LOWER(t.email) = LOWER(pu.email)
            WHERE pu.platform = ?
        """, (p,)).fetchone()[0]
        exposure[p] = count

    last_imports = c.execute(
        "SELECT * FROM import_logs ORDER BY imported_at DESC LIMIT 5"
    ).fetchall()

    conn.close()
    return {
        "total_terminated": total_terminated,
        "total_azure_users": total_azure,
        "platform_users": platform_counts,
        "terminated_with_active_access": active_accesses,
        "exposure_by_platform": exposure,
        "last_imports": [dict(r) for r in last_imports],
    }

@app.get("/users/risk")
def get_risk_users(search: str = "", platform: str = ""):
    conn = get_db()
    c = conn.cursor()
    query = """
        SELECT
            t.email, t.name, t.department, t.termination_date,
            GROUP_CONCAT(DISTINCT pu.platform) as active_platforms
        FROM terminated_users t
        INNER JOIN platform_users pu ON LOWER(t.email) = LOWER(pu.email)
        WHERE 1=1
    """
    params = []
    if search:
        query += " AND (LOWER(t.email) LIKE ? OR LOWER(t.name) LIKE ?)"
        params += [f"%{search.lower()}%", f"%{search.lower()}%"]
    if platform:
        query += " AND pu.platform = ?"
        params.append(platform)
    query += " GROUP BY t.email ORDER BY t.termination_date DESC"
    rows = c.execute(query, params).fetchall()
    conn.close()
    result = []
    for r in rows:
        platforms = r["active_platforms"].split(",") if r["active_platforms"] else []
        result.append({
            "email": r["email"],
            "name": r["name"] or r["email"],
            "department": r["department"],
            "termination_date": r["termination_date"],
            "active_platforms": platforms,
            "risk_level": "high" if len(platforms) >= 3 else "medium" if len(platforms) >= 1 else "low"
        })
    return result

@app.get("/users/terminated")
def get_all_terminated(search: str = ""):
    conn = get_db()
    c = conn.cursor()
    if search:
        rows = c.execute(
            "SELECT * FROM terminated_users WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ? ORDER BY imported_at DESC",
            (f"%{search.lower()}%", f"%{search.lower()}%")
        ).fetchall()
    else:
        rows = c.execute("SELECT * FROM terminated_users ORDER BY imported_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/preview/csv")
async def preview_csv(platform: str = ""):
    """Retorna as colunas detectadas de um CSV — usado para debug"""
    return {"message": "Use POST /import/platform/csv com o arquivo"}

# ─── IMPORT: PLATAFORMA CSV ────────────────────────────────────────────────────

@app.post("/import/platform/csv")
async def import_platform_csv(
    platform: str = Form(...),
    file: UploadFile = File(...)
):
    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Plataforma inválida. Use: {PLATFORMS}")

    content = await file.read()
    df = read_csv_flexible(content)

    # Detectar coluna de email (com hints específicos por plataforma)
    hints = EMAIL_COLUMN_HINTS.get(platform, []) + EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns), hints)
    if not email_col:
        email_col = df.columns[0]

    # Detectar coluna de nome
    name_col = find_column(list(df.columns), NAME_COLUMN_HINTS)

    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM platform_users WHERE platform=?", (platform,))

    count = 0
    skipped = 0
    for _, row in df.iterrows():
        email = normalize_email(row.get(email_col, ""))
        # Filtrar linhas sem email válido ou que sejam contas de serviço
        if not email or "@" not in email:
            skipped += 1
            continue
        display_name = str(row.get(name_col, "")) if name_col else None
        try:
            c.execute("""
                INSERT INTO platform_users (email, platform, display_name)
                VALUES (?, ?, ?)
                ON CONFLICT(email, platform) DO UPDATE SET
                    display_name=excluded.display_name,
                    imported_at=CURRENT_TIMESTAMP
            """, (email, platform, display_name))
            count += 1
        except Exception:
            skipped += 1

    c.execute("INSERT INTO import_logs (source, platform, records_imported, notes) VALUES (?, ?, ?, ?)",
              ("csv_upload", platform, count, f"coluna_email={email_col}, pulados={skipped}"))
    conn.commit()
    conn.close()
    return {
        "imported": count,
        "skipped": skipped,
        "email_column_used": email_col,
        "platform": platform,
        "message": f"{count} usuários importados para {platform} (coluna usada: '{email_col}')."
    }

# ─── IMPORT: AZURE (para cruzar nome → email do RH) ──────────────────────────

@app.post("/import/azure/csv")
async def import_azure_csv(file: UploadFile = File(...)):
    """
    Importa o relatório da Azure com nome + email.
    Serve como base para cruzar desligados que o RH manda só com nome.
    """
    content = await file.read()
    df = read_csv_flexible(content)

    hints = EMAIL_COLUMN_HINTS["365"] + EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns), hints)
    if not email_col:
        email_col = df.columns[0]

    name_col = find_column(list(df.columns), NAME_COLUMN_HINTS)
    dept_col = find_column(list(df.columns), ["departamento", "department", "depto", "setor"])

    conn = get_db()
    c = conn.cursor()
    count = 0
    for _, row in df.iterrows():
        email = normalize_email(row.get(email_col, ""))
        if not email or "@" not in email:
            continue
        name = str(row.get(name_col, "")).strip() if name_col else None
        dept = str(row.get(dept_col, "")).strip() if dept_col else None
        try:
            c.execute("""
                INSERT INTO azure_users (email, name, department)
                VALUES (?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    name=excluded.name, department=excluded.department,
                    imported_at=CURRENT_TIMESTAMP
            """, (email, name, dept))
            count += 1
        except Exception:
            pass

    c.execute("INSERT INTO import_logs (source, records_imported, notes) VALUES (?, ?, ?)",
              ("azure_csv", count, f"coluna_email={email_col}"))
    conn.commit()
    conn.close()
    return {"imported": count, "email_column_used": email_col,
            "message": f"{count} usuários da Azure importados. Agora você pode importar desligados por nome."}

# ─── IMPORT: DESLIGADOS via Google Sheets ────────────────────────────────────

@app.post("/import/terminated/gsheet")
async def import_terminated_gsheet(url: str = Form(...)):
    sheet_id = extract_sheet_id(url)
    if not sheet_id:
        raise HTTPException(status_code=400, detail="URL inválida.")
    df = fetch_gsheet_as_df(sheet_id)
    return await _process_terminated_df(df, source=f"gsheet:{url[:60]}")

@app.post("/import/terminated/csv")
async def import_terminated_csv(file: UploadFile = File(...)):
    content = await file.read()
    df = read_csv_flexible(content)
    return await _process_terminated_df(df, source="csv_rh")

async def _process_terminated_df(df: pd.DataFrame, source: str):
    """
    Processa lista de desligados. Suporta:
    - Coluna de email direto
    - Coluna de nome: faz lookup na tabela azure_users para achar o email
    """
    hints = EMAIL_COLUMN_HINTS["default"]
    email_col = find_column(list(df.columns), hints)
    name_col = find_column(list(df.columns), NAME_COLUMN_HINTS)
    dept_col = find_column(list(df.columns), ["departamento", "department", "depto", "setor", "área", "area"])
    date_col = find_column(list(df.columns), ["data desligamento", "data", "desligamento", "termination", "demissão", "saída"])

    conn = get_db()
    c = conn.cursor()

    # Carregar azure_users para lookup por nome
    azure_by_name = {}
    azure_rows = c.execute("SELECT email, name FROM azure_users").fetchall()
    for ar in azure_rows:
        if ar["name"]:
            azure_by_name[ar["name"].lower().strip()] = ar["email"]

    count = 0
    matched_by_name = 0
    not_found = 0

    for _, row in df.iterrows():
        email = None
        name = str(row.get(name_col, "")).strip() if name_col else None
        dept = str(row.get(dept_col, "")).strip() if dept_col else None
        date = str(row.get(date_col, "")).strip() if date_col else None

        # Tentar pegar email direto
        if email_col:
            raw = str(row.get(email_col, "")).strip()
            if "@" in raw:
                email = normalize_email(raw)

        # Se não achou email, tenta pelo nome na base Azure
        if not email and name:
            email = azure_by_name.get(name.lower())
            if email:
                matched_by_name += 1

        if not email:
            not_found += 1
            continue

        try:
            c.execute("""
                INSERT INTO terminated_users (email, name, department, termination_date)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    name=excluded.name, department=excluded.department,
                    termination_date=excluded.termination_date,
                    imported_at=CURRENT_TIMESTAMP
            """, (email, name, dept, date))
            count += 1
        except Exception:
            pass

    c.execute("INSERT INTO import_logs (source, records_imported, notes) VALUES (?, ?, ?)",
              (source, count, f"por_nome={matched_by_name}, nao_encontrados={not_found}"))
    conn.commit()
    conn.close()

    msg = f"{count} desligados importados."
    if matched_by_name:
        msg += f" {matched_by_name} encontrados por nome via base Azure."
    if not_found:
        msg += f" ⚠ {not_found} não encontrados (sem email e sem match por nome)."

    return {"imported": count, "matched_by_name": matched_by_name,
            "not_found": not_found, "message": msg}

@app.delete("/data/reset")
def reset_all():
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM terminated_users")
    c.execute("DELETE FROM platform_users")
    c.execute("DELETE FROM azure_users")
    c.execute("DELETE FROM import_logs")
    conn.commit()
    conn.close()
    return {"message": "Banco limpo com sucesso."}
