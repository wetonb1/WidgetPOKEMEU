#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tokens.py - estima quanto cada skill custa em tokens (alimenta o gráfico da aba Skills). Só biblioteca padrão.

COMO O CUSTO DE UMA SKILL APARECE (explicado também na interface):
  FIXO      o nome e a descrição ficam no contexto de TODA conversa em que a skill está instalada, mesmo sem
            ser usada. É um "imposto" pago sempre; por isso a descrição precisa ser curta.
  AO USAR   quando a skill é acionada, o corpo do SKILL.md entra no contexto (e, às vezes, arquivos extras).
  SAÍDA DE FERRAMENTA   nas skills do cérebro, o que o cerebro.py devolve também entra no contexto. Usa-se a média
            REAL de cerebro/.log/consultas.jsonl quando há dados; sem dados, valores padrão (marcados "padrão").
  POR USO   o que UMA ativação acrescenta = ao usar + extras + saída de ferramenta (o fixo já está pago).
  IMPOSTO FIXO POR CONVERSA   fixo de todas as skills instaladas + o CLAUDE.md global + o CLAUDE.md do projeto
            (os dois CLAUDE.md também entram em toda conversa).

ISTO É UMA ESTIMATIVA. Cada modelo conta tokens de um jeito um pouco diferente (os modelos 4.7 em diante usam um
tokenizador que gera ~30% mais tokens que os anteriores). Padrão: caracteres / 4, arredondado para cima; texto em
português com acentos ganha fator 1,1. A opção precisa (calibrar) pede ao endpoint oficial da API da Anthropic
(POST /v1/messages/count_tokens, gratuito, com limite de requisições por minuto) o número real de alguns textos
e guarda o fator em ~/.cerebro.json ("tokens_fator"). Ela só envia algo com --enviar e com ANTHROPIC_API_KEY;
sem isso apenas mostra o que enviaria.

  tokens.py relatorio [--alvo claude|antigravity|ambos] [--json]   uma seção por IA + imposto lado a lado + alertas
  tokens.py estimar [ARQUIVO]                  tokens de um arquivo (ou da entrada padrão)
  tokens.py calibrar [--enviar] [--modelo M]   mostra (ou, com --enviar, faz) a calibração pela API
  tokens.py calibrar --esquecer                volta ao fator padrão
"""
import argparse
import datetime
import json
import math
import re
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(RAIZ / "skills-biblioteca"))
import cerebro  # noqa: E402
import projetos  # noqa: E402
import skills  # noqa: E402

CONCEITO = (
    "Fixo: nome e descrição ficam no contexto de toda conversa em que a skill está instalada, mesmo sem uso. "
    "Ao usar: o corpo do SKILL.md (e às vezes arquivos extras) entra no contexto quando a skill é acionada. "
    "Saída de ferramenta: nas skills do cérebro, o que o cerebro.py devolve também entra (média real do log quando há dados). "
    "Estimativa: cada modelo conta tokens de forma um pouco diferente."
)

FATOR_ACENTOS = 1.1        # português com acentos
MAX_DESCRICAO = 200        # caracteres
MAX_CORPO_TOKENS = 2000    # tokens ao usar
MAX_IMPOSTO_TOKENS = 3000  # imposto fixo por conversa

# endpoint oficial de contagem (documentação: Token counting). Gratuito; limite de requisições por minuto por tier.
API_URL = "https://api.anthropic.com/v1/messages/count_tokens"
API_VERSAO = "2023-06-01"
MODELO_PADRAO = "claude-sonnet-5-5"  # o tokenizador é do modelo: calibre com o que você mais usa

# o que o cerebro.py devolve (em tokens) quando ainda não há consultas no log: ordem de grandeza
SAIDA_PADRAO = {"titulos": 60, "cabecalho": 90, "ler": 600, "buscar": 200, "salvar": 15}
# comandos do cerebro.py cuja saída entra no contexto, por skill
COMANDOS_DA_SKILL = {
    "cerebro-titulos": ("titulos",),
    "cerebro-cabecalho": ("cabecalho",),
    "cerebro-ler": ("ler",),
    "cerebro-buscar": ("buscar", "ler"),
    "cerebro-compactar": ("salvar",),
}


# ---------- Estimativa ----------

def ler_config_tokens():
    """Fator calibrado do ~/.cerebro.json (None se nunca calibrou)."""
    dados = cerebro.ler_config()
    f = dados.get("tokens_fator")
    return float(f) if isinstance(f, (int, float)) and not isinstance(f, bool) and 0.2 <= f <= 5 else None


def tem_acentos(texto):
    return any(ord(c) > 127 and c.isalpha() for c in texto)


def estimar_tokens(texto, fator=None, calibrado=True):
    """Estimativa: caracteres / 4 (para cima). Português com acentos: x 1,1. Com fator calibrado (~/.cerebro.json),
    ele vale no lugar da regra dos acentos. É uma ESTIMATIVA: cada modelo conta de um jeito."""
    texto = texto.replace("\r\n", "\n")  # fim de linha do Windows conta como 1 caractere, não 2
    if not texto:
        return 0
    base = len(texto) / 4
    if fator is None and calibrado:
        fator = ler_config_tokens()
    if fator is None:
        fator = FATOR_ACENTOS if tem_acentos(texto) else 1.0
    return math.ceil(round(base * fator, 6))


def tokens_de_caracteres(n):
    """Tokens de um texto só conhecido pelo tamanho (o log do cérebro guarda caracteres). Saída em português."""
    fator = ler_config_tokens() or FATOR_ACENTOS
    return math.ceil(round(n / 4 * fator, 6))


# ---------- Custo de uma skill ----------

def _cabecalho_e_corpo(caminho):
    """Lê o cabeçalho YAML linha a linha (só ele, para o fixo) e depois o corpo. Devolve (campos, corpo)."""
    campos, corpo = {}, ""
    with open(caminho, "r", encoding="utf-8-sig", errors="replace") as f:
        primeira = f.readline()
        if primeira.strip() != "---":
            return {}, primeira + f.read()
        for linha in f:
            if linha.strip() == "---":
                break
            chave, sep, valor = linha.partition(":")
            if sep and chave.strip() and not linha.startswith((" ", "\t")):
                campos[chave.strip()] = valor.strip().strip('"').strip("'")
        corpo = f.read()
    return campos, corpo


def _extras_da_skill(pasta):
    """Arquivos extras: os do skill.json (biblioteca) ou, numa cópia instalada, tudo além do SKILL.md."""
    manifesto = pasta / "skill.json"
    if manifesto.is_file():
        try:
            lista = json.loads(manifesto.read_text(encoding="utf-8-sig")).get("arquivos_extras", [])
            return [x for x in lista if isinstance(x, str) and skills._caminho_seguro(x)]
        except (OSError, ValueError, AttributeError):
            return []
    ignorar = {"SKILL.md", skills.MARCA, "skill.json"}
    return sorted(p.relative_to(pasta).as_posix() for p in pasta.rglob("*") if p.is_file() and p.name not in ignorar)


def media_saida_ferramenta(nome, base=None):
    """Tokens que a saída do cerebro.py acrescenta por uso da skill. Média REAL do consultas.jsonl quando há dados.
    Devolve (tokens, fonte)."""
    comandos = COMANDOS_DA_SKILL.get(nome)
    if not comandos:
        return 0, "nenhuma"
    medias = {}
    try:
        base = Path(base) if base else cerebro.localizar_cerebro()
        with open(base / ".log" / "consultas.jsonl", "r", encoding="utf-8") as f:
            for linha in f:
                try:
                    d = json.loads(linha)
                except ValueError:
                    continue
                if d.get("comando") in comandos and isinstance(d.get("caracteres"), int):
                    soma, n = medias.get(d["comando"], (0, 0))
                    medias[d["comando"]] = (soma + d["caracteres"], n + 1)
    except (OSError, ValueError):
        pass
    total, medido = 0, False
    for c in comandos:
        if c in medias:
            soma, n = medias[c]
            total += tokens_de_caracteres(soma / n)
            medido = True
        else:
            total += SAIDA_PADRAO[c]
    if not medido:
        return total, "padrão"
    n = min(medias[c][1] for c in comandos if c in medias)
    return total, f"medido ({n} consultas)"


# ---------- Cache por arquivo (a aba Skills só recalcula o que mudou) ----------
# Guardado em cerebro/.log/tokens-cache.json (fora do git). Cada entrada lembra data de modificação e tamanho
# dos arquivos de que depende, e o fator de estimativa usado: mudou qualquer um, recalcula.

_CACHE = None  # dicionário em uso (só enquanto o painel roda)


def _assinatura(caminhos):
    saida = []
    for c in caminhos:
        try:
            st = os.stat(c)
            saida.append([str(c), st.st_mtime_ns, st.st_size])
        except OSError:
            saida.append([str(c), None, None])
    return saida


def _com_cache(chave, caminhos, calcular, calibrado=True):
    if _CACHE is None:
        return calcular()
    sig, fator = _assinatura(caminhos), (ler_config_tokens() if calibrado else "padrão")
    antigo = _CACHE["dados"].get(chave)
    if antigo and antigo.get("assinatura") == sig and antigo.get("fator") == fator:
        _CACHE["acertos"] += 1
        return antigo["valor"]
    valor = calcular()
    _CACHE["dados"][chave] = {"assinatura": sig, "fator": fator, "valor": valor}
    _CACHE["calculados"] += 1
    return valor


def abrir_cache(base=None):
    """Liga o cache (carrega o arquivo, se houver). Devolve o dicionário de contagem."""
    global _CACHE
    arquivo = None
    try:
        arquivo = (Path(base) if base else cerebro.localizar_cerebro()) / ".log" / "tokens-cache.json"
        dados = json.loads(arquivo.read_text(encoding="utf-8"))
        dados = dados if isinstance(dados, dict) else {}
    except (OSError, ValueError):
        dados = {}
    _CACHE = {"arquivo": arquivo, "dados": dados, "acertos": 0, "calculados": 0}
    return _CACHE


def fechar_cache():
    """Desliga o cache e grava o que mudou (sem entradas de arquivos que não existem mais). Devolve {acertos, calculados}."""
    global _CACHE
    c, _CACHE = _CACHE, None
    if not c:
        return {"acertos": 0, "calculados": 0}
    if c["calculados"] and c["arquivo"]:
        vivos = {k: v for k, v in c["dados"].items() if v.get("assinatura") and Path(v["assinatura"][0][0]).exists()}
        try:
            c["arquivo"].parent.mkdir(parents=True, exist_ok=True)
            with open(c["arquivo"], "w", encoding="utf-8", newline="\n") as f:
                json.dump(vivos, f, ensure_ascii=False, separators=(",", ":"))
        except OSError:
            pass  # sem cache nesta volta; o resultado continua certo
    return {"acertos": c["acertos"], "calculados": c["calculados"]}


def custo_skill(pasta, base=None, alvo=None):
    """{fixo, ao_usar, extras, saida_ferramenta, total_estimado_por_uso, ...} de uma pasta de skill.
    O fixo vem só do cabeçalho YAML (name + description); total_estimado_por_uso = ao usar + extras + saída.
    Com alvo, vale o SKILL.md da variante dele (variantes/<alvo>/SKILL.md), se houver."""
    pasta = Path(pasta)
    extras = _extras_da_skill(pasta)
    skill_md = skills.arquivo_skill(pasta, alvo)
    arquivos = [skill_md, pasta / "skill.json"] + [pasta / r for r in extras]
    calibrado = (alvo or "claude") == "claude"  # o fator da API é do tokenizador do Claude; as outras IAs usam a estimativa padrão
    chave = "skill:" + ("" if calibrado else "padrao:") + str(skill_md)
    nucleo = _com_cache(chave, arquivos, lambda: _custo_nucleo(pasta, extras, skill_md, calibrado), calibrado)
    saida, fonte = media_saida_ferramenta(pasta.name, base)  # depende do log, que muda a cada consulta: nunca vai para o cache
    return {**nucleo, "saida_ferramenta": saida, "saida_fonte": fonte, "total_estimado_por_uso": nucleo["ao_usar"] + nucleo["extras"] + saida}


def _custo_nucleo(pasta, arquivos, skill_md=None, calibrado=True):
    campos, corpo = _cabecalho_e_corpo(skill_md or pasta / "SKILL.md")
    nome = campos.get("name") or pasta.name
    descricao = campos.get("description")
    if descricao is None:  # sem description, a IA usa a primeira linha não vazia do conteúdo
        descricao = next((l.strip() for l in corpo.splitlines() if l.strip()), "")
    listagem = f"{nome}: {descricao}" + (f" {campos['when_to_use']}" if campos.get("when_to_use") else "")
    fixo = estimar_tokens(listagem, calibrado=calibrado)
    ao_usar = estimar_tokens(corpo.strip(), calibrado=calibrado)
    extras = 0
    for rel in arquivos:
        try:
            extras += estimar_tokens((pasta / rel).read_bytes().decode("utf-8-sig"), calibrado=calibrado)
        except (OSError, UnicodeDecodeError):
            continue  # binário ou ilegível: não entra como texto
    return {"nome": pasta.name, "fixo": fixo, "ao_usar": ao_usar, "extras": extras,
            "descricao_caracteres": len(descricao), "arquivos_extras": arquivos}


# ---------- Custo do que está instalado ----------

# arquivos de instruções que entram em toda conversa, por IA (a pasta global é a mesma das skills, um nível acima)
# o que está CONFIRMADO por teste (docs/antigravity.md). O que não está aparece no painel, mas fica fora do total.
CONFIRMADO = {"claude": {"global", "projeto"}, "antigravity": {"projeto"}}
PASTAS_DE_REGRAS = (".agents/rules", ".agent/rules")  # o agy lê as regras do projeto nestas pastas (CONFIRMADO; o nome antigo também)


def _sempre_ativa(caminho):
    """Regra do agy só entra com 'trigger: always_on' no cabeçalho (CONFIRMADO: sem o cabeçalho o arquivo é ignorado)."""
    try:
        texto = caminho.read_bytes().decode("utf-8-sig", errors="replace")
    except OSError:
        return False
    cabecalho = re.match(r"---\r?\n(.*?)\r?\n---", texto, re.S)
    return bool(cabecalho) and re.search(r"^trigger:\s*always_on\s*$", cabecalho.group(1), re.M) is not None


def _regras_do_projeto_agy(pasta):
    saida = []
    for rel in PASTAS_DE_REGRAS:
        pasta_regras = Path(pasta) / rel
        if pasta_regras.is_dir():
            saida += [f for f in sorted(pasta_regras.glob("*.md")) if _sempre_ativa(f)]
    return saida


# arquivos de instruções que a IA lê em toda conversa, por escopo (global = a pasta global das skills, um nível acima)
INSTRUCOES = {
    "claude": {
        "global": lambda: [skills.DESTINOS["claude"]["global"]().parent / "CLAUDE.md"],
        "projeto": lambda pasta: [Path(pasta) / "CLAUDE.md"],
    },
    # Antigravity: AGENTS.md + regras always_on no projeto (CONFIRMADOS); o global é ~/.gemini/GEMINI.md (NÃO CONFIRMADO)
    "antigravity": {
        "global": lambda: [skills.DESTINOS["antigravity"]["global"]().parent.parent / "GEMINI.md"],
        "projeto": lambda pasta: [Path(pasta) / "AGENTS.md"] + _regras_do_projeto_agy(pasta),
    },
}


def _tokens_do_arquivo(caminho, calibrado=True):
    if not Path(caminho).is_file():
        return None

    def calcular():
        try:
            return estimar_tokens(Path(caminho).read_bytes().decode("utf-8-sig", errors="replace"), calibrado=calibrado)
        except OSError:
            return None
    chave = "md:" + ("" if calibrado else "padrao:") + str(caminho)
    n = _com_cache(chave, [caminho], calcular, calibrado)
    return None if n is None else {"arquivo": str(caminho), "tokens": n}


def _regras(alvo, escopo, pasta=None):
    """Instruções de uma IA num escopo: {arquivos: [{arquivo, tokens}], tokens, confirmado}; None se não há nenhum arquivo."""
    ler = INSTRUCOES[alvo][escopo]
    arquivos = []
    for caminho in (ler() if escopo == "global" else ler(pasta)):
        item = _tokens_do_arquivo(caminho, calibrado=(alvo == "claude"))
        if item:
            arquivos.append(item)
    if not arquivos:
        return None
    return {"arquivos": arquivos, "tokens": sum(a["tokens"] for a in arquivos), "confirmado": escopo in CONFIRMADO[alvo]}


def _skills_em(raiz, alvo="claude"):
    """Custo fixo de cada skill (pasta com SKILL.md) em uma pasta de skills, qualquer que seja a origem."""
    saida = []
    if not raiz.is_dir():
        return saida
    for pasta in sorted(p for p in raiz.iterdir() if p.is_dir() and not p.name.startswith((".", "_")) and (p / "SKILL.md").is_file()):
        saida.append({"nome": pasta.name, "fixo": custo_skill(pasta, base=None, alvo=alvo)["fixo"], "gerenciada": (pasta / skills.MARCA).is_file()})
    return saida


def _pasta_do_projeto(projeto):
    achado = next((p for p in projetos.listar() if p["id"] == projeto), None)
    if not achado:
        raise ValueError(f"projeto não encontrado: {projeto}")
    return achado["pasta"]


def custo_instalado(alvo="claude", escopo="global", projeto=None):
    """Imposto fixo de um lugar: soma do fixo de TODAS as skills instaladas ali + as instruções globais e do projeto
    (quando há projeto) que a IA lê. Instruções não confirmadas aparecem, mas ficam fora do total."""
    pasta_projeto = _pasta_do_projeto(projeto) if projeto else None
    raiz = skills.pasta_destino(alvo, escopo, projeto, pasta_projeto)
    lista = _skills_em(raiz, alvo)
    global_md = _regras(alvo, "global")
    projeto_md = _regras(alvo, "projeto", pasta_projeto) if pasta_projeto else None
    total = sum(s["fixo"] for s in lista) + sum(x["tokens"] for x in (global_md, projeto_md) if x and x["confirmado"])
    return {"alvo": alvo, "escopo": escopo, "projeto": projeto, "pasta": str(raiz), "skills": lista,
            "skills_total": sum(s["fixo"] for s in lista), "claude_md_global": global_md, "claude_md_projeto": projeto_md, "total": total}


def skills_de_plugins(pasta_claude=None):
    """{'plugin:skill': fixo} das skills dos plugins instalados (plugins/installed_plugins.json). Elas entram na lista de
    skills de TODA conversa, mas não estão em ~/.claude/skills, então ficavam fora da conta. Só leitura; sem o arquivo, {}."""
    pasta = Path(pasta_claude) if pasta_claude else skills.DESTINOS["claude"]["global"]().parent
    try:
        dados = json.loads((pasta / "plugins" / "installed_plugins.json").read_bytes().decode("utf-8-sig"))
    except (OSError, ValueError):
        return {}
    saida = {}
    plugins = dados.get("plugins") if isinstance(dados, dict) else None
    for chave, instalacoes in (plugins.items() if isinstance(plugins, dict) else []):
        nome_plugin = str(chave).split("@")[0]
        for inst in instalacoes if isinstance(instalacoes, list) else []:
            raiz = Path(str(inst.get("installPath", ""))) / "skills" if isinstance(inst, dict) else None
            for s in _skills_em(raiz) if raiz and raiz.is_dir() else []:
                saida[f"{nome_plugin}:{s['nome']}"] = s["fixo"]
    return saida


def contexto(alvo="claude", projeto=None):
    """Tudo o que paga o imposto fixo numa conversa (skills globais e do projeto, e as instruções), em partes
    que dá para alterar na simulação sem reler nenhum arquivo."""
    glob = custo_instalado(alvo, "global")
    proj = custo_instalado(alvo, "projeto", projeto) if projeto else None
    md_g = glob["claude_md_global"]
    md_p = proj["claude_md_projeto"] if proj else None
    return {"alvo": alvo, "projeto": projeto,
            "global": {s["nome"]: s["fixo"] for s in glob["skills"]},
            "plugins": skills_de_plugins() if alvo == "claude" else {},  # plugins são do Claude (no agy não confirmado: zero)
            "projeto_skills": {s["nome"]: s["fixo"] for s in proj["skills"]} if proj else {},
            "md_global": md_g["tokens"] if md_g and md_g["confirmado"] else 0,
            "md_projeto": md_p["tokens"] if md_p and md_p["confirmado"] else 0,
            "nao_confirmado": md_g["tokens"] if md_g and not md_g["confirmado"] else 0}


def total_do_contexto(ctx):
    """Soma o contexto: skills (a do projeto vale no lugar da global de mesmo nome), skills de plugins e as instruções
    confirmadas. O que não está confirmado vai à parte, fora do total."""
    por_nome = {**ctx["global"], **ctx["projeto_skills"]}
    skills_tokens = sum(por_nome.values())
    plugins = ctx.get("plugins") or {}
    plugins_tokens = sum(plugins.values())
    return {"contexto": f"projeto {ctx['projeto']}" if ctx["projeto"] else "global", "projeto": ctx["projeto"],
            "skills": len(por_nome), "skills_tokens": skills_tokens, "plugins": len(plugins), "plugins_tokens": plugins_tokens,
            "claude_md_global": ctx["md_global"], "claude_md_projeto": ctx["md_projeto"], "nao_confirmado": ctx.get("nao_confirmado", 0),
            "total": skills_tokens + plugins_tokens + ctx["md_global"] + ctx["md_projeto"]}


def simular(ctx, acao, nome, escopo, fixo=0):
    """O imposto fixo total DEPOIS de instalar (ou remover) uma skill em um escopo. None se o escopo não existe
    (escopo projeto sem projeto escolhido)."""
    if escopo == "projeto" and not ctx["projeto"]:
        return None
    chave = "global" if escopo == "global" else "projeto_skills"
    novo = {**ctx, "global": dict(ctx["global"]), "projeto_skills": dict(ctx["projeto_skills"])}
    if acao == "instalar":
        novo[chave][nome] = fixo
    else:
        novo[chave].pop(nome, None)
    return total_do_contexto(novo)["total"]


def imposto_conversa(alvo="claude", projeto=None):
    """O imposto fixo REAL de uma conversa: skills globais + skills do projeto (a do projeto vale no lugar da global de
    mesmo nome) + CLAUDE.md global + CLAUDE.md do projeto. Sem projeto: só o que é global."""
    return total_do_contexto(contexto(alvo, projeto))


# ---------- Relatório ----------

def alertas_de_skill(c):
    saida = []
    if c["descricao_caracteres"] > MAX_DESCRICAO:
        saida.append(f"descrição com {c['descricao_caracteres']} caracteres (máx. {MAX_DESCRICAO}): paga-se em toda conversa")
    if c["ao_usar"] > MAX_CORPO_TOKENS:
        saida.append(f"corpo com ~{c['ao_usar']} tokens (máx. {MAX_CORPO_TOKENS}): cada uso pesa")
    return saida


NOMES_IA = {"claude": "Claude", "antigravity": "Antigravity"}


def estimativa_do(alvo="claude"):
    """Como a conta é feita para cada IA. Claude: fator calibrado pela API (se houver) ou a regra padrão. As outras IAs:
    só a regra padrão, rotulada 'estimado' (cada modelo conta tokens de um jeito; nenhuma API é chamada)."""
    if alvo != "claude":
        return {"fator": FATOR_ACENTOS, "origem": "estimado",
                "regra": f"caracteres/4 para cima, x{str(FATOR_ACENTOS).replace('.', ',')} com acentos; cada modelo conta de um jeito"}
    fator = ler_config_tokens()
    return {"fator": fator if fator is not None else FATOR_ACENTOS, "origem": "calibrado" if fator is not None else "padrão",
            "regra": "caracteres/4 para cima" + (f", x{fator}" if fator is not None else f", x{str(FATOR_ACENTOS).replace('.', ',')} com acentos")}


def _ias_do_projeto(p):
    """As IAs de um projeto: a dele e a reserva (sem 'ia', vale o Claude, como no projetos.py)."""
    return [x for x in (p.get("ia") or "claude", p.get("ia_reserva")) if x]


def relatorio(bib=None, alvo="ambos"):
    """Uma seção por IA: skills (com a variante dela), imposto fixo por conversa e alertas. Um projeto entra na seção
    das IAs configuradas nele (ia e ia_reserva); o contexto global entra em todas."""
    bib = Path(bib or skills.BIBLIOTECA)
    try:
        lista = [p for p in projetos.listar() if Path(p["pasta"]).is_dir()]
    except ValueError:
        lista = []
    secoes, alertas = [], []
    for a in skills.alvos_de(alvo):
        linhas, alertas_skills = [], []
        for s in skills.listar(bib):
            c = custo_skill(bib / s["pasta"], alvo=a)
            c["alertas"] = alertas_de_skill(c)
            c["titulo"] = s.get("titulo", c["nome"])
            linhas.append(c)
            alertas_skills += [{"alvo": a, "skill": c["nome"], "mensagem": m} for m in c["alertas"]]
        impostos, alertas_imposto = [], []
        for proj in [None] + [p["id"] for p in lista if a in _ias_do_projeto(p)]:
            try:
                i = imposto_conversa(a, proj)
            except ValueError:
                continue
            impostos.append(i)
            if i["total"] > MAX_IMPOSTO_TOKENS:
                alertas_imposto.append({"alvo": a, "skill": None, "mensagem": f"imposto fixo ({i['contexto']}, {NOMES_IA.get(a, a)}): {i['total']} "
                                        f"tokens (máx. {MAX_IMPOSTO_TOKENS}) em toda conversa: {i['skills']} skills + instruções"})
        secoes.append({"alvo": a, "nome": NOMES_IA.get(a, a), "estimativa": estimativa_do(a), "skills": linhas,
                       "total": {"skills": len(linhas), "fixo": sum(c["fixo"] for c in linhas)}, "imposto": impostos,
                       "alertas": alertas_skills + alertas_imposto})
        alertas += alertas_skills + alertas_imposto
    vistos, unicos = set(), []
    for x in alertas:  # a mesma skill estoura igual nas duas IAs: aparece uma vez
        if (x["skill"], x["mensagem"]) not in vistos:
            vistos.add((x["skill"], x["mensagem"]))
            unicos.append(x)
    return {
        "conceito": CONCEITO,
        "secoes": secoes,
        "alertas": unicos,
        "limites": {"descricao_caracteres": MAX_DESCRICAO, "corpo_tokens": MAX_CORPO_TOKENS, "imposto_tokens": MAX_IMPOSTO_TOKENS},
    }


def formatar_relatorio(r):
    linhas = []
    for sec in r["secoes"]:
        e = sec["estimativa"]
        linhas.append(f"=== {sec['nome']} ===")
        linhas.append(f"ESTIMATIVA ({e['regra']}; {e['origem']}). fixo = nome+descrição, em toda conversa; "
                      "ao usar = corpo do SKILL.md; saída = o que o cerebro.py devolve; por uso = ao usar + extras + saída.")
        largura = max([len(c["nome"]) for c in sec["skills"]] + [5])
        linhas.append(f"{'skill':<{largura}}  {'fixo':>6}  {'ao_usar':>7}  {'extras':>6}  {'saida':>6}  {'por_uso':>7}")
        for c in sec["skills"]:
            linhas.append(f"{c['nome']:<{largura}}  {c['fixo']:>6}  {c['ao_usar']:>7}  {c['extras']:>6}  {c['saida_ferramenta']:>6}  "
                          f"{c['total_estimado_por_uso']:>7}" + ("  [saída " + c["saida_fonte"] + "]" if c["saida_fonte"] not in ("nenhuma",) else ""))
        linhas.append(f"{'total':<{largura}}  {sec['total']['fixo']:>6}  (fixo das {sec['total']['skills']} skills da biblioteca, se todas instaladas)")
        linhas.append("imposto fixo por conversa (skills instaladas + instruções):")
        for i in sec["imposto"]:
            linhas.append(f"  {i['contexto']:<22} {i['total']:>6}  ({i['skills']} skills {i['skills_tokens']}, instruções globais {i['claude_md_global']}"
                          + (f", do projeto {i['claude_md_projeto']}" if i["projeto"] else "")
                          + (f"; fora do total, não confirmado: {i['nao_confirmado']}" if i["nao_confirmado"] else "") + ")")
    if len(r["secoes"]) > 1:
        linhas.append("lado a lado (imposto fixo por conversa):")
        contextos = []
        for sec in r["secoes"]:
            for i in sec["imposto"]:
                if i["contexto"] not in contextos:
                    contextos.append(i["contexto"])
        linhas.append("  " + f"{'contexto':<22}" + "".join(f"  {s['nome']:>12}" for s in r["secoes"]))
        for ctx in contextos:
            valores = []
            for sec in r["secoes"]:
                achado = next((i for i in sec["imposto"] if i["contexto"] == ctx), None)
                valores.append(f"  {achado['total']:>12}" if achado else f"  {'-':>12}")
            linhas.append("  " + f"{ctx:<22}" + "".join(valores))
    linhas += [f"!! {(a['skill'] + ': ') if a['skill'] else ''}{a['mensagem']}" for a in r["alertas"]]
    return linhas


# ---------- Painel da aba Skills do widget ----------

# ---------- Painel da aba Skills do widget ----------

FAIXA_VERDE = 1500  # até aqui a barra é verde; até MAX_IMPOSTO_TOKENS, amarela; acima, vermelha


def painel(escopo="projeto", projeto=None, alvo="claude", bib=None):
    """Tudo que a aba Skills mostra, numa chamada só: imposto fixo do contexto escolhido, um cartão por skill da
    biblioteca (manifesto + custos + onde está instalada + simulação de instalar/remover) e o cache usado.
    escopo = onde as ações Instalar/Remover vão agir E qual conversa o imposto mede (global = sem projeto)."""
    if escopo not in ("projeto", "global"):
        raise ValueError("escopo precisa ser projeto ou global")
    if alvo not in skills.DESTINOS:
        raise ValueError(f"alvo desconhecido: {alvo} (conheço: {', '.join(skills.DESTINOS)})")
    if escopo == "projeto" and not projeto:
        escopo = "global"  # sem projeto escolhido só existe o global
    bib = Path(bib or skills.BIBLIOTECA)
    abrir_cache()
    try:
        ctx = contexto(alvo, projeto if escopo == "projeto" else None)
        imposto = total_do_contexto(ctx)
        instaladas = skills.status(bib)["instalacoes"]
        cartoes = []
        for s in skills.listar(bib):
            nome = s["pasta"]
            c = custo_skill(bib / nome, alvo=alvo) if not s["problemas"] else None
            lugares = {}
            for chave in ("global", "projeto"):
                achou = next((i for i in instaladas if i["skill"] == nome and i["alvo"] == alvo and i["escopo"] == chave
                              and (chave == "global" or i["projeto"] == projeto)), None)
                lugares[chave] = {"estado": achou["estado"], "versao": achou["instalada"]} if achou else None
            aqui = lugares[escopo]
            gerenciada = bool(aqui) and aqui["estado"] in ("igual", "desatualizada")
            cartao = {k: s.get(k) for k in ("titulo", "descricao_curta", "exemplo_de_uso", "categoria", "versao", "autor", "origem", "alternativa_a", "compativel")}
            cartao.update({"nome": nome, "problemas": s["problemas"], "avisos": s["avisos"], "instalada": lugares,
                           "custo": None, "alertas": [], "sim": None})
            if c:
                cartao["custo"] = {k: c[k] for k in ("fixo", "ao_usar", "extras", "saida_ferramenta", "total_estimado_por_uso")}
                cartao["alertas"] = alertas_de_skill(c)
                acao = "remover" if gerenciada else "instalar"
                if not (aqui and not gerenciada):  # instalada por outro meio: nada a simular, a ação é recusada
                    depois = simular(ctx, acao, nome, escopo, c["fixo"])
                    cartao["sim"] = {"acao": acao, "escopo": escopo, "antes": imposto["total"], "depois": depois}
            if s.get("alternativa_a"):
                presentes = {**ctx["global"], **ctx["projeto_skills"]}
                cartao["alternativa_instalada"] = [a for a in s["alternativa_a"] if a in presentes]
            cartoes.append(cartao)
        com_custo = [c["custo"] for c in cartoes if c["custo"]]
        escala = max([1] + [v for c in com_custo for v in (c["fixo"], c["ao_usar"])])
        try:
            lista_projetos = [{"id": p["id"], "nome": p["nome"]} for p in projetos.listar() if Path(p["pasta"]).is_dir()]
        except ValueError:
            lista_projetos = []
    finally:
        cache = fechar_cache()
    return {
        "escopo": escopo, "projeto": projeto if escopo == "projeto" else None, "alvo": alvo,
        "imposto": {**imposto, "limite": MAX_IMPOSTO_TOKENS, "faixa_verde": FAIXA_VERDE,
                    "cor": "verde" if imposto["total"] <= FAIXA_VERDE else "amarela" if imposto["total"] <= MAX_IMPOSTO_TOKENS else "vermelha"},
        "skills": cartoes, "escala": escala, "projetos": lista_projetos,
        "categorias": list(skills.CATEGORIAS), "cache": cache, "conceito": CONCEITO,
        "estimativa": estimativa_do(alvo),
    }


# ---------- Opção precisa: contagem pela API da Anthropic (só com --enviar) ----------

def contar_tokens_api(texto, modelo, chave, url=API_URL, timeout=20):
    """Pede à API o número real de tokens (POST /v1/messages/count_tokens). Gratuito; limite de requisições por minuto.
    A chave só vai no cabeçalho x-api-key e nunca é impressa."""
    corpo = json.dumps({"model": modelo, "messages": [{"role": "user", "content": texto}]}).encode("utf-8")
    pedido = urllib.request.Request(url, data=corpo, method="POST", headers={
        "x-api-key": chave, "anthropic-version": API_VERSAO, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(pedido, timeout=timeout) as r:
            dados = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as erro:
        try:
            msg = json.loads(erro.read().decode("utf-8", errors="replace"))["error"]["message"]
        except (ValueError, KeyError, TypeError):
            msg = erro.reason
        finally:
            erro.close()
        raise ValueError(f"a API respondeu {erro.code}: {str(msg)[:200]}")
    except (urllib.error.URLError, OSError, ValueError) as erro:
        raise ValueError(f"não consegui falar com a API: {getattr(erro, 'reason', erro)}")
    n = dados.get("input_tokens")
    if not isinstance(n, int):
        raise ValueError("resposta inesperada da API (sem input_tokens)")
    return n


def _gravar_fator(fator, calibracao):
    """Grava (ou apaga, com fator None) tokens_fator no ~/.cerebro.json sem perder as outras chaves."""
    arquivo = cerebro.arquivo_config()
    dados = {}
    if arquivo.exists():
        try:
            dados = json.loads(arquivo.read_text(encoding="utf-8-sig"))
        except ValueError:
            raise ValueError(f"{arquivo} não é um JSON válido; corrija antes (nada foi alterado)")
        if not isinstance(dados, dict):
            raise ValueError(f"{arquivo} precisa ser um objeto JSON")
    if fator is None:
        dados.pop("tokens_fator", None)
        dados.pop("tokens_calibracao", None)
    else:
        dados["tokens_fator"] = fator
        dados["tokens_calibracao"] = calibracao
    projetos._gravar_atomico(arquivo, json.dumps(dados, ensure_ascii=False, indent=2) + "\n")


def calibrar(enviar=False, modelo=MODELO_PADRAO, chave=None, url=API_URL, bib=None):
    """Calibra o fator de estimativa com o número REAL de tokens de alguns textos (os SKILL.md da biblioteca).
    Sem enviar=True NADA é enviado: devolve só o plano. Com enviar=True precisa de ANTHROPIC_API_KEY."""
    bib = Path(bib or skills.BIBLIOTECA)
    textos = [(p.name, (p / "SKILL.md").read_text(encoding="utf-8-sig")) for p in skills._pastas_de_skill(bib)]
    if not textos:
        raise ValueError("a biblioteca não tem skills para usar como amostra")
    plano = {"enviado": False, "destino": url, "modelo": modelo,
             "amostras": [{"skill": n, "caracteres": len(t)} for n, t in textos] + [{"skill": "(mensagem mínima, para descontar o enquadramento)", "caracteres": 1}],
             "requisicoes": len(textos) + 1}
    if not enviar:
        return plano
    chave = chave or os.environ.get("ANTHROPIC_API_KEY")
    if not chave:
        raise ValueError("defina a variável ANTHROPIC_API_KEY para calibrar pela API (ou fique com a estimativa padrão)")
    sobrecarga = max(0, contar_tokens_api("x", modelo, chave, url) - 1)  # a mensagem "x" vale ~1 token
    reais = [max(1, contar_tokens_api(t, modelo, chave, url) - sobrecarga) for _, t in textos]
    base = sum(len(t) / 4 for _, t in textos)
    fator = round(sum(reais) / base, 4)
    _gravar_fator(fator, {"modelo": modelo, "data": datetime.datetime.now().isoformat(timespec="seconds"),
                          "amostras": len(textos), "sobrecarga": sobrecarga})
    return {**plano, "enviado": True, "fator": fator, "tokens_reais": reais, "sobrecarga": sobrecarga, "arquivo": str(cerebro.arquivo_config())}


# ---------- Linha de comando ----------

def _imprimir(args, dados, linhas):
    if args.json:
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for linha in linhas:
            print(linha)


def _cmd_relatorio(args):
    r = relatorio(alvo=args.alvo)
    _imprimir(args, r, formatar_relatorio(r))
    return 0


def _cmd_painel(args):
    r = painel(args.escopo, args.projeto, args.alvo)
    i = r["imposto"]
    linhas = [f"imposto fixo ({i['contexto']}): {i['total']} tokens ({i['cor']}); {len(r['skills'])} skills na biblioteca; "
              f"cache: {r['cache']['acertos']} acertos, {r['cache']['calculados']} calculados"]
    _imprimir(args, r, linhas)
    return 0


def _cmd_estimar(args):
    if args.arquivo and args.arquivo != "-":
        texto = Path(args.arquivo).read_bytes().decode("utf-8-sig", errors="replace")
    else:
        texto = sys.stdin.buffer.read().decode("utf-8-sig", errors="replace")
    n = estimar_tokens(texto)
    _imprimir(args, {"tokens": n, "caracteres": len(texto)}, [f"~{n} tokens ({len(texto)} caracteres; estimativa)"])
    return 0


def _cmd_calibrar(args):
    if args.esquecer:
        _gravar_fator(None, None)
        _imprimir(args, {"fator": None}, ["fator calibrado apagado; volta a estimativa padrão"])
        return 0
    r = calibrar(args.enviar, args.modelo)
    if not r["enviado"]:
        linhas = [f"NADA foi enviado. Com --enviar, mandaria {r['requisicoes']} textos a {r['destino']} (modelo {r['modelo']}):"]
        linhas += [f"  {a['skill']}  ({a['caracteres']} caracteres)" for a in r["amostras"]]
        linhas.append("O endpoint é gratuito (tem limite de requisições por minuto) e precisa de ANTHROPIC_API_KEY.")
    else:
        linhas = [f"fator calibrado: {r['fator']} (modelo {r['modelo']}; {len(r['tokens_reais'])} amostras) gravado em {r['arquivo']}"]
    _imprimir(args, r, linhas)
    return 0


def montar_parser():
    comum = argparse.ArgumentParser(add_help=False)
    comum.add_argument("--json", action="store_true", help="saída em JSON (para o widget)")
    parser = argparse.ArgumentParser(prog="tokens.py", description="Custo das skills em tokens (estimativa)")
    sub = parser.add_subparsers(dest="comando", required=True)
    p = sub.add_parser("relatorio", parents=[comum], help="uma seção por IA: skills, imposto fixo e alertas")
    p.add_argument("--alvo", choices=sorted(skills.DESTINOS) + ["ambos"], default="ambos")
    p.set_defaults(func=_cmd_relatorio)
    p = sub.add_parser("painel", parents=[comum], help="dados da aba Skills do widget")
    p.add_argument("--escopo", choices=["projeto", "global"], default="projeto")
    p.add_argument("--projeto")
    p.add_argument("--alvo", choices=sorted(skills.DESTINOS), default="claude", help="para qual IA (o custo usa a variante dela, se houver)")
    p.set_defaults(func=_cmd_painel)
    p = sub.add_parser("estimar", parents=[comum], help="tokens de um arquivo ou da entrada padrão")
    p.add_argument("arquivo", nargs="?")
    p.set_defaults(func=_cmd_estimar)
    p = sub.add_parser("calibrar", parents=[comum], help="calibra o fator pela API da Anthropic (só com --enviar)")
    p.add_argument("--enviar", action="store_true", help="AUTORIZA o envio dos textos mostrados à API (sem isso nada é enviado)")
    p.add_argument("--modelo", default=MODELO_PADRAO)
    p.add_argument("--esquecer", action="store_true", help="apaga o fator calibrado")
    p.set_defaults(func=_cmd_calibrar)
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
