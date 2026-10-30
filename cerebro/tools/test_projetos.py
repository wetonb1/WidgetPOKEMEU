# -*- coding: utf-8 -*-
"""Testes do projetos.py. Rodar: python cerebro/tools/test_projetos.py"""
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
import cerebro  # noqa: E402
import projetos  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.raiz = Path(tmp.name)
        self.arq = self.raiz / "projetos.json"
        self.base = self.raiz / "cerebro"  # o cérebro de teste
        (self.base / "conversas").mkdir(parents=True)
        (self.base / "estado").mkdir()
        self.pasta = self.raiz / "meu jogo"  # com espaço de propósito
        self.pasta.mkdir()
        env = mock.patch.dict(os.environ, {"PROJETOS_JSON": str(self.arq), "CEREBRO_DIR": str(self.base)})
        env.start()
        self.addCleanup(env.stop)

    def novo(self, **extra):
        return projetos.adicionar({"nome": "Jogo do Roblox", "pasta": str(self.pasta), **extra}, base=self.base)


class TestCadastro(Base):
    def test_arquivo_ausente_lista_vazia(self):
        self.assertEqual(projetos.listar(), [])
        self.assertFalse(self.arq.exists())

    def test_adicionar_completa_os_campos(self):
        r = self.novo(descricao="  Um jogo\n de teste ", tags="roblox, Jogo,roblox")
        p = r["projeto"]
        self.assertEqual(list(p), list(projetos.CAMPOS) + list(projetos.OPCIONAIS))
        self.assertIs(p["pular_permissoes"], False)  # perigoso: desligado por padrão
        self.assertEqual((p["id"], p["nome"], p["ia"], p["modelo_padrao"]), ("jogo-do-roblox", "Jogo do Roblox", "claude", "sonnet"))
        self.assertEqual((p["descricao"], p["tags"], p["ultima_abertura"]), ("Um jogo de teste", ["roblox", "jogo"], None))
        self.assertRegex(p["cor"], r"^#[0-9a-f]{6}$")
        self.assertEqual(json.loads(self.arq.read_text(encoding="utf-8")), [p])  # lista de objetos, no disco

    def test_id_automatico_ganha_sufixo_e_cores_variam(self):
        ids = [projetos.adicionar({"nome": "Site", "pasta": str(self.pasta)}, base=self.base)["projeto"] for _ in range(3)]
        self.assertEqual([p["id"] for p in ids], ["site", "site-2", "site-3"])
        self.assertEqual(len({p["cor"] for p in ids}), 3)

    def test_recusas(self):
        casos = [
            ({"id": "Com Espaço"}, "id inválido"),
            ({"pasta": str(self.raiz / "nao-existe")}, "pasta não existe"),
            ({"pasta": "relativa/pasta"}, "caminho absoluto"),
            ({"modelo_padrao": "gpt"}, "modelo_padrao inválido"),
            ({"ia": "outra"}, "ia inválida"),
            ({"cor": "azul"}, "cor inválida"),
            ({"descricao": "x" * 201}, "descricao com mais de 200"),
            ({"nome": "n" * 41}, "nome vazio ou com mais de 40"),
        ]
        for extra, esperado in casos:
            with self.subTest(esperado=esperado):
                with self.assertRaises(ValueError) as e:
                    self.novo(**extra)
                self.assertIn(esperado, str(e.exception))
        self.assertFalse(self.arq.exists())  # nada foi gravado

    def test_id_repetido(self):
        self.novo(id="jogo")
        with self.assertRaises(ValueError) as e:
            self.novo(id="jogo")
        self.assertIn("já existe um projeto com o id jogo", str(e.exception))
        self.assertEqual(len(projetos.listar()), 1)

    def test_editar_sem_mudar_id_nem_abertura(self):
        self.novo()
        projetos.marcar_abertura("jogo-do-roblox", "2026-10-28T14:30:00")
        p = projetos.editar("jogo-do-roblox", {"nome": "Roblox!", "modelo_padrao": "opus", "tags": ["a", "b"], "id": "outro", "ultima_abertura": None})
        self.assertEqual((p["id"], p["nome"], p["modelo_padrao"], p["tags"], p["ultima_abertura"]),
                         ("jogo-do-roblox", "Roblox!", "opus", ["a", "b"], "2026-10-28T14:30:00"))
        with self.assertRaises(ValueError):
            projetos.editar("jogo-do-roblox", {"cor": "nada"})
        with self.assertRaises(ValueError):
            projetos.editar("nao-existe", {})
        self.assertEqual(projetos.listar()[0]["nome"], "Roblox!")

    def test_editar_pasta_exige_que_exista_mas_descricao_nao(self):
        self.novo()
        self.pasta.rmdir()  # a pasta sumiu
        self.assertEqual(projetos.editar("jogo-do-roblox", {"descricao": "continua editável"})["descricao"], "continua editável")
        with self.assertRaises(ValueError) as e:
            projetos.editar("jogo-do-roblox", {"pasta": str(self.raiz / "outra")})
        self.assertIn("pasta não existe", str(e.exception))

    def test_remover_nao_apaga_a_pasta_nem_o_estado(self):
        self.novo()
        (self.pasta / "arquivo.txt").write_text("meu código", encoding="utf-8")
        removido = projetos.remover("jogo-do-roblox")
        self.assertEqual(removido["id"], "jogo-do-roblox")
        self.assertEqual(projetos.listar(), [])
        self.assertEqual((self.pasta / "arquivo.txt").read_text(encoding="utf-8"), "meu código")
        self.assertTrue((self.base / "estado" / "jogo-do-roblox.md").exists())
        with self.assertRaises(ValueError):
            projetos.remover("jogo-do-roblox")

    def test_marcar_abertura(self):
        self.novo()
        p = projetos.marcar_abertura("jogo-do-roblox")
        self.assertRegex(p["ultima_abertura"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
        self.assertEqual(projetos.listar()[0]["ultima_abertura"], p["ultima_abertura"])
        with self.assertRaises(ValueError):
            projetos.marcar_abertura("jogo-do-roblox", "ontem")

    def test_validar_acha_pasta_sumida_id_repetido_e_campos_ruins(self):
        self.novo()
        antigo = projetos.listar()[0]
        self.arq.write_text(json.dumps([
            antigo,
            {**antigo, "pasta": str(self.raiz / "sumiu")},  # id repetido + pasta que não existe
            {"id": "so-id", "nome": "Só id", "pasta": str(self.pasta), "modelo_padrao": "gpt"},
            "lixo",
        ]), encoding="utf-8")
        achados = [f"{i}: {p}" for i, p in projetos.validar()]
        textos = "\n".join(achados)
        self.assertIn("jogo-do-roblox: pasta não existe", textos)
        self.assertIn("jogo-do-roblox: id repetido (também no item #1)", textos)
        self.assertIn("so-id: modelo_padrao inválido", textos)
        self.assertIn("so-id: campo ausente: cor", textos)
        self.assertIn("#4: item não é um objeto", textos)

    def test_validar_arquivo_bom(self):
        self.novo()
        self.assertEqual(projetos.validar(), [])


class TestEscritaAtomica(Base):
    def test_falha_ao_renomear_nao_corrompe_nem_deixa_temporario(self):
        self.novo()
        antes = self.arq.read_bytes()
        with mock.patch("os.replace", side_effect=OSError("disco cheio")):
            with self.assertRaises(OSError):
                projetos.editar("jogo-do-roblox", {"nome": "Outro nome"})
        self.assertEqual(self.arq.read_bytes(), antes)
        self.assertEqual([p.name for p in self.raiz.iterdir() if p.name.endswith(".tmp")], [])

    def test_json_quebrado_nao_e_sobrescrito(self):
        self.arq.write_text("[{quebrado", encoding="utf-8")
        for chamada in (lambda: self.novo(), lambda: projetos.remover("x"), lambda: projetos.listar()):
            with self.assertRaises(ValueError) as e:
                chamada()
            self.assertIn("projetos.json inválido", str(e.exception))
        self.assertEqual(self.arq.read_text(encoding="utf-8"), "[{quebrado")
        self.arq.write_text('{"nao": "lista"}', encoding="utf-8")
        with self.assertRaises(ValueError):
            projetos.listar()

    def test_formato_do_arquivo(self):
        self.novo()
        bruto = self.arq.read_bytes()
        self.assertFalse(bruto.startswith(b"\xef\xbb\xbf"))
        self.assertTrue(bruto.endswith(b"]\n"))
        self.assertIn("meu jogo".encode(), bruto)  # sem \u escapes: legível


class TestCerebro(Base):
    def test_adicionar_cria_esqueleto_do_estado(self):
        r = self.novo(tags=["roblox", "lua"])
        self.assertEqual(r["estado"], {"arquivo": "estado/jogo-do-roblox.md", "criado": True})
        texto = (self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8")
        linhas = texto.splitlines()
        self.assertTrue(linhas[0].startswith("palavras-chave: jogo-do-roblox, jogo, do, roblox"))
        self.assertRegex(linhas[1], r"^data: \d{4}-\d{2}-\d{2} \| origem: widget \| projeto: jogo-do-roblox$")
        self.assertEqual([l for l in linhas if l.startswith("## ")],
                         ["## Objetivo", "## Stack", "## Decisões", "## Estado atual", "## Próximos passos", "## Armadilhas"])
        self.assertEqual(cerebro.validar(self.base), [])  # passa no validar do cérebro
        self.assertIn("estado/jogo-do-roblox.md", (self.base / "INDICE.md").read_text(encoding="utf-8"))

    def test_nao_sobrescreve_estado_existente(self):
        (self.base / "estado" / "jogo-do-roblox.md").write_text("## Objetivo\nmeu texto\n", encoding="utf-8")
        r = self.novo()
        self.assertEqual(r["estado"], {"arquivo": "estado/jogo-do-roblox.md", "criado": False})
        self.assertEqual((self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8"), "## Objetivo\nmeu texto\n")

    def test_sem_cerebro_o_projeto_ainda_e_cadastrado(self):
        with mock.patch.dict(os.environ, {"CEREBRO_DIR": str(self.raiz / "nao-existe")}):
            r = projetos.adicionar({"nome": "Site", "pasta": str(self.pasta)})
        self.assertIsNone(r["estado"])
        self.assertEqual(len(projetos.listar()), 1)

    def test_preencher_objetivo_e_stack_so_em_secao_vazia(self):
        self.novo()
        r = projetos.preencher_estado("jogo-do-roblox", "Fazer o melhor jogo\nde corrida", "Roblox + Lua")
        self.assertEqual(r["preenchido"], ["objetivo", "stack"])
        texto = (self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8")
        self.assertIn("## Objetivo\nFazer o melhor jogo de corrida\n", texto)
        self.assertIn("## Stack\nRoblox + Lua\n", texto)
        self.assertTrue(texto.startswith("palavras-chave:"))  # o cabeçalho ficou
        self.assertEqual(cerebro.validar(self.base), [])
        # de novo: as seções já têm texto e não são sobrescritas
        self.assertEqual(projetos.preencher_estado("jogo-do-roblox", "outro", "outra")["preenchido"], [])
        self.assertIn("Roblox + Lua", (self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8"))
        self.assertTrue(any((self.base / "estado" / ".anteriores").iterdir()))  # versão anterior guardada
        with self.assertRaises(ValueError):
            projetos.preencher_estado("nao-existe", "a", "b")

    def test_listar_do_cerebro_usa_o_id_do_cadastro(self):
        self.novo()
        self.assertEqual(cerebro.listar_projetos(self.base), (["jogo-do-roblox"], "projetos.json"))


class TestPrepararProjeto(Base):
    def test_cria_claude_md_minimo_apos_confirmar(self):
        self.novo()
        plano = projetos.preparar_projeto("jogo-do-roblox")  # sem confirmar: só mostra
        self.assertEqual((plano["acao"], plano["escrito"]), ("criar", False))
        self.assertFalse((self.pasta / "CLAUDE.md").exists())
        self.assertIn("+# Jogo do Roblox", plano["diff"])
        feito = projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertTrue(feito["escrito"])
        texto = (self.pasta / "CLAUDE.md").read_text(encoding="utf-8")
        self.assertLessEqual(len(texto.splitlines()), 20)
        for esperado in ("# Jogo do Roblox", "`jogo-do-roblox`", "/compactar", "--projeto jogo-do-roblox",
                         "cerebro-buscar", "buscar termos --projeto jogo-do-roblox", str(self.base).replace("\\", "/"), "Nunca leia os arquivos do cérebro direto"):
            self.assertIn(esperado, texto)

    def test_existente_nao_e_sobrescrito_so_acrescenta_secao_com_diff(self):
        self.novo()
        original = "# Meu jogo\r\n\r\nRegras minhas.\r\n- não mexer\r\n"
        (self.pasta / "CLAUDE.md").write_bytes(original.encode("utf-8"))
        plano = projetos.preparar_projeto("jogo-do-roblox")
        self.assertEqual(plano["acao"], "acrescentar")
        self.assertEqual((self.pasta / "CLAUDE.md").read_bytes(), original.encode("utf-8"))  # só mostrou
        self.assertIn("+## Cérebro", plano["diff"])
        self.assertNotIn("-Regras minhas", plano["diff"])  # nada é removido
        projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        final = (self.pasta / "CLAUDE.md").read_bytes().decode("utf-8")
        self.assertTrue(final.startswith(original))  # o que já existia ficou intacto
        self.assertIn("\r\n## Cérebro\r\n", final)
        self.assertNotRegex(final.replace("\r\n", ""), r"\n")  # mantém o fim de linha do arquivo (CRLF) em tudo
        # preparar de novo: já tem a seção
        self.assertEqual(projetos.preparar_projeto("jogo-do-roblox", confirmar=True)["acao"], "ja-preparado")
        self.assertEqual((self.pasta / "CLAUDE.md").read_bytes().decode("utf-8"), final)

    def test_titulo_que_ja_fala_de_cerebro_conta_como_preparado(self):
        self.novo()
        (self.pasta / "CLAUDE.md").write_text("# X\n\n## Cérebro (memória)\nlá\n", encoding="utf-8")
        self.assertEqual(projetos.preparar_projeto("jogo-do-roblox", confirmar=True)["acao"], "ja-preparado")

    def test_pasta_sumida_e_id_desconhecido(self):
        self.novo()
        self.pasta.rmdir()
        with self.assertRaises(ValueError) as e:
            projetos.preparar_projeto("jogo-do-roblox")
        self.assertIn("a pasta do projeto não existe", str(e.exception))
        with self.assertRaises(ValueError):
            projetos.preparar_projeto("nao-existe")


class TestSessao(Base):
    def test_extrair_tema(self):
        self.assertEqual(projetos.extrair_tema("Quero arrumar a física do carro e o placar no Roblox"), "arrumar fisica carro placar roblox")
        self.assertEqual(projetos.extrair_tema("", "meu-jogo"), "meu-jogo")
        self.assertEqual(projetos.extrair_tema("e o de", "meu-jogo"), "meu-jogo")

    def test_prompt_sem_e_com_tarefa(self):
        self.novo()
        r = projetos.montar_prompt("jogo-do-roblox")
        self.assertIn("Projeto: jogo-do-roblox.", r["prompt"])
        self.assertIn("buscar jogo-do-roblox --projeto jogo-do-roblox", r["prompt"])
        self.assertIn(str(self.base).replace("\\", "/") + "/tools/cerebro.py", r["prompt"])
        self.assertTrue(r["prompt"].endswith("aguarde minha tarefa."))
        self.assertNotRegex(r["prompt"], r"\{(projeto|tema|depois|CAMINHO_CEREBRO)\}")
        r = projetos.montar_prompt("jogo-do-roblox", "Arrumar a física do carro")
        self.assertEqual(r["tema"], "arrumar fisica carro")
        self.assertIn("buscar arrumar fisica carro --projeto jogo-do-roblox", r["prompt"])
        self.assertTrue(r["prompt"].endswith("comece esta tarefa: Arrumar a física do carro"))
        self.assertEqual((r["pasta"], r["pular_permissoes"]), (str(self.pasta), False))

    def test_registrar_sessao(self):
        self.novo()
        r = projetos.registrar_sessao("jogo-do-roblox", "claude", "sonnet", "Arrumar o placar", "novo")
        self.assertRegex(r["projeto"]["ultima_abertura"], r"^\d{4}-\d{2}-\d{2}T")
        linhas = (self.base / ".log" / "sessoes.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(linhas), 1)
        sessao = json.loads(linhas[0])
        self.assertEqual({k: sessao[k] for k in ("projeto", "ia", "modelo", "tarefa", "modo")},
                         {"projeto": "jogo-do-roblox", "ia": "claude", "modelo": "sonnet", "tarefa": "Arrumar o placar", "modo": "novo"})
        self.assertEqual(sessao["data"], projetos.listar()[0]["ultima_abertura"])
        projetos.registrar_sessao("jogo-do-roblox", "claude", "opus", "", "continuar")
        self.assertEqual(len((self.base / ".log" / "sessoes.jsonl").read_text(encoding="utf-8").splitlines()), 2)
        with self.assertRaises(ValueError):
            projetos.registrar_sessao("jogo-do-roblox", "claude", "opus", "", "outro")

    def test_pular_permissoes_so_liga_explicitamente(self):
        self.novo()
        with self.assertRaises(ValueError):
            projetos.editar("jogo-do-roblox", {"pular_permissoes": "sim"})
        self.assertIs(projetos.editar("jogo-do-roblox", {"pular_permissoes": True})["pular_permissoes"], True)
        self.assertIs(projetos.montar_prompt("jogo-do-roblox")["pular_permissoes"], True)
        self.assertIs(projetos.editar("jogo-do-roblox", {"pular_permissoes": False})["pular_permissoes"], False)
        self.assertEqual(projetos.validar(), [])  # campo opcional não gera "campo ausente"


class TestWorktree(Base):
    def git(self, *args, pasta=None):
        import subprocess
        r = subprocess.run(["git", "-C", str(pasta or self.pasta), *args], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def repo(self):
        self.git("init", "-q")
        self.git("config", "user.email", "teste@exemplo")
        self.git("config", "user.name", "teste")
        (self.pasta / "a.txt").write_text("um", encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-qm", "primeiro")

    def test_cria_reaproveita_e_pula_pasta_alheia(self):
        self.novo()
        self.repo()
        quando = __import__("datetime").datetime(2026, 10, 28, 14, 30, 0)
        r = projetos.criar_worktree("jogo-do-roblox", agora=quando)
        self.assertEqual((r["pasta"], r["branch"], r["reaproveitado"]), (str(self.pasta) + "-sessao2", "sessao2-20261028-143000", False))
        self.assertEqual((Path(r["pasta"]) / "a.txt").read_text(encoding="utf-8"), "um")
        self.assertEqual(self.git("rev-parse", "--abbrev-ref", "HEAD", pasta=r["pasta"]), "sessao2-20261028-143000")
        self.assertEqual(r["comandos"][1:], ["git merge sessao2-20261028-143000", f'git worktree remove "{r["pasta"]}"', "git branch -d sessao2-20261028-143000"])
        # de novo: o worktree já existe e é deste repositório -> reaproveita
        r2 = projetos.criar_worktree("jogo-do-roblox")
        self.assertEqual((r2["pasta"], r2["reaproveitado"]), (r["pasta"], True))
        # uma pasta -sessao3 qualquer (não worktree) não é tocada; o 4 seria o próximo novo
        self.git("worktree", "remove", r["pasta"])
        Path(str(self.pasta) + "-sessao2").mkdir()
        (Path(str(self.pasta) + "-sessao2") / "meu.txt").write_text("não mexer", encoding="utf-8")
        r3 = projetos.criar_worktree("jogo-do-roblox")
        self.assertEqual(r3["pasta"], str(self.pasta) + "-sessao3")
        self.assertEqual((Path(str(self.pasta) + "-sessao2") / "meu.txt").read_text(encoding="utf-8"), "não mexer")

    def test_pasta_sem_git(self):
        self.novo()
        with self.assertRaises(ValueError) as e:
            projetos.criar_worktree("jogo-do-roblox")
        self.assertIn("não é um repositório git", str(e.exception))


class TestPausaSegura(Base):
    def log(self):
        arq = self.base / ".log" / "sessoes.jsonl"
        return [json.loads(l) for l in arq.read_text(encoding="utf-8").splitlines()] if arq.exists() else []

    def test_registrar_pausa_anota_motivo_e_hora_sem_ser_sessao(self):
        self.novo()
        quando = __import__("datetime").datetime(2026, 10, 28, 14, 30, 5)
        r = projetos.registrar_pausa("jogo-do-roblox", "limite", agora=quando)
        self.assertEqual(r["pausa"], {"data": "2026-10-28T14:30:05", "projeto": "jogo-do-roblox", "ia": "claude", "modelo": "", "tarefa": "",
                                      "modo": "pausa", "motivo": "limite"})
        self.assertEqual(self.log(), [r["pausa"]])
        self.assertIsNone(projetos.listar()[0]["ultima_abertura"])  # pausar não é abrir
        with self.assertRaises(ValueError):
            projetos.registrar_pausa("jogo-do-roblox", "qualquer-coisa")
        with self.assertRaises(ValueError):
            projetos.registrar_pausa("nao-existe", "limite")
        self.assertEqual(len(self.log()), 1)

    def test_sessao_com_motivo(self):
        self.novo()
        projetos.registrar_sessao("jogo-do-roblox", "claude", "sonnet", "", "novo", motivo="uso")
        projetos.registrar_sessao("jogo-do-roblox", "claude", "sonnet", "x", "novo")
        self.assertEqual([l.get("motivo") for l in self.log()], ["uso", None])

    def test_listar_mostra_pausa_pendente_e_abrir_depois_desfaz(self):
        self.novo()
        com = lambda: projetos._com_status(projetos.listar(), self.base)[0]["pausa"]
        self.assertIsNone(com())
        projetos.registrar_pausa("jogo-do-roblox", "limite")
        self.assertEqual((com()["motivo"], bool(com()["data"])), ("limite", True))
        projetos.registrar_sessao("jogo-do-roblox", "claude", "sonnet", "retomada", "novo")  # abriu uma sessão nova depois
        self.assertIsNone(com())

    def test_estado_da_pausa_e_atualizar_so_as_duas_secoes(self):
        self.novo()
        projetos.preencher_estado("jogo-do-roblox", "Fazer o jogo de corrida", "Roblox + Lua")
        e = projetos.estado_da_pausa("jogo-do-roblox")
        self.assertEqual((e["arquivo"], e["estado_atual"], e["proximos"]), ("estado/jogo-do-roblox.md", "", ""))
        projetos.atualizar_estado_pausa("jogo-do-roblox", "Carro anda e freia.\nFalta a física das curvas.", "1. Curvas\n2. Placar")
        texto = (self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8")
        self.assertIn("## Estado atual\nCarro anda e freia.\nFalta a física das curvas.\n\n## Próximos passos\n1. Curvas\n2. Placar\n\n## Armadilhas", texto)
        self.assertIn("## Objetivo\nFazer o jogo de corrida", texto)  # o resto ficou
        self.assertIn("## Stack\nRoblox + Lua", texto)
        self.assertTrue(texto.startswith("palavras-chave:"))
        self.assertEqual(cerebro.validar(self.base), [])
        self.assertTrue(any((self.base / "estado" / ".anteriores").iterdir()))  # versão anterior guardada
        e = projetos.estado_da_pausa("jogo-do-roblox")
        self.assertEqual((e["estado_atual"], e["proximos"]), ("Carro anda e freia.\nFalta a física das curvas.", "1. Curvas\n2. Placar"))
        # trocar de novo substitui (não acumula)
        projetos.atualizar_estado_pausa("jogo-do-roblox", "Só isso agora.", "")
        e = projetos.estado_da_pausa("jogo-do-roblox")
        self.assertEqual((e["estado_atual"], e["proximos"]), ("Só isso agora.", ""))

    def test_estado_da_pausa_cria_o_esqueleto_se_faltar_e_recusa_o_que_nao_cabe(self):
        self.novo()
        (self.base / "estado" / "jogo-do-roblox.md").unlink()
        self.assertEqual(projetos.estado_da_pausa("jogo-do-roblox")["estado_atual"], "")
        self.assertTrue((self.base / "estado" / "jogo-do-roblox.md").exists())
        antes = (self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8")
        with self.assertRaises(ValueError) as e:
            projetos.atualizar_estado_pausa("jogo-do-roblox", "palavra " * 400, "")
        self.assertIn("palavras (máximo 300)", str(e.exception))
        self.assertEqual((self.base / "estado" / "jogo-do-roblox.md").read_text(encoding="utf-8"), antes)  # nada foi gravado
        with self.assertRaises(ValueError):
            projetos.estado_da_pausa("nao-existe")

    def test_prompt_de_retomada_aponta_para_o_estado_sem_pedir_para_reexplicar(self):
        self.novo()
        r = projetos.montar_prompt("jogo-do-roblox", retomada=True)
        self.assertIn("buscar jogo-do-roblox estado proximos passos --projeto jogo-do-roblox", r["prompt"])
        self.assertIn("retome de onde paramos", r["prompt"])
        self.assertIn("Estado atual e Próximos passos", r["prompt"])
        self.assertIn("sem me pedir para explicar tudo de novo", r["prompt"])
        self.assertNotIn("aguarde minha tarefa", r["prompt"])
        self.assertNotRegex(r["prompt"], r"\{(depois|tema|projeto|CAMINHO_CEREBRO)\}")
        normal = projetos.montar_prompt("jogo-do-roblox")
        self.assertTrue(normal["prompt"].endswith("aguarde minha tarefa."))


class TestChaveDeApi(Base):
    def test_usar_api_key_e_so_um_liga_desliga_desligado_por_padrao(self):
        p = self.novo()["projeto"]
        self.assertIs(p["usar_api_key"], False)
        self.assertIs(projetos.editar("jogo-do-roblox", {"usar_api_key": True})["usar_api_key"], True)
        with self.assertRaises(ValueError):
            projetos.editar("jogo-do-roblox", {"usar_api_key": "sim"})
        self.assertIs(projetos.listar()[0]["usar_api_key"], True)
        # nenhuma chave vai parar no arquivo: só o booleano
        bruto = self.arq.read_text(encoding="utf-8")
        self.assertIn('"usar_api_key": true', bruto)
        self.assertNotIn("sk-", bruto)
        self.assertEqual(projetos.validar(), [])
        self.assertEqual(projetos.adicionar({"nome": "Outro", "pasta": str(self.pasta), "usar_api_key": True}, base=self.base)["projeto"]["usar_api_key"], True)


class TestLinhaDeComando(Base):
    def rodar(self, entrada, *argv):
        saida, erro = io.StringIO(), io.StringIO()
        stdin = io.TextIOWrapper(io.BytesIO(entrada.encode("utf-8")), encoding="utf-8")
        with mock.patch("sys.stdin", stdin), contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
            codigo = projetos.main(list(argv))
        return codigo, saida.getvalue(), erro.getvalue()

    def test_fluxo_completo_em_json(self):
        codigo, saida, _ = self.rodar(json.dumps({"nome": "Jogo", "pasta": str(self.pasta), "descricao": "ação ✓"}), "adicionar", "--json")
        self.assertEqual(codigo, 0)
        self.assertEqual(json.loads(saida)["projeto"]["id"], "jogo")
        _, saida, _ = self.rodar("", "listar", "--json")
        lista = json.loads(saida)["projetos"]
        self.assertEqual((lista[0]["pasta_existe"], lista[0]["estado_existe"], lista[0]["descricao"]), (True, True, "ação ✓"))
        self.assertEqual(self.rodar(json.dumps({"nome": "Jogo 2"}), "editar", "jogo", "--json")[0], 0)
        self.assertEqual(self.rodar("", "abertura", "jogo", "--json")[0], 0)
        self.assertEqual(self.rodar("", "validar", "--json")[1], '{"problemas":[]}\n')
        _, saida, _ = self.rodar("", "preparar", "jogo", "--json")
        self.assertEqual(json.loads(saida)["acao"], "criar")
        self.assertEqual(self.rodar("", "remover", "jogo", "--json")[0], 0)
        self.assertEqual(json.loads(self.rodar("", "listar", "--json")[1])["projetos"], [])

    def test_erros_saem_com_2_em_uma_linha(self):
        codigo, saida, erro = self.rodar("{}", "adicionar", "--json")
        self.assertEqual((codigo, saida), (2, ""))
        self.assertTrue(erro.startswith("erro: "))
        self.assertEqual(self.rodar("não é json", "adicionar")[2], "erro: entrada não é um JSON válido\n")

    def test_validar_com_problema_sai_com_1(self):
        self.arq.write_text(json.dumps([{"id": "x", "nome": "X", "pasta": str(self.raiz / "sumiu")}]), encoding="utf-8")
        codigo, saida, _ = self.rodar("", "validar")
        self.assertEqual(codigo, 1)
        self.assertIn("x: pasta não existe", saida)


class TestOutrasIAs(Base):
    """Fase 10.1: o Antigravity como segunda IA; IAs e modelos vêm do app/ias-dados.json (o mesmo do widget)."""

    def test_ias_e_modelos_vem_do_json_compartilhado(self):
        dados = json.loads((Path(__file__).resolve().parents[2] / "app" / "ias-dados.json").read_text(encoding="utf-8"))
        self.assertEqual(projetos.IAS, tuple(dados))
        self.assertEqual(projetos.IAS[0], "claude")
        self.assertEqual(projetos.MODELOS, ("sonnet", "opus", "haiku"))

    def test_modelo_validado_pela_ia_do_projeto(self):
        p = self.novo(ia="antigravity", modelo_padrao="gemini-4-argon-medium")["projeto"]
        self.assertEqual((p["ia"], p["modelo_padrao"]), ("antigravity", "gemini-4-argon-medium"))
        sem_modelo = projetos.adicionar({"nome": "Outro", "pasta": str(self.pasta), "ia": "antigravity"}, base=self.base)["projeto"]
        self.assertEqual(sem_modelo["modelo_padrao"], "gemini-3.8-flash-medium")  # o padrão DA IA, não "sonnet"
        with self.assertRaisesRegex(ValueError, "modelo_padrao inválido"):
            self.novo(ia="antigravity", modelo_padrao="sonnet")  # modelo do Claude numa IA que não o tem
        with self.assertRaisesRegex(ValueError, "modelo_padrao inválido"):
            self.novo(modelo_padrao="gemini-3.8-flash-low")  # e o contrário
        with self.assertRaisesRegex(ValueError, "ia inválida"):
            self.novo(ia="chatgpt")

    def test_ia_reserva(self):
        p = self.novo(ia_reserva="antigravity")["projeto"]
        self.assertEqual(p["ia_reserva"], "antigravity")
        for ruim in ("claude", "chatgpt", 5):  # igual à ia do projeto, desconhecida, não é texto
            with self.assertRaisesRegex(ValueError, "ia_reserva inválida"):
                self.novo(ia_reserva=ruim)
        sem = projetos.editar(p["id"], {"ia_reserva": None})
        self.assertNotIn("ia_reserva", sem)  # tirar é só mandar vazio
        self.assertNotIn("ia_reserva", json.loads(self.arq.read_text(encoding="utf-8"))[0])

    def test_modelos_por_ia(self):
        p = self.novo(ia_reserva="antigravity", modelos_por_ia={"antigravity": "gemini-3.8-flash-low", "claude": "opus"})["projeto"]
        self.assertEqual(p["modelos_por_ia"], {"antigravity": "gemini-3.8-flash-low", "claude": "opus"})
        casos = [
            ({"antigravity": "sonnet"}, "modelo inválido para antigravity"),
            ({"chatgpt": "gpt"}, "ia desconhecida"),
            (["antigravity"], "precisa ser um objeto"),
        ]
        for valor, trecho in casos:
            with self.subTest(valor=valor), self.assertRaisesRegex(ValueError, trecho):
                projetos.editar(p["id"], {"modelos_por_ia": valor})
        editado = projetos.editar(p["id"], {"modelos_por_ia": {"antigravity": "gemini-4-argon-high"}})
        self.assertEqual(editado["modelos_por_ia"], {"antigravity": "gemini-4-argon-high"})
        self.assertEqual(projetos.validar(), [])

    def test_projetos_json_antigo_continua_valido_sem_migracao(self):
        # o formato dos projetos que já existem (como "mao" e "adicionar-ao-brain"): sem ia_reserva nem modelos_por_ia
        antigo = [
            {"id": "mao", "nome": "Mão", "pasta": str(self.pasta), "ia": "claude", "modelo_padrao": "sonnet", "descricao": "estudo",
             "tags": ["mão"], "cor": "#ff0000", "ultima_abertura": "2026-10-28T21:32:00", "pular_permissoes": True, "usar_api_key": False},
            {"id": "adicionar-ao-brain", "nome": "Brain", "pasta": str(self.pasta), "ia": "claude", "modelo_padrao": "sonnet", "descricao": "",
             "tags": [], "cor": "#00eeff", "ultima_abertura": "2026-10-28T21:48:44", "pular_permissoes": True, "usar_api_key": False},
        ]
        self.arq.write_text(json.dumps(antigo, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(projetos.validar(), [])
        self.assertEqual(projetos.listar(), antigo)  # lido igual, sem campos novos
        projetos.marcar_abertura("mao", "2026-10-29T10:00:00")  # e uma escrita não acrescenta nada
        no_disco = json.loads(self.arq.read_text(encoding="utf-8"))
        self.assertEqual(set(no_disco[0]), set(antigo[0]))
        self.assertEqual(no_disco[1], antigo[1])


class TestContinuarEmOutraIA(Base):
    """Fase 10.8: pausa com a IA pausada, retomada na IA reserva e o que a tela precisa para sugerir onde continuar."""

    def log(self):
        arq = self.base / ".log" / "sessoes.jsonl"
        return [json.loads(l) for l in arq.read_text(encoding="utf-8").splitlines()] if arq.exists() else []

    def status(self):
        return projetos._com_status(projetos.listar(), self.base)[0]

    def test_pausa_anota_a_ia_pausada_e_o_listar_mostra(self):
        self.novo(ia_reserva="antigravity")
        projetos.registrar_pausa("jogo-do-roblox", "limite")  # sem ia: a do projeto
        projetos.registrar_pausa("jogo-do-roblox", "limite", ia="antigravity")
        self.assertEqual([l["ia"] for l in self.log()], ["claude", "antigravity"])
        self.assertEqual(self.status()["pausa"]["ia"], "antigravity")
        with self.assertRaisesRegex(ValueError, "ia desconhecida"):
            projetos.registrar_pausa("jogo-do-roblox", "limite", ia="chatgpt")
        self.assertEqual(len(self.log()), 2)

    def test_cli_pausa_registrar_com_ia(self):
        self.novo(ia_reserva="antigravity")
        self.assertEqual(projetos.main(["pausa-registrar", "jogo-do-roblox", "--motivo", "limite", "--ia", "antigravity"]), 0)
        self.assertEqual(self.log()[-1]["ia"], "antigravity")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            projetos.main(["pausa-registrar", "jogo-do-roblox", "--ia", "chatgpt"])

    def test_listar_traz_a_ultima_sessao_em_cada_ia_e_as_recentes(self):
        self.novo(ia_reserva="antigravity")
        agora = __import__("datetime").datetime.now().replace(microsecond=0)
        antes = (agora - __import__("datetime").timedelta(hours=2)).isoformat()
        linhas = [{"data": antes, "projeto": "jogo-do-roblox", "ia": "claude", "modelo": "sonnet", "tarefa": "", "modo": "novo"},
                  {"data": agora.isoformat(), "projeto": "jogo-do-roblox", "ia": "antigravity", "modelo": "gemini-3.8-flash-low", "tarefa": "", "modo": "novo"},
                  {"data": agora.isoformat(), "projeto": "jogo-do-roblox", "ia": "antigravity", "modelo": "", "tarefa": "", "modo": "novo", "motivo": "uso"}]
        (self.base / ".log").mkdir(exist_ok=True)
        (self.base / ".log" / "sessoes.jsonl").write_text("".join(json.dumps(l) + "\n" for l in linhas), encoding="utf-8")
        p = self.status()
        self.assertEqual(p["ultima_sessao_por_ia"]["claude"], {"data": antes, "modelo": "sonnet"})
        self.assertEqual(p["ultima_sessao_por_ia"]["antigravity"]["modelo"], "gemini-3.8-flash-low")
        self.assertEqual(p["recentes_por_ia"], {"claude": 1, "antigravity": 1})  # a sessão só para ver o /usage não conta
        self.assertEqual(p["pausa"], None)

    def test_sem_log_nada_inventado(self):
        self.novo()
        p = self.status()
        self.assertEqual((p["ultima_sessao_por_ia"], p["recentes_por_ia"]), ({}, {"claude": 0, "antigravity": 0}))

    def test_retomada_com_a_ia_reserva_monta_o_prompt_do_estado(self):
        projeto = self.novo(ia_reserva="antigravity")["projeto"]
        (self.base / "estado" / f"{projeto['id']}.md").write_text("## Estado atual\nx\n## Próximos passos\ny\n", encoding="utf-8")
        r = projetos.montar_prompt(projeto["id"], retomada=True, base=self.base)
        self.assertIn("estado", r["tema"])
        self.assertIn(projeto["id"], r["prompt"])
        self.assertNotIn("comece esta tarefa", r["prompt"])  # retomada não leva tarefa nova


class TestPrepararPorIA(Base):
    """Fase 10.4: cada IA do projeto (e a reserva) ganha o arquivo que ela lê; o bloco "## Cérebro" é neutro."""

    def arquivos(self):
        return sorted(p.name for p in self.pasta.iterdir() if p.is_file())

    def test_projeto_do_agy_gera_agents_md_e_nao_claude_md(self):
        self.novo(ia="antigravity")
        plano = projetos.preparar_projeto("jogo-do-roblox")
        self.assertEqual((plano["acao"], plano["escrito"], self.arquivos()), ("criar", False, []))
        self.assertIn("AGENTS.md (proposto)", plano["diff"])
        self.assertEqual([(a["ia"], a["nome"]) for a in plano["arquivos"]], [("antigravity", "AGENTS.md")])
        feito = projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertTrue(feito["escrito"])
        self.assertEqual(self.arquivos(), ["AGENTS.md"])
        texto = (self.pasta / "AGENTS.md").read_text(encoding="utf-8")
        self.assertLessEqual(len(texto.splitlines()), 20)
        for esperado in ("# Jogo do Roblox", "## Cérebro", "`jogo-do-roblox`", "cerebro-buscar", "buscar termos --projeto jogo-do-roblox", "Nunca leia os arquivos do cérebro direto"):
            self.assertIn(esperado, texto)

    def test_com_ia_reserva_gera_os_dois_arquivos(self):
        self.novo(ia="antigravity", ia_reserva="claude", modelos_por_ia={"claude": "opus"})
        plano = projetos.preparar_projeto("jogo-do-roblox")
        self.assertEqual([a["nome"] for a in plano["arquivos"]], ["AGENTS.md", "CLAUDE.md"])
        self.assertIn("AGENTS.md (proposto)", plano["diff"])
        self.assertIn("CLAUDE.md (proposto)", plano["diff"])
        self.assertEqual(self.arquivos(), [])  # sem confirmar não grava nada
        projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertEqual(self.arquivos(), ["AGENTS.md", "CLAUDE.md"])
        # o mesmo bloco nos dois: nenhuma IA recebe regras diferentes
        a = (self.pasta / "AGENTS.md").read_text(encoding="utf-8").split("## Cérebro", 1)[1]
        c = (self.pasta / "CLAUDE.md").read_text(encoding="utf-8").split("## Cérebro", 1)[1]
        self.assertEqual(a, c)

    def test_projeto_do_claude_com_reserva_agy_gera_claude_md_e_agents_md(self):
        self.novo(ia_reserva="antigravity")
        projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertEqual(self.arquivos(), ["AGENTS.md", "CLAUDE.md"])

    def test_sem_reserva_um_projeto_do_claude_continua_so_com_claude_md(self):
        self.novo()
        plano = projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertEqual(self.arquivos(), ["CLAUDE.md"])
        self.assertEqual((plano["acao"], plano["arquivo"]), ("criar", str(self.pasta / "CLAUDE.md")))  # o formato de sempre
        self.assertEqual(len(plano["arquivos"]), 1)

    def test_nunca_sobrescreve_so_acrescenta_em_cada_arquivo(self):
        self.novo(ia="antigravity", ia_reserva="claude")
        agents = "# Regras do agy\r\n\r\nSempre em português.\r\n"
        (self.pasta / "AGENTS.md").write_bytes(agents.encode("utf-8"))  # só o AGENTS.md já existe
        plano = projetos.preparar_projeto("jogo-do-roblox")
        self.assertEqual([a["acao"] for a in plano["arquivos"]], ["acrescentar", "criar"])
        self.assertEqual(plano["acao"], "criar")  # o resumo: há algo a criar
        self.assertEqual((self.pasta / "AGENTS.md").read_bytes(), agents.encode("utf-8"))
        self.assertNotIn("-Sempre em português", plano["diff"])
        projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        final = (self.pasta / "AGENTS.md").read_bytes().decode("utf-8")
        self.assertTrue(final.startswith(agents))
        self.assertIn("\r\n## Cérebro\r\n", final)
        # de novo: tudo já preparado, nada é regravado
        antes = {n: (self.pasta / n).read_bytes() for n in self.arquivos()}
        de_novo = projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertEqual((de_novo["acao"], de_novo["escrito"]), ("ja-preparado", False))
        self.assertEqual({n: (self.pasta / n).read_bytes() for n in self.arquivos()}, antes)

    def test_um_arquivo_ruim_nao_deixa_o_outro_pela_metade(self):
        self.novo(ia="antigravity", ia_reserva="claude")
        (self.pasta / "CLAUDE.md").write_bytes(b"\xff\xfe\x00invalido")  # não é UTF-8
        with self.assertRaises(UnicodeDecodeError):
            projetos.preparar_projeto("jogo-do-roblox", confirmar=True)
        self.assertEqual(self.arquivos(), ["CLAUDE.md"], "o AGENTS.md não foi criado: primeiro confere tudo, depois grava")

    def test_o_bloco_e_neutro_e_o_prompt_inicial_nao_cita_ferramenta_de_uma_ia_so(self):
        bloco = projetos.BLOCO_CLAUDE_MD
        self.assertLessEqual(len(bloco.strip().splitlines()) + 2, projetos.MAX_LINHAS_CLAUDE_MD)
        for neutro in ("skill cerebro-buscar", 'python "{cerebro}/tools/cerebro.py" buscar'):
            self.assertIn(neutro, bloco)
        prompt_base = (Path(__file__).resolve().parent / "prompt_inicial.txt").read_text(encoding="utf-8")
        self.novo()
        textos = [prompt_base, projetos.RETOMADA, projetos.montar_prompt("jogo-do-roblox", "arrumar o menu")["prompt"],
                  projetos.montar_prompt("jogo-do-roblox", retomada=True)["prompt"]]
        for texto in textos:
            for ferramenta in ("claude", "/compactar", "anthropic"):
                self.assertNotIn(ferramenta, texto.lower(), f"{ferramenta!r} em: {texto[:60]}...")
        # o {depois} serve para qualquer IA: com tarefa, sem tarefa e na retomada
        self.assertTrue(textos[2].endswith("comece esta tarefa: arrumar o menu"))
        self.assertTrue(projetos.montar_prompt("jogo-do-roblox")["prompt"].endswith("aguarde minha tarefa."))
        self.assertTrue(textos[3].endswith("sem me pedir para explicar tudo de novo."))
        for texto in textos[2:]:
            self.assertNotRegex(texto, r"\{(projeto|tema|depois|CAMINHO_CEREBRO)\}")


if __name__ == "__main__":
    unittest.main()
