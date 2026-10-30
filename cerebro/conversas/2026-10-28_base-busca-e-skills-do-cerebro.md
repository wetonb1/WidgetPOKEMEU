palavras-chave: meu-widget, cerebro, python, claude-code, skills, busca, compactacao, tokens
data: 2026-10-28 | origem: claude-code | projeto: meu-widget

- Nesta versão só o Claude Code usa o cérebro; outras IAs depois, com caminhos centralizados.
- CLAUDE.md antigo foi para docs/WIDGET.md; o novo é curto (máx. 60 linhas).
- cerebro.py usa só a biblioteca padrão; pasta: CEREBRO_DIR > ~/.cerebro.json > pai de tools/.
- Busca: titulos (só nomes) > cabecalho (2 linhas) > ler (máx. 3); buscar junta tudo e só sugere.
- Consultas vão para cerebro/.log/consultas.jsonl (medir economia na fase 6).
- salvar recusa fora do padrão ou com segredo; estado guarda 5 versões em .anteriores.
- Skills ficam em skills-biblioteca/ e instalar_basico.py copia as 4 básicas para .claude/skills.
- cerebro-buscar é alternativa não instalada (o gatilho é o mesmo de cerebro-titulos).
- /compactar chama a skill cerebro-compactar.
- Armadilha: só iniciar o Python leva ~230 ms nesta máquina.
- Armadilha: no Git Bash, "/compactar" vira caminho; use MSYS_NO_PATHCONV=1.
- Pendente: mínimo de palavras-chave (3 ou 5) e remover AGENTS.md.
