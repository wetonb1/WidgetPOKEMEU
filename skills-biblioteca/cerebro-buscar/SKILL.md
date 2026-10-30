---
name: cerebro-buscar
description: "Use antes de pesquisar sobre os projetos do dono ou se o pedido citar projeto, decisão passada, 'lembra', 'aquilo que fizemos': consulta a memória (cérebro) numa chamada só."
---

# Cérebro: buscar (os 3 níveis numa skill)

O cérebro guarda resumos de conversas e o estado de cada projeto em `{CAMINHO_CEREBRO}`.

**Regra:** não abra os arquivos do cérebro direto (com nenhuma ferramenta de ler arquivos ou de buscar
texto); use sempre o cerebro.py, rodado na ferramenta de terminal, que lê só o necessário.

1. Extraia de 2 a 5 termos do pedido (projeto, tecnologia, assunto). Acento não importa.
2. Rode (com `--projeto` se souber o projeto):
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" buscar cerebro decisoes --projeto meu-widget
   ```
   Ele confere o estado do projeto, os nomes e, se precisar, as palavras-chave. Não abre nada inteiro.
3. Leia a saída:
   - `estado disponível: ...` seguido de 2 linhas: o projeto tem arquivo de estado.
   - Linhas `pontos arquivo | palavras-chave`: os candidatos.
   - `abrir: a.md, b.md`: a sugestão (até 3). `nenhum`: siga normalmente, sem comentar.
4. Se as palavras-chave combinarem com o pedido, abra só os sugeridos que servem (máximo 3):
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" ler estado/meu-widget.md 2026-10-28_estrutura-inicial-do-cerebro.md
   ```
5. Antes de usar, diga ao dono em 1 linha o que encontrou, por exemplo:
   `Cérebro: em 28/10 decidimos manter o formato antigo do estado do projeto.`
6. Responda sem refazer a pesquisa. Se o cérebro contradizer o código atual, o código vale.
