# -*- coding: utf-8 -*-
"""Testes do tokens.py (pastas temporárias e um servidor HTTP falso no lugar da API).
Rodar: python cerebro/tools/test_tokens.py"""
import contextlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tokens  # noqa: E402
import skills  # noqa: E402  (o tokens.py já pôs skills-biblioteca no caminho)
import projetos  # noqa: E402


def skill_md(nome, descricao="Use para testar.", corpo="# Corpo\npasso um\n"):
    return f'---\nname: {nome}\ndescription: "{descricao}"\n---\n\n{corpo}'


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)
        self.home = self.raiz / "home" / ".claude"
        self.global_skills = self.home / "skills"
        self.cerebro = self.raiz / "cerebro"
        (self.cerebro / "conversas").mkdir(parents=True)
        (self.cerebro / "estado").mkdir()
        (self.cerebro / ".log").mkdir()
        self.projeto = self.raiz / "meu jogo"
        self.projeto.mkdir()
        self.cfg = self.raiz / "cerebro.json"
        self.cfg.write_text(json.dumps({"cerebro_dir": str(self.cerebro)}), encoding="utf-8")
        self.bib = self.raiz / "biblioteca"
        self.gemini = self.raiz / "home" / ".gemini"
        env = mock.patch.dict(os.environ, {"SKILLS_GLOBAL_CLAUDE": str(self.global_skills), "CEREBRO_CONFIG": str(self.cfg),
                                           "SKILLS_GLOBAL_ANTIGRAVITY": str(self.gemini / "antigravity-cli" / "skills"),
                                           "PROJETOS_JSON": str(self.raiz / "projetos.json"), "CEREBRO_DIR": str(self.cerebro)})
        env.start()
        self.addCleanup(env.stop)
        projetos.adicionar({"nome": "Jogo", "id": "jogo", "pasta": str(self.projeto)}, base=self.cerebro)

    def skill(self, raiz, nome, **kw):
        (raiz / nome).mkdir(parents=True)
        (raiz / nome / "SKILL.md").write_text(skill_md(nome, **kw), encoding="utf-8")
        return raiz / nome


class TestEstimativa(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ, {"CEREBRO_CONFIG": str(Path(tempfile.gettempdir()) / "nao-existe-cerebro.json")})
        env.start()
        self.addCleanup(env.stop)

    def test_caracteres_por_4_para_cima(self):
        self.assertEqual(tokens.estimar_tokens(""), 0)
        self.assertEqual(tokens.estimar_tokens("a" * 400), 100)
        self.assertEqual(tokens.estimar_tokens("a" * 401), 101)
        self.assertEqual(tokens.estimar_tokens("abc"), 1)
        self.assertEqual(tokens.estimar_tokens("a\r\n" * 100), tokens.estimar_tokens("a\n" * 100))  # CRLF = LF

    def test_portugues_com_acentos_ganha_fator_1_1(self):
        self.assertEqual(tokens.estimar_tokens("ação" + "a" * 396), 110)  # 400 caracteres
        self.assertEqual(tokens.estimar_tokens("acao" + "a" * 396), 100)  # sem acento: nada
        self.assertEqual(tokens.estimar_tokens("seta → e — travessao " + "a" * 378), 100)  # símbolos não contam como acento

    def test_fator_calibrado_vale_no_lugar_da_regra(self):
        with mock.patch.dict(os.environ, {"CEREBRO_CONFIG": str(self.escrever_config({"tokens_fator": 1.5}))}):
            self.assertEqual(tokens.estimar_tokens("a" * 400), 150)
            self.assertEqual(tokens.estimar_tokens("ação" + "a" * 396), 150)
        with mock.patch.dict(os.environ, {"CEREBRO_CONFIG": str(self.escrever_config({"tokens_fator": "texto"}))}):
            self.assertEqual(tokens.estimar_tokens("a" * 400), 100)  # valor inválido é ignorado

    def escrever_config(self, dados):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        caminho = Path(tmp.name) / "c.json"
        caminho.write_text(json.dumps(dados), encoding="utf-8")
        return caminho


class TestCustoSkill(Base):
    def test_fixo_so_do_cabecalho_ao_usar_so_do_corpo(self):
        corpo = "linha de corpo\n" * 100
        pasta = self.skill(self.bib, "minha", descricao="Use quando precisar.", corpo=corpo)
        c = tokens.custo_skill(pasta)
        self.assertEqual(c["fixo"], tokens.estimar_tokens("minha: Use quando precisar."))
        self.assertEqual(c["ao_usar"], tokens.estimar_tokens(corpo.strip()))
        self.assertEqual((c["extras"], c["saida_ferramenta"], c["total_estimado_por_uso"]), (0, 0, c["ao_usar"]))
        # aumentar o corpo não mexe no fixo
        (pasta / "SKILL.md").write_text(skill_md("minha", "Use quando precisar.", corpo * 5), encoding="utf-8")
        c2 = tokens.custo_skill(pasta)
        self.assertEqual(c2["fixo"], c["fixo"])
        self.assertGreater(c2["ao_usar"], c["ao_usar"] * 4)

    def test_fixo_nao_depende_de_ler_o_corpo(self):
        pasta = self.skill(self.bib, "grande", corpo="x " * 50000)
        original = tokens._cabecalho_e_corpo
        lido = []
        def espia(caminho):
            campos, corpo = original(caminho)
            lido.append(len(corpo))
            return campos, corpo
        with mock.patch.object(tokens, "_cabecalho_e_corpo", espia):
            tokens.custo_skill(pasta)
        self.assertEqual(len(lido), 1)  # um único acesso ao arquivo
        # e o cabeçalho é lido linha a linha: sem description usa a 1a linha do conteúdo
        (pasta / "SKILL.md").write_text("---\nname: grande\n---\n\nPrimeira linha vale.\nresto\n", encoding="utf-8")
        self.assertEqual(tokens.custo_skill(pasta)["fixo"], tokens.estimar_tokens("grande: Primeira linha vale."))

    def test_extras_do_manifesto_e_da_copia_instalada(self):
        pasta = self.skill(self.bib, "com-extra")
        (pasta / "scripts").mkdir()
        (pasta / "scripts" / "a.py").write_text("print('x')\n" * 40, encoding="utf-8")
        (pasta / "binario.bin").write_bytes(b"\xff\xfe\x00\x01" * 100)
        (pasta / "skill.json").write_text(json.dumps({"arquivos_extras": ["scripts/a.py", "../fora.txt"]}), encoding="utf-8")
        c = tokens.custo_skill(pasta)
        self.assertEqual(c["arquivos_extras"], ["scripts/a.py"])  # caminho que sai da pasta é ignorado
        self.assertEqual(c["extras"], tokens.estimar_tokens("print('x')\n" * 40))
        self.assertEqual(c["total_estimado_por_uso"], c["ao_usar"] + c["extras"])
        # cópia instalada (sem skill.json): tudo além do SKILL.md e da marca; o binário não conta
        (pasta / "skill.json").unlink()
        (pasta / ".instalado.json").write_text("{}", encoding="utf-8")
        c2 = tokens.custo_skill(pasta)
        self.assertEqual(sorted(c2["arquivos_extras"]), ["binario.bin", "scripts/a.py"])
        self.assertEqual(c2["extras"], c["extras"])

    def test_saida_de_ferramenta_media_real_ou_padrao(self):
        pasta = self.skill(self.bib, "cerebro-ler")
        sem = tokens.custo_skill(pasta, base=self.cerebro)
        self.assertEqual((sem["saida_ferramenta"], sem["saida_fonte"]), (tokens.SAIDA_PADRAO["ler"], "padrão"))
        linhas = [{"comando": "ler", "caracteres": 800}, {"comando": "ler", "caracteres": 1200}, {"comando": "titulos", "caracteres": 99999},
                  {"comando": "ler", "caracteres": "lixo"}]
        (self.cerebro / ".log" / "consultas.jsonl").write_text("\n".join(json.dumps(l) for l in linhas) + "\nnão é json\n", encoding="utf-8")
        com = tokens.custo_skill(pasta, base=self.cerebro)
        self.assertEqual(com["saida_ferramenta"], tokens.tokens_de_caracteres(1000))  # média de 800 e 1200
        self.assertEqual(com["saida_fonte"], "medido (2 consultas)")
        self.assertEqual(com["total_estimado_por_uso"], com["ao_usar"] + com["saida_ferramenta"])
        # skill que não é do cérebro não tem saída de ferramenta
        self.assertEqual(tokens.custo_skill(self.skill(self.bib, "outra"), base=self.cerebro)["saida_ferramenta"], 0)
        # buscar = buscar + ler
        buscar = self.skill(self.bib, "cerebro-buscar")
        (self.cerebro / ".log" / "consultas.jsonl").write_text(json.dumps({"comando": "buscar", "caracteres": 400}) + "\n", encoding="utf-8")
        c = tokens.custo_skill(buscar, base=self.cerebro)
        self.assertEqual(c["saida_ferramenta"], tokens.tokens_de_caracteres(400) + tokens.SAIDA_PADRAO["ler"])


class TestImposto(Base):
    def monta(self):
        self.skill(self.global_skills, "g-um", descricao="Descrição global um.")
        self.skill(self.global_skills, "g-dois", descricao="Descrição global dois.")
        self.skill(self.global_skills, "comum", descricao="Versão global.")
        (self.global_skills / "_removidas" / "velha").mkdir(parents=True)
        (self.global_skills / "_removidas" / "velha" / "SKILL.md").write_text(skill_md("velha"), encoding="utf-8")
        (self.global_skills / "sem-skill-md").mkdir()
        (self.home / "CLAUDE.md").write_text("regra global " * 20, encoding="utf-8")
        raiz = self.projeto / ".claude" / "skills"
        self.skill(raiz, "p-um", descricao="Descrição do projeto.")
        self.skill(raiz, "comum", descricao="Versão do projeto, bem mais comprida que a global para dar diferença.")
        (self.projeto / "CLAUDE.md").write_text("regra do projeto " * 30, encoding="utf-8")

    def test_custo_instalado_soma_skills_e_os_dois_claude_md(self):
        self.monta()
        g = tokens.custo_instalado("claude", "global")
        self.assertEqual([s["nome"] for s in g["skills"]], ["comum", "g-dois", "g-um"])  # _removidas e pastas vazias ficam de fora
        self.assertEqual(g["claude_md_global"]["tokens"], tokens.estimar_tokens("regra global " * 20))
        self.assertIsNone(g["claude_md_projeto"])
        self.assertEqual(g["total"], g["skills_total"] + g["claude_md_global"]["tokens"])
        p = tokens.custo_instalado("claude", "projeto", "jogo")
        self.assertEqual([s["nome"] for s in p["skills"]], ["comum", "p-um"])
        self.assertEqual(p["claude_md_projeto"]["tokens"], tokens.estimar_tokens("regra do projeto " * 30))
        self.assertEqual(p["total"], p["skills_total"] + p["claude_md_global"]["tokens"] + p["claude_md_projeto"]["tokens"])
        with self.assertRaises(ValueError):
            tokens.custo_instalado("claude", "projeto", "nao-existe")

    def test_imposto_da_conversa_a_do_projeto_vale_no_lugar_da_global(self):
        self.monta()
        sem = tokens.imposto_conversa("claude")
        com = tokens.imposto_conversa("claude", "jogo")
        self.assertEqual((sem["skills"], com["skills"]), (3, 4))  # comum não conta duas vezes
        fixo = lambda raiz, n: tokens.custo_skill(raiz / n)["fixo"]
        esperado = fixo(self.global_skills, "g-um") + fixo(self.global_skills, "g-dois") + fixo(self.projeto / ".claude" / "skills", "comum") \
            + fixo(self.projeto / ".claude" / "skills", "p-um")
        self.assertEqual(com["skills_tokens"], esperado)
        self.assertEqual(com["total"], esperado + com["claude_md_global"] + com["claude_md_projeto"])
        self.assertEqual(sem["claude_md_projeto"], 0)

    def test_skills_de_plugins_entram_no_imposto(self):
        self.monta()
        antes = tokens.imposto_conversa("claude")
        self.assertEqual((antes["plugins"], antes["plugins_tokens"]), (0, 0))
        raiz = self.raiz / "cache" / "meu-plugin" / "1.0.0" / "skills"
        self.skill(raiz, "babysit", descricao="Vigia um PR até ficar pronto.")
        self.skill(raiz, "standup", descricao="Facilita uma reunião.")
        (self.home / "plugins").mkdir()
        (self.home / "plugins" / "installed_plugins.json").write_text(json.dumps(
            {"version": 2, "plugins": {"meu-plugin@loja": [{"scope": "user", "installPath": str(raiz.parent)}]}}), encoding="utf-8")
        lista = tokens.skills_de_plugins()
        self.assertEqual(sorted(lista), ["meu-plugin:babysit", "meu-plugin:standup"])
        depois = tokens.imposto_conversa("claude", "jogo")
        self.assertEqual((depois["plugins"], depois["plugins_tokens"]), (2, sum(lista.values())))
        self.assertEqual(depois["total"], tokens.imposto_conversa("claude", "jogo")["skills_tokens"] + depois["plugins_tokens"]
                         + depois["claude_md_global"] + depois["claude_md_projeto"])
        (self.home / "plugins" / "installed_plugins.json").write_text("{quebrado", encoding="utf-8")
        self.assertEqual(tokens.skills_de_plugins(), {})   # arquivo estragado: não quebra nada

    def test_sem_nada_instalado(self):
        g = tokens.custo_instalado("claude", "global")
        self.assertEqual((g["skills"], g["claude_md_global"], g["total"]), ([], None, 0))


class TestRelatorioEAlertas(Base):
    def test_uma_linha_por_skill_total_e_alertas(self):
        self.skill(self.bib, "boa")
        self.skill(self.bib, "descricao-longa", descricao="d" * 201)
        self.skill(self.bib, "corpo-grande", corpo="palavra " * 1100)  # ~ 2.200 tokens
        for nome in ("boa", "descricao-longa", "corpo-grande"):
            (self.bib / nome / "skill.json").write_text(json.dumps({
                "nome": nome, "titulo": nome, "descricao_curta": "x", "exemplo_de_uso": "y", "categoria": "codigo", "versao": "1.0.0",
                "autor": "eu", "origem": "local", "compativel": ["claude"], "arquivos_extras": []}), encoding="utf-8")
        (self.home).mkdir(parents=True, exist_ok=True)
        (self.home / "CLAUDE.md").write_text("regra global muito longa " * 700, encoding="utf-8")  # imposto fixo > 3.000
        r = tokens.relatorio(self.bib, "claude")
        sec = r["secoes"][0]
        self.assertEqual([c["nome"] for c in sec["skills"]], ["boa", "corpo-grande", "descricao-longa"])
        self.assertEqual(sec["total"], {"skills": 3, "fixo": sum(c["fixo"] for c in sec["skills"])})
        msgs = {(a["skill"], a["mensagem"].split(" ")[0]) for a in r["alertas"]}
        self.assertIn(("descricao-longa", "descrição"), msgs)
        self.assertIn(("corpo-grande", "corpo"), msgs)
        self.assertIn((None, "imposto"), msgs)
        self.assertFalse([a for a in r["alertas"] if a["skill"] == "boa"])
        texto = "\n".join(tokens.formatar_relatorio(r))
        self.assertIn("ESTIMATIVA", texto)
        self.assertEqual(sum(1 for l in texto.splitlines() if l.startswith(("boa ", "corpo-grande ", "descricao-longa "))), 3)
        self.assertIn("!! descricao-longa: descrição com 201 caracteres (máx. 200)", texto)
        self.assertIn("Fixo:", r["conceito"])

    def test_cli_relatorio_json(self):
        saida = io.StringIO()
        with mock.patch.object(skills, "BIBLIOTECA", self.bib), contextlib.redirect_stdout(saida):
            self.skill(self.bib, "boa")
            (self.bib / "boa" / "skill.json").write_text(json.dumps({
                "nome": "boa", "titulo": "Boa", "descricao_curta": "x", "exemplo_de_uso": "y", "categoria": "codigo", "versao": "1.0.0",
                "autor": "eu", "origem": "local", "compativel": ["claude"], "arquivos_extras": []}), encoding="utf-8")
            self.assertEqual(tokens.main(["relatorio", "--json"]), 0)
        dados = json.loads(saida.getvalue())
        self.assertEqual([s["nome"] for s in dados["secoes"]], ["Claude", "Antigravity"])  # ambos é o padrão
        self.assertEqual(dados["secoes"][0]["skills"][0]["nome"], "boa")
        self.assertEqual(dados["secoes"][0]["estimativa"]["origem"], "padrão")
        self.assertEqual(dados["secoes"][1]["estimativa"]["origem"], "estimado")
        self.assertEqual(dados["limites"]["imposto_tokens"], 3000)


class TestPainelDaAba(Base):
    def manifesto(self, nome, **extra):
        m = {"nome": nome, "titulo": nome.title(), "descricao_curta": "curta", "exemplo_de_uso": "faça isso", "categoria": "codigo",
             "versao": "1.0.0", "autor": "eu", "origem": "local", "compativel": ["claude"], "arquivos_extras": [], **extra}
        (self.bib / nome / "skill.json").write_text(json.dumps(m), encoding="utf-8")

    def biblioteca(self):
        self.skill(self.bib, "leve", descricao="Curta.", corpo="corpo " * 40)
        self.skill(self.bib, "pesada", descricao="Descrição bem mais longa para pesar no custo fixo da conversa inteira.", corpo="palavra " * 400)
        self.skill(self.bib, "combinada", descricao="Faz o que as duas fazem.")
        for nome, extra in (("leve", {}), ("pesada", {}), ("combinada", {"alternativa_a": ["leve", "pesada"]})):
            self.manifesto(nome, **extra)

    def test_simular_instalar_remover_e_a_skill_do_projeto_vale_no_lugar_da_global(self):
        ctx = {"alvo": "claude", "projeto": "jogo", "global": {"a": 10, "comum": 30}, "projeto_skills": {"p": 5}, "md_global": 100, "md_projeto": 50}
        total = tokens.total_do_contexto(ctx)["total"]
        self.assertEqual(total, 10 + 30 + 5 + 100 + 50)
        self.assertEqual(tokens.simular(ctx, "instalar", "nova", "global", 20), total + 20)
        self.assertEqual(tokens.simular(ctx, "instalar", "nova", "projeto", 20), total + 20)
        self.assertEqual(tokens.simular(ctx, "instalar", "comum", "projeto", 45), total - 30 + 45)  # a do projeto cobre a global
        self.assertEqual(tokens.simular(ctx, "instalar", "comum", "global", 99), total - 30 + 99)
        self.assertEqual(tokens.simular(ctx, "remover", "a", "global"), total - 10)
        self.assertEqual(tokens.simular(ctx, "remover", "nao-existe", "global"), total)
        self.assertIsNone(tokens.simular({**ctx, "projeto": None}, "instalar", "x", "projeto", 1))
        self.assertEqual(ctx["global"], {"a": 10, "comum": 30})  # a simulação não altera o contexto

    def test_painel_cartoes_custos_selos_e_simulacao(self):
        self.biblioteca()
        skills.instalar("leve", "claude", "global", bib=self.bib)
        p = tokens.painel("global", None, bib=self.bib)
        self.assertEqual([c["nome"] for c in p["skills"]], ["combinada", "leve", "pesada"])
        leve = next(c for c in p["skills"] if c["nome"] == "leve")
        self.assertEqual(leve["instalada"]["global"], {"estado": "igual", "versao": "1.0.0"})
        self.assertIsNone(leve["instalada"]["projeto"])
        self.assertEqual((leve["sim"]["acao"], leve["sim"]["antes"], leve["sim"]["depois"]), ("remover", p["imposto"]["total"], p["imposto"]["total"] - leve["custo"]["fixo"]))
        pesada = next(c for c in p["skills"] if c["nome"] == "pesada")
        self.assertEqual((pesada["sim"]["acao"], pesada["sim"]["depois"]), ("instalar", p["imposto"]["total"] + pesada["custo"]["fixo"]))
        self.assertGreater(pesada["custo"]["ao_usar"], pesada["custo"]["fixo"] * 5)
        self.assertEqual(p["escala"], max(c["custo"][k] for c in p["skills"] for k in ("fixo", "ao_usar")))
        comb = next(c for c in p["skills"] if c["nome"] == "combinada")
        self.assertEqual((comb["alternativa_a"], comb["alternativa_instalada"]), (["leve", "pesada"], ["leve"]))  # a "leve" já está paga
        self.assertEqual(p["imposto"]["skills"], 1)
        self.assertEqual([x["id"] for x in p["projetos"]], ["jogo"])
        self.assertIn("Fixo:", p["conceito"])

    def test_escopo_projeto_instala_no_projeto_e_sem_projeto_cai_para_global(self):
        self.biblioteca()
        self.assertEqual(tokens.painel("projeto", None, bib=self.bib)["escopo"], "global")
        skills.instalar("pesada", "claude", "projeto", "jogo", bib=self.bib)
        p = tokens.painel("projeto", "jogo", bib=self.bib)
        pesada = next(c for c in p["skills"] if c["nome"] == "pesada")
        self.assertEqual((p["escopo"], p["projeto"]), ("projeto", "jogo"))
        self.assertEqual(pesada["instalada"]["projeto"]["estado"], "igual")
        self.assertIsNone(pesada["instalada"]["global"])
        self.assertEqual(pesada["sim"]["acao"], "remover")
        self.assertEqual(p["imposto"]["skills"], 1)

    def test_instalada_por_outro_meio_nao_tem_simulacao(self):
        self.biblioteca()
        alheia = self.global_skills / "leve"
        alheia.mkdir(parents=True)
        (alheia / "SKILL.md").write_text("feita à mão", encoding="utf-8")
        leve = next(c for c in tokens.painel("global", None, bib=self.bib)["skills"] if c["nome"] == "leve")
        self.assertEqual(leve["instalada"]["global"]["estado"], "outro-meio")
        self.assertIsNone(leve["sim"])

    def test_barra_verde_amarela_vermelha(self):
        self.biblioteca()
        self.home.mkdir(parents=True, exist_ok=True)
        cores = []
        for palavras in (10, 400, 1300):  # CLAUDE.md global de tamanhos diferentes
            (self.home / "CLAUDE.md").write_text("regra longa demais " * palavras, encoding="utf-8")
            i = tokens.painel("global", None, bib=self.bib)["imposto"]
            cores.append((i["cor"], i["limite"], i["faixa_verde"]))
        self.assertEqual([c[0] for c in cores], ["verde", "amarela", "vermelha"])
        self.assertEqual(cores[0][1:], (3000, 1500))

    def test_cache_por_arquivo_invalida_pela_data_ou_pelo_fator(self):
        self.biblioteca()
        skills.instalar("leve", "claude", "global", bib=self.bib)
        self.home.mkdir(parents=True, exist_ok=True)
        (self.home / "CLAUDE.md").write_text("regra " * 20, encoding="utf-8")
        primeiro = tokens.painel("global", None, bib=self.bib)["cache"]
        self.assertGreater(primeiro["calculados"], 0)
        self.assertTrue((self.cerebro / ".log" / "tokens-cache.json").is_file())
        segundo = tokens.painel("global", None, bib=self.bib)["cache"]
        self.assertEqual(segundo, {"acertos": primeiro["acertos"] + primeiro["calculados"], "calculados": 0})
        # editar um SKILL.md muda a data/tamanho: só ele é recalculado
        antes = tokens.painel("global", None, bib=self.bib)
        (self.bib / "pesada" / "SKILL.md").write_text(skill_md("pesada", corpo="palavra " * 900), encoding="utf-8")
        depois = tokens.painel("global", None, bib=self.bib)
        self.assertEqual(depois["cache"]["calculados"], 1)
        pesada = lambda p: next(c for c in p["skills"] if c["nome"] == "pesada")["custo"]["ao_usar"]
        self.assertGreater(pesada(depois), pesada(antes) * 2)
        # só a data mudou (conteúdo igual): também recalcula
        arq = self.bib / "leve" / "SKILL.md"
        os.utime(arq, ns=(arq.stat().st_atime_ns, arq.stat().st_mtime_ns + 5_000_000_000))
        self.assertEqual(tokens.painel("global", None, bib=self.bib)["cache"]["calculados"], 1)
        # mudar o fator de estimativa invalida tudo
        tokens._gravar_fator(1.7, {"modelo": "m"})
        mudou = tokens.painel("global", None, bib=self.bib)
        self.assertEqual(mudou["cache"]["acertos"], 0)
        self.assertEqual((mudou["estimativa"]["fator"], mudou["estimativa"]["origem"]), (1.7, "calibrado"))

    def test_cache_corrompido_ou_sem_cerebro_nao_quebra(self):
        self.biblioteca()
        (self.cerebro / ".log" / "tokens-cache.json").write_text("{quebrado", encoding="utf-8")
        self.assertGreater(tokens.painel("global", None, bib=self.bib)["cache"]["calculados"], 0)
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.raiz / "nao-existe")}):
            self.assertEqual(len(tokens.painel("global", None, bib=self.bib)["skills"]), 3)

    def test_cli_painel_json_e_ler_do_skills(self):
        self.biblioteca()
        saida = io.StringIO()
        with mock.patch.object(skills, "BIBLIOTECA", self.bib), contextlib.redirect_stdout(saida):
            self.assertEqual(tokens.main(["painel", "--escopo", "global", "--json"]), 0)
        self.assertEqual(len(json.loads(saida.getvalue())["skills"]), 3)
        self.assertIn("name: leve", skills.ler_skill("leve", self.bib))
        for ruim in ("../x", "nao-existe", ""):
            with self.assertRaises(ValueError):
                skills.ler_skill(ruim, self.bib)


class APIFalsa:
    """Servidor local que imita o endpoint de contagem: 1 token a cada 3 caracteres, +7 de enquadramento."""

    def __init__(self, status=200, corpo=None):
        self.pedidos = []
        falsa = self

        class Manipulador(BaseHTTPRequestHandler):
            def do_POST(self):
                dados = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                falsa.pedidos.append({"path": self.path, "headers": dict(self.headers), "corpo": dados})
                if status != 200:
                    resposta = json.dumps(corpo or {"error": {"type": "authentication_error", "message": "invalid x-api-key"}})
                else:
                    n = 7 + -(-len(dados["messages"][0]["content"]) // 3)
                    resposta = json.dumps({"input_tokens": n})
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(resposta.encode("utf-8"))

            def log_message(self, *a):
                pass

        self.servidor = HTTPServer(("127.0.0.1", 0), Manipulador)
        self.url = f"http://127.0.0.1:{self.servidor.server_address[1]}/v1/messages/count_tokens"
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()

    def parar(self):
        self.servidor.shutdown()
        self.servidor.server_close()


class TestCalibracaoPelaAPI(Base):
    def setUp(self):
        super().setUp()
        for nome in ("um", "dois"):
            self.skill(self.bib, nome, corpo=f"corpo de {nome} com acentuação\n" * 20)

    def api(self, **kw):
        falsa = APIFalsa(**kw)
        self.addCleanup(falsa.parar)
        return falsa

    def test_sem_enviar_nada_e_enviado_e_nada_e_gravado(self):
        falsa = self.api()
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-segredo"}):
            plano = tokens.calibrar(enviar=False, url=falsa.url, bib=self.bib)
        self.assertFalse(plano["enviado"])
        self.assertEqual(plano["requisicoes"], 3)
        self.assertEqual(falsa.pedidos, [])
        self.assertNotIn("tokens_fator", json.loads(self.cfg.read_text(encoding="utf-8")))

    def test_cli_sem_enviar_mostra_o_que_enviaria(self):
        saida = io.StringIO()
        with mock.patch.object(skills, "BIBLIOTECA", self.bib), mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-x"}), contextlib.redirect_stdout(saida):
            self.assertEqual(tokens.main(["calibrar"]), 0)
        self.assertIn("NADA foi enviado", saida.getvalue())
        self.assertIn("um  (", saida.getvalue())

    def test_enviar_sem_chave_e_recusado(self):
        falsa = self.api()
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ANTHROPIC_API_KEY", None)
            with self.assertRaises(ValueError) as e:
                tokens.calibrar(enviar=True, url=falsa.url, bib=self.bib)
        self.assertIn("ANTHROPIC_API_KEY", str(e.exception))
        self.assertEqual(falsa.pedidos, [])

    def test_formato_do_pedido_e_fator_gravado_sem_perder_o_resto(self):
        falsa = self.api()
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-segredo"}):
            r = tokens.calibrar(enviar=True, modelo="claude-opus-5-5", url=falsa.url, bib=self.bib)
        p = falsa.pedidos[0]
        self.assertEqual(p["path"], "/v1/messages/count_tokens")
        cab = {k.lower(): v for k, v in p["headers"].items()}  # o urllib capitaliza os nomes
        self.assertEqual(cab["x-api-key"], "sk-ant-segredo")
        self.assertEqual(cab["anthropic-version"], "2023-06-01")
        self.assertEqual(cab["content-type"], "application/json")
        self.assertEqual(p["corpo"], {"model": "claude-opus-5-5", "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(len(falsa.pedidos), 3)  # a mínima + 2 skills
        # a conta: tokens reais (sem as 7 de enquadramento: a mensagem "x" custa 7 + 1 = 8, sobrecarga 7) / (caracteres / 4)
        textos = [(self.bib / n / "SKILL.md").read_text(encoding="utf-8") for n in ("dois", "um")]
        reais = [-(-len(t) // 3) for t in textos]
        self.assertEqual(r["sobrecarga"], 7)
        self.assertAlmostEqual(r["fator"], sum(reais) / sum(len(t) / 4 for t in textos), places=3)
        cfg = json.loads(self.cfg.read_text(encoding="utf-8"))
        self.assertEqual(cfg["cerebro_dir"], str(self.cerebro))  # a outra chave continua
        self.assertEqual(cfg["tokens_fator"], r["fator"])
        self.assertEqual((cfg["tokens_calibracao"]["modelo"], cfg["tokens_calibracao"]["amostras"]), ("claude-opus-5-5", 2))
        self.assertNotIn("sk-ant-segredo", self.cfg.read_text(encoding="utf-8"))  # a chave nunca é gravada
        # o fator calibrado passa a valer nas estimativas
        self.assertEqual(tokens.estimar_tokens("a" * 400), round(100 * r["fator"] + 0.4999999))
        # esquecer volta ao padrão e mantém o resto
        tokens._gravar_fator(None, None)
        cfg = json.loads(self.cfg.read_text(encoding="utf-8"))
        self.assertEqual(list(cfg), ["cerebro_dir"])

    def test_erro_da_api_nao_vaza_a_chave(self):
        falsa = self.api(status=401)
        with self.assertRaises(ValueError) as e:
            tokens.contar_tokens_api("oi", "claude-sonnet-5-5", "sk-ant-segredo", url=falsa.url)
        self.assertIn("401", str(e.exception))
        self.assertIn("invalid x-api-key", str(e.exception))
        self.assertNotIn("sk-ant-segredo", str(e.exception))
        with self.assertRaises(ValueError) as e:
            tokens.contar_tokens_api("oi", "m", "sk-ant-segredo", url="http://127.0.0.1:9/nada")
        self.assertIn("não consegui falar com a API", str(e.exception))

    def test_config_quebrada_nao_e_sobrescrita(self):
        self.cfg.write_text("{quebrado", encoding="utf-8")
        with self.assertRaises(ValueError):
            tokens._gravar_fator(1.2, {})
        self.assertEqual(self.cfg.read_text(encoding="utf-8"), "{quebrado")

    def test_endpoint_e_versao_sao_os_documentados(self):
        self.assertEqual(tokens.API_URL, "https://api.anthropic.com/v1/messages/count_tokens")
        self.assertEqual(tokens.API_VERSAO, "2023-06-01")


class TestAntigravity(Base):
    """Custo por IA (10.6): as instruções do agy, o fator padrão, plugins só no Claude, relatório por IA."""

    def projeto_agy(self):
        pasta = self.raiz / "projeto agy"
        pasta.mkdir()
        projetos.adicionar({"nome": "Agy", "id": "agy", "pasta": str(pasta), "ia": "antigravity"}, base=self.cerebro)
        return pasta

    def test_instrucoes_do_agy_sao_agents_e_so_as_regras_always_on(self):
        pasta = self.projeto_agy()
        (pasta / "AGENTS.md").write_text("regra do agy " * 40, encoding="utf-8")
        (pasta / ".agents" / "rules").mkdir(parents=True)
        (pasta / ".agents" / "rules" / "sempre.md").write_text("---\ntrigger: always_on\n---\n" + "regra " * 30, encoding="utf-8")
        (pasta / ".agents" / "rules" / "sem-cabecalho.md").write_text("regra sem cabeçalho " * 30, encoding="utf-8")
        (pasta / ".agents" / "rules" / "manual.md").write_text("---\ntrigger: manual\n---\n" + "regra " * 30, encoding="utf-8")
        (pasta / ".agent" / "rules").mkdir(parents=True)
        (pasta / ".agent" / "rules" / "antigo.md").write_text("---\ntrigger: always_on\n---\n" + "antiga " * 30, encoding="utf-8")
        d = tokens.custo_instalado("antigravity", "projeto", "agy")
        nomes = sorted(Path(a["arquivo"]).name for a in d["claude_md_projeto"]["arquivos"])
        self.assertEqual(nomes, ["AGENTS.md", "antigo.md", "sempre.md"])
        esperado = sum(tokens.estimar_tokens(Path(a["arquivo"]).read_bytes().decode("utf-8-sig"), calibrado=False)
                       for a in d["claude_md_projeto"]["arquivos"])
        self.assertEqual(d["claude_md_projeto"]["tokens"], esperado)
        self.assertEqual(d["total"], d["skills_total"] + esperado)  # confirmado: entra no total

    def test_o_fator_calibrado_so_vale_para_o_claude(self):
        tokens._gravar_fator(1.7, {"modelo": "m"})
        texto = "regra global do teste " * 50
        self.home.mkdir(parents=True, exist_ok=True)
        (self.home / "CLAUDE.md").write_text(texto, encoding="utf-8")
        self.assertEqual(tokens.custo_instalado("claude", "global")["claude_md_global"]["tokens"], tokens.estimar_tokens(texto))
        (self.gemini).mkdir(parents=True, exist_ok=True)
        (self.gemini / "GEMINI.md").write_text(texto, encoding="utf-8")
        g = tokens.custo_instalado("antigravity", "global")["claude_md_global"]
        self.assertEqual(g["tokens"], tokens.estimar_tokens(texto, calibrado=False))
        self.assertNotEqual(g["tokens"], tokens.estimar_tokens(texto))  # com o 1,7 do Claude daria outro número

    def test_gemini_global_nao_confirmado_fica_fora_do_total(self):
        self.gemini.mkdir(parents=True, exist_ok=True)
        (self.gemini / "GEMINI.md").write_text("regra global do agy " * 40, encoding="utf-8")
        d = tokens.custo_instalado("antigravity", "global")
        self.assertFalse(d["claude_md_global"]["confirmado"])
        self.assertEqual(d["total"], d["skills_total"])  # não entra
        ctx = tokens.contexto("antigravity")
        self.assertEqual((ctx["md_global"], ctx["nao_confirmado"] > 0), (0, True))
        self.assertEqual(tokens.total_do_contexto(ctx)["nao_confirmado"], ctx["nao_confirmado"])
        self.assertEqual(tokens.total_do_contexto(ctx)["total"], 0)

    def test_plugins_sao_so_do_claude(self):
        raiz = self.raiz / "cache" / "meu-plugin" / "1.0.0" / "skills"
        self.skill(raiz, "babysit", descricao="Vigia um PR até ficar pronto.")
        (self.home / "plugins").mkdir(parents=True)
        (self.home / "plugins" / "installed_plugins.json").write_text(json.dumps(
            {"version": 2, "plugins": {"meu-plugin@loja": [{"scope": "user", "installPath": str(raiz.parent)}]}}), encoding="utf-8")
        self.assertEqual(tokens.imposto_conversa("claude")["plugins"], 1)
        self.assertEqual(tokens.imposto_conversa("antigravity")["plugins"], 0)

    def test_skills_do_agy_medidas_pela_variante_e_sem_o_fator(self):
        bib = self.raiz / "bib-agy"
        (bib / "varia").mkdir(parents=True)
        (bib / "varia" / "SKILL.md").write_text(skill_md("varia", descricao="Comum."), encoding="utf-8")
        (bib / "varia" / "skill.json").write_text(json.dumps({"nome": "varia", "titulo": "V", "descricao_curta": "x", "exemplo_de_uso": "y",
            "categoria": "codigo", "versao": "1.0.0", "autor": "eu", "origem": "local", "compativel": ["claude", "antigravity"],
            "arquivos_extras": []}), encoding="utf-8")
        (bib / "varia" / "variantes" / "antigravity").mkdir(parents=True)
        (bib / "varia" / "variantes" / "antigravity" / "SKILL.md").write_text(skill_md("varia", descricao="Variante bem mais longa do agy " * 3), encoding="utf-8")
        tokens._gravar_fator(1.7, {"modelo": "m"})
        c_agy = tokens.custo_skill(bib / "varia", alvo="antigravity")
        c_cla = tokens.custo_skill(bib / "varia", alvo="claude")
        self.assertGreater(c_agy["fixo"], c_cla["fixo"])
        self.assertEqual(c_agy["fixo"], tokens.estimar_tokens("varia: " + "Variante bem mais longa do agy " * 3, calibrado=False))

    def test_relatorio_uma_secao_por_ia_e_projeto_so_nas_suas(self):
        self.projeto_agy()
        self.bib.mkdir()  # biblioteca vazia: o relatório só mede os contextos
        r = tokens.relatorio(self.bib)
        self.assertEqual([s["alvo"] for s in r["secoes"]], ["claude", "antigravity"])
        claude = [i["contexto"] for i in r["secoes"][0]["imposto"]]
        agy = [i["contexto"] for i in r["secoes"][1]["imposto"]]
        self.assertIn("global", claude)
        self.assertNotIn("projeto agy", claude)  # o projeto é do agy: o Claude não o mede
        self.assertIn("projeto agy", agy)
        self.assertNotIn("projeto jogo", agy)    # o projeto é do Claude
        texto = "\n".join(tokens.formatar_relatorio(r))
        self.assertIn("=== Claude ===", texto)
        self.assertIn("=== Antigravity ===", texto)
        self.assertIn("lado a lado", texto)
        so = tokens.relatorio(self.bib, "antigravity")
        self.assertEqual([s["alvo"] for s in so["secoes"]], ["antigravity"])

    def test_alvo_desconhecido_e_recusado(self):
        with self.assertRaises(ValueError):
            tokens.painel("global", None, "chatgpt", bib=self.bib)
        with self.assertRaises(ValueError):
            tokens.relatorio(self.bib, "chatgpt")

    def test_estimativa_do_agy_e_rotulada(self):
        self.assertEqual(tokens.estimativa_do("antigravity")["origem"], "estimado")
        tokens._gravar_fator(1.7, {"modelo": "m"})
        self.assertEqual(tokens.estimativa_do("claude")["origem"], "calibrado")
        self.assertEqual(tokens.estimativa_do("antigravity")["origem"], "estimado")


if __name__ == "__main__":
    unittest.main()
