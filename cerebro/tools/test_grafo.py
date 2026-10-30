# -*- coding: utf-8 -*-
"""Testes do grafo.py (dados do grafo 3D). Dados inventados em pasta temporária. Rodar: python cerebro/tools/test_grafo.py"""
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
import grafo  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)
        self.base = self.raiz / "cerebro"
        for d in ("conversas", "estado"):
            (self.base / d).mkdir(parents=True)
        self.json = self.raiz / "projetos.json"
        env = mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.base), "PROJETOS_JSON": str(self.json)})
        env.start()
        self.addCleanup(env.stop)

    def conversa(self, nome, chaves, projeto="jogo"):
        (self.base / "conversas" / nome).write_text(f"palavras-chave: {chaves}\ndata: {nome[:10]} | origem: claude | projeto: {projeto}\n\n- x\n", encoding="utf-8")

    def g(self, **kw):
        return grafo.grafo(self.base, **kw)

    def por_id(self, g):
        return {n["id"]: i for i, n in enumerate(g["nos"])}


class TestGrafo(Base):
    def test_vazio(self):
        g = self.g()
        self.assertEqual((g["nos"], g["ligacoes"], g["projetos"], g["arquivos"]), ([], [], 0, 0))

    def test_cada_arquivo_liga_no_seu_projeto_com_a_cor_do_cadastro(self):
        self.json.write_text(json.dumps([{"id": "jogo", "nome": "Jogo de Corrida", "pasta": str(self.raiz), "cor": "#FF6B6B"},
                                         {"id": "vazio", "nome": "Sem arquivos", "pasta": str(self.raiz)}]), encoding="utf-8")
        self.conversa("2026-01-10_fisica-do-carro.md", "carro, fisica, a1")
        self.conversa("2026-01-11_sem-cadastro.md", "x1, x2, x3", projeto="Outro Projeto")
        (self.base / "estado" / "jogo.md").write_text("## Objetivo\nx\n", encoding="utf-8")
        g = self.g()
        idx = self.por_id(g)
        self.assertEqual(g["nos"][idx["p:jogo"]]["n"], "Jogo de Corrida")
        self.assertEqual(g["nos"][idx["p:jogo"]]["cor"], "#ff6b6b")
        self.assertIn("p:vazio", idx)                                 # cadastrado sem arquivos: aparece sozinho
        self.assertRegex(g["nos"][idx["p:outro-projeto"]]["cor"], r"^#[0-9a-f]{6}$")
        c = g["nos"][idx["c:2026-01-10_fisica-do-carro.md"]]
        self.assertEqual((c["t"], c["n"], c["a"], c["p"], c["d"], c["k"]), ("c", "fisica do carro", "2026-01-10_fisica-do-carro.md", "jogo", "2026-01-10", ["carro", "fisica", "a1"]))
        e = g["nos"][idx["e:jogo.md"]]
        self.assertEqual((e["t"], e["a"], e["n"]), ("e", "estado/jogo.md", "estado de Jogo de Corrida"))
        self.assertIn([idx["c:2026-01-10_fisica-do-carro.md"], idx["p:jogo"], 1, "p"], g["ligacoes"])
        self.assertIn([idx["e:jogo.md"], idx["p:jogo"], 2, "p"], g["ligacoes"])
        self.assertEqual((g["projetos"], g["arquivos"]), (3, 3))

    def test_ligacao_por_2_ou_mais_palavras_chave_em_comum(self):
        self.conversa("2026-01-01_a.md", "carro, fisica, pista, x1")
        self.conversa("2026-01-02_b.md", "carro, fisica, y1, y2")              # 2 em comum com a: liga
        self.conversa("2026-01-03_c.md", "carro, z1, z2, z3")                  # só 1 em comum: não liga
        self.conversa("2026-01-04_d.md", "carro, fisica, pista, w1", projeto="outro")  # liga mesmo de outro projeto
        g = self.g()
        idx = self.por_id(g)
        k = {tuple(sorted((g["nos"][a]["id"], g["nos"][b]["id"]))): n for a, b, n, t in g["ligacoes"] if t == "k"}
        self.assertEqual(k, {("c:2026-01-01_a.md", "c:2026-01-02_b.md"): 2, ("c:2026-01-01_a.md", "c:2026-01-04_d.md"): 3,
                             ("c:2026-01-02_b.md", "c:2026-01-04_d.md"): 2})
        self.assertEqual(g["ligacoes_por_palavra"], 3)
        self.assertEqual(len(self.g(min_comum=3)["ligacoes"]) - len(idx) + g["projetos"], 1)   # com 3 em comum: só a-d

    def test_no_maximo_3_ligacoes_por_arquivo_as_mais_fortes(self):
        self.conversa("2026-01-01_centro.md", "a1, a2, a3, a4, a5")
        for i, chaves in enumerate(["a1, a2, a3, a4", "a1, a2, a3", "a1, a2, b1", "a1, a2, b2", "a1, a2, b3"]):
            self.conversa(f"2026-02-0{i + 1}_vizinho-{i}.md", chaves)
        g = self.g()
        centro = self.por_id(g)["c:2026-01-01_centro.md"]
        dele = sorted(n for a, b, n, t in g["ligacoes"] if t == "k" and centro in (a, b))
        self.assertGreaterEqual(len(dele), 3)
        self.assertEqual(dele[-2:], [3, 4])   # as duas mais fortes estão lá

    def test_palavra_generica_demais_nao_liga(self):
        for i in range(grafo.MAX_POSTOS + 1):
            self.conversa(f"2026-03-{i % 28 + 1:02d}_arquivo-{i}.md", f"comum, generica, unico{i}")
        self.assertEqual(self.g()["ligacoes_por_palavra"], 0)

    def test_cli(self):
        self.conversa("2026-01-01_a.md", "a1, a2, a3")
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            self.assertEqual(grafo.main(["--json"]), 0)
        self.assertEqual(json.loads(saida.getvalue())["arquivos"], 1)
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.raiz / "nao-existe")}), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(grafo.main(["--json"]), 3)


if __name__ == "__main__":
    unittest.main()
