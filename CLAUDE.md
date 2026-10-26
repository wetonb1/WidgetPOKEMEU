# Meu Widget — contexto do projeto

Widget pessoal para Windows 10, só para uso do dono. Construído passo a passo, em etapas.

## Projeto

Widget flutuante (sem borda, transparente, sempre no topo, fora da barra de tarefas) no canto superior direito da tela, com 5 módulos:

1. **Sistema**: CPU, RAM e processos mais pesados.
2. **Música**: play, pause, próxima, anterior, capa e visualizador de áudio.
3. **Apps**: atalhos clicáveis para programas do PC ou sites, que o usuário pode adicionar e remover.
4. **Pokémon**: um Pokémon escolhido pelo usuário vira o rosto do widget; o tipo dele muda cores, fonte, bordas, animação e falas.
5. **Terminal embutido**: PowerShell real, para rodar o Claude Code dentro do widget.

Quando o widget iniciar junto com o Windows, o Pokémon dá boas-vindas ("Olá, meu mestre!") com texto, grito e voz.

**Visual (desde a reformulação):** janela horizontal **o mais parecida possível com um CMD** (opaca, fundo #0c0c0c, texto #cccccc, Consolas, cantos retos, barra de título estilo Windows), que o Pokémon "invadiu". O Pokémon fica à esquerda, em destaque e sempre inteiro (sprite em pixel art, com a margem transparente recortada e ampliado em escala inteira quando possível): nome e narração (ele comenta tudo o que acontece). O tipo muda só a cor de destaque, a animação e o bordão. Os módulos ficam em abas (`sys`, `music`, `apps`, `term`, `poke`), uma por vez, com uma linha de status embaixo. A janela é redimensionável entre 720x320 e 1400x900 (tamanho salvo em `janela`). Há pin (sempre no topo), modo mini e, na primeira vez, tudo fica bloqueado até escolher o Pokémon. Sem efeitos retrô (pontos, LED, brilhos): o usuário pediu visual de CMD. Ao abrir, uma tela de carregamento com uma pokébola cúbica (CSS 3D) gira enquanto a barra enche; ela usa a cor do Pokémon (`corPokebola`) ou vermelha antes da escolha. O ícone (`assets/icone.ico`) é a pokébola vermelha, gerado por `npm run icone`.

## Stack e regras

- Electron 31 ou mais novo, JavaScript puro, HTML e CSS. **Sem frameworks e sem bundler.**
- Dependências: `systeminformation`, `@lydell/node-pty`, `@xterm/xterm`, `@xterm/addon-fit`.
- `electron` e `electron-builder` como `devDependencies`.
- **Segurança**: `contextIsolation: true`, `nodeIntegration: false`. Tudo que a tela precisa passa pelo `preload.js` (`contextBridge`) com canais nomeados. CSP no `index.html`. Nenhuma porta de rede aberta.
- **Pastas**: o código fica em `app/` (`main.js`, `preload.js`, `index.html`, `style.css`, `renderer.js`, `temas.js`, `media.ps1` e `config.json` modelo); `assets/` (ícone), `docs/` (OTIMIZACAO.md), `tools/` (medidor e gerador de ícone). Na raiz ficam o `Meu Widget.exe` (gerado por `npm run dist`, que apaga a pasta `dist` no fim), os atalhos (`abrir-config.bat`, `iniciar-widget.vbs`), README, CLAUDE.md e package.json.
- A config do usuário fica em `%APPDATA%\meu-widget\config.json` (copiada do modelo na primeira execução).
- Só Windows 10 (1809 ou mais novo) e PowerShell 5.1.
- Código simples, comentado em português.
- Imagens de Pokémon **nunca** ficam no projeto: vêm da PokéAPI em tempo de execução.

## Como trabalhamos

- O dono roda o widget com `npm start` e conta o resultado. Claude não vê a janela.
- Sempre rodar `node --check` nos `.js` alterados e explicar como testar cada etapa.
- **Prioridade: consumo mínimo de CPU, RAM e GPU.** Sem loops rápidos sem necessidade; todo recurso novo deve vir com o custo estimado.
- A cada etapa: dizer quais arquivos mudaram.
- A pasta é um repositório git: fazer um commit curto em português quando a etapa estiver pronta.
- Medir custo com `npm run medir` (veja docs/OTIMIZACAO.md) antes e depois de mudanças que possam pesar.
