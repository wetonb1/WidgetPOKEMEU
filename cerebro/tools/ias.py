#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ias.py - os dados das IAs (nome, executável, modelos...) para o Python do cérebro. Só biblioteca padrão.

A fonte é a MESMA do widget: app/ias-dados.json (o app/ias.js lê o mesmo arquivo). Assim a lista de modelos não
existe duas vezes. IAS_DADOS troca o arquivo (só para os testes). Se o cérebro estiver fora do repositório do
widget e o arquivo não for achado, vale a reserva abaixo (só o Claude), para nada parar de funcionar.
"""
import json
import os
from pathlib import Path

_ARQUIVO_PADRAO = Path(__file__).resolve().parent.parent.parent / "app" / "ias-dados.json"
_RESERVA = {
    "claude": {
        "id": "claude", "nome": "Claude Code", "executavel": "claude", "processo": "claude.exe",
        "modelos": {"sonnet": "dia a dia", "opus": "planejamento e tarefas difíceis", "haiku": "tarefas simples e baratas"},
        "modeloPadrao": "sonnet", "variavelChave": "ANTHROPIC_API_KEY", "arquivoRegras": "CLAUDE.md",
        "origemCerebro": "claude-code", "comandosUteis": ["/usage"],
        "suporta": {"continuar": True, "retomar": True, "promptPorArgumento": True, "pularPermissoes": True},
    },
}
_cache = {}


def arquivo():
    return Path(os.environ.get("IAS_DADOS") or _ARQUIVO_PADRAO)


def carregar():
    """{id: dados} de todas as IAs (com cache por arquivo). A primeira é a padrão (o Claude)."""
    caminho = arquivo()
    if str(caminho) in _cache:
        return _cache[str(caminho)]
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        if not isinstance(dados, dict) or not dados:
            raise ValueError("vazio")
        dados = {k: v for k, v in dados.items() if isinstance(v, dict) and isinstance(v.get("modelos"), dict) and v["modelos"]}
    except (OSError, ValueError):
        dados = _RESERVA
    _cache[str(caminho)] = dados
    return dados


def ids():
    return tuple(carregar())


def modelos(ia):
    """Os modelos aceitos por uma IA (tupla vazia se a IA não existe)."""
    return tuple((carregar().get(ia) or {}).get("modelos") or ())


def modelo_padrao(ia):
    d = carregar().get(ia) or {}
    return d.get("modeloPadrao") or (tuple(d.get("modelos") or ()) or ("",))[0]
