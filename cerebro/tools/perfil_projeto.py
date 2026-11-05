#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""perfil_projeto.py - o que o botão [ler projeto] usa para entender um projeto.

Duas partes:
  - varrer (0 tokens): passa por TODOS os arquivos da pasta, sem abrir o conteúdo deles, e tira linguagens, dependências
    (package.json, requirements, pyproject, Cargo, go.mod, csproj) e os arquivos principais. Nunca abre .env nem chaves.
  - perfil (com IA): a sessão aberta pelo botão roda "instrucoes ID", lê o cérebro e os arquivos principais e grava com
    "salvar ID --arquivo RASCUNHO" o que entendeu: assunto, stack, tarefas e termos de busca EM INGLÊS (as skills são
    descritas em inglês e os resumos do cérebro em português; sem isso a busca compara idiomas diferentes).

O perfil fica em %APPDATA%/meu-widget/perfis/ID.json (MEU_WIDGET_PASTA troca a pasta), fora do projeto e do git.
Os termos saem para a busca no GitHub: por isso a validação só aceita termos curtos e técnicos.

  perfil_projeto.py instrucoes ID         o resumo da varredura + os passos para a IA
  perfil_projeto.py salvar ID --arquivo RASCUNHO   valida e grava o perfil
  perfil_projeto.py ler ID [--json]       o perfil gravado (ou null) + a varredura
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

DIR_ATUAL = Path(__file__).resolve().parent
if str(DIR_ATUAL) not in sys.path:
    sys.path.insert(0, str(DIR_ATUAL))

import projetos  # noqa: E402

IGNORADAS = {"node_modules", ".git", ".svn", "dist", "build", "out", "release", "__pycache__", ".venv", "venv", "env", "target", "bin", "obj",
             "library", "temp", "logs", ".next", ".nuxt", ".cache", ".idea", ".vs", ".vscode", "coverage", "vendor", ".claude", ".agents", ".gradle"}
LIMITE_ARQUIVOS = 60000
LIMITE_SEGUNDOS = 8
MAX_DEPENDENCIAS = 150
MAX_PRINCIPAIS = 15  # abrir os 25 maiores inteiros custava de 48 a 340 mil tokens por leitura
LINHAS_POR_ARQUIVO = 120  # o começo de um arquivo já diz o que ele faz; 15 x 120 linhas ficam em torno de 25 mil tokens
PROFUNDIDADE_MANIFESTO = 4  # manifestos mais fundo que isso costumam ser exemplos ou dependências copiadas

# extensão -> (nome para a tela, termo em inglês para a busca); sem termo = não diz nada sobre o projeto
EXTENSOES = {
    ".js": ("JavaScript", "javascript"), ".mjs": ("JavaScript", "javascript"), ".cjs": ("JavaScript", "javascript"), ".jsx": ("React", "react"),
    ".ts": ("TypeScript", "typescript"), ".tsx": ("React/TypeScript", "react"), ".vue": ("Vue", "vue"), ".svelte": ("Svelte", "svelte"),
    ".py": ("Python", "python"), ".ipynb": ("Jupyter", "jupyter"), ".r": ("R", "r"), ".cs": ("C#", "csharp"), ".cpp": ("C++", "cpp"), ".cc": ("C++", "cpp"),
    ".hpp": ("C++", "cpp"), ".c": ("C", "c"), ".rs": ("Rust", "rust"), ".go": ("Go", "go"), ".java": ("Java", "java"), ".kt": ("Kotlin", "kotlin"),
    ".swift": ("Swift", "swift"), ".php": ("PHP", "php"), ".rb": ("Ruby", "ruby"), ".lua": ("Lua", "lua"), ".luau": ("Luau", "roblox"), ".gd": ("GDScript", "godot"),
    ".dart": ("Dart", "flutter"), ".html": ("HTML", "html"), ".css": ("CSS", "css"), ".scss": ("SCSS", "css"), ".sql": ("SQL", "sql"), ".ps1": ("PowerShell", "powershell"),
    ".sh": ("Shell", "bash"), ".ino": ("Arduino", "arduino"), ".tex": ("LaTeX", "latex"), ".blend": ("Blender", "blender"), ".stl": ("Modelos 3D (STL)", "3d-printing"),
    ".fbx": ("Modelos 3D", "3d-models"), ".glb": ("Modelos 3D", "3d-models"), ".gltf": ("Modelos 3D", "3d-models"), ".unity": ("Unity", "unity"), ".uproject": ("Unreal", "unreal"),
    ".pdf": ("PDF", "pdf"), ".docx": ("Word", "docx"), ".xlsx": ("Excel", "xlsx"), ".pptx": ("PowerPoint", "pptx"), ".md": ("Markdown", ""), ".json": ("JSON", ""),
}
CODIGO = {".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".py", ".cs", ".cpp", ".cc", ".c", ".rs", ".go", ".java", ".kt", ".swift", ".php", ".rb", ".lua", ".luau", ".gd", ".dart", ".ino"}
ENTRADAS = re.compile(r"^(main|index|app|server|program|__main__|cli)\.[a-z]+$", re.I)
DOCUMENTOS = re.compile(r"^(readme|claude|agents|gemini|contributing|architecture|design|roadmap|spec)[^/\\]*\.(md|mdx|txt|rst)$", re.I)
# nomes que a varredura nunca sugere abrir (e a instrução manda não abrir)
SEGREDO = re.compile(r"(^|[._-])(env|secrets?|credentials?|passwords?)([._-]|$)|\.(pem|key|pfx|p12|keystore)$|^id_(rsa|ed25519)", re.I)
RE_TERMO = re.compile(r"^[a-z0-9][a-z0-9 .+#/-]{1,39}$")
DEPENDENCIA_RUIDO = re.compile(r"^(@types/|eslint|prettier|typescript$|ts-node|nodemon|husky|lint-staged|rimraf|cross-env|concurrently|pytest|black|flake8|mypy|ruff|pip$|setuptools$|wheel$)")


def pasta_perfis() -> Path:
    if os.environ.get("MEU_WIDGET_PASTA"):
        return Path(os.environ["MEU_WIDGET_PASTA"]) / "perfis"
    if os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / "meu-widget" / "perfis"
    return Path.home() / ".config" / "meu-widget" / "perfis"


def arquivo_perfil(id_: str) -> Path:
    return pasta_perfis() / f"{id_}.json"


def arquivo_rascunho(id_: str) -> Path:
    return pasta_perfis() / f"{id_}.rascunho.json"


def _ler_texto(caminho: Path, maximo: int = 512 * 1024) -> str:
    try:
        if caminho.stat().st_size > maximo:
            return ""
        return caminho.read_bytes().decode("utf-8-sig", errors="replace")
    except OSError:
        return ""


def _nome_pacote_python(linha: str) -> str:
    m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", linha)
    return m.group(1).lower() if m and not linha.lstrip().startswith(("#", "-")) else ""


def _dependencias(caminho: Path) -> tuple[str, list[str]]:
    """(ecossistema, nomes) de um manifesto; ("", []) se o arquivo não é um manifesto conhecido."""
    nome = caminho.name.lower()
    texto = ""
    if nome == "package.json":
        texto = _ler_texto(caminho)
        try:
            d = json.loads(texto)
            return "npm", [*d.get("dependencies", {}), *d.get("devDependencies", {})]
        except (ValueError, AttributeError, TypeError):
            return "npm", []
    if nome.startswith("requirements") and nome.endswith(".txt"):
        return "python", [n for n in map(_nome_pacote_python, _ler_texto(caminho).splitlines()) if n]
    if nome == "pyproject.toml":
        texto = _ler_texto(caminho)
        bloco = re.search(r"dependencies\s*=\s*\[(.*?)\]", texto, re.S)
        return "python", [n for n in (_nome_pacote_python(x) for x in re.findall(r"[\"']([^\"']+)[\"']", bloco.group(1) if bloco else "")) if n]
    if nome == "cargo.toml":
        bloco = re.search(r"\[dependencies\](.*?)(\n\[|\Z)", _ler_texto(caminho), re.S)
        return "rust", re.findall(r"^\s*([A-Za-z0-9_-]+)\s*=", bloco.group(1) if bloco else "", re.M)
    if nome == "go.mod":
        return "go", [m.split("/")[-1] for m in re.findall(r"^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+/\S+)\s+v", _ler_texto(caminho), re.M)]
    if nome.endswith(".csproj"):
        return "nuget", re.findall(r"<PackageReference\s+Include=\"([^\"]+)\"", _ler_texto(caminho), re.I)
    if nome == "composer.json":
        try:
            return "php", list(json.loads(_ler_texto(caminho)).get("require", {}))
        except (ValueError, AttributeError):
            return "php", []
    return "", []


def varrer(pasta) -> dict:
    """Todos os arquivos da pasta (menos as pastas geradas): só nomes e tamanhos, mais os manifestos. Tem teto de arquivos e de tempo."""
    pasta = Path(pasta)
    r = {"existe": pasta.is_dir(), "arquivos": 0, "parcial": False, "linguagens": [], "pastas": [], "dependencias": {}, "termos": [], "principais": []}
    if not r["existe"]:
        return r
    inicio = time.monotonic()
    extensoes: dict[str, int] = {}
    por_pasta: dict[str, int] = {}
    deps: dict[str, list[str]] = {}
    codigo: list[tuple[int, str]] = []
    docs: list[str] = []
    entradas: list[str] = []
    for raiz, subpastas, arquivos in os.walk(pasta, onerror=lambda _e: None):
        subpastas[:] = sorted(d for d in subpastas if d.lower() not in IGNORADAS and not d.lower().startswith("app_backup"))
        rel_raiz = Path(raiz).relative_to(pasta)
        profundidade = len(rel_raiz.parts)
        topo = rel_raiz.parts[0] if rel_raiz.parts else "."
        for nome in arquivos:
            r["arquivos"] += 1
            por_pasta[topo] = por_pasta.get(topo, 0) + 1
            ext = Path(nome).suffix.lower()
            extensoes[ext] = extensoes.get(ext, 0) + 1
            rel = (rel_raiz / nome).as_posix()
            if SEGREDO.search(nome):
                continue
            if profundidade <= PROFUNDIDADE_MANIFESTO:
                eco, nomes = _dependencias(Path(raiz) / nome)
                if eco:
                    deps.setdefault(eco, []).extend(nomes)
            if DOCUMENTOS.match(nome):
                docs.append(rel)
            elif ENTRADAS.match(nome) and ext in CODIGO and profundidade <= 2:
                entradas.append(rel)
            elif ext in CODIGO:
                try:
                    codigo.append(((Path(raiz) / nome).stat().st_size, rel))
                except OSError:
                    pass
        if r["arquivos"] >= LIMITE_ARQUIVOS or time.monotonic() - inicio > LIMITE_SEGUNDOS:
            r["parcial"] = True
            break

    contagem: dict[str, int] = {}
    termos: list[str] = []
    for ext, n in sorted(extensoes.items(), key=lambda x: -x[1]):
        if ext in EXTENSOES:
            rotulo, termo = EXTENSOES[ext]
            contagem[rotulo] = contagem.get(rotulo, 0) + n
            if termo and termo not in termos:
                termos.append(termo)
    r["linguagens"] = [{"nome": k, "arquivos": v} for k, v in sorted(contagem.items(), key=lambda x: -x[1])]
    r["pastas"] = [{"nome": k, "arquivos": v} for k, v in sorted(por_pasta.items(), key=lambda x: -x[1])[:15]]
    for eco, nomes in deps.items():
        unicos = sorted({n for n in nomes if isinstance(n, str)})[:MAX_DEPENDENCIAS]
        r["dependencias"][eco] = unicos
        for n in unicos:
            curto = n.lower().split("/")[-1]
            if not DEPENDENCIA_RUIDO.match(n.lower()) and RE_TERMO.match(curto) and curto not in termos:
                termos.append(curto)
    r["termos"] = termos[:60]
    codigo.sort(reverse=True)
    r["principais"] = (sorted(docs, key=lambda x: (x.count("/"), x))[:10] + entradas[:6] + [c[1] for c in codigo])[:MAX_PRINCIPAIS]
    return r


def _projeto(id_: str) -> dict:
    lista = projetos._ler(projetos.arquivo_projetos())
    return projetos._completar(lista[projetos._achar(lista, id_)])


def _lista_de_textos(valor, campo: str, minimo: int, maximo: int, tamanho: int, erros: list[str]) -> list[str]:
    if not isinstance(valor, list):
        erros.append(f"{campo}: precisa ser uma lista")
        return []
    limpos: list[str] = []
    for item in valor:
        t = re.sub(r"\s+", " ", str(item)).strip()
        if t and t[:tamanho] not in limpos:
            limpos.append(t[:tamanho])
    if not minimo <= len(limpos) <= maximo:
        erros.append(f"{campo}: precisa ter de {minimo} a {maximo} itens (veio {len(limpos)})")
    return limpos


def validar_perfil(d) -> tuple[dict, list[str]]:
    """(perfil limpo, erros). Os termos saem para a busca no GitHub: só termos técnicos curtos, sem acento e sem nada do projeto em si."""
    if not isinstance(d, dict):
        return {}, ["o perfil precisa ser um objeto JSON"]
    erros: list[str] = []
    assunto = re.sub(r"\s+", " ", str(d.get("assunto", ""))).strip()
    if not 20 <= len(assunto) <= 600:
        erros.append("assunto: precisa ter de 20 a 600 caracteres")
    tipo = re.sub(r"\s+", " ", str(d.get("tipo", ""))).strip()[:80]
    stack = _lista_de_textos(d.get("stack", []), "stack", 1, 30, 40, erros)
    tarefas = _lista_de_textos(d.get("tarefas", []), "tarefas", 0, 15, 120, erros)
    termos = [t.lower() for t in _lista_de_textos(d.get("termos", []), "termos", 8, 60, 40, erros)]
    evitar = [t.lower() for t in _lista_de_textos(d.get("evitar", []), "evitar", 0, 30, 40, erros)]
    ruins = [t for t in termos + evitar if not RE_TERMO.match(t)]
    if ruins:
        erros.append("termos em inglês, minúsculos, sem acento e de 2 a 40 caracteres; recusados: " + ", ".join(ruins[:8]))
    return {"assunto": assunto, "tipo": tipo, "stack": stack, "tarefas": tarefas, "termos": termos, "evitar": evitar}, erros


def salvar(id_: str, arquivo) -> dict:
    projeto = _projeto(id_)
    origem = Path(arquivo)
    try:
        dados = json.loads(origem.read_bytes().decode("utf-8-sig"))
    except (OSError, ValueError) as e:
        raise ValueError(f"não consegui ler o rascunho {origem}: {e}") from e
    perfil, erros = validar_perfil(dados)
    if erros:
        raise ValueError("perfil recusado: " + "; ".join(erros))
    perfil.update({"versao": 1, "id": projeto["id"], "lido_em": time.strftime("%Y-%m-%dT%H:%M:%S")})
    destino = arquivo_perfil(id_)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    tmp.write_text(json.dumps(perfil, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, destino)
    if origem.resolve() == arquivo_rascunho(id_).resolve():
        try:
            origem.unlink()
        except OSError:
            pass
    return perfil


def ler_perfil(id_: str) -> dict | None:
    """O perfil gravado; arquivo ausente ou corrompido vira None (o widget cai na varredura)."""
    try:
        d = json.loads(arquivo_perfil(id_).read_bytes().decode("utf-8-sig"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and d.get("termos") else None


def ler(id_: str) -> dict:
    projeto = _projeto(id_)
    return {"id": id_, "perfil": ler_perfil(id_), "varredura": varrer(projeto["pasta"])}


def _texto_contagem(itens: list[dict]) -> str:
    return ", ".join(f"{i['nome']} ({i['arquivos']})" for i in itens) or "nenhum"


def instrucoes(id_: str) -> str:
    """O que a sessão aberta pelo [ler projeto] recebe: a varredura pronta e os passos, para ela não gastar tokens listando pastas."""
    projeto = _projeto(id_)
    v = varrer(projeto["pasta"])
    if not v["existe"]:
        raise ValueError(f"a pasta do projeto não existe: {projeto['pasta']}")
    ferramentas = str(DIR_ATUAL).replace("\\", "/")
    rascunho = str(arquivo_rascunho(id_)).replace("\\", "/")
    arquivo_rascunho(id_).parent.mkdir(parents=True, exist_ok=True)
    deps = [f"{eco}: {', '.join(nomes)}" for eco, nomes in v["dependencias"].items() if nomes]
    principais = "\n".join(f"- {p}" for p in v["principais"]) or "- (nenhum arquivo de código ou documento encontrado)"
    return f"""# Ler o projeto {projeto['nome']} (id: {id_})

Pasta: {projeto['pasta']}
Descrição no cadastro: {projeto.get('descricao') or '(vazia)'}

## Varredura pronta ({v['arquivos']} arquivos{', PARCIAL: a pasta passou do limite' if v['parcial'] else ''})
Tipos de arquivo: {_texto_contagem(v['linguagens'])}
Pastas: {_texto_contagem(v['pastas'])}
Dependências: {' | '.join(deps) or 'nenhuma encontrada'}

Arquivos principais:
{principais}

## O que fazer
1. Leia a memória do projeto (o mesmo do /cerebro-ler): python "{ferramentas}/cerebro.py" ler --projeto {id_}
2. Abra os arquivos principais acima para entender do que o projeto trata: só as primeiras {LINHAS_POR_ARQUIVO} linhas de cada um, e no máximo {MAX_PRINCIPAIS} arquivos no total. Pare antes se já entendeu. Não liste pastas de novo: a varredura acima já passou por todos os arquivos. Não abra .env, chaves nem credenciais.
3. Grave em {rascunho} este JSON, em UTF-8:
{{
  "assunto": "2 ou 3 frases em português: o que é o projeto e para quem",
  "tipo": "ex.: app desktop, site, estudo acadêmico, jogo",
  "stack": ["tecnologias e ferramentas usadas de verdade"],
  "tarefas": ["até 15 tipos de trabalho que aparecem neste projeto, em português"],
  "termos": ["de 8 a 60 termos de busca EM INGLÊS"],
  "evitar": ["termos em inglês de assuntos que parecem próximos mas não servem aqui"]
}}
4. Rode: python "{ferramentas}/perfil_projeto.py" salvar {id_} --arquivo "{rascunho}"
   Se ele recusar, corrija o JSON e rode de novo.
5. Diga em até 3 linhas o que entendeu do projeto e avise que a busca está em [skills] > [buscar online].

## Como escolher os termos
Eles decidem quais skills aparecem, e as skills são descritas em inglês. Traduza o assunto: pense no que alguém pesquisaria para achar ajuda neste trabalho (tecnologias, formatos de arquivo, técnicas e tarefas: "electron", "pdf generation", "biomechanics", "code review", "3d printing"), do mais específico ao mais geral.
Os termos saem para a busca do GitHub: nada de nomes de pessoas, de clientes, do projeto, caminhos ou dados privados. Só minúsculas, sem acento, até 40 caracteres.
Não instale nem baixe nenhuma skill nesta sessão: o dono escolhe depois, no widget."""


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description="Perfil de um projeto para a busca de skills.")
    sub = parser.add_subparsers(dest="comando", required=True)
    for nome in ("instrucoes", "salvar", "ler"):
        p = sub.add_parser(nome)
        p.add_argument("projeto")
        p.add_argument("--json", action="store_true")
        if nome == "salvar":
            p.add_argument("--arquivo", required=True, help="o rascunho JSON escrito pela IA")
    args = parser.parse_args(argv)
    try:
        if args.comando == "instrucoes":
            print(instrucoes(args.projeto))
        elif args.comando == "salvar":
            perfil = salvar(args.projeto, args.arquivo)
            print(json.dumps({"ok": True, "perfil": perfil}, ensure_ascii=False) if args.json else f"Perfil gravado em {arquivo_perfil(args.projeto)} ({len(perfil['termos'])} termos).")
        else:
            r = ler(args.projeto)
            print(json.dumps({"ok": True, **r}, ensure_ascii=False) if args.json else json.dumps(r, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError) as e:
        if getattr(args, "json", False):
            print(json.dumps({"ok": False, "tipo": "erro", "erro": str(e)}, ensure_ascii=False))
        else:
            print(f"Erro: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
