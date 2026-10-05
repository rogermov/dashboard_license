"""
Motor de identidade para o offboarding.

Cruza a planilha mensal de desligados do RH (SAP) com as contas de cada sistema e
diz, com nível de certeza, quem precisa ser desativado e onde.

Regras:
- "agir" só com evidência inequívoca: matrícula SAP == employeeId no M365, ou e-mail
  informado pelo RH. Todo o resto (nome igual, ambíguo, nome parecido) vai para
  "revisar" — um falso positivo derruba o acesso de alguém que está ativo.
- Recontratação (nome "Presente" no censo com entrada na data da saída ou depois)
  bloqueia qualquer ação. Nome "Presente" com entrada anterior (homônimo ou contrato
  concorrente) rebaixa tudo para "revisar".
- Homônimo comprovado (mesmo nome, mas a conta tem OUTRA matrícula) nunca vira candidato.
- Empresas em "fora_da_gestao" (company_domains.json) são ignoradas.
- Candidato achado só por NOME cujo e-mail é de outra empresa do grupo (company_domains.json)
  é descartado. Matches por matrícula/e-mail do RH não passam por esse filtro (transferências).
- Decisões manuais (confirmar / não é a pessoa) são aplicadas a cada recálculo.

Este módulo não acessa o banco: recebe listas de dicts e devolve listas de dicts.
"""
import csv
import io
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime

import requests

AGIR, REVISAR = "agir", "revisar"
SHEET_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")


# ─── Empresa → domínios ──────────────────────────────────────────────────────

def load_domain_map(path):
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return {"fora_da_gestao": [fold(k) for k in raw.get("fora_da_gestao", [])],
            "grupo": {d.lower() for d in raw.get("grupo", [])},
            "empresas": {fold(k): {d.lower() for d in v} for k, v in raw.get("empresas", {}).items()}}


def domain_verdict(company, email, dmap):
    """('ok' | 'grupo' | 'outra' | 'desconhecido' | 'sem_mapa' | None, texto)."""
    if not dmap or not email or "@" not in email:
        return None, ""
    dom = email.lower().rsplit("@", 1)[1]
    comp = fold(company)
    own = set().union(*[v for k, v in dmap["empresas"].items() if k in comp])
    if dom in own:      # antes do grupo: comporte.com.br é da Holding, mas neutro p/ as demais
        return "ok", "domínio confere com a empresa"
    if dom in dmap["grupo"]:
        return "grupo", "domínio do grupo (não confirma a empresa)"
    if not own:
        return "sem_mapa", "empresa sem domínio mapeado"
    if dom in own:
        return "ok", "domínio confere com a empresa"
    donos = [k for k, v in dmap["empresas"].items() if dom in v]
    if donos:
        return "outra", f"{email} é da empresa '{donos[0]}', não de {company}"
    return "desconhecido", f"domínio {dom} não mapeado"


# ─── Normalização ────────────────────────────────────────────────────────────

def fold(s) -> str:
    """Minúsculas, sem acento. Remove o caractere de substituição (U+FFFD) que
    aparece quando a exportação do SAP vem com encoding quebrado."""
    s = unicodedata.normalize("NFKD", str(s or "")).replace("�", "")
    return s.encode("ascii", "ignore").decode().lower().strip()


def normalize_name(s) -> str:
    s = fold(s)
    s = re.sub(r"\(.*?\)", " ", s)          # anotações tipo "(Pira DF)", "(CCO)"
    s = re.sub(r"[^a-z\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_mat(m) -> str:
    return str(m or "").strip().lstrip("0")


def parse_date(s):
    s = (s or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def name_compatible(rh_name: str, other_name: str) -> bool:
    """Regra anti-homônimo da skill do Workspace: o primeiro nome tem que ser igual e
    TODOS os termos do nome no sistema precisam existir no nome do RH."""
    rh, ot = normalize_name(rh_name).split(), normalize_name(other_name).split()
    if len(ot) < 2 or not rh or rh[0] != ot[0]:
        return False
    return set(ot) <= set(rh)


# ─── Leitura da planilha do RH (link mensal do Google Sheets) ────────────────

def _sheet_error():
    return ValueError("Não consegui ler a planilha. Confira se o link está compartilhado "
                      "como 'Qualquer pessoa com o link pode ver'.")


def list_tabs(sheet_id: str):
    resp = requests.get(f"https://docs.google.com/spreadsheets/d/{sheet_id}/htmlview", timeout=30)
    if resp.status_code != 200:
        raise _sheet_error()
    tabs = []
    for name, gid in re.findall(r'items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)".*?gid:\s*"(\d+)"', resp.text, re.S):
        try:
            name = json.loads('"' + name.replace("\\x", "\\u00") + '"')
        except ValueError:
            pass
        tabs.append((gid, name))
    return tabs


def fetch_tab(sheet_id: str, gid: str):
    resp = requests.get(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}", timeout=90)
    text = resp.content.decode("utf-8", errors="replace")
    if resp.status_code != 200 or text.lstrip().startswith("<"):
        raise _sheet_error()
    return list(csv.DictReader(io.StringIO(text)))


def _map_cols(keys, spec):
    folded = {k: fold(k) for k in keys}
    out = {}
    for field, preds in spec.items():
        for pred in preds:
            hit = next((k for k, f in folded.items() if pred(f)), None)
            if hit:
                out[field] = hit
                break
    return out


_COMMON = {
    "matricula": [lambda f: f.startswith("matr")],
    "name": [lambda f: f == "nome completo", lambda f: f.startswith("nome")],
    "company": [lambda f: f == "txt.empresa", lambda f: f == "empresa"],
    "saida": [lambda f: "data de sa" in f],
}
DESLIGADOS_SPEC = {**_COMMON,
                   "cargo": [lambda f: f == "txt.cargo", lambda f: f == "cargo"],
                   "email": [lambda f: "mail" in f],
                   "motivo": [lambda f: f.startswith("motivo")]}
GERAL_SPEC = {**_COMMON,
              "entrada": [lambda f: "data de entrada" in f],
              "status": [lambda f: f == "status"]}


def read_hr_sheet(url: str):
    """Lê as abas de desligados e do censo (Geral) a partir do link do mês.
    As abas são reconhecidas pelas colunas, não pelo gid nem pelo nome."""
    m = SHEET_ID_RE.search(url or "")
    if not m:
        raise ValueError("Link inválido: cole o link do Google Sheets (docs.google.com/spreadsheets/d/...).")
    sheet_id = m.group(1)
    tabs = list_tabs(sheet_id)
    if not tabs:
        raise _sheet_error()
    desligados = geral = None
    for gid, name in tabs:
        if fold(name).startswith("result"):     # abas de saída de outras ferramentas
            continue
        rows = fetch_tab(sheet_id, gid)
        if not rows:
            continue
        heads = [fold(h) for h in rows[0].keys()]
        is_geral = "status" in heads and any("data de entrada" in h for h in heads)
        is_deslig = any("data de sa" in h for h in heads) and "status" not in heads
        if is_geral and geral is None:
            geral = rows
        elif is_deslig and desligados is None:
            desligados = rows
    if desligados is None:
        raise ValueError("Não encontrei a aba de desligados (colunas Matrícula, Nome Completo e Data de Saída).")
    return desligados, geral or []


def parse_terminations(rows):
    if not rows:
        return []
    c = _map_cols(rows[0].keys(), DESLIGADOS_SPEC)
    out = []
    for r in rows:
        mat = str(r.get(c.get("matricula"), "") or "").strip()
        name = str(r.get(c.get("name"), "") or "").strip()
        if not mat or not name:
            continue
        email = str(r.get(c.get("email"), "") or "").strip().lower()
        out.append({
            "matricula": mat, "name": name,
            "company": str(r.get(c.get("company"), "") or "").strip(),
            "cargo": str(r.get(c.get("cargo"), "") or "").strip(),
            "termination_date": str(r.get(c.get("saida"), "") or "").strip(),
            "email_rh": email if "@" in email else "",
            "motivo": str(r.get(c.get("motivo"), "") or "").strip(),
        })
    return out


def census_index(rows):
    """Colaboradores 'Presente' no censo, indexados pelo nome normalizado."""
    if not rows:
        return {}
    c = _map_cols(rows[0].keys(), GERAL_SPEC)
    idx = defaultdict(list)
    for r in rows:
        if fold(r.get(c.get("status"), "")) != "presente":
            continue
        idx[normalize_name(r.get(c.get("name"), ""))].append({
            "matricula": str(r.get(c.get("matricula"), "") or "").strip(),
            "company": str(r.get(c.get("company"), "") or "").strip(),
            "entrada": str(r.get(c.get("entrada"), "") or "").strip(),
        })
    return idx


def classify_rehire(term, census):
    """('recontratado' | 'presente_no_censo' | None, detalhe)."""
    ativos = census.get(normalize_name(term["name"]), [])
    if not ativos:
        return None, None
    saida = parse_date(term["termination_date"])
    for g in ativos:
        ent = parse_date(g["entrada"])
        if saida and ent and ent >= saida:
            return "recontratado", (f"Readmitido em {g['entrada']} (matrícula {g['matricula']}, "
                                    f"{g['company']}) — não desativar")
    g = ativos[0]
    return "presente_no_censo", (f"Há colaborador ATIVO com o mesmo nome no censo (matrícula "
                                 f"{g['matricula']}, {g['company']}): homônimo ou contrato concorrente")


# ─── Motor de correspondência ────────────────────────────────────────────────

def build_matches(terminations, m365, google, docusign, others, decisions, domain_map=None):
    """
    terminations: hr_terminations (matricula, name, company, termination_date, email_rh,
                  rehire_status, rehire_detail)
    m365:     email, upn, name, enabled, employee_id, aliases (lista)
    google:   email, name, active
    docusign: email, name, active, status, label ("Nome · Conta")
    others:   email, name, platform           (Lucid/Bitbucket/Jira importados por CSV)
    decisions: {(matricula, platform, email): 'confirmar' | 'rejeitar'}
    domain_map: load_domain_map(...) — filtra candidatos achados só por nome

    Retorna (matches, people): matches = linhas por conta; people = {matricula: (status, detalhe)}
    com status 'agir' | 'revisar' | 'recontratado' | 'sem_conta'.
    """
    by_emp, by_login, m_by_mail, m_by_name = defaultdict(list), defaultdict(list), {}, defaultdict(list)
    for u in m365:
        if strip_mat(u["employee_id"]):
            by_emp[strip_mat(u["employee_id"])].append(u)
        # Contas criadas com a matrícula como login (ex.: 10055690@holding...onmicrosoft.com)
        for a in {(u["email"] or "").lower(), (u["upn"] or "").lower()}:
            local = a.split("@")[0]
            if local.isdigit() and strip_mat(local):
                by_login[strip_mat(local)].append(u)
        for a in [u["email"], u["upn"], *u["aliases"]]:
            if a:
                m_by_mail[a.lower()] = u
        m_by_name[normalize_name(u["name"])].append(u)

    def index(accounts):
        by_mail, by_first = defaultdict(list), defaultdict(list)
        for a in accounts:
            if a["email"]:
                by_mail[a["email"].lower()].append(a)
            toks = normalize_name(a["name"]).split()
            if toks:
                by_first[toks[0]].append(a)
        return by_mail, by_first

    g_mail, g_first = index([g for g in google if g["active"]])
    d_mail, d_first = index([d for d in docusign if d["active"]])
    o_mail = defaultdict(list)
    for o in others:
        if o["email"]:
            o_mail[o["email"].lower()].append(o)

    def label_of(platform):
        return {"365": "Microsoft 365", "google": "Google", "docusign": "DocuSign"}.get(platform, platform)

    matches, people = [], {}
    for t in terminations:
        mat, nome = t["matricula"], normalize_name(t["name"])
        if domain_map and any(k in fold(t.get("company")) for k in domain_map.get("fora_da_gestao", [])):
            people[mat] = ("fora_da_gestao", "Empresa fora da gestão de TI")
            continue
        if t.get("rehire_status") == "recontratado":
            people[mat] = ("recontratado", t.get("rehire_detail") or "")
            continue
        cap = t.get("rehire_status") == "presente_no_censo"
        notes = [t["rehire_detail"]] if cap else []
        rows = {}

        def add(platform, email, name, status, conf, method, by_name=False):
            email = (email or "").lower()
            dec = decisions.get((mat, platform, email))
            if dec == "rejeitar":
                return
            if by_name and dec != "confirmar":
                v, txt = domain_verdict(t.get("company"), email, domain_map)
                if v == "outra":
                    notes.append(f"Descartado ({label_of(platform)}): {txt}")
                    return
                if txt:
                    method = f"{method} · {txt}"
            if dec == "confirmar":
                conf, method = AGIR, method + " · confirmado manualmente"
            elif cap and conf == AGIR:
                conf = REVISAR
            key = (platform, email)
            if key in rows and rows[key]["confidence"] == AGIR:
                return
            rows[key] = {"matricula": mat, "person_name": t["name"], "company": t.get("company", ""),
                         "termination_date": t.get("termination_date", ""), "platform": platform,
                         "account_email": email, "account_name": name or "", "account_status": status,
                         "confidence": conf, "method": method}

        # 1) Quem é a pessoa no M365 (é o diretório que tem a matrícula)
        ident, conf, method, ident_by_name = [], None, None, False
        email_rh = (t.get("email_rh") or "").lower()
        login = [u for u in by_login.get(strip_mat(mat), [])
                 if strip_mat(u["employee_id"]) in ("", strip_mat(mat))]
        if by_emp.get(strip_mat(mat)):
            ident, conf, method = by_emp[strip_mat(mat)], AGIR, "Matrícula SAP = employeeId no M365"
        elif login and any(name_compatible(t["name"], u["name"]) or normalize_name(u["name"]) == nome for u in login):
            ident, conf, method = login, AGIR, "Matrícula no login do M365 + nome compatível"
        elif login:
            ident, conf, method = login, REVISAR, "Matrícula no login do M365, mas o nome da conta é diferente"
        elif email_rh and email_rh in m_by_mail:
            ident, conf, method = [m_by_mail[email_rh]], AGIR, "E-mail informado pelo RH"
        else:
            cands = m_by_name.get(nome, [])
            sem_mat = [u for u in cands if not strip_mat(u["employee_id"])]
            outra_mat = [u for u in cands if strip_mat(u["employee_id"]) not in ("", strip_mat(mat))]
            if outra_mat:
                notes.append("Homônimo descartado no M365: conta com o mesmo nome pertence a outra matrícula")
            # nome igual mas e-mail de outra empresa: homônimo, não é identidade
            descart = [u for u in sem_mat if domain_verdict(t.get("company"), u["email"] or u["upn"], domain_map)[0] == "outra"
                       and decisions.get((mat, "365", (u["email"] or u["upn"]).lower())) != "confirmar"]
            for u in descart:
                notes.append("Descartado (Microsoft 365): "
                             + domain_verdict(t.get("company"), u["email"] or u["upn"], domain_map)[1])
            sem_mat = [u for u in sem_mat if u not in descart]
            if sem_mat:
                ident, conf, ident_by_name = sem_mat, REVISAR, True
                method = ("Nome igual no M365 (conta sem matrícula cadastrada)" if len(sem_mat) == 1
                          else f"Nome igual em {len(sem_mat)} contas do M365 (ambíguo)")

        for u in ident:
            if u["enabled"]:
                add("365", u["email"] or u["upn"], u["name"], "ativa", conf, method, by_name=ident_by_name)

        # 2) E-mails da pessoa → encontrá-la nos outros sistemas (cada um usa um domínio)
        addrs = {}
        for u in ident:
            for a in [u["email"], u["upn"], *u["aliases"]]:
                if a:
                    addrs[a.lower()] = (conf, f"{method} → mesmo e-mail", ident_by_name)
        if email_rh:
            addrs[email_rh] = (AGIR, "E-mail informado pelo RH", False)
            if email_rh in m_by_mail and m_by_mail[email_rh]["enabled"]:
                u = m_by_mail[email_rh]
                add("365", u["email"] or u["upn"], u["name"], "ativa", AGIR, "E-mail informado pelo RH")

        def propagate(platform, by_mail, by_first, label):
            found = False
            for a, (c, m, bn) in addrs.items():
                for acc in by_mail.get(a, []):
                    add(platform, acc["email"], acc.get("label") or acc["name"], acc.get("status", "ativa"), c, m, by_name=bn)
                    found = True
            if found or not by_first:
                return
            # 3) Sem e-mail em comum: candidato por nome — sempre para revisão
            first = nome.split()[0] if nome else ""
            exatos = [a for a in by_first.get(first, []) if normalize_name(a["name"]) == nome]
            compat = [a for a in by_first.get(first, []) if name_compatible(t["name"], a["name"])]
            if exatos:
                tag = "" if len(exatos) == 1 else f" ({len(exatos)} contas, ambíguo)"
                for a in exatos:
                    add(platform, a["email"], a.get("label") or a["name"], a.get("status", "ativa"), REVISAR, f"Nome igual no {label}{tag}", by_name=True)
            elif len(compat) == 1:
                a = compat[0]
                add(platform, a["email"], a.get("label") or a["name"], a.get("status", "ativa"), REVISAR,
                    f"Nome compatível no {label} (todos os termos constam no nome do RH)", by_name=True)

        propagate("google", g_mail, g_first, "Google")
        propagate("docusign", d_mail, d_first, "DocuSign")
        for a, (c, m, bn) in addrs.items():
            for o in o_mail.get(a, []):
                add(o["platform"], o["email"], o["name"], "ativa", c, m, by_name=bn)

        detail = " | ".join(n for n in notes if n)
        for r in rows.values():
            r["detail"] = detail
            matches.append(r)
        confs = {r["confidence"] for r in rows.values()}
        status = AGIR if AGIR in confs else REVISAR if REVISAR in confs else "sem_conta"
        people[mat] = (status, detail or ("" if rows else "Nenhuma conta ativa encontrada"))
    return matches, people
