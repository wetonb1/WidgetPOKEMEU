# -*- coding: utf-8 -*-
"""Testes do regras.py (CLAUDE.md e AGENTS.md iguais). Rodar: python cerebro/tools/test_regras.py"""
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regras  # noqa: E402

CORPO = "\n## O widget\nLinha um com acentos: cérebro, ação.\n- item\n"


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)

    def escrever(self, nome, texto, eol="\n"):
        (self.raiz / nome).write_bytes(texto.replace("\n", eol).encode("utf-8"))

    def ler(self, nome):
        return (self.raiz / nome).read_bytes().decode("utf-8")

    def par(self, corpo_claude=CORPO, corpo_agents=CORPO, eol="\n"):
        self.escrever("CLAUDE.md", "# Título do Claude" + corpo_claude, eol)
        self.escrever("AGENTS.md", "# Título do Antigravity (lê este arquivo)" + corpo_agents, eol)

    def cli(self, *args):
        saida, erro = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
            codigo = regras.main([*args, "--raiz", str(self.raiz)])
        return codigo, saida.getvalue(), erro.getvalue()


class TestVerificar(Base):
    def test_iguais_mesmo_com_titulos_diferentes(self):
        self.par()
        codigo, saida, _ = self.cli("verificar")
        self.assertEqual(codigo, 0)
        self.assertIn("mesmo conteúdo", saida)

    def test_diferentes_mostra_o_diff_e_sai_com_1(self):
        self.par(corpo_agents=CORPO.replace("item", "item velho"))
        codigo, saida, _ = self.cli("verificar")
        self.assertEqual(codigo, 1)
        self.assertIn("-- item velho", saida)  # o que o AGENTS.md tem a mais (começa com "-" do diff e "- " do item)
        self.assertIn("+- item", saida)
        self.assertIn("DIFEREM", saida)

    def test_fim_de_linha_diferente_nao_conta_como_diferenca(self):
        self.escrever("CLAUDE.md", "# A" + CORPO, "\n")
        self.escrever("AGENTS.md", "# B" + CORPO, "\r\n")
        self.assertTrue(regras.comparar(self.raiz)["iguais"])

    def test_arquivo_faltando_e_erro_claro(self):
        self.escrever("CLAUDE.md", "# A" + CORPO)
        codigo, _, erro = self.cli("verificar")
        self.assertEqual(codigo, 2)
        self.assertIn("não achei AGENTS.md", erro)


class TestSincronizar(Base):
    def test_sem_confirmar_so_mostra_e_nao_grava(self):
        self.par(corpo_agents=CORPO + "- a mais\n")
        antes = self.ler("AGENTS.md")
        codigo, saida, _ = self.cli("sincronizar")
        self.assertEqual(codigo, 0)
        self.assertIn("NÃO gravado", saida)
        self.assertIn("--- ", saida)
        self.assertEqual(self.ler("AGENTS.md"), antes)

    def test_confirmar_reescreve_o_agents_mantendo_o_titulo_dele(self):
        self.par(corpo_claude=CORPO + "- novidade\n", corpo_agents=CORPO)
        codigo, saida, _ = self.cli("sincronizar", "--confirmar")
        self.assertEqual(codigo, 0)
        self.assertIn("reescrito", saida)
        novo = self.ler("AGENTS.md")
        self.assertEqual(novo.splitlines()[0], "# Título do Antigravity (lê este arquivo)")
        self.assertIn("- novidade", novo)
        self.assertTrue(regras.comparar(self.raiz)["iguais"])
        self.assertEqual(self.ler("CLAUDE.md").splitlines()[0], "# Título do Claude")  # o principal nunca é tocado

    def test_preserva_o_fim_de_linha_do_agents(self):
        self.par(corpo_claude=CORPO + "- novidade\n", eol="\r\n")
        self.cli("sincronizar", "--confirmar")
        bruto = (self.raiz / "AGENTS.md").read_bytes()
        self.assertIn(b"\r\n", bruto)
        self.assertNotIn(b"\n", bruto.replace(b"\r\n", b""))

    def test_ja_iguais_nao_reescreve(self):
        self.par()
        antes = (self.raiz / "AGENTS.md").stat().st_mtime_ns
        codigo, saida, _ = self.cli("sincronizar", "--confirmar")
        self.assertEqual((codigo, (self.raiz / "AGENTS.md").stat().st_mtime_ns), (0, antes))
        self.assertIn("nada a fazer", saida)

    def test_nao_deixa_temporario_para_tras(self):
        self.par(corpo_claude=CORPO + "- x\n")
        self.cli("sincronizar", "--confirmar")
        self.assertEqual(sorted(p.name for p in self.raiz.iterdir()), ["AGENTS.md", "CLAUDE.md"])


class TestRaizDoWidget(unittest.TestCase):
    def test_os_arquivos_do_proprio_widget_estao_iguais(self):
        """Quem editar só o CLAUDE.md é avisado aqui (rode: python cerebro/tools/regras.py sincronizar --confirmar)."""
        r = regras.comparar()
        self.assertTrue(r["iguais"], "AGENTS.md diferente do CLAUDE.md:\n" + r["diff"])


if __name__ == "__main__":
    unittest.main()
