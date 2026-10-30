---
name: cerebro-ler
description: "Use quando cerebro-titulos ou cerebro-cabecalho apontarem arquivos que combinam com o pedido: abre no máximo 3 deles e resume o achado em 1 linha antes de usar."
---

# Cérebro, nível 3: ler

**Regra:** não leia arquivos do cérebro diretamente (Read, cat, Grep, Glob); use sempre o
cerebro.py, que lê só o necessário.

1. Escolha no máximo 3 arquivos, os que mais combinam com o pedido (o estado do projeto conta como um).
2. Rode, com o nome com ou sem caminho:
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" ler estado/meu-widget.md 2026-10-28_estrutura-inicial-do-cerebro.md
   ```
   Pedir mais de 3 é recusado. Se precisar de mais, o pedido está amplo demais: refine os termos.
3. Antes de usar o conteúdo, diga ao dono em 1 linha o que encontrou, por exemplo:
   `Cérebro: em 28/10 decidimos manter o CLAUDE.md antigo em docs/WIDGET.md.`
4. Use o que encontrou para responder sem refazer a pesquisa. Se o cérebro contradizer o código
   atual, o código vale: diga isso em 1 linha.
5. Se os arquivos não ajudarem, diga só `Cérebro: nada útil sobre isso.` e siga normalmente.
