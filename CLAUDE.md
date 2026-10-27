# Meu Widget — contexto do projeto

Widget pessoal para Windows 10, só para uso do dono. Construído passo a passo, em etapas.

## Projeto

Widget flutuante (sem borda, transparente, sempre no topo, fora da barra de tarefas) no canto superior direito da tela, com 4 módulos (a versão de usuário comum não tem terminal; a v1.6 foi a última com ele):

1. **Sistema**: CPU, RAM e processos mais pesados.
2. **Música**: play, pause, próxima, anterior, capa e visualizador de áudio.
3. **Apps**: atalhos clicáveis para programas do PC ou sites, que o usuário pode adicionar e remover.
4. **Pokémon**: um Pokémon escolhido pelo usuário vira o rosto do widget; o tipo dele muda cores, fonte, bordas, animação e falas.

Quando o widget iniciar junto com o Windows, o Pokémon dá boas-vindas ("Olá, meu mestre!") com texto e voz (sem o grito do Pokémon: foi retirado a pedido do usuário, em todos os modos).

**Visual (desde a reformulação):** janela horizontal **o mais parecida possível com um CMD** (opaca, fundo #0c0c0c, texto #cccccc, Consolas, cantos retos, barra de título estilo Windows), que o Pokémon "invadiu". O Pokémon fica à esquerda, em destaque e sempre inteiro (sprite em pixel art, com a margem transparente recortada e ampliado em escala inteira quando possível): nome e narração (ele comenta tudo o que acontece). O tipo muda só a cor de destaque, a animação e o bordão. Os módulos ficam em abas (`sys`, `music`, `apps`, `poke`), uma por vez, com uma linha de status embaixo. A janela é redimensionável entre 720x320 e 1400x900 (tamanho salvo em `janela`). Há pin (sempre no topo), modo mini e, na primeira vez, tudo fica bloqueado até escolher o Pokémon. Sem efeitos retrô (pontos, LED, brilhos): o usuário pediu visual de CMD. Ao abrir, uma tela de carregamento com uma pokébola cúbica (CSS 3D) gira enquanto a barra enche; ela usa a cor do Pokémon (`corPokebola`) ou vermelha antes da escolha. O ícone (`assets/icone.ico`) é a pokébola vermelha, gerado por `npm run icone`.

**Dois visuais (config `estilo`):** `"cmd"` (o padrão acima) e `"ios"`, pedido pelo usuário: "formas mais arredondadas com blur e fundo meio transparente". No iOS a janela é transparente e o desfoque REAL do que está atrás vem do Windows 10 (`SetWindowCompositionAttribute`, ACCENT_ENABLE_BLURBEHIND) mais `SetWindowRgn` para os cantos de 22 px. Os dois são aplicados pelo PowerShell persistente (`media.ps1`, comandos `vidro`/`cantos`, com o HWND). O CSS do iOS fica num bloco `[data-estilo="ios"]` no fim do `style.css`; o `estilo.js` marca o `<html>` antes de desenhar. Como a transparência só vale ao criar a janela, trocar de visual cria uma janela nova (escondida até ficar pronta, sem a tela de carregamento) e fecha a antiga.

**Leveza (medidor):** um PowerShell vazio já gasta 55 MB, então o trabalho do `media.ps1` (mídia/SMTC, volume, processos, tela cheia, vidro, ícones, janelas) também existe em C# no `app/helper.cs`, compilado pelo `main.js` com o `csc.exe` do Windows para `%APPDATA%\meu-widget\medidor-<hash>.exe` (winexe, sem console) e falando o MESMO protocolo de linhas. Se falhar (sem csc, erro, arquivo ruim), cai no `media.ps1` e apaga o arquivo ruim. As classes ListaProcessos, TelaCheia, VolumeSistema, Vidro e IconeApp existem nos dois arquivos: mudou uma, mude a outra (e confira com os 13 comandos de paridade). `startapps` só existe no PowerShell (avulso, só quando a loja abre). CPU/RAM do sistema vêm do `os`, sem `systeminformation`; `node-pty` carrega só ao abrir o terminal. Chave opcional `redeEmProcesso` (rede dentro do processo principal, -12 MB, menos isolamento; desligada por padrão). Detalhes e medições em docs/OTIMIZACAO.md.

**v1.6:** barra de status mostra a RAM do próprio widget (app.getAppMetrics privateBytes + "mem" do medidor). Apps: botão direito abre "editar app" (nome, ícone próprio em PNG 64 px base64 na chave `icone`, ícone original, remover); clicar num app já aberto traz a janela para a frente (comandos `focar-exe` pelo caminho do .exe/destino do .lnk e `focar-app` pelo AppUserModelID; o Alt "solto" antes do SetForegroundWindow é a forma de o Windows permitir a troca de foco). .url usa o `IconFile=` do arquivo. No iOS, a tinta do vidro segue a cor da janela que está atrás (comando `fundo HWND`: lê os pixels da TELA em faixas ao redor do widget, reduzidas a 16x16, a cada 1,5 s; limiar de 5/255 para repintar. Antes usava PrintWindow da janela de trás, que demorava até 8 s para reagir e vinha preto no papel de parede animado). **Vigia do arredondado** (comando `reparar HWND L A RAIO`): o Windows/Chromium às vezes zera a região da janela e o vidro volta quadrado; o medidor confere a região a cada 0,7 s e nos eventos focus/blur/show/restore/moved/display-metrics-changed/unlock/resume, e refaz arredondado + desfoque se preciso (reparo em 0,1–0,4 s). O medidor agora chama SetProcessDPIAware (coordenadas certas em escala ≠ 100%). Custo medido: iOS ocioso 0,8–1,0% de um núcleo no total. Sem o medidor (PowerShell de reserva), esses três recursos ficam desligados sem erro.

**Franquias (Etapa 6C):** além do Pokémon (PokéAPI, `loadPokemon`, intocado), o dono pode ser um personagem de anime do AniList (`app/franquias.js`, contrato `{ nome, imagem, fonte, tema, id }`, cache de 24 h, pausa de 60 s no 429). O Jikan foi retirado a pedido do usuário. No anime, as cores seguem o personagem: a cor é tirada da imagem num canvas (a CDN do AniList libera CORS) e salva em `personagem.cor`; a paleta de `FONTE_TEMA` é só reserva. Sem brilho. As falas ficam em `app/falas.js` (várias por situação; Pokémon com bordão, ~22 personagens de anime com frases próprias e um conjunto geral de anime diferente do Pokémon). Tudo em docs/FRANQUIAS.md.

**Apps em poucos cliques:** o usuário pediu que adicionar apps seja "MUITO mais fácil". A aba `apps` tem uma "loja" (programas abertos, sites populares e apps do Menu Iniciar via `Get-StartApps`, inclusive da Store), na qual 1 clique adiciona. Há também colar link/caminho + Enter e arrastar-e-soltar. Os apps se reorganizam segurando ~0,6 s e arrastando (eventos de ponteiro, não o drag-and-drop do navegador, que conflitaria com o arrastar de arquivos; fantasma que segue o mouse, vizinhos deslizam, Esc cancela, a ordem salva é a de `apps`). Cada app mostra a sua foto: programas e atalhos pelo ícone do arquivo (`getFileIcon`; para .lnk com ícone quebrado, o do programa de destino), apps da Store pelo comando `iconeapp` do `media.ps1` (IShellItemImageFactory, o mesmo do Explorer; compilado só no primeiro pedido, com cache), sites pelo favicon. Atalhos de programas desinstalados são escondidos do catálogo. Apps sem `.lnk`/`.exe` conhecido viram o tipo `"app"` (AppID, aberto com `explorer.exe shell:AppsFolder<AppID>`).

## Stack e regras

- Electron 31 ou mais novo, JavaScript puro, HTML e CSS. **Sem frameworks e sem bundler.**
- Dependências de runtime: nenhuma (só `devDependencies`). A versão com terminal usava `@lydell/node-pty`, `@xterm/xterm` e `@xterm/addon-fit`.
- `electron` e `electron-builder` como `devDependencies`.
- **Segurança**: `contextIsolation: true`, `nodeIntegration: false`. Tudo que a tela precisa passa pelo `preload.js` (`contextBridge`) com canais nomeados. CSP no `index.html`. Nenhuma porta de rede aberta.
- **Pastas**: o código fica em `app/` (`main.js`, `preload.js`, `index.html`, `estilo.js`, `style.css`, `renderer.js`, `temas.js`, `media.ps1` e `config.json` modelo); `assets/` (ícone), `docs/` (OTIMIZACAO.md), `tools/` (medidor e gerador de ícone). Na raiz ficam o `Meu Widget.exe` (gerado por `npm run dist`, que apaga a pasta `dist` no fim), os atalhos (`abrir-config.bat`, `iniciar-widget.vbs`), README, CLAUDE.md e package.json.
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
