#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Testes do perfil_projeto.py (o [ler projeto]). Rodar: python -X utf8 cerebro/tools/test_perfil_projeto.py"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import perfil_projeto as pp  # noqa: E402


def perfil_valido(**mudar):
    base = {
        "assunto": "Um site de reservas de equipamentos para a universidade.",
        "tipo": "site",
        "stack": ["react", "supabase"],
        "tarefas": ["criar telas", "ajustar o banco"],
        "termos": ["react", "supabase", "postgresql", "row level security", "typescript", "vite", "web testing", "code review"],
        "evitar": ["blender"],
    }
    base.update(mudar)
    return base


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="perfil-teste-"))
        self.pasta = self.raiz / "projeto"
        self.pasta.mkdir()
        self.antes = {k: os.environ.get(k) for k in ("MEU_WIDGET_PASTA", "PROJETOS_JSON")}
        os.environ["MEU_WIDGET_PASTA"] = str(self.raiz / "config")
        os.environ["PROJETOS_JSON"] = str(self.raiz / "projetos.json")
        (self.raiz / "projetos.json").write_text(json.dumps([{"id": "teste", "nome": "Teste", "pasta": str(self.pasta), "ia": "claude", "modelo_padrao": "sonnet"}]), encoding="utf-8")

    def tearDown(self):
        for k, v in self.antes.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.raiz, ignore_errors=True)

    def arquivo(self, rel, texto="x"):
        p = self.pasta / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(texto, encoding="utf-8")


class Varredura(Base):
    def test_ve_subpastas_linguagens_e_dependencias(self):
        self.arquivo("app/helper.cs")
        self.arquivo("tools/a.py")
        self.arquivo("web/package.json", json.dumps({"dependencies": {"react": "1"}, "devDependencies": {"@types/node": "1", "vite": "1"}}))
        self.arquivo("requirements.txt", "numpy==1.0\n# comentário\n-r base.txt\nscipy>=1\n")
        v = pp.varrer(self.pasta)
        nomes = [l["nome"] for l in v["linguagens"]]
        self.assertIn("C#", nomes)
        self.assertIn("Python", nomes)
        self.assertEqual(v["dependencias"]["python"], ["numpy", "scipy"])
        for termo in ("csharp", "python", "react", "vite", "numpy"):
            self.assertIn(termo, v["termos"])
        self.assertNotIn("node", v["termos"])  # @types/* não diz nada sobre o projeto

    def test_ignora_pastas_geradas(self):
        self.arquivo("node_modules/lixo/a.js")
        self.arquivo("dist/b.js")
        self.arquivo("src/c.ts")
        v = pp.varrer(self.pasta)
        self.assertEqual(v["arquivos"], 1)
        self.assertEqual(v["principais"], ["src/c.ts"])

    def test_nunca_sugere_nem_le_segredos(self):
        self.arquivo(".env", "SENHA=123")
        self.arquivo("config/.env.local", "SENHA=123")
        self.arquivo("chave.pem", "x")
        self.arquivo("secrets.py", "x")
        self.arquivo("credentials.json", json.dumps({"dependencies": {"vazou": "1"}}))
        self.arquivo("README.md", "oi")
        v = pp.varrer(self.pasta)
        self.assertEqual(v["principais"], ["README.md"])
        self.assertNotIn("SENHA", pp.instrucoes("teste"))

    def test_pasta_que_nao_existe_e_manifesto_estragado(self):
        self.assertFalse(pp.varrer(self.raiz / "nao-existe")["existe"])
        self.arquivo("package.json", "{ quebrado")
        self.assertEqual(pp.varrer(self.pasta)["dependencias"], {"npm": []})


class Perfil(Base):
    def gravar(self, dados):
        arq = pp.arquivo_rascunho("teste")
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        return arq

    def test_salva_e_le_e_apaga_o_rascunho(self):
        arq = self.gravar(perfil_valido())
        p = pp.salvar("teste", arq)
        self.assertEqual(p["id"], "teste")
        self.assertFalse(arq.exists())
        self.assertEqual(pp.ler_perfil("teste")["assunto"], perfil_valido()["assunto"])
        self.assertTrue(pp.ler("teste")["perfil"]["lido_em"])

    def test_recusa_perfil_ruim_e_mantem_o_rascunho(self):
        casos = [
            perfil_valido(assunto="curto"),
            perfil_valido(termos=["react"]),
            perfil_valido(termos=["prótese"] * 1 + [f"termo {i}" for i in range(8)]),  # acento: precisa estar em inglês
            perfil_valido(stack="react"),
            perfil_valido(termos=[f"termo {i}" for i in range(61)]),
        ]
        for caso in casos:
            arq = self.gravar(caso)
            with self.assertRaises(ValueError):
                pp.salvar("teste", arq)
            self.assertTrue(arq.exists())
        self.assertIsNone(pp.ler_perfil("teste"))

    def test_termo_com_url_ou_caminho_nao_sai_para_a_busca(self):
        arq = self.gravar(perfil_valido(termos=["c:\\users\\dono"] + [f"termo {i}" for i in range(8)]))
        with self.assertRaises(ValueError):
            pp.salvar("teste", arq)

    def test_perfil_estragado_vira_none(self):
        destino = pp.arquivo_perfil("teste")
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text("{ quebrado", encoding="utf-8")
        self.assertIsNone(pp.ler_perfil("teste"))

    def test_instrucoes_trazem_a_varredura_e_os_comandos(self):
        self.arquivo("src/main.tsx")
        texto = pp.instrucoes("teste")
        for parte in ("src/main.tsx", "cerebro.py\" ler --projeto teste", "perfil_projeto.py\" salvar teste", "EM INGLÊS", "Não abra .env"):
            self.assertIn(parte, texto)

    def test_projeto_que_nao_existe(self):
        with self.assertRaises(ValueError):
            pp.instrucoes("nao-existe")


if __name__ == "__main__":
    unittest.main()
