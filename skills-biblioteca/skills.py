#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skills.py - biblioteca de skills do widget e instalador. Só biblioteca padrão.

  skills.py listar                       skills da biblioteca (e problemas nos manifestos)
  skills.py catalogo                     refaz o catalogo.json a partir dos skill.json
  skills.py instalar NOME --alvo claude|antigravity|ambos --escopo projeto|global [--projeto ID]
  skills.py remover NOME  --alvo claude|antigravity|ambos --escopo projeto|global [--projeto ID]
                                         "ambos" faz cada alvo por conta própria (um erro num não desfaz o outro)
  skills.py ler NOME [--alvo antigravity]  mostra o SKILL.md da biblioteca (só leitura; com a variante do alvo, se houver)
  skills.py status                       onde cada skill está instalada e se a versão difere da biblioteca
  skills.py atualizar [NOME]             reinstala o que está com versão diferente
  skills.py importar PASTA|ARQUIVO.zip [--confirmar]   traz uma skill de fora (mostra tudo antes; nunca executa)
  (todos aceitam --json)

Cada skill é uma pasta com SKILL.md + skill.json (manifesto). Ao instalar, {CAMINHO_CEREBRO} vira o caminho
do cérebro e a pasta instalada ganha um .instalado.json: só pastas com esse arquivo podem ser removidas
ou atualizadas por aqui (skills que você instalou por outro meio nunca são tocadas).

VARIANTES: se uma skill tem variantes/<alvo>/SKILL.md (ex.: variantes/antigravity/SKILL.md, para o jeito do PowerShell de passar um
corpo), esse arquivo vale no lugar do SKILL.md quando o alvo é aquele: ao instalar, ao ler e ao calcular o custo. A pasta variantes/
nunca é copiada para a instalação.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

# a biblioteca é esta pasta (SKILLS_BIBLIOTECA troca, só para testes: assim importar não suja a biblioteca de verdade)
BIBLIOTECA = Path(os.environ.get("SKILLS_BIBLIOTECA") or Path(__file__).resolve().parent)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cerebro" / "tools"))
import projetos  # noqa: E402  (cadastro dos projetos: --projeto ID)
import ias as dados_ias  # noqa: E402  (as IAs conhecidas: app/ias-dados.json; "compativel" só aceita estas)

MARCADOR = "{CAMINHO_CEREBRO}"
MARCA = ".instalado.json"
CATALOGO = "catalogo.json"
CATEGORIAS = ("cerebro", "codigo", "escrita", "blender", "roblox", "design", "outros")
CAMPOS = ("nome", "titulo", "descricao_curta", "exemplo_de_uso", "categoria", "versao", "autor", "origem",
          "compativel", "arquivos_extras")
RE_NOME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
RE_VERSAO = re.compile(r"^\d+\.\d+\.\d+$")
MAX_DESCRICAO = 200  # caracteres da description do SKILL.md (entra em toda conversa)
MAX_CORPO = 40       # linhas do SKILL.md depois do cabeçalho
PASTA_VARIANTES = "variantes"  # variantes/<alvo>/SKILL.md: o SKILL.md daquele alvo, no lugar do principal

# Onde cada IA procura skills. Para outra IA: acrescente uma entrada com "global" e "projeto".
# (SKILLS_GLOBAL_<IA> troca a pasta global; serve para os testes.)
# Antigravity (docs/antigravity.md): projeto = .agents/skills (CONFIRMADO por teste: a skill de teste foi acionada);
# global = ~/.gemini/antigravity-cli/skills (só a documentação diz; NÃO CONFIRMADO por teste).
DESTINOS = {
    "claude": {
        "global": lambda: Path(os.environ.get("SKILLS_GLOBAL_CLAUDE") or Path.home() / ".claude" / "skills"),
        "projeto": lambda pasta: Path(pasta) / ".claude" / "skills",
    },
    "antigravity": {
        "global": lambda: Path(os.environ.get("SKILLS_GLOBAL_ANTIGRAVITY") or Path.home() / ".gemini" / "antigravity-cli" / "skills"),
        "projeto": lambda pasta: Path(pasta) / ".agents" / "skills",
    },
}

# Trechos perigosos procurados em tudo o que vem de fora (só leitura: nada é executado)
PERIGOS = [
    (r"\brm\s+-[a-z]*(rf|fr)", "rm -rf: apaga pastas inteiras"),
    (r"\brm\s+\S", "rm: apaga arquivos"),
    (r"\b(del|erase|rd|rmdir)\s+(/[a-z]\s+)*/[sqf]\b", "del/rd com /s /q: apaga sem perguntar"),
    (r"\bRemove-Item\b", "Remove-Item: apaga arquivos"),
    (r"\bformat(\.com)?\s+[a-z]:", "format: formata um disco"),
    (r"\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|python\d?|powershell|pwsh|cmd)\b",
     "baixa da internet e executa na hora"),
    (r"\b(iex|Invoke-Expression)\b", "Invoke-Expression: executa um texto como comando"),
    (r"\b(powershell|pwsh)(\.exe)?\b[^\n]*\s-(e|ec|enc|encodedcommand)\s", "PowerShell com comando codificado (escondido)"),
    (r"\b(eval|exec)\s*\(", "eval/exec: executa código montado na hora"),
    (r"(\.ssh[/\\]|id_rsa|id_ed25519|\.aws[/\\]credentials|\.git-credentials|\.npmrc|Login Data|\bCookies\b|keychain|cmdkey|Get-Credential|ConvertFrom-SecureString|\.cerebro\.json|\.claude\.json)",
     "acesso a credenciais ou arquivos de login"),
    (r"\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|api[_-]?key|password|senha)\b", "menciona chave, token ou senha"),
    (r"--dangerously-skip-permissions|bypassPermissions", "pede para pular as permissões"),
    (r"\breg(\.exe)?\s+(add|delete)\b|\bSet-ItemProperty\b[^\n]*HK(LM|CU)", "altera o registro do Windows"),
    (r"\bchmod\s+777\b|\bicacls\b[^\n]*/grant", "muda permissões de arquivos"),
    (r"\b(schtasks|Register-ScheduledTask|New-Service|sc\s+create)\b", "cria tarefa agendada ou serviço"),
    (r"shell\s*=\s*True|\bos\.system\s*\(|\bStart-Process\b|\bchild_process\b|\bsubprocess\.(Popen|run|call)\b",
     "roda outros programas (confira quais)"),
]
PERIGOS = [(re.compile(p, re.IGNORECASE), motivo) for p, motivo in PERIGOS]
EXT_SCRIPT = {".py", ".ps1", ".psm1", ".sh", ".bash", ".bat", ".cmd", ".js", ".mjs", ".ts", ".vbs", ".rb", ".pl", ".exe", ".dll", ".msi", ".jar"}
MAX_ZIP = 20 * 1024 * 1024  # bytes descompactados
MAX_ARQUIVOS = 500


# ---------- Biblioteca e manifestos ----------

def _ler_json(caminho):
    with open(caminho, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _escrever_se_mudou(caminho, texto):
    try:
        if Path(caminho).read_text(encoding="utf-8") == texto:
            return False
    except OSError:
        pass
    with open(caminho, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto)
    return True


def _cabecalho_skill(texto):
    """Campos do cabeçalho YAML (name, description...) e o corpo do SKILL.md."""
    partes = texto.replace("\r\n", "\n").split("---", 2)
    if not texto.lstrip("\ufeff").startswith("---") or len(partes) < 3:
        return {}, texto
    campos = {}
    for linha in partes[1].splitlines():
        chave, sep, valor = linha.partition(":")
        if sep and chave.strip() and not linha.startswith(" "):
            campos[chave.strip()] = valor.strip().strip('"').strip("'")
    return campos, partes[2]


def arquivo_skill(pasta, alvo=None):
    """O SKILL.md que vale para o alvo: variantes/<alvo>/SKILL.md se existir, senão o principal."""
    if alvo:
        variante = Path(pasta) / PASTA_VARIANTES / str(alvo) / "SKILL.md"
        if variante.is_file():
            return variante
    return Path(pasta) / "SKILL.md"


def variantes_de(pasta):
    """Os alvos que têm variante nesta skill (pastas variantes/<alvo>/ com SKILL.md)."""
    raiz = Path(pasta) / PASTA_VARIANTES
    if not raiz.is_dir():
        return []
    return sorted(d.name for d in raiz.iterdir() if d.is_dir() and (d / "SKILL.md").is_file())


def avisos_skill_md(texto):
    """Avisos de formato do SKILL.md (não impedem nada): cabeçalho, tamanho da descrição e do corpo."""
    campos, corpo = _cabecalho_skill(texto)
    if not campos:
        return ["SKILL.md sem cabeçalho YAML na linha 1"]
    avisos = []
    if len(campos.get("description", "")) > MAX_DESCRICAO:
        avisos.append(f"description com {len(campos['description'])} caracteres (máx. {MAX_DESCRICAO})")
    linhas = corpo.strip("\n").splitlines()
    if len(linhas) > MAX_CORPO:
        avisos.append(f"corpo com {len(linhas)} linhas (máx. {MAX_CORPO})")
    return avisos


def validar_manifesto(m, pasta):
    """Problemas de um skill.json (lista vazia = ok)."""
    if not isinstance(m, dict):
        return ["skill.json não é um objeto"]
    erros = [f"campo ausente: {c}" for c in CAMPOS if c not in m]
    if m.get("nome") != pasta.name:
        erros.append(f"nome ({m.get('nome')}) diferente da pasta ({pasta.name})")
    if "categoria" in m and m["categoria"] not in CATEGORIAS:
        erros.append(f"categoria inválida (use {', '.join(CATEGORIAS)})")
    if "versao" in m and not RE_VERSAO.match(str(m["versao"])):
        erros.append("versao no formato 1.2.3")
    if "compativel" in m and (not isinstance(m["compativel"], list) or not m["compativel"]):
        erros.append("compativel precisa ser uma lista (ex.: [\"claude\"])")
    elif "compativel" in m:
        conhecidas = dados_ias.ids()
        for ia in m["compativel"]:
            if not isinstance(ia, str) or ia not in conhecidas:
                erros.append(f"compativel: IA desconhecida: {ia!r} (conheço: {', '.join(conhecidas)})")
    for alvo in variantes_de(pasta):
        if alvo not in dados_ias.ids():
            erros.append(f"variantes/{alvo}: IA desconhecida (conheço: {', '.join(dados_ias.ids())})")
        else:
            campos, _ = _cabecalho_skill((pasta / PASTA_VARIANTES / alvo / "SKILL.md").read_text(encoding="utf-8-sig"))
            if campos.get("name") != pasta.name:
                erros.append(f"variantes/{alvo}/SKILL.md: name ({campos.get('name')}) diferente da pasta ({pasta.name})")
    for extra in m.get("arquivos_extras", []) if isinstance(m.get("arquivos_extras"), list) else []:
        if not _caminho_seguro(extra) or not (pasta / extra).is_file():
            erros.append(f"arquivo extra não encontrado: {extra}")
    if "alternativa_a" in m and not isinstance(m["alternativa_a"], list):
        erros.append("alternativa_a precisa ser uma lista")
    return erros


def _caminho_seguro(rel):
    """Caminho relativo que não sai da pasta (sem .., sem C:\\, sem /)."""
    p = Path(str(rel))
    return bool(str(rel)) and not p.is_absolute() and not p.drive and ".." not in p.parts


def _pastas_de_skill(bib):
    return sorted(p for p in Path(bib).iterdir() if p.is_dir() and (p / "SKILL.md").is_file() and not p.name.startswith((".", "_")))


def listar(bib=None):
    """Skills da biblioteca: manifesto + problemas + avisos do SKILL.md."""
    saida = []
    for pasta in _pastas_de_skill(bib or BIBLIOTECA):
        try:
            m = _ler_json(pasta / "skill.json")
        except (OSError, ValueError) as erro:
            m, problemas = {"nome": pasta.name}, [f"skill.json ausente ou inválido ({erro.__class__.__name__})"]
        else:
            problemas = validar_manifesto(m, pasta)
        avisos = avisos_skill_md((pasta / "SKILL.md").read_text(encoding="utf-8-sig"))
        for alvo in variantes_de(pasta):  # a variante segue as mesmas regras (descrição e corpo curtos)
            avisos += [f"[{alvo}] {a}" for a in avisos_skill_md((pasta / PASTA_VARIANTES / alvo / "SKILL.md").read_text(encoding="utf-8-sig"))]
        saida.append({**m, "pasta": pasta.name, "variantes": variantes_de(pasta), "problemas": problemas, "avisos": avisos})
    return saida


def ler_skill(nome, bib=None, alvo=None):
    """Conteúdo do SKILL.md de uma skill da biblioteca (só leitura: a aba Skills mostra em modo de leitura).
    Com alvo, a variante dele, se existir."""
    if not RE_NOME.match(str(nome)):
        raise ValueError(f"nome de skill inválido: {nome}")
    if alvo is not None and alvo not in DESTINOS:
        raise ValueError(f"alvo desconhecido: {alvo} (conheço: {', '.join(DESTINOS)})")
    arquivo = arquivo_skill(Path(bib or BIBLIOTECA) / nome, alvo)
    if not arquivo.is_file():
        raise ValueError(f"skill não está na biblioteca: {nome}")
    return arquivo.read_bytes().decode("utf-8-sig", errors="replace").replace("\r\n", "\n")


def gerar_catalogo(bib=None):
    """catalogo.json = os skill.json válidos, em ordem de nome (sem data: só muda quando uma skill muda)."""
    bib = Path(bib or BIBLIOTECA)
    skills = [{k: s[k] for k in s if k not in ("pasta", "problemas", "avisos", "variantes")} for s in listar(bib) if not s["problemas"]]
    texto = json.dumps({"skills": skills}, ensure_ascii=False, indent=2) + "\n"
    _escrever_se_mudou(bib / CATALOGO, texto)
    return skills


def _manifesto(bib, nome):
    if not RE_NOME.match(str(nome)):
        raise ValueError(f"nome de skill inválido: {nome}")
    pasta = Path(bib) / nome
    if not (pasta / "SKILL.md").is_file():
        raise ValueError(f"skill não está na biblioteca: {nome}")
    try:
        m = _ler_json(pasta / "skill.json")
    except (OSError, ValueError):
        raise ValueError(f"{nome}: skill.json ausente ou inválido")
    problemas = validar_manifesto(m, pasta)
    if problemas:
        raise ValueError(f"{nome}: " + "; ".join(problemas))
    return m


# ---------- Destinos e instalação ----------

def caminho_cerebro():
    """cerebro_dir do ~/.cerebro.json (CEREBRO_CONFIG troca o arquivo), com barras normais."""
    arquivo = Path(os.environ.get("CEREBRO_CONFIG") or Path.home() / ".cerebro.json")
    try:
        valor = _ler_json(arquivo).get("cerebro_dir")
    except (OSError, ValueError, AttributeError):
        valor = None
    return str(Path(valor)).replace("\\", "/") if valor else None


def pasta_destino(alvo, escopo, projeto=None, pasta_projeto=None):
    """Pasta de skills da IA no escopo pedido. Projeto: pelo --projeto ID (projetos.json) ou por uma pasta."""
    if alvo not in DESTINOS:
        raise ValueError(f"alvo desconhecido: {alvo} (conheço: {', '.join(DESTINOS)})")
    if escopo == "global":
        return DESTINOS[alvo]["global"]()
    if escopo != "projeto":
        raise ValueError("escopo precisa ser projeto ou global")
    if not pasta_projeto:
        if not projeto:
            raise ValueError("escopo projeto precisa de --projeto ID")
        achado = next((p for p in projetos.listar() if p["id"] == projeto), None)
        if not achado:
            raise ValueError(f"projeto não encontrado: {projeto}")
        pasta_projeto = achado["pasta"]
    if not Path(pasta_projeto).is_dir():
        raise ValueError(f"a pasta do projeto não existe: {pasta_projeto}")
    return DESTINOS[alvo]["projeto"](pasta_projeto)


def _conteudos(bib, nome, m, alvo=None):
    """{arquivo: bytes} do que vai ser instalado, com {CAMINHO_CEREBRO} trocado nos arquivos de texto.
    O SKILL.md é o da variante do alvo, se houver; a pasta variantes/ nunca vai junto."""
    cerebro = None
    saida = {}
    for rel in ["SKILL.md"] + list(m["arquivos_extras"]):
        origem = arquivo_skill(Path(bib) / nome, alvo) if rel == "SKILL.md" else Path(bib) / nome / rel
        bruto = origem.read_bytes()
        try:
            texto = bruto.decode("utf-8-sig")
        except UnicodeDecodeError:
            saida[rel] = bruto  # binário: vai como está
            continue
        if MARCADOR in texto:
            cerebro = cerebro or caminho_cerebro()
            if not cerebro:
                raise ValueError("sem cerebro_dir em ~/.cerebro.json; rode: python cerebro/tools/cerebro.py config --definir <pasta>")
            texto = texto.replace(MARCADOR, cerebro)
        saida[rel] = texto.encode("utf-8")
    return saida


def _mesmo_conteudo(pasta, conteudos):
    """Uma instalação antiga (sem .instalado.json) é a nossa? Só se o SKILL.md for igual ao que instalaríamos."""
    try:
        atual = (pasta / "SKILL.md").read_bytes().replace(b"\r\n", b"\n")
    except OSError:
        return False
    return atual == conteudos["SKILL.md"].replace(b"\r\n", b"\n")


def _tirar_do_caminho(pasta):
    """Apaga a pasta; se o sistema não deixar, move para _removidas (com o SKILL.md renomeado, para a IA não ler)."""
    try:
        shutil.rmtree(pasta)
        return None
    except OSError:
        destino = pasta.parent / "_removidas" / f"{pasta.name}-{datetime.datetime.now():%Y%m%d-%H%M%S}"
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(pasta), str(destino))
        if (destino / "SKILL.md").exists():
            (destino / "SKILL.md").rename(destino / "SKILL.md.removido")
        return str(destino)


def instalar(nome, alvo="claude", escopo="global", projeto=None, pasta_projeto=None, bib=None):
    """Copia a skill para a pasta da IA e grava o .instalado.json. Não sobrescreve skill instalada por outro meio."""
    bib = Path(bib or BIBLIOTECA)
    m = _manifesto(bib, nome)
    if alvo not in m["compativel"]:
        raise ValueError(f"{nome} não é compatível com {alvo} (compativel: {', '.join(m['compativel'])})")
    raiz = pasta_destino(alvo, escopo, projeto, pasta_projeto)
    destino = raiz / nome
    conteudos = _conteudos(bib, nome, m, alvo)
    adotada = False
    if destino.exists() and not (destino / MARCA).is_file():
        if not _mesmo_conteudo(destino, conteudos):
            raise ValueError(f"já existe {destino} instalada por outro meio; não mexo nela")
        adotada = True  # igual ao que instalaríamos: era do instalador antigo, passa a ser gerenciada
    marca = {"nome": nome, "versao": m["versao"], "data": datetime.datetime.now().isoformat(timespec="seconds"),
             "origem": m["origem"], "alvo": alvo, "escopo": escopo, "projeto": projeto, "biblioteca": str(bib / nome)}
    raiz.mkdir(parents=True, exist_ok=True)
    temporaria = Path(tempfile.mkdtemp(prefix=f".{nome}.instalando-", dir=raiz))
    try:
        for rel, dados in conteudos.items():
            (temporaria / rel).parent.mkdir(parents=True, exist_ok=True)
            (temporaria / rel).write_bytes(dados)
        (temporaria / MARCA).write_text(json.dumps(marca, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        movida = _tirar_do_caminho(destino) if destino.exists() else None
        os.replace(temporaria, destino)
    except BaseException:
        shutil.rmtree(temporaria, ignore_errors=True)
        raise
    return {"nome": nome, "versao": m["versao"], "destino": str(destino), "adotada": adotada, "antiga_movida_para": movida, "alvo": alvo,
            "variante": alvo if arquivo_skill(bib / nome, alvo) != bib / nome / "SKILL.md" else None}


def remover(nome, alvo="claude", escopo="global", projeto=None, pasta_projeto=None):
    """Remove só o que este instalador pôs (pasta com .instalado.json)."""
    if not RE_NOME.match(str(nome)):
        raise ValueError(f"nome de skill inválido: {nome}")
    destino = pasta_destino(alvo, escopo, projeto, pasta_projeto) / nome
    if not destino.exists():
        raise ValueError(f"{nome} não está instalada em {destino.parent}")
    if not (destino / MARCA).is_file():
        raise ValueError(f"{destino} não foi instalada por aqui (sem {MARCA}); não apago")
    movida = _tirar_do_caminho(destino)
    return {"nome": nome, "destino": str(destino), "movida_para": movida, "alvo": alvo}


def alvos_de(alvo):
    """"ambos" = todos os destinos conhecidos; senão o alvo pedido (validado)."""
    if alvo == "ambos":
        return list(DESTINOS)
    if alvo not in DESTINOS:
        raise ValueError(f"alvo desconhecido: {alvo} (conheço: {', '.join(DESTINOS)}, ambos)")
    return [alvo]


def _por_alvo(acao, alvo, *args, **kw):
    """Roda a ação em cada alvo POR CONTA PRÓPRIA: um erro vira o resultado daquele alvo e não desfaz nem impede os outros.
    Devolve [{"alvo", "ok", "dados"|"erro"}]."""
    saida = []
    for a in alvos_de(alvo):
        try:
            saida.append({"alvo": a, "ok": True, "dados": acao(*args, alvo=a, **kw)})
        except (OSError, ValueError) as erro:
            saida.append({"alvo": a, "ok": False, "erro": str(erro)})
    return saida


def instalar_em(nome, alvo="claude", escopo="global", projeto=None, pasta_projeto=None, bib=None):
    """instalar() para um alvo ou para "ambos" (um resultado por alvo)."""
    return _por_alvo(instalar, alvo, nome, escopo=escopo, projeto=projeto, pasta_projeto=pasta_projeto, bib=bib)


def remover_em(nome, alvo="claude", escopo="global", projeto=None, pasta_projeto=None):
    """remover() para um alvo ou para "ambos" (um resultado por alvo)."""
    return _por_alvo(remover, alvo, nome, escopo=escopo, projeto=projeto, pasta_projeto=pasta_projeto)


def _locais():
    """Todos os lugares onde procurar instalações: global de cada IA + cada projeto cadastrado."""
    locais = []
    for alvo, d in DESTINOS.items():
        locais.append({"alvo": alvo, "escopo": "global", "projeto": None, "raiz": d["global"]()})
        try:
            lista = projetos.listar()
        except ValueError:
            lista = []
        for p in lista:
            if Path(p["pasta"]).is_dir():
                locais.append({"alvo": alvo, "escopo": "projeto", "projeto": p["id"], "raiz": d["projeto"](p["pasta"])})
    return locais


def status(bib=None):
    """Para cada skill da biblioteca (e cada instalação nossa de skill que saiu dela): onde está e em que versão.
    estado: igual | desatualizada | outro-meio | fora-da-biblioteca."""
    bib = Path(bib or BIBLIOTECA)
    versoes = {s["pasta"]: s.get("versao") for s in listar(bib)}
    achados = []
    for local in _locais():
        if not local["raiz"].is_dir():
            continue
        for pasta in sorted(p for p in local["raiz"].iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
            nossa = (pasta / MARCA).is_file()
            if pasta.name not in versoes and not nossa:
                continue  # skill de outra origem que nem existe na biblioteca: não é da nossa conta
            instalada = None
            if nossa:
                try:
                    instalada = _ler_json(pasta / MARCA).get("versao")
                except (OSError, ValueError):
                    instalada = "?"
            if pasta.name not in versoes:
                estado = "fora-da-biblioteca"
            elif not nossa:
                estado = "outro-meio"
            else:
                estado = "igual" if instalada == versoes[pasta.name] else "desatualizada"
            achados.append({"skill": pasta.name, "alvo": local["alvo"], "escopo": local["escopo"], "projeto": local["projeto"],
                            "destino": str(pasta), "estado": estado, "instalada": instalada, "biblioteca": versoes.get(pasta.name)})
    instaladas = {a["skill"] for a in achados}
    return {"instalacoes": achados, "nao_instaladas": sorted(n for n in versoes if n not in instaladas)}


def atualizar(nome=None, bib=None):
    """Reinstala (no mesmo lugar) tudo o que está com versão diferente da biblioteca."""
    feitos = []
    for a in status(bib)["instalacoes"]:
        if a["estado"] != "desatualizada" or (nome and a["skill"] != nome):
            continue
        raiz = Path(a["destino"]).parent
        pasta_projeto = raiz.parent.parent if a["escopo"] == "projeto" else None
        r = instalar(a["skill"], a["alvo"], a["escopo"], a["projeto"], pasta_projeto, bib)
        feitos.append({**r, "de": a["instalada"]})
    return feitos


# ---------- Importar skill de fora ----------

def _extrair_zip(arquivo, destino):
    """Descompacta com cuidado: nada fora da pasta, limite de tamanho e de arquivos."""
    with zipfile.ZipFile(arquivo) as z:
        membros = [m for m in z.infolist() if not m.is_dir()]
        if len(membros) > MAX_ARQUIVOS:
            raise ValueError(f"o zip tem mais de {MAX_ARQUIVOS} arquivos")
        if sum(m.file_size for m in membros) > MAX_ZIP:
            raise ValueError("o zip descompactado passa de 20 MB")
        for m in membros:
            if not _caminho_seguro(m.filename.replace("\\", "/")):
                raise ValueError(f"caminho perigoso dentro do zip: {m.filename}")
            alvo = Path(destino) / m.filename
            alvo.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as origem, open(alvo, "wb") as saida:
                shutil.copyfileobj(origem, saida)


def _raiz_da_skill(pasta):
    pasta = Path(pasta)
    if (pasta / "SKILL.md").is_file():
        return pasta
    candidatas = [p for p in pasta.iterdir() if p.is_dir() and (p / "SKILL.md").is_file()]
    if len(candidatas) == 1:
        return candidatas[0]
    raise ValueError("não achei um SKILL.md (na raiz ou numa única subpasta)")


def analisar(raiz):
    """Lê tudo (sem executar nada): SKILL.md inteiro, lista de arquivos e trechos perigosos."""
    arquivos, alertas = [], []
    for caminho in sorted(p for p in Path(raiz).rglob("*") if p.is_file()):
        rel = caminho.relative_to(raiz).as_posix()
        if rel == MARCA:
            continue
        ext = caminho.suffix.lower()
        info = {"arquivo": rel, "tamanho": caminho.stat().st_size, "script": ext in EXT_SCRIPT}
        arquivos.append(info)
        if ext in {".exe", ".dll", ".msi", ".jar"}:
            alertas.append({"arquivo": rel, "linha": 0, "motivo": "programa binário (não dá para ler o que faz)", "trecho": ""})
            continue
        try:
            texto = caminho.read_bytes().decode("utf-8-sig")
        except UnicodeDecodeError:
            info["binario"] = True
            continue
        for n, linha in enumerate(texto.splitlines(), 1):
            for regex, motivo in PERIGOS:
                if regex.search(linha):
                    alertas.append({"arquivo": rel, "linha": n, "motivo": motivo, "trecho": linha.strip()[:160]})
    return arquivos, alertas


def importar(origem, confirmar=False, categoria=None, bib=None, rotulo=None):
    """Mostra a skill de fora (SKILL.md completo, arquivos, alertas). Só copia para a biblioteca com confirmar=True.
    Nada da skill é executado em nenhum momento.
    rotulo: de onde a skill veio de verdade (ex.: github:dono/repo/pasta), para o caso de a pasta ser uma cópia temporária."""
    bib = Path(bib or BIBLIOTECA)
    origem = Path(origem).expanduser().resolve()
    de_onde = str(rotulo) if rotulo else str(origem)
    temporaria = None
    try:
        if origem.is_file() and origem.suffix.lower() == ".zip":
            temporaria = Path(tempfile.mkdtemp(prefix="skill-importada-"))
            _extrair_zip(origem, temporaria)
            raiz = _raiz_da_skill(temporaria)
        elif origem.is_dir():
            raiz = _raiz_da_skill(origem)
        else:
            raise ValueError("passe uma pasta com SKILL.md ou um arquivo .zip")
        skill_md = (raiz / "SKILL.md").read_bytes().decode("utf-8-sig", errors="replace")
        campos, _ = _cabecalho_skill(skill_md)
        nome = cerebro_slug(campos.get("name") or raiz.name)
        if not RE_NOME.match(nome):
            raise ValueError(f"nome inválido para a skill: {nome}")
        arquivos, alertas = analisar(raiz)
        rel = {"nome": nome, "origem": de_onde, "skill_md": skill_md, "arquivos": arquivos, "alertas": alertas,
               "avisos": avisos_skill_md(skill_md), "adicionada": False, "destino": str(bib / nome)}
        if (bib / nome).exists():
            raise ValueError(f"já existe uma skill {nome} na biblioteca; remova ou renomeie antes")
        if not confirmar:
            return rel
        shutil.copytree(raiz, bib / nome, ignore=shutil.ignore_patterns(MARCA))
        try:
            m = _ler_json(bib / nome / "skill.json")
            m = m if isinstance(m, dict) else {}
        except (OSError, ValueError):
            m = {}
        extras = [a["arquivo"] for a in arquivos if a["arquivo"] not in ("SKILL.md", "skill.json")]
        m.update({
            "nome": nome, "titulo": m.get("titulo") or nome, "descricao_curta": m.get("descricao_curta") or campos.get("description", "")[:200],
            "exemplo_de_uso": m.get("exemplo_de_uso") or "", "categoria": categoria if categoria in CATEGORIAS else (m.get("categoria") if m.get("categoria") in CATEGORIAS else "outros"),
            "versao": m.get("versao") if RE_VERSAO.match(str(m.get("versao", ""))) else "1.0.0",
            "autor": m.get("autor") or (de_onde[7:].split("/")[0] if de_onde.startswith("github:") and len(de_onde) > 7 else "desconhecido"),
            "origem": de_onde, "compativel": m.get("compativel") if isinstance(m.get("compativel"), list) and m.get("compativel") else ["claude"],
            "arquivos_extras": extras,
        })
        (bib / nome / "skill.json").write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        gerar_catalogo(bib)
        rel["adicionada"] = True
        return rel
    finally:
        if temporaria:
            shutil.rmtree(temporaria, ignore_errors=True)


def cerebro_slug(texto):
    import unicodedata
    base = unicodedata.normalize("NFKD", str(texto))
    base = "".join(c for c in base if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:64]


# ---------- Linha de comando ----------

def _imprimir(args, dados, linhas):
    if args.json:
        print(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    else:
        for linha in linhas:
            print(linha)


def _onde(a):
    return f"{a['alvo']}/{a['escopo']}" + (f"/{a['projeto']}" if a.get("projeto") else "")


def _cmd_listar(args):
    ss = listar()
    linhas = []
    for s in ss:
        alt = f"  (alternativa a {', '.join(s['alternativa_a'])})" if s.get("alternativa_a") else ""
        linhas.append(f"{s['pasta']}  {s.get('versao', '?')}  [{s.get('categoria', '?')}]  {s.get('descricao_curta', '')}{alt}")
        linhas += [f"  problema: {p}" for p in s["problemas"]] + [f"  aviso: {a}" for a in s["avisos"]]
    _imprimir(args, {"skills": ss}, linhas or ["biblioteca vazia"])
    return 1 if any(s["problemas"] for s in ss) else 0


def _cmd_ler(args):
    texto = ler_skill(args.nome, alvo=args.alvo)
    _imprimir(args, {"nome": args.nome, "conteudo": texto}, [texto.rstrip()])
    return 0


def _cmd_catalogo(args):
    ss = gerar_catalogo()
    _imprimir(args, {"skills": len(ss), "arquivo": str(BIBLIOTECA / CATALOGO)}, [f"catalogo.json: {len(ss)} skills"])
    return 0


def _cmd_instalar(args):
    if args.alvo == "ambos":
        rs = instalar_em(args.nome, "ambos", args.escopo, args.projeto)
        linhas = [(f"[{r['alvo']}] instalado: {r['dados']['nome']} {r['dados']['versao']} em {r['dados']['destino']}" if r["ok"] else f"[{r['alvo']}] ERRO: {r['erro']}") for r in rs]
        _imprimir(args, {"resultados": rs}, linhas)
        return 0 if all(r["ok"] for r in rs) else 1
    r = instalar(args.nome, args.alvo, args.escopo, args.projeto)
    _imprimir(args, r, [f"instalado: {r['nome']} {r['versao']} em {r['destino']}" + (" (já estava igual; agora gerenciada)" if r["adotada"] else "")
                        + (f" (variante {r['variante']})" if r.get("variante") else "")])
    return 0


def _cmd_remover(args):
    if args.alvo == "ambos":
        rs = remover_em(args.nome, "ambos", args.escopo, args.projeto)
        linhas = [(f"[{r['alvo']}] removido: {r['dados']['destino']}" if r["ok"] else f"[{r['alvo']}] ERRO: {r['erro']}") for r in rs]
        _imprimir(args, {"resultados": rs}, linhas)
        return 0 if all(r["ok"] for r in rs) else 1
    r = remover(args.nome, args.alvo, args.escopo, args.projeto)
    _imprimir(args, r, [f"removido: {r['destino']}" + (f" (o sistema não deixou apagar; movido para {r['movida_para']})" if r["movida_para"] else "")])
    return 0


def _cmd_status(args):
    s = status()
    linhas = [f"{a['skill']}  {_onde(a)}  {a['estado']}" + (f" (instalada {a['instalada']}, biblioteca {a['biblioteca']})" if a["estado"] == "desatualizada" else "")
              for a in s["instalacoes"]]
    if s["nao_instaladas"]:
        linhas.append("não instaladas: " + ", ".join(s["nao_instaladas"]))
    _imprimir(args, s, linhas or ["nada instalado"])
    return 0


def _cmd_atualizar(args):
    feitos = atualizar(args.nome)
    _imprimir(args, {"atualizadas": feitos}, [f"atualizado: {f['nome']} {f['de']} -> {f['versao']} em {f['destino']}" for f in feitos] or ["tudo em dia"])
    return 0


def _cmd_importar(args):
    r = importar(args.origem, args.confirmar, args.categoria, rotulo=args.rotulo)
    linhas = [f"== skill: {r['nome']} (de {r['origem']})", "== SKILL.md completo ==", r["skill_md"].rstrip(), "== arquivos =="]
    linhas += [f"  {a['arquivo']}  ({a['tamanho']} bytes)" + ("  [SCRIPT]" if a["script"] else "") + ("  [binário]" if a.get("binario") else "") for a in r["arquivos"]]
    linhas.append(f"== ALERTAS: {len(r['alertas'])} ==" if r["alertas"] else "== nenhum trecho perigoso encontrado ==")
    linhas += [f"  !! {a['arquivo']}:{a['linha']}  {a['motivo']}" + (f"  | {a['trecho']}" if a["trecho"] else "") for a in r["alertas"]]
    linhas += [f"  aviso: {a}" for a in r["avisos"]]
    linhas.append(f"adicionada à biblioteca em {r['destino']}" if r["adicionada"] else
                  "NADA foi adicionado. Leia o que está acima; para adicionar, rode de novo com --confirmar.")
    _imprimir(args, r, linhas)
    return 0


def montar_parser():
    comum = argparse.ArgumentParser(add_help=False)
    comum.add_argument("--json", action="store_true", help="saída em JSON (para o widget)")
    onde = argparse.ArgumentParser(add_help=False)
    onde.add_argument("--alvo", default="claude", choices=[*sorted(DESTINOS), "ambos"])
    onde.add_argument("--escopo", default="global", choices=["projeto", "global"])
    onde.add_argument("--projeto", help="id do projeto (projetos.json), com --escopo projeto")
    parser = argparse.ArgumentParser(prog="skills.py", description="Biblioteca de skills do widget")
    sub = parser.add_subparsers(dest="comando", required=True)
    sub.add_parser("listar", parents=[comum]).set_defaults(func=_cmd_listar)
    sub.add_parser("catalogo", parents=[comum]).set_defaults(func=_cmd_catalogo)
    p = sub.add_parser("ler", parents=[comum], help="mostra o SKILL.md de uma skill da biblioteca")
    p.add_argument("nome")
    p.add_argument("--alvo", default=None, choices=sorted(DESTINOS), help="mostra a variante desse alvo, se houver")
    p.set_defaults(func=_cmd_ler)
    p = sub.add_parser("instalar", parents=[comum, onde])
    p.add_argument("nome")
    p.set_defaults(func=_cmd_instalar)
    p = sub.add_parser("remover", parents=[comum, onde])
    p.add_argument("nome")
    p.set_defaults(func=_cmd_remover)
    sub.add_parser("status", parents=[comum]).set_defaults(func=_cmd_status)
    p = sub.add_parser("atualizar", parents=[comum])
    p.add_argument("nome", nargs="?")
    p.set_defaults(func=_cmd_atualizar)
    p = sub.add_parser("importar", parents=[comum])
    p.add_argument("origem", help="pasta com SKILL.md ou arquivo .zip")
    p.add_argument("--confirmar", action="store_true", help="adiciona de verdade (sem isso só mostra)")
    p.add_argument("--categoria", choices=CATEGORIAS)
    p.add_argument("--rotulo", default=None, help="de onde a skill veio (ex.: github:dono/repo/pasta), no lugar do caminho da pasta")
    p.set_defaults(func=_cmd_importar)
    return parser


def main(argv=None):
    args = montar_parser().parse_args(argv)
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
