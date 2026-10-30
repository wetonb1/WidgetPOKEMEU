# -*- coding: utf-8 -*-
"""Testes do instalar_basico.py (blocos globais do Claude e do Antigravity), tudo em pastas temporárias; nunca toca em ~/.claude nem
em ~/.gemini. Rodar: python skills-biblioteca/test_instalar_basico.py"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import instalar_basico  # noqa: E402

BIBLIOTECA = Path(__file__).resolve().parent


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)
        self.cerebro = self.raiz / "meu cerebro"
        self.cerebro.mkdir()
        cfg = self.raiz / "cerebro.json"
        cfg.write_text(json.dumps({"cerebro_dir": str(self.cerebro)}), encoding="utf-8")
        env = mock.patch.dict(os.environ, {"CEREBRO_CONFIG": str(cfg), "SKILLS_GLOBAL_CLAUDE": str(self.raiz / "claude-skills"),
                                         "SKILLS_GLOBAL_ANTIGRAVITY": str(self.raiz / "agy-skills")})
        env.start()
        self.addCleanup(env.stop)
        self.gemini = self.raiz / "dot-gemini"
        self.claude = self.raiz / "dot-claude"
        self.widget = self.raiz / "widget"  # o "projeto" das skills: nunca a pasta real do widget
        self.widget.mkdir()

    def rodar(self, *args):
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            codigo = instalar_basico.main([*args, "--pasta-gemini", str(self.gemini), "--pasta-claude", str(self.claude), "--pasta-projeto", str(self.widget)])
        return codigo, saida.getvalue()

    @property
    def arquivo(self):
        return self.gemini / "GEMINI.md"


class TestBlocoDoAntigravity(Base):
    def test_o_modelo_tem_ate_12_linhas_e_o_essencial_do_claude(self):
        gemini = (BIBLIOTECA / "gemini-global.md").read_text(encoding="utf-8")
        claude = (BIBLIOTECA / "claude-global.md").read_text(encoding="utf-8")
        self.assertLessEqual(len(gemini.strip("\n").splitlines()), 12)
        for essencial in ("## Cérebro (memória dos meus projetos)", "{CAMINHO_CEREBRO}", "cerebro-buscar", "cerebro.py", "Nunca leia os arquivos do cérebro", "máx. 3 arquivos", "sem comentar"):
            self.assertIn(essencial, claude)
            self.assertIn(essencial, gemini, "falta no gemini-global.md: " + essencial)

    def test_sem_a_opcao_de_aplicar_nada_e_gravado_nem_criar(self):
        codigo, saida = self.rodar("--alvo", "antigravity")
        self.assertEqual(codigo, 0)
        self.assertFalse(self.gemini.exists(), "nem a pasta foi criada")
        self.assertIn("NÃO gravado", saida)
        self.assertIn("seria criado", saida)
        self.assertRegex(saida, r"~\d+ tokens a TODA conversa")
        self.assertIn(str(self.cerebro).replace("\\", "/"), saida)  # o caminho do cérebro já trocado
        self.assertNotIn("{CAMINHO_CEREBRO}", saida)

    def test_com_a_opcao_cria_o_arquivo_com_o_caminho_do_cerebro(self):
        codigo, saida = self.rodar("--alvo", "antigravity", "--aplicar-gemini-md")
        self.assertEqual(codigo, 0)
        texto = self.arquivo.read_text(encoding="utf-8")
        self.assertIn("criado:", saida)
        self.assertIn(str(self.cerebro).replace("\\", "/"), texto)
        self.assertNotIn("{CAMINHO_CEREBRO}", texto)
        self.assertLessEqual(len(texto.strip().splitlines()), 12)
        # de novo: já está igual
        self.assertIn("já atualizado", self.rodar("--alvo", "antigravity", "--aplicar-gemini-md")[1])

    def test_arquivo_existente_nunca_e_sobrescrito_so_mostra_o_diff(self):
        self.gemini.mkdir()
        original = "# Minhas regras\n\nSempre responda em português.\n"
        self.arquivo.write_text(original, encoding="utf-8")
        codigo, saida = self.rodar("--alvo", "antigravity")
        self.assertEqual(self.arquivo.read_text(encoding="utf-8"), original)
        self.assertIn("+## Cérebro (memória dos meus projetos)", saida)
        self.assertIn("NÃO gravado", saida)
        self.rodar("--alvo", "antigravity", "--aplicar-gemini-md")
        novo = self.arquivo.read_text(encoding="utf-8")
        self.assertTrue(novo.startswith(original.rstrip("\n")), "o que já existia fica intacto, no começo")
        self.assertIn("## Cérebro (memória dos meus projetos)", novo)

    def test_trocar_o_proprio_bloco_tambem_exige_a_opcao_porque_o_arquivo_e_de_fora(self):
        self.gemini.mkdir()
        velho = "# Minhas regras\n\n## Cérebro (memória dos meus projetos)\nbloco antigo\n\n## Outra seção\nfica\n"
        self.arquivo.write_text(velho, encoding="utf-8")
        self.rodar("--alvo", "antigravity")
        self.assertEqual(self.arquivo.read_text(encoding="utf-8"), velho)
        self.rodar("--alvo", "antigravity", "--aplicar-gemini-md")
        novo = self.arquivo.read_text(encoding="utf-8")
        self.assertNotIn("bloco antigo", novo)
        self.assertIn("## Outra seção\nfica", novo)
        self.assertIn("cerebro.py", novo)

    def test_preserva_o_fim_de_linha_do_arquivo(self):
        self.gemini.mkdir()
        self.arquivo.write_bytes("# Regras\r\n\r\nlinha\r\n".encode("utf-8"))
        self.rodar("--alvo", "antigravity", "--aplicar-gemini-md")
        bruto = self.arquivo.read_bytes()
        self.assertNotIn(b"\n", bruto.replace(b"\r\n", b""))


class TestAlvos(Base):
    def test_padrao_claude_nao_mexe_no_gemini_e_mostra_os_tokens(self):
        codigo, saida = self.rodar("--global")
        self.assertEqual(codigo, 0, saida)
        self.assertFalse(self.gemini.exists())
        self.assertTrue((self.claude / "CLAUDE.md").exists(), "o comportamento de sempre: cria ~/.claude/CLAUDE.md")
        self.assertRegex(saida, r"~\d+ tokens a TODA conversa")
        self.assertNotIn("antigravity:", saida)

    def test_ambos_instala_o_claude_e_so_mostra_o_do_agy_sem_a_opcao(self):
        codigo, saida = self.rodar("--global", "--alvo", "ambos")
        self.assertEqual(codigo, 0, saida)
        self.assertTrue((self.claude / "CLAUDE.md").exists())
        self.assertFalse(self.gemini.exists())
        self.assertIn("NÃO gravado: skills globais do antigravity", saida)
        self.assertFalse((self.raiz / "agy-skills").exists())
        codigo, saida = self.rodar("--global", "--alvo", "ambos", "--aplicar-gemini-md")
        self.assertTrue(self.arquivo.exists())

    def test_antigravity_sozinho_nao_instala_nada_do_claude(self):
        self.rodar("--alvo", "antigravity", "--aplicar-gemini-md")
        self.assertFalse(self.claude.exists())
        self.assertFalse((self.raiz / "claude-skills").exists())

    def test_agy_no_projeto_instala_as_2_skills_em_agents_skills_com_a_variante(self):
        codigo, saida = self.rodar("--alvo", "antigravity")
        self.assertEqual(codigo, 0, saida)
        base = self.widget / ".agents" / "skills"
        self.assertEqual(sorted(p.name for p in base.iterdir()), ["cerebro-buscar", "cerebro-compactar"])
        self.assertIn("Powershell".lower(), (base / "cerebro-compactar" / "SKILL.md").read_text(encoding="utf-8").lower(), "a variante do agy")
        self.assertFalse((base / "cerebro-compactar" / "variantes").exists())
        marca = json.loads((base / "cerebro-buscar" / ".instalado.json").read_text(encoding="utf-8"))
        self.assertEqual(marca["alvo"], "antigravity")
        self.assertFalse((self.widget / ".claude").exists(), "só o agy foi pedido")

    def test_agy_global_so_grava_as_skills_com_a_opcao(self):
        codigo, saida = self.rodar("--global", "--alvo", "antigravity")
        self.assertEqual(codigo, 0, saida)
        self.assertIn("--aplicar-skills-agy", saida)
        self.assertFalse((self.raiz / "agy-skills").exists())
        self.rodar("--global", "--alvo", "antigravity", "--aplicar-skills-agy")
        self.assertTrue((self.raiz / "agy-skills" / "cerebro-buscar" / "SKILL.md").is_file())
        self.assertTrue((self.raiz / "agy-skills" / "cerebro-compactar" / "SKILL.md").is_file())

    def test_ambos_no_projeto_instala_nos_dois(self):
        codigo, saida = self.rodar("--alvo", "ambos")
        self.assertEqual(codigo, 0, saida)
        self.assertTrue((self.widget / ".claude" / "skills" / "cerebro-buscar" / "SKILL.md").is_file())
        self.assertTrue((self.widget / ".agents" / "skills" / "cerebro-buscar" / "SKILL.md").is_file())

    def test_alvo_invalido_e_recusado(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.rodar("--alvo", "chatgpt")


if __name__ == "__main__":
    unittest.main()
