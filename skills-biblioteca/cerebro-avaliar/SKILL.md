---
name: cerebro-avaliar
description: "Avalia quais skills são mais úteis para o projeto atual, diagnosticando o estado do cérebro com o menor consumo de tokens possível (< 250 tokens). Ativado por /avaliar ou /avaliacao."
---

# Cérebro: avaliar skills do projeto (/avaliar)

Avalia a utilidade de todas as skills do catálogo para este projeto, categorizando-as em:
- **Essencial (Alta utilidade)**: Alinhadas ao stack ou críticas para economia de tokens.
- **Útil (Média utilidade)**: Complementam o fluxo de trabalho e leitura cirúrgica.
- **Opcional (Baixa utilidade)**: Recursos de nicho não relacionados ao stack.

## Regra de Otimização e Menor Consumo de Tokens

Para manter o consumo quase nulo (< 250 tokens):
1. **NUNCA** faça varredura em massa ou leitura completa das conversas da pasta `cerebro/conversas/`.
2. Execute o comando local em Python (que roda em 0 tokens e devolve a análise pronta):
   ```bash
   python cerebro/tools/projetos.py avaliar-skills {ID_DO_PROJETO} --json
   ```
   *(Caso não saiba o ID do projeto, passe o nome da pasta ou consulte `cerebro/tools/projetos.py listar --json`)*
3. Se precisar conferir o estado manualmente, leia **APENAS** o arquivo compacto de estado:
   `cerebro/estado/{ID_DO_PROJETO}.md` (máximo 300 palavras).
4. Apresente ao usuário o ranking de utilidade com:
   - Nível de utilidade (Essencial, Útil, Opcional)
   - Por que foi recomendada para o stack/estado deste projeto
   - Comando de 1 linha para instalar com `skills.py instalar <skill> --escopo projeto --projeto <id>`
