# -*- coding: utf-8 -*-
"""Testes do economia.py (painel de economia do cérebro). Dados inventados, em pasta temporária.
Rodar: python cerebro/tools/test_economia.py"""
import contextlib
import datetime
import io
import json
import math
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import economia  # noqa: E402
import tokens  # noqa: E402

AGORA = datetime.datetime(2026, 10, 28, 15, 0, 0)  # quarta-feira; a semana atual começa em 2026-10-26


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name) / "cerebro"
        for d in ("conversas", "estado", ".log"):
            (self.base / d).mkdir(parents=True)
        for patch in (mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base), "PROJETOS_JSON": str(Path(tmp.name) / "nao-existe.json")}),
                      mock.patch.object(tokens, "ler_config_tokens", return_value=None)):  # sem o fator calibrado do usuário
            patch.start()
            self.addCleanup(patch.stop)

    def jsonl(self, nome, linhas, bruto=""):
        (self.base / ".log" / nome).write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in linhas) + bruto, encoding="utf-8")

    def consulta(self, quando, comando, caracteres, termos=("x",), resultados=1):
        return {"data": quando, "comando": comando, "termos": list(termos), "resultados": resultados, "caracteres": caracteres}

    def sessao(self, quando, projeto, modo="novo", **extra):
        return {"data": quando, "projeto": projeto, "ia": "claude", "modelo": "sonnet", "tarefa": "", "modo": modo, **extra}

    def estado(self, projeto, caracteres):
        (self.base / "estado" / f"{projeto}.md").write_text("e" * caracteres, encoding="utf-8")
        return tokens.estimar_tokens("e" * caracteres)

    def conversa(self, nome, projeto, caracteres):
        texto = f"palavras-chave: a1, b2, c3\ndata: 2026-01-01 | origem: claude | projeto: {projeto}\n\n" + "c" * caracteres
        (self.base / "conversas" / nome).write_text(texto, encoding="utf-8")
        return tokens.estimar_tokens(texto)

    def painel(self, **kw):
        return economia.painel(kw.pop("semanas", 3), agora=AGORA, **kw)


class TestConsultas(Base):
    def test_cerebro_vazio_tudo_zerado(self):
        r = self.painel()
        self.assertEqual([w["inicio"] for w in r["semanas"]], ["2026-10-12", "2026-10-19", "2026-10-26"])
        self.assertEqual((r["totais"]["consultas"], r["totais"]["buscas"], r["totais"]["pct_nivel12"], r["evitados"]["total"], r["sessoes"]), (0, 0, None, 0, []))
        self.assertEqual((r["ab"]["registros"], r["ab"]["media_reducao_pct"]), ([], None))
        self.assertIn("ESTIMATIVA", r["nota"])

    def test_por_semana_nivel_caracteres_e_tokens(self):
        self.jsonl("consultas.jsonl", [
            self.consulta("2026-10-13T10:00:00", "titulos", 100), self.consulta("2026-10-14T10:00:00", "cabecalho", 200),
            self.consulta("2026-10-26T09:00:00", "titulos", 40), self.consulta("2026-10-27T09:00:00", "ler", 1000), self.consulta("2026-10-28T09:00:00", "buscar", 361),
            self.consulta("2026-10-28T14:00:00", "painel", 8),                       # comando desconhecido: conta em "outros"
            self.consulta("2026-09-01T09:00:00", "titulos", 999),                    # fora da janela de 3 semanas
        ], bruto="isto não é json\n[1]\n")
        r = self.painel()
        s1, s2, s3 = r["semanas"]
        self.assertEqual((s1["consultas"], s1["caracteres"], s1["tokens"]), (2, 300, tokens.tokens_de_caracteres(300)))
        self.assertEqual((s2["consultas"], s2["buscas"]), (0, 0))
        self.assertEqual((s3["consultas"], s3["caracteres"], s3["por_nivel"], s3["outros"]),
                         (4, 1409, {"titulos": 1, "cabecalho": 0, "ler": 1, "buscar": 1}, 1))
        self.assertEqual((r["totais"]["consultas"], r["totais"]["caracteres"], r["totais"]["por_nivel"]["titulos"]), (6, 1709, 2))
        self.assertEqual(s3["tokens"], tokens.tokens_de_caracteres(1409))

    def test_proporcao_de_buscas_resolvidas_nos_niveis_1_e_2(self):
        self.jsonl("consultas.jsonl", [
            self.consulta("2026-10-27T10:00:00", "titulos", 10), self.consulta("2026-10-27T10:03:00", "cabecalho", 10), self.consulta("2026-10-27T10:08:00", "ler", 10),  # 1 busca, foi ao nível 3
            self.consulta("2026-10-27T11:00:00", "titulos", 10),                                                                                                          # 2: só o título
            self.consulta("2026-10-27T11:30:00", "titulos", 10), self.consulta("2026-10-27T11:35:00", "cabecalho", 10),                                                   # 3: títulos e cabeçalho
            self.consulta("2026-10-27T12:00:00", "buscar", 10),                                                                                                           # 4: busca combinada
            self.consulta("2026-10-28T10:00:00", "titulos", 10), self.consulta("2026-10-28T10:11:00", "ler", 10),                                                        # 11 min: são DUAS buscas
        ])
        t = self.painel()["totais"]
        self.assertEqual((t["buscas"], t["buscas_nivel12"], t["buscas_nivel3"], t["pct_nivel12"]), (6, 4, 2, 67))
        s3 = self.painel()["semanas"][-1]
        self.assertEqual((s3["buscas"], s3["pct_nivel12"]), (6, 67))
        self.assertEqual(self.painel()["semanas"][0]["pct_nivel12"], None)

    def test_semanas_pedidas_ficam_entre_2_e_26(self):
        self.assertEqual(len(economia.painel(1, agora=AGORA)["semanas"]), 2)
        self.assertEqual(len(economia.painel(99, agora=AGORA)["semanas"]), 26)


class TestEvitados(Base):
    def montar_alfa(self):
        self.estado_alfa = self.estado("alfa", 400)
        self.conv_alfa = sum(self.conversa(f"2026-0{i}-01_assunto-{i}.md", "alfa", 8000) for i in (1, 2, 3))
        self.conversa("2026-04-01_outro-projeto.md", "beta", 5000)  # não conta para o alfa

    def test_tokens_evitados_de_uma_sessao_nova(self):
        self.montar_alfa()
        self.jsonl("sessoes.jsonl", [self.sessao("2026-10-28T09:00:00", "alfa")])
        self.jsonl("consultas.jsonl", [self.consulta("2026-10-28T09:05:00", "buscar", 800, ["alfa"]), self.consulta("2026-10-28T09:06:00", "ler", 400)])
        r = self.painel()
        (s,) = r["sessoes"]
        com = self.estado_alfa + tokens.tokens_de_caracteres(1200)
        self.assertEqual((s["projeto"], s["consultas"], s["caracteres_lidos"], s["estado_tokens"]), ("alfa", 2, 1200, self.estado_alfa))
        self.assertEqual((s["com_cerebro"], s["sem_cerebro"], s["evitados"]), (com, self.conv_alfa, self.conv_alfa - com))
        self.assertGreater(s["evitados"], 5000)
        self.assertEqual((r["evitados"]["total"], r["evitados"]["sessoes_contadas"], r["evitados"]["sessoes_negativas"]), (self.conv_alfa - com, 1, 0))
        self.assertEqual(r["semanas"][-1]["evitados"], self.conv_alfa - com)
        self.assertEqual(r["semanas"][0]["evitados"], 0)

    def test_so_sessao_nova_com_consultas_conta(self):
        self.montar_alfa()
        self.jsonl("sessoes.jsonl", [
            self.sessao("2026-10-28T08:00:00", "alfa", "continuar"),
            self.sessao("2026-10-28T09:00:00", "alfa", "novo"),                                    # nenhuma consulta depois
            self.sessao("2026-10-28T13:00:00", "alfa", "novo", motivo="uso"),                      # aberta só para ver o /usage
            self.sessao("2026-10-28T14:00:00", "alfa", "pausa", motivo="limite"),                  # pausa não é sessão
            self.sessao("2026-10-28T14:30:00", "alfa", "retomar"),
        ])
        self.jsonl("consultas.jsonl", [self.consulta("2026-10-28T14:35:00", "buscar", 100)])
        r = self.painel()
        modos = {(s["modo"], s["evitados"]) for s in r["sessoes"]}
        self.assertEqual(len(r["sessoes"]), 3)
        self.assertEqual(modos, {("continuar", None), ("novo", 0), ("retomar", None)})
        por_data = {s["data"][11:16]: s for s in r["sessoes"]}
        self.assertIn("nada a explicar", por_data["08:00"]["motivo"])
        self.assertIn("nenhuma consulta", por_data["09:00"]["motivo"])
        self.assertEqual((r["evitados"]["total"], r["evitados"]["sessoes_contadas"], r["evitados"]["sessoes_novas"]), (0, 0, 1))
        self.assertEqual([s["data"][11:16] for s in r["sessoes"]], ["14:30", "09:00", "08:00"])  # a mais nova primeiro

    def test_consulta_vai_para_a_sessao_do_projeto_citado_ou_para_a_mais_recente(self):
        self.montar_alfa()
        self.estado("beta", 400)
        self.conversa("2026-05-01_beta-historia.md", "beta", 6000)
        self.jsonl("sessoes.jsonl", [self.sessao("2026-10-28T09:00:00", "alfa"), self.sessao("2026-10-28T09:30:00", "beta")])
        self.jsonl("consultas.jsonl", [
            self.consulta("2026-10-28T09:40:00", "buscar", 100, ["alfa", "decisoes"]),   # cita alfa: é da sessão do alfa, mesmo a do beta sendo mais nova
            self.consulta("2026-10-28T09:41:00", "buscar", 200, ["geral"]),              # não cita ninguém: a mais recente (beta)
            self.consulta("2026-10-28T16:00:00", "buscar", 300, ["alfa"]),               # 7 h depois: fora da janela de 6 h, de ninguém
        ])
        por = {s["projeto"]: s for s in self.painel()["sessoes"]}
        self.assertEqual((por["alfa"]["consultas"], por["alfa"]["caracteres_lidos"]), (1, 100))
        self.assertEqual((por["beta"]["consultas"], por["beta"]["caracteres_lidos"]), (1, 200))
        self.assertEqual(self.painel()["totais"]["consultas"], 3)   # a sem sessão continua nos números da semana

    def test_projeto_sem_conversas_nao_inventa_economia(self):
        self.estado("vazio", 400)
        self.jsonl("sessoes.jsonl", [self.sessao("2026-10-28T09:00:00", "vazio")])
        self.jsonl("consultas.jsonl", [self.consulta("2026-10-28T09:05:00", "buscar", 100)])
        (s,) = self.painel()["sessoes"]
        self.assertEqual(s["evitados"], 0)
        self.assertIn("ainda não tem conversas", s["motivo"])

    def test_o_cerebro_pode_custar_mais_que_reexplicar_e_isso_aparece_negativo(self):
        self.estado("pequeno", 4000)
        self.conversa("2026-01-01_so-uma-nota.md", "pequeno", 400)
        self.jsonl("sessoes.jsonl", [self.sessao("2026-10-28T09:00:00", "pequeno")])
        self.jsonl("consultas.jsonl", [self.consulta("2026-10-28T09:05:00", "ler", 8000)])
        r = self.painel()
        self.assertLess(r["sessoes"][0]["evitados"], 0)
        self.assertEqual((r["evitados"]["sessoes_negativas"], r["evitados"]["total"] < 0), (1, True))

    def test_sessao_do_comeco_da_janela_recebe_consulta_do_comeco_da_janela(self):
        self.montar_alfa()
        self.jsonl("sessoes.jsonl", [self.sessao("2026-10-11T23:00:00", "alfa")])           # domingo, uma hora antes da 1ª semana
        self.jsonl("consultas.jsonl", [self.consulta("2026-10-12T00:10:00", "buscar", 100)])
        r = self.painel()
        self.assertEqual(r["sessoes"], [])                                                   # a sessão é de antes da janela: não aparece
        self.assertEqual(r["totais"]["consultas"], 1)


class TestAB(Base):
    def reg(self, **kw):
        d = {"tarefa": "Explicar o grafo", "variante": "com", "entrada": 1000, "saida": 200}
        d.update(kw)
        return economia.registrar_ab(d, agora=AGORA)

    def test_registrar_valida_e_grava(self):
        r = self.reg(custo_usd="1,25", notas="  primeira   vez ")
        self.assertEqual((r["tarefa"], r["variante"], r["entrada"], r["saida"], r["custo_usd"], r["notas"]), ("Explicar o grafo", "com", 1000, 200, 1.25, "primeira vez"))
        self.assertRegex(r["id"], r"^20261028150000-[0-9a-f]{4}$")
        (l,) = economia.ler_ab(self.base)
        self.assertEqual((l["total"], l["custo_usd"], l["data"]), (1200, 1.25, "2026-10-28T15:00:00"))
        self.assertEqual(self.reg(entrada="12.345", saida="", variante="sem")["entrada"], 12345)   # milhar em pt-BR, só entrada

    def test_recusa_dado_ruim_com_mensagem_para_a_tela(self):
        for kw, trecho in (({"tarefa": "  "}, "descreva a tarefa"), ({"variante": "talvez"}, "variante"), ({"entrada": "", "saida": ""}, "informe os tokens"),
                           ({"entrada": "abc"}, "não é um número"), ({"entrada": "-5"}, "fora do esperado"), ({"custo_usd": "caro"}, "custo")):
            with self.assertRaises(ValueError, msg=str(kw)) as e:
                self.reg(**kw)
            self.assertIn(trecho, str(e.exception))
        with self.assertRaises(ValueError):
            economia.registrar_ab("texto")
        self.assertEqual(economia.ler_ab(self.base), [])      # nada foi gravado

    def test_comparar_media_por_variante_e_reducao(self):
        self.reg(variante="com", entrada=1000, saida=0)
        self.reg(variante="com", entrada=2000, saida=0)       # média COM = 1500
        self.reg(variante="sem", entrada=3000, saida=0)
        self.reg(tarefa="outra tarefa", variante="sem", entrada=500, saida=0)   # só uma variante: sem redução
        self.reg(tarefa="TAREFA   B", variante="com", entrada=100, saida=0)
        self.reg(tarefa="tarefa b", variante="sem", entrada=400, saida=0)       # mesma tarefa escrita diferente: junta
        r = self.painel()["ab"]
        por = {c["tarefa"]: c for c in r["comparacoes"]}
        self.assertEqual((por["Explicar o grafo"]["com"], por["Explicar o grafo"]["sem"], por["Explicar o grafo"]["reducao_pct"]), ({"n": 2, "total": 1500}, {"n": 1, "total": 3000}, 50.0))
        self.assertIsNone(por["outra tarefa"]["reducao_pct"])
        self.assertEqual(por["TAREFA B"]["reducao_pct"], 75.0)
        self.assertEqual(r["media_reducao_pct"], 62.5)
        self.assertEqual(len(r["registros"]), 6)
        self.assertEqual(r["registros"][0]["tarefa"], "tarefa b")                   # o mais recente primeiro

    def test_a_ferramenta_com_cerebro_pode_gastar_mais(self):
        self.reg(variante="com", entrada=3000, saida=0)
        self.reg(variante="sem", entrada=2000, saida=0)
        self.assertEqual(self.painel()["ab"]["comparacoes"][0]["reducao_pct"], -50.0)

    def test_remover_um_registro_so(self):
        a, b = self.reg(), self.reg(variante="sem")
        with open(self.base / ".log" / "ab.jsonl", "a", encoding="utf-8") as f:
            f.write("linha estragada que fica como está\n")
        self.assertEqual(economia.remover_ab(a["id"], self.base), {"removido": a["id"]})
        self.assertEqual([r["id"] for r in economia.ler_ab(self.base)], [b["id"]])
        self.assertIn("linha estragada", (self.base / ".log" / "ab.jsonl").read_text(encoding="utf-8"))
        with self.assertRaises(ValueError):
            economia.remover_ab("nao-existe", self.base)
        with self.assertRaises(ValueError):
            economia.remover_ab(a["id"], self.base / "outro")

    def test_cli(self):
        def rodar(*args, entrada=""):
            saida, erro = io.StringIO(), io.StringIO()
            stdin = io.TextIOWrapper(io.BytesIO(entrada.encode("utf-8")), encoding="utf-8")
            with mock.patch("sys.stdin", stdin), contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
                return economia.main(list(args)), saida.getvalue(), erro.getvalue()
        codigo, saida, _ = rodar("ab-registrar", "--json", entrada=json.dumps({"tarefa": "t", "variante": "com", "entrada": 10, "saida": 5}))
        self.assertEqual(codigo, 0)
        id_ = json.loads(saida)["registro"]["id"]
        codigo, saida, _ = rodar("painel", "--json", "--semanas", "2")
        self.assertEqual((codigo, len(json.loads(saida)["semanas"]), json.loads(saida)["ab"]["registros"][0]["total"]), (0, 2, 15))
        self.assertEqual(rodar("painel")[0], 0)
        self.assertEqual(rodar("ab-remover", id_, "--json")[0], 0)
        codigo, _, erro = rodar("ab-registrar", "--json", entrada=json.dumps({"tarefa": "", "variante": "com", "entrada": 1}))
        self.assertEqual((codigo, "descreva a tarefa" in erro), (2, True))
        self.assertEqual(rodar("ab-registrar", "--json", entrada="nao é json")[0], 2)
        self.assertEqual(rodar("ab-remover", "x", "--json")[0], 2)


if __name__ == "__main__":
    unittest.main()
