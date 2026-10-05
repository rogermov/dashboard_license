"""Regras do motor de offboarding. Rodar com:  cd backend && python -m pytest tests -q"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import offboarding as ob  # noqa: E402


def m365(email, name, emp="", enabled=True, aliases=()):
    return {"email": email, "upn": email, "name": name, "enabled": enabled,
            "employee_id": emp, "aliases": list(aliases)}


def term(mat, name, email_rh="", rehire=None, detail=None, saida="2026-09-10"):
    return {"matricula": mat, "name": name, "company": "TIC Trens SA", "termination_date": saida,
            "email_rh": email_rh, "rehire_status": rehire, "rehire_detail": detail}


DMAP = {"grupo": {"comporte.com.br"},
        "empresas": {"piracicabana": {"piracicabana.com.br"}, "metro bh": {"metrobh.com.br"}}}


def run(terms, m=(), google=(), ds=(), others=(), decisions=None, dmap=None):
    return ob.build_matches(list(terms), list(m), list(google), list(ds), list(others), decisions or {}, dmap)


def gacc(email, name):
    return {"email": email, "name": name, "active": True, "status": "ativa"}


def test_matricula_e_certeza_e_propaga_pelo_email():
    matches, people = run(
        [term("00123", "JOAO DA SILVA")],
        m=[m365("joao.silva@tictrens.com.br", "João da Silva", emp="123")],
        ds=[{"email": "joao.silva@tictrens.com.br", "name": "Joao Silva", "active": True, "status": "ativa"}])
    assert people["00123"][0] == "agir"
    assert {(r["platform"], r["confidence"]) for r in matches} == {("365", "agir"), ("docusign", "agir")}


def test_so_nome_vai_para_revisao():
    matches, people = run([term("9", "MARIA SOUZA")], m=[m365("maria.souza@x.com", "Maria Souza")])
    assert people["9"][0] == "revisar"
    assert matches[0]["confidence"] == "revisar"


def test_homonimo_com_outra_matricula_e_descartado():
    matches, people = run([term("9", "MARIA SOUZA")], m=[m365("maria@x.com", "Maria Souza", emp="555")])
    assert matches == [] and people["9"][0] == "sem_conta"
    assert "Homônimo" in people["9"][1]


def test_recontratado_nunca_gera_acao():
    matches, people = run([term("1", "ANA LIMA", rehire="recontratado", detail="Readmitido")],
                          m=[m365("ana@x.com", "Ana Lima", emp="1")])
    assert matches == [] and people["1"][0] == "recontratado"


def test_presente_no_censo_rebaixa_matricula_para_revisao():
    matches, _ = run([term("1", "ANA LIMA", rehire="presente_no_censo", detail="Ativo no censo")],
                     m=[m365("ana@x.com", "Ana Lima", emp="1")])
    assert matches[0]["confidence"] == "revisar"


def test_email_do_rh_e_certeza():
    matches, people = run([term("7", "PEDRO ALVES", email_rh="pedro@x.com")],
                          m=[m365("pedro@x.com", "Pedro A.")])
    assert people["7"][0] == "agir"


def test_conta_desativada_nao_gera_acao_mas_ajuda_a_achar_nos_outros():
    matches, _ = run([term("5", "LUCAS REIS")],
                     m=[m365("lucas@x.com", "Lucas Reis", emp="5", enabled=False, aliases=["l.reis@y.com"])],
                     google=[{"email": "l.reis@y.com", "name": "Lucas Reis", "active": True, "status": "ativa"}])
    assert [(r["platform"], r["confidence"]) for r in matches] == [("google", "agir")]


def test_decisoes_manuais():
    t = [term("9", "MARIA SOUZA")]
    m = [m365("maria.souza@x.com", "Maria Souza")]
    ok, _ = run(t, m, decisions={("9", "365", "maria.souza@x.com"): "confirmar"})
    assert ok[0]["confidence"] == "agir"
    nao, people = run(t, m, decisions={("9", "365", "maria.souza@x.com"): "rejeitar"})
    assert nao == [] and people["9"][0] == "sem_conta"


def test_nome_compativel_exige_mesmo_primeiro_nome_e_subconjunto():
    assert ob.name_compatible("Ana Paula Rodrigues dos Santos", "Ana Santos")
    assert not ob.name_compatible("Ana Paula Rodrigues dos Santos Melo", "Ana Beatriz Rodrigues Silva")
    assert not ob.name_compatible("Ana Paula Santos", "Paula Santos")


def test_classifica_recontratacao_pelo_censo():
    census = ob.census_index([
        {"Matrícula": "200", "Nome Completo": "Ana Lima", "Txt.Empresa": "X", "Data de Entrada": "01/10/2026",
         "Data de Saída": "", "Status": "Presente"}])
    assert ob.classify_rehire({"name": "ANA LIMA", "termination_date": "10/09/2026"}, census)[0] == "recontratado"
    assert ob.classify_rehire({"name": "ANA LIMA", "termination_date": "10/11/2026"}, census)[0] == "presente_no_censo"
    assert ob.classify_rehire({"name": "OUTRA PESSOA", "termination_date": "10/09/2026"}, census)[0] is None


def test_le_colunas_mesmo_com_encoding_quebrado():
    rows = [{"Matr�cula": "10", "Nome Completo": "Ze", "Txt.Empresa": "X", "Data de Sa�da": "29/09/2026",
             "E-mail": "", "Cargo": "", "Motivo": ""}]
    t = ob.parse_terminations(rows)
    assert t[0]["matricula"] == "10" and t[0]["termination_date"] == "29/09/2026"


def test_matricula_no_login_com_nome_compativel_e_certeza():
    _, people = run([term("010055690", "ADEMIR DA SILVA")],
                    m=[m365("10055690@holding.onmicrosoft.com", "Ademir da Silva")])
    assert people["010055690"][0] == "agir"


def test_matricula_no_login_com_nome_diferente_vai_para_revisao():
    _, people = run([term("10055690", "ADEMIR DA SILVA")],
                    m=[m365("10055690@holding.onmicrosoft.com", "Carlos Pereira")])
    assert people["10055690"][0] == "revisar"


def pira(mat, name):
    t = term(mat, name)
    t["company"] = "Viacao Piracicabana SA"
    return t


def test_candidato_por_nome_com_dominio_de_outra_empresa_e_descartado():
    matches, people = run([pira("10016137", "HELIO PEREIRA CAMPOS")],
                          google=[gacc("helio.pereira@metrobh.com.br", "Hélio Pereira")], dmap=DMAP)
    assert matches == [] and people["10016137"][0] == "sem_conta"
    assert "metrobh.com.br" in people["10016137"][1]


def test_candidato_por_nome_com_dominio_da_empresa_continua_em_revisao():
    matches, _ = run([pira("1", "HELIO PEREIRA CAMPOS")],
                     google=[gacc("helio.pereira@piracicabana.com.br", "Hélio Pereira")], dmap=DMAP)
    assert matches[0]["confidence"] == "revisar" and "confere" in matches[0]["method"]


def test_dominio_do_grupo_nao_descarta():
    matches, _ = run([pira("1", "HELIO PEREIRA CAMPOS")],
                     google=[gacc("helio@comporte.com.br", "Hélio Pereira")], dmap=DMAP)
    assert matches[0]["confidence"] == "revisar"


def test_matricula_ignora_filtro_de_dominio_transferencia():
    matches, people = run([pira("5", "LUCAS REIS")],
                          m=[m365("lucas@metrobh.com.br", "Lucas Reis", emp="5")], dmap=DMAP)
    assert people["5"][0] == "agir"


def test_confirmacao_manual_vence_o_filtro_de_dominio():
    matches, _ = run([pira("9", "HELIO PEREIRA CAMPOS")],
                     google=[gacc("helio.pereira@metrobh.com.br", "Hélio Pereira")], dmap=DMAP,
                     decisions={("9", "google", "helio.pereira@metrobh.com.br"): "confirmar"})
    assert matches[0]["confidence"] == "agir"


def test_mapa_de_dominios_do_repo_e_valido():
    import os
    dm = ob.load_domain_map(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "company_domains.json"))
    assert ob.domain_verdict("Viacao Piracicabana SA", "x@metrobh.com.br", dm)[0] == "outra"
