#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""regras.py - mantém o AGENTS.md (do Antigravity) igual ao CLAUDE.md (do Claude Code) na raiz do widget. Só biblioteca padrão.

O CLAUDE.md é o principal. O AGENTS.md é uma cópia com o PRÓPRIO título (a primeira linha): o resto tem que ser igual, senão uma
IA recebe regras diferentes da outra. Por isso, em vez de lembrar de editar os dois:

  regras.py verificar                     compara os dois (sem a primeira linha) e mostra o diff; sai com 1 se diferem
  regras.py sincronizar [--confirmar]     reescreve o AGENTS.md a partir do CLAUDE.md, mantendo o título do AGENTS.md
                                          (sem --confirmar só mostra o diff; nunca mexe no CLAUDE.md)

  --raiz PASTA   outra pasta no lugar da raiz do widget (usado nos testes)
"""
import argparse
import difflib
import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
PRINCIPAL = "CLAUDE.md"
COPIA = "AGENTS.md"


def _ler(caminho):
    """(texto com \\n, fim de linha original) de um arquivo UTF-8 (com ou sem BOM)."""
    with open(caminho, "r", encoding="utf-8-sig", newline="") as f:
        bruto = f.read()
    return bruto.replace("\r\n", "\n"), ("\r\n" if "\r\n" in bruto else "\n")


def _sem_titulo(texto):
    """O texto sem a primeira linha (o título de cada arquivo)."""
    return texto.split("\n", 1)[1] if "\n" in texto else ""


def _titulo(texto):
    return texto.split("\n", 1)[0]


def _gravar(destino, texto):
    destino = Path(destino)
    fd, temporario = tempfile.mkstemp(prefix=destino.name + ".", suffix=".tmp", dir=destino.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(texto)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporario, destino)
    except BaseException:
        try:
            os.unlink(temporario)
        except OSError:
            pass
        raise


def comparar(raiz=None):
    """{"iguais": bool, "diff": str, "novo": texto proposto do AGENTS.md, "eol": ...}. Erro claro se faltar um dos arquivos."""
    raiz = Path(raiz or RAIZ)
    caminhos = {n: raiz / n for n in (PRINCIPAL, COPIA)}
    for nome, c in caminhos.items():
        if not c.is_file():
            raise ValueError(f"não achei {nome} em {raiz}")
    principal, _ = _ler(caminhos[PRINCIPAL])
    copia, eol = _ler(caminhos[COPIA])
    corpo_p, corpo_c = _sem_titulo(principal), _sem_titulo(copia)
    iguais = corpo_p == corpo_c
    diff = "" if iguais else "\n".join(difflib.unified_diff(
        corpo_c.splitlines(), corpo_p.splitlines(), f"{COPIA} (atual, sem o título)", f"{PRINCIPAL} (principal, sem o título)", lineterm="", n=1))
    novo = _titulo(copia) + "\n" + corpo_p  # o título é do AGENTS.md; o resto vem do CLAUDE.md
    return {"iguais": iguais, "diff": diff, "novo": novo, "eol": eol, "destino": caminhos[COPIA]}


def sincronizar(confirmar=False, raiz=None):
    """Devolve {"iguais", "diff", "escrito"}. Só grava com confirmar=True e só se houver diferença."""
    r = comparar(raiz)
    escrito = False
    if confirmar and not r["iguais"]:
        _gravar(r["destino"], r["novo"].replace("\n", r["eol"]))
        escrito = True
    return {"iguais": r["iguais"], "diff": r["diff"], "escrito": escrito}


def main(argv=None):
    parser = argparse.ArgumentParser(description="CLAUDE.md e AGENTS.md iguais (o CLAUDE.md é o principal)")
    parser.add_argument("comando", choices=("verificar", "sincronizar"))
    parser.add_argument("--confirmar", action="store_true", help="sincronizar: grava de verdade (sem isso só mostra o diff)")
    parser.add_argument("--raiz", type=Path, help="outra pasta no lugar da raiz do widget (testes)")
    args = parser.parse_args(argv)
    try:
        if args.comando == "verificar":
            r = comparar(args.raiz)
            if r["iguais"]:
                print(f"ok: {COPIA} e {PRINCIPAL} têm o mesmo conteúdo (fora o título).")
                return 0
            print(r["diff"])
            print(f"DIFEREM: {COPIA} está diferente de {PRINCIPAL}. Para igualar: regras.py sincronizar --confirmar")
            return 1
        r = sincronizar(args.confirmar, args.raiz)
        if r["iguais"]:
            print(f"nada a fazer: {COPIA} já está igual a {PRINCIPAL}.")
            return 0
        print(r["diff"])
        print(f"{COPIA} reescrito a partir de {PRINCIPAL}." if r["escrito"] else f"NÃO gravado. Para aplicar: regras.py sincronizar --confirmar")
        return 0
    except ValueError as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
