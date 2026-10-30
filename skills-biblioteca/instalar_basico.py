#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instalador básico: as 2 skills do cérebro (cerebro-buscar e cerebro-compactar) (pelo skills.py) + o que não é skill.

  python skills-biblioteca/instalar_basico.py             só no projeto do widget: <widget>/.claude/skills
  python skills-biblioteca/instalar_basico.py --global    no usuário: ~/.claude (skills, comando
                                                          /compactar e bloco do CLAUDE.md)
  --alvo claude|antigravity|ambos    para qual IA (padrão claude: nada muda). antigravity/ambos acrescentam o bloco do
                                     arquivo global do Antigravity (~/.gemini/GEMINI.md): fica FORA da pasta do widget, então
                                     só é gravado com --aplicar-gemini-md (sem isso mostra o que seria gravado e os tokens).
                                     As 2 skills também vão para o Antigravity: no projeto do widget (<widget>/.agents/skills,
                                     destino CONFIRMADO) direto; com --global a pasta é a global do agy (fora do widget, NÃO
                                     confirmada por teste), então só é gravada com --aplicar-skills-agy.

As skills são instaladas pelo skills.py (troca {CAMINHO_CEREBRO}, grava .instalado.json, nunca
sobrescreve skill instalada por outro meio). Aqui fica só o resto: o comando /compactar e o bloco
do ~/.claude/CLAUDE.md, que nunca é sobrescrito: se já existir sem o bloco do cérebro, o instalador
só mostra o diff; para aprovar, rode de novo com --aplicar-claude-md. O do ~/.gemini/GEMINI.md segue a mesma regra, com
uma diferença: como mora fora da pasta do widget, NADA é gravado nele (nem criar) sem --aplicar-gemini-md.
Em todos os casos mostra quantos tokens o bloco soma a TODA conversa (estimativa do tokens.py).
"""
import argparse
import difflib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cerebro" / "tools"))
import skills  # noqa: E402
import tokens  # noqa: E402  (estimar_tokens: o custo do bloco em toda conversa)

BASICAS = ("cerebro-buscar", "cerebro-compactar")  # as 3 separadas (titulos, cabecalho, ler) ficam na biblioteca para quem preferir
MAX_BLOCO = 12  # linhas do bloco do CLAUDE.md global (entra em toda conversa)
TITULO_BLOCO = "## Cérebro (memória dos meus projetos)"
ALVOS = ("claude", "antigravity", "ambos")
# arquivo de regras GLOBAIS do Antigravity: lido pelo agy (docs/antigravity.md); o caminho só vale depois do teste de confirmação
GEMINI_ARQUIVO = "GEMINI.md"

BIBLIOTECA = Path(__file__).resolve().parent
WIDGET = BIBLIOTECA.parent
COMANDO = WIDGET / ".claude" / "commands" / "compactar.md"


def gravar(destino, texto):
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto)


def instalar_skills(escopo, alvo="claude", pasta_projeto=None):
    """As 2 básicas pelo skills.py, no alvo dado (a variante do alvo é escolhida pelo skills.py). Devolve avisos (formato do SKILL.md)."""
    avisos = []
    por_nome = {s["pasta"]: s for s in skills.listar()}
    for nome in BASICAS:
        r = skills.instalar(nome, alvo, escopo, pasta_projeto=(pasta_projeto or WIDGET) if escopo == "projeto" else None)
        extra = " (variante do " + alvo + ")" if r.get("variante") else ""
        print(f"instalado: {nome} {r['versao']} em {alvo}{extra}" + (" (já estava igual; agora gerenciada)" if r["adotada"] else ""))
        avisos += [f"{nome}: {a}" for a in por_nome.get(nome, {}).get("avisos", [])]
    return avisos


def instalar_skills_agy(global_, pasta_projeto, aplicar):
    """As 2 skills no Antigravity. No projeto do widget grava direto (dentro da pasta do widget, destino confirmado).
    Global: a pasta fica FORA do widget e não foi confirmada por teste, então só grava com aplicar=True (senão diz o que faria)."""
    if not global_:
        return instalar_skills("projeto", "antigravity", pasta_projeto)
    destino = skills.DESTINOS["antigravity"]["global"]()
    if not aplicar:
        print(f"NÃO gravado: skills globais do antigravity iriam para {destino} (fora do widget, caminho não confirmado por teste): {', '.join(BASICAS)}")
        print("Para gravar, rode de novo com --aplicar-skills-agy")
        return []
    return instalar_skills("global", "antigravity")


def bloco_global(cerebro, modelo="claude-global.md"):
    return (BIBLIOTECA / modelo).read_text(encoding="utf-8-sig").replace(skills.MARCADOR, cerebro).strip("\n")


def custo_do_bloco(bloco):
    """Linha para o usuário: o bloco entra em TODA conversa, então o custo dele é fixo."""
    return f"custo: este bloco soma ~{tokens.estimar_tokens(bloco)} tokens a TODA conversa (estimativa)"


def _instalar_bloco(arq, bloco, aplicar, nome, exigir_aplicar):
    """Cria o arquivo, ou troca só o bloco do cérebro se ele já estiver ali. Nunca sobrescreve outro conteúdo: em arquivo existente
    sem o nosso bloco, mostra o diff e só grava com aplicar=True. exigir_aplicar=True (arquivo fora da pasta do widget): NADA é
    gravado sem aplicar, nem criar nem trocar o nosso próprio bloco. Devolve avisos."""
    print(custo_do_bloco(bloco))
    if not arq.exists():
        if exigir_aplicar and not aplicar:
            print(f"--- {nome} (seria criado em {arq}) ---\n{bloco}")
            print(f"NÃO gravado: {arq} ainda não existe. Para criar, rode de novo com a opção de aplicar")
            return []
        gravar(arq, bloco + "\n")
        print(f"criado: {arq}")
        return []
    with open(arq, "r", encoding="utf-8-sig", newline="") as f:
        atual = f.read()
    eol = "\r\n" if "\r\n" in atual else "\n"
    bloco_eol = bloco.replace("\n", eol)
    # o bloco vai do título até o próximo "## " (ou o fim do arquivo)
    padrao = re.compile(rf"^{re.escape(TITULO_BLOCO)}.*?(?=^## |\Z)", re.S | re.M)
    if padrao.search(atual):
        novo = padrao.sub(lambda _: bloco_eol + eol, atual, count=1)
        autorizado = not exigir_aplicar or aplicar  # é o nosso próprio bloco
    else:
        novo = atual.rstrip("\r\n") + eol + eol + bloco_eol + eol
        autorizado = aplicar
    if novo == atual:
        print(f"já atualizado: {arq}")
        return []
    if not autorizado:
        diff = difflib.unified_diff(atual.splitlines(), novo.splitlines(), f"{nome} (atual)", f"{nome} (proposto)", lineterm="", n=1)
        print("\n".join(diff))
        print(f"NÃO gravado: {arq} já existe. Aprove o diff acima rodando de novo com a opção de aplicar")
        return []
    with open(arq, "w", encoding="utf-8", newline="") as f:
        f.write(novo)
    print(f"atualizado: {arq}")
    return []


def instalar_claude_md(pasta_claude, cerebro, aplicar):
    """Cria ~/.claude/CLAUDE.md, ou troca só o bloco do cérebro se ele já existir ali.
    Em arquivo com outro conteúdo, mostra o diff e só grava com aplicar=True. Devolve avisos."""
    bloco = bloco_global(cerebro)
    if len(bloco.splitlines()) > MAX_BLOCO:
        return [f"CLAUDE.md global: bloco com {len(bloco.splitlines())} linhas (máx. {MAX_BLOCO})"]
    return _instalar_bloco(pasta_claude / "CLAUDE.md", bloco, aplicar, "CLAUDE.md", exigir_aplicar=False)


def instalar_gemini_md(pasta_gemini, cerebro, aplicar):
    """O mesmo para o arquivo global do Antigravity (~/.gemini/GEMINI.md). Como fica FORA da pasta do widget, só grava com aplicar=True."""
    bloco = bloco_global(cerebro, "gemini-global.md")
    if len(bloco.splitlines()) > MAX_BLOCO:
        return [f"{GEMINI_ARQUIVO} global: bloco com {len(bloco.splitlines())} linhas (máx. {MAX_BLOCO})"]
    return _instalar_bloco(pasta_gemini / GEMINI_ARQUIVO, bloco, aplicar, GEMINI_ARQUIVO, exigir_aplicar=True)


def instalar_comando(pasta_claude):
    if not COMANDO.is_file():  # o /compactar virou a skill cerebro-compactar (fase 7.1): não há mais arquivo de comando
        print("comando /compactar: não há mais (virou a skill cerebro-compactar, instalada acima)")
        return
    destino = pasta_claude / "commands" / "compactar.md"
    gravar(destino, COMANDO.read_text(encoding="utf-8-sig"))
    print(f"instalado: comando /compactar em {destino}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Instala as skills básicas do cérebro")
    parser.add_argument("--global", dest="global_", action="store_true",
                        help="instala no usuário (~/.claude): skills, /compactar e bloco do CLAUDE.md")
    parser.add_argument("--aplicar-claude-md", action="store_true",
                        help="aprova a alteração do ~/.claude/CLAUDE.md já existente")
    parser.add_argument("--alvo", choices=ALVOS, default="claude",
                        help="para qual IA (padrão claude, como sempre); antigravity/ambos acrescentam o bloco do ~/.gemini/GEMINI.md")
    parser.add_argument("--aplicar-gemini-md", action="store_true",
                        help="grava o ~/.gemini/GEMINI.md (fora da pasta do widget: sem isso só mostra o que seria gravado)")
    parser.add_argument("--aplicar-skills-agy", action="store_true",
                        help="com --global e antigravity: grava as skills na pasta global do agy (fora do widget; caminho não confirmado)")
    parser.add_argument("--pasta-claude", type=Path, help="troca ~/.claude (usado nos testes)")
    parser.add_argument("--pasta-projeto", type=Path, help="troca a pasta do widget nas skills do projeto (usado nos testes)")
    parser.add_argument("--pasta-gemini", type=Path, help="troca ~/.gemini (usado nos testes)")
    args = parser.parse_args(argv)

    cerebro = skills.caminho_cerebro()
    if not cerebro:
        raise SystemExit("erro: sem cerebro_dir em ~/.cerebro.json. Rode: python cerebro/tools/cerebro.py config --definir <pasta do cerebro>")
    claude = args.alvo in ("claude", "ambos")
    agy = args.alvo in ("antigravity", "ambos")
    try:
        avisos = []
        if claude and args.global_:
            pasta = args.pasta_claude or Path.home() / ".claude"
            if args.pasta_claude:  # testes: as skills globais também vão para a pasta indicada
                skills.os.environ["SKILLS_GLOBAL_CLAUDE"] = str(pasta / "skills")
            avisos += instalar_skills("global")
            instalar_comando(pasta)
            avisos += instalar_claude_md(pasta, cerebro, args.aplicar_claude_md)
            print(f"destino: {pasta}")
        elif claude:
            avisos += instalar_skills("projeto", "claude", args.pasta_projeto)
            print(f"destino: {(args.pasta_projeto or WIDGET) / '.claude' / 'skills'}")
        if agy:
            avisos += instalar_skills_agy(args.global_, args.pasta_projeto, args.aplicar_skills_agy)
            if not args.global_:
                print(f"destino: {(args.pasta_projeto or WIDGET) / '.agents' / 'skills'}")
            avisos += instalar_gemini_md(args.pasta_gemini or Path.home() / ".gemini", cerebro, args.aplicar_gemini_md)
    except ValueError as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2
    print(f"cerebro: {cerebro}")
    for aviso in avisos:
        print(f"aviso: {aviso}")
    return 1 if avisos else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
