#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""uso.py - estimativa LOCAL do que você abriu nos últimos dias (a partir de cerebro/.log/sessoes.jsonl). Só biblioteca padrão.

O QUE ISTO É E O QUE NÃO É
  É uma contagem das sessões que o WIDGET abriu: quantas por dia e por modelo, e um aviso quando há muito Opus seguido.
  NÃO é o seu uso real nem o seu limite: o Claude Code não oferece uma forma oficial de ler isso de fora. Quem mostra o
  uso verdadeiro é o próprio Claude Code, com o comando /usage (apelidos /cost e /stats); o widget só ensina a abrir.
  Por isso aqui não há nenhum número de "quanto falta": só contagens do que está no log.

Linhas do log (uma por linha, JSON): {"data","projeto","ia","modelo","tarefa","modo","motivo"?}.
  modo novo/continuar/retomar = uma sessão aberta; modo "pausa" = você pausou o projeto (motivo "limite"): não é sessão.

  uso.py resumo [--dias 7] [--json]
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402
import ias as dados_ias  # noqa: E402  (as IAs e os modelos: app/ias-dados.json)

MODELOS = dados_ias.modelos("claude")  # "por_modelo" (o de sempre) é só do Claude; as outras IAs ficam em "por_ia"
MODOS_SESSAO = ("novo", "continuar", "retomar")
DIAS_PADRAO = 7
OPUS_SEGUIDAS = 3        # sessões seguidas em Opus que disparam o aviso
OPUS_MIN_SESSOES = 5     # e, nos dias vistos, mais da metade em Opus com pelo menos isto de sessões
AVISO_OPUS = "considere Sonnet para tarefas comuns"
NOTA = ("Contagem local das sessões abertas pelo widget (cerebro/.log/sessoes.jsonl). Não é o seu uso real nem a cota: para isso, "
        "use /usage dentro do Claude Code ou do Antigravity.")
HORAS_RECENTES = 24      # janela de "sessões recentes" (sugestão de em qual IA continuar): contagem local, não a cota real


def arquivo_log(base=None):
    return (Path(base) if base else cerebro.localizar_cerebro()) / ".log" / "sessoes.jsonl"


def ler_eventos(base=None):
    """Todas as linhas válidas do log, na ordem em que foram gravadas. Sem log (ou cérebro): lista vazia."""
    try:
        caminho = arquivo_log(base)
        with open(caminho, "r", encoding="utf-8") as f:
            linhas = f.read().splitlines()
    except (OSError, FileNotFoundError):
        return []
    eventos = []
    for linha in linhas:
        try:
            e = json.loads(linha)
        except ValueError:
            continue
        if isinstance(e, dict) and isinstance(e.get("data"), str) and len(e["data"]) >= 10 and isinstance(e.get("projeto"), str):
            eventos.append(e)
    return eventos


def _sessoes(eventos):
    """As linhas que são sessão de trabalho (não a pausa, nem a sessão aberta só para ver o /usage)."""
    return [e for e in eventos if e.get("modo") in MODOS_SESSAO and e.get("motivo") != "uso"]


def ultimas_por_projeto(eventos):
    """{projeto: {ia: {"data", "modelo"}}}: a última sessão de cada projeto em cada IA (a mais nova do log vale)."""
    saida = {}
    for e in _sessoes(eventos):
        ia = _ia(e)
        antiga = saida.setdefault(e["projeto"], {}).get(ia)
        if antiga is None or e["data"] >= antiga["data"]:
            saida[e["projeto"]][ia] = {"data": e["data"], "modelo": str(e.get("modelo") or "")}
    return saida


def recentes_por_ia(eventos, horas=HORAS_RECENTES, agora=None):
    """Sessões abertas pelo widget nas últimas `horas` horas, por IA, somando TODOS os projetos (o limite é da conta, não do
    projeto). É CONTAGEM LOCAL: não é a cota real de nenhuma IA."""
    corte = (agora or datetime.datetime.now()) - datetime.timedelta(hours=horas)
    cont = {ia: 0 for ia in dados_ias.ids()}
    for e in _sessoes(eventos):
        try:
            if datetime.datetime.fromisoformat(e["data"]) < corte:
                continue
        except (ValueError, TypeError):
            continue
        ia = _ia(e)
        if ia in cont:
            cont[ia] += 1
    return cont


def _modelo(e):
    m = str(e.get("modelo") or "").lower()
    return m if m in MODELOS else "outro"


def _ia(e):
    """A IA da linha do log (linhas antigas não têm o campo: eram do Claude)."""
    ia = str(e.get("ia") or "claude").lower()
    return ia if ia in dados_ias.ids() else "outra"


def _modelo_da_ia(e, ia):
    m = str(e.get("modelo") or "").lower()
    return m if m in dados_ias.modelos(ia) else "outro"


def _vazio_por_ia():
    return {ia: {"total": 0, "por_modelo": {m: 0 for m in (*dados_ias.modelos(ia), "outro")}} for ia in (*dados_ias.ids(), "outra")}


def resumo(dias=DIAS_PADRAO, base=None, agora=None):
    """Sessões por dia e por modelo nos últimos `dias` dias (hoje incluído), pausas e avisos."""
    hoje = (agora or datetime.datetime.now()).date()
    datas = [(hoje - datetime.timedelta(days=i)).isoformat() for i in range(dias - 1, -1, -1)]
    eventos = ler_eventos(base)
    visiveis = [e for e in eventos if e["data"][:10] in datas]
    # motivo "uso" = sessão aberta só para ver o /usage: não é trabalho, não entra na conta
    sessoes = [e for e in visiveis if e.get("modo") in MODOS_SESSAO and e.get("motivo") != "uso"]
    por_dia = {d: {"data": d, "total": 0, "por_modelo": {m: 0 for m in (*MODELOS, "outro")}, "por_ia": _vazio_por_ia()} for d in datas}
    por_ia = _vazio_por_ia()
    for e in sessoes:
        linha = por_dia[e["data"][:10]]
        linha["total"] += 1
        ia = _ia(e)
        # cada IA conta os seus modelos ("sonnet" do Claude nunca se mistura com os do Antigravity)
        for alvo in (linha["por_ia"][ia], por_ia[ia]):
            alvo["total"] += 1
            alvo["por_modelo"][_modelo_da_ia(e, ia) if ia != "outra" else "outro"] += 1
        if ia == "claude":
            linha["por_modelo"][_modelo(e)] += 1
    totais = {m: sum(d["por_modelo"][m] for d in por_dia.values()) for m in (*MODELOS, "outro")}
    total = len(sessoes)

    # Opus em sequência (só o Claude tem Opus): as últimas sessões do Claude, contando de trás para frente
    sessoes_claude = [e for e in sessoes if _ia(e) == "claude"]
    seguidas = 0
    for e in reversed(sessoes_claude):
        if _modelo(e) != "opus":
            break
        seguidas += 1
    avisos = []
    if seguidas >= OPUS_SEGUIDAS:
        avisos.append(f"Você abriu {seguidas} sessões seguidas em Opus: {AVISO_OPUS}.")
    elif len(sessoes_claude) >= OPUS_MIN_SESSOES and totais["opus"] * 2 > len(sessoes_claude):
        avisos.append(f"Mais da metade das suas sessões dos últimos {dias} dias foi em Opus ({totais['opus']} de {len(sessoes_claude)}): {AVISO_OPUS}.")

    pausas = [{"data": e["data"], "projeto": e["projeto"], "motivo": e.get("motivo", ""), "ia": _ia(e)} for e in visiveis if e.get("modo") == "pausa"]
    por_ia = {k: v for k, v in por_ia.items() if v["total"] or k in dados_ias.ids()}
    return {"dias": list(por_dia.values()), "total": total, "por_modelo": totais, "por_ia": por_ia, "opus_seguidas": seguidas,
            "avisos": avisos, "pausas": pausas, "nota": NOTA, "limite_opus_seguidas": OPUS_SEGUIDAS}


def _imprimir(args, dados, linhas):
    if args.json:
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for linha in linhas:
            print(linha)


def _cmd_resumo(args):
    r = resumo(args.dias)
    linhas = [f"{d['data']}  {d['total']}  " + " ".join(f"{m}={n}" for m, n in d["por_modelo"].items() if n) for d in r["dias"]]
    linhas += [f"total {r['total']}: " + ", ".join(f"{m} {n}" for m, n in r["por_modelo"].items() if n)] + [f"aviso: {a}" for a in r["avisos"]] + [r["nota"]]
    _imprimir(args, r, linhas)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="uso.py", description="Estimativa local do que o widget abriu (não é o uso real)")
    sub = parser.add_subparsers(dest="comando", required=True)
    p = sub.add_parser("resumo")
    p.add_argument("--dias", type=int, default=DIAS_PADRAO)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_resumo)
    args = parser.parse_args(argv)
    args.dias = max(1, min(args.dias, 60))
    try:
        return args.func(args)
    except (OSError, ValueError) as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
