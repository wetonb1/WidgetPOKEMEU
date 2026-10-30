# Meu Widget + Cérebro — instruções para IAs

## O widget
Widget pessoal para Windows 10 (só o dono usa): janela flutuante sem borda, sempre no topo. Abas (Alt+1 a Alt+6): `sys`
(gerenciador de tarefas), `music`, `apps`, `cerebro`, `projetos` e `skills`. Engrenagem = Settings (Pokédex e ajustes, Alt+0);
botão de desligar o PC com 2 confirmações.
- Stack: Electron + JavaScript puro, HTML e CSS. Sem frameworks, sem bundler, sem dependências de runtime.
  Ponte com o Windows: `app/helper.cs` (e `app/media.ps1` de reserva): mudou um, mude o outro.
  O Claude e o Antigravity (`agy`) rodam DENTRO do widget (aba Projects): `app/pty.cs` (ConPTY, compilado 1x com o csc) + `app/pty.js`/`app/embutido.js`
  + xterm.js em `app/vendor/xterm` (carregado só ao abrir a 1ª sessão); sem csc cai no terminal externo.
- Entrada: `app/main.js`; tela em `app/index.html` + `app/renderer.js` via `app/preload.js`.
  Config: `%APPDATA%\meu-widget\config.json`.
- Segurança: `contextIsolation: true`, `nodeIntegration: false`, CSP, nenhuma porta de rede aberta.
- Como cada aba funciona e as decisões: `docs/WIDGET.md`. Custos: `docs/OTIMIZACAO.md`.

## Regra de leveza
- Nada de processos pesados ou loops rápidos em segundo plano; todo recurso novo vem com o custo estimado (`npm run medir`).
- Rede só por clique do dono (catálogo de skills em `app/catalogo-skills.js`: GitHub, nada é executado, revisar antes de adicionar).
- Tarefas de IA (resumir, importar, consolidar) só disparam por ação do dono. NUNCA rotação automática de contas;
  chave de API só em variável do Windows, nunca em arquivo.

## Cérebro (memória em Markdown, pasta `cerebro/`)
Serve para gastar menos tokens: consulte-o ANTES de pesquisar, só pelo `cerebro/tools/cerebro.py` (skill cerebro-buscar).
Nunca leia os arquivos dele direto.
- Ordem: 1) `buscar termos --projeto X` (1 chamada, já traz o estado); 2) `ler` só o que combinar (máx. 3 arquivos);
  3) nada combinou: siga normalmente.
- Conversas: `cerebro/conversas/AAAA-MM-DD_assunto-de-3-a-6-palavras.md`. Linha 1 `palavras-chave: ...` (5 a 10 termos),
  linha 2 `data: AAAA-MM-DD | origem: X | projeto: Y`, linha 3 vazia, corpo com até 12 tópicos ou 150 palavras.
  Estados: `cerebro/estado/{projeto}.md` (6 seções, 300 palavras). Para gravar use `cerebro.py salvar` (ele valida).
- Ferramentas e fluxos (projetos, skills, uso, importador, economia, manutenção): `cerebro/README.md` e `docs/WIDGET.md`.
  `importacoes/` fica fora do git.
- Aba Cérebro abre no grafo 3D e tem a troca Graph | Search (grafo estilo Obsidian, canvas puro feito à mão, dados do
  `grafo.py`; simulação curta que para; sem mexer, nada é desenhado; busca, leitor e o menu "mais" ficam em Search).
- Claude Code e Antigravity usam o cérebro; os dados de cada IA (executável, modelos, arquivo de regras) ficam em `app/ias-dados.json`
  e o que é código (argumentos, telas) em `app/ias.js`. O AGENTS.md é cópia deste arquivo: `python cerebro/tools/regras.py verificar`.

## Regras de trabalho
- Um passo por vez; explicar o plano antes de editar. Não apagar arquivos sem perguntar.
- Commits pequenos, em português. Testar antes de dizer que terminou (no mínimo `node --check`).
  O dono roda `npm start`: explique como testar. A cada etapa, dizer quais arquivos mudaram. Responder em português.
- Imagens de Pokémon nunca ficam no projeto (vêm da PokéAPI em tempo de execução).
