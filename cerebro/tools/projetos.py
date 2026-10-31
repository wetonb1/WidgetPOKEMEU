#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""projetos.py - cadastro dos projetos do widget (projetos.json, na raiz do widget).

Só biblioteca padrão. As funções podem ser importadas; a linha de comando é uma camada fina
(o widget chama com --json; os dados de adicionar/editar/preencher vêm pela entrada padrão, em JSON).

  projetos.py listar
  projetos.py adicionar < {"nome": ..., "pasta": ...}
  projetos.py editar ID < {"descricao": ...}
  projetos.py remover ID                 só tira do cadastro: a pasta do projeto nunca é apagada
  projetos.py validar                    pasta existe? id único? campos válidos?
  projetos.py abertura ID                marca a última abertura (agora)
  projetos.py preparar ID [--confirmar]  o arquivo de instruções de cada IA do projeto (CLAUDE.md, AGENTS.md) com a seção Cérebro (sem --confirmar só mostra o diff)
  projetos.py preencher ID < {"objetivo": ..., "stack": ...}   preenche o estado criado no cérebro
  projetos.py prompt ID < {"tarefa": ...}          prompt inicial da sessão (cerebro/tools/prompt_inicial.txt)
  projetos.py sessao ID < {"ia", "modelo", "tarefa", "modo"}   marca a abertura e anota em cerebro/.log/sessoes.jsonl
  projetos.py worktree ID                git worktree em {pasta}-sessao2 (branch nova) para uma 2a sessão sem conflito
  projetos.py pausa-estado ID            Estado atual e Próximos passos do estado do projeto (para a "pausa segura")
  projetos.py pausa-salvar ID < {"estado_atual": ..., "proximos": ...}   atualiza só essas duas seções
  projetos.py pausa-registrar ID [--motivo limite]   anota a pausa (motivo e hora) em cerebro/.log/sessoes.jsonl
"""
import argparse
import datetime
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cerebro  # noqa: E402  (a mesma pasta: tools/)
import uso  # noqa: E402  (lê o sessoes.jsonl)
import ias as dados_ias  # noqa: E402  (as IAs e os modelos: app/ias-dados.json, o mesmo do widget)

IAS = dados_ias.ids()  # a primeira (o Claude) é a padrão
MODELOS = dados_ias.modelos("claude")  # os do Claude (cada IA tem os seus: dados_ias.modelos(ia))
CORES = ("#4f9dff", "#3ddc84", "#ff6b6b", "#ffc857", "#c792ea", "#5ce1e6")  # as do grafo do cérebro
CAMPOS = ("id", "nome", "pasta", "ia", "modelo_padrao", "descricao", "tags", "cor", "ultima_abertura")
# opcional: só aparece no arquivo quando você liga (o validar não reclama se faltar)
OPCIONAIS = ("pular_permissoes", "usar_api_key")
# opcionais que só aparecem no arquivo quando usados: outra IA para "continuar em outra IA" e o modelo de cada IA
OUTRA_IA = ("ia_reserva", "modelos_por_ia")
BOOLEANOS = OPCIONAIS  # só true/false de verdade; nada de "sim" virar true
EDITAVEIS = ("nome", "pasta", "ia", "modelo_padrao", "descricao", "tags", "cor") + OPCIONAIS + OUTRA_IA  # o id não muda: é o elo com o cérebro
MODOS = ("novo", "continuar", "retomar")
MOTIVOS_PAUSA = ("limite", "manual")
RE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,29}$")
RE_COR = re.compile(r"^#[0-9a-fA-F]{6}$")
RE_QUANDO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
MAX_DESCRICAO, MAX_NOME, MAX_TAGS, MAX_TAG = 200, 40, 10, 20
MAX_LINHAS_CLAUDE_MD = 20

ESQUELETO_ESTADO = """palavras-chave: {chaves}
data: {hoje} | origem: widget | projeto: {id}

## Objetivo

## Stack

## Decisões

## Estado atual

## Próximos passos

## Armadilhas
"""

BLOCO_CLAUDE_MD = """## Cérebro
O cérebro (memória dos meus projetos) fica em {cerebro}. Id deste projeto no cérebro: `{id}`.
- Antes de pesquisar sobre este projeto ou decisões passadas, consulte-o com a skill cerebro-buscar
  (`python "{cerebro}/tools/cerebro.py" buscar termos --projeto {id}`: 1 chamada, já traz o estado).
  Abra só o que combinar, com `cerebro.py ler` (máx. 3 arquivos).
- Nunca leia os arquivos do cérebro direto: use sempre o cerebro.py.
- Ao final de uma sessão produtiva, rode /compactar (ou a skill cerebro-compactar, nas IAs sem esse comando; projeto: {id}) e, se o estado mudou, atualize-o.
"""


# ---------- Arquivo (leitura e escrita atômica) ----------

def arquivo_projetos():
    """projetos.json na raiz do widget (PROJETOS_JSON troca o caminho; serve para os testes)."""
    return Path(os.environ.get("PROJETOS_JSON") or Path(__file__).resolve().parents[2] / "projetos.json")


def _gravar_atomico(destino, texto):
    """Grava num arquivo temporário da mesma pasta e renomeia: nunca fica um arquivo pela metade."""
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
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


def _ler(arq):
    """Lista crua do arquivo. Sem arquivo: []. Arquivo quebrado: erro (e nada é sobrescrito)."""
    try:
        with open(arq, "r", encoding="utf-8-sig") as f:
            dados = json.load(f)
    except FileNotFoundError:
        return []
    except ValueError as erro:
        raise ValueError(f"projetos.json inválido ({erro}); corrija o arquivo, nada foi alterado")
    if not isinstance(dados, list):
        raise ValueError("projetos.json precisa ser uma lista de projetos; nada foi alterado")
    return dados


def _salvar(arq, lista):
    _gravar_atomico(arq, json.dumps(lista, ensure_ascii=False, indent=2) + "\n")


# ---------- Campos ----------

def _uma_linha(valor, maximo):
    return " ".join(str(valor if valor is not None else "").split())[:maximo]


def _tags(valor):
    if isinstance(valor, str):
        valor = valor.split(",")
    if not isinstance(valor, (list, tuple)):
        return []
    saida = []
    for t in valor:
        t = _uma_linha(t, MAX_TAG).lower()
        if t and t not in saida:
            saida.append(t)
    return saida[:MAX_TAGS]


def _completar(p, indice=0):
    """Um projeto com todos os campos (arquivo editado à mão pode faltar algo)."""
    ia = p.get("ia") or IAS[0]
    completo = {
        "id": _uma_linha(p.get("id"), 60),
        "nome": _uma_linha(p.get("nome"), 100),
        "pasta": str(p.get("pasta") or "").strip(),
        "ia": ia,
        "modelo_padrao": p.get("modelo_padrao") or dados_ias.modelo_padrao(ia) or "sonnet",
        "descricao": _uma_linha(p.get("descricao"), 400),
        "tags": _tags(p.get("tags")),
        "cor": p.get("cor") or CORES[indice % len(CORES)],
        "ultima_abertura": p.get("ultima_abertura") or None,
        # perigoso: abre a IA sem pedir permissão para nada. Desligado, a não ser que você ligue por projeto
        "pular_permissoes": p.get("pular_permissoes") is True,
        # usa a variável de ambiente ANTHROPIC_API_KEY do Windows (cobra pela API em vez de usar a assinatura).
        # A chave nunca é gravada aqui: só este "liga/desliga".
        "usar_api_key": p.get("usar_api_key") is True,
    }
    # só entram no arquivo quando usados (os projetos antigos continuam iguais, sem migração)
    if p.get("ia_reserva") not in (None, ""):
        completo["ia_reserva"] = p.get("ia_reserva")
    if p.get("modelos_por_ia") not in (None, "", {}):
        completo["modelos_por_ia"] = p.get("modelos_por_ia")
    return completo


def _problemas(p, exigir_pasta):
    """O que está errado num projeto (sem olhar os outros). Pasta inexistente só conta se exigir_pasta."""
    erros = []
    if not RE_ID.match(p["id"]):
        erros.append("id inválido (minúsculas, números e hífen; até 30 caracteres)")
    if not p["nome"] or len(p["nome"]) > MAX_NOME:
        erros.append(f"nome vazio ou com mais de {MAX_NOME} caracteres")
    if not p["pasta"] or not os.path.isabs(p["pasta"]):
        erros.append("pasta precisa ser um caminho absoluto")
    elif exigir_pasta and not os.path.isdir(p["pasta"]):
        erros.append(f"pasta não existe: {p['pasta']}")
    if p["ia"] not in IAS:
        erros.append(f"ia inválida (use {', '.join(IAS)})")
    elif p["modelo_padrao"] not in dados_ias.modelos(p["ia"]):  # o modelo vale na IA do próprio projeto
        erros.append(f"modelo_padrao inválido (use {', '.join(dados_ias.modelos(p['ia']))})")
    if "ia_reserva" in p and (p["ia_reserva"] not in IAS or p["ia_reserva"] == p["ia"]):
        erros.append("ia_reserva inválida (outra IA conhecida, diferente da ia do projeto)")
    if "modelos_por_ia" in p:
        mpi = p["modelos_por_ia"]
        if not isinstance(mpi, dict):
            erros.append("modelos_por_ia precisa ser um objeto {ia: modelo}")
        else:
            for ia_, modelo in mpi.items():
                if ia_ not in IAS:
                    erros.append(f"modelos_por_ia: ia desconhecida: {ia_}")
                elif modelo not in dados_ias.modelos(ia_):
                    erros.append(f"modelos_por_ia: modelo inválido para {ia_}: {modelo}")
    if len(p["descricao"]) > MAX_DESCRICAO:
        erros.append(f"descricao com mais de {MAX_DESCRICAO} caracteres")
    if not RE_COR.match(str(p["cor"])):
        erros.append("cor inválida (use #rrggbb)")
    for campo in BOOLEANOS:
        if not isinstance(p[campo], bool):
            erros.append(f"{campo} precisa ser true ou false")
    if p["ultima_abertura"] is not None and not RE_QUANDO.match(str(p["ultima_abertura"])):
        erros.append("ultima_abertura inválida (use AAAA-MM-DDTHH:MM:SS ou null)")
    return erros


def _erro(problemas):
    return ValueError("; ".join(problemas))


# ---------- Cadastro ----------

def listar(arq=None):
    return [_completar(p, i) for i, p in enumerate(_ler(arq or arquivo_projetos())) if isinstance(p, dict)]


def _achar(lista, id_):
    for i, p in enumerate(lista):
        if isinstance(p, dict) and p.get("id") == id_:
            return i
    raise ValueError(f"projeto não encontrado: {id_}")


def _id_livre(nome, ocupados):
    base = cerebro._slug(nome)[:30].strip("-") or "projeto"
    candidato, n = base, 2
    while candidato in ocupados:
        sufixo = f"-{n}"
        candidato, n = base[:30 - len(sufixo)] + sufixo, n + 1
    return candidato


def adicionar(dados, arq=None, base=None):
    """Cadastra um projeto (pasta precisa existir) e cria o esqueleto do estado no cérebro, se faltar.
    Devolve {"projeto": ..., "estado": {"arquivo", "criado"} ou None}."""
    arq = arq or arquivo_projetos()
    lista = _ler(arq)
    ocupados = {p.get("id") for p in lista if isinstance(p, dict)}
    pasta = os.path.normpath(str(dados.get("pasta") or "").strip()) if dados.get("pasta") else ""
    nome = _uma_linha(dados.get("nome") or (os.path.basename(pasta) if pasta else ""), 100)
    id_ = _uma_linha(dados.get("id"), 60) or _id_livre(nome, ocupados)
    if id_ in ocupados:
        raise ValueError(f"já existe um projeto com o id {id_}")
    projeto = _completar({**dados, "id": id_, "nome": nome, "pasta": pasta}, len(lista))
    problemas = _problemas(projeto, exigir_pasta=True)
    if problemas:
        raise _erro(problemas)
    projeto["ultima_abertura"] = None
    lista.append(projeto)
    _salvar(arq, lista)
    return {"projeto": projeto, "estado": criar_estado(projeto, base)}


def editar(id_, campos, arq=None):
    arq = arq or arquivo_projetos()
    lista = _ler(arq)
    i = _achar(lista, id_)
    atual = _completar(lista[i], i)
    novo = dict(atual)
    for campo in BOOLEANOS:
        if campo in campos and not isinstance(campos[campo], bool):
            raise ValueError(f"{campo} precisa ser true ou false")
    for chave in EDITAVEIS:
        if chave in campos:
            novo[chave] = os.path.normpath(campos[chave]) if chave == "pasta" and campos[chave] else campos[chave]
    novo = _completar(novo, i)
    problemas = _problemas(novo, exigir_pasta=novo["pasta"] != atual["pasta"])  # pasta só é exigida se você a trocou
    if problemas:
        raise _erro(problemas)
    lista[i] = novo
    _salvar(arq, lista)
    return novo


def remover(id_, arq=None):
    """Tira do cadastro. A pasta do projeto, o CLAUDE.md dela e o estado no cérebro ficam como estão."""
    arq = arq or arquivo_projetos()
    lista = _ler(arq)
    i = _achar(lista, id_)
    removido = _completar(lista.pop(i), i)
    _salvar(arq, lista)
    return removido


def marcar_abertura(id_, quando=None, arq=None):
    arq = arq or arquivo_projetos()
    lista = _ler(arq)
    i = _achar(lista, id_)
    quando = quando or datetime.datetime.now().isoformat(timespec="seconds")
    if not RE_QUANDO.match(quando):
        raise ValueError("data/hora inválida (use AAAA-MM-DDTHH:MM:SS)")
    projeto = _completar(lista[i], i)
    projeto["ultima_abertura"] = quando
    lista[i] = projeto
    _salvar(arq, lista)
    return projeto


def validar(arq=None):
    """Confere o arquivo todo. Devolve uma lista de (id, problema), um por linha."""
    lista = _ler(arq or arquivo_projetos())
    achados, vistos = [], {}
    for i, bruto in enumerate(lista):
        if not isinstance(bruto, dict):
            achados.append((f"#{i + 1}", "item não é um objeto"))
            continue
        p = _completar(bruto, i)
        nome = p["id"] or f"#{i + 1}"
        for faltando in [c for c in CAMPOS if c not in bruto]:
            achados.append((nome, f"campo ausente: {faltando}"))
        achados += [(nome, e) for e in _problemas(p, exigir_pasta=True)]
        if p["id"] in vistos:
            achados.append((nome, f"id repetido (também no item #{vistos[p['id']]})"))
        vistos.setdefault(p["id"], i + 1)
    return achados


# ---------- Integração com o cérebro: estado do projeto ----------

def _base_cerebro(base=None):
    if base:
        return Path(base)
    try:
        return cerebro.localizar_cerebro()
    except FileNotFoundError:
        return None


def criar_estado(projeto, base=None, hoje=None):
    """Esqueleto de estado/{id}.md (cabeçalho oficial + 6 seções vazias), se ainda não existir.
    Devolve {"arquivo", "criado"}; None se o cérebro não foi encontrado."""
    base = _base_cerebro(base)
    if base is None:
        return None
    destino = base / "estado" / f"{projeto['id']}.md"
    rel = f"estado/{destino.name}"
    if destino.exists():
        return {"arquivo": rel, "criado": False}
    chaves = [projeto["id"]] + cerebro._slug(projeto["nome"]).split("-") + projeto["tags"][:3] + ["estado", "projeto"]
    unicas = list(dict.fromkeys(c for c in chaves if c))[:10]
    texto = ESQUELETO_ESTADO.format(chaves=", ".join(unicas), id=projeto["id"],
                                    hoje=hoje or datetime.date.today().isoformat())
    cerebro._gravar(destino, texto)
    cerebro.escrever_indice(base)
    return {"arquivo": rel, "criado": True}


def preencher_estado(id_, objetivo, stack, arq=None, base=None):
    """Escreve o Objetivo e a Stack no esqueleto (só em seção ainda vazia). O resto fica para o agente.
    Usa o salvar --estado do cérebro: valida e guarda a versão anterior em estado/.anteriores."""
    lista = _ler(arq or arquivo_projetos())
    _achar(lista, id_)
    base = _base_cerebro(base)
    if base is None:
        raise ValueError("cérebro não encontrado")
    caminho = base / "estado" / f"{id_}.md"
    if not caminho.is_file():
        raise ValueError(f"estado/{id_}.md não existe")
    linhas = caminho.read_bytes().decode("utf-8-sig").replace("\r\n", "\n").split("\n")
    quer = {"objetivo": _uma_linha(objetivo, 200), "stack": _uma_linha(stack, 200)}
    feitas, saida, i = [], [], 0
    while i < len(linhas):
        saida.append(linhas[i])
        m = re.match(r"\s*#+\s*(.+?)\s*$", linhas[i])
        chave = cerebro.normalizar(m.group(1)) if m else ""
        if chave in quer and quer[chave]:
            j = i + 1
            while j < len(linhas) and not linhas[j].strip():
                j += 1
            if j >= len(linhas) or re.match(r"\s*#", linhas[j]):  # seção vazia
                saida.append(quer[chave])
                feitas.append(chave)
        i += 1
    if feitas:
        cerebro.salvar_estado(base, id_, "\n".join(saida))
        cerebro.escrever_indice(base)
    return {"arquivo": f"estado/{id_}.md", "preenchido": feitas}


# ---------- Instruções por projeto: o arquivo que cada IA lê na pasta do projeto ----------

def arquivos_de_instrucao(projeto):
    """[(ia, nome do arquivo)] da IA do projeto e da ia_reserva, sem repetir arquivo (o nome vem do ias-dados.json:
    CLAUDE.md para o Claude Code, AGENTS.md para o Antigravity)."""
    saida, vistos = [], set()
    for ia in (projeto["ia"], projeto.get("ia_reserva")):
        if not ia or ia not in IAS:
            continue
        nome = (dados_ias.carregar().get(ia) or {}).get("arquivoRegras") or "CLAUDE.md"
        if nome not in vistos:
            vistos.add(nome)
            saida.append((ia, nome))
    return saida


def _preparar_arquivo(pasta, nome, projeto, bloco, confirmar):
    """Um arquivo de instruções: cria (até 20 linhas) ou acrescenta a seção "## Cérebro"; nunca sobrescreve."""
    caminho = pasta / nome
    if not caminho.exists():
        acao, novo, atual = "criar", f"# {projeto['nome']}\n\n{bloco}", ""
        if len(novo.splitlines()) > MAX_LINHAS_CLAUDE_MD:
            raise ValueError(f"{nome} passaria de {MAX_LINHAS_CLAUDE_MD} linhas")
    else:
        with open(caminho, "r", encoding="utf-8-sig", newline="") as f:
            atual = f.read()
        existe = any(
            cerebro.normalizar(m.group(1)).startswith("cerebro")
            for m in (re.match(r"\s*#{1,6}\s*(.+?)\s*$", l) for l in atual.splitlines()) if m
        )
        if existe:
            return {"acao": "ja-preparado", "arquivo": str(caminho), "diff": "", "escrito": False}
        eol = "\r\n" if "\r\n" in atual else "\n"
        acao = "acrescentar"
        novo = atual.rstrip("\r\n") + eol + eol + bloco.replace("\n", eol)
    diff = "\n".join(difflib.unified_diff(atual.splitlines(), novo.splitlines(), f"{nome} (atual)", f"{nome} (proposto)", lineterm="", n=1))
    if confirmar:
        _gravar_atomico(caminho, novo)
    return {"acao": acao, "arquivo": str(caminho), "diff": diff, "escrito": bool(confirmar)}


def preparar_projeto(id_, confirmar=False, arq=None, base=None):
    """Prepara a pasta do projeto para consultar o cérebro: o arquivo de instruções de cada IA (CLAUDE.md, AGENTS.md; a IA do
    projeto e a ia_reserva), cada um com a seção "## Cérebro" (até 20 linhas). Nunca sobrescreve: se o arquivo existir, acrescenta.
    Sem confirmar=True não grava nada; devolve o diff para você aprovar.
    Devolve {"acao": criar|acrescentar|ja-preparado, "arquivo", "diff", "escrito", "arquivos": [{"ia", "nome", ...}]}: os quatro
    primeiros resumem todos os arquivos (com um só, são os dele)."""
    lista = _ler(arq or arquivo_projetos())
    projeto = _completar(lista[_achar(lista, id_)])
    pasta = Path(projeto["pasta"])
    if not pasta.is_dir():
        raise ValueError(f"a pasta do projeto não existe: {pasta}")
    base = _base_cerebro(base) or cerebro.descobrir_cerebro()[0]
    bloco = BLOCO_CLAUDE_MD.format(cerebro=str(base).replace("\\", "/"), id=projeto["id"])
    # primeiro confere tudo (um erro não deixa metade gravada); depois grava
    previstos = [dict(ia=ia, nome=nome, **_preparar_arquivo(pasta, nome, projeto, bloco, False)) for ia, nome in arquivos_de_instrucao(projeto)]
    if confirmar:
        for r in previstos:
            if r["acao"] != "ja-preparado":
                r.update(_preparar_arquivo(pasta, r["nome"], projeto, bloco, True))
    acoes = [r["acao"] for r in previstos]
    resumo = "criar" if "criar" in acoes else "acrescentar" if "acrescentar" in acoes else "ja-preparado"
    return {
        "acao": resumo, "arquivo": ", ".join(r["arquivo"] for r in previstos),
        "diff": "\n".join(r["diff"] for r in previstos if r["diff"]), "escrito": bool(confirmar) and resumo != "ja-preparado",
        "arquivos": previstos,
    }


# ---------- Sessões de IA: prompt inicial e registro ----------

PALAVRAS_VAZIAS = set("""a o os as um uma uns umas de da do das dos e em no na nos nas para pra por pelo pela pelos pelas com sem que se
ao aos como mais menos ou eu me meu minha meus minhas isso esse essa este esta isto aquilo nao sim ser ter fazer faz quero queria
preciso vamos vou agora sobre tambem ja todo toda todos todas cada mas porque entao ainda so muito pouco hoje ele ela the and""".split())


def extrair_tema(tarefa, projeto=""):
    """Até 5 palavras que dizem do que a tarefa trata (sem acento, sem palavras vazias). Sem tarefa: o projeto."""
    vistas = []
    for p in re.findall(r"[a-z0-9]+", cerebro.normalizar(tarefa or "")):
        if len(p) >= 3 and p not in PALAVRAS_VAZIAS and p not in vistas:
            vistas.append(p)
    return " ".join(vistas[:5]) or projeto


RETOMADA = ("retome de onde paramos: leia as seções Estado atual e Próximos passos do estado do projeto, diga em 1 linha "
            "qual é o primeiro passo pendente e continue por ele, sem me pedir para explicar tudo de novo.")


def montar_prompt(id_, tarefa="", arq=None, base=None, retomada=False):
    """Prompt inicial da sessão: cerebro/tools/prompt_inicial.txt com {projeto}, {tema}, {CAMINHO_CEREBRO} e {depois}.
    Com tarefa, a sessão já começa por ela depois de consultar o cérebro. Com retomada=True (depois de uma pausa por
    limite) ela retoma pelo estado do projeto no cérebro, sem precisar reexplicar nada."""
    lista = _ler(arq or arquivo_projetos())
    projeto = _completar(lista[_achar(lista, id_)])
    tarefa = _uma_linha(tarefa, 500)
    tema = f"{projeto['id']} estado proximos passos" if retomada else extrair_tema(tarefa, projeto["id"])
    caminho = (_base_cerebro(base) or cerebro.descobrir_cerebro()[0])
    modelo = (Path(__file__).resolve().parent / "prompt_inicial.txt").read_text(encoding="utf-8-sig")
    depois = RETOMADA if retomada else (f"comece esta tarefa: {tarefa}" if tarefa else "aguarde minha tarefa.")
    texto = (modelo.replace("{projeto}", projeto["id"]).replace("{tema}", tema)
             .replace("{CAMINHO_CEREBRO}", str(caminho).replace("\\", "/")).replace("{depois}", depois))
    return {"prompt": texto.strip(), "tema": tema, "pasta": projeto["pasta"], "pular_permissoes": projeto["pular_permissoes"]}


def _anotar_no_log(base, linha):
    """Acrescenta uma linha em cerebro/.log/sessoes.jsonl. Se o log falhar, segue sem ele."""
    base = _base_cerebro(base)
    if base is None:
        return
    try:
        (base / ".log").mkdir(parents=True, exist_ok=True)
        with open(base / ".log" / "sessoes.jsonl", "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(linha, ensure_ascii=False, separators=(",", ":")) + "\n")
    except OSError:
        pass


def registrar_sessao(id_, ia, modelo, tarefa="", modo="novo", arq=None, base=None, motivo=None):
    """Marca a última abertura no projetos.json e anota a sessão em cerebro/.log/sessoes.jsonl
    (data, projeto, ia, modelo, tarefa, modo e, se houver, motivo). Se o log falhar, segue sem ele."""
    if modo not in MODOS:
        raise ValueError(f"modo inválido (use {', '.join(MODOS)})")
    projeto = marcar_abertura(id_, arq=arq)
    linha = {"data": projeto["ultima_abertura"], "projeto": id_, "ia": ia, "modelo": modelo,
             "tarefa": _uma_linha(tarefa, 500), "modo": modo}
    if motivo:
        linha["motivo"] = _uma_linha(motivo, 40)
    _anotar_no_log(base, linha)
    return {"projeto": projeto, "sessao": linha}


# ---------- Pausar com segurança (cheguei no limite) ----------
# Três passos: compactar a sessão, atualizar o estado do projeto e registrar a pausa. O Claude Code não deixa
# ler o limite de fora: quem avisa que o uso acabou é você (ou a própria sessão). Aqui só se guarda o que foi decidido.

def registrar_pausa(id_, motivo="limite", arq=None, base=None, agora=None, ia=None):
    """Anota a pausa (motivo, hora e a IA que foi pausada) em cerebro/.log/sessoes.jsonl. Não é uma sessão aberta: modo "pausa".
    Sem `ia`, vale a IA padrão do projeto."""
    if motivo not in MOTIVOS_PAUSA:
        raise ValueError(f"motivo inválido (use {', '.join(MOTIVOS_PAUSA)})")
    if ia not in (None, "") and ia not in IAS:
        raise ValueError(f"ia desconhecida: {ia} (use {', '.join(IAS)})")
    lista = _ler(arq or arquivo_projetos())
    projeto = _completar(lista[_achar(lista, id_)])
    quando = (agora or datetime.datetime.now()).isoformat(timespec="seconds")
    linha = {"data": quando, "projeto": id_, "ia": ia or projeto["ia"], "modelo": "", "tarefa": "", "modo": "pausa", "motivo": motivo}
    _anotar_no_log(base, linha)
    return {"pausa": linha}


def _titulo_secao(linha):
    m = re.match(r"\s*#+\s*(.+?)\s*$", linha)
    return cerebro.normalizar(m.group(1)) if m else None


def _corpo_da_secao(linhas, titulo):
    """Texto de uma seção do estado (sem o título), ou "" se não existir."""
    alvo = cerebro.normalizar(titulo)
    for i, l in enumerate(linhas):
        if _titulo_secao(l) == alvo:
            j = i + 1
            while j < len(linhas) and _titulo_secao(linhas[j]) is None:
                j += 1
            return "\n".join(linhas[i + 1:j]).strip()
    return ""


def _trocar_secao(linhas, titulo, texto):
    """Troca o corpo de uma seção (ou cria a seção no fim). Devolve a nova lista de linhas."""
    alvo = cerebro.normalizar(titulo)
    novas = [x.rstrip() for x in str(texto or "").replace("\r\n", "\n").split("\n")]
    while novas and not novas[-1]:
        novas.pop()
    for i, l in enumerate(linhas):
        if _titulo_secao(l) == alvo:
            j = i + 1
            while j < len(linhas) and _titulo_secao(linhas[j]) is None:
                j += 1
            return linhas[:i + 1] + novas + [""] + linhas[j:]
    return linhas + ["", f"## {titulo}"] + novas


def _estado_do_projeto(id_, arq=None, base=None):
    lista = _ler(arq or arquivo_projetos())
    projeto = _completar(lista[_achar(lista, id_)])
    base = _base_cerebro(base)
    if base is None:
        raise ValueError("cérebro não encontrado")
    caminho = base / "estado" / f"{id_}.md"
    if not caminho.is_file():
        criar_estado(projeto, base)  # nunca sobrescreve; cria o esqueleto se o projeto ainda não tinha
    return base, caminho


def estado_da_pausa(id_, arq=None, base=None):
    """O que está hoje em "Estado atual" e "Próximos passos" do estado do projeto (para você editar na pausa)."""
    base, caminho = _estado_do_projeto(id_, arq, base)
    linhas = caminho.read_bytes().decode("utf-8-sig").replace("\r\n", "\n").split("\n")
    return {"arquivo": f"estado/{id_}.md", "estado_atual": _corpo_da_secao(linhas, "Estado atual"),
            "proximos": _corpo_da_secao(linhas, "Próximos passos"), "atualizado": _data_modificacao(caminho)}


def atualizar_estado_pausa(id_, estado_atual, proximos, arq=None, base=None):
    """Troca SÓ as seções Estado atual e Próximos passos (o resto do estado fica). Usa o salvar --estado do cérebro:
    valida (6 seções, até 300 palavras) e guarda a versão anterior em estado/.anteriores."""
    base, caminho = _estado_do_projeto(id_, arq, base)
    linhas = caminho.read_bytes().decode("utf-8-sig").replace("\r\n", "\n").split("\n")
    linhas = _trocar_secao(linhas, "Estado atual", estado_atual)
    linhas = _trocar_secao(linhas, "Próximos passos", proximos)
    cerebro.salvar_estado(base, id_, "\n".join(linhas))
    cerebro.escrever_indice(base)
    return {"arquivo": f"estado/{id_}.md"}


def _data_modificacao(caminho):
    return datetime.date.fromtimestamp(os.stat(caminho).st_mtime).isoformat()


# ---------- 2a sessão no mesmo projeto: git worktree ----------

def _git(pasta, *args):
    git = shutil.which("git")
    if not git:
        raise ValueError("git não encontrado no PATH")
    r = subprocess.run([git, "-C", str(pasta), *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise ValueError("git: " + (r.stderr.strip().splitlines() or ["falhou"])[-1])
    return r.stdout.strip()


def criar_worktree(id_, arq=None, agora=None):
    """Cria (ou reaproveita) um git worktree em {pasta}-sessao2, -sessao3... numa branch nova, para uma segunda
    sessão trabalhar no mesmo projeto sem pisar nos arquivos da primeira. Devolve a pasta, a branch e os
    comandos para juntar o trabalho depois. Só o que já está commitado vai para o worktree."""
    lista = _ler(arq or arquivo_projetos())
    projeto = _completar(lista[_achar(lista, id_)])
    pasta = Path(projeto["pasta"])
    if not pasta.is_dir():
        raise ValueError(f"a pasta do projeto não existe: {pasta}")
    try:
        _git(pasta, "rev-parse", "--show-toplevel")
    except ValueError:
        raise ValueError("a pasta do projeto não é um repositório git (rode git init e faça um commit)")
    existentes = {}
    bloco = {}
    for linha in _git(pasta, "worktree", "list", "--porcelain").splitlines() + [""]:
        if linha.startswith("worktree "):
            bloco = {"pasta": os.path.normcase(os.path.normpath(linha[9:]))}
        elif linha.startswith("branch "):
            bloco["branch"] = linha[7:].replace("refs/heads/", "")
        elif not linha and bloco:
            existentes[bloco["pasta"]] = bloco.get("branch", "")
            bloco = {}
    n = 2
    while True:
        destino = Path(f"{pasta}-sessao{n}")
        chave = os.path.normcase(os.path.normpath(str(destino)))
        if chave in existentes:  # já é um worktree deste repositório: reaproveita
            branch, reaproveitado = existentes[chave], True
            break
        if not destino.exists():
            agora = agora or datetime.datetime.now()
            branch, reaproveitado = f"sessao{n}-{agora:%Y%m%d-%H%M%S}", False
            _git(pasta, "worktree", "add", "-b", branch, str(destino))
            break
        n += 1  # a pasta existe mas não é worktree deste repositório: não mexe nela, tenta a próxima
    comandos = [
        f'cd /d "{pasta}"',
        f"git merge {branch}",
        f'git worktree remove "{destino}"',
        f"git branch -d {branch}",
    ]
    return {"pasta": str(destino), "branch": branch, "reaproveitado": reaproveitado, "comandos": comandos}


# ---------- Linha de comando ----------

def _entrada_json():
    if sys.stdin is None or sys.stdin.isatty():
        raise ValueError("mande os dados em JSON pela entrada padrão")
    bruto = sys.stdin.buffer.read().decode("utf-8-sig", errors="replace") if hasattr(sys.stdin, "buffer") else sys.stdin.read()
    try:
        dados = json.loads(bruto)
    except ValueError:
        raise ValueError("entrada não é um JSON válido")
    if not isinstance(dados, dict):
        raise ValueError("a entrada precisa ser um objeto JSON")
    return dados


def _imprimir(args, dados, linhas):
    if args.json:
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for linha in linhas:
            print(linha)


def _com_status(projetos, base):
    """Acrescenta o que a tela mostra: a pasta ainda existe? o estado já existe no cérebro? o projeto está pausado
    (o último registro dele no log é uma pausa; abrir uma sessão nova depois dela desfaz)? Para "continuar em outra IA":
    a última sessão do projeto em cada IA e quantas sessões cada IA teve nas últimas 24 h (contagem local, não a cota real)."""
    ultimo = {}
    eventos = uso.ler_eventos(base) if base else []
    for e in eventos:
        ultimo[e["projeto"]] = e
    ultimas = uso.ultimas_por_projeto(eventos)
    recentes = uso.recentes_por_ia(eventos)
    return [{**p, "pasta_existe": os.path.isdir(p["pasta"]),
             "estado_existe": bool(base) and (base / "estado" / f"{p['id']}.md").is_file(),
             "pausa": ({"data": ultimo[p["id"]]["data"], "motivo": ultimo[p["id"]].get("motivo", ""), "ia": ultimo[p["id"]].get("ia") or "claude"}
                       if p["id"] in ultimo and ultimo[p["id"]].get("modo") == "pausa" else None),
             "ultima_sessao_por_ia": ultimas.get(p["id"], {}), "recentes_por_ia": recentes} for p in projetos]


def _cmd_listar(args):
    ps = _com_status(listar(), _base_cerebro())
    _imprimir(args, {"projetos": ps, "arquivo": str(arquivo_projetos())},
              [f"{p['id']}  {p['nome']}  {p['modelo_padrao']}  {p['pasta']}" + ("" if p["pasta_existe"] else "  [pasta não existe]") for p in ps] or ["nenhum"])
    return 0


def _cmd_adicionar(args):
    r = adicionar(_entrada_json())
    _imprimir(args, r, [f"adicionado: {r['projeto']['id']}"] + ([f"estado criado: {r['estado']['arquivo']}"] if r["estado"] and r["estado"]["criado"] else []))
    return 0


def _cmd_editar(args):
    p = editar(args.id, _entrada_json())
    _imprimir(args, {"projeto": p}, [f"editado: {p['id']}"])
    return 0


def _cmd_remover(args):
    p = remover(args.id)
    _imprimir(args, {"projeto": p}, [f"removido do cadastro: {p['id']} (a pasta não foi tocada)"])
    return 0


def _cmd_validar(args):
    achados = validar()
    _imprimir(args, {"problemas": [{"id": i, "problema": p} for i, p in achados]},
              [f"{i}: {p}" for i, p in achados] or ["ok"])
    return 1 if achados else 0


def _cmd_abertura(args):
    p = marcar_abertura(args.id, args.quando)
    _imprimir(args, {"projeto": p}, [f"{p['id']}: {p['ultima_abertura']}"])
    return 0


def _cmd_preparar(args):
    r = preparar_projeto(args.id, args.confirmar)
    linhas = [f"{r['acao']}: {r['arquivo']}" + (" (gravado)" if r["escrito"] else "")]
    if r["diff"] and not r["escrito"]:
        linhas.append(r["diff"])
    _imprimir(args, r, linhas)
    return 0


def _cmd_preencher(args):
    dados = _entrada_json()
    r = preencher_estado(args.id, dados.get("objetivo", ""), dados.get("stack", ""))
    _imprimir(args, r, [f"{r['arquivo']}: preenchido {', '.join(r['preenchido']) or 'nada (seções já tinham texto)'}"])
    return 0


def _cmd_prompt(args):
    d = _entrada_json()
    r = montar_prompt(args.id, d.get("tarefa", ""), retomada=d.get("retomada") is True)
    _imprimir(args, r, [r["prompt"]])
    return 0


def _cmd_sessao(args):
    d = _entrada_json()
    r = registrar_sessao(args.id, str(d.get("ia") or IAS[0]), str(d.get("modelo") or ""), str(d.get("tarefa") or ""), str(d.get("modo") or "novo"),
                         motivo=str(d.get("motivo") or "") or None)
    _imprimir(args, r, [f"{args.id}: sessão anotada ({r['sessao']['modo']}, {r['sessao']['modelo']})"])
    return 0


def _cmd_pausa_estado(args):
    r = estado_da_pausa(args.id)
    _imprimir(args, r, [f"{r['arquivo']} (atualizado em {r['atualizado']})", "Estado atual:", r["estado_atual"] or "(vazio)", "Próximos passos:", r["proximos"] or "(vazio)"])
    return 0


def _cmd_pausa_salvar(args):
    d = _entrada_json()
    r = atualizar_estado_pausa(args.id, d.get("estado_atual", ""), d.get("proximos", ""))
    _imprimir(args, r, [f"{r['arquivo']}: Estado atual e Próximos passos atualizados"])
    return 0


def _cmd_pausa_registrar(args):
    r = registrar_pausa(args.id, args.motivo, ia=args.ia)
    _imprimir(args, r, [f"{args.id}: pausa anotada ({r['pausa']['motivo']}, {r['pausa']['data']})"])
    return 0


def _cmd_worktree(args):
    r = criar_worktree(args.id)
    _imprimir(args, r, [f"{'reaproveitado' if r['reaproveitado'] else 'criado'}: {r['pasta']} (branch {r['branch']})", "para juntar depois:"] + r["comandos"])
    return 0


def _cmd_avaliar_skills(args):
    import avaliar_skills
    r = avaliar_skills.avaliar_skills_projeto(args.id, online=getattr(args, "online", False))
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print(avaliar_skills.formatar_tabela_terminal(r))
    return 0


def montar_parser():
    comum = argparse.ArgumentParser(add_help=False)
    comum.add_argument("--json", action="store_true", help="saída em JSON (para o widget)")
    parser = argparse.ArgumentParser(prog="projetos.py", description="Cadastro de projetos do widget")
    sub = parser.add_subparsers(dest="comando", required=True)
    for nome, func, ajuda, com_id in (
        ("listar", _cmd_listar, "lista os projetos", False),
        ("adicionar", _cmd_adicionar, "cadastra (JSON na entrada padrão)", False),
        ("editar", _cmd_editar, "edita (JSON na entrada padrão)", True),
        ("remover", _cmd_remover, "tira do cadastro (não apaga a pasta)", True),
        ("validar", _cmd_validar, "confere o projetos.json", False),
        ("abertura", _cmd_abertura, "marca a última abertura", True),
        ("preparar", _cmd_preparar, "CLAUDE.md na pasta do projeto", True),
        ("preencher", _cmd_preencher, "preenche objetivo e stack do estado", True),
        ("prompt", _cmd_prompt, "prompt inicial de uma sessão", True),
        ("sessao", _cmd_sessao, "anota a abertura de uma sessão", True),
        ("worktree", _cmd_worktree, "git worktree para uma 2a sessão", True),
        ("pausa-estado", _cmd_pausa_estado, "estado atual e próximos passos do projeto", True),
        ("pausa-salvar", _cmd_pausa_salvar, "atualiza estado atual e próximos passos", True),
        ("pausa-registrar", _cmd_pausa_registrar, "anota a pausa no sessoes.jsonl", True),
        ("avaliar-skills", _cmd_avaliar_skills, "avalia as skills mais úteis para o projeto", True),
    ):
        p = sub.add_parser(nome, parents=[comum], help=ajuda)
        if com_id:
            p.add_argument("id")
        if nome == "abertura":
            p.add_argument("--quando", help="AAAA-MM-DDTHH:MM:SS (padrão: agora)")
        if nome == "pausa-registrar":
            p.add_argument("--motivo", default="limite", choices=list(MOTIVOS_PAUSA))
            p.add_argument("--ia", choices=list(IAS), help="a IA da sessão pausada (padrão: a IA do projeto)")
        if nome == "preparar":
            p.add_argument("--confirmar", action="store_true", help="grava (sem isso só mostra o diff)")
        if nome == "avaliar-skills":
            p.add_argument("--online", "--buscar-online", dest="online", action="store_true", help="avalia também em repositórios online (GitHub, Anthropic, OpenAI)")
        p.set_defaults(func=func)
    return parser


def main(argv=None):
    args = montar_parser().parse_args(argv)
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
