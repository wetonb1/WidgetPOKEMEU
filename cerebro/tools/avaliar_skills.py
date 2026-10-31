#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""avaliar_skills.py - avaliador de skills para projetos do widget e cérebro.

Analisa o estado do projeto (cerebro/estado/{id}.md), seu stack, histórico e arquivos da pasta,
classificando todas as skills disponíveis no catálogo por nível de utilidade:
  - Essencial (Alta utilidade): impacto direto no stack, tarefas ou economia crítica de tokens
  - Útil (Média utilidade): ferramentas que otimizam o fluxo e leitura cirúrgica
  - Opcional (Baixa utilidade): skills de nicho não alinhadas ao stack atual

Opera com CUSTO ZERO de tokens quando executado localmente e < 250 tokens quando acionado
pela IA via /avaliar ou /avaliacao.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Garante importação dos módulos vizinhos
DIR_ATUAL = Path(__file__).resolve().parent
if str(DIR_ATUAL) not in sys.path:
    sys.path.insert(0, str(DIR_ATUAL))

RAIZ_WIDGET = DIR_ATUAL.parent.parent
DIR_SKILLS = RAIZ_WIDGET / "skills-biblioteca"
if str(DIR_SKILLS) not in sys.path:
    sys.path.insert(0, str(DIR_SKILLS))

try:
    import projetos
except ImportError:
    projetos = None

try:
    import skills
except ImportError:
    skills = None


# Regras e afinidades específicas para catálogo oficial
REGRAS_ESPECIFICAS = {
    "cerebro-buscar": {
        "pontos_base": 96,
        "nivel_padrao": "essencial",
        "razao_padrao": "Indispensável: reduz até 85% dos tokens buscando decisões e notas na memória antes de varrer o código.",
        "economia": "Alta (~2k a 8k tokens por sessão)",
    },
    "cerebro-compactar": {
        "pontos_base": 92,
        "nivel_padrao": "essencial",
        "razao_padrao": "Essencial para continuidade: resume sessões longas e atualiza o estado sem estourar o contexto da IA.",
        "economia": "Alta (evita reprocessamento de contexto longo)",
    },
    "cerebro-avaliar": {
        "pontos_base": 88,
        "nivel_padrao": "essencial",
        "razao_padrao": "Auditoria de skills e economia contínua via /avaliar com leitura compacta (< 250 tokens).",
        "economia": "Alta (mantém apenas as skills necessárias ativas)",
    },
    "cerebro-ler": {
        "pontos_base": 78,
        "nivel_padrao": "util",
        "razao_padrao": "Leitura cirúrgica: abre até 3 arquivos do cérebro com resumo em 1 linha, sem despejar histórico desnecessário.",
        "economia": "Média (~1.500 tokens por consulta)",
    },
    "cerebro-titulos": {
        "pontos_base": 72,
        "nivel_padrao": "util",
        "razao_padrao": "Nível 1 de busca: vasculha nomes de conversas em milissegundos sem gastar tokens abrindo arquivos.",
        "economia": "Média (varredura rápida com 0 tokens)",
    },
    "cerebro-cabecalho": {
        "pontos_base": 68,
        "nivel_padrao": "util",
        "razao_padrao": "Nível 2 de busca: inspeciona palavras-chave nas 2 primeiras linhas para desempate ágil de tópicos.",
        "economia": "Média (~800 tokens economizados)",
    },
    "blender-modeler": {
        "pontos_base": 20,
        "nivel_padrao": "opcional",
        "palavras_chave": [
            "blender", "3d", "blend", "modelagem", "mesh", "malha", "stl", "gltf", "fbx",
            "cad", "prótese", "protese", "render", "cycles", "eevee", "game", "jogos", "unity", "unreal", "godot"
        ],
        "razao_match": "Perfeito para o projeto: especialista em modelagem 3D, modificadores, coleções e precisão no Blender.",
        "razao_padrao": "Específica para modelagem 3D e Blender; não alinhada ao stack principal detectado.",
        "economia_match": "Alta (automação direta de scripts e modelagem via MCP)",
        "economia_padrao": "Baixa (não aplicável a este projeto)",
    },
    "asset-optimization": {
        "pontos_base": 18,
        "nivel_padrao": "opcional",
        "palavras_chave": [
            "blender", "3d", "blend", "asset", "assets", "polycount", "uv", "otimização", "otimizacao",
            "stl", "gltf", "fbx", "performance", "game", "jogos", "impressão 3d", "impressao 3d"
        ],
        "razao_match": "Alta aderência: valida e otimiza topologia, contagem de polígonos, materiais e UVs antes da exportação.",
        "razao_padrao": "Específica para validação e auditoria de assets 3D; sem necessidade aparente no projeto.",
        "economia_match": "Alta (previne retrabalho e erros em assets pesados)",
        "economia_padrao": "Baixa (não aplicável a este projeto)",
    },
}


def _extrair_secoes_estado(texto: str) -> dict[str, str]:
    """Extrai as seções de um arquivo markdown de estado (ex: Objetivo, Stack, etc.)."""
    secoes: dict[str, str] = {}
    atual = "intro"
    linhas_atual = []

    for linha in texto.splitlines():
        m = re.match(r"^##\s+(.+)$", linha.strip())
        if m:
            if linhas_atual:
                secoes[atual] = "\n".join(linhas_atual).strip()
            atual = m.group(1).strip()
            linhas_atual = []
        else:
            linhas_atual.append(linha)

    if linhas_atual:
        secoes[atual] = "\n".join(linhas_atual).strip()

    return secoes


def _detectar_stack_da_pasta(pasta: Path) -> list[str]:
    """Se a pasta existir, detecta tecnologias por arquivos-chave sem percorrer subpastas pesadas."""
    if not pasta.is_dir():
        return []
    tecnologias = []
    try:
        itens = [p.name.lower() for p in pasta.iterdir()]
    except Exception:
        return []

    if any(i.endswith(".blend") for i in itens) or "blender" in itens:
        tecnologias.append("Blender / 3D")
    if "package.json" in itens:
        tecnologias.append("Node.js / Web")
    if "requirements.txt" in itens or "pyproject.toml" in itens or any(i.endswith(".py") for i in itens):
        tecnologias.append("Python")
    if "cargo.toml" in itens:
        tecnologias.append("Rust")
    if any(i.endswith(".cs") for i in itens) or any(i.endswith(".sln") for i in itens):
        tecnologias.append("C# / .NET")
    if any(i.endswith(".go") for i in itens):
        tecnologias.append("Go")
    if "dockerfile" in itens or "docker-compose.yml" in itens:
        tecnologias.append("Docker")
    return tecnologias


def avaliar_skills_projeto(id_projeto: str, base_cerebro: Path | None = None) -> dict:
    """Calcula a aderência de todas as skills do catálogo para o projeto indicado."""
    if projetos is None:
        raise RuntimeError("módulo projetos não disponível")

    lista = projetos._ler(projetos.arquivo_projetos())
    idx = projetos._achar(lista, id_projeto)
    proj = projetos._completar(lista[idx])

    base = projetos._base_cerebro(base_cerebro)
    if base is None:
        base = DIR_ATUAL.parent

    # Lê arquivo de estado se existir
    caminho_estado = base / "estado" / f"{id_projeto}.md"
    texto_estado = ""
    if caminho_estado.is_file():
        try:
            texto_estado = caminho_estado.read_bytes().decode("utf-8-sig")
        except Exception:
            texto_estado = ""

    secoes_estado = _extrair_secoes_estado(texto_estado)
    stack_texto = secoes_estado.get("Stack", "")
    objetivo_texto = secoes_estado.get("Objetivo", "")
    decisoes_texto = secoes_estado.get("Decisões", "")
    estado_atual_texto = secoes_estado.get("Estado atual", "")

    # Contexto unificado em minúsculas para busca de termos
    pasta_proj = Path(proj["pasta"])
    stack_pasta = _detectar_stack_da_pasta(pasta_proj)

    contexto = " ".join([
        proj.get("nome", ""),
        proj.get("descricao", ""),
        " ".join(proj.get("tags", [])),
        stack_texto,
        objetivo_texto,
        decisoes_texto,
        estado_atual_texto,
        " ".join(stack_pasta),
        pasta_proj.name,
    ]).lower()

    # Obtém catálogo completo e status de instalação
    catalogo = []
    if skills is not None:
        try:
            catalogo = skills.gerar_catalogo()
        except Exception:
            catalogo = []

    # Fallback se gerar_catalogo falhar: lê catalogo.json direto
    if not catalogo:
        arq_cat = DIR_SKILLS / "catalogo.json"
        if arq_cat.is_file():
            try:
                dados_cat = json.loads(arq_cat.read_text(encoding="utf-8-sig"))
                catalogo = dados_cat.get("skills", [])
            except Exception:
                catalogo = []

    # Status de instalação no projeto
    instaladas_no_projeto = set()
    instaladas_global = set()
    if skills is not None:
        try:
            st = skills.status()
            for inst in st.get("instalacoes", []):
                s_nome = inst.get("skill")
                if not s_nome:
                    continue
                if inst.get("escopo") == "projeto" and inst.get("projeto") == id_projeto:
                    instaladas_no_projeto.add(s_nome)
                elif inst.get("escopo") == "global":
                    instaladas_global.add(s_nome)
        except Exception:
            pass

    # Se status não pegou, confere fisicamente a pasta do projeto
    if pasta_proj.is_dir():
        for sub in [".claude/skills", ".agents/skills"]:
            p_sub = pasta_proj / sub
            if p_sub.is_dir():
                for p_item in p_sub.iterdir():
                    if p_item.is_dir() and (p_item / "SKILL.md").is_file():
                        instaladas_no_projeto.add(p_item.name)

    # Avaliação de cada skill
    avaliadas = []
    for s in catalogo:
        nome = s.get("nome", "")
        if not nome:
            continue

        titulo = s.get("titulo") or nome
        categoria = s.get("categoria", "geral")
        descricao = s.get("descricao_curta", "")
        compativel = s.get("compativel", ["claude"])

        regra = REGRAS_ESPECIFICAS.get(nome, {})
        pontos = regra.get("pontos_base", 50)
        nivel = regra.get("nivel_padrao", "util")
        razao = regra.get("razao_padrao", "")
        economia = regra.get("economia", "Média")

        # Verifica palavras-chave específicas da skill
        palavras_chave = regra.get("palavras_chave", [])
        tem_match = False
        if palavras_chave:
            matches = [w for w in palavras_chave if re.search(r"\b" + re.escape(w) + r"\b", contexto)]
            if matches:
                tem_match = True
                pontos = 94
                nivel = "essencial"
                razao = regra.get("razao_match", f"Alinhada ao stack detectado ({', '.join(matches[:3])}).")
                economia = regra.get("economia_match", "Alta")

        # Heurística para skills gerais que venham a ser adicionadas ao catálogo
        if not regra:
            desc_lower = (descricao + " " + titulo).lower()
            palavras_desc = [p for p in re.findall(r"\b\w{4,}\b", desc_lower) if p not in ["para", "com", "uma", "este", "como", "mais"]]
            matches_genericos = [w for w in palavras_desc if re.search(r"\b" + re.escape(w) + r"\b", contexto)]
            if len(matches_genericos) >= 2:
                pontos = 82
                nivel = "util"
                razao = f"Recomendada por correspondência com tópicos do projeto: {', '.join(matches_genericos[:3])}."
                economia = "Média (~1.000 a 3.000 tokens economizados)"
            else:
                pontos = 35
                nivel = "opcional"
                razao = "Skill auxiliar disponível no catálogo; sem correspondência direta imediata."
                economia = "Baixa"

        # Bônus para skills essenciais do cérebro
        if categoria == "cerebro" and nome in ["cerebro-buscar", "cerebro-compactar", "cerebro-avaliar"]:
            nivel = "essencial"
            if not razao:
                razao = regra.get("razao_padrao", "Economiza tokens consultando a memória persistente.")

        instalada_proj = nome in instaladas_no_projeto
        instalada_glob = nome in instaladas_global

        rotulo_nivel = {
            "essencial": "Essencial (Alta)",
            "util": "Útil (Média)",
            "opcional": "Opcional (Baixa)",
        }.get(nivel, "Útil")

        avaliadas.append({
            "nome": nome,
            "titulo": titulo,
            "categoria": categoria,
            "descricao": descricao,
            "nivel": nivel,
            "nivel_rotulo": rotulo_nivel,
            "pontos": pontos,
            "razao": razao,
            "economia_estimada": economia,
            "instalada_projeto": instalada_proj,
            "instalada_global": instalada_glob,
            "compativel": compativel,
        })

    # Ordenação: Essenciais primeiro, depois Úteis, depois Opcionais; e por pontos decrescente
    ordem_nivel = {"essencial": 0, "util": 1, "opcional": 2}
    avaliadas.sort(key=lambda item: (ordem_nivel.get(item["nivel"], 9), -item["pontos"], item["nome"]))

    # Resumo descritivo do stack para exibição na UI
    stack_exibicao = stack_texto.strip().split("\n")[0] if stack_texto else ""
    if not stack_exibicao and stack_pasta:
        stack_exibicao = ", ".join(stack_pasta)
    if not stack_exibicao:
        stack_exibicao = "Stack geral (sem arquivo de estado detalhado)"

    return {
        "ok": True,
        "projeto": {
            "id": id_projeto,
            "nome": proj.get("nome", id_projeto),
            "pasta": proj.get("pasta", ""),
            "ia": proj.get("ia", "claude"),
            "modelo_padrao": proj.get("modelo_padrao", ""),
            "stack": stack_exibicao[:100],
            "objetivo": objetivo_texto.strip().split("\n")[0][:120] if objetivo_texto else "",
            "tem_estado": bool(texto_estado.strip()),
        },
        "resumo": {
            "total": len(avaliadas),
            "essenciais": sum(1 for a in avaliadas if a["nivel"] == "essencial"),
            "uteis": sum(1 for a in avaliadas if a["nivel"] == "util"),
            "opcionais": sum(1 for a in avaliadas if a["nivel"] == "opcional"),
            "instaladas_projeto": sum(1 for a in avaliadas if a["instalada_projeto"]),
        },
        "skills": avaliadas,
    }


def formatar_tabela_terminal(resultado: dict) -> str:
    """Formata o diagnóstico em texto legível para terminal / IA."""
    p = resultado["projeto"]
    r = resultado["resumo"]
    linhas = [
        f"=== Avaliação de Skills para o Projeto: {p['nome']} (id: {p['id']}) ===",
        f"Stack detectado: {p['stack']}",
        f"Diagnóstico: {r['essenciais']} essenciais, {r['uteis']} úteis, {r['opcionais']} opcionais | {r['instaladas_projeto']} já instaladas",
        "",
        "Nível: ESSENCIAL (Alta Utilidade - Economia Crítica)",
    ]

    for s in resultado["skills"]:
        if s["nivel"] == "essencial":
            status = "[✓ INSTALADA]" if s["instalada_projeto"] else "[DISPONÍVEL]"
            linhas.append(f"  • {s['nome']:<20} {status:<15} ({s['pontos']} pts)")
            linhas.append(f"    Por quê: {s['razao']}")
            linhas.append(f"    Economia: {s['economia_estimada']}")

    linhas.extend(["", "Nível: ÚTIL (Média Utilidade - Complementares)"])
    for s in resultado["skills"]:
        if s["nivel"] == "util":
            status = "[✓ INSTALADA]" if s["instalada_projeto"] else "[DISPONÍVEL]"
            linhas.append(f"  • {s['nome']:<20} {status:<15} ({s['pontos']} pts)")
            linhas.append(f"    Por quê: {s['razao']}")

    linhas.extend(["", "Nível: OPCIONAL (Baixa Utilidade)"])
    for s in resultado["skills"]:
        if s["nivel"] == "opcional":
            status = "[✓ INSTALADA]" if s["instalada_projeto"] else "[DISPONÍVEL]"
            linhas.append(f"  • {s['nome']:<20} {status:<15} - {s['razao']}")

    linhas.extend([
        "",
        "Para instalar uma skill recomendada no projeto:",
        f"  python skills-biblioteca/skills.py instalar NOME --escopo projeto --projeto {p['id']} --alvo ambos",
    ])
    return "\n".join(linhas)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Avalia as skills mais úteis para um projeto.")
    parser.add_argument("projeto", help="ID do projeto (em projetos.json)")
    parser.add_argument("--json", action="store_true", help="Saída em JSON")
    args = parser.parse_args(argv)

    try:
        resultado = avaliar_skills_projeto(args.projeto)
        if args.json:
            print(json.dumps(resultado, ensure_ascii=False, indent=2))
        else:
            print(formatar_tabela_terminal(resultado))
    except Exception as e:
        if args.json:
            print(json.dumps({"ok": False, "erro": str(e)}, ensure_ascii=False))
        else:
            print(f"Erro: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
