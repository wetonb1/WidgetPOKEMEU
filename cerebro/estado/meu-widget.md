## Objetivo
Widget pessoal e leve para Windows 10, agora com um "cérebro": memória em Markdown que o Claude Code consulta antes de pesquisar, para gastar menos tokens.

## Stack
Electron + JavaScript puro (widget). Cérebro: Python 3, só biblioteca padrão (cerebro/tools/cerebro.py). Skills do Claude Code em .claude/skills.

## Decisões
- Só o Claude Code por enquanto; caminhos de cada IA centralizados.
- Busca em 3 níveis (titulos, cabecalho, ler até 3); buscar só sugere.
- Tarefas de IA só por ação do dono.
- Skills nascem em skills-biblioteca/ e são instaladas por instalar_basico.py.

## Estado atual
Fase 1.4 pronta: validar, indice, busca, salvar, 4 skills instaladas e o comando /compactar. Testes: 45 passando.

## Próximos passos
Aba Cérebro no widget, aba Projetos, aba Skills com custo em tokens, limites de uso, importador de conversas, medir a economia (fase 6).

## Armadilhas
- Só iniciar o Python leva ~230 ms nesta máquina.
- Git Bash troca "/comando" por caminho: use MSYS_NO_PATHCONV=1.
- No PowerShell 5.1, mande UTF-8 ao python com $OutputEncoding.
