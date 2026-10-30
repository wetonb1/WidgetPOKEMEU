#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""economia.py - o cérebro está compensando? Só biblioteca padrão; lê os logs locais de cerebro/.log/. Nenhuma IA, nenhuma rede.

TUDO AQUI É ESTIMATIVA. Tokens = caracteres/4 (x1,1 em português com acentos, ou o fator calibrado do tokens.py).
O Claude Code não dá o uso real para um programa de fora; o único número real é o que ele mostra no /usage, e é por isso que existe o
teste A/B manual (docs/teste-economia.md) para você conferir a estimativa com a sua própria medição.

Dados (cerebro/.log/):
  consultas.jsonl  uma linha por consulta ao cérebro: data, comando (titulos|cabecalho|ler|buscar), termos, resultados, caracteres devolvidos.
  sessoes.jsonl    uma linha por sessão aberta pelo widget (e pausas): data, projeto, modelo, modo (novo|continuar|retomar|pausa), motivo.
  ab.jsonl         os números do teste A/B que VOCÊ digita: tarefa, variante (com|sem cérebro), tokens de entrada e saída, custo.

  economia.py painel [--semanas 8] [--json]
  economia.py ab-registrar --json < {"tarefa","variante","entrada","saida","custo_usd"?,"notas"?}
  economia.py ab-remover ID [--json]
"""
import argparse
import datetime
import json
import math
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402
import tokens  # noqa: E402

NIVEIS = ("titulos", "cabecalho", "ler", "buscar")   # nível 1, nível 2, nível 3 e a busca combinada (uma chamada só)
SEMANAS_PADRAO = 8
CADEIA_MIN = 10          # consultas a até 10 min uma da outra são UMA busca (o título leva ao cabeçalho, que leva ao arquivo)
JANELA_SESSAO_H = 6      # uma consulta é da sessão aberta nas 6 horas anteriores
MAX_SESSOES = 20
MAX_AB = 60
VARIANTES = ("com", "sem")
NOTA = ("ESTIMATIVA, não é o seu uso real. Tokens = caracteres/4 (x1,1 com acentos). Tokens evitados = o que custaria reexplicar o projeto "
        "(o tamanho de TODAS as conversas dele no cérebro) menos o que o cérebro gastou (o estado do projeto + o que as consultas devolveram). "
        "Só conta sessões novas com pelo menos 1 consulta registrada. É uma estimativa otimista: ninguém cola todo o histórico. "
        "Para conferir de verdade, faça o teste A/B manual (docs/teste-economia.md).")


def _base(base=None):
    return Path(base) if base else Path(cerebro.localizar_cerebro())


def _dt(s):
    try:
        return datetime.datetime.fromisoformat(str(s)[:19])
    except ValueError:
        return None


def _ler_jsonl(arq):
    """Linhas válidas (dicionários) de um .jsonl; arquivo ausente = []; linha estragada é ignorada."""
    saida = []
    try:
        with open(arq, "r", encoding="utf-8") as f:
            for linha in f:
                try:
                    d = json.loads(linha)
                except ValueError:
                    continue
                if isinstance(d, dict):
                    saida.append(d)
    except OSError:
        pass
    return saida


def _inteiro(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0


def ler_consultas(base):
    saida = []
    for d in _ler_jsonl(Path(base) / ".log" / "consultas.jsonl"):
        t = _dt(d.get("data"))
        if t:
            termos = [str(x) for x in d["termos"]] if isinstance(d.get("termos"), list) else []
            saida.append({"t": t, "comando": str(d.get("comando") or ""), "termos": termos,
                          "resultados": _inteiro(d.get("resultados")), "caracteres": _inteiro(d.get("caracteres"))})
    return sorted(saida, key=lambda c: c["t"])


def ler_sessoes(base):
    """Sessões abertas pelo widget. Pausas e as abertas só para ver o /usage não são sessões de trabalho."""
    saida = []
    for d in _ler_jsonl(Path(base) / ".log" / "sessoes.jsonl"):
        t = _dt(d.get("data"))
        if t and d.get("modo") in ("novo", "continuar", "retomar") and d.get("motivo") != "uso" and isinstance(d.get("projeto"), str):
            saida.append({"t": t, "projeto": cerebro._slug(d["projeto"]), "modelo": str(d.get("modelo") or ""), "modo": d["modo"]})
    return sorted(saida, key=lambda s: s["t"])


def inicio_da_semana(d):
    """Segunda-feira da semana de d (date)."""
    return d - datetime.timedelta(days=d.weekday())


# ---------- 1. consultas por semana e proporção por nível ----------

def agrupar_buscas(consultas):
    """Consultas seguidas (até CADEIA_MIN minutos entre uma e outra) formam uma BUSCA. Ela 'foi ao nível 3' só se chegou em `ler`;
    senão foi resolvida nos níveis 1 e 2 (título, cabeçalho ou a busca combinada)."""
    buscas, atual, ultimo = [], [], None
    for c in consultas:
        if atual and (c["t"] - ultimo).total_seconds() > CADEIA_MIN * 60:
            buscas.append(atual)
            atual = []
        atual.append(c)
        ultimo = c["t"]
    if atual:
        buscas.append(atual)
    return [{"t": b[0]["t"], "nivel3": any(c["comando"] == "ler" for c in b), "consultas": len(b)} for b in buscas]


def semanas(consultas, sessoes_avaliadas, n, hoje):
    """n semanas (a atual por último), sem buracos: consultas, caracteres, tokens estimados, uso por nível, buscas e tokens evitados."""
    ini = inicio_da_semana(hoje) - datetime.timedelta(weeks=n - 1)
    linhas = []
    for i in range(n):
        d = ini + datetime.timedelta(weeks=i)
        linhas.append({"inicio": d.isoformat(), "fim": (d + datetime.timedelta(days=6)).isoformat(), "consultas": 0, "caracteres": 0, "tokens": 0,
                       "por_nivel": {k: 0 for k in NIVEIS}, "outros": 0, "buscas": 0, "buscas_nivel12": 0, "buscas_nivel3": 0, "evitados": 0})
    indice = {l["inicio"]: l for l in linhas}

    def semana_de(t):
        return indice.get(inicio_da_semana(t.date()).isoformat())
    for c in consultas:
        w = semana_de(c["t"])
        if not w:
            continue
        w["consultas"] += 1
        w["caracteres"] += c["caracteres"]
        if c["comando"] in NIVEIS:
            w["por_nivel"][c["comando"]] += 1
        else:
            w["outros"] += 1
    for b in agrupar_buscas(consultas):
        w = semana_de(b["t"])
        if w:
            w["buscas"] += 1
            w["buscas_nivel3" if b["nivel3"] else "buscas_nivel12"] += 1
    for s in sessoes_avaliadas:
        w = semana_de(s["t"])
        if w and s["evitados"] is not None:
            w["evitados"] += s["evitados"]
    for w in linhas:
        w["tokens"] = tokens.tokens_de_caracteres(w["caracteres"])
        w["pct_nivel12"] = round(100 * w["buscas_nivel12"] / w["buscas"]) if w["buscas"] else None
    return linhas


# ---------- 2. tokens evitados por sessão ----------

def atribuir_consultas(consultas, sessoes, ids):
    """{índice da sessão: [consultas]}. A consulta é da sessão aberta nas JANELA_SESSAO_H horas anteriores; se os termos citam o id de um
    projeto, da sessão mais recente DESSE projeto; senão, da mais recente de qualquer projeto. Sem sessão por perto: não é de ninguém."""
    por_sessao = {i: [] for i in range(len(sessoes))}
    janela = datetime.timedelta(hours=JANELA_SESSAO_H)
    for c in consultas:
        candidatas = [i for i, s in enumerate(sessoes) if s["t"] <= c["t"] <= s["t"] + janela]
        if not candidatas:
            continue
        citados = {cerebro._slug(t) for t in c["termos"]} & set(ids)
        do_projeto = [i for i in candidatas if sessoes[i]["projeto"] in citados]
        por_sessao[(do_projeto or candidatas)[-1]].append(c)
    return por_sessao


def _tokens_texto(texto, fator):
    """Mesma conta do tokens.estimar_tokens, sem reler o ~/.cerebro.json a cada arquivo nem varrer o texto atrás de acento quando ele é ASCII."""
    if fator is None:
        fator = tokens.FATOR_ACENTOS if (not texto.isascii() and tokens.tem_acentos(texto)) else 1.0
    return tokens.estimar_tokens(texto, fator)


def _ler_texto(caminho):
    try:
        with open(caminho, "r", encoding="utf-8-sig", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def tokens_do_projeto(base, projetos):
    """{projeto: (tokens do estado, tokens de TODAS as conversas dele)}, só dos projetos pedidos. Cada conversa é lida uma vez: o
    cabeçalho diz de que projeto ela é e, se for de um dos pedidos, o mesmo texto já serve para contar os tokens."""
    base = Path(base)
    fator = tokens.ler_config_tokens()
    saida = {}
    for p in projetos:
        texto = _ler_texto(base / "estado" / f"{p}.md")
        saida[p] = [_tokens_texto(texto, fator) if texto else 0, 0]
    pasta = base / "conversas"
    if projetos and pasta.is_dir():
        with os.scandir(pasta) as it:
            nomes = sorted(e.path for e in it if e.is_file() and e.name.lower().endswith(".md"))
        for caminho in nomes:
            texto = _ler_texto(caminho)
            if texto is None:
                continue
            linhas = texto.split("\n", 2)
            p = cerebro._slug(cerebro._parse_cabecalho(linhas[0], linhas[1] if len(linhas) > 1 else "").get("projeto") or "")
            if p in saida:
                saida[p][1] += _tokens_texto(texto, fator)
    return {p: tuple(v) for p, v in saida.items()}


def avaliar_sessoes(base, sessoes, consultas, ids):
    """Uma linha por sessão (da mais antiga à mais nova). evitados = None quando a sessão não entra na estimativa (e 'motivo' diz por quê)."""
    por_sessao = atribuir_consultas(consultas, sessoes, ids)
    novas = {s["projeto"] for i, s in enumerate(sessoes) if s["modo"] == "novo" and por_sessao[i]}
    tam = tokens_do_projeto(base, sorted(novas))
    saida = []
    for i, s in enumerate(sessoes):
        cs = por_sessao[i]
        chars = sum(c["caracteres"] for c in cs)
        linha = {"t": s["t"], "data": s["t"].isoformat(timespec="seconds"), "projeto": s["projeto"], "modelo": s["modelo"], "modo": s["modo"],
                 "consultas": len(cs), "caracteres_lidos": chars, "estado_tokens": None, "com_cerebro": None, "sem_cerebro": None,
                 "evitados": None, "motivo": ""}
        if s["modo"] != "novo":
            linha["motivo"] = "continuou uma conversa que já tinha o contexto: nada a explicar"
        elif not cs:
            linha["evitados"], linha["motivo"] = 0, "nenhuma consulta ao cérebro registrada nesta sessão"
        else:
            estado, conversas = tam.get(s["projeto"], (0, 0))
            com = estado + tokens.tokens_de_caracteres(chars)
            linha.update(estado_tokens=estado, com_cerebro=com, sem_cerebro=conversas)
            if not conversas:
                linha["evitados"], linha["motivo"] = 0, "o projeto ainda não tem conversas no cérebro para reexplicar"
            else:
                linha["evitados"] = conversas - com   # pode ser negativo: o cérebro custou mais do que reexplicar
        saida.append(linha)
    return saida


# ---------- 3. teste A/B manual ----------

def arquivo_ab(base=None):
    return _base(base) / ".log" / "ab.jsonl"


def ler_ab(base=None):
    saida = []
    for d in _ler_jsonl(arquivo_ab(base)):
        if d.get("variante") in VARIANTES and isinstance(d.get("tarefa"), str) and isinstance(d.get("id"), str):
            e, s = _inteiro(d.get("entrada")), _inteiro(d.get("saida"))
            custo = d.get("custo_usd")
            saida.append({"id": d["id"], "data": str(d.get("data") or ""), "tarefa": d["tarefa"], "variante": d["variante"], "entrada": e,
                          "saida": s, "total": e + s, "custo_usd": float(custo) if isinstance(custo, (int, float)) and not isinstance(custo, bool) else None,
                          "notas": str(d.get("notas") or "")})
    return saida


def _numero(v, nome, obrigatorio=False, decimal=False):
    if v in (None, ""):
        if obrigatorio:
            raise ValueError(f"{nome}: informe um número")
        return None
    s = str(v).replace(" ", "")
    if "," in s:                      # 1.234,56 (pt-BR) -> 1234.56
        s = s.replace(".", "").replace(",", ".")
    elif not decimal and s.count(".") and all(len(g) == 3 for g in s.split(".")[1:]):
        s = s.replace(".", "")        # 12.345 (milhar em pt-BR) -> 12345
    try:
        n = float(s) if decimal else int(float(s))
    except ValueError:
        raise ValueError(f"{nome}: '{v}' não é um número")
    if n < 0 or n > 10 ** 10 or (isinstance(n, float) and not math.isfinite(n)):
        raise ValueError(f"{nome}: valor fora do esperado")
    return n


def registrar_ab(dados, base=None, agora=None):
    """Grava um resultado do teste A/B. Valida (ValueError com a mensagem para a tela) e devolve o registro."""
    if not isinstance(dados, dict):
        raise ValueError("dados inválidos")
    tarefa = " ".join(str(dados.get("tarefa") or "").split())[:120]
    if not tarefa:
        raise ValueError("tarefa: descreva a tarefa (a mesma nas duas variantes)")
    variante = str(dados.get("variante") or "")
    if variante not in VARIANTES:
        raise ValueError("variante: use 'com' (com cérebro) ou 'sem' (sem cérebro)")
    entrada, saida = _numero(dados.get("entrada"), "tokens de entrada"), _numero(dados.get("saida"), "tokens de saída")
    if not (entrada or 0) + (saida or 0):
        raise ValueError("informe os tokens de entrada e/ou de saída que o /usage mostrou")
    custo = _numero(dados.get("custo_usd"), "custo", decimal=True)
    agora = agora or datetime.datetime.now()
    reg = {"id": agora.strftime("%Y%m%d%H%M%S") + "-" + "%04x" % random.randrange(65536), "data": agora.isoformat(timespec="seconds"),
           "tarefa": tarefa, "variante": variante, "entrada": entrada or 0, "saida": saida or 0, "notas": " ".join(str(dados.get("notas") or "").split())[:300]}
    if custo is not None:
        reg["custo_usd"] = custo
    arq = arquivo_ab(base)
    arq.parent.mkdir(parents=True, exist_ok=True)
    with open(arq, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(reg, ensure_ascii=False, separators=(",", ":")) + "\n")
    return {**reg, "total": reg["entrada"] + reg["saida"]}


def remover_ab(id_, base=None):
    """Tira UM registro (pelo id) do ab.jsonl, reescrevendo o arquivo de uma vez. ValueError se o id não existe."""
    arq = arquivo_ab(base)
    try:
        linhas = arq.read_text(encoding="utf-8").splitlines()
    except OSError:
        raise ValueError("não há registros do teste A/B")
    restantes, achou = [], False
    for l in linhas:
        try:
            if json.loads(l).get("id") == id_:
                achou = True
                continue
        except ValueError:
            pass
        restantes.append(l)
    if not achou:
        raise ValueError(f"registro não encontrado: {id_}")
    tmp = arq.with_name(arq.name + ".tmp")
    tmp.write_text("".join(l + "\n" for l in restantes), encoding="utf-8", newline="\n")
    os.replace(tmp, arq)
    return {"removido": id_}


def comparar_ab(registros):
    """Por tarefa: média de tokens COM e SEM cérebro (se rodou várias vezes) e a redução. Só entram tarefas com as duas variantes."""
    por_tarefa = {}
    for r in registros:
        chave = " ".join(r["tarefa"].lower().split())
        t = por_tarefa.setdefault(chave, {"tarefa": r["tarefa"], "com": [], "sem": []})
        t[r["variante"]].append(r["total"])
    saida = []
    for t in por_tarefa.values():
        item = {"tarefa": t["tarefa"]}
        for v in VARIANTES:
            item[v] = {"n": len(t[v]), "total": round(sum(t[v]) / len(t[v])) if t[v] else None}
        item["reducao_pct"] = round(100 * (item["sem"]["total"] - item["com"]["total"]) / item["sem"]["total"], 1) \
            if item["com"]["total"] is not None and item["sem"]["total"] else None
        saida.append(item)
    return saida


# ---------- o painel ----------

def painel(semanas_n=SEMANAS_PADRAO, base=None, agora=None):
    base = _base(base)
    agora = agora or datetime.datetime.now()
    n = max(2, min(int(semanas_n), 26))
    inicio = inicio_da_semana(agora.date()) - datetime.timedelta(weeks=n - 1)
    de = datetime.datetime.combine(inicio, datetime.time())
    consultas_todas = ler_consultas(base)
    sessoes_todas = ler_sessoes(base)
    ids = [cerebro._slug(p) for p in cerebro.listar_projetos(base)[0]]
    # as consultas da janela, mas as sessões podem ter aberto antes dela (consulta no começo da janela)
    consultas = [c for c in consultas_todas if c["t"] >= de]
    avaliadas = [s for s in avaliar_sessoes(base, [s for s in sessoes_todas if s["t"] >= de - datetime.timedelta(hours=JANELA_SESSAO_H)], consultas, ids)
                 if s["t"] >= de]
    sem = semanas(consultas, avaliadas, n, agora.date())
    buscas = agrupar_buscas(consultas)
    n12 = sum(1 for b in buscas if not b["nivel3"])
    por_nivel = {k: sum(w["por_nivel"][k] for w in sem) for k in NIVEIS}
    contaram = [s for s in avaliadas if s["evitados"] is not None and s["consultas"]]
    ab = ler_ab(base)
    comp = comparar_ab(ab)
    reducoes = [c["reducao_pct"] for c in comp if c["reducao_pct"] is not None]
    return {
        "semanas": sem, "nota": NOTA,
        "totais": {"consultas": len(consultas), "caracteres": sum(c["caracteres"] for c in consultas),
                   "tokens": tokens.tokens_de_caracteres(sum(c["caracteres"] for c in consultas)), "por_nivel": por_nivel,
                   "buscas": len(buscas), "buscas_nivel12": n12, "buscas_nivel3": len(buscas) - n12,
                   "pct_nivel12": round(100 * n12 / len(buscas)) if buscas else None},
        "evitados": {"total": sum(s["evitados"] for s in contaram), "sessoes_contadas": len(contaram),
                     "sessoes_novas": sum(1 for s in avaliadas if s["modo"] == "novo"),
                     "sessoes_negativas": sum(1 for s in contaram if s["evitados"] < 0)},
        "sessoes": [{k: v for k, v in s.items() if k != "t"} for s in avaliadas[-MAX_SESSOES:]][::-1],
        "ab": {"registros": ab[-MAX_AB:][::-1], "comparacoes": comp, "media_reducao_pct": round(sum(reducoes) / len(reducoes), 1) if reducoes else None},
        "fator_tokens": tokens.ler_config_tokens() or tokens.FATOR_ACENTOS,
    }


# ---------- linha de comando ----------

def _imprimir(args, dados, linhas):
    if args.json:
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for l in linhas:
            print(l)


def _cmd_painel(args):
    d = painel(args.semanas)
    t, e = d["totais"], d["evitados"]
    linhas = [f"semana         consultas  tokens  títulos cabeç. ler buscar  nível1-2  evitados(est.)"]
    for w in d["semanas"]:
        p = w["por_nivel"]
        linhas.append(f"{w['inicio']}  {w['consultas']:>8}  {w['tokens']:>6}  {p['titulos']:>7} {p['cabecalho']:>6} {p['ler']:>3} {p['buscar']:>6}  "
                      f"{('%d%%' % w['pct_nivel12']) if w['pct_nivel12'] is not None else '-':>8}  {w['evitados']:>8}")
    linhas.append(f"buscas: {t['buscas']} ({t['buscas_nivel12']} resolvidas nos níveis 1-2" + (f", {t['pct_nivel12']}%" if t["pct_nivel12"] is not None else "") + ")")
    linhas.append(f"tokens evitados (estimado): {e['total']} em {e['sessoes_contadas']} sessões")
    if d["ab"]["media_reducao_pct"] is not None:
        linhas.append(f"teste A/B: redução média de {d['ab']['media_reducao_pct']}% nos tokens (medido por você)")
    linhas.append(d["nota"])
    _imprimir(args, d, linhas)
    return 0


def _entrada_json():
    bruto = getattr(sys.stdin, "buffer", None)
    texto = bruto.read().decode("utf-8-sig", errors="replace") if bruto else sys.stdin.read()
    try:
        return json.loads(texto or "{}")
    except ValueError:
        raise ValueError("entrada não é um JSON válido")


def _cmd_ab_registrar(args):
    r = registrar_ab(_entrada_json())
    _imprimir(args, {"registro": r}, [f"registrado: {r['variante']} cérebro, {r['total']} tokens ({r['id']})"])
    return 0


def _cmd_ab_remover(args):
    r = remover_ab(args.id)
    _imprimir(args, r, [f"removido: {args.id}"])
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="economia.py", description="O cérebro está compensando? (estimativas locais)")
    sub = ap.add_subparsers(dest="comando", required=True)
    p = sub.add_parser("painel")
    p.add_argument("--semanas", type=int, default=SEMANAS_PADRAO)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_painel)
    p = sub.add_parser("ab-registrar")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_ab_registrar)
    p = sub.add_parser("ab-remover")
    p.add_argument("id")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_ab_remover)
    args = ap.parse_args(argv)
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
