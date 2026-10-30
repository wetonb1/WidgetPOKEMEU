# -*- coding: utf-8 -*-
"""Testes do cerebro.py. Rodar: python cerebro/tools/test_cerebro.py"""
import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402

# 2 arquivos válidos (uma conversa com quebras do Windows e um estado) e 2 inválidos
CONVERSA_OK = (
    "palavras-chave: cérebro, estrutura, claude-md, pastas, instruções\r\n"
    "data: 2026-10-28 | origem: claude-code | projeto: Meu-Widget\r\n"
    "\r\n"
    "- Criamos as pastas\r\n"
    "- Escrevemos o CLAUDE.md\r\n"
)
ESTADO_OK = (
    "# Objetivo\nWidget leve.\n## Stack\nElectron.\n## Decisões\nSem frameworks.\n"
    "## Estado atual\nFase 1.\n## Próximos passos\nAba cérebro.\n## Armadilhas\nCPU.\n"
)
CONVERSA_NOME_RUIM = "Anotação qualquer.md"  # nome fora do padrão e sem cabeçalho
CONVERSA_LONGA = (
    "palavras-chave: um, dois\n"  # só 2 palavras-chave
    "data: 2026-13-45 | origem: x | projeto: outro\n"  # data impossível
    "\n" + "palavra " * 151  # 151 palavras no corpo
)


def montar(base):
    (base / "conversas").mkdir(parents=True)
    (base / "estado").mkdir()
    (base / "conversas" / "2026-10-28_estrutura-inicial-do-cerebro.md").write_bytes(CONVERSA_OK.encode("utf-8"))
    (base / "estado" / "meu-widget.md").write_text(ESTADO_OK, encoding="utf-8")
    (base / "conversas" / CONVERSA_NOME_RUIM).write_text("sem cabeçalho nenhum\n", encoding="utf-8")
    (base / "conversas" / "2026-10-26_texto-muito-longo-demais.md").write_text(CONVERSA_LONGA, encoding="utf-8")


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name) / "cerebro"
        montar(self.base)

    def problemas(self):
        achados = {}
        for arq, problema in cerebro.validar(self.base):
            achados.setdefault(arq, []).append(problema)
        return achados


class TestCabecalho(Base):
    def test_leitura_com_quebras_do_windows(self):
        cab = cerebro.ler_cabecalho(self.base / "conversas" / "2026-10-28_estrutura-inicial-do-cerebro.md")
        self.assertEqual(cab["palavras_chave"], ["cérebro", "estrutura", "claude-md", "pastas", "instruções"])
        self.assertEqual((cab["data"], cab["origem"], cab["projeto"]), ("2026-10-28", "claude-code", "Meu-Widget"))

    def test_tolera_bom(self):
        arq = self.base / "conversas" / "bom.md"
        arq.write_bytes(cerebro.BOM + CONVERSA_OK.encode("utf-8"))
        self.assertEqual(cerebro.ler_cabecalho(arq)["palavras_chave"][0], "cérebro")

    def test_campos_ausentes_viram_none(self):
        cab = cerebro.ler_cabecalho(self.base / "conversas" / CONVERSA_NOME_RUIM)
        self.assertEqual(cab, {"palavras_chave": None, "data": None, "origem": None, "projeto": None})


class TestNormalizar(unittest.TestCase):
    def test_acentos_e_caixa(self):
        for texto in ("Cérebro", "cerebro", "CEREBRO", "CÉREBRO"):
            self.assertEqual(cerebro.normalizar(texto), "cerebro")

    def test_separadores(self):
        self.assertEqual(cerebro.normalizar("Palavras-Chave:  Ação_nova"), "palavras chave acao nova")
        self.assertEqual(cerebro.normalizar(None), "")


class TestValidar(Base):
    def test_validos_nao_tem_problema(self):
        achados = self.problemas()
        self.assertNotIn("conversas/2026-10-28_estrutura-inicial-do-cerebro.md", achados)
        self.assertNotIn("estado/meu-widget.md", achados)

    def test_nome_e_cabecalho_ruins(self):
        texto = " | ".join(self.problemas()["conversas/" + CONVERSA_NOME_RUIM])
        self.assertIn("nome fora do padrão", texto)
        self.assertIn("linha 1 sem 'palavras-chave:'", texto)
        self.assertIn("linha 2 sem data válida", texto)

    def test_poucas_chaves_data_e_corpo_longo(self):
        texto = " | ".join(self.problemas()["conversas/2026-10-26_texto-muito-longo-demais.md"])
        self.assertIn("2 palavras-chave", texto)
        self.assertIn("linha 2 sem data válida", texto)
        self.assertIn("corpo com 151 palavras", texto)

    def test_estado_incompleto_e_grande(self):
        (self.base / "estado" / "grande.md").write_text("# Objetivo\n" + "x " * 301, encoding="utf-8")
        texto = " | ".join(self.problemas()["estado/grande.md"])
        self.assertIn("faltam seções: Stack", texto)
        self.assertIn("302 palavras", texto)

    def test_corrigir_so_o_seguro(self):
        ruim = self.base / "conversas" / "2026-10-27_Ação Nova Aqui.md"
        ruim.write_bytes(cerebro.BOM + "palavras-chave: a, b, c   \ndata: 2026-10-27 | origem: x | projeto: p\n\ncorpo\n".encode("utf-8"))
        feitos = cerebro.corrigir(self.base)
        self.assertTrue((self.base / "conversas" / "2026-10-27_acao-nova-aqui.md").exists())
        self.assertFalse(ruim.exists())
        deste = [o for a, o in feitos if a == "conversas/2026-10-27_Ação Nova Aqui.md"]
        self.assertEqual(len(deste), 3)  # BOM, espaços, nome
        self.assertNotIn("conversas/2026-10-27_acao-nova-aqui.md", self.problemas())
        # o que não é seguro continua pendente e o conteúdo não foi tocado
        self.assertIn("conversas/" + CONVERSA_NOME_RUIM, self.problemas())
        self.assertTrue((self.base / "conversas" / CONVERSA_NOME_RUIM).exists())


class TestIndice(Base):
    def test_agrupa_por_projeto(self):
        texto, n = cerebro.gerar_indice(self.base)
        self.assertEqual(n, 4)
        linhas = texto.splitlines()
        self.assertIn("## meu-widget", linhas)
        self.assertIn("## outro", linhas)
        self.assertIn("## sem-projeto", linhas)
        self.assertIn("2026-10-28_estrutura-inicial-do-cerebro.md — cérebro, estrutura, claude-md, pastas, instruções", linhas)
        # o estado vem logo depois do título do projeto
        self.assertEqual(linhas[linhas.index("## meu-widget") + 1], "estado/meu-widget.md")
        self.assertNotIn("### ", texto)  # poucas linhas: sem agrupar por mês

    def test_passando_de_200_linhas_agrupa_por_mes(self):
        for i in range(210):
            mes = "10" if i % 2 else "09"
            (self.base / "conversas" / f"2026-{mes}-{i % 28 + 1:02d}_assunto-numero-{i}.md").write_text(
                "palavras-chave: a, b, c\ndata: 2026-10-01 | origem: x | projeto: massa\n\ncorpo\n", encoding="utf-8")
        texto, _ = cerebro.gerar_indice(self.base)
        linhas = texto.splitlines()
        self.assertIn("### 2026-09", linhas)
        self.assertIn("### 2026-10", linhas)

    def test_escreve_indice_md(self):
        destino, n_linhas, n_arquivos = cerebro.escrever_indice(self.base)
        self.assertEqual(destino.name, "INDICE.md")
        self.assertEqual(n_arquivos, 4)
        self.assertEqual(destino.read_text(encoding="utf-8").count("\n"), n_linhas)


class TestLocalizacaoECli(Base):
    def test_ordem_env_config_padrao(self):
        cfg = self.base.parent / "cfg.json"
        with mock.patch.dict(os.environ, {"CEREBRO_CONFIG": str(cfg)}):
            os.environ.pop("CEREBRO_DIR", None)
            self.assertEqual(cerebro.descobrir_cerebro()[1], "padrao")
            cerebro.definir_cerebro(self.base)
            self.assertEqual(cerebro.descobrir_cerebro(), (self.base.resolve(), "config"))
            os.environ["CEREBRO_DIR"] = str(self.base.parent)
            self.assertEqual(cerebro.descobrir_cerebro()[1], "env")

    def test_definir_pasta_inexistente(self):
        with mock.patch.dict(os.environ, {"CEREBRO_CONFIG": str(self.base.parent / "cfg.json")}):
            with self.assertRaises(FileNotFoundError):
                cerebro.definir_cerebro(self.base / "nao-existe")

    def test_cli_validar_json(self):
        saida = io.StringIO()
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(saida):
            codigo = cerebro.main(["validar", "--json"])
        self.assertEqual(codigo, 1)  # há problemas
        dados = json.loads(saida.getvalue())
        self.assertTrue(any(p["arquivo"] == "conversas/" + CONVERSA_NOME_RUIM for p in dados["problemas"]))

    def test_cerebro_inexistente_sai_com_3(self):
        erro = io.StringIO()
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base / "nao-existe")}), contextlib.redirect_stderr(erro):
            self.assertEqual(cerebro.main(["painel", "--json"]), 3)
        self.assertIn("pasta do cérebro não existe", erro.getvalue())

    def test_cli_validar_texto_ok(self):
        (self.base / "conversas" / CONVERSA_NOME_RUIM).unlink()
        (self.base / "conversas" / "2026-10-26_texto-muito-longo-demais.md").unlink()
        saida = io.StringIO()
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(saida):
            codigo = cerebro.main(["validar"])
        self.assertEqual((codigo, saida.getvalue()), (0, "ok\n"))


def conversa(base, nome, chaves, projeto="meu-widget", corpo="- topico\n"):
    (base / "conversas" / nome).write_text(
        f"palavras-chave: {chaves}\ndata: {nome[:10]} | origem: claude-code | projeto: {projeto}\n\n{corpo}",
        encoding="utf-8")


class BaseBusca(Base):
    """Os 4 arquivos de sempre + 3 conversas para ter o que buscar."""

    def setUp(self):
        super().setUp()
        conversa(self.base, "2026-10-20_agentes-do-antigravity-por-projeto.md",
                 "agentes, antigravity, projetos, sessoes, abrir")
        conversa(self.base, "2026-10-15_limites-de-uso-do-claude-code.md",
                 "limites, uso, tokens, conta, assinatura")
        conversa(self.base, "2026-10-10_nome-sem-relacao-nenhuma.md",
                 "pokebola, tela, carregamento, giratoria, css")

    def rodar(self, *argv):
        """Roda a linha de comando no cérebro de teste. Devolve (código, saída)."""
        saida = io.StringIO()
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(saida):
            codigo = cerebro.main(list(argv))
        return codigo, saida.getvalue()


class TestTitulos(BaseBusca):
    def test_pontuacao_exata_parcial_e_projeto(self):
        # "agentes" = palavra exata (2); "agent" = prefixo de 4+ letras (1)
        self.assertEqual(cerebro.busca_titulos(self.base, ["agentes"])[0]["pontos"], 2)
        self.assertEqual(cerebro.busca_titulos(self.base, ["agent"])[0]["pontos"], 1)
        # "age" tem só 3 letras: não vale como prefixo
        self.assertEqual(cerebro.busca_titulos(self.base, ["age"]), [])
        # acento e caixa não atrapalham; 2 termos somam
        self.assertEqual(cerebro.busca_titulos(self.base, ["CÉREBRO", "inicial"])[0]["pontos"], 4)
        # +1 do projeto só para quem já pontuou (estado/meu-widget.md casa com projeto "meu-widget")
        com = {e["arquivo"]: e["pontos"] for e in cerebro.busca_titulos(self.base, ["widget"], "meu-widget")}
        self.assertEqual(com["estado/meu-widget.md"], 3)
        self.assertEqual(len(com), 1)

    def test_nada_pontua_imprime_nenhum(self):
        codigo, texto = self.rodar("titulos", "zzzxxx")
        self.assertEqual((codigo, texto), (0, "nenhum\n"))

    def test_formato_limite_e_desempate_por_data(self):
        for dia in (11, 12, 13):
            conversa(self.base, f"2026-10-{dia}_reuniao-de-teste-{dia}.md", "a, b, c")
        _, texto = self.rodar("titulos", "reuniao", "--limite", "2")
        self.assertEqual(texto.splitlines(), ["2 2026-10-13_reuniao-de-teste-13.md",
                                              "2 2026-10-12_reuniao-de-teste-12.md"])

    def test_nao_abre_nenhum_arquivo(self):
        def proibido(*a, **k):
            raise AssertionError("abriu um arquivo")
        with mock.patch("builtins.open", proibido), mock.patch("pathlib.Path.read_bytes", proibido), \
                mock.patch("pathlib.Path.read_text", proibido), mock.patch("io.open", proibido):
            self.assertTrue(cerebro.busca_titulos(self.base, ["antigravity"]))


class TestCabecalhoBusca(BaseBusca):
    def test_pontuacao(self):
        # "tokens" é palavra-chave exata (3); "token" está dentro de "tokens" (1)
        res, _ = cerebro.busca_cabecalho(self.base, ["tokens"])
        self.assertEqual((res[0]["arquivo"], res[0]["pontos"]), ("2026-10-15_limites-de-uso-do-claude-code.md", 3))
        res, _ = cerebro.busca_cabecalho(self.base, ["token"])
        self.assertEqual(res[0]["pontos"], 1)
        # exata (3) + no nome (1)
        res, _ = cerebro.busca_cabecalho(self.base, ["limites"])
        self.assertEqual(res[0]["pontos"], 4)

    def test_saida_e_limite(self):
        _, texto = self.rodar("cabecalho", "tokens")
        self.assertEqual(texto, "3 2026-10-15_limites-de-uso-do-claude-code.md | limites, uso, tokens, conta, assinatura\n")
        _, texto = self.rodar("cabecalho", "css", "limites", "--limite", "1")
        self.assertEqual(len(texto.splitlines()), 1)
        self.assertEqual(self.rodar("cabecalho", "zzzxxx")[1], "nenhum\n")

    def test_arquivos_restringe_e_avisa_o_que_falta(self):
        _, texto = self.rodar("cabecalho", "css", "tokens", "--arquivos",
                              "2026-10-10_nome-sem-relacao-nenhuma", "nao-existe.md")
        linhas = texto.splitlines()
        self.assertEqual(linhas[0], "não encontrado: nao-existe.md")
        self.assertEqual(len(linhas), 2)  # o arquivo de "tokens" ficou de fora
        self.assertTrue(linhas[1].startswith("3 2026-10-10_nome-sem-relacao-nenhuma.md | "))

    def test_le_so_o_cabecalho(self):
        # arquivo com corpo enorme: o cabeçalho continua sendo lido do começo
        conversa(self.base, "2026-10-01_arquivo-com-corpo-enorme.md", "gigante, enorme, corpo", corpo="palavra " * 200000)
        res, _ = cerebro.busca_cabecalho(self.base, ["gigante"])
        self.assertEqual(res[0]["arquivo"], "2026-10-01_arquivo-com-corpo-enorme.md")


class TestLer(BaseBusca):
    def test_com_e_sem_caminho(self):
        for pedido in ("2026-10-28_estrutura-inicial-do-cerebro.md", "2026-10-28_estrutura-inicial-do-cerebro",
                       "conversas/2026-10-28_estrutura-inicial-do-cerebro.md",
                       str(self.base / "conversas" / "2026-10-28_estrutura-inicial-do-cerebro.md")):
            lidos, faltando = cerebro.ler_arquivos(self.base, [pedido])
            self.assertEqual(faltando, [])
            self.assertIn("- Criamos as pastas", lidos[0][1])
        self.assertEqual(cerebro.ler_arquivos(self.base, ["estado/meu-widget"])[0][0][0], "estado/meu-widget.md")

    def test_saida_do_comando(self):
        codigo, texto = self.rodar("ler", "meu-widget", "nao-existe")
        self.assertEqual(codigo, 0)
        self.assertEqual(texto.splitlines()[:2], ["não encontrado: nao-existe", "== estado/meu-widget.md"])
        self.assertIn("## Armadilhas", texto)

    def test_recusa_mais_de_3(self):
        erro = io.StringIO()
        with contextlib.redirect_stderr(erro):
            codigo, texto = self.rodar("ler", "a", "b", "c", "d")
        self.assertEqual((codigo, texto), (2, ""))
        self.assertEqual(erro.getvalue(), "erro: máximo 3 arquivos por vez (recebi 4)\n")


class TestBuscar(BaseBusca):
    def test_bom_resultado_nos_titulos_nao_abre_cabecalhos(self):
        # "agentes antigravity" = 4 pontos no nome: o nível 2 não deve rodar
        with mock.patch.object(cerebro, "ler_cabecalho", side_effect=AssertionError("leu cabeçalho")):
            d = cerebro.buscar(self.base, ["agentes", "antigravity"])
        self.assertEqual(d["abrir"], ["2026-10-20_agentes-do-antigravity-por-projeto.md"])

    def test_fraco_nos_titulos_cai_para_o_cabecalho(self):
        # "pokebola" só está nas palavras-chave, nunca no nome
        self.assertEqual(cerebro.busca_titulos(self.base, ["pokebola"]), [])
        codigo, texto = self.rodar("buscar", "pokebola")
        self.assertEqual(texto.splitlines(), [
            "3 2026-10-10_nome-sem-relacao-nenhuma.md | pokebola, tela, carregamento, giratoria, css",
            "abrir: 2026-10-10_nome-sem-relacao-nenhuma.md"])

    def test_estado_do_projeto_e_nao_abre_arquivos(self):
        with mock.patch.object(cerebro, "ler_arquivos", side_effect=AssertionError("abriu")):
            _, texto = self.rodar("buscar", "cerebro", "estrutura", "--projeto", "Meu-Widget")
        linhas = texto.splitlines()
        self.assertEqual(linhas[:3], ["estado disponível: estado/meu-widget.md", "# Objetivo", "Widget leve."])
        self.assertTrue(linhas[-1].startswith("abrir: "))
        _, texto = self.rodar("buscar", "cerebro", "--projeto", "outro-projeto")
        self.assertEqual(texto.splitlines()[0], "sem estado: outro-projeto")

    def test_sugere_no_maximo_3_e_nenhum(self):
        for i in range(6):
            conversa(self.base, f"2026-09-0{i + 1}_planejamento-geral-{i}.md", "planejamento, geral, x")
        _, texto = self.rodar("buscar", "planejamento", "geral")
        self.assertEqual(len(texto.splitlines()[-1].replace("abrir: ", "").split(", ")), 3)
        self.assertEqual(self.rodar("buscar", "zzzxxx")[1], "nenhum\n")

    def test_json(self):
        _, texto = self.rodar("buscar", "limites", "--json")
        dados = json.loads(texto)
        self.assertEqual(dados["abrir"], ["2026-10-15_limites-de-uso-do-claude-code.md"])


class TestRegistroDeUso(BaseBusca):
    def test_grava_uma_linha_por_consulta(self):
        _, texto = self.rodar("titulos", "agent")
        _, texto2 = self.rodar("cabecalho", "tokens", "--json")
        linhas = (self.base / ".log" / "consultas.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(linhas), 2)
        primeira = json.loads(linhas[0])
        self.assertEqual(set(primeira), {"data", "comando", "termos", "resultados", "caracteres", "arquivos"})
        self.assertEqual((primeira["comando"], primeira["termos"], primeira["resultados"]), ("titulos", ["agent"], 1))
        self.assertEqual(primeira["caracteres"], len(texto.rstrip("\n")))
        self.assertEqual(json.loads(linhas[1])["caracteres"], len(texto2.rstrip("\n")))

    def test_falha_ao_gravar_e_ignorada(self):
        (self.base / ".log").write_text("sou um arquivo, não uma pasta", encoding="utf-8")
        codigo, texto = self.rodar("titulos", "agent")
        self.assertEqual(codigo, 0)
        self.assertIn("agentes", texto)


class TestSinonimos(BaseBusca):
    def sinonimos(self, mapa):
        (self.base / "sinonimos.json").write_text(json.dumps(mapa, ensure_ascii=False), encoding="utf-8")

    def test_ler_normaliza_e_ignora_o_que_nao_presta(self):
        self.sinonimos({"BD": "Banco de Dados", "ia": "inteligencia-artificial", "_comentario": "ignorado", "x": "x", "vazio": "", "n": 3})
        self.assertEqual(cerebro.ler_sinonimos(self.base), {"bd": "banco-de-dados", "ia": "inteligencia-artificial"})
        (self.base / "sinonimos.json").write_text("{quebrado", encoding="utf-8")
        self.assertEqual(cerebro.ler_sinonimos(self.base), {})
        (self.base / "sinonimos.json").write_text("[1, 2]", encoding="utf-8")
        self.assertEqual(cerebro.ler_sinonimos(self.base), {})
        (self.base / "sinonimos.json").unlink()
        self.assertEqual(cerebro.ler_sinonimos(self.base), {})

    def test_expande_nos_dois_sentidos_e_em_grupos(self):
        self.sinonimos({"bd": "banco-de-dados", "db": "banco-de-dados"})
        self.assertEqual(cerebro.expandir_termos(self.base, ["bd"]), (["bd", "banco-de-dados", "db"], {"bd": ["banco-de-dados", "db"]}))
        self.assertEqual(cerebro.expandir_termos(self.base, ["banco de dados"])[0], ["banco de dados", "bd", "db"])   # o padrão achando o apelido
        self.assertEqual(cerebro.expandir_termos(self.base, ["bd", "db"])[0], ["bd", "db", "banco-de-dados"])         # não repete o que já veio
        self.assertEqual(cerebro.expandir_termos(self.base, ["nada"]), (["nada"], {}))
        (self.base / "sinonimos.json").unlink()
        self.assertEqual(cerebro.expandir_termos(self.base, ["bd"]), (["bd"], {}))

    def test_a_busca_acha_o_arquivo_pelo_apelido_e_diz_o_que_expandiu(self):
        conversa(self.base, "2026-09-01_modelagem-do-banco-de-dados.md", "banco-de-dados, tabelas, indices, sql, modelagem")
        self.assertEqual(self.rodar("titulos", "bd")[1], "nenhum\n")                    # sem o arquivo de sinônimos
        self.sinonimos({"bd": "banco-de-dados"})
        codigo, texto = self.rodar("titulos", "bd")
        self.assertEqual(texto.splitlines()[0], "sinonimos: bd -> banco-de-dados")
        self.assertIn("2026-09-01_modelagem-do-banco-de-dados.md", texto)
        dados = json.loads(self.rodar("cabecalho", "bd", "--json")[1])
        self.assertEqual(dados["sinonimos"], {"bd": ["banco-de-dados"]})
        self.assertEqual(dados["resultados"][0]["arquivo"], "2026-09-01_modelagem-do-banco-de-dados.md")
        self.assertIn("2026-09-01_modelagem-do-banco-de-dados.md", self.rodar("buscar", "bd")[1])
        # o log guarda o que VOCÊ digitou, não a expansão
        linhas = [json.loads(l) for l in (self.base / ".log" / "consultas.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertTrue(all(l["termos"] in (["bd"],) for l in linhas if l["comando"] != "ler"))

    def test_sem_expansao_a_saida_nao_muda(self):
        self.assertNotIn("sinonimos", self.rodar("titulos", "agentes")[1])
        self.sinonimos({"bd": "banco-de-dados"})
        self.assertNotIn("sinonimos", self.rodar("titulos", "agentes")[1])
        self.assertNotIn("sinonimos", self.rodar("titulos", "agentes", "--json")[1])

    def test_particulas_nao_dao_pontos(self):
        conversa(self.base, "2026-09-02_decisao-de-arquitetura-do-app.md", "decisao, arquitetura, app, x, y")
        conversa(self.base, "2026-09-03_lista-de-compras-da-semana.md", "lista, compras, semana, x, y")
        arquivos = [e["arquivo"] for e in cerebro.busca_titulos(self.base, ["banco-de-dados", "arquitetura"])]
        self.assertEqual(arquivos, ["2026-09-02_decisao-de-arquitetura-do-app.md"])   # o "de" sozinho não puxa a lista de compras


class TestLogDeArquivos(BaseBusca):
    def log(self):
        return [json.loads(l) for l in (self.base / ".log" / "consultas.jsonl").read_text(encoding="utf-8").splitlines()]

    def test_o_log_guarda_quais_arquivos_a_consulta_devolveu(self):
        self.rodar("titulos", "agentes")
        self.rodar("ler", "2026-10-15_limites-de-uso-do-claude-code.md")
        self.rodar("buscar", "limites")
        self.rodar("titulos", "zzzxxx")
        a, b, c, d = self.log()
        self.assertEqual(a["arquivos"], ["2026-10-20_agentes-do-antigravity-por-projeto.md"])
        self.assertEqual(b["arquivos"], ["2026-10-15_limites-de-uso-do-claude-code.md"])
        self.assertIn("2026-10-15_limites-de-uso-do-claude-code.md", c["arquivos"])
        self.assertNotIn("arquivos", d)          # nada devolvido: o campo nem aparece


class TestIndicePorProjeto(BaseBusca):
    def encher(self, n=110, projeto="jogo"):
        for i in range(n):
            conversa(self.base, f"2026-01-{(i % 27) + 1:02d}_assunto-numero-{i}.md", f"jogo, corrida, tema{i}, pista, carro", projeto=projeto)

    def test_com_ate_100_arquivos_nao_cria_indices_por_projeto(self):
        cerebro.escrever_indice(self.base)
        self.assertFalse((self.base / "indices").exists())

    def test_passando_de_100_gera_um_indice_por_projeto(self):
        self.encher(110)
        cerebro.escrever_indice(self.base)
        pasta = self.base / "indices"
        self.assertEqual(sorted(p.name for p in pasta.glob("*.md")), ["jogo.md", "meu-widget.md", "outro.md", "sem-projeto.md"])
        jogo = (pasta / "jogo.md").read_text(encoding="utf-8").splitlines()
        self.assertRegex(jogo[0], r"^# indice de jogo: 110 arquivos \(\d{4}-\d{2}-\d{2}\)$")
        self.assertEqual(len(jogo), 111)
        self.assertIn("2026-01-01_assunto-numero-0.md — jogo, corrida, tema0, pista, carro", jogo)
        meu = (pasta / "meu-widget.md").read_text(encoding="utf-8")
        self.assertIn("estado/meu-widget.md", meu)
        self.assertEqual(cerebro.validar(self.base) and [p for a, p in cerebro.validar(self.base) if "indices" in a], [])   # a pasta nova não vira "problema"

    def test_titulos_com_projeto_consulta_primeiro_o_indice_e_nao_varre_as_pastas(self):
        self.encher(110)
        cerebro.escrever_indice(self.base)
        with mock.patch.object(cerebro, "_escanear", side_effect=AssertionError("varreu as pastas")):
            res = cerebro.busca_titulos(self.base, ["corrida", "tema7"], "jogo", 5)
        self.assertEqual(res[0]["arquivo"], "2026-01-08_assunto-numero-7.md")           # palavra-chave "tema7" só existe no índice
        self.assertTrue(all(e["via"] == "indice" for e in res))
        codigo, texto = self.rodar("titulos", "tema7", "--projeto", "jogo", "--json")
        self.assertEqual(json.loads(texto)["indice"], "indices/jogo.md")

    def test_sem_resultado_no_indice_cai_na_varredura_normal(self):
        self.encher(110)
        cerebro.escrever_indice(self.base)
        res = cerebro.busca_titulos(self.base, ["agentes"], "jogo", 5)        # o arquivo é de OUTRO projeto: o índice do jogo não tem
        self.assertEqual([e["arquivo"] for e in res], ["2026-10-20_agentes-do-antigravity-por-projeto.md"])
        self.assertNotIn("via", res[0])

    def test_indice_velho_e_ignorado(self):
        self.encher(110)
        cerebro.escrever_indice(self.base)
        indice = self.base / "indices" / "jogo.md"
        conversa(self.base, "2026-02-01_arquivo-novo-que-o-indice-nao-conhece.md", "novo, x, y, z, w", projeto="jogo")
        velho = os.stat(self.base / "conversas").st_mtime_ns - 10 ** 10
        os.utime(indice, ns=(velho, velho))                                          # o índice é de antes da última mudança na pasta
        self.assertIsNone(cerebro.indice_do_projeto(self.base, "jogo"))
        res = cerebro.busca_titulos(self.base, ["conhece"], "jogo", 5)
        self.assertEqual([e["arquivo"] for e in res], ["2026-02-01_arquivo-novo-que-o-indice-nao-conhece.md"])
        cerebro.escrever_indice(self.base)                                          # reindexar: volta a valer
        self.assertIsNotNone(cerebro.indice_do_projeto(self.base, "jogo"))

    def test_sem_projeto_ou_sem_indice_nada_muda(self):
        self.encher(110)
        cerebro.escrever_indice(self.base)
        self.assertNotIn("via", cerebro.busca_titulos(self.base, ["assunto"], None, 3)[0])
        (self.base / "indices" / "jogo.md").unlink()
        self.assertNotIn("via", cerebro.busca_titulos(self.base, ["assunto"], "jogo", 3)[0])
        self.assertIsNone(cerebro.indice_do_projeto(self.base, "projeto-que-nao-existe"))


class TestPainel(BaseBusca):
    def test_projetos_dos_cabecalhos_e_do_estado(self):
        conversa(self.base, "2026-10-09_conversa-de-outro-projeto.md", "a, b, c", projeto="Pokedex Nova")
        projetos, origem = cerebro.listar_projetos(self.base)
        self.assertEqual(origem, "cabecalhos")
        # "Meu-Widget" e o arquivo estado/meu-widget.md viram um só; o texto do projeto vira sem-acento com hífen
        self.assertEqual(projetos, ["meu-widget", "outro", "pokedex-nova"])

    def test_projetos_json_tem_prioridade_e_aceita_formatos(self):
        for conteudo, esperado in (
            ('["Widget Novo", "cerebro"]', ["widget-novo", "cerebro"]),
            ('{"projetos": [{"nome": "App Um"}, {"projeto": "App Dois"}, 7]}', ["app-um", "app-dois"]),
            ('{"alfa": {}, "beta": {}}', ["alfa", "beta"]),
        ):
            with self.subTest(conteudo=conteudo):
                (self.base / "projetos.json").write_text(conteudo, encoding="utf-8")
                self.assertEqual(cerebro.listar_projetos(self.base), (esperado, "projetos.json"))
        (self.base / "projetos.json").write_text("{quebrado", encoding="utf-8")  # inválido: volta aos cabeçalhos
        self.assertEqual(cerebro.listar_projetos(self.base)[1], "cabecalhos")

    def test_estatisticas(self):
        est = cerebro.estatisticas(self.base)
        self.assertEqual((est["arquivos"], est["conversas"], est["estados"]), (7, 6, 1))
        self.assertEqual(est["ultima_compactacao"], "2026-10-28")
        tamanho = sum(p.stat().st_size for pasta in ("conversas", "estado") for p in (self.base / pasta).iterdir())
        self.assertEqual(est["kb"], round(tamanho / 1024, 1))
        vazio = self.base.parent / "vazio"
        self.assertEqual(cerebro.estatisticas(vazio), {"arquivos": 0, "conversas": 0, "estados": 0, "kb": 0, "ultima_compactacao": None})

    def test_info_estado_e_painel(self):
        e = cerebro.info_estado(self.base, "Meu Widget")
        self.assertEqual((e["arquivo"], e["objetivo"]), ("estado/meu-widget.md", "Widget leve."))
        self.assertRegex(e["atualizado"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertIsNone(cerebro.info_estado(self.base, "nao-existe"))
        p = cerebro.painel(self.base, "meu-widget")
        self.assertEqual(set(p), {"dir", "projetos", "origem_projetos", "estatisticas", "estado"})
        self.assertIsNone(cerebro.painel(self.base)["estado"])

    def test_buscar_com_limite_e_palavras(self):
        for i in range(8):
            conversa(self.base, f"2026-09-1{i}_planejamento-geral-{i}.md", f"planejamento, geral, item{i}")
        d = cerebro.buscar(self.base, ["planejamento", "geral"], limite=8, com_palavras=True)
        self.assertEqual(len(d["candidatos"]), 8)
        self.assertTrue(all(e["palavras_chave"] for e in d["candidatos"]))  # mesmo no caminho só-títulos
        self.assertEqual(len(d["abrir"]), 3)
        self.assertEqual(len(cerebro.buscar(self.base, ["planejamento", "geral"])["candidatos"]), 5)
        self.assertIsNone(cerebro.buscar(self.base, ["planejamento", "geral"])["candidatos"][0]["palavras_chave"])

    def test_cli_painel_e_ler_json(self):
        saida = io.StringIO()
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(saida):
            self.assertEqual(cerebro.main(["painel", "--projeto", "meu-widget", "--json"]), 0)
            dados = json.loads(saida.getvalue())
            self.assertEqual(dados["estado"]["arquivo"], "estado/meu-widget.md")
            saida.truncate(0), saida.seek(0)
            cerebro.main(["ler", "estado/meu-widget.md", "--json"])
        arq = json.loads(saida.getvalue())["arquivos"][0]
        self.assertEqual(arq["arquivo"], "estado/meu-widget.md")
        self.assertRegex(arq["atualizado"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertIn("# Objetivo", arq["conteudo"])


ESTADO_NOVO = ESTADO_OK.replace("Fase 1.", "Fase 1.4.")


class TestSalvar(BaseBusca):
    def salvar(self, corpo="- decidimos X\n- falta Y", **kw):
        args = dict(titulo="Compactação de conversas no cérebro", palavras="meu-widget, cerebro, python, salvar, resumo",
                    origem="claude-code", projeto="Meu Widget", hoje="2026-10-28")
        args.update(kw)
        return cerebro.salvar_conversa(self.base, corpo=corpo, **args)

    def test_nome_formato_e_validacao(self):
        destino = self.salvar(corpo="- decidimos X   \r\n- falta Y\r\n")
        self.assertEqual(destino.name, "2026-10-28_compactacao-de-conversas-no-cerebro.md")
        self.assertEqual(destino.read_text(encoding="utf-8"),
                         "palavras-chave: meu-widget, cerebro, python, salvar, resumo\n"
                         "data: 2026-10-28 | origem: claude-code | projeto: meu-widget\n\n- decidimos X\n- falta Y\n")
        self.assertNotIn("conversas/" + destino.name, self.problemas())

    def test_nome_repetido_ganha_sufixo(self):
        nomes = [self.salvar().name for _ in range(3)]
        self.assertEqual(nomes[1:], ["2026-10-28_compactacao-de-conversas-no-cerebro-2.md",
                                     "2026-10-28_compactacao-de-conversas-no-cerebro-3.md"])

    def test_recusas_em_uma_linha(self):
        casos = [
            (dict(titulo="curto demais"), "título com 2 palavras (use de 3 a 6)"),
            (dict(titulo="um dois tres quatro cinco seis sete"), "título com 7 palavras"),
            (dict(palavras="a,b"), "2 palavras-chave (mínimo 3, máximo 10)"),
            (dict(corpo="palavra " * 151), "corpo com 151 palavras (máximo 150)"),
            (dict(corpo="  \n "), "corpo vazio"),
            (dict(origem=""), "linha 2 sem origem"),
            (dict(corpo="- chave sk-abcdefghijklmnop1234"), "possível chave de API no texto: troque por [removido]"),
            (dict(corpo="- falar com fulano@empresa.com"), "possível e-mail"),
            (dict(corpo="- senha: hunter2hunter2"), "possível senha ou token"),
        ]
        for kw, esperado in casos:
            with self.subTest(esperado=esperado):
                with self.assertRaises(ValueError) as erro:
                    self.salvar(**kw)
                self.assertIn(esperado, str(erro.exception))
                self.assertNotIn("\n", str(erro.exception))
        self.assertFalse(any("compactacao" in p.name for p in (self.base / "conversas").iterdir()))

    def test_estado_sobrescreve_e_guarda_5_anteriores(self):
        anteriores = self.base / "estado" / ".anteriores"
        for i in range(7):
            cerebro.salvar_estado(self.base, "meu-widget", ESTADO_NOVO.replace("CPU.", f"CPU {i}."), hoje="2026-10-28")
        self.assertIn("CPU 6.", (self.base / "estado" / "meu-widget.md").read_text(encoding="utf-8"))
        guardadas = sorted(p.name for p in anteriores.iterdir())
        self.assertEqual(len(guardadas), 5)
        # a mais antiga (o ESTADO_OK original, guardado primeiro) já foi descartada
        textos = [(anteriores / n).read_text(encoding="utf-8") for n in guardadas]
        self.assertFalse(any("Fase 1.\n" in t for t in textos))
        self.assertTrue(any("CPU 5." in t for t in textos))
        self.assertNotIn("estado/meu-widget.md", self.problemas())  # .anteriores não entra no validar

    def test_estado_recusa_sem_secoes_ou_longo(self):
        with self.assertRaises(ValueError) as erro:
            cerebro.salvar_estado(self.base, "meu-widget", "# Objetivo\nSó isso.")
        self.assertIn("faltam seções: Stack, Decisões", str(erro.exception))
        with self.assertRaises(ValueError) as erro:
            cerebro.salvar_estado(self.base, "meu-widget", ESTADO_OK + "x " * 300)
        self.assertIn("palavras (máximo 300)", str(erro.exception))
        self.assertEqual((self.base / "estado" / "meu-widget.md").read_text(encoding="utf-8"), ESTADO_OK)

    def rodar_com_entrada(self, entrada, *argv):
        saida, erro = io.StringIO(), io.StringIO()
        stdin = io.TextIOWrapper(io.BytesIO(entrada.encode("utf-8")), encoding="utf-8")
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), mock.patch("sys.stdin", stdin), \
                contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
            codigo = cerebro.main(list(argv))
        return codigo, saida.getvalue(), erro.getvalue()

    def test_cli_salva_imprime_so_o_nome_e_atualiza_indice(self):
        codigo, saida, _ = self.rodar_com_entrada(
            "- ação com acento ✓\n", "salvar", "--titulo", "teste da linha de comando",
            "--palavras", "a1,b2,c3", "--origem", "claude-code", "--projeto", "meu-widget")
        nome = saida.strip()
        self.assertEqual(codigo, 0)
        self.assertRegex(nome, r"^\d{4}-\d{2}-\d{2}_teste-da-linha-de-comando\.md$")
        self.assertIn("ação com acento ✓", (self.base / "conversas" / nome).read_text(encoding="utf-8"))
        self.assertIn(f"{nome} — a1, b2, c3", (self.base / "INDICE.md").read_text(encoding="utf-8"))

    def test_cli_salvar_com_data_original(self):
        codigo, saida, _ = self.rodar_com_entrada(
            "- decisão antiga\n", "salvar", "--titulo", "conversa antiga importada", "--palavras", "a1,b2,c3",
            "--origem", "chatgpt", "--projeto", "geral", "--data", "2023-05-17")
        self.assertEqual((codigo, saida), (0, "2023-05-17_conversa-antiga-importada.md\n"))
        self.assertIn("data: 2023-05-17 | origem: chatgpt | projeto: geral", (self.base / "conversas" / saida.strip()).read_text(encoding="utf-8"))
        codigo, _, erro = self.rodar_com_entrada("- x", "salvar", "--titulo", "conversa antiga importada", "--palavras", "a1,b2,c3",
                                                 "--origem", "chatgpt", "--projeto", "geral", "--data", "17/05/2023")
        self.assertEqual((codigo, "--data inválida" in erro), (2, True))

    def test_cli_estado_e_recusa(self):
        codigo, saida, _ = self.rodar_com_entrada(ESTADO_NOVO, "salvar", "--projeto", "meu-widget", "--estado")
        self.assertEqual((codigo, saida), (0, "estado/meu-widget.md\n"))
        codigo, saida, erro = self.rodar_com_entrada("- x", "salvar", "--projeto", "p", "--titulo", "so dois")
        self.assertEqual((codigo, saida), (2, ""))
        self.assertEqual(erro, "erro: recusado: falta --palavras, --origem\n")


class TestOrigens(BaseBusca):
    """Convenção de origem (10.7): claude-code e antigravity (as IAs do widget) e claude, chatgpt, gemini (chats de sites e apps)."""
    ORIGENS = ("claude-code", "antigravity", "claude", "chatgpt", "gemini")

    def salvar(self, origem, titulo="resumo curto de teste"):
        return cerebro.salvar_conversa(self.base, titulo, "meu-widget, cerebro, python, teste, resumo", origem, "Meu Widget",
                                       "- decisão com acento ✓\n- pendente: medir", hoje="2026-10-29")

    def test_todas_as_origens_salvam_e_o_validar_aceita(self):
        for origem in self.ORIGENS:
            with self.subTest(origem=origem):
                destino = self.salvar(origem, titulo=f"resumo de teste {origem}")
                self.assertIn(f"data: 2026-10-29 | origem: {origem} | projeto: meu-widget", destino.read_text(encoding="utf-8"))
                self.assertEqual(cerebro.ler_cabecalho(destino)["origem"], origem)
                self.assertNotIn("conversas/" + destino.name, self.problemas())

    def test_cli_salvar_e_validar_com_origem_antigravity(self):
        entrada = io.TextIOWrapper(io.BytesIO("- ação com acento ✓\n- pendente: medir\n".encode("utf-8")), encoding="utf-8")
        saida, erro = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), mock.patch("sys.stdin", entrada), \
                contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
            codigo = cerebro.main(["salvar", "--titulo", "compactar no antigravity", "--palavras", "a1,b2,c3", "--origem", "antigravity",
                                   "--projeto", "meu-widget"])
        self.assertEqual(codigo, 0, erro.getvalue())
        arquivo = self.base / "conversas" / saida.getvalue().strip()
        self.assertIn("origem: antigravity | projeto: meu-widget", arquivo.read_text(encoding="utf-8"))
        saida = io.StringIO()  # a base de teste tem arquivos ruins de propósito: o que importa é que o novo NÃO apareça nos problemas
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(saida):
            cerebro.main(["validar"])
        self.assertNotIn(arquivo.name, saida.getvalue())

    def test_a_origem_nao_muda_o_indice_nem_a_busca(self):
        a = self.salvar("claude-code", titulo="resumo de teste um")
        b = self.salvar("antigravity", titulo="resumo de teste dois")
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(io.StringIO()):
            cerebro.main(["indice"])
        indice = (self.base / "INDICE.md").read_text(encoding="utf-8")
        self.assertIn(f"{a.name} — meu-widget, cerebro, python, teste, resumo", indice)
        self.assertIn(f"{b.name} — meu-widget, cerebro, python, teste, resumo", indice)
        self.assertNotIn("origem", indice)  # o índice agrupa por projeto: a origem não aparece


class TestDesempenho(unittest.TestCase):
    """1000 arquivos falsos: cada consulta precisa responder em menos de 200 ms."""
    LIMITE = 0.2

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.tmp.name) / "cerebro"
        (cls.base / "conversas").mkdir(parents=True)
        (cls.base / "estado").mkdir()
        assuntos = ["servidor", "widget", "banco", "tela", "musica", "pokemon", "terminal", "config", "teste", "build"]
        for i in range(1000):
            nome = f"2026-{i % 12 + 1:02d}-{i % 28 + 1:02d}_{assuntos[i % 10]}-{assuntos[i % 7]}-numero-{i}.md"
            conversa(cls.base, nome, f"{assuntos[i % 10]}, {assuntos[i % 7]}, caso{i}, extra, mais",
                     projeto=f"proj{i % 5}", corpo="- um topico qualquer\n" * 8)
        (cls.base / "estado" / "proj1.md").write_text(ESTADO_OK, encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def medir(self, *argv):
        """Melhor de 3 execuções completas da linha de comando (inclui gravar o registro)."""
        melhor = 99.0
        for _ in range(3):
            saida = io.StringIO()
            with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)}), contextlib.redirect_stdout(saida):
                t0 = time.perf_counter()
                cerebro.main(list(argv))
                melhor = min(melhor, time.perf_counter() - t0)
        return melhor

    def test_titulos(self):
        self.assertLess(self.medir("titulos", "servidor", "widget", "--projeto", "proj1"), self.LIMITE)

    def test_cabecalho_em_todos_os_1000(self):
        self.assertLess(self.medir("cabecalho", "caso500", "pokemon"), self.LIMITE)

    def test_buscar_com_cabecalhos(self):
        self.assertLess(self.medir("buscar", "caso500", "--projeto", "proj1"), self.LIMITE)


if __name__ == "__main__":
    unittest.main()
