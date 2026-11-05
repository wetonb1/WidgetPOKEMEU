---
name: cerebro-ler
description: "Use para ler a memória inteira de um projeto no cérebro: carrega o estado atual (estado/<projeto>.md) E todas as conversas/decisões históricas em ordem cronológica de uma só vez."
---

# Cérebro: ler projeto completo (/cerebro-ler)

O cérebro guarda resumos de conversas e o estado de cada projeto em `{CAMINHO_CEREBRO}`.

**Regra inegociável:** nunca abra ou leia os arquivos do cérebro direto com ferramentas de arquivos; use sempre o `cerebro.py`, rodado no terminal, que lê de forma estruturada.

## Quando usar
- Quando você ou o dono digitar `/cerebro-ler` ou pedir para "ler o cérebro do projeto", "relembrar tudo do projeto" ou entender o contexto histórico completo.
- Quando precisar de todas as decisões tomadas, stack, problemas já resolvidos e pendências do projeto.

## Como executar

1. **Descubra o projeto:**
   - Se o usuário passou um argumento (ex.: `/cerebro-ler meu-widget` ou `/cerebro-ler mao`), use esse id de projeto.
   - Se não passou argumento, descubra o id do projeto atual:
     - Consulte a seção `## Cérebro` do `CLAUDE.md` ou `AGENTS.md` (campo `Id deste projeto no cérebro: <id>`).
     - Ou o nome da pasta do projeto atual.
     - Se ainda tiver dúvida, pergunte ao usuário.

2. **Rode a leitura completa pelo terminal:**
   ```bash
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" ler --projeto <projeto>
   ```

3. **Como interpretar a resposta:**
   - A saída trará primeiro `== estado/<projeto>.md` (o estado consolidado: Objetivo, Stack, Decisões, Estado atual, Próximos passos e Armadilhas).
   - Em seguida, trará cada conversa registrada em **ordem cronológica**, com as decisões de cada sessão.
   - Se também quiser ler arquivos avulsos específicos, o comando aceita `python "{CAMINHO_CEREBRO}/tools/cerebro.py" ler arquivo1.md arquivo2.md`.

4. **Responda ao usuário:**
   - Diga em 1 ou 2 linhas que leu a memória completa do projeto (quantos arquivos / conversas foram carregados).
   - Faça uma síntese objetiva:
     - **Estado atual** e o que está pendente/próximos passos.
     - **Decisões críticas tomadas no histórico** que guiam o trabalho agora.
   - Prossiga diretamente com a tarefa ou aguarde a instrução do dono sem pedir para ele reexplicar o que já está na memória.
