#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ferramenta do cérebro: localiza a pasta, lê cabeçalhos, valida e gera o índice.

Só biblioteca padrão. As funções abaixo podem ser importadas (pelo widget, por exemplo);
a linha de comando é só uma camada fina por cima delas.

  cerebro.py config [--definir CAMINHO]
  cerebro.py validar [--corrigir]
  cerebro.py indice
  cerebro.py titulos TERMOS [--projeto X] [--limite 8]      nível 1: só nomes
  cerebro.py cabecalho TERMOS [--arquivos A B] [--limite 5] nível 2: 2 primeiras linhas
  cerebro.py ler ARQUIVO... [--max 3]                       nível 3: arquivo inteiro
  cerebro.py buscar TERMOS [--projeto X]                    estado + 1 + 2, sugere o que abrir
  cerebro.py salvar --titulo T --palavras a,b --origem O --projeto P [--data AAAA-MM-DD] [--estado]  < corpo
  cerebro.py painel [--projeto P]       projetos, estatísticas e resumo do estado (aba do widget)
  (todos aceitam --json)
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

PASTAS = ("conversas", "estado")  # as duas pastas que o validador percorre
SECOES_ESTADO = ("Objetivo", "Stack", "Decisões", "Estado atual", "Próximos passos", "Armadilhas")
LIMITE_PALAVRAS = {"conversas": 150, "estado": 300}
MIN_CHAVES, MAX_CHAVES = 3, 10
LIMITE_LINHAS_INDICE = 200  # acima disso o índice também agrupa por mês

BOM = b"\xef\xbb\xbf"
RE_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_NOME_CONVERSA = re.compile(r"^(\d{4}-\d{2}-\d{2})_[a-z0-9]+(-[a-z0-9]+)*\.md$")
RE_NOME_ESTADO = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.md$")
RE_PREFIXO_DATA = re.compile(r"^(\d{4}-\d{2}-\d{2})")

# Busca
LIMITE_TITULOS, LIMITE_CABECALHO, LIMITE_BUSCAR = 8, 5, 5
MAX_LER = 3
CANDIDATOS_CABECALHO = 15  # quantos arquivos o "buscar" confere no cabeçalho
PONTOS_SUFICIENTES = 4     # com isso nos títulos, o "buscar" nem abre os cabeçalhos


# ---------- Localização do cérebro ----------

def arquivo_config():
    """~/.cerebro.json (CEREBRO_CONFIG troca o caminho; serve para os testes)."""
    return Path(os.environ.get("CEREBRO_CONFIG") or Path.home() / ".cerebro.json")


def ler_config():
    try:
        dados = json.loads(arquivo_config().read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return dados if isinstance(dados, dict) else {}


def descobrir_cerebro():
    """Devolve (pasta, origem). Ordem: CEREBRO_DIR, ~/.cerebro.json, pasta pai de tools/."""
    env = os.environ.get("CEREBRO_DIR", "").strip()
    if env:
        return Path(env).expanduser(), "env"
    guardado = ler_config().get("cerebro_dir")
    if isinstance(guardado, str) and guardado.strip():
        return Path(guardado).expanduser(), "config"
    return Path(__file__).resolve().parent.parent, "padrao"


class CerebroNaoEncontrado(FileNotFoundError):
    """A pasta do cérebro (CEREBRO_DIR ou ~/.cerebro.json) não existe. A linha de comando sai com 3."""


def localizar_cerebro():
    pasta, _ = descobrir_cerebro()
    if not pasta.is_dir():
        raise CerebroNaoEncontrado(f"pasta do cérebro não existe: {pasta}")
    return pasta


def definir_cerebro(caminho):
    """Grava cerebro_dir em ~/.cerebro.json, mantendo as outras chaves."""
    pasta = Path(caminho).expanduser().resolve()
    if not pasta.is_dir():
        raise FileNotFoundError(f"pasta não existe: {pasta}")
    dados = ler_config()
    dados["cerebro_dir"] = str(pasta)
    arquivo_config().write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return pasta


# ---------- Texto ----------

def normalizar(texto):
    """Sem acento, minúsculas, separadores viram espaço: 'Cérebro' == 'cerebro' == 'CEREBRO'."""
    if texto is None:
        return ""
    base = unicodedata.normalize("NFKD", str(texto))
    base = "".join(c for c in base if not unicodedata.combining(c)).lower()
    base = re.sub(r"[-_./\\|,;:]+", " ", base)
    return " ".join(base.split())


def _slug(texto):
    return re.sub(r"[^a-z0-9]+", "-", normalizar(texto)).strip("-")


def contar_palavras(linhas):
    """Conta só pedaços com letra ou número (um '-' de lista não é palavra)."""
    return sum(1 for linha in linhas for p in linha.split() if re.search(r"\w", p))


def _data_valida(texto):
    if not texto or not RE_DATA.match(texto):
        return False
    try:
        datetime.date.fromisoformat(texto)
    except ValueError:
        return False
    return True


# ---------- Cabeçalho ----------

def _parse_cabecalho(linha1, linha2):
    """Campos ausentes viram None (diferente de vazio), para o validador saber o que falta."""
    chave, sep, valor = linha1.partition(":")
    chaves = None
    if sep and normalizar(chave) == "palavras chave":
        chaves = [p.strip() for p in valor.split(",") if p.strip()]
    campos = {}
    for parte in linha2.split("|"):
        c, s, v = parte.partition(":")
        if s:
            campos[normalizar(c)] = v.strip()
    return {
        "palavras_chave": chaves,
        "data": campos.get("data"),
        "origem": campos.get("origem"),
        "projeto": campos.get("projeto"),
    }


def ler_cabecalho(arquivo):
    """Usa SÓ as 2 primeiras linhas (UTF-8, aceita BOM e quebras do Windows).
    Lê apenas os primeiros 4 KB, nunca o arquivo todo. Usa os.open em vez de open(): com 1000
    arquivos é ~40% mais rápido (44 ms contra 73 ms medidos)."""
    fd = os.open(arquivo, os.O_RDONLY | getattr(os, "O_BINARY", 0))
    try:
        bloco = os.read(fd, 4096)
    finally:
        os.close(fd)
    linhas = bloco.decode("utf-8-sig", errors="replace").splitlines()
    return _parse_cabecalho(linhas[0] if linhas else "", linhas[1] if len(linhas) > 1 else "")


# ---------- Validação ----------

def _listar(pasta):
    if not pasta.is_dir():
        return []
    return sorted(p for p in pasta.iterdir() if p.is_file() and p.suffix.lower() == ".md")


def _problemas_conversa(arq, linhas):
    problemas = []
    m = RE_NOME_CONVERSA.match(arq.name)
    if not m:
        problemas.append("nome fora do padrão AAAA-MM-DD_palavras-com-hifen.md")
    elif not _data_valida(m.group(1)):
        problemas.append("data do nome inválida")

    cab = _parse_cabecalho(linhas[0] if linhas else "", linhas[1] if len(linhas) > 1 else "")
    chaves = cab["palavras_chave"]
    if chaves is None:
        problemas.append("linha 1 sem 'palavras-chave:'")
    elif not MIN_CHAVES <= len(chaves) <= MAX_CHAVES:
        problemas.append(f"{len(chaves)} palavra{'s' if len(chaves) != 1 else ''}-chave (mínimo {MIN_CHAVES}, máximo {MAX_CHAVES})")
    if not _data_valida(cab["data"]):
        problemas.append("linha 2 sem data válida")
    if not cab["origem"]:
        problemas.append("linha 2 sem origem")
    if not cab["projeto"]:
        problemas.append("linha 2 sem projeto")
    if len(linhas) > 2 and linhas[2].strip():
        problemas.append("linha 3 deveria estar vazia")

    palavras = contar_palavras(linhas[2:])
    if palavras > LIMITE_PALAVRAS["conversas"]:
        problemas.append(f"corpo com {palavras} palavras (máximo {LIMITE_PALAVRAS['conversas']})")
    return problemas


def _problemas_estado(arq, linhas):
    problemas = []
    if not RE_NOME_ESTADO.match(arq.name):
        problemas.append("nome fora do padrão projeto.md (minúsculas, sem acento, hífens)")
    titulos = set()
    for linha in linhas:
        m = re.match(r"\s*#+\s*(.+?)\s*$", linha)
        if m:
            titulos.add(normalizar(m.group(1)))
    faltam = [s for s in SECOES_ESTADO if normalizar(s) not in titulos]
    if faltam:
        problemas.append("faltam seções: " + ", ".join(faltam))
    palavras = contar_palavras(linhas)
    if palavras > LIMITE_PALAVRAS["estado"]:
        problemas.append(f"{palavras} palavras (máximo {LIMITE_PALAVRAS['estado']})")
    return problemas


def _problemas_arquivo(pasta, arq):
    dados = arq.read_bytes()
    try:
        texto = dados.decode("utf-8-sig")
    except UnicodeDecodeError:
        return ["arquivo não está em UTF-8"]
    linhas = texto.splitlines()
    problemas = []
    if dados.startswith(BOM):
        problemas.append("BOM no início do arquivo")
    if any(l != l.rstrip(" \t") for l in linhas):
        problemas.append("espaços sobrando no fim de linha")
    if pasta == "conversas":
        problemas += _problemas_conversa(arq, linhas)
    else:
        problemas += _problemas_estado(arq, linhas)
    return problemas


def validar(base):
    """Devolve uma lista de (arquivo, problema), um item por problema."""
    base = Path(base)
    achados = []
    for pasta in PASTAS:
        for arq in _listar(base / pasta):
            for problema in _problemas_arquivo(pasta, arq):
                achados.append((f"{pasta}/{arq.name}", problema))
    return achados


# ---------- Correção (só o que é seguro) ----------

def _nome_corrigido(pasta, nome):
    """Nome no padrão, ou None se não der para consertar com segurança."""
    p = Path(nome)
    if p.suffix.lower() != ".md":
        return None
    if pasta == "conversas":
        m = re.match(r"^(\d{4}-\d{2}-\d{2})[ _-](.+)$", p.stem)
        if not m:
            return None
        slug = _slug(m.group(2))
        candidato = f"{m.group(1)}_{slug}.md"
        ok = slug and RE_NOME_CONVERSA.match(candidato) and _data_valida(m.group(1))
    else:
        candidato = _slug(p.stem) + ".md"
        ok = RE_NOME_ESTADO.match(candidato)
    return candidato if ok else None


def corrigir(base):
    """Tira BOM e espaços do fim das linhas e arruma o nome (acentos, espaços, maiúsculas).
    Nunca mexe no conteúdo das linhas nem sobrescreve outro arquivo.
    Devolve uma lista de (arquivo, o que foi feito)."""
    base = Path(base)
    feitos = []
    for pasta in PASTAS:
        for arq in _listar(base / pasta):
            rel = f"{pasta}/{arq.name}"
            dados = novo = arq.read_bytes()
            if novo.startswith(BOM):
                novo = novo[len(BOM):]
                feitos.append((rel, "BOM removido"))
            sem_espacos = re.sub(rb"[ \t]+(?=\r?\n|\Z)", b"", novo)
            if sem_espacos != novo:
                novo = sem_espacos
                feitos.append((rel, "espaços do fim das linhas removidos"))
            if novo != dados:
                arq.write_bytes(novo)
            nome = _nome_corrigido(pasta, arq.name)
            if nome and nome != arq.name:
                destino = arq.with_name(nome)
                if not destino.exists() or destino.samefile(arq):
                    arq.rename(destino)
                    feitos.append((rel, f"renomeado para {nome}"))
    return feitos


# ---------- Índice ----------

def _chave_projeto(projeto):
    return normalizar(projeto).replace(" ", "-") or "sem-projeto"


def _coletar(base):
    """Uma entrada por arquivo: projeto, mês e a linha que vai para o índice."""
    entradas = []
    for arq in _listar(base / "conversas"):
        cab = ler_cabecalho(arq)
        chaves = ", ".join(cab["palavras_chave"] or [])
        m = re.match(r"^(\d{4}-\d{2})", arq.name) or re.match(r"^(\d{4}-\d{2})", cab["data"] or "")
        entradas.append({
            "projeto": _chave_projeto(cab["projeto"]),
            "mes": m.group(1) if m else "sem-data",
            "linha": f"{arq.name} — {chaves}" if chaves else arq.name,
        })
    for arq in _listar(base / "estado"):
        entradas.append({"projeto": _chave_projeto(arq.stem), "mes": None, "linha": f"estado/{arq.name}"})
    return entradas


def gerar_indice(base, entradas=None):
    """Devolve (texto, número de arquivos). Agrupa por projeto; passando de 200 linhas, por mês também."""
    entradas = _coletar(Path(base)) if entradas is None else entradas
    projetos = {}
    for e in entradas:
        projetos.setdefault(e["projeto"], []).append(e)
    # 1 título por projeto + 1 linha por arquivo
    por_mes = len(projetos) + len(entradas) > LIMITE_LINHAS_INDICE

    linhas = []
    for projeto in sorted(projetos):
        linhas.append(f"## {projeto}")
        itens = sorted(projetos[projeto], key=lambda e: e["linha"])
        linhas += [e["linha"] for e in itens if e["mes"] is None]  # o estado vem primeiro
        conversas = [e for e in itens if e["mes"] is not None]
        mes_atual = None
        for e in conversas:
            if por_mes and e["mes"] != mes_atual:
                mes_atual = e["mes"]
                linhas.append(f"### {mes_atual}")
            linhas.append(e["linha"])
    texto = "\n".join(linhas) + "\n" if linhas else ""
    return texto, len(entradas)


def escrever_indice(base):
    """Grava cerebro/INDICE.md e, com mais de INDICE_TEMA_MIN arquivos, os índices por projeto (indices/{projeto}.md).
    Devolve (caminho, linhas, arquivos)."""
    entradas = _coletar(Path(base))
    texto, n = gerar_indice(base, entradas)
    destino = Path(base) / "INDICE.md"
    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto)
    if n > INDICE_TEMA_MIN:
        escrever_indices_tema(base, entradas)
    return destino, texto.count("\n"), n


# ---------- Busca em 3 níveis: títulos -> cabeçalho -> arquivo inteiro ----------
# Cada nível só deve rodar se o anterior não bastar; as saídas são curtas de propósito.

def _rel(pasta, nome):
    """Como o arquivo aparece nas saídas: conversa só pelo nome, estado com 'estado/'."""
    return nome if pasta == "conversas" else f"{pasta}/{nome}"


def _escanear(base):
    """Lista os arquivos só pelos nomes (os.scandir), sem abrir nenhum.
    'recencia' é a data do nome; o estado não tem data no nome e usa a data de modificação."""
    achados = []
    for pasta in PASTAS:
        try:
            with os.scandir(os.path.join(base, pasta)) as it:
                for e in it:
                    if not e.name.lower().endswith(".md") or not e.is_file():
                        continue
                    m = RE_PREFIXO_DATA.match(e.name)
                    rec = m.group(1) if m else time.strftime("%Y-%m-%d", time.localtime(e.stat().st_mtime))
                    achados.append({"pasta": pasta, "nome": e.name, "arquivo": _rel(pasta, e.name), "recencia": rec})
        except OSError:
            continue
    return achados


def _palavras_do_nome(nome):
    return re.findall(r"[a-z0-9]+", normalizar(os.path.splitext(nome)[0]))


def _termos(brutos, quebrar):
    """Termos normalizados e sem repetição. quebrar=True separa 'claude-code' em 'claude' e 'code' e ignora partículas
    ('banco-de-dados' vira 'banco' e 'dados': o 'de' só daria pontos a qualquer nome que o tenha)."""
    termos = []
    for bruto in brutos:
        n = normalizar(bruto)
        for t in (re.findall(r"[a-z0-9]+", n) if quebrar else [n]):
            if t and t not in termos and not (quebrar and t in PARTICULAS):
                termos.append(t)
    return termos


# ---------- Sinônimos (cerebro/sinonimos.json) e índice por projeto (cerebro/indices/) ----------

ARQ_SINONIMOS = "sinonimos.json"
INDICE_TEMA_MIN = 100  # com mais arquivos que isso, escrever_indice também grava indices/{projeto}.md
PARTICULAS = frozenset({"de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "para", "com"})


def ler_sinonimos(base):
    """{apelido: termo-padrão}, os dois em forma de slug ('bd': 'banco-de-dados'). Arquivo ausente ou quebrado = {} (a busca segue
    sem expandir). Chaves iniciadas por '_' (comentários) e entradas inválidas são ignoradas."""
    try:
        with open(Path(base) / ARQ_SINONIMOS, "rb") as f:
            dados = json.loads(f.read().decode("utf-8-sig"))
    except (OSError, ValueError):
        return {}
    if not isinstance(dados, dict):
        return {}
    saida = {}
    for apelido, padrao in dados.items():
        if isinstance(apelido, str) and isinstance(padrao, str) and not apelido.startswith("_"):
            a, p = _slug(apelido), _slug(padrao)
            if a and p and a != p:
                saida[a] = p
    return saida


def expandir_termos(base, brutos):
    """(termos + os sinônimos deles, {termo digitado: [sinônimos acrescentados]}). Vale nos dois sentidos: pesquisar 'bd' também
    pesquisa 'banco-de-dados' e pesquisar 'banco de dados' também pesquisa 'bd'. Sem sinonimos.json, devolve os termos como vieram."""
    mapa = ler_sinonimos(base)
    if not mapa:
        return list(brutos), {}
    pai = {}

    def raiz(x):
        while pai.setdefault(x, x) != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x
    for apelido, padrao in mapa.items():
        pai[raiz(apelido)] = raiz(padrao)
    grupos = {}
    for x in list(pai):
        grupos.setdefault(raiz(x), set()).add(x)
    saida, acrescentados, ja = list(brutos), {}, {_slug(t) for t in brutos}
    for t in brutos:
        s = _slug(t)
        if s in pai:
            extras = sorted(m for m in grupos[raiz(s)] if m not in ja)
            if extras:
                acrescentados[t] = extras
                saida += extras
                ja.update(extras)
    return saida, acrescentados


def _entradas_do_indice(texto, base):
    entradas = []
    for linha in texto.splitlines():
        if not linha.strip() or linha.startswith("#"):
            continue
        rel, _, chaves = linha.partition(" — ")
        pasta, nome = ("estado", rel[len("estado/"):]) if rel.startswith("estado/") else ("conversas", rel)
        m = RE_PREFIXO_DATA.match(nome)
        try:
            rec = m.group(1) if m else _data_modificacao(os.path.join(base, pasta, nome))
        except OSError:
            continue  # o arquivo saiu do lugar: o índice está velho
        entradas.append({"pasta": pasta, "nome": nome, "arquivo": _rel(pasta, nome), "recencia": rec,
                         "palavras_chave": [c.strip() for c in chaves.split(",") if c.strip()]})
    return entradas


def indice_do_projeto(base, projeto):
    """Entradas de cerebro/indices/{projeto}.md, ou None se não existe ou está VELHO (alguma das pastas conversas/estado mudou depois
    dele: arquivo novo, movido ou removido). Nesse caso a busca volta a varrer as pastas."""
    base = Path(base)
    caminho = base / "indices" / f"{_slug(projeto or '')}.md"
    try:
        feito = caminho.stat().st_mtime_ns
        if any(os.stat(base / p).st_mtime_ns > feito for p in PASTAS):
            return None
        return _entradas_do_indice(caminho.read_text(encoding="utf-8-sig"), base)
    except OSError:
        return None


def escrever_indices_tema(base, entradas):
    """cerebro/indices/{projeto}.md, um por projeto: o estado e uma linha por conversa (nome — palavras-chave). Devolve quantos gravou."""
    pasta = Path(base) / "indices"
    pasta.mkdir(exist_ok=True)
    por_projeto = {}
    for e in entradas:
        por_projeto.setdefault(_slug(e["projeto"]) or "sem-projeto", []).append(e)
    hoje = datetime.date.today().isoformat()
    for projeto, itens in por_projeto.items():
        itens = sorted(itens, key=lambda e: e["linha"])
        linhas = [e["linha"] for e in itens if e["mes"] is None] + [e["linha"] for e in itens if e["mes"] is not None]
        with open(pasta / f"{projeto}.md", "w", encoding="utf-8", newline="\n") as f:
            f.write(f"# indice de {projeto}: {len(itens)} arquivos ({hoje})\n" + "\n".join(linhas) + "\n")
    return len(por_projeto)


def _ordenar(itens):
    """Mais pontos primeiro; empate: mais recente; empate: ordem alfabética (sorts estáveis)."""
    itens.sort(key=lambda i: i["nome"])
    itens.sort(key=lambda i: i["recencia"], reverse=True)
    itens.sort(key=lambda i: i["pontos"], reverse=True)


def _pontuar_indice(entradas, ts):
    """Pontua as entradas de um índice de projeto: o nome (igual a uma palavra = 2, prefixo de 4+ letras = 1) e as palavras-chave que o
    índice já traz (+2 por termo igual a uma palavra de alguma delas). Não abre arquivo nenhum. Cada item leva via='indice'."""
    itens = []
    for e in entradas:
        palavras = _palavras_do_nome(e["nome"])
        chaves = {w for c in e["palavras_chave"] for w in re.findall(r"[a-z0-9]+", normalizar(c))}
        pontos = 0
        for t in ts:
            if t in palavras:
                pontos += 2
            elif len(t) >= 4 and any(p.startswith(t) for p in palavras):
                pontos += 1
            if t in chaves:
                pontos += 2
        if pontos:
            itens.append({"pasta": e["pasta"], "nome": e["nome"], "arquivo": e["arquivo"], "recencia": e["recencia"], "pontos": pontos, "via": "indice"})
    _ordenar(itens)
    return itens


def busca_titulos(base, termos, projeto=None, limite=LIMITE_TITULOS, todos=False):
    """NÍVEL 1. Termo igual a uma palavra do nome = 2; prefixo (4+ letras) de uma palavra = 1.
    +1 se o nome também traz o projeto (só vale para quem já pontuou; o nome é tudo que se lê aqui).
    todos=True devolve também quem não pontuou (usado pelo 'buscar')."""
    ts = _termos(termos, True)
    proj = _termos([projeto], True) if projeto else []
    if projeto and not todos:  # com o projeto informado, olha PRIMEIRO o índice dele (se existir e estiver em dia)
        entradas = indice_do_projeto(base, projeto)
        if entradas is not None:
            itens = _pontuar_indice(entradas, ts)
            if itens:
                return itens[:limite] if limite else itens
    itens = []
    for e in _escanear(base):
        palavras = _palavras_do_nome(e["nome"])
        pontos = 0
        for t in ts:
            if t in palavras:
                pontos += 2
            elif len(t) >= 4 and any(p.startswith(t) for p in palavras):
                pontos += 1
        if pontos and proj and all(w in palavras for w in proj):
            pontos += 1
        if pontos or todos:
            itens.append({**e, "pontos": pontos})
    _ordenar(itens)
    return itens[:limite] if limite else itens


def _pontuar_cabecalhos(base, termos, entradas):
    """Lê as 2 primeiras linhas de cada conversa (o estado não tem esse cabeçalho: só o nome conta)."""
    ts = _termos(termos, False)
    saida = []
    for e in entradas:
        chaves = []
        if e["pasta"] == "conversas":
            try:
                chaves = ler_cabecalho(os.path.join(base, e["pasta"], e["nome"]))["palavras_chave"] or []
            except OSError:
                pass
        norm = [normalizar(c) for c in chaves]
        nome = " ".join(_palavras_do_nome(e["nome"]))
        pontos = 0
        for t in ts:
            if t in norm:
                pontos += 3
            elif len(t) >= 3 and any(t in k for k in norm):
                pontos += 1
            if len(t) >= 3 and t in nome:
                pontos += 1
        if pontos:
            saida.append({**e, "pontos": pontos, "palavras_chave": chaves})
    _ordenar(saida)
    return saida


def _nome_pedido(texto):
    """'estado/x.md', 'C:\\...\\x.md' ou 'x' -> (pasta ou None, 'x.md')."""
    partes = texto.replace("\\", "/").strip("/").split("/")
    nome = partes[-1] if partes[-1].lower().endswith(".md") else partes[-1] + ".md"
    pasta = partes[-2] if len(partes) > 1 and partes[-2] in PASTAS else None
    return pasta, nome


def busca_cabecalho(base, termos, arquivos=None, limite=LIMITE_CABECALHO):
    """NÍVEL 2. Palavra-chave igual ao termo = 3; termo dentro de uma palavra-chave = 1; termo no nome = 1.
    Sem 'arquivos', avalia todos (só as 2 primeiras linhas de cada). Devolve (resultados, não encontrados)."""
    entradas = _escanear(base)
    faltando = []
    if arquivos:
        pedidos = [_nome_pedido(a) for a in arquivos]
        achados = [e for e in entradas
                   if any(e["nome"].lower() == n.lower() and p in (None, e["pasta"]) for p, n in pedidos)]
        faltando = [a for a, (p, n) in zip(arquivos, pedidos)
                    if not any(e["nome"].lower() == n.lower() and p in (None, e["pasta"]) for e in achados)]
        entradas = achados
    resultados = _pontuar_cabecalhos(base, termos, entradas)
    return (resultados[:limite] if limite else resultados), faltando


def _localizar_arquivo(base, pedido):
    pasta, nome = _nome_pedido(pedido)
    for p in ([pasta] if pasta else PASTAS):
        caminho = os.path.join(base, p, nome)
        if os.path.isfile(caminho):
            return p, nome, caminho
    return None


def ler_arquivos(base, pedidos, maximo=MAX_LER):
    """NÍVEL 3. Conteúdo completo de até 'maximo' arquivos (nome com ou sem caminho).
    Devolve ([(arquivo, texto)], não encontrados)."""
    if len(pedidos) > maximo:
        raise ValueError(f"máximo {maximo} arquivos por vez (recebi {len(pedidos)})")
    lidos, faltando = [], []
    for pedido in pedidos:
        achado = _localizar_arquivo(base, pedido)
        if not achado:
            faltando.append(pedido)
            continue
        pasta, nome, caminho = achado
        with open(caminho, "rb") as f:
            texto = f.read().decode("utf-8-sig", errors="replace")
        lidos.append((_rel(pasta, nome), "\n".join(texto.splitlines())))
    return lidos, faltando


def _duas_linhas(caminho, largura=160):
    with open(caminho, "rb") as f:
        bloco = f.read(4096)
    return [l[:largura] for l in bloco.decode("utf-8-sig", errors="replace").splitlines()[:2]]


def buscar(base, termos, projeto=None, limite=LIMITE_BUSCAR, com_palavras=False):
    """Estado do projeto (só 2 linhas) -> títulos -> se faltar, cabeçalho dos 15 melhores.
    Não abre arquivo nenhum por inteiro: só sugere o que abrir (até 3).
    com_palavras=True lê o cabeçalho (2 linhas) dos candidatos finais que ainda não o tinham,
    para a tela mostrar as palavras-chave de todos."""
    dados = {"estado": None, "estado_linhas": [], "candidatos": [], "abrir": []}
    if projeto:
        rel = f"estado/{_slug(projeto)}.md"
        caminho = os.path.join(base, "estado", f"{_slug(projeto)}.md")
        if os.path.isfile(caminho):
            dados["estado"], dados["estado_linhas"] = rel, _duas_linhas(caminho)
    ranking = busca_titulos(base, termos, projeto, limite=None, todos=True)
    if ranking and ranking[0]["pontos"] >= PONTOS_SUFICIENTES:
        finais = [dict(e, palavras_chave=None) for e in ranking if e["pontos"] > 0][:limite]
    else:
        finais = _pontuar_cabecalhos(base, termos, ranking[:CANDIDATOS_CABECALHO])[:limite]
    if com_palavras:
        for e in finais:
            if e["palavras_chave"] is None and e["pasta"] == "conversas":
                try:
                    e["palavras_chave"] = ler_cabecalho(os.path.join(base, e["pasta"], e["nome"]))["palavras_chave"] or []
                except OSError:
                    e["palavras_chave"] = []
    dados["candidatos"] = finais
    dados["abrir"] = [e["arquivo"] for e in finais[:MAX_LER]]
    return dados


# ---------- Painel (o que a aba Cérebro do widget mostra) ----------

def _data_modificacao(caminho):
    return datetime.date.fromtimestamp(os.stat(caminho).st_mtime).isoformat()


def _projetos_do_json(base):
    """Lê o projetos.json: o da raiz do widget (a pasta pai do cérebro; PROJETOS_JSON troca o caminho) ou, se não
    houver, cerebro/projetos.json. Aceita lista de nomes, lista de objetos (o 'id' vale mais que o 'nome',
    pois é o que liga o projeto ao cérebro), {"projetos": [...]} ou {"nome": {...}}. Sem o arquivo: None."""
    candidatos = [os.environ.get("PROJETOS_JSON"), os.path.join(os.path.dirname(os.path.abspath(base)), "projetos.json"),
                  os.path.join(base, "projetos.json")]
    dados = None
    for caminho in filter(None, candidatos):
        try:
            with open(caminho, "r", encoding="utf-8-sig") as f:
                dados = json.load(f)
            break
        except (OSError, ValueError):
            continue
    if dados is None:
        return None
    if isinstance(dados, dict):
        dados = dados["projetos"] if isinstance(dados.get("projetos"), list) else list(dados)
    if not isinstance(dados, list):
        return None
    nomes = []
    for item in dados:
        if isinstance(item, dict):
            item = next((item[k] for k in ("id", "nome", "projeto", "name") if isinstance(item.get(k), str)), None)
        chave = _chave_projeto(item) if isinstance(item, str) else ""
        if chave and chave != "sem-projeto" and chave not in nomes:
            nomes.append(chave)
    return nomes or None


def listar_projetos(base):
    """Nomes de projeto para o seletor: do projetos.json se existir; senão, os campos 'projeto'
    dos cabeçalhos (2 linhas de cada conversa) e os nomes dos arquivos de estado.
    Devolve (lista, de onde veio)."""
    nomes = _projetos_do_json(base)
    if nomes:
        return nomes, "projetos.json"
    vistos = set()
    for e in _escanear(base):
        if e["pasta"] == "estado":
            vistos.add(_chave_projeto(os.path.splitext(e["nome"])[0]))
        else:
            try:
                projeto = ler_cabecalho(os.path.join(base, e["pasta"], e["nome"]))["projeto"]
            except OSError:
                continue
            if projeto:
                vistos.add(_chave_projeto(projeto))
    return sorted(vistos), "cabecalhos"


def estatisticas(base):
    """Total de arquivos, tamanho em KB e a data da última conversa salva (pelo nome do arquivo)."""
    total = conversas = estados = tamanho = 0
    ultima = None
    for pasta in PASTAS:
        try:
            with os.scandir(os.path.join(base, pasta)) as it:
                for e in it:
                    if not e.name.lower().endswith(".md") or not e.is_file():
                        continue
                    total += 1
                    tamanho += e.stat().st_size
                    if pasta == "estado":
                        estados += 1
                        continue
                    conversas += 1
                    m = RE_PREFIXO_DATA.match(e.name)
                    if m and (ultima is None or m.group(1) > ultima):
                        ultima = m.group(1)
        except OSError:
            continue
    return {"arquivos": total, "conversas": conversas, "estados": estados,
            "kb": round(tamanho / 1024, 1), "ultima_compactacao": ultima}


def info_estado(base, projeto):
    """Resumo do estado de um projeto: arquivo, data da última atualização e a 1ª linha do Objetivo."""
    slug = _slug(projeto or "")
    caminho = os.path.join(base, "estado", f"{slug}.md")
    if not slug or not os.path.isfile(caminho):
        return None
    with open(caminho, "rb") as f:
        linhas = f.read().decode("utf-8-sig", errors="replace").splitlines()
    objetivo, no_objetivo = "", False
    for linha in linhas:
        m = re.match(r"\s*#+\s*(.+?)\s*$", linha)
        if m:
            no_objetivo = normalizar(m.group(1)) == "objetivo"
        elif no_objetivo and linha.strip():
            objetivo = linha.strip()[:200]
            break
    return {"arquivo": f"estado/{slug}.md", "atualizado": _data_modificacao(caminho), "objetivo": objetivo}


def painel(base, projeto=None):
    """Tudo que a aba precisa ao abrir, numa chamada só (cada chamada é um processo Python)."""
    projetos, origem = listar_projetos(base)
    return {"dir": str(base), "projetos": projetos, "origem_projetos": origem,
            "estatisticas": estatisticas(base), "estado": info_estado(base, projeto) if projeto else None}


def registrar_consulta(base, comando, termos, resultados, caracteres, arquivos=None):
    """Uma linha por consulta em cerebro/.log/consultas.jsonl (a economia e a manutenção medem o cérebro com isso).
    'arquivos' = os arquivos que a consulta devolveu (até 20): é o que diz quais arquivos já foram consultados.
    Qualquer falha é ignorada em silêncio."""
    try:
        pasta = os.path.join(base, ".log")
        os.makedirs(pasta, exist_ok=True)
        linha = {
            "data": datetime.datetime.now().isoformat(timespec="seconds"),
            "comando": comando,
            "termos": list(termos),
            "resultados": resultados,
            "caracteres": caracteres,
        }
        if arquivos:
            linha["arquivos"] = [str(a) for a in arquivos[:20]]
        with open(os.path.join(pasta, "consultas.jsonl"), "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(linha, ensure_ascii=False, separators=(",", ":")) + "\n")
    except OSError:
        pass


# ---------- Salvar (compactação de conversas) ----------

MAX_ANTERIORES = 5  # versões antigas do estado guardadas em estado/.anteriores
# Rede de segurança: a skill já deve trocar isso por [removido]; aqui só se recusa a gravar
SEGREDOS = (
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), "chave de API"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "token do GitHub"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "chave da AWS"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "chave privada"),
    (re.compile(r"\b(senha|password|token|api[_-]?key)\s*[:=]\s*\S{6,}", re.I), "senha ou token"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "e-mail"),
)


def _limpar_corpo(corpo):
    """Quebras do Windows viram \\n e somem os espaços do fim das linhas (o que o --corrigir faria)."""
    linhas = corpo.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(l.rstrip() for l in linhas).strip("\n")


def _segredo(texto):
    for regex, oque in SEGREDOS:
        if regex.search(texto):
            return f"possível {oque} no texto: troque por [removido]"
    return None


def _recusar_se(problemas):
    if problemas:
        raise ValueError("recusado: " + "; ".join(problemas))


def _gravar(destino, texto):
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto)


def salvar_conversa(base, titulo, palavras, origem, projeto, corpo, hoje=None):
    """Cria conversas/AAAA-MM-DD_assunto.md (com -2, -3... se já existir). Recusa (ValueError)
    o que o 'validar' apontaria. Devolve o caminho salvo."""
    base = Path(base)
    hoje = hoje or datetime.date.today().isoformat()
    slug = _slug(titulo or "")
    n = len(slug.split("-")) if slug else 0
    problemas = [] if 3 <= n <= 6 else [f"título com {n} palavra{'s' if n != 1 else ''} (use de 3 a 6)"]
    chaves = [p.strip() for p in (palavras or "").split(",") if p.strip()]
    corpo = _limpar_corpo(corpo)
    if not corpo:
        problemas.append("corpo vazio (mande o resumo pela entrada padrão)")
    texto = (f"palavras-chave: {', '.join(chaves)}\n"
             f"data: {hoje} | origem: {(origem or '').strip()} | projeto: {_slug(projeto or '')}\n\n{corpo}\n")
    nome = f"{hoje}_{slug or 'x'}.md"  # 'x' só para o título ruim não gerar um 2º aviso sobre o nome
    problemas += _problemas_conversa(Path(nome), texto.splitlines())
    if _segredo(texto):
        problemas.append(_segredo(texto))
    _recusar_se(problemas)

    destino, i = base / "conversas" / nome, 2
    while destino.exists():
        destino, i = base / "conversas" / f"{hoje}_{slug}-{i}.md", i + 1
    _gravar(destino, texto)
    return destino


def _guardar_anterior(atual, projeto, hoje):
    """Copia o estado atual para estado/.anteriores/{projeto}-{data}.md e mantém só os 5 últimos."""
    pasta = atual.parent / ".anteriores"
    pasta.mkdir(exist_ok=True)
    copia, i = pasta / f"{projeto}-{hoje}.md", 2
    while copia.exists():
        copia, i = pasta / f"{projeto}-{hoje}-{i}.md", i + 1
    copia.write_bytes(atual.read_bytes())
    padrao = re.compile(rf"^{re.escape(projeto)}-\d{{4}}-\d{{2}}-\d{{2}}(-\d+)?\.md$")
    antigas = sorted((p for p in pasta.iterdir() if padrao.match(p.name)),
                     key=lambda p: (p.stat().st_mtime_ns, p.name))
    for velha in antigas[:-MAX_ANTERIORES]:
        velha.unlink()


def salvar_estado(base, projeto, corpo, hoje=None):
    """SOBRESCREVE estado/{projeto}.md (6 seções, máx. 300 palavras), guardando a versão anterior."""
    base = Path(base)
    hoje = hoje or datetime.date.today().isoformat()
    proj = _slug(projeto or "")
    corpo = _limpar_corpo(corpo)
    problemas = [] if proj else ["falta --projeto"]
    if not corpo:
        problemas.append("corpo vazio (mande o estado pela entrada padrão)")
    texto = corpo + "\n"
    problemas += _problemas_estado(Path(f"{proj or 'x'}.md"), texto.splitlines())
    if _segredo(texto):
        problemas.append(_segredo(texto))
    _recusar_se(problemas)

    destino = base / "estado" / f"{proj}.md"
    if destino.exists():
        _guardar_anterior(destino, proj, hoje)
    _gravar(destino, texto)
    return destino


# ---------- Linha de comando ----------

def _imprimir(args, dados, linhas):
    """--json imprime uma linha só; sem ele, uma linha de texto por item."""
    if args.json:
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for linha in linhas:
            print(linha)


def _cmd_config(args):
    if args.definir:
        pasta = definir_cerebro(args.definir)
        _imprimir(args, {"dir": str(pasta), "origem": "config"}, [f"gravado: {pasta}"])
        return 0
    pasta, origem = descobrir_cerebro()
    _imprimir(args, {"dir": str(pasta), "origem": origem}, [f"dir: {pasta}", f"origem: {origem}"])
    return 0


def _cmd_validar(args):
    base = localizar_cerebro()
    feitos = corrigir(base) if args.corrigir else []
    problemas = validar(base)
    linhas = [f"corrigido {a}: {o}" for a, o in feitos]
    linhas += [f"{a}: {p}" for a, p in problemas]
    if not linhas:
        linhas = ["ok"]
    dados = {
        "corrigidos": [{"arquivo": a, "o_que": o} for a, o in feitos],
        "problemas": [{"arquivo": a, "problema": p} for a, p in problemas],
    }
    _imprimir(args, dados, linhas)
    return 1 if problemas else 0


def _cmd_indice(args):
    base = localizar_cerebro()
    destino, n_linhas, n_arquivos = escrever_indice(base)
    _imprimir(
        args,
        {"arquivo": str(destino), "linhas": n_linhas, "arquivos": n_arquivos},
        [f"INDICE.md: {n_arquivos} arquivos, {n_linhas} linhas"],
    )
    return 0


def _saida_busca(args, base, termos, dados, linhas, resultados, arquivos=None, sinonimos=None):
    """Imprime e registra a consulta (o tamanho registrado é o do que foi impresso). 'termos' são os que VOCÊ digitou;
    'sinonimos' ({termo: [acrescentados]}) só aparece na saída quando a expansão do sinonimos.json mexeu na busca."""
    if sinonimos:
        dados = {**dados, "sinonimos": sinonimos}
        linhas = ["sinonimos: " + "; ".join(f"{t} -> {', '.join(e)}" for t, e in sinonimos.items())] + list(linhas)
    texto = json.dumps(dados, ensure_ascii=False, separators=(",", ":")) if args.json else "\n".join(linhas)
    print(texto)
    registrar_consulta(base, args.comando, termos, resultados, len(texto), arquivos)


def _linha_candidato(e):
    chaves = e.get("palavras_chave")
    return f"{e['pontos']} {e['arquivo']}" + (f" | {', '.join(chaves)}" if chaves else "")


def _publico(e):
    """Só o que interessa no JSON (sem pasta/nome/recência internos)."""
    saida = {"pontos": e["pontos"], "arquivo": e["arquivo"]}
    if e.get("palavras_chave") is not None:
        saida["palavras_chave"] = e["palavras_chave"]
    return saida


def _cmd_titulos(args):
    base = localizar_cerebro()
    termos, sinonimos = expandir_termos(base, args.termos)
    res = busca_titulos(base, termos, args.projeto, max(1, args.limite))
    linhas = [_linha_candidato(e) for e in res] or ["nenhum"]
    dados = {"resultados": [_publico(e) for e in res]}
    if res and res[0].get("via") == "indice":
        dados["indice"] = f"indices/{_slug(args.projeto)}.md"  # o índice do projeto respondeu: nenhuma pasta foi varrida
    _saida_busca(args, base, args.termos, dados, linhas, len(res), [e["arquivo"] for e in res], sinonimos)
    return 0


def _cmd_cabecalho(args):
    base = localizar_cerebro()
    termos, sinonimos = expandir_termos(base, args.termos)
    res, faltando = busca_cabecalho(base, termos, args.arquivos, max(1, args.limite))
    linhas = [f"não encontrado: {a}" for a in faltando] + [_linha_candidato(e) for e in res]
    if not res:
        linhas.append("nenhum")
    dados = {"resultados": [_publico(e) for e in res], "nao_encontrados": faltando}
    _saida_busca(args, base, args.termos, dados, linhas, len(res), [e["arquivo"] for e in res], sinonimos)
    return 0


def _cmd_ler(args):
    base = localizar_cerebro()
    lidos, faltando = ler_arquivos(base, args.arquivos, args.max)
    linhas = [f"não encontrado: {a}" for a in faltando]
    for rel, texto in lidos:
        linhas += [f"== {rel}", texto]
    dados = {"arquivos": [{"arquivo": r, "conteudo": t,
                           "atualizado": _data_modificacao(os.path.join(base, *(r.split("/") if "/" in r else ["conversas", r])))}
                          for r, t in lidos], "nao_encontrados": faltando}
    _saida_busca(args, base, args.arquivos, dados, linhas, len(lidos), [r for r, _ in lidos])
    return 1 if faltando and not lidos else 0


def _cmd_buscar(args):
    base = localizar_cerebro()
    termos, sinonimos = expandir_termos(base, args.termos)
    d = buscar(base, termos, args.projeto, max(1, args.limite), args.com_palavras)
    linhas = []
    if d["estado"]:
        linhas += [f"estado disponível: {d['estado']}"] + d["estado_linhas"]
    elif args.projeto:
        linhas.append(f"sem estado: {args.projeto}")
    linhas += [_linha_candidato(e) for e in d["candidatos"]] or ["nenhum"]
    if d["abrir"]:
        linhas.append("abrir: " + ", ".join(d["abrir"]))
    dados = {"estado": d["estado"], "estado_linhas": d["estado_linhas"],
             "candidatos": [_publico(e) for e in d["candidatos"]], "abrir": d["abrir"]}
    _saida_busca(args, base, args.termos, dados, linhas, len(d["candidatos"]), [e["arquivo"] for e in d["candidatos"]], sinonimos)
    return 0


def _cmd_painel(args):
    base = localizar_cerebro()
    d = painel(base, args.projeto)
    est, e = d["estatisticas"], d["estado"]
    linhas = [f"dir: {d['dir']}", f"projetos: {', '.join(d['projetos']) or 'nenhum'}",
              f"arquivos: {est['arquivos']} ({est['kb']} KB), última compactação: {est['ultima_compactacao'] or 'nunca'}"]
    if e:
        linhas.append(f"estado: {e['arquivo']} atualizado em {e['atualizado']}")
    _imprimir(args, d, linhas)
    return 0


def _ler_stdin():
    if sys.stdin is None or sys.stdin.isatty():
        raise ValueError("mande o resumo pela entrada padrão (ex.: heredoc <<'FIM' ... FIM)")
    bruto = getattr(sys.stdin, "buffer", None)
    return bruto.read().decode("utf-8-sig", errors="replace") if bruto else sys.stdin.read()


def _cmd_salvar(args):
    base = localizar_cerebro()
    corpo = _ler_stdin()
    if args.data and not _data_valida(args.data):
        raise ValueError(f"recusado: --data inválida ({args.data}); use AAAA-MM-DD")
    if args.estado:
        destino = salvar_estado(base, args.projeto, corpo, hoje=args.data)
        nome = f"estado/{destino.name}"
    else:
        faltam = [f"--{c}" for c in ("titulo", "palavras", "origem") if not getattr(args, c)]
        _recusar_se([f"falta {', '.join(faltam)}"] if faltam else [])
        destino = salvar_conversa(base, args.titulo, args.palavras, args.origem, args.projeto, corpo, hoje=args.data)
        nome = destino.name
    escrever_indice(base)
    _imprimir(args, {"arquivo": nome}, [nome])
    return 0


def montar_parser():
    comum = argparse.ArgumentParser(add_help=False)
    comum.add_argument("--json", action="store_true", help="saída em JSON (para o widget)")
    parser = argparse.ArgumentParser(prog="cerebro.py", description="Ferramenta do cérebro")
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("config", parents=[comum], help="mostra ou define a pasta do cérebro")
    p.add_argument("--definir", metavar="CAMINHO", help="grava o caminho em ~/.cerebro.json")
    p.set_defaults(func=_cmd_config)

    p = sub.add_parser("validar", parents=[comum], help="confere o formato dos arquivos")
    p.add_argument("--corrigir", action="store_true", help="conserta só o que é seguro")
    p.set_defaults(func=_cmd_validar)

    p = sub.add_parser("indice", parents=[comum], help="gera cerebro/INDICE.md")
    p.set_defaults(func=_cmd_indice)

    # Busca: nível 1 (nomes), nível 2 (2 primeiras linhas), nível 3 (arquivo inteiro) e o combinado
    p = sub.add_parser("titulos", parents=[comum], help="nível 1: busca só pelos nomes dos arquivos")
    p.add_argument("termos", nargs="+")
    p.add_argument("--projeto")
    p.add_argument("--limite", type=int, default=LIMITE_TITULOS)
    p.set_defaults(func=_cmd_titulos)

    p = sub.add_parser("cabecalho", parents=[comum], help="nível 2: busca nas palavras-chave (2 linhas)")
    p.add_argument("termos", nargs="+")
    p.add_argument("--arquivos", nargs="+", metavar="ARQ", help="avalia só estes (senão, todos)")
    p.add_argument("--limite", type=int, default=LIMITE_CABECALHO)
    p.set_defaults(func=_cmd_cabecalho)

    p = sub.add_parser("ler", parents=[comum], help="nível 3: imprime arquivos inteiros (até 3)")
    p.add_argument("arquivos", nargs="+")
    p.add_argument("--max", type=int, default=MAX_LER)
    p.set_defaults(func=_cmd_ler)

    p = sub.add_parser("buscar", parents=[comum], help="estado + títulos + cabeçalhos; sugere o que abrir")
    p.add_argument("termos", nargs="+")
    p.add_argument("--projeto")
    p.add_argument("--limite", type=int, default=LIMITE_BUSCAR, help="máximo de candidatos (padrão 5)")
    p.add_argument("--com-palavras", action="store_true", help="inclui as palavras-chave de todos os candidatos")
    p.set_defaults(func=_cmd_buscar)

    p = sub.add_parser("painel", parents=[comum], help="projetos, estatísticas e resumo do estado (aba do widget)")
    p.add_argument("--projeto")
    p.set_defaults(func=_cmd_painel)

    p = sub.add_parser("salvar", parents=[comum], help="grava um resumo (corpo pela entrada padrão)")
    p.add_argument("--titulo", help="assunto principal, 3 a 6 palavras")
    p.add_argument("--palavras", help="palavras-chave separadas por vírgula")
    p.add_argument("--origem", help="ex.: claude-code")
    p.add_argument("--projeto", required=True)
    p.add_argument("--data", help="AAAA-MM-DD do arquivo (padrão: hoje; o importador usa a data original da conversa)")
    p.add_argument("--estado", action="store_true", help="sobrescreve estado/{projeto}.md em vez de criar conversa")
    p.set_defaults(func=_cmd_salvar)
    return parser


def main(argv=None):
    args = montar_parser().parse_args(argv)
    try:
        return args.func(args)
    except CerebroNaoEncontrado as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 3  # a tela do widget usa este código para oferecer a escolha da pasta
    except (OSError, ValueError) as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    # No Windows o console pode não ser UTF-8; quem lê (IA ou widget) espera UTF-8.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
