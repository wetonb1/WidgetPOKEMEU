# -*- coding: utf-8 -*-
"""Testes do importar.py (etapa 1). Só dados INVENTADOS, em pasta temporária: nunca as suas exportações.
Rodar: python cerebro/tools/test_importar.py"""
import contextlib
import csv
import io
import json
import os
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importar  # noqa: E402

# segredos FALSOS, montados em pedaços para nenhum scanner confundir este arquivo com um vazamento
CHAVE_SK = "sk-" + "ant-" + "A1b2C3d4E5f6G7h8I9j0"
CHAVE_GOOGLE = "AIza" + "Sy" + "A" * 33
CHAVE_GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
TOKEN_LONGO = "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm9Nb8Vc7"   # 40 caracteres, letras e números
CARTAO = "4111 1111 1111 1111"                          # número de teste público (passa no Luhn)
CPF = "529.982.247-25"                                  # CPF de exemplo com dígitos válidos


def claude_conv(uuid, nome, msgs, criada="2025-03-10T14:20:30.123456Z"):
    return {"uuid": uuid, "name": nome, "created_at": criada, "updated_at": criada, "account": {"uuid": "x"},
            "chat_messages": [{"uuid": f"{uuid}-{i}", "sender": s, "text": t, "content": [{"type": "text", "text": t}],
                               "created_at": criada, "attachments": [], "files": []} for i, (s, t) in enumerate(msgs)]}


def chatgpt_conv(cid, titulo, msgs, criada=1741616430.5, ramo_abandonado=False):
    """Árvore real: raiz vazia -> system -> mensagens...; opcionalmente um ramo abandonado (resposta regerada)."""
    mapping = {"raiz": {"id": "raiz", "message": None, "parent": None, "children": ["sys"]},
               "sys": {"id": "sys", "message": {"author": {"role": "system"}, "content": {"content_type": "text", "parts": [""]}, "create_time": criada},
                       "parent": "raiz", "children": []}}
    pai = "sys"
    for i, (papel, texto) in enumerate(msgs):
        no = f"m{i}"
        mapping[no] = {"id": no, "message": {"author": {"role": papel}, "create_time": criada + i,
                                             "content": {"content_type": "text", "parts": [texto]}}, "parent": pai, "children": []}
        mapping[pai]["children"].append(no)
        pai = no
    if ramo_abandonado:
        mapping["velho"] = {"id": "velho", "message": {"author": {"role": "assistant"}, "create_time": criada + 1,
                                                       "content": {"content_type": "text", "parts": ["RESPOSTA DESCARTADA"]}},
                            "parent": "m0", "children": []}
        mapping["m0"]["children"].append("velho")
    return {"title": titulo, "create_time": criada, "update_time": criada, "mapping": mapping, "current_node": pai, "conversation_id": cid, "id": cid}


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)
        self.pasta = self.raiz / "importacoes"
        self.pasta.mkdir()
        self.arq_projetos = self.raiz / "projetos.json"
        self.projetos = [{"id": "jogo-de-corrida", "nome": "Jogo de Corrida", "pasta": str(self.raiz), "tags": ["roblox", "luau"]},
                         {"id": "site", "nome": "Site Portfolio", "pasta": str(self.raiz), "tags": ["css", "portfolio"]}]
        self.arq_projetos.write_text(json.dumps(self.projetos), encoding="utf-8")
        env = mock.patch.dict(os.environ, {"PROJETOS_JSON": str(self.arq_projetos), "IMPORTACOES_DIR": str(self.pasta)})
        env.start()
        self.addCleanup(env.stop)

    def escrever(self, nome, dados):
        arq = self.pasta / nome
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        return arq

    def csv(self):
        with open(self.pasta / "candidatas.csv", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f, delimiter=";"))

    def normalizado(self):
        return [json.loads(l) for l in (self.pasta / "normalizado.jsonl").read_text(encoding="utf-8").splitlines()]


LONGA = [("human", "Como configurar o erro de colisão do carro?"), ("assistant", "Use um raycast para detectar."),
         ("human", "E se o código falhar?"), ("assistant", "Veja o traceback no output.")]


class TestSegredos(unittest.TestCase):
    def test_cada_tipo_vira_removido_e_e_contado(self):
        c = {}
        t = importar.limpar_segredos(
            f"chaves {CHAVE_SK} e {CHAVE_GOOGLE} e {CHAVE_GH}\ntoken {TOKEN_LONGO}\nAuthorization: Bearer abcdef1234567890ZZ\n"
            f"cartão {CARTAO} cpf {CPF}\nsenha: minha frase secreta 123\nPassword = hunter2", c)
        for segredo in (CHAVE_SK, CHAVE_GOOGLE, CHAVE_GH, TOKEN_LONGO, "abcdef1234567890ZZ", CARTAO, CPF, "frase secreta", "hunter2"):
            self.assertNotIn(segredo, t)
        self.assertEqual(c, {"chave_api": 3, "token": 2, "cartao": 1, "cpf": 1, "senha": 2})
        self.assertIn("senha: " + importar.MARCA, t)
        self.assertIn("Password = " + importar.MARCA, t)

    def test_nao_estraga_texto_comum(self):
        c = {}
        t = "Rode python cerebro/tools/importar.py --pasta C:/Users/x/importacoes/arquivo-muito-comprido-de-exemplo-1234567890 em 1741616430500 ms. Pedido 123456789012. Telefone 11 91234-5678. Palavra: anticonstitucionalissimamente_longa."
        self.assertEqual(importar.limpar_segredos(t, c), t)
        self.assertEqual(c, {})

    def test_cartao_so_com_luhn_e_cpf_so_com_digito_verificador(self):
        c = {}
        t = importar.limpar_segredos("cartão 4111111111111112 cpf 12345678900 outro 52998224725 e 4111-1111-1111-1111", c)
        self.assertIn("4111111111111112", t)   # Luhn inválido
        self.assertIn("12345678900", t)        # dígitos verificadores inválidos
        self.assertNotIn("52998224725", t)
        self.assertNotIn("4111-1111-1111-1111", t)
        self.assertEqual((c.get("cartao"), c.get("cpf")), (1, 1))

    def test_senha_so_ate_o_fim_da_linha(self):
        t = importar.limpar_segredos('{"password": "abc123"}\nrecuperar senha é um fluxo comum\nsenha: x\nlinha seguinte intacta')
        self.assertIn("linha seguinte intacta", t)
        self.assertNotIn("abc123", t)


class TestLeitores(Base):
    def test_claude(self):
        self.escrever("conversations.json", [claude_conv("u1", "Colisão do carro", LONGA), claude_conv("u2", "", [("human", "oi")])])
        c, _ = importar.ler_tudo(self.pasta)
        a = next(x for x in c if x["id"] == "claude:u1")
        self.assertEqual((a["origem"], a["titulo_original"], a["data_criacao"], a["total_mensagens"]), ("claude", "Colisão do carro", "2025-03-10T14:20:30", 4))
        self.assertTrue(a["texto"].startswith("EU: Como configurar") and "\n\nIA: Use um raycast" in a["texto"])
        self.assertEqual(a["total_caracteres"], len(a["texto"]))
        self.assertEqual(next(x for x in c if x["id"] == "claude:u2")["titulo_original"], "(sem título)")

    def test_claude_texto_so_nos_blocos_de_content(self):
        conv = claude_conv("u3", "x", [("human", "pergunta")])
        conv["chat_messages"][0]["text"] = ""
        self.escrever("conversations.json", [conv])
        self.assertIn("EU: pergunta", importar.ler_tudo(self.pasta)[0][0]["texto"])

    def test_chatgpt_segue_o_ramo_atual_e_ignora_system_e_ramos_descartados(self):
        msgs = [("user", "Qual a melhor forma de fazer deploy?"), ("assistant", "Use CI."), ("user", "Obrigado"), ("assistant", "De nada")]
        self.escrever("conversations.json", [chatgpt_conv("c1", "Deploy", msgs, ramo_abandonado=True)])
        (c,), _ = importar.ler_tudo(self.pasta)
        self.assertEqual((c["id"], c["origem"], c["total_mensagens"], c["data_criacao"]), ("chatgpt:c1", "chatgpt", 4, "2025-03-10T14:20:30"))
        self.assertNotIn("DESCARTADA", c["texto"])
        self.assertTrue(c["texto"].startswith("EU: Qual a melhor forma") and c["texto"].endswith("IA: De nada"))

    def test_gemini_json_agrupa_por_janela_de_tempo(self):
        def e(hora, pergunta, resposta):
            return {"header": "Gemini Apps", "title": "Prompted " + pergunta, "time": f"2025-02-01T{hora}Z", "products": ["Gemini Apps"],
                    "safeHtmlItem": [{"html": f"<p>{resposta}</p>"}]}
        # o Takeout vem da mais nova para a mais antiga
        self.escrever("MyActivity.json", [e("18:00:00", "pergunta isolada", "r"), e("10:20:00", "terceira", "r3"), e("10:10:00", "segunda", "r2"),
                                          e("10:00:00", "primeira", "<b>r1</b>"),
                                          {"header": "Search", "title": "Searched for algo", "time": "2025-02-01T10:05:00Z", "products": ["Search"]}])
        c, _ = importar.ler_tudo(self.pasta)
        self.assertEqual(sorted(x["total_mensagens"] for x in c), [2, 6])
        g = next(x for x in c if x["total_mensagens"] == 6)
        self.assertEqual((g["origem"], g["titulo_original"]), ("gemini", "primeira"))
        self.assertTrue(g["texto"].startswith("EU: primeira\n\nIA: r1\n\nEU: segunda"))
        self.assertNotIn("Searched", "".join(x["texto"] for x in c))

    def test_gemini_html(self):
        def bloco(pergunta, data, resposta):
            return (f'<div class="outer-cell mdl-cell"><div class="mdl-grid"><div class="header-cell"><p>Gemini Apps</p></div>'
                    f'<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted {pergunta}<br>{data}<br><p>{resposta}</p></div>'
                    f'<div class="content-cell mdl-cell mdl-typography--caption"><b>Products:</b><br>Gemini Apps</div></div></div>')
        (self.pasta / "MyActivity.html").write_text("<html><body>" + bloco("segunda", "Feb 1, 2025, 10:10:00 AM BRT", "r2")
                                                    + bloco("primeira", "1 de fev. de 2025 10:00:00 BRT", "r1") + "</body></html>", encoding="utf-8")
        (c,), _ = importar.ler_tudo(self.pasta)
        self.assertEqual((c["total_mensagens"], c["titulo_original"], c["data_criacao"]), (4, "primeira", "2025-02-01T10:00:00"))

    def test_zip_e_descompactado_nao_duplicam_e_arquivos_estranhos_sao_ignorados(self):
        dados = [claude_conv("u1", "Colisão", LONGA)]
        with zipfile.ZipFile(self.pasta / "export.zip", "w") as z:
            z.writestr("conversations.json", json.dumps(dados))
            z.writestr("users.json", json.dumps([{"uuid": "x", "full_name": "Fulano"}]))
            z.writestr("../fugiu.json", "[]")
        self.escrever("solto/conversations.json", dados)
        r = importar.executar()
        self.assertEqual(r["total"], 1)
        self.assertTrue((self.pasta / "_extraido" / "export" / "conversations.json").exists())
        self.assertFalse((self.raiz / "fugiu.json").exists())
        self.assertTrue(any(i.endswith("users.json") for i in r["arquivos_ignorados"]))

    def test_ids_repetidos_entre_arquivos_contam_uma_vez(self):
        self.escrever("conversations-000.json", [chatgpt_conv("c1", "A", [("user", "oi"), ("assistant", "olá")])])
        self.escrever("conversations-001.json", [chatgpt_conv("c1", "A", [("user", "oi"), ("assistant", "olá"), ("user", "mais")]), chatgpt_conv("c2", "B", [("user", "x")])])
        self.assertEqual(sorted(c["id"] for c in importar.ler_tudo(self.pasta)[0]), ["chatgpt:c1", "chatgpt:c2"])


class TestRelatorioEFiltro(Base):
    def montar(self):
        tecnica = [("human", "Preciso configurar o deploy"), ("assistant", "ok"), ("human", "deu erro"), ("assistant", "veja o log")]
        sobre_projeto = [("human", "Vamos falar do Jogo de Corrida?"), ("assistant", "claro"), ("human", "a pista"), ("assistant", "boa")]
        papo = [("human", "Qual a capital da França?"), ("assistant", "Paris"), ("human", "e da Itália?"), ("assistant", "Roma")]
        com_segredo = [("human", f"Minha chave é {CHAVE_SK} e o cpf {CPF}"), ("assistant", "Não cole segredos."), ("human", "senha: abc"), ("assistant", "erro de config")]
        self.escrever("conversations.json", [
            claude_conv("tec", "Deploy do app", tecnica), claude_conv("proj", "Pista nova", sobre_projeto), claude_conv("papo", "Geografia", papo),
            claude_conv("curta", "Erro de código", [("human", "erro de código"), ("assistant", "qual?")]), claude_conv("seg", "Configurar chaves", com_segredo)])
        self.escrever("chat/conversations.json", [chatgpt_conv("g1", "Roblox luau script", [("user", "script luau"), ("assistant", "ok"), ("user", "mais"), ("assistant", "ok")])])

    def test_sim_so_com_4_mensagens_e_projeto_ou_termo_tecnico(self):
        self.montar()
        importar.executar()
        por_id = {l["id"]: l for l in self.csv()}
        self.assertEqual(list(next(iter(por_id.values())).keys()), importar.COLUNAS)
        esperado = {"claude:tec": "SIM", "claude:proj": "SIM", "claude:papo": "NAO", "claude:curta": "NAO", "claude:seg": "SIM", "chatgpt:g1": "SIM"}
        self.assertEqual({k: v["importar"] for k, v in por_id.items()}, esperado)
        self.assertEqual(por_id["claude:proj"]["projeto_sugerido"], "jogo-de-corrida")
        self.assertEqual(por_id["chatgpt:g1"]["projeto_sugerido"], "jogo-de-corrida")  # tag roblox/luau
        self.assertEqual(por_id["claude:papo"]["projeto_sugerido"], "")
        self.assertEqual((por_id["claude:tec"]["origem"], por_id["claude:tec"]["data"], por_id["claude:tec"]["mensagens"]), ("claude", "2025-03-10", "4"))

    def test_tokens_sao_caracteres_sobre_4_e_o_csv_bate_com_o_normalizado(self):
        self.montar()
        importar.executar()
        norm = {c["id"]: c for c in self.normalizado()}
        for l in self.csv():
            c = norm[l["id"]]
            self.assertEqual((int(l["caracteres"]), int(l["tokens_estimados"])), (c["total_caracteres"], (c["total_caracteres"] + 3) // 4))
            self.assertEqual(set(c), {"id", "origem", "titulo_original", "data_criacao", "total_mensagens", "total_caracteres", "texto"})

    def test_segredos_nao_chegam_a_nenhum_arquivo_e_sao_contados(self):
        self.montar()
        r = importar.executar()
        gravado = (self.pasta / "normalizado.jsonl").read_text(encoding="utf-8") + (self.pasta / "candidatas.csv").read_text(encoding="utf-8-sig")
        for segredo in (CHAVE_SK, CPF, "senha: abc"):
            self.assertNotIn(segredo, gravado)
        self.assertEqual((r["segredos_removidos"]["chave_api"], r["segredos_removidos"]["cpf"], r["segredos_removidos"]["senha"]), (1, 1, 1))

    def test_relatorio(self):
        self.montar()
        r = importar.executar()
        self.assertEqual((r["total"], r["sim"], r["nao"]), (6, 4, 2))
        self.assertEqual({o: d["conversas"] for o, d in r["por_origem"].items()}, {"claude": 5, "chatgpt": 1})
        self.assertEqual(r["por_origem"]["chatgpt"]["sim"], 1)
        soma = sum(int(l["tokens_estimados"]) for l in self.csv() if l["importar"] == "SIM")
        self.assertEqual(r["tokens_entrada"], soma)
        self.assertEqual((r["tokens_saida"], r["tokens_saida_por_resumo"]), (4 * 200, 200))
        self.assertNotIn("custo_usd_estimado", r)  # nenhum preço inventado
        self.assertEqual(importar.executar(preco_entrada=3.0, preco_saida=15.0)["custo_usd_estimado"], round(soma / 1e6 * 3 + 800 / 1e6 * 15, 4))
        texto = "\n".join(importar.texto_relatorio(r))
        self.assertIn("claude: 5 conversas, 3 marcadas SIM", texto)
        self.assertIn("Marcadas SIM: 4 de 6", texto)

    def test_rodar_de_novo_mantem_a_sua_revisao(self):
        self.montar()
        importar.executar()
        linhas = self.csv()
        with open(self.pasta / "candidatas.csv", "w", encoding="utf-8-sig", newline="") as f:  # você mexeu no Excel
            w = csv.DictWriter(f, importar.COLUNAS, delimiter=";")
            w.writeheader()
            for l in linhas:
                l["importar"] = {"claude:papo": "SIM", "claude:tec": "NÃO"}.get(l["id"], l["importar"])
                w.writerow(l)
        r = importar.executar()
        por_id = {l["id"]: l["importar"] for l in self.csv()}
        self.assertEqual((por_id["claude:papo"], por_id["claude:tec"]), ("SIM", "NAO"))
        self.assertEqual(r["revisao_mantida"], 6)
        importar.executar(forcar=True)
        self.assertEqual({l["id"]: l["importar"] for l in self.csv()}["claude:papo"], "NAO")

    def test_titulo_nao_vira_formula_no_excel(self):
        self.escrever("conversations.json", [claude_conv("f", "=SOMA(A1)\nlinha2", LONGA)])
        importar.executar()
        self.assertEqual(self.csv()[0]["titulo"], " =SOMA(A1) linha2")

    def test_pasta_vazia_e_inexistente(self):
        r = importar.executar()
        self.assertEqual((r["total"], r["sim"]), (0, 0))
        self.assertIn("Nenhuma conversa encontrada", "\n".join(importar.texto_relatorio(r)))
        with self.assertRaises(ValueError):
            importar.executar(self.raiz / "nao-existe")


class TestInspecaoECLI(Base):
    def test_inspecionar_mostra_estrutura_e_nunca_o_texto(self):
        self.escrever("conversations.json", [claude_conv("u1", "TITULO SECRETO", [("human", "CONTEUDO PRIVADO"), ("assistant", "RESPOSTA PRIVADA")])])
        self.escrever("chat/conversations.json", [chatgpt_conv("c1", "OUTRO TITULO", [("user", "TEXTO PRIVADO"), ("assistant", "x")])])
        saida = "\n".join(importar.inspecionar())
        for privado in ("SECRETO", "PRIVAD", "OUTRO TITULO"):
            self.assertNotIn(privado, saida)
        self.assertIn("formato: claude", saida)
        self.assertIn("formato: chatgpt", saida)
        self.assertIn("chat_messages: lista[2] de {", saida)
        self.assertIn("sender: str(5)", saida)
        self.assertIn("created_at: data '9999-99-99T99:99:99.999999Z'", saida)
        self.assertIn("current_node", saida)

    def test_cli_e_sem_rede(self):
        self.escrever("conversations.json", [claude_conv("u1", "Deploy", LONGA)])
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            self.assertEqual(importar.main(["rodar", "--json"]), 0)
        self.assertEqual(json.loads(saida.getvalue())["total"], 1)
        fonte = Path(importar.__file__).read_text(encoding="utf-8")
        self.assertFalse(re.search(r"^\s*(import|from)\s+(urllib|http|socket|ssl|requests|anthropic|openai)", fonte, re.M), "nenhuma rede")
        with mock.patch.object(importar.subprocess, "run", side_effect=AssertionError("a etapa 1 não pode chamar processo (nem a IA)")), \
                mock.patch.object(importar.subprocess, "Popen", side_effect=AssertionError("idem")):
            importar.executar()
            importar.inspecionar()

    def test_pasta_inexistente_na_cli(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(importar.main(["rodar", "--pasta", str(self.raiz / "nada")]), 2)


# ======================= ETAPA 2: resumir =======================

def resposta(titulo="decisões do código de colisão", palavras="a1, b2, c3, d4, e5", projeto="jogo-de-corrida", corpo="- decisão tomada\n- falta testar"):
    return f"titulo: {titulo}\npalavras-chave: {palavras}\nprojeto: {projeto}\n\n{corpo}"


class IAFalsa:
    """Stand-in do claude: guarda as mensagens e devolve respostas prontas (uma lista, ou a boa por padrão)."""
    def __init__(self, respostas=None, erro_na=None):
        self.mensagens, self.respostas, self.erro_na = [], list(respostas or []), erro_na

    def __call__(self, sistema, mensagem):
        self.mensagens.append(mensagem)
        n = len(self.mensagens)
        if self.erro_na and n == self.erro_na[0]:
            raise self.erro_na[1]
        texto = self.respostas.pop(0) if self.respostas else resposta()
        return {"texto": texto, "entrada": 1000, "saida": 150, "custo_usd": 0.001, "medido": True}


class BaseResumir(Base):
    def setUp(self):
        super().setUp()
        self.cerebro = self.raiz / "cerebro"
        for d in ("conversas", "estado"):
            (self.cerebro / d).mkdir(parents=True)
        env = mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.cerebro)})
        env.start()
        self.addCleanup(env.stop)
        self.saidas = []

    def preparar(self, n_claude=5, n_chatgpt=2):
        convs = [claude_conv(f"c{i}", f"Conversa {i}", LONGA, criada=f"2024-0{i + 1}-1{i}T10:00:00Z") for i in range(n_claude)]
        self.escrever("conversations.json", convs)
        if n_chatgpt:
            gp = [chatgpt_conv(f"g{i}", f"Chat {i}", [("user", "erro no código"), ("assistant", "veja"), ("user", "e agora?"), ("assistant", "ok")],
                               criada=1700000000 + i * 86400 * 40) for i in range(n_chatgpt)]
            self.escrever("chat/conversations.json", gp)
        self.assertEqual(importar.executar()["sim"], n_claude + n_chatgpt)

    def resumir(self, **kw):
        kw.setdefault("sim", True)
        kw.setdefault("saida", self.saidas.append)
        return importar.resumir(**kw)

    def progresso(self):
        return json.loads((self.pasta / "progresso.json").read_text(encoding="utf-8"))

    def arquivos(self):
        return sorted(p.name for p in (self.cerebro / "conversas").glob("*.md"))


class TestReduzir(unittest.TestCase):
    def msgs(self, n, tam=800):
        return "\n\n".join(f"{'EU' if i % 2 == 0 else 'IA'}: mensagem {i} " + "x" * tam for i in range(n))

    def test_conversa_pequena_passa_inteira(self):
        t = self.msgs(10)
        self.assertEqual(importar.reduzir_conversa(t), (t, 0))

    def test_gigante_mantem_pontas_e_mensagens_com_codigo_erro_ou_decisao_sem_passar_do_limite(self):
        partes = [f"{'EU' if i % 2 == 0 else 'IA'}: mensagem {i} " + "x" * 800 for i in range(300)]
        partes[150] = "IA: mensagem 150 veja o código:\n```python\nprint(1)\n```"
        partes[200] = "EU: mensagem 200 deu Traceback (most recent call last)"
        partes[90] = "IA: mensagem 90 então decidimos usar SQLite"
        texto = "\n\n".join(partes)
        self.assertGreater(len(texto), 200000)
        r, omitidas = importar.reduzir_conversa(texto, 60000)
        self.assertLessEqual(len(r), 60000)
        self.assertTrue(r.startswith("EU: mensagem 0 "))
        self.assertTrue(r.rstrip().endswith("x" * 50) and "mensagem 299 " in r)
        for marca in ("mensagem 150 veja o código", "mensagem 200 deu Traceback", "mensagem 90 então decidimos", "mensagem 2 ", "mensagem 295 "):
            self.assertIn(marca, r)
        self.assertRegex(r, r"\[\.\.\. \d+ mensagens omitidas \.\.\.\]")
        self.assertGreater(omitidas, 100)

    def test_nunca_passa_do_limite_nem_com_uma_mensagem_enorme_ou_limite_pequeno(self):
        r, _ = importar.reduzir_conversa("EU: " + "a" * 500000, 60000)
        self.assertLessEqual(len(r), 60000)
        r, _ = importar.reduzir_conversa(self.msgs(60), 3000)
        self.assertLessEqual(len(r), 3000)
        r, _ = importar.reduzir_conversa(self.msgs(60), 100)
        self.assertLessEqual(len(r), 100)


class TestParsear(unittest.TestCase):
    def test_formato_certo(self):
        r = importar.parsear_resposta(resposta(), ["jogo-de-corrida"])
        self.assertEqual((r["titulo"], r["palavras"], r["projeto"]), ("decisões do código de colisão", "a1, b2, c3, d4, e5", "jogo-de-corrida"))
        self.assertEqual(r["corpo"], "- decisão tomada\n- falta testar")

    def test_tolera_cerca_de_codigo_negrito_e_maiusculas(self):
        r = importar.parsear_resposta("```\n**Título:** Plano do deploy novo\nPalavras-chave: a, b, c\nPROJETO: Site\n\n- x\n```", ["site"])
        self.assertEqual((r["titulo"], r["projeto"], r["corpo"]), ("Plano do deploy novo", "site", "- x"))

    def test_projeto_desconhecido_vira_geral_e_falta_de_linha_e_erro_claro(self):
        self.assertEqual(importar.parsear_resposta(resposta(projeto="invencionado"), ["site"])["projeto"], "geral")
        with self.assertRaises(ValueError) as e:
            importar.parsear_resposta("Aqui está o resumo:\n- x")
        self.assertIn("titulo:, palavras-chave:, projeto:", str(e.exception))
        with self.assertRaises(ValueError):
            importar.parsear_resposta("titulo: a b c\nprojeto: geral\n- x")  # sem palavras-chave


class TestResumir(BaseResumir):
    def test_amostra_de_3_espalhadas_com_data_e_origem_originais(self):
        self.preparar()  # 7 conversas SIM
        ia = IAFalsa()
        r = self.resumir(simular=True, chamar=ia)
        self.assertEqual((len(ia.mensagens), r["criados"], r["validacao"], r["parou"]), (3, 3, [], None))
        arqs = self.arquivos()
        self.assertEqual(len(arqs), 3)
        textos = {a: (self.cerebro / "conversas" / a).read_text(encoding="utf-8") for a in arqs}
        for a, t in textos.items():
            self.assertTrue(a.startswith(re.search(r"data: (\S+)", t).group(1) + "_"))  # nome = data ORIGINAL, não a de hoje
        self.assertEqual(sorted(a[:10] for a in arqs), ["2023-11-14", "2024-02-11", "2024-05-14"])  # posições 0, 3 e 6 da lista (chatgpt g0, claude c1, claude c4)
        self.assertEqual(sorted(re.search(r"origem: (\S+)", t).group(1) for t in textos.values()), ["chatgpt", "claude", "claude"])
        self.assertTrue(all(re.search(r"projeto: jogo-de-corrida", t) for t in textos.values()))
        self.assertTrue(all("Data original: " in m and "CONVERSA" in m for m in ia.mensagens))
        prog = self.progresso()
        self.assertEqual((len(prog["concluidos"]), len(prog["amostra"]), prog["tokens"]["entrada"], prog["tokens"]["saida"]), (3, 3, 3000, 450))
        self.assertIn(arqs[0], (self.cerebro / "INDICE.md").read_text(encoding="utf-8"))
        texto = "\n".join(self.saidas)
        self.assertIn("a processar: 7", texto)
        self.assertIn("Amostra: 3 conversas", texto)

    def test_datas_dos_nomes_batem_com_as_conversas_sorteadas(self):
        self.preparar(n_claude=3, n_chatgpt=0)
        ia = IAFalsa()
        self.resumir(lote=10, chamar=ia)
        self.assertEqual(sorted(a[:10] for a in self.arquivos()), ["2024-01-10", "2024-02-11", "2024-03-12"])

    def test_so_as_marcadas_sim_sao_enviadas(self):
        self.preparar(n_claude=4, n_chatgpt=0)
        linhas = self.csv()
        with open(self.pasta / "candidatas.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, importar.COLUNAS, delimiter=";")
            w.writeheader()
            for i, l in enumerate(linhas):
                l["importar"] = "SIM" if i < 2 else "NAO"
                w.writerow(l)
        ia = IAFalsa()
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((len(ia.mensagens), r["criados"]), (2, 2))

    def test_lotes_pedem_confirmacao_e_retomam_de_onde_parou(self):
        self.preparar()
        perguntas, respostas = [], iter([True, True, True, False])  # aviso de amostra, lote 1, lote 2, lote 3 = não
        ia = IAFalsa()
        r = self.resumir(lote=2, sim=False, chamar=ia, perguntar=lambda t: (perguntas.append(t), next(respostas))[1])
        self.assertEqual((r["criados"], r["restantes"], len(ia.mensagens)), (4, 3, 4))
        self.assertIn("amostra", perguntas[0])
        self.assertTrue(perguntas[1].startswith("Lote 1: 2 conversas") and perguntas[2].startswith("Lote 2: 2 conversas") and perguntas[3].startswith("Lote 3: 2 conversas"))
        feitos = set(self.progresso()["concluidos"])
        self.assertEqual(len(feitos), 4)
        r2 = self.resumir(lote=10, chamar=ia)  # outro dia, outro comando: continua
        self.assertEqual((r2["criados"], len(ia.mensagens), r2["restantes"]), (3, 7, 0))
        self.assertEqual(len(self.progresso()["concluidos"]), 7)
        self.assertEqual(len(self.arquivos()), 7)

    def test_limite_de_uso_para_salva_o_progresso_e_nao_tenta_de_novo(self):
        self.preparar()
        ia = IAFalsa(erro_na=(3, importar.ParouTudo("limite", "5-hour limit reached ∙ resets 3pm")))
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], len(ia.mensagens), r["parou"]["tipo"]), (2, 3, "limite"))  # a 3ª chamada foi a última
        prog = self.progresso()
        self.assertEqual((len(prog["concluidos"]), prog["falhas"], prog["parou"]["tipo"]), (2, {}, "limite"))  # a conversa do limite NÃO vira falha
        texto = "\n".join(importar.texto_relatorio_resumir(r))
        self.assertIn("PAREI", texto)
        self.assertIn("limite de uso", texto)
        self.assertIn("rode o mesmo comando", texto)
        ia2 = IAFalsa()
        r2 = self.resumir(lote=10, chamar=ia2)
        self.assertEqual((r2["criados"], len(ia2.mensagens), r2["parou"], self.progresso()["parou"]), (5, 5, None, None))
        self.assertEqual(len(self.arquivos()), 7)

    def test_interrupcao_com_ctrl_c_salva_e_continua(self):
        self.preparar(n_claude=4, n_chatgpt=0)
        ia = IAFalsa(erro_na=(3, KeyboardInterrupt()))
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], r["parou"]["tipo"]), (2, "interrompido"))
        self.assertEqual(len(self.progresso()["concluidos"]), 2)
        self.assertEqual(self.resumir(lote=10, chamar=IAFalsa())["criados"], 2)

    def test_formato_invalido_ganha_uma_nova_tentativa_pedindo_a_correcao(self):
        self.preparar(n_claude=1, n_chatgpt=0)
        ia = IAFalsa([resposta(titulo="só dois"), resposta()])
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], len(ia.mensagens), r["falhas"]), (1, 2, {}))
        self.assertIn("RECUSADA", ia.mensagens[1])
        self.assertIn("título com 2 palavras", ia.mensagens[1])
        self.assertIn("titulo: só dois", ia.mensagens[1])      # a correção leva a resposta anterior, não a conversa inteira
        self.assertNotIn("=== CONVERSA", ia.mensagens[1])
        self.assertEqual(r["tokens"]["entrada"], 2000)           # as duas chamadas foram contadas

    def test_falhando_de_novo_marca_falha_e_nao_grava_nada(self):
        self.preparar(n_claude=2, n_chatgpt=0)
        ia = IAFalsa([resposta(titulo="só dois"), resposta(titulo="ainda dois"), resposta(), ])
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], len(r["falhas"]), len(ia.mensagens), len(self.arquivos())), (1, 1, 3, 1))
        falha = next(iter(self.progresso()["falhas"].values()))
        self.assertIn("formato recusado depois da correção", falha["motivo"])
        self.assertEqual(self.resumir(lote=10, chamar=IAFalsa())["criados"], 0)                    # falha não é refeita sozinha
        self.assertEqual(self.resumir(lote=10, chamar=IAFalsa(), refazer_falhas=True)["criados"], 1)  # só com --refazer-falhas
        self.assertEqual(self.progresso()["falhas"], {})

    def test_email_na_resposta_e_recusado_pelo_salvar(self):
        self.preparar(n_claude=1, n_chatgpt=0)
        ia = IAFalsa([resposta(corpo="- falar com fulano@exemplo.com"), resposta()])
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], len(ia.mensagens)), (1, 2))
        self.assertIn("e-mail", ia.mensagens[1])

    def test_tres_falhas_seguidas_param_tudo(self):
        self.preparar()
        ia = IAFalsa([resposta(titulo="um")] * 20)
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], r["parou"]["tipo"], len(ia.mensagens)), (0, "falhas", 6))  # 3 conversas x 2 tentativas
        self.assertEqual(len(self.progresso()["falhas"]), 3)

    def test_sem_data_original_falha_sem_gastar_nada(self):
        self.preparar(n_claude=2, n_chatgpt=0)
        arq = self.pasta / "normalizado.jsonl"
        linhas = [json.loads(l) for l in arq.read_text(encoding="utf-8").splitlines()]
        linhas[0]["data_criacao"] = ""
        arq.write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in linhas), encoding="utf-8")
        ia = IAFalsa()
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual((r["criados"], len(r["falhas"]), len(ia.mensagens)), (1, 1, 1))
        self.assertIn("sem data original", next(iter(r["falhas"].values()))["motivo"])

    def test_conversa_gigante_e_reduzida_antes_de_enviar(self):
        self.escrever("conversations.json", [claude_conv("g", "Gigante", [("human", f"erro número {i} " + "y" * 900) if i % 2 == 0 else ("assistant", "ok " + "z" * 900) for i in range(200)])])
        importar.executar()
        ia = IAFalsa()
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual(r["criados"], 1)
        self.assertLess(len(ia.mensagens[0]), 60000 + 1500)
        self.assertIn("mensagens omitidas", ia.mensagens[0])
        self.assertIn("mensagens omitidas", "\n".join(self.saidas))

    def test_simular_recusado_nao_envia_nada_e_descartar_amostra_apaga_so_a_amostra(self):
        self.preparar()
        manual = self.cerebro / "conversas" / "2023-01-01_nota-feita-a-mao.md"
        manual.write_text("palavras-chave: a1, b2, c3\ndata: 2023-01-01 | origem: claude | projeto: geral\n\n- minha nota\n", encoding="utf-8")
        ia = IAFalsa()
        r = self.resumir(simular=True, sim=False, chamar=ia, perguntar=lambda t: False)
        self.assertEqual((len(ia.mensagens), r["criados"]), (0, 0))
        self.assertFalse((self.pasta / "progresso.json").exists())
        self.resumir(simular=True, chamar=ia)
        self.assertEqual(len(self.arquivos()), 4)
        self.resumir(simular=True, chamar=ia)  # já tem amostra: não gasta de novo
        self.assertEqual(len(ia.mensagens), 3)
        da_amostra = [a for a in self.arquivos() if a != manual.name]
        self.assertEqual(importar.descartar_amostra(self.pasta, sim=True, saida=self.saidas.append), 3)
        self.assertEqual(self.arquivos(), [manual.name])        # a nota feita à mão continua lá
        self.assertEqual(self.progresso()["concluidos"], {})
        indice = (self.cerebro / "INDICE.md").read_text(encoding="utf-8")
        self.assertTrue(all(a not in indice for a in da_amostra) and manual.name in indice)

    def test_lote_sem_amostra_previa_pergunta_antes(self):
        self.preparar(n_claude=2, n_chatgpt=0)
        ia = IAFalsa()
        r = self.resumir(lote=10, sim=False, chamar=ia, perguntar=lambda t: False)
        self.assertEqual((len(ia.mensagens), r["criados"]), (0, 0))
        self.assertIn("importar.py resumir --simular", "\n".join(self.saidas))

    def test_precisa_do_normalizado_e_do_terminal(self):
        with self.assertRaises(ValueError):
            self.resumir(simular=True, chamar=IAFalsa())
        with mock.patch("sys.stdin", io.StringIO("s\n")), self.assertRaises(ValueError) as e:
            importar._perguntar_terminal("ok?")
        self.assertIn("--sim", str(e.exception))

    def test_relatorio_final_com_top_projetos_e_tokens(self):
        self.preparar()
        ia = IAFalsa([resposta(projeto="jogo-de-corrida")] * 4 + [resposta(projeto="site")] * 2 + [resposta(projeto="invencionado")])
        r = self.resumir(lote=10, chamar=ia)
        self.assertEqual(dict(r["top_projetos"]), {"jogo-de-corrida": 4, "site": 2, "geral": 1})
        self.assertEqual(r["top_projetos"][0], ("jogo-de-corrida", 4))
        texto = "\n".join(importar.texto_relatorio_resumir(r))
        for trecho in ("Resumos criados nesta execução: 7", "Tokens gastos (aprox.): 7.000 de entrada (com cache) e 1.050 de saída; medidos pelo Claude Code",
                       "Validação do cérebro: sem problemas.", "Índice do cérebro atualizado", "jogo-de-corrida (4)", "site (2)"):
            self.assertIn(trecho, texto)


class TestChamarClaude(Base):
    """Com um claude FALSO de verdade (um .cmd que chama um script Python): confere argumentos, ambiente, entrada e erros."""
    def setUp(self):
        super().setUp()
        self.falso = self.raiz / "falso"
        self.falso.mkdir()
        (self.falso / "fake_claude.py").write_text(FAKE_CLAUDE, encoding="utf-8")
        (self.falso / "claude.cmd").write_text(f'@"{sys.executable}" "%~dp0fake_claude.py" %*\r\n', encoding="utf-8")
        self.saida = self.raiz / "saida-falso"
        env = mock.patch.dict(os.environ, {"FAKE_OUT": str(self.saida), "IMPORTAR_CLAUDE": str(self.falso / "claude.cmd")})
        env.start()
        self.addCleanup(env.stop)

    def chamar(self, modo="ok", **kw):
        with mock.patch.dict(os.environ, {"FAKE_MODO": modo}):
            return importar.chamar_claude("SISTEMA do resumo", "A CONVERSA aqui", **kw)

    def lido(self, ext):
        return (self.raiz / f"saida-falso.{ext}").read_text(encoding="utf-8")

    def test_comando_ambiente_entrada_e_tokens_medidos(self):
        pasta_vazia = self.raiz / "vazia"
        pasta_vazia.mkdir()
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-" + "falsa" * 6, "CLAUDECODE": "1", "CLAUDE_CODE_GIT_BASH_PATH": "C:/bash.exe"}):
            r = self.chamar(modelo="sonnet", cwd=str(pasta_vazia), extras=["--effort", "low"])
        argv = json.loads(self.lido("argv"))
        self.assertEqual(argv[:6], ["-p", "--model", "sonnet", "--output-format", "json", "--tools"])
        self.assertEqual(argv[6], "")                                   # --tools "" = nenhuma ferramenta
        for flag in ("--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config"):
            self.assertIn(flag, argv)
        self.assertNotIn("--bare", argv)
        self.assertEqual(argv[-2:], ["--effort", "low"])
        entrada = self.lido("stdin")
        self.assertTrue(entrada.startswith("SISTEMA do resumo") and entrada.endswith("A CONVERSA aqui"))  # .cmd: o prompt vai junto da entrada
        env = json.loads(self.lido("env"))
        self.assertEqual((env["chave"], env["sessao"], env["bash"]), (False, False, True))   # sem a chave de API, sem marca de sessão, o resto fica
        self.assertTrue(env["cwd"].lower().endswith("vazia"))
        self.assertEqual((r["entrada"], r["saida"], r["medido"], r["custo_usd"]), (100 + 20 + 30, 40, True, 0.0123))
        self.assertTrue(r["texto"].startswith("titulo:"))

    def test_usar_chave_api_deixa_a_variavel_passar(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-" + "falsa" * 6}):
            self.chamar(usar_chave=True)
        self.assertTrue(json.loads(self.lido("env"))["chave"])

    def test_system_prompt_por_argumento_so_com_exe(self):
        cmd = importar.montar_comando("C:/x/claude.exe", "haiku", "linha1\nlinha2 \"aspas\"", True)
        self.assertEqual(cmd[cmd.index("--system-prompt") + 1], "linha1\nlinha2 \"aspas\"")
        self.assertNotIn("--system-prompt", importar.montar_comando("C:/x/claude.cmd", "haiku", "x", False))

    def test_erros_limite_login_e_falha_da_conversa(self):
        for modo, tipo in (("limite", "limite"), ("limite_stderr", "limite"), ("login", "login")):
            with self.assertRaises(importar.ParouTudo, msg=modo) as e:
                self.chamar(modo)
            self.assertEqual(e.exception.tipo, tipo, modo)
        with self.assertRaises(importar.FalhaConversa):
            self.chamar("erro_qualquer")
        with self.assertRaises(importar.FalhaConversa) as e:
            self.chamar("dormir", timeout=1)
        self.assertIn("tempo esgotado", str(e.exception))

    def test_resposta_com_a_palavra_limite_nao_e_erro(self):
        r = self.chamar("fala_de_limite")  # o resumo pode falar de "usage limit": só a mensagem de ERRO é classificada
        self.assertIn("usage limit", r["texto"])

    def test_saida_sem_json_usa_estimativa(self):
        r = self.chamar("texto_puro")
        self.assertEqual((r["texto"].startswith("titulo:"), r["medido"]), (True, False))
        self.assertGreater(r["entrada"], 0)

    def test_sem_claude(self):
        with mock.patch.dict(os.environ, {"IMPORTAR_CLAUDE": str(self.raiz / "nao-existe.exe")}), self.assertRaises(importar.ParouTudo) as e:
            self.chamar()
        self.assertEqual(e.exception.tipo, "sem_claude")

    def test_classificar_erro(self):
        for t in ("Claude AI usage limit reached|1760000000", "You've hit your limit · resets 3pm", "429 Too Many Requests", "Credit balance is too low"):
            self.assertEqual(importar.classificar_erro(t), "limite", t)
        for t in ("Not logged in · Please run /login", "Invalid API key", "401 Unauthorized"):
            self.assertEqual(importar.classificar_erro(t), "login", t)
        self.assertIsNone(importar.classificar_erro("falha qualquer"))

    def test_cli_de_ponta_a_ponta_com_o_processo_falso(self):
        cer = self.raiz / "cerebro"
        for d in ("conversas", "estado"):
            (cer / d).mkdir(parents=True)
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(cer)}):
            self.escrever("conversations.json", [claude_conv(f"c{i}", f"Conversa {i}", LONGA, criada=f"2024-0{i + 1}-1{i}T10:00:00Z") for i in range(4)])
            importar.executar()
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(importar.main(["resumir"]), 2)                      # sem --simular nem --lote: não faz nada
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                self.assertEqual(importar.main(["resumir", "--simular", "--sim"]), 0)
            self.assertEqual(len(list((cer / "conversas").glob("*.md"))), 3)
            self.assertIn("Resumos criados nesta execução: 3", saida.getvalue())
            with mock.patch.dict(os.environ, {"FAKE_MODO": "limite"}), contextlib.redirect_stdout(io.StringIO()) as s2:
                self.assertEqual(importar.main(["resumir", "--lote", "5", "--sim"]), 3)    # limite: código 3, sem insistir
            self.assertIn("PAREI", s2.getvalue())
            self.assertEqual(json.loads((self.pasta / "progresso.json").read_text(encoding="utf-8"))["parou"]["tipo"], "limite")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(importar.main(["resumir", "--lote", "5", "--sim", "--modelo", "x y"]), 2)


FAKE_CLAUDE = r'''
import json, os, sys, time
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
base = os.environ["FAKE_OUT"]
entrada = sys.stdin.buffer.read().decode("utf-8")
open(base + ".argv", "w", encoding="utf-8").write(json.dumps(sys.argv[1:]))
open(base + ".stdin", "w", encoding="utf-8").write(entrada)
open(base + ".env", "w", encoding="utf-8").write(json.dumps({"chave": "ANTHROPIC_API_KEY" in os.environ, "sessao": "CLAUDECODE" in os.environ,
                                                              "bash": "CLAUDE_CODE_GIT_BASH_PATH" in os.environ, "cwd": os.getcwd()}))
modo = os.environ.get("FAKE_MODO", "ok")
BOA = "titulo: decisões do código de colisão\npalavras-chave: a1, b2, c3, d4, e5\nprojeto: geral\n\n- decisão tomada\n- falta testar"
def json_ok(texto):
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": texto, "total_cost_usd": 0.0123,
                      "usage": {"input_tokens": 100, "cache_creation_input_tokens": 20, "cache_read_input_tokens": 30, "output_tokens": 40}}))
if modo == "limite":
    print(json.dumps({"type": "result", "is_error": True, "result": "Claude AI usage limit reached|1760000000"})); sys.exit(1)
if modo == "limite_stderr":
    sys.stderr.write("5-hour limit reached ∙ resets 3pm"); sys.exit(1)
if modo == "login":
    print(json.dumps({"type": "result", "is_error": True, "result": "Not logged in · Please run /login"})); sys.exit(1)
if modo == "erro_qualquer":
    sys.stderr.write("algo quebrou"); sys.exit(1)
if modo == "dormir":
    time.sleep(4)
if modo == "texto_puro":
    print(BOA); sys.exit(0)
if modo == "fala_de_limite":
    json_ok(BOA.replace("- falta testar", "- tratar o usage limit da API")); sys.exit(0)
json_ok(BOA)
'''


if __name__ == "__main__":
    unittest.main()
