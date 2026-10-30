#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""grafo.py - os dados do grafo 3D da aba Cérebro (nós e ligações), numa chamada. Só biblioteca padrão, só leitura, sem IA.

  grafo.py [--json] [--max-ligacoes 3] [--min-comum 2]

Nós:  um por PROJETO (o centro de cada "estrela", com a cor do projeto no projetos.json), um por CONVERSA e um por ESTADO.
Ligações: cada arquivo -> o seu projeto; conversa <-> conversa quando têm 2+ palavras-chave em comum (no máximo 3 por arquivo,
as mais fortes). Palavras-chave presentes em mais de 60 arquivos não ligam nada: são genéricas demais e só embolariam o grafo.
Lê só o cabeçalho (2 linhas) de cada conversa: ~1 s com 4.000 arquivos.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402
import projetos  # noqa: E402

PALETA = ("#4f9dff", "#3ddc84", "#ff6b6b", "#ffc857", "#c792ea", "#5ce1e6", "#f78c6c", "#a3be8c")
MAX_POSTOS = 60
MAX_PALAVRAS = 10


def _cor(slug, cadastro):
    cor = str((cadastro.get(slug) or {}).get("cor") or "")
    if re.match(r"^#[0-9a-fA-F]{6}$", cor):
        return cor.lower()
    return PALETA[int(hashlib.sha1(slug.encode("utf-8")).hexdigest(), 16) % len(PALETA)]  # projeto sem cadastro: cor fixa pelo nome


def _titulo(nome):
    stem = nome[:-3] if nome.lower().endswith(".md") else nome
    return re.sub(r"^\d{4}-\d{2}-\d{2}_", "", stem).replace("-", " ")


def grafo(base=None, max_ligacoes=3, min_comum=2):
    base = Path(base) if base else Path(cerebro.localizar_cerebro())
    try:
        cadastro = {p["id"]: p for p in projetos.listar()}
    except (OSError, ValueError):
        cadastro = {}
    nos, ligacoes, hubs = [], [], {}

    def hub(slug):
        if slug not in hubs:
            hubs[slug] = len(nos)
            nos.append({"id": "p:" + slug, "t": "p", "n": (cadastro.get(slug) or {}).get("nome") or slug, "p": slug, "cor": _cor(slug, cadastro)})
        return hubs[slug]
    for slug in sorted(cadastro):  # projetos cadastrados aparecem mesmo sem arquivos
        hub(slug)

    conversas = []
    pasta = base / "conversas"
    try:
        with os.scandir(pasta) as it:
            nomes = sorted(e.name for e in it if e.is_file() and e.name.lower().endswith(".md"))
    except OSError:
        nomes = []
    for nome in nomes:
        try:
            cab = cerebro.ler_cabecalho(str(pasta / nome))
        except OSError:
            continue
        slug = cerebro._slug(cab["projeto"] or "") or "sem-projeto"
        h = hub(slug)
        m = cerebro.RE_PREFIXO_DATA.match(nome)
        chaves = list(cab["palavras_chave"] or [])[:MAX_PALAVRAS]
        i = len(nos)
        nos.append({"id": "c:" + nome, "t": "c", "n": _titulo(nome), "a": nome, "p": slug, "d": m.group(1) if m else (cab["data"] or ""), "k": chaves})
        ligacoes.append([i, h, 1, "p"])
        conversas.append((i, {s for s in (cerebro._slug(c) for c in chaves) if s}))

    pasta_estado = base / "estado"
    for arq in sorted(pasta_estado.glob("*.md")) if pasta_estado.is_dir() else []:
        slug = cerebro._slug(arq.stem)
        h = hub(slug)
        i = len(nos)
        try:
            d = datetime.date.fromtimestamp(arq.stat().st_mtime).isoformat()
        except OSError:
            d = ""
        nos.append({"id": "e:" + arq.name, "t": "e", "n": "estado de " + nos[h]["n"], "a": "estado/" + arq.name, "p": slug, "d": d})
        ligacoes.append([i, h, 2, "p"])

    # palavras-chave em comum: índice invertido, só com palavras que não são genéricas demais
    postos = {}
    for i, chaves in conversas:
        for k in chaves:
            postos.setdefault(k, []).append(i)
    comum = {}
    for lista in postos.values():
        if 2 <= len(lista) <= MAX_POSTOS:
            for x in range(len(lista)):
                for y in range(x + 1, len(lista)):
                    par = (lista[x], lista[y])
                    comum[par] = comum.get(par, 0) + 1
    melhores = {}
    for (a, b), n in comum.items():
        if n >= min_comum:
            melhores.setdefault(a, []).append((n, b))
            melhores.setdefault(b, []).append((n, a))
    feitas = set()
    for a in sorted(melhores):
        for n, b in sorted(melhores[a], key=lambda x: (-x[0], x[1]))[:max_ligacoes]:
            par = (min(a, b), max(a, b))
            if par not in feitas:
                feitas.add(par)
                ligacoes.append([par[0], par[1], n, "k"])

    return {"nos": nos, "ligacoes": ligacoes, "projetos": len(hubs), "arquivos": len(nos) - len(hubs),
            "ligacoes_por_palavra": len(feitas), "gerado": datetime.datetime.now().isoformat(timespec="seconds")}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="grafo.py", description="Dados do grafo 3D do cérebro (só leitura)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--max-ligacoes", type=int, default=3)
    ap.add_argument("--min-comum", type=int, default=2)
    args = ap.parse_args(argv)
    try:
        g = grafo(max_ligacoes=max(0, min(args.max_ligacoes, 10)), min_comum=max(1, args.min_comum))
    except OSError as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 3 if isinstance(erro, cerebro.CerebroNaoEncontrado) else 2
    if args.json:
        print(json.dumps(g, ensure_ascii=False, separators=(",", ":")))
    else:
        print(f"{g['projetos']} projetos, {g['arquivos']} arquivos, {len(g['ligacoes'])} ligações ({g['ligacoes_por_palavra']} por palavras-chave)")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
