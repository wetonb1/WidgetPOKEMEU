#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""manutencao.py - rotina de manutenção do cérebro (botão [manutenção] da aba Cérebro). Só biblioteca padrão.
NADA roda sozinho: cada comando é um clique seu. O diagnóstico e os sinônimos não usam IA nem gastam token; só 'consolidar' e
'propor-estado' chamam o Claude Code (claude -p), e a tela mostra a estimativa de tokens e pede confirmação antes.

  manutencao.py diagnostico [--json]                 tamanho, nunca consultados (6+ meses), palavras-chave quase iguais, arquivos
                                                     parecidos (80%+ das palavras-chave), estados com mais de 30 dias, sinônimos sugeridos
  manutencao.py sinonimos-aprovar --json < {"pares": {"bd": "banco-de-dados"}}   grava em cerebro/sinonimos.json
  manutencao.py sinonimos-remover APELIDO [--json]
  manutencao.py estimar-consolidar [--json]          grupos e tokens estimados (sem IA)
  manutencao.py consolidar GRUPO_ID [--modelo haiku] [--json]    USA IA: 1 resumo no lugar do grupo; originais -> arquivo-morto/
  manutencao.py estimar-estado PROJETO [--dias 90]   (sem IA)
  manutencao.py propor-estado PROJETO [--dias 90] [--modelo haiku]   USA IA: devolve a proposta, NÃO grava
  manutencao.py aplicar-estado PROJETO --json < {"texto": "..."}    grava o estado aprovado (guarda a versão anterior)
  manutencao.py indices [--json]                     refaz o INDICE.md e, com mais de 100 arquivos, indices/{projeto}.md
  manutencao.py exportar --destino PASTA [--json]    .zip datado do cérebro (pode ter dados pessoais!)
"""
import argparse
import datetime
import difflib
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402
import importar  # noqa: E402
import tokens  # noqa: E402

DIAS_SEM_CONSULTA = 183        # "mais de 6 meses"
DIAS_ESTADO = 30
DIAS_CONVERSAS_ANTIGAS = 90    # conversa "antiga" para propor a atualização do estado
SIMILARIDADE = 0.8             # Jaccard das palavras-chave
MIN_CHAVES = 3                 # menos palavras-chave que isso não entra na comparação
MAX_GRUPO = 8                  # resumos por consolidação
LOG_CONFIAVEL_DIAS = 30        # log de consultas mais novo que isso não prova que algo "nunca" foi consultado
MAX_LISTA = 50
MAX_SINONIMOS = 500
SAIDA_CONSOLIDADO = 250        # tokens de saída estimados por resumo consolidado / estado proposto
PROMPT_CONSOLIDAR = Path(__file__).resolve().parent / "prompt_consolidar.txt"
PROMPT_ESTADO = Path(__file__).resolve().parent / "prompt_estado.txt"
MORTO = "arquivo-morto"
PARTICULAS = cerebro.PARTICULAS


def _base(base=None):
    return Path(base) if base else Path(cerebro.localizar_cerebro())


def _hoje(hoje=None):
    return hoje or datetime.date.today()


def _data(texto):
    try:
        return datetime.date.fromisoformat(str(texto)[:10])
    except ValueError:
        return None


# ---------- coleta ----------

def coletar(base):
    """Uma entrada por conversa: nome, data, projeto, palavras-chave (cabeçalho) e tamanho."""
    saida = []
    pasta = Path(base) / "conversas"
    try:
        with os.scandir(pasta) as it:
            arquivos = sorted((e for e in it if e.is_file() and e.name.lower().endswith(".md")), key=lambda e: e.name)
    except OSError:
        return saida
    for e in arquivos:
        try:
            cab = cerebro.ler_cabecalho(e.path)
            tam = e.stat().st_size
        except OSError:
            continue
        m = cerebro.RE_PREFIXO_DATA.match(e.name)
        d = _data(m.group(1) if m else cab["data"])
        chaves = [c for c in (cab["palavras_chave"] or [])]
        saida.append({"nome": e.name, "data": d, "projeto": cerebro._slug(cab["projeto"] or "") or "sem-projeto", "origem": cab["origem"] or "",
                      "chaves": chaves, "slugs": frozenset(s for s in (cerebro._slug(c) for c in chaves) if s), "bytes": tam})
    return saida


def _jsonl(arq):
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


def consultados(base):
    """({nomes já consultados em minúsculas}, resumo do log). 'Consultado' = o arquivo foi aberto (ler) ou apareceu num resultado
    de titulos/cabecalho/buscar (o log guarda os arquivos devolvidos desde a fase 6.2; linhas antigas só têm os termos)."""
    vistos, primeira, n, com_arquivos = set(), None, 0, 0
    for d in _jsonl(Path(base) / ".log" / "consultas.jsonl"):
        n += 1
        t = _data(d.get("data"))
        if t and (primeira is None or t < primeira):
            primeira = t
        nomes = []
        if isinstance(d.get("arquivos"), list):
            com_arquivos += 1
            nomes += [str(a) for a in d["arquivos"]]
        if d.get("comando") == "ler" and isinstance(d.get("termos"), list):
            nomes += [str(a) for a in d["termos"]]
        for a in nomes:
            vistos.add(a.replace("\\", "/").split("/")[-1].lower())
    return vistos, {"desde": primeira.isoformat() if primeira else None, "consultas": n, "com_arquivos": com_arquivos}


# ---------- 1. diagnóstico ----------

def _bytes_de(caminho):
    total = 0
    if caminho.is_file():
        return caminho.stat().st_size
    for raiz, dirs, arquivos in os.walk(caminho):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__")]
        for a in arquivos:
            try:
                total += os.stat(os.path.join(raiz, a)).st_size
            except OSError:
                pass
    return total


def tamanho_do_cerebro(base):
    """Bytes por pasta do cérebro (sem a tools/, que é código). Tamanho total = tudo que é memória e log."""
    base = Path(base)
    por_pasta, total = {}, 0
    try:
        itens = sorted(base.iterdir())
    except OSError:
        itens = []
    for p in itens:
        if p.name in ("tools", ".git", "__pycache__"):
            continue
        n = _bytes_de(p)
        arquivos = sum(1 for _ in p.rglob("*") if _.is_file()) if p.is_dir() else 1
        por_pasta[p.name] = {"bytes": n, "arquivos": arquivos}
        total += n
    return {"bytes": total, "kb": round(total / 1024, 1), "mb": round(total / 1024 / 1024, 2), "por_pasta": por_pasta}


def _stem_pt(palavra):
    if palavra.endswith("oes") and len(palavra) > 5:
        return palavra[:-3] + "ao"
    if palavra.endswith("ns") and len(palavra) > 4:
        return palavra[:-2] + "m"
    if palavra.endswith("s") and len(palavra) > 3:
        return palavra[:-1]
    return palavra


def _dist_ate_1(a, b):
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b):
        a, b = b, a
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    return a[i:] == b[i + 1:]


def _iniciais(kw):
    return "".join(p[0] for p in kw.split("-") if p and p not in PARTICULAS)


def palavras_quase_iguais(contagem, sinonimos_atuais=None):
    """Grupos de palavras-chave que parecem a mesma coisa: plural/singular (agente, agentes), hífen (claudemd, claude-md), erro de
    digitação (1 letra) e abreviação (bd = banco-de-dados). Devolve (grupos, sinonimos sugeridos). A decisão é sua: nada é alterado."""
    sinonimos_atuais = sinonimos_atuais or {}
    palavras = sorted(contagem)
    pai = {p: p for p in palavras}

    def raiz(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x
    arestas = []

    def unir(a, b, regra):
        if a != b:
            arestas.append((a, b, regra))
            pai[raiz(a)] = raiz(b)

    def por_chave(chaves_de, regra, minimo=1):
        indice = {}
        for p in palavras:
            for k in chaves_de(p):
                if k and len(k) >= minimo:
                    indice.setdefault(k, []).append(p)
        for membros in indice.values():
            for outro in membros[1:]:
                unir(membros[0], outro, regra)
    por_chave(lambda p: ["-".join(_stem_pt(w) for w in p.split("-"))], "plural")
    por_chave(lambda p: [p.replace("-", "")], "hifen")
    # erro de digitação: palavras simples de 6+ letras com uma letra a mais, a menos ou trocada (candidatas pelas "deleções").
    # Palavras com número (fase1, fase2, v1, v2) são coisas diferentes, não erros: ficam de fora.
    delecoes = {}
    for p in palavras:
        if "-" not in p and len(p) >= 6 and p.isalpha():
            for k in {p} | {p[:i] + p[i + 1:] for i in range(len(p))}:
                delecoes.setdefault(k, set()).add(p)
    for membros in delecoes.values():
        membros = sorted(membros)
        for i, a in enumerate(membros):
            for b in membros[i + 1:]:
                if _dist_ate_1(a, b) and _stem_pt(a) != _stem_pt(b):  # singular/plural já tem a sua regra
                    unir(a, b, "digitacao")
    # abreviação: a sigla é a inicial de cada palavra (sem "de", "da"...) de uma palavra-chave composta
    for p in palavras:
        if "-" in p:
            sigla = _iniciais(p)
            if 2 <= len(sigla) <= 5 and sigla in contagem and sigla != p:
                unir(sigla, p, "abreviacao")
    grupos = {}
    for p in palavras:
        grupos.setdefault(raiz(p), []).append(p)
    saida, sugeridos = [], []
    for membros in grupos.values():
        if len(membros) < 2:
            continue
        regras = sorted({r for a, b, r in arestas if a in membros or b in membros})
        if "abreviacao" in regras:
            padrao = max((m for m in membros if "-" in m), key=lambda m: (contagem[m], len(m)))
        else:
            padrao = max(membros, key=lambda m: (contagem[m], -len(m), m))
        saida.append({"termos": [{"palavra": m, "arquivos": contagem[m]} for m in sorted(membros, key=lambda m: -contagem[m])],
                      "sugerido": padrao, "regras": regras})
        for m in membros:
            if m != padrao and m not in sinonimos_atuais:
                sugeridos.append({"apelido": m, "padrao": padrao, "regras": regras, "arquivos": contagem[m]})
    saida.sort(key=lambda g: -sum(t["arquivos"] for t in g["termos"]))
    sugeridos.sort(key=lambda s: (-s["arquivos"], s["apelido"]))
    return saida, sugeridos


def _jaccard(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def grupos_parecidos(entradas, limite=SIMILARIDADE):
    """Conversas do MESMO projeto com palavras-chave quase iguais (Jaccard >= limite). Cada grupo nasce de uma conversa-semente (a mais
    antiga) e leva as que se parecem com ELA, no máximo MAX_GRUPO: assim o grupo não vai se esticando de uma em uma."""
    por_projeto = {}
    for e in entradas:
        if len(e["slugs"]) >= MIN_CHAVES:
            por_projeto.setdefault(e["projeto"], []).append(e)
    grupos = []
    for projeto, itens in sorted(por_projeto.items()):
        itens.sort(key=lambda e: (e["data"] or datetime.date.min, e["nome"]))
        sementes, por_chave = [], {}
        for e in itens:
            candidatas = {}
            for k in e["slugs"]:
                postos = por_chave.get(k, ())
                if len(postos) <= 400:  # palavra-chave comum demais não ajuda a achar semente
                    for i in postos:
                        candidatas[i] = candidatas.get(i, 0) + 1
            alvo = None
            for i, _ in sorted(candidatas.items(), key=lambda kv: (-kv[1], kv[0]))[:60]:
                if len(sementes[i]["membros"]) < MAX_GRUPO and _jaccard(e["slugs"], sementes[i]["semente"]["slugs"]) >= limite:
                    alvo = i
                    break
            if alvo is None:
                sementes.append({"semente": e, "membros": [e]})
                for k in e["slugs"]:
                    por_chave.setdefault(k, []).append(len(sementes) - 1)
            else:
                sementes[alvo]["membros"].append(e)
        for s in sementes:
            if len(s["membros"]) >= 2:
                grupos.append({"projeto": projeto, "membros": s["membros"], "semente": s["semente"]})
    saida = []
    for g in grupos:
        nomes = [m["nome"] for m in g["membros"]]
        saida.append({"id": hashlib.sha1("|".join(sorted(nomes)).encode("utf-8")).hexdigest()[:10], "projeto": g["projeto"],
                      "arquivos": [{"arquivo": m["nome"], "data": m["data"].isoformat() if m["data"] else "",
                                    "similaridade": round(_jaccard(m["slugs"], g["semente"]["slugs"]), 2)} for m in g["membros"]],
                      "bytes": sum(m["bytes"] for m in g["membros"])})
    saida.sort(key=lambda g: (-len(g["arquivos"]), g["projeto"], g["id"]))
    return saida


def _estimar_tokens_bytes(n):
    return tokens.tokens_de_caracteres(n)


def _tokens_do_prompt(arq):
    try:
        return (len(arq.read_text(encoding="utf-8")) + 3) // 4
    except OSError:
        return 0


def estimar_grupos(grupos):
    """(tokens de entrada, de saída, chamadas): uma chamada por grupo, com o prompt e o texto dos resumos."""
    prompt = _tokens_do_prompt(PROMPT_CONSOLIDAR)
    entrada = sum(_estimar_tokens_bytes(g["bytes"]) + prompt + 150 for g in grupos)
    return entrada, len(grupos) * SAIDA_CONSOLIDADO, len(grupos)


def estados_velhos(base, hoje, dias=DIAS_ESTADO):
    saida = []
    pasta = Path(base) / "estado"
    for arq in sorted(pasta.glob("*.md")) if pasta.is_dir() else []:
        try:
            d = datetime.date.fromtimestamp(arq.stat().st_mtime)
        except OSError:
            continue
        if (hoje - d).days > dias:
            saida.append({"projeto": arq.stem, "arquivo": f"estado/{arq.name}", "atualizado": d.isoformat(), "dias": (hoje - d).days})
    saida.sort(key=lambda e: -e["dias"])
    return saida


def conversas_antigas(entradas, projeto, hoje, dias=DIAS_CONVERSAS_ANTIGAS):
    """Conversas do projeto com mais de `dias` dias, da mais nova para a mais antiga."""
    slug = cerebro._slug(projeto)
    itens = [e for e in entradas if e["projeto"] == slug and e["data"] and (hoje - e["data"]).days > dias]
    itens.sort(key=lambda e: (e["data"], e["nome"]), reverse=True)
    return itens


def diagnostico(base=None, hoje=None):
    """Tudo numa chamada, sem IA. Nada é alterado."""
    base, hoje = _base(base), _hoje(hoje)
    entradas = coletar(base)
    vistos, log = consultados(base)
    sinonimos = cerebro.ler_sinonimos(base)
    # nunca consultados há mais de 6 meses
    velhos = [e for e in entradas if e["data"] and (hoje - e["data"]).days > DIAS_SEM_CONSULTA and e["nome"].lower() not in vistos]
    velhos.sort(key=lambda e: (e["data"], e["nome"]))
    desde = _data(log["desde"])
    dias_log = (hoje - desde).days if desde else 0
    confiavel = dias_log >= LOG_CONFIAVEL_DIAS and log["com_arquivos"] > 0
    aviso = ("" if confiavel else
             f"O log de consultas só cobre {dias_log} dia(s) e {log['com_arquivos']} consulta(s) com a lista de arquivos devolvidos "
             f"(o registro dos arquivos começou na fase 6.2): esta lista ainda não prova que algo NUNCA foi consultado. Revise à mão antes de agir.")
    # palavras-chave
    contagem = {}
    for e in entradas:
        for s in e["slugs"]:
            contagem[s] = contagem.get(s, 0) + 1
    quase, sugeridos = palavras_quase_iguais(contagem, sinonimos)
    grupos = grupos_parecidos(entradas)
    entrada_t, saida_t, chamadas = estimar_grupos(grupos)
    for g in grupos:  # a estimativa de cada grupo, para a tela pedir a confirmação antes de gastar
        g["tokens_entrada"], g["tokens_saida"] = estimar_grupos([g])[:2]
    por_projeto = {}
    for e in entradas:
        por_projeto.setdefault(e["projeto"], 0)
    estados = []
    for p in sorted(por_projeto):
        n = len(conversas_antigas(entradas, p, hoje))
        if n and (Path(base) / "estado" / f"{p}.md").is_file():
            estados.append({"projeto": p, "conversas_antigas": n})
    tam = tamanho_do_cerebro(base)
    n_arquivos = len(entradas) + sum(1 for _ in (Path(base) / "estado").glob("*.md"))
    indices = sorted(p.stem for p in (Path(base) / "indices").glob("*.md")) if (Path(base) / "indices").is_dir() else []
    ev = estados_velhos(base, hoje)
    return {
        "gerado": hoje.isoformat(),
        "tamanho": {**tam, "conversas": len(entradas), "arquivos": n_arquivos},
        "nunca_consultados": {"total": len(velhos), "dias_limite": DIAS_SEM_CONSULTA, "confiavel": confiavel, "aviso": aviso, "log": {**log, "dias": dias_log},
                              "lista": [{"arquivo": e["nome"], "data": e["data"].isoformat(), "dias": (hoje - e["data"]).days, "projeto": e["projeto"]} for e in velhos[:MAX_LISTA]]},
        "palavras_quase_iguais": quase[:40],
        "sinonimos_sugeridos": sugeridos[:60],
        "sinonimos": sinonimos,
        "similares": {"total_grupos": len(grupos), "total_arquivos": sum(len(g["arquivos"]) for g in grupos), "limite": SIMILARIDADE,
                      "tokens_entrada": entrada_t, "tokens_saida": saida_t, "chamadas": chamadas, "grupos": grupos[:MAX_LISTA]},
        "estados_velhos": {"total": len(ev), "dias_limite": DIAS_ESTADO, "lista": ev[:MAX_LISTA]},
        "estados_com_conversas_antigas": estados,
        "indices": {"limite": cerebro.INDICE_TEMA_MIN, "arquivos": n_arquivos, "devem_existir": n_arquivos > cerebro.INDICE_TEMA_MIN, "existentes": indices},
    }


# ---------- 2. sinônimos ----------

def _arquivo_sinonimos(base):
    return Path(base) / cerebro.ARQ_SINONIMOS


def _ler_sinonimos_brutos(base):
    """O conteúdo do sinonimos.json como está (para não perder comentários nem a grafia que você usou)."""
    try:
        dados = json.loads(_arquivo_sinonimos(base).read_bytes().decode("utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return dados if isinstance(dados, dict) else {}


def _gravar_sinonimos(base, dados):
    arq = _arquivo_sinonimos(base)
    tmp = arq.with_name(arq.name + ".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, arq)


def aprovar_sinonimos(base, pares):
    """Acrescenta {apelido: padrão} ao sinonimos.json (só o que você aprovou na tela). Devolve {adicionados, ignorados, total}."""
    base = _base(base)
    if not isinstance(pares, dict) or not pares:
        raise ValueError("nenhum sinônimo para aprovar")
    dados = _ler_sinonimos_brutos(base)
    atuais = {cerebro._slug(k) for k in dados if not k.startswith("_")}
    adicionados, ignorados = [], []
    for apelido, padrao in pares.items():
        a, p = cerebro._slug(str(apelido)), cerebro._slug(str(padrao))
        if not a or not p or a == p or len(a) > 60 or len(p) > 60:
            ignorados.append(f"{apelido} -> {padrao}: inválido")
        elif a in atuais:
            ignorados.append(f"{apelido}: já existe")
        elif len(atuais) + len(adicionados) >= MAX_SINONIMOS:
            ignorados.append(f"{apelido}: limite de {MAX_SINONIMOS} sinônimos")
        else:
            dados[a] = p
            adicionados.append(a)
    if adicionados:
        _gravar_sinonimos(base, dados)
    return {"adicionados": adicionados, "ignorados": ignorados, "total": len(cerebro.ler_sinonimos(base))}


def remover_sinonimo(base, apelido):
    base = _base(base)
    dados = _ler_sinonimos_brutos(base)
    chave = next((k for k in dados if not k.startswith("_") and cerebro._slug(k) == cerebro._slug(str(apelido))), None)
    if chave is None:
        raise ValueError(f"sinônimo não encontrado: {apelido}")
    del dados[chave]
    _gravar_sinonimos(base, dados)
    return {"removido": chave, "total": len(cerebro.ler_sinonimos(base))}


# ---------- 3. consolidação (USA IA) ----------

def _chamar_padrao(modelo, timeout):
    """Chamada do Claude Code (o mesmo motor do importador), numa pasta vazia para não carregar CLAUDE.md de projeto nenhum."""
    tmp = tempfile.mkdtemp(prefix="manutencao-claude-")

    def chamar(sistema, mensagem):
        return importar.chamar_claude(sistema, mensagem, modelo, timeout, False, (), cwd=tmp)
    return chamar, tmp


def _erro_da_ia(e):
    if isinstance(e, importar.ParouTudo):
        rotulo = {"limite": "limite de uso atingido", "login": "problema de login", "sem_claude": "Claude Code não encontrado"}.get(e.tipo, e.tipo)
        return ValueError(f"[{e.tipo}] {rotulo}: {e.detalhe}")
    return ValueError(str(e))


def _corpo_de(caminho):
    texto = caminho.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n")
    return "\n".join(texto.split("\n")[3:]).strip()


def localizar_grupo(base, grupo_id):
    grupos = grupos_parecidos(coletar(base))
    for g in grupos:
        if g["id"] == grupo_id:
            return g
    raise ValueError("grupo não encontrado (os arquivos mudaram): rode o diagnóstico de novo")


def _mover_para_o_morto(base, nomes, consolidado, projeto, modelo):
    base = Path(base)
    morto = base / MORTO
    morto.mkdir(exist_ok=True)
    movidos = []
    for nome in nomes:
        origem = base / "conversas" / nome
        destino, i = morto / nome, 2
        while destino.exists():
            destino, i = morto / f"{Path(nome).stem}-{i}.md", i + 1
        shutil.move(str(origem), str(destino))
        movidos.append(destino.name)
    with open(morto / "consolidacoes.jsonl", "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({"data": datetime.datetime.now().isoformat(timespec="seconds"), "consolidado": consolidado, "projeto": projeto,
                            "originais": movidos, "modelo": modelo}, ensure_ascii=False, separators=(",", ":")) + "\n")
    return movidos


def consolidar_grupo(base, grupo_id, modelo=importar.MODELO_PADRAO, timeout=importar.TIMEOUT_PADRAO, chamar=None, prompt=None):
    """USA IA. Gera 1 resumo consolidado no formato oficial (com 1 nova tentativa se o salvar recusar), grava com a data do mais recente
    dos originais e MOVE os originais para cerebro/arquivo-morto/ (nunca apaga). Se algo falhar antes de gravar, nada é movido."""
    base = _base(base)
    g = localizar_grupo(base, grupo_id)
    sistema = Path(prompt or PROMPT_CONSOLIDAR).read_text(encoding="utf-8").strip()
    nomes = [a["arquivo"] for a in g["arquivos"]]
    partes, datas, origens = [], [], set()
    for a in g["arquivos"]:
        caminho = base / "conversas" / a["arquivo"]
        cab = cerebro.ler_cabecalho(str(caminho))
        origens.add(cab["origem"] or "outro")
        datas.append(a["data"])
        partes.append(f"=== {a['arquivo']} (data {a['data']}) ===\npalavras-chave: {', '.join(cab['palavras_chave'] or [])}\n{_corpo_de(caminho)}")
    mensagem = (f"Projeto: {g['projeto']}\nResumos a consolidar: {len(nomes)} (do mais antigo ao mais recente)\n\n" + "\n\n".join(partes)
                + "\n\n=== FIM DOS RESUMOS ===\n\nResponda agora, somente no formato exigido.")
    tmp = None
    if chamar is None:
        chamar, tmp = _chamar_padrao(modelo, timeout)
    uso = {"entrada": 0, "saida": 0, "custo_usd": 0.0}
    try:
        erro = ""
        for tentativa in (1, 2):
            try:
                r = chamar(sistema, mensagem if tentativa == 1 else importar.montar_correcao(resposta, erro))
            except (importar.ParouTudo, importar.FalhaConversa) as e:
                raise _erro_da_ia(e)
            for k in uso:
                uso[k] += r.get(k) or 0
            resposta = r["texto"]
            try:
                campos = importar.parsear_resposta(resposta, [g["projeto"]])
                origem = origens.pop() if len(origens) == 1 else "outro"
                destino = cerebro.salvar_conversa(base, campos["titulo"], campos["palavras"], origem, g["projeto"], campos["corpo"], hoje=max(datas))
                break
            except ValueError as e:
                erro = str(e)
        else:
            raise ValueError("o resumo consolidado foi recusado duas vezes (nada foi movido): " + erro[:200])
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    movidos = _mover_para_o_morto(base, nomes, destino.name, g["projeto"], modelo)
    cerebro.escrever_indice(base)
    return {"consolidado": destino.name, "projeto": g["projeto"], "originais": movidos, "tokens": uso, "modelo": modelo}


# ---------- 3b. atualização do estado (USA IA, só propõe) ----------

def _tira_cercas(texto):
    linhas = texto.replace("\r\n", "\n").strip("\n").split("\n")
    while linhas and linhas[0].strip().startswith("```"):
        linhas.pop(0)
    while linhas and linhas[-1].strip().startswith("```"):
        linhas.pop()
    return "\n".join(linhas).strip()


def _material_do_estado(base, projeto, hoje, dias, max_arquivos=25, max_chars=30000):
    """(estado atual, [(nome, texto)] das conversas antigas, até os limites) para a proposta."""
    base = Path(base)
    atual = ""
    caminho = base / "estado" / f"{cerebro._slug(projeto)}.md"
    if caminho.is_file():
        atual = caminho.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n").strip()
    itens, total = [], 0
    for e in conversas_antigas(coletar(base), projeto, hoje, dias)[:max_arquivos]:
        corpo = _corpo_de(base / "conversas" / e["nome"])
        texto = f"=== {e['nome']} (data {e['data'].isoformat()}) ===\npalavras-chave: {', '.join(e['chaves'])}\n{corpo}"
        if total + len(texto) > max_chars:
            break
        itens.append((e["nome"], texto))
        total += len(texto)
    return atual, itens


def estimar_estado(base, projeto, hoje=None, dias=DIAS_CONVERSAS_ANTIGAS):
    base, hoje = _base(base), _hoje(hoje)
    atual, itens = _material_do_estado(base, projeto, hoje, dias)
    chars = len(atual) + sum(len(t) for _, t in itens)
    return {"projeto": cerebro._slug(projeto), "conversas_antigas": len(itens), "dias": dias,
            "tokens_entrada": tokens.tokens_de_caracteres(chars) + _tokens_do_prompt(PROMPT_ESTADO) + 150, "tokens_saida": SAIDA_CONSOLIDADO, "chamadas": 1 if itens else 0}


def propor_estado(base, projeto, hoje=None, dias=DIAS_CONVERSAS_ANTIGAS, modelo=importar.MODELO_PADRAO, timeout=importar.TIMEOUT_PADRAO, chamar=None, prompt=None):
    """USA IA. Devolve a PROPOSTA de estado (com o diff contra o atual) e NÃO grava nada: quem grava é o aplicar_estado, depois de você aprovar."""
    base, hoje = _base(base), _hoje(hoje)
    slug = cerebro._slug(projeto)
    atual, itens = _material_do_estado(base, slug, hoje, dias)
    if not itens:
        raise ValueError(f"{slug}: não há conversas com mais de {dias} dias para basear a atualização")
    sistema = Path(prompt or PROMPT_ESTADO).read_text(encoding="utf-8").strip()
    mensagem = (f"Projeto: {slug}\n\n=== ESTADO ATUAL ===\n{atual or '(ainda não existe)'}\n=== FIM DO ESTADO ATUAL ===\n\n=== CONVERSAS ANTIGAS (da mais nova para a mais antiga) ===\n"
                + "\n\n".join(t for _, t in itens) + "\n=== FIM DAS CONVERSAS ===\n\nResponda agora, somente com o estado atualizado.")
    tmp = None
    if chamar is None:
        chamar, tmp = _chamar_padrao(modelo, timeout)
    uso = {"entrada": 0, "saida": 0, "custo_usd": 0.0}
    try:
        erro = ""
        for tentativa in (1, 2):
            try:
                r = chamar(sistema, mensagem if tentativa == 1 else importar.montar_correcao(resposta, erro))
            except (importar.ParouTudo, importar.FalhaConversa) as e:
                raise _erro_da_ia(e)
            for k in uso:
                uso[k] += r.get(k) or 0
            resposta = r["texto"]
            proposta = _tira_cercas(resposta)
            problemas = cerebro._problemas_estado(Path(f"{slug}.md"), (proposta + "\n").splitlines())
            if cerebro._segredo(proposta + "\n"):
                problemas.append(cerebro._segredo(proposta + "\n"))
            if not problemas:
                break
            erro = "; ".join(problemas)
        else:
            raise ValueError("a proposta de estado foi recusada duas vezes (nada foi gravado): " + erro[:200])
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    diff = "\n".join(difflib.unified_diff(atual.split("\n"), proposta.split("\n"), "estado atual", "estado proposto", lineterm="", n=2))
    return {"projeto": slug, "atual": atual, "proposta": proposta, "diff": diff, "igual": atual.strip() == proposta.strip(),
            "conversas_usadas": [n for n, _ in itens], "tokens": uso, "modelo": modelo}


def aplicar_estado(base, projeto, texto):
    """Grava o estado que você aprovou (o salvar_estado valida o formato e guarda a versão anterior em estado/.anteriores)."""
    base = _base(base)
    destino = cerebro.salvar_estado(base, projeto, texto)
    cerebro.escrever_indice(base)
    return {"arquivo": f"estado/{destino.name}"}


# ---------- 4. índices por tema ----------

def refazer_indices(base=None):
    base = _base(base)
    destino, linhas, n = cerebro.escrever_indice(base)
    pasta = base / "indices"
    existentes = sorted(p.stem for p in pasta.glob("*.md")) if pasta.is_dir() else []
    ativos = n > cerebro.INDICE_TEMA_MIN
    return {"arquivos": n, "limite": cerebro.INDICE_TEMA_MIN, "indices_por_projeto": ativos, "projetos": existentes if ativos else [],
            "mensagem": (f"{len(existentes)} índices em cerebro/indices/" if ativos
                         else f"o cérebro tem {n} arquivos: os índices por projeto só são gerados com mais de {cerebro.INDICE_TEMA_MIN}")}


# ---------- 5. backup ----------

AVISO_PESSOAL = ("O cérebro pode conter dados pessoais (conversas, decisões, nomes, trechos de código e contas). Guarde este .zip só em lugar "
                 "seu e NUNCA o envie para um repositório público (GitHub etc.).")


def _dentro_de_repositorio_git(pasta):
    p = Path(pasta).resolve()
    return any((q / ".git").exists() for q in [p, *p.parents])


def exportar(base, destino, agora=None):
    """Gera cerebro-AAAA-MM-DD.zip em `destino` (nunca sobrescreve: acrescenta -2, -3...). Leva conversas, estado, arquivo-morto, indices,
    INDICE.md e sinonimos.json; NÃO leva o .log (suas buscas) nem a tools/ (código). Devolve o caminho, os totais e os avisos."""
    base = _base(base).resolve()
    destino = Path(destino)
    if not destino.is_dir():
        raise ValueError(f"a pasta de destino não existe: {destino}")
    if base in [destino.resolve(), *destino.resolve().parents]:
        raise ValueError("escolha uma pasta FORA do cérebro (o .zip entraria nele mesmo)")
    agora = agora or datetime.datetime.now()
    dia = agora.date().isoformat()
    alvo, i = destino / f"cerebro-{dia}.zip", 2
    while alvo.exists():
        alvo, i = destino / f"cerebro-{dia}-{i}.zip", i + 1
    pastas = ("conversas", "estado", MORTO, "indices")
    topo = f"cerebro-{dia}"
    tmp = alvo.with_name(alvo.name + ".tmp")
    n = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for nome in pastas:
            raiz = base / nome
            for caminho in sorted(raiz.rglob("*")) if raiz.is_dir() else []:
                if caminho.is_file():
                    z.write(caminho, f"{topo}/{caminho.relative_to(base).as_posix()}")
                    n += 1
        for nome in ("INDICE.md", cerebro.ARQ_SINONIMOS):
            if (base / nome).is_file():
                z.write(base / nome, f"{topo}/{nome}")
                n += 1
        z.writestr(f"{topo}/LEIA-ME.txt", f"Cérebro exportado em {agora.isoformat(timespec='seconds')} ({n} arquivos).\n\n{AVISO_PESSOAL}\n\n"
                   "Para restaurar: copie as pastas conversas/, estado/, arquivo-morto/, indices/ e os arquivos INDICE.md e sinonimos.json para a pasta do cérebro.\n")
    os.replace(tmp, alvo)
    return {"zip": str(alvo), "arquivos": n, "bytes": alvo.stat().st_size, "aviso": AVISO_PESSOAL, "dentro_de_git": _dentro_de_repositorio_git(destino)}


# ---------- linha de comando ----------

def _imprimir(args, dados, linhas):
    if getattr(args, "json", False):
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for l in linhas:
            print(l)


def _entrada_json():
    bruto = getattr(sys.stdin, "buffer", None)
    texto = bruto.read().decode("utf-8-sig", errors="replace") if bruto else sys.stdin.read()
    try:
        d = json.loads(texto or "{}")
    except ValueError:
        raise ValueError("entrada não é um JSON válido")
    return d if isinstance(d, dict) else {}


def _cmd_diagnostico(args):
    d = diagnostico()
    t, n, s, e = d["tamanho"], d["nunca_consultados"], d["similares"], d["estados_velhos"]
    linhas = [f"cérebro: {t['arquivos']} arquivos, {t['mb']} MB", f"nunca consultados há mais de {n['dias_limite']} dias: {n['total']}" + (f" ({n['aviso']})" if n["aviso"] else ""),
              f"palavras-chave quase iguais: {len(d['palavras_quase_iguais'])} grupos ({len(d['sinonimos_sugeridos'])} sinônimos sugeridos)",
              f"arquivos parecidos: {s['total_grupos']} grupos ({s['total_arquivos']} arquivos)", f"estados com mais de {e['dias_limite']} dias: {e['total']}"]
    _imprimir(args, d, linhas)
    return 0


def _cmd_sinonimos_aprovar(args):
    r = aprovar_sinonimos(None, _entrada_json().get("pares"))
    _imprimir(args, r, [f"aprovados: {', '.join(r['adicionados']) or 'nenhum'}"] + r["ignorados"])
    return 0


def _cmd_sinonimos_remover(args):
    r = remover_sinonimo(None, args.apelido)
    _imprimir(args, r, [f"removido: {r['removido']}"])
    return 0


def _cmd_estimar_consolidar(args):
    grupos = grupos_parecidos(coletar(_base()))
    e, s, c = estimar_grupos(grupos)
    _imprimir(args, {"grupos": len(grupos), "tokens_entrada": e, "tokens_saida": s, "chamadas": c}, [f"{c} chamadas, ~{e} tokens de entrada e ~{s} de saída"])
    return 0


def _cmd_consolidar(args):
    r = consolidar_grupo(None, args.grupo, args.modelo, args.timeout)
    _imprimir(args, r, [f"{r['consolidado']} (de {len(r['originais'])} arquivos, movidos para {MORTO}/)"])
    return 0


def _cmd_estimar_estado(args):
    r = estimar_estado(None, args.projeto, dias=args.dias)
    _imprimir(args, r, [f"{r['conversas_antigas']} conversas antigas, ~{r['tokens_entrada']} tokens de entrada e ~{r['tokens_saida']} de saída"])
    return 0


def _cmd_propor_estado(args):
    r = propor_estado(None, args.projeto, dias=args.dias, modelo=args.modelo, timeout=args.timeout)
    _imprimir(args, r, [r["diff"] or "(sem mudanças)"])
    return 0


def _cmd_aplicar_estado(args):
    r = aplicar_estado(None, args.projeto, str(_entrada_json().get("texto") or ""))
    _imprimir(args, r, [f"gravado: {r['arquivo']}"])
    return 0


def _cmd_indices(args):
    r = refazer_indices()
    _imprimir(args, r, [r["mensagem"]])
    return 0


def _cmd_exportar(args):
    r = exportar(None, args.destino)
    _imprimir(args, r, [f"{r['zip']} ({r['arquivos']} arquivos)", r["aviso"]] + (["ATENÇÃO: a pasta de destino está dentro de um repositório git."] if r["dentro_de_git"] else []))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="manutencao.py", description="Manutenção do cérebro (só por clique seu; consolidar e propor-estado usam IA)")
    sub = ap.add_subparsers(dest="comando", required=True)

    def novo(nome, func, **kw):
        p = sub.add_parser(nome, **kw)
        p.add_argument("--json", action="store_true")
        p.set_defaults(func=func)
        return p
    novo("diagnostico", _cmd_diagnostico)
    novo("sinonimos-aprovar", _cmd_sinonimos_aprovar)
    novo("sinonimos-remover", _cmd_sinonimos_remover).add_argument("apelido")
    novo("estimar-consolidar", _cmd_estimar_consolidar)
    p = novo("consolidar", _cmd_consolidar)
    p.add_argument("grupo")
    p.add_argument("--modelo", default=importar.MODELO_PADRAO)
    p.add_argument("--timeout", type=int, default=importar.TIMEOUT_PADRAO)
    p = novo("estimar-estado", _cmd_estimar_estado)
    p.add_argument("projeto")
    p.add_argument("--dias", type=int, default=DIAS_CONVERSAS_ANTIGAS)
    p = novo("propor-estado", _cmd_propor_estado)
    p.add_argument("projeto")
    p.add_argument("--dias", type=int, default=DIAS_CONVERSAS_ANTIGAS)
    p.add_argument("--modelo", default=importar.MODELO_PADRAO)
    p.add_argument("--timeout", type=int, default=importar.TIMEOUT_PADRAO)
    novo("aplicar-estado", _cmd_aplicar_estado).add_argument("projeto")
    novo("indices", _cmd_indices)
    novo("exportar", _cmd_exportar).add_argument("--destino", required=True)
    args = ap.parse_args(argv)
    if getattr(args, "modelo", None) and not re.match(r"^[A-Za-z0-9._\-\[\]]+$", args.modelo):
        print("erro: --modelo inválido", file=sys.stderr)
        return 2
    try:
        return args.func(args)
    except (OSError, ValueError, zipfile.BadZipFile) as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
