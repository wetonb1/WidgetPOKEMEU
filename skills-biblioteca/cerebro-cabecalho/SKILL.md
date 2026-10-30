---
name: cerebro-cabecalho
description: "Use depois de cerebro-titulos quando os resultados forem fracos (menos de 4 pontos) ou ambíguos: confere as palavras-chave dos candidatos no cérebro sem abrir os arquivos."
---

# Cérebro, nível 2: cabeçalho

Cada conversa do cérebro começa com 2 linhas: palavras-chave e data/origem/projeto.
Este nível lê só essas 2 linhas, nunca o arquivo inteiro.

**Regra:** não leia arquivos do cérebro diretamente (Read, cat, Grep, Glob); use sempre o
cerebro.py, que lê só o necessário.

1. Pegue até 8 candidatos da saída de `titulos` (os de mais pontos).
2. Rode com os mesmos termos do pedido e os candidatos em `--arquivos`:
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" cabecalho cerebro decisoes --arquivos 2026-10-28_estrutura-inicial-do-cerebro.md estado/meu-widget.md
   ```
3. Se `titulos` disse `nenhum` mas o pedido é claramente sobre os projetos do dono, rode sem
   `--arquivos` (confere o cabeçalho de todos; ainda é barato):
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" cabecalho cerebro decisoes
   ```
4. A saída tem uma linha `pontos arquivo | palavras-chave` por resultado. Decida:
   - Palavras-chave que combinam com o pedido (em geral 3+ pontos): use a skill `cerebro-ler`
     com no máximo 3 desses arquivos.
   - `nenhum`, ou palavras-chave sem relação: siga normalmente, sem comentar.
