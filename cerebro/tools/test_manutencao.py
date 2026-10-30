# -*- coding: utf-8 -*-
"""Testes do manutencao.py (diagnóstico, sinônimos, consolidação, estado, índices e backup). Dados inventados, pasta temporária.
A IA é sempre um stand-in (ou o claude FALSO de test_importar): nenhum token é gasto. Rodar: python cerebro/tools/test_manutencao.py"""
import contextlib
import datetime
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402
import importar  # noqa: E402
import manutencao  # noqa: E402
import tokens  # noqa: E402
from test_importar import FAKE_CLAUDE  # noqa: E402

HOJE = datetime.date(2026, 10, 28)
ESTADO = ("## Objetivo\nJogo de corrida.\n## Stack\nRoblox.\n## Decisões\nRaycast.\n## Estado atual\nCarro anda.\n"
          "## Próximos passos\nCurvas.\n## Armadilhas\nNada.\n")
ESTADO_NOVO = ("## Objetivo\nJogo de corrida no Roblox.\n## Stack\nRoblox e Luau.\n## Decisões\nRaycast para colisão; placar no servidor.\n"
               "## Estado atual\nCarro anda e freia.\n## Próximos passos\nCurvas e placar.\n## Armadilhas\nFísica no cliente dessincroniza.\n")


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)
        self.base = self.raiz / "cerebro"
        for d in ("conversas", "estado", ".log", "tools"):
            (self.base / d).mkdir(parents=True)
        for patch in (mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base), "PROJETOS_JSON": str(self.raiz / "nao-existe.json")}),
                      mock.patch.object(tokens, "ler_config_tokens", return_value=None)):
            patch.start()
            self.addCleanup(patch.stop)

    def conversa(self, data, slug, chaves, projeto="jogo", origem="claude", corpo="- topico de resumo\n"):
        nome = f"{data}_{slug}.md"
        (self.base / "conversas" / nome).write_text(f"palavras-chave: {chaves}\ndata: {data} | origem: {origem} | projeto: {projeto}\n\n{corpo}", encoding="utf-8")
        return nome

    def estado(self, projeto="jogo", texto=ESTADO, dias=0):
        arq = self.base / "estado" / f"{projeto}.md"
        arq.write_text(texto, encoding="utf-8")
        if dias:
            quando = (datetime.datetime.combine(HOJE, datetime.time(12)) - datetime.timedelta(days=dias)).timestamp()
            os.utime(arq, (quando, quando))
        return arq

    def log(self, linhas):
        (self.base / ".log" / "consultas.jsonl").write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in linhas), encoding="utf-8")

    def arquivos(self, pasta="conversas"):
        return sorted(p.name for p in (self.base / pasta).glob("*.md"))

    def diag(self):
        return manutencao.diagnostico(self.base, HOJE)


class TestDiagnostico(Base):
    def test_cerebro_vazio(self):
        d = self.diag()
        self.assertEqual((d["tamanho"]["arquivos"], d["nunca_consultados"]["total"], d["palavras_quase_iguais"], d["similares"]["total_grupos"], d["estados_velhos"]["total"]), (0, 0, [], 0, 0))
        self.assertFalse(d["indices"]["devem_existir"])

    def test_tamanho_total_por_pasta_sem_a_tools(self):
        self.conversa("2026-10-01", "um", "a1, b2, c3")
        self.estado()
        (self.base / ".log" / "x.jsonl").write_text("x" * 1000, encoding="utf-8")
        (self.base / "tools" / "codigo.py").write_text("y" * 5000, encoding="utf-8")
        MORTO = "arquivo-morto"
        (self.base / MORTO).mkdir()
        (self.base / MORTO / "velho.md").write_text("z" * 300, encoding="utf-8")
        t = self.diag()["tamanho"]
        self.assertEqual((t["conversas"], t["arquivos"]), (1, 2))
        self.assertNotIn("tools", t["por_pasta"])
        self.assertEqual((t["por_pasta"][".log"]["bytes"], t["por_pasta"][MORTO]["bytes"]), (1000, 300))
        self.assertEqual(t["bytes"], sum(p["bytes"] for p in t["por_pasta"].values()))
        self.assertEqual(t["mb"], round(t["bytes"] / 1024 / 1024, 2))

    def test_nunca_consultados_cruza_com_o_log(self):
        velho_lido = self.conversa("2026-01-10", "lido-pelo-ler", "a1, b2, c3")
        velho_no_resultado = self.conversa("2026-02-01", "apareceu-num-resultado", "a1, b2, c3")
        velho_esquecido = self.conversa("2026-03-05", "ninguem-abriu-este", "a1, b2, c3")
        self.conversa("2026-09-01", "recente-ainda-vale", "a1, b2, c3")       # menos de 6 meses: não entra
        self.log([{"data": "2026-09-01T10:00:00", "comando": "ler", "termos": [f"conversas/{velho_lido}"], "resultados": 1, "caracteres": 10},
                  {"data": "2026-09-02T10:00:00", "comando": "titulos", "termos": ["x"], "resultados": 1, "caracteres": 10, "arquivos": [velho_no_resultado.upper().replace(".MD", ".md")]}])
        n = self.diag()["nunca_consultados"]
        self.assertEqual([a["arquivo"] for a in n["lista"]], [velho_esquecido])
        self.assertEqual((n["total"], n["lista"][0]["dias"], n["lista"][0]["projeto"]), (1, (HOJE - datetime.date(2026, 3, 5)).days, "jogo"))

    def test_log_curto_nao_prova_nada(self):
        self.conversa("2026-01-10", "antigo", "a1, b2, c3")
        n = self.diag()["nunca_consultados"]
        self.assertFalse(n["confiavel"])
        self.assertIn("não prova", n["aviso"])
        self.log([{"data": "2026-08-01T10:00:00", "comando": "titulos", "termos": ["x"], "resultados": 0, "caracteres": 1, "arquivos": ["outro.md"]}])
        n = self.diag()["nunca_consultados"]
        self.assertTrue(n["confiavel"] and n["aviso"] == "")
        self.assertEqual((n["log"]["desde"], n["log"]["com_arquivos"]), ("2026-08-01", 1))

    def test_estados_com_mais_de_30_dias(self):
        self.estado("velho", dias=45)
        self.estado("jogo", dias=10)
        self.estado("limite", dias=30)       # exatamente 30: ainda não passou
        ev = self.diag()["estados_velhos"]
        self.assertEqual([(e["projeto"], e["dias"]) for e in ev["lista"]], [("velho", 45)])
        self.assertEqual(ev["total"], 1)

    def test_estados_com_conversas_antigas_para_propor_atualizacao(self):
        self.estado("jogo")
        self.conversa("2026-01-10", "antiga", "a1, b2, c3")
        self.conversa("2026-10-20", "recente", "a1, b2, c3")
        self.conversa("2026-01-11", "sem-estado", "a1, b2, c3", projeto="outro")
        self.assertEqual(self.diag()["estados_com_conversas_antigas"], [{"projeto": "jogo", "conversas_antigas": 1}])


class TestPalavrasQuaseIguais(Base):
    def grupos(self, contagem, sinonimos=None):
        g, s = manutencao.palavras_quase_iguais(contagem, sinonimos)
        return {frozenset(t["palavra"] for t in x["termos"]): x for x in g}, s

    def test_plural_hifen_digitacao_e_abreviacao(self):
        g, s = self.grupos({"agente": 3, "agentes": 8, "claude-md": 2, "claudemd": 1, "arquitetura": 5, "arquiteura": 1,
                            "bd": 2, "banco-de-dados": 6, "ia": 4, "inteligencia-artificial": 3, "decisoes": 4, "decisao": 2,
                            "css": 5, "csv": 2, "api": 3, "app": 3, "python": 9})
        self.assertEqual(set(g), {frozenset({"agente", "agentes"}), frozenset({"claude-md", "claudemd"}), frozenset({"arquitetura", "arquiteura"}),
                                  frozenset({"bd", "banco-de-dados"}), frozenset({"ia", "inteligencia-artificial"}), frozenset({"decisoes", "decisao"})})
        self.assertEqual(g[frozenset({"agente", "agentes"})]["sugerido"], "agentes")             # o mais usado
        self.assertEqual(g[frozenset({"arquitetura", "arquiteura"})]["sugerido"], "arquitetura")
        self.assertEqual(g[frozenset({"bd", "banco-de-dados"})]["sugerido"], "banco-de-dados")   # sigla -> forma completa
        self.assertEqual(g[frozenset({"bd", "banco-de-dados"})]["regras"], ["abreviacao"])
        self.assertEqual(g[frozenset({"agente", "agentes"})]["regras"], ["plural"])
        pares = {x["apelido"]: x["padrao"] for x in s}
        self.assertEqual(pares["bd"], "banco-de-dados")
        self.assertEqual(pares["ia"], "inteligencia-artificial")
        self.assertEqual(pares["agente"], "agentes")
        self.assertNotIn("banco-de-dados", pares)

    def test_nao_sugere_o_que_ja_esta_no_sinonimos(self):
        _, s = self.grupos({"bd": 2, "banco-de-dados": 6}, {"bd": "banco-de-dados"})
        self.assertEqual(s, [])

    def test_palavras_com_numero_nao_sao_erro_de_digitacao(self):
        g, s = self.grupos({"versao1": 3, "versao2": 3, "unico1": 1, "unico3": 1, "fase10": 2, "fase11": 2})
        self.assertEqual((g, s), ({}, []))

    def test_grupo_com_3_variantes_e_contagem(self):
        g, s = self.grupos({"agente": 1, "agentes": 2, "agentess": 1})
        (x,) = g.values()
        self.assertEqual([t["palavra"] for t in x["termos"]], ["agentes", "agente", "agentess"])
        self.assertEqual({y["apelido"] for y in s}, {"agente", "agentess"})

    def test_pelo_diagnostico_e_com_os_arquivos_reais(self):
        self.conversa("2026-10-01", "um", "agente, banco-de-dados, tela")
        self.conversa("2026-10-02", "dois", "agentes, bd, tela")
        d = self.diag()
        self.assertEqual({(s["apelido"], s["padrao"]) for s in d["sinonimos_sugeridos"]}, {("agentes", "agente"), ("bd", "banco-de-dados")})   # empate: o singular fica


class TestParecidos(Base):
    def test_80_por_cento_no_mesmo_projeto(self):
        a = self.conversa("2026-01-01", "a", "um, dois, tres, quatro, cinco")
        b = self.conversa("2026-01-02", "b", "um, dois, tres, quatro, cinco, seis")           # 5/6 = 0,83
        self.conversa("2026-01-03", "c", "um, dois, tres, quatro, sete")                      # 4/6 = 0,67 com a semente: fora
        self.conversa("2026-01-04", "outro-projeto", "um, dois, tres, quatro, cinco", projeto="outro")
        self.conversa("2026-01-05", "poucas", "um, dois")                                    # menos de 3 palavras-chave: não entra
        g = self.diag()["similares"]
        self.assertEqual(g["total_grupos"], 1)
        (grupo,) = g["grupos"]
        self.assertEqual((grupo["projeto"], [x["arquivo"] for x in grupo["arquivos"]]), ("jogo", [a, b]))
        self.assertEqual(grupo["arquivos"][1]["similaridade"], 0.83)
        self.assertRegex(grupo["id"], r"^[0-9a-f]{10}$")
        self.assertGreater(g["tokens_entrada"], 0)
        self.assertEqual((g["chamadas"], g["tokens_saida"]), (1, manutencao.SAIDA_CONSOLIDADO))

    def test_o_grupo_nao_se_estica_em_cadeia_e_tem_tamanho_maximo(self):
        for i in range(11):
            self.conversa(f"2026-02-{i + 1:02d}", f"igual-{i}", "um, dois, tres, quatro, cinco")
        grupos = self.diag()["similares"]["grupos"]
        self.assertEqual(sorted(len(g["arquivos"]) for g in grupos), [3, 8])
        self.assertEqual(len({g["id"] for g in grupos}), 2)

    def test_id_nao_depende_da_ordem(self):
        self.conversa("2026-01-01", "a", "um, dois, tres, quatro, cinco")
        self.conversa("2026-01-02", "b", "um, dois, tres, quatro, cinco")
        id1 = self.diag()["similares"]["grupos"][0]["id"]
        self.assertEqual(manutencao.localizar_grupo(self.base, id1)["id"], id1)
        with self.assertRaises(ValueError):
            manutencao.localizar_grupo(self.base, "0000000000")


class TestSinonimos(Base):
    def test_aprovar_acrescenta_valida_e_preserva_o_resto(self):
        (self.base / "sinonimos.json").write_text(json.dumps({"_comentario": "meu arquivo", "ia": "inteligencia-artificial"}), encoding="utf-8")
        r = manutencao.aprovar_sinonimos(self.base, {"BD": "Banco de Dados", "ia": "outra-coisa", "x": "x", "": "y"})
        self.assertEqual(r["adicionados"], ["bd"])
        self.assertEqual(len(r["ignorados"]), 3)
        self.assertEqual(r["total"], 2)
        bruto = json.loads((self.base / "sinonimos.json").read_text(encoding="utf-8"))
        self.assertEqual(bruto, {"_comentario": "meu arquivo", "ia": "inteligencia-artificial", "bd": "banco-de-dados"})
        self.assertEqual(cerebro.expandir_termos(self.base, ["bd"])[0], ["bd", "banco-de-dados"])
        with self.assertRaises(ValueError):
            manutencao.aprovar_sinonimos(self.base, {})

    def test_cria_o_arquivo_e_remove(self):
        self.assertFalse((self.base / "sinonimos.json").exists())
        manutencao.aprovar_sinonimos(self.base, {"bd": "banco-de-dados", "db": "banco-de-dados"})
        self.assertEqual(manutencao.remover_sinonimo(self.base, "BD"), {"removido": "bd", "total": 1})
        self.assertEqual(cerebro.ler_sinonimos(self.base), {"db": "banco-de-dados"})
        with self.assertRaises(ValueError):
            manutencao.remover_sinonimo(self.base, "nao-existe")

    def test_diagnostico_mostra_os_atuais(self):
        manutencao.aprovar_sinonimos(self.base, {"bd": "banco-de-dados"})
        self.assertEqual(self.diag()["sinonimos"], {"bd": "banco-de-dados"})


def resposta_boa(titulo="decisões do código de colisão", projeto="geral", corpo="- decisão consolidada\n- falta testar"):
    return f"titulo: {titulo}\npalavras-chave: a1, b2, c3, d4, e5\nprojeto: {projeto}\n\n{corpo}"


class IAFalsa:
    def __init__(self, respostas=None, erro=None):
        self.mensagens, self.respostas, self.erro = [], list(respostas or []), erro

    def __call__(self, sistema, mensagem):
        self.mensagens.append(mensagem)
        if self.erro:
            raise self.erro
        return {"texto": self.respostas.pop(0) if self.respostas else resposta_boa(), "entrada": 500, "saida": 100, "custo_usd": 0.001, "medido": True}


class TestConsolidar(Base):
    def montar(self):
        self.a = self.conversa("2026-01-01", "primeira-versao", "um, dois, tres, quatro, cinco", corpo="- usar raycast\n")
        self.b = self.conversa("2026-02-10", "segunda-versao", "um, dois, tres, quatro, cinco", corpo="- raycast confirmado\n")
        self.conversa("2026-03-01", "outro-assunto", "x1, x2, x3, x4, x5")
        return self.diag()["similares"]["grupos"][0]["id"]

    def test_gera_o_consolidado_move_os_originais_e_nao_apaga(self):
        gid = self.montar()
        ia = IAFalsa()
        r = manutencao.consolidar_grupo(self.base, gid, chamar=ia)
        self.assertEqual((r["originais"], r["projeto"], r["tokens"]["entrada"]), ([self.a, self.b], "jogo", 500))
        self.assertEqual(self.arquivos(), ["2026-02-10_decisoes-do-codigo-de-colisao.md", "2026-03-01_outro-assunto.md"])   # data do MAIS RECENTE
        self.assertEqual(self.arquivos("arquivo-morto"), [self.a, self.b])                                                   # movidos, não apagados
        texto = (self.base / "conversas" / r["consolidado"]).read_text(encoding="utf-8")
        self.assertIn("data: 2026-02-10 | origem: claude | projeto: jogo", texto)
        self.assertIn("- decisão consolidada", texto)
        self.assertEqual(cerebro.validar(self.base), [])
        manifesto = [json.loads(l) for l in (self.base / "arquivo-morto" / "consolidacoes.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual((manifesto[0]["consolidado"], manifesto[0]["originais"], manifesto[0]["modelo"]), (r["consolidado"], [self.a, self.b], "haiku"))
        self.assertIn(r["consolidado"], (self.base / "INDICE.md").read_text(encoding="utf-8"))
        self.assertNotIn(self.a, (self.base / "INDICE.md").read_text(encoding="utf-8"))
        # o texto enviado leva os dois resumos, as datas e o projeto
        m = ia.mensagens[0]
        self.assertTrue("Projeto: jogo" in m and "usar raycast" in m and "raycast confirmado" in m and "data 2026-02-10" in m)

    def test_origens_diferentes_viram_outro_e_projeto_vem_do_grupo(self):
        self.conversa("2026-01-01", "a", "um, dois, tres, quatro, cinco", origem="claude")
        self.conversa("2026-01-02", "b", "um, dois, tres, quatro, cinco", origem="chatgpt")
        gid = self.diag()["similares"]["grupos"][0]["id"]
        r = manutencao.consolidar_grupo(self.base, gid, chamar=IAFalsa([resposta_boa(projeto="invencionado")]))
        texto = (self.base / "conversas" / r["consolidado"]).read_text(encoding="utf-8")
        self.assertIn("origem: outro | projeto: jogo", texto)

    def test_formato_recusado_ganha_1_correcao_e_se_falhar_nada_e_movido(self):
        gid = self.montar()
        ia = IAFalsa([resposta_boa(titulo="so dois"), resposta_boa()])
        manutencao.consolidar_grupo(self.base, gid, chamar=ia)
        self.assertEqual(len(ia.mensagens), 2)
        self.assertIn("RECUSADA", ia.mensagens[1])
        self.assertEqual(len(self.arquivos("arquivo-morto")), 2)
        # de novo, agora recusando as duas vezes
        self.conversa("2026-04-01", "terceira", "um, dois, tres, quatro, cinco", projeto="outro")
        self.conversa("2026-04-02", "quarta", "um, dois, tres, quatro, cinco", projeto="outro")
        gid2 = next(g["id"] for g in self.diag()["similares"]["grupos"] if g["projeto"] == "outro")
        antes = self.arquivos()
        ia2 = IAFalsa([resposta_boa(titulo="so dois")] * 2)
        with self.assertRaises(ValueError) as e:
            manutencao.consolidar_grupo(self.base, gid2, chamar=ia2)
        self.assertIn("recusado duas vezes (nada foi movido)", str(e.exception))
        self.assertEqual((self.arquivos(), len(ia2.mensagens)), (antes, 2))

    def test_limite_de_uso_e_erro_claro_e_nada_muda(self):
        gid = self.montar()
        antes = self.arquivos()
        with self.assertRaises(ValueError) as e:
            manutencao.consolidar_grupo(self.base, gid, chamar=IAFalsa(erro=importar.ParouTudo("limite", "5-hour limit reached")))
        self.assertTrue(str(e.exception).startswith("[limite] limite de uso atingido"))
        self.assertEqual((self.arquivos(), self.arquivos("arquivo-morto") if (self.base / "arquivo-morto").exists() else []), (antes, []))

    def test_nome_repetido_no_arquivo_morto_nao_sobrescreve(self):
        gid = self.montar()
        (self.base / "arquivo-morto").mkdir()
        (self.base / "arquivo-morto" / self.a).write_text("de uma consolidação anterior", encoding="utf-8")
        manutencao.consolidar_grupo(self.base, gid, chamar=IAFalsa())
        self.assertEqual((self.base / "arquivo-morto" / self.a).read_text(encoding="utf-8"), "de uma consolidação anterior")
        self.assertEqual(len(self.arquivos("arquivo-morto")), 3)

    def test_o_arquivo_morto_nao_e_buscado_nem_validado(self):
        gid = self.montar()
        manutencao.consolidar_grupo(self.base, gid, chamar=IAFalsa())
        self.assertEqual(cerebro.busca_titulos(self.base, ["primeira"]), [])


class TestEstado(Base):
    def montar(self, dias=45):
        self.estado("jogo", dias=dias)
        self.conversa("2026-01-10", "decisao-do-raycast", "jogo, raycast, colisao, carro, fisica", corpo="- decidimos raycast\n")
        self.conversa("2026-02-10", "placar-no-servidor", "jogo, placar, servidor, remoto, evento", corpo="- placar fica no servidor\n")
        self.conversa("2026-10-20", "recente", "jogo, x1, x2, x3, x4")       # recente demais: fica de fora

    def test_estimar_sem_ia(self):
        self.montar()
        e = manutencao.estimar_estado(self.base, "jogo", HOJE)
        self.assertEqual((e["conversas_antigas"], e["chamadas"], e["tokens_saida"]), (2, 1, manutencao.SAIDA_CONSOLIDADO))
        self.assertGreater(e["tokens_entrada"], 100)
        self.assertEqual(manutencao.estimar_estado(self.base, "outro", HOJE)["chamadas"], 0)

    def test_propor_nao_grava_e_mostra_o_diff(self):
        self.montar()
        ia = IAFalsa([ESTADO_NOVO])
        r = manutencao.propor_estado(self.base, "jogo", HOJE, chamar=ia)
        self.assertEqual((r["projeto"], r["igual"], r["conversas_usadas"]), ("jogo", False, ["2026-02-10_placar-no-servidor.md", "2026-01-10_decisao-do-raycast.md"]))
        self.assertIn("+Raycast para colisão; placar no servidor.", r["diff"])
        self.assertIn("-Raycast.", r["diff"])
        self.assertEqual((self.base / "estado" / "jogo.md").read_text(encoding="utf-8"), ESTADO)      # nada foi gravado
        self.assertFalse((self.base / "estado" / ".anteriores").exists())
        m = ia.mensagens[0]
        self.assertTrue("=== ESTADO ATUAL ===" in m and "decidimos raycast" in m and "placar fica no servidor" in m and "x1, x2" not in m)

    def test_proposta_invalida_ganha_correcao_e_depois_erro(self):
        self.montar()
        ia = IAFalsa(["## Objetivo\nso isso", ESTADO_NOVO])
        r = manutencao.propor_estado(self.base, "jogo", HOJE, chamar=ia)
        self.assertEqual((len(ia.mensagens), r["proposta"].startswith("## Objetivo\nJogo de corrida no Roblox")), (2, True))
        self.assertIn("faltam seções", ia.mensagens[1])
        with self.assertRaises(ValueError) as e:
            manutencao.propor_estado(self.base, "jogo", HOJE, chamar=IAFalsa(["lixo", "lixo"]))
        self.assertIn("recusada duas vezes", str(e.exception))
        self.assertEqual((self.base / "estado" / "jogo.md").read_text(encoding="utf-8"), ESTADO)

    def test_tira_cerca_de_codigo_e_detecta_igual(self):
        self.montar()
        r = manutencao.propor_estado(self.base, "jogo", HOJE, chamar=IAFalsa(["```markdown\n" + ESTADO.strip() + "\n```"]))
        self.assertTrue(r["igual"] and r["diff"] == "")

    def test_sem_conversas_antigas_e_erro(self):
        self.estado("jogo")
        with self.assertRaises(ValueError) as e:
            manutencao.propor_estado(self.base, "jogo", HOJE, chamar=IAFalsa())
        self.assertIn("não há conversas com mais de 90 dias", str(e.exception))

    def test_limite_de_uso_nao_grava(self):
        self.montar()
        with self.assertRaises(ValueError) as e:
            manutencao.propor_estado(self.base, "jogo", HOJE, chamar=IAFalsa(erro=importar.ParouTudo("login", "Not logged in")))
        self.assertTrue(str(e.exception).startswith("[login]"))

    def test_aplicar_grava_valida_e_guarda_a_versao_anterior(self):
        self.montar()
        r = manutencao.aplicar_estado(self.base, "jogo", ESTADO_NOVO)
        self.assertEqual(r["arquivo"], "estado/jogo.md")
        self.assertIn("Carro anda e freia.", (self.base / "estado" / "jogo.md").read_text(encoding="utf-8"))
        anteriores = list((self.base / "estado" / ".anteriores").glob("jogo-*.md"))
        self.assertEqual(len(anteriores), 1)
        self.assertEqual(anteriores[0].read_text(encoding="utf-8"), ESTADO)
        with self.assertRaises(ValueError):
            manutencao.aplicar_estado(self.base, "jogo", "## Objetivo\nincompleto")


class TestIndices(Base):
    def test_abaixo_e_acima_de_100_arquivos(self):
        self.conversa("2026-10-01", "um", "a1, b2, c3")
        r = manutencao.refazer_indices(self.base)
        self.assertEqual((r["indices_por_projeto"], r["projetos"]), (False, []))
        self.assertIn("só são gerados com mais de 100", r["mensagem"])
        for i in range(105):
            self.conversa(f"2026-01-{i % 27 + 1:02d}", f"assunto-{i}", "jogo, a1, b2, c3, d4", projeto="jogo" if i % 2 else "site")
        r = manutencao.refazer_indices(self.base)
        self.assertEqual((r["indices_por_projeto"], r["projetos"]), (True, ["jogo", "site"]))
        self.assertTrue((self.base / "indices" / "site.md").is_file())


class TestExportar(Base):
    def popular(self):
        self.conversa("2026-10-01", "um", "a1, b2, c3")
        self.estado()
        (self.base / "arquivo-morto").mkdir()
        (self.base / "arquivo-morto" / "velho.md").write_text("velho", encoding="utf-8")
        (self.base / "indices").mkdir()
        (self.base / "indices" / "jogo.md").write_text("# indice", encoding="utf-8")
        (self.base / "INDICE.md").write_text("## jogo\n", encoding="utf-8")
        (self.base / "sinonimos.json").write_text("{}", encoding="utf-8")
        (self.base / ".log" / "consultas.jsonl").write_text("{}", encoding="utf-8")
        (self.base / "tools" / "x.py").write_text("codigo", encoding="utf-8")
        self.destino = self.raiz / "backups"
        self.destino.mkdir()

    def test_zip_datado_com_o_aviso_e_sem_log_nem_codigo(self):
        self.popular()
        r = manutencao.exportar(self.base, self.destino, datetime.datetime(2026, 10, 28, 15, 0))
        self.assertEqual(Path(r["zip"]).name, "cerebro-2026-10-28.zip")
        with zipfile.ZipFile(r["zip"]) as z:
            nomes = sorted(z.namelist())
            leia = z.read("cerebro-2026-10-28/LEIA-ME.txt").decode("utf-8")
        self.assertEqual(nomes, sorted(f"cerebro-2026-10-28/{n}" for n in (
            "INDICE.md", "LEIA-ME.txt", "arquivo-morto/velho.md", "conversas/2026-10-01_um.md", "estado/jogo.md", "indices/jogo.md", "sinonimos.json")))
        self.assertIn("dados pessoais", leia)
        self.assertIn("NUNCA", leia)
        self.assertEqual(r["arquivos"], 6)          # sem contar o LEIA-ME
        self.assertIn("repositório público", r["aviso"])
        self.assertFalse(r["dentro_de_git"])
        self.assertGreater(r["bytes"], 100)

    def test_nunca_sobrescreve_um_backup_existente(self):
        self.popular()
        a = manutencao.exportar(self.base, self.destino, datetime.datetime(2026, 10, 28, 15, 0))["zip"]
        b = manutencao.exportar(self.base, self.destino, datetime.datetime(2026, 10, 28, 16, 0))["zip"]
        c = manutencao.exportar(self.base, self.destino, datetime.datetime(2026, 10, 28, 17, 0))["zip"]
        self.assertEqual([Path(x).name for x in (a, b, c)], ["cerebro-2026-10-28.zip", "cerebro-2026-10-28-2.zip", "cerebro-2026-10-28-3.zip"])
        self.assertFalse(list(self.destino.glob("*.tmp")))

    def test_avisa_quando_a_pasta_esta_dentro_de_um_repositorio_git(self):
        self.popular()
        (self.destino / ".git").mkdir()
        self.assertTrue(manutencao.exportar(self.base, self.destino)["dentro_de_git"])
        sub = self.destino / "pasta" / "interna"
        sub.mkdir(parents=True)
        self.assertTrue(manutencao.exportar(self.base, sub)["dentro_de_git"])

    def test_recusa_destino_ruim(self):
        self.popular()
        with self.assertRaises(ValueError):
            manutencao.exportar(self.base, self.raiz / "nao-existe")
        with self.assertRaises(ValueError) as e:
            manutencao.exportar(self.base, self.base / "conversas")
        self.assertIn("FORA do cérebro", str(e.exception))
        self.assertTrue(Path(manutencao.exportar(self.base, self.raiz)["zip"]).is_file())    # a pasta que CONTÉM o cérebro serve: o .zip não entra nele


class TestCli(Base):
    def rodar(self, *args, entrada=""):
        saida, erro = io.StringIO(), io.StringIO()
        stdin = io.TextIOWrapper(io.BytesIO(entrada.encode("utf-8")), encoding="utf-8")
        with mock.patch("sys.stdin", stdin), contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
            return manutencao.main(list(args)), saida.getvalue(), erro.getvalue()

    def test_diagnostico_sinonimos_indices_e_exportar(self):
        self.conversa("2026-10-01", "um", "agente, tela, a1")
        self.conversa("2026-10-02", "dois", "agentes, tela, a1")
        codigo, saida, _ = self.rodar("diagnostico", "--json")
        self.assertEqual(codigo, 0)
        self.assertEqual(json.loads(saida)["sinonimos_sugeridos"][0]["apelido"], "agentes")
        codigo, saida, _ = self.rodar("sinonimos-aprovar", "--json", entrada=json.dumps({"pares": {"agentes": "agente"}}))
        self.assertEqual((codigo, json.loads(saida)["adicionados"]), (0, ["agentes"]))
        self.assertEqual(self.rodar("sinonimos-remover", "agentes", "--json")[0], 0)
        self.assertEqual(self.rodar("sinonimos-remover", "agentes", "--json")[0], 2)
        self.assertEqual(json.loads(self.rodar("estimar-consolidar", "--json")[1])["chamadas"], 0)
        self.assertEqual(json.loads(self.rodar("indices", "--json")[1])["indices_por_projeto"], False)
        destino = self.raiz / "bk"
        destino.mkdir()
        codigo, saida, _ = self.rodar("exportar", "--destino", str(destino), "--json")
        self.assertEqual(codigo, 0)
        self.assertTrue(Path(json.loads(saida)["zip"]).is_file())
        self.assertEqual(self.rodar("exportar", "--destino", str(self.raiz / "nada"))[0], 2)
        self.assertEqual(self.rodar("aplicar-estado", "jogo", "--json", entrada=json.dumps({"texto": "## Objetivo\nx"}))[0], 2)
        self.assertEqual(self.rodar("consolidar", "0000000000", "--modelo", "x y")[0], 2)

    def test_consolidar_e_propor_pelo_processo_falso(self):
        """O caminho completo: manutencao -> importar.chamar_claude -> um claude.cmd FALSO (nenhum token)."""
        falso = self.raiz / "falso"
        falso.mkdir()
        (falso / "fake_claude.py").write_text(FAKE_CLAUDE, encoding="utf-8")
        (falso / "claude.cmd").write_text(f'@"{sys.executable}" "%~dp0fake_claude.py" %*\r\n', encoding="utf-8")
        self.conversa("2026-01-01", "a", "um, dois, tres, quatro, cinco")
        self.conversa("2026-01-02", "b", "um, dois, tres, quatro, cinco")
        gid = self.diag()["similares"]["grupos"][0]["id"]
        with mock.patch.dict(os.environ, {"IMPORTAR_CLAUDE": str(falso / "claude.cmd"), "FAKE_OUT": str(self.raiz / "saida")}):
            codigo, saida, _ = self.rodar("consolidar", gid, "--json")
            self.assertEqual(codigo, 0, saida)
            r = json.loads(saida)
            self.assertEqual((len(r["originais"]), r["tokens"]["entrada"] > 0), (2, True))
            self.assertEqual(len(self.arquivos()), 1)
            with mock.patch.dict(os.environ, {"FAKE_MODO": "limite"}):
                self.conversa("2026-02-01", "c", "x1, x2, x3, x4, x5")
                self.conversa("2026-02-02", "d", "x1, x2, x3, x4, x5")
                g2 = self.diag()["similares"]["grupos"][0]["id"]
                codigo, _, erro = self.rodar("consolidar", g2, "--json")
        self.assertEqual(codigo, 2)
        self.assertIn("[limite]", erro)
        self.assertEqual(len(self.arquivos()), 3)          # o grupo que bateu no limite continua intacto


if __name__ == "__main__":
    unittest.main()
