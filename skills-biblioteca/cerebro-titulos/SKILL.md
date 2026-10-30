---
name: cerebro-titulos
description: "Use antes de pesquisar sobre os projetos do dono ou se o pedido citar projeto, decisão passada, 'lembra', 'aquilo que fizemos': busca na memória (cérebro) pelos nomes dos arquivos."
---

# Cérebro, nível 1: títulos

O cérebro guarda resumos de conversas e o estado de cada projeto em `{CAMINHO_CEREBRO}`.
Consultá-lo custa poucos tokens; refazer uma pesquisa custa muitos.

**Regra:** não leia arquivos do cérebro diretamente (Read, cat, Grep, Glob); use sempre o
cerebro.py, que lê só o necessário.

1. Extraia de 2 a 5 termos do pedido: projeto, tecnologia, assunto. Acento e maiúsculas não importam.
   Inclua o nome do projeto entre os termos: assim `estado/{projeto}.md` também aparece.
2. Rode (com `--projeto` se souber o projeto):
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" titulos cerebro decisoes meu-widget --projeto meu-widget
   ```
3. A saída tem uma linha `pontos arquivo` por resultado. Decida:
   - `nenhum`: o cérebro não sabe nada disso. Siga normalmente, sem comentar.
   - Melhor resultado com 4 ou mais pontos e claramente sobre o pedido: use a skill `cerebro-ler`.
   - Só resultados com 1 a 3 pontos, ou vários parecidos: use a skill `cerebro-cabecalho`.
4. Não rode a mesma busca de novo com os mesmos termos. Se nada servir, troque 1 ou 2 termos
   por sinônimos uma única vez; depois disso, siga normalmente.
