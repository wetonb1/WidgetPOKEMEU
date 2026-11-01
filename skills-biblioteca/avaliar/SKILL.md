---
name: avaliar
description: "Avalia quais skills são mais úteis para o projeto atual no catálogo local e em repositórios online (GitHub, Anthropic, OpenAI), diagnosticando o estado do cérebro com o menor consumo de tokens (< 250 tokens). Ativado por /avaliar, /avaliar online ou /avaliar skills online."
---

# Cérebro: avaliar skills do projeto (/avaliar)

Avalia a utilidade de skills locais e repositórios online para este projeto, categorizando-as em:
- **Essencial (Alta utilidade)**: Alinhadas ao stack ou críticas para economia de tokens.
- **Útil (Média utilidade)**: Complementam o fluxo de trabalho e leitura cirúrgica.
- **Opcional (Baixa utilidade)**: Recursos de nicho não relacionados ao stack.

## Modos de Avaliação

1. **Catálogo Local (/avaliar)**:
   Avalia as skills locais e oficiais já disponíveis na biblioteca:
   ```bash
   python "{CAMINHO_CEREBRO}/tools/projetos.py" avaliar-skills
   ```

2. **Busca Online (/avaliar online ou /avaliar skills online)**:
   Realiza a busca ativa e diagnóstica em repositórios online (Anthropic, OpenAI e comunidade GitHub), classificando o que for mais relevante ao stack do projeto:
   ```bash
   python "{CAMINHO_CEREBRO}/tools/projetos.py" avaliar-skills --online
   ```

> Nota: O script detecta automaticamente o projeto pela pasta atual da sessão. Você também pode informar o ID explicitamente:
> `python "{CAMINHO_CEREBRO}/tools/projetos.py" avaliar-skills <id_do_projeto> [--online]`

## Regra de Otimização e Menor Consumo de Tokens

Para manter o consumo quase nulo (< 250 tokens):
1. **NUNCA** faça varredura em massa ou leitura completa das conversas da pasta `cerebro/conversas/` nem leia o código todo.
2. Execute o comando local em Python acima (que roda em 0 tokens e devolve a análise pronta).
3. Apresente ao usuário o ranking de utilidade com:
   - Nível de utilidade (Essencial, Útil, Opcional)
   - Origem (Local ou Online: Anthropic, OpenAI, GitHub)
   - Por que foi recomendada para o stack/estado deste projeto
   - Ação para instalar:
     - Local: `python skills-biblioteca/skills.py instalar <skill> --escopo projeto --projeto <id>`
     - Online: importar via widget ou `skills.py importar <caminho>`
