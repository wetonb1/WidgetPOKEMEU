# -*- coding: utf-8 -*-
"""Testes do uso.py (estimativa local a partir do sessoes.jsonl). Rodar: python cerebro/tools/test_uso.py"""
import contextlib
import datetime
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import uso  # noqa: E402

AGORA = datetime.datetime(2026, 10, 28, 15, 0, 0)  # quarta-feira


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name) / "cerebro"
        (self.base / ".log").mkdir(parents=True)
        env = mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base)})
        env.start()
        self.addCleanup(env.stop)

    def gravar(self, *eventos, bruto=""):
        texto = "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in eventos) + bruto
        (self.base / ".log" / "sessoes.jsonl").write_text(texto, encoding="utf-8")

    @staticmethod
    def sessao(dia, modelo, hora="10:00:00", projeto="meu-widget", modo="novo"):
        return {"data": f"2026-10-{dia:02d}T{hora}", "projeto": projeto, "ia": "claude", "modelo": modelo, "tarefa": "", "modo": modo}


class TestResumo(Base):
    def test_sem_log_ou_sem_cerebro_tudo_zerado(self):
        r = uso.resumo(agora=AGORA)
        self.assertEqual((r["total"], len(r["dias"]), r["avisos"]), (0, 7, []))
        self.assertEqual([d["data"] for d in r["dias"]], [f"2026-10-{d}" for d in range(22, 29)])  # 7 dias, do mais antigo ao de hoje
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base.parent / "nao-existe")}):
            self.assertEqual(uso.resumo(agora=AGORA)["total"], 0)

    def test_conta_por_dia_e_por_modelo_so_nos_ultimos_7_dias(self):
        self.gravar(
            self.sessao(20, "sonnet"),  # fora da janela (7 dias: 22 a 28)
            self.sessao(22, "sonnet"), self.sessao(22, "haiku"),
            self.sessao(27, "opus"), self.sessao(28, "sonnet"), self.sessao(28, "sonnet", modo="continuar"),
            self.sessao(28, "gpt-9"),  # modelo desconhecido vira "outro"
            self.sessao(29, "opus"),  # no futuro: fora
        )
        r = uso.resumo(agora=AGORA)
        dia = {d["data"]: d for d in r["dias"]}
        self.assertEqual((dia["2026-10-22"]["total"], dia["2026-10-22"]["por_modelo"]["sonnet"], dia["2026-10-22"]["por_modelo"]["haiku"]), (2, 1, 1))
        self.assertEqual((dia["2026-10-28"]["total"], dia["2026-10-28"]["por_modelo"]["sonnet"], dia["2026-10-28"]["por_modelo"]["outro"]), (3, 2, 1))
        self.assertEqual(dia["2026-10-23"]["total"], 0)
        self.assertEqual(r["total"], 6)
        self.assertEqual(r["por_modelo"], {"sonnet": 3, "opus": 1, "haiku": 1, "outro": 1})

    def test_pausa_nao_e_sessao_mas_aparece_nas_pausas(self):
        self.gravar(self.sessao(28, "sonnet"), {**self.sessao(28, "", "14:30:00", modo="pausa"), "motivo": "limite"})
        r = uso.resumo(agora=AGORA)
        self.assertEqual(r["total"], 1)
        self.assertEqual(r["pausas"], [{"data": "2026-10-28T14:30:00", "projeto": "meu-widget", "motivo": "limite", "ia": "claude"}])

    def test_sessao_aberta_so_para_ver_o_uso_nao_conta(self):
        self.gravar(self.sessao(28, "opus"), {**self.sessao(28, "opus", "11:00:00"), "motivo": "uso"}, {**self.sessao(28, "sonnet", "12:00:00"), "motivo": "retomada"})
        r = uso.resumo(agora=AGORA)
        self.assertEqual((r["total"], r["por_modelo"]["opus"], r["por_modelo"]["sonnet"]), (2, 1, 1))

    def test_aviso_de_opus_seguidas(self):
        self.gravar(self.sessao(27, "sonnet"), self.sessao(28, "opus", "09:00:00"), self.sessao(28, "opus", "10:00:00"))
        self.assertEqual(uso.resumo(agora=AGORA)["avisos"], [])  # só 2 seguidas
        self.gravar(self.sessao(27, "sonnet"), *[self.sessao(28, "opus", f"{h:02d}:00:00") for h in (9, 10, 11)])
        r = uso.resumo(agora=AGORA)
        self.assertEqual(r["opus_seguidas"], 3)
        self.assertEqual(r["avisos"], ["Você abriu 3 sessões seguidas em Opus: considere Sonnet para tarefas comuns."])
        # uma sessão em Sonnet depois quebra a sequência
        self.gravar(*[self.sessao(28, "opus", f"{h:02d}:00:00") for h in (9, 10, 11)], self.sessao(28, "sonnet", "12:00:00"))
        self.assertEqual(uso.resumo(agora=AGORA)["avisos"], [])

    def test_aviso_de_mais_da_metade_em_opus(self):
        self.gravar(*[self.sessao(23, "opus")] * 2, self.sessao(24, "sonnet"), self.sessao(25, "opus"), self.sessao(26, "sonnet"), self.sessao(27, "opus"),
                    self.sessao(28, "sonnet"))
        r = uso.resumo(agora=AGORA)
        self.assertEqual(r["total"], 7)
        self.assertEqual(r["opus_seguidas"], 0)
        self.assertEqual(r["avisos"], ["Mais da metade das suas sessões dos últimos 7 dias foi em Opus (4 de 7): considere Sonnet para tarefas comuns."])
        self.gravar(*[self.sessao(23, "opus")] * 2, self.sessao(24, "sonnet"), self.sessao(26, "sonnet"), self.sessao(28, "sonnet"))  # 2 de 5: 40%
        self.assertEqual(uso.resumo(agora=AGORA)["avisos"], [])
        self.gravar(*[self.sessao(23, "opus")] * 2, self.sessao(24, "sonnet"), self.sessao(26, "haiku"))  # só 4 sessões: pouco para opinar
        self.assertEqual(uso.resumo(agora=AGORA)["avisos"], [])

    def test_linhas_estragadas_sao_ignoradas(self):
        self.gravar(self.sessao(28, "sonnet"), bruto='nao é json\n{"sem": "data"}\n[1,2]\n{"data": "2026-10-28T10:00:00", "projeto": "x", "modelo": "opus", "modo": "novo"}\n')
        self.assertEqual(uso.resumo(agora=AGORA)["total"], 2)

    def test_nao_inventa_numeros_de_limite_e_avisa_o_que_e(self):
        r = uso.resumo(agora=AGORA)
        self.assertIn("/usage", r["nota"])
        self.assertIn("Não é o seu uso real", r["nota"])
        self.assertFalse([k for k in r if any(x in k for x in ("limite_restante", "restante", "percent", "quota"))])

    def test_cli_json(self):
        self.gravar(self.sessao(28, "sonnet"))
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            self.assertEqual(uso.main(["resumo", "--json", "--dias", "3"]), 0)
        dados = json.loads(saida.getvalue())
        self.assertEqual(len(dados["dias"]), 3)


class TestPorIA(Base):
    """Fase 10.1: as sessões são contadas por IA e depois por modelo (o "sonnet" do Claude não se mistura com o Gemini)."""

    @staticmethod
    def agy(dia, modelo, hora="11:00:00", modo="novo", motivo=None):
        e = {"data": f"2026-10-{dia:02d}T{hora}", "projeto": "meu-widget", "ia": "antigravity", "modelo": modelo, "tarefa": "", "modo": modo}
        if motivo:
            e["motivo"] = motivo
        return e

    def test_agrega_por_ia_e_depois_por_modelo(self):
        sem_ia = self.sessao(27, "sonnet")
        del sem_ia["ia"]  # linhas antigas do log não têm o campo: eram do Claude
        self.gravar(
            self.sessao(28, "sonnet"), self.sessao(28, "opus"), sem_ia,
            self.agy(28, "gemini-3.8-flash-medium"), self.agy(28, "gemini-4-argon-high"), self.agy(27, "sonnet"),  # "sonnet" no agy é "outro" DELE
            self.agy(28, "gemini-3.8-flash-low", motivo="uso"),  # só para ver o uso: não conta
            {**self.sessao(28, "x"), "ia": "chatgpt"},  # IA desconhecida
        )
        r = uso.resumo(agora=AGORA)
        self.assertEqual(r["total"], 7)
        self.assertEqual(r["por_ia"]["claude"], {"total": 3, "por_modelo": {"sonnet": 2, "opus": 1, "haiku": 0, "outro": 0}})
        self.assertEqual(r["por_ia"]["antigravity"]["total"], 3)
        self.assertEqual(r["por_ia"]["antigravity"]["por_modelo"], {
            "gemini-3.8-flash-medium": 1, "gemini-3.8-flash-low": 0, "gemini-3.8-flash-high": 0,
            "gemini-4-argon-low": 0, "gemini-4-argon-medium": 0, "gemini-4-argon-high": 1,
            "claude-sonnet-5-5-low": 0, "claude-sonnet-5-5-medium": 0, "claude-sonnet-5-5-high": 0,
            "claude-opus-5-5-low": 0, "claude-opus-5-5-medium": 0, "claude-opus-5-5-high": 0,
            "gpt-oss-120b-medium": 0, "outro": 1,
        })
        self.assertEqual(r["por_ia"]["outra"]["total"], 1)
        # o "por_modelo" de sempre continua sendo só o do Claude (a tela de hoje não muda)
        self.assertEqual(r["por_modelo"], {"sonnet": 2, "opus": 1, "haiku": 0, "outro": 0})
        hoje = {d["data"]: d for d in r["dias"]}["2026-10-28"]
        self.assertEqual((hoje["total"], hoje["por_ia"]["claude"]["total"], hoje["por_ia"]["antigravity"]["total"]), (5, 2, 2))
        self.assertIn("contagem local", r["nota"].lower())

    def test_aviso_de_opus_so_olha_o_claude(self):
        # 3 Opus seguidas no Claude, com sessões do agy no meio: o aviso continua (o agy não quebra a sequência)
        self.gravar(self.sessao(28, "opus", "09:00:00"), self.agy(28, "gemini-4-argon-high", "09:30:00"),
                    self.sessao(28, "opus", "10:00:00"), self.agy(28, "gemini-4-argon-high", "10:30:00"), self.sessao(28, "opus", "11:00:00"))
        r = uso.resumo(agora=AGORA)
        self.assertEqual(r["opus_seguidas"], 3)
        self.assertEqual(len(r["avisos"]), 1)
        # e muitas sessões no agy nunca disparam o aviso de Opus
        self.gravar(*[self.agy(28, "gemini-4-argon-high", f"1{i}:00:00") for i in range(8)])
        r = uso.resumo(agora=AGORA)
        self.assertEqual((r["opus_seguidas"], r["avisos"]), (0, []))
        self.assertNotIn("outra", r["por_ia"])  # sem sessões de IA desconhecida, a chave "outra" não aparece


class TestContinuarEmOutraIA(Base):
    """Fase 10.8: a última sessão do projeto em cada IA e as sessões recentes por IA (contagem LOCAL, não a cota real)."""

    @staticmethod
    def ev(dia, hora, ia, modelo="x", projeto="meu-widget", modo="novo", motivo=None):
        e = {"data": f"2026-10-{dia:02d}T{hora}", "projeto": projeto, "ia": ia, "modelo": modelo, "tarefa": "", "modo": modo}
        if motivo:
            e["motivo"] = motivo
        return e

    def test_ultima_sessao_por_projeto_e_ia(self):
        eventos = [self.ev(27, "09:00:00", "claude", "sonnet"), self.ev(28, "10:00:00", "claude", "opus"),
                   self.ev(26, "08:00:00", "antigravity", "gemini-3.8-flash-low"),
                   self.ev(28, "12:00:00", "antigravity", "gemini-4-argon-high", motivo="uso"),  # só ver o /usage: não conta
                   self.ev(28, "13:00:00", "claude", modo="pausa", motivo="limite"),               # pausa não é sessão
                   self.ev(28, "11:00:00", "claude", "haiku", projeto="outro")]
        u = uso.ultimas_por_projeto(eventos)
        self.assertEqual(u["meu-widget"], {"claude": {"data": "2026-10-28T10:00:00", "modelo": "opus"},
                                           "antigravity": {"data": "2026-10-26T08:00:00", "modelo": "gemini-3.8-flash-low"}})
        self.assertEqual(list(u["outro"]), ["claude"])  # nunca abriu o agy: a tela diz "nunca abriu aí"

    def test_recentes_somam_todos_os_projetos_so_nas_ultimas_24h(self):
        eventos = [self.ev(28, "14:00:00", "claude"), self.ev(28, "13:00:00", "claude", projeto="outro"), self.ev(27, "15:01:00", "claude"),
                   self.ev(27, "14:00:00", "claude"),                                       # 25 h atrás: fora
                   self.ev(28, "09:00:00", "antigravity"), self.ev(28, "09:30:00", "antigravity", motivo="uso"),
                   self.ev(28, "10:00:00", "antigravity", modo="pausa", motivo="limite")]
        r = uso.recentes_por_ia(eventos, agora=AGORA)
        self.assertEqual(r, {"claude": 3, "antigravity": 1})
        self.assertEqual(uso.recentes_por_ia([], agora=AGORA), {"claude": 0, "antigravity": 0})
        self.assertEqual(uso.recentes_por_ia([{**self.ev(28, "10:00:00", "claude"), "data": "lixo"}], agora=AGORA)["claude"], 0)

    def test_nota_fala_das_duas_ias(self):
        self.assertIn("Antigravity", uso.NOTA)
        self.assertIn("cota", uso.NOTA)


if __name__ == "__main__":
    unittest.main()
