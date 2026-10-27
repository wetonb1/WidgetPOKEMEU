# Meu Widget

Widget pessoal para Windows 10: um Pokémon no canto da tela que mostra CPU e RAM,
controla a música (com visualizador e volume), guarda atalhos de apps e sites e tem
um terminal PowerShell embutido para rodar o Claude Code.

## Instalar

Precisa do [Node.js](https://nodejs.org) (versão 20 ou mais nova) e do Windows 10 1809 ou mais novo.

```powershell
cd "D:\programação\widget"
npm install
```

## Atalhos do dia a dia

| Quero... | Faça |
|---|---|
| Abrir o widget (pelo código) | `npm start` |
| Abrir o widget (pelo `.exe`) | dois cliques em `Meu Widget.exe` (na raiz da pasta) |
| Gerar o `.exe` | `npm run dist` (feche o widget antes). O `Meu Widget.exe` novo fica na raiz e a pasta `dist` é apagada. É portátil: não precisa instalar e dá para copiar para qualquer pasta |
| Editar a minha config | dois cliques em `abrir-config.bat` (feche o widget antes) |
| Abrir junto com o Windows (modo `npm start`) | atalho do `iniciar-widget.vbs` em `shell:startup` (veja abaixo) |
| Medir o consumo de CPU e RAM | `npm run medir -- -Cenario A` (veja [docs/OTIMIZACAO.md](docs/OTIMIZACAO.md)) |
| Refazer o ícone | `npm run icone` |

## Estrutura da pasta

```
widget/
├─ app/                  o código do widget
│  ├─ main.js            processo principal (janela, config, terminal, música, sistema)
│  ├─ preload.js         ponte segura entre a tela e o main.js
│  ├─ index.html         a tela
│  ├─ style.css          o visual (CMD e iOS)
│  ├─ estilo.js          escolhe o visual antes de desenhar a tela
│  ├─ renderer.js        a lógica da tela (abas, Pokémon, narração...)
│  ├─ temas.js           cor, animação e bordão de cada tipo de Pokémon (e de cada fonte de anime)
│  ├─ franquias.js       personagens de anime (AniList) e a cor de cada um
│  ├─ falas.js           as frases de cada dono (Pokémon, anime e personagens conhecidos)
│  ├─ helper.cs          o "medidor": música, volume, processos, vidro... compilado uma vez (leve)
│  ├─ media.ps1          o mesmo trabalho em PowerShell (reserva, se o medidor não puder ser usado)
│  └─ config.json        modelo da config (a sua fica em %APPDATA%\meu-widget)
├─ assets/               ícone (a pokébola cúbica vermelha)
├─ docs/                 OTIMIZACAO.md (medições de consumo) e FRANQUIAS.md (fontes de anime)
├─ tools/                medidor de consumo e gerador do ícone
├─ Meu Widget.exe        o executável (gerado por npm run dist)
├─ abrir-config.bat      abre a sua config no Bloco de Notas
├─ iniciar-widget.vbs    abre o widget sem janela de console (para o shell:startup)
├─ README.md             este arquivo
└─ CLAUDE.md             contexto do projeto para o Claude Code
```

## Como é o widget

Um terminal horizontal no canto superior direito que um Pokémon "invadiu":

- **Abertura:** uma pokébola cúbica gira enquanto a barra enche (vermelha antes de escolher o Pokémon; depois, na cor dele).
- **Primeira vez:** tudo fica bloqueado até você escolher o Pokémon (digite o nome ou clique numa sugestão). Depois ele sempre volta ao abrir, até você trocar.
- **Dois visuais** (aba `poke` → ajustes → **visual**): **CMD** (fundo preto, texto cinza, Consolas) ou **iOS** (vidro: o que está atrás da janela fica desfocado, fundo meio transparente, cantos bem redondos, abas em pílula, balões de conversa e chaves). No iOS, **a cor do vidro acompanha o que está atrás do widget**: passou uma janela vermelha por trás, o vidro fica avermelhado; sem janela, segue o papel de parede. A troca é na hora. Nos dois, o tipo do Pokémon muda a cor de destaque.
- **Esquerda:** o Pokémon grande (sprite em pixel art, sempre inteiro), o nome e a **narração**, com ele comentando o que você faz.
- **Tamanho:** puxe as bordas para redimensionar (de 720x320 até 1400x900). O tamanho fica salvo, e o Pokémon cresce junto.
- **Abas** (clique ou `Alt+1` a `Alt+5`): `sys` (CPU, RAM e processos que estão usando o PC), `music` (player, visualizador e volume), `apps` (atalhos), `term` (PowerShell e Claude Code; a janela estica para baixo) e `poke` (trocar Pokémon, favoritos, shiny e ajustes).
- **Barra de status:** CPU e RAM do PC, **a RAM que o próprio widget está usando** ("widget 125 MB", somando todos os processos dele), música e hora, sempre visíveis (também no modo mini).
- **Botões do topo:** 📌 fixa ou solta o "sempre no topo" (solto, ele aparece na barra de tarefas), `_` minimiza para o modo mini (só o Pokémon e o status) e ✕ fecha.
- **Rosto:** clicar nele abre a aba `poke`.

## Iniciar com o Windows

- **Com o `.exe`:** abra o `.exe` uma vez. Com **"iniciar com o Windows"** marcado na aba `poke` (vem marcado), ele se registra para abrir no login.
- **Sem o `.exe` (modo `npm start`):**
  1. Aperte `Win+R`, digite `shell:startup` e dê Enter.
  2. Na pasta do projeto, clique com o botão direito em `iniciar-widget.vbs` e escolha **Criar atalho**.
  3. Mova esse atalho para a pasta que abriu no passo 1.

  O `.vbs` roda `npm start` escondido, sem janela de console.

**Desativar:**
- `.exe`: desmarque "iniciar com o Windows" na aba `poke`, ou desative "Meu Widget" em Gerenciador de Tarefas > Inicializar.
- `npm start`: apague o atalho da pasta `shell:startup`.

## Configuração

Fica em `%APPDATA%\meu-widget\config.json`, criada na primeira execução a partir do
modelo `app/config.json`. Feche o widget, abra com `abrir-config.bat`, edite e abra o widget de novo.

- **Anime (franquias):** na aba `poke`, troque a fonte para **Anime · AniList** e busque um personagem (Enter). As cores do widget passam a ser as do personagem (tiradas da imagem dele). Clique em outro resultado para trocar. A ☆ funciona igual; o ✦ só vale para Pokémon. Detalhes em [docs/FRANQUIAS.md](docs/FRANQUIAS.md). Na config: `"fonte"`, `"personagem"`, `"ultimaBusca"` e `"favoritosFranquias"`.
- **Pokémon:** na aba `poke`, digite o nome ou o número e dê Enter. A ★ guarda nos favoritos (botão direito no favorito remove) e o ✦ alterna a versão brilhante. Na config: `"pokemon"`, `"shiny"`, `"favoritos"` e `"pokemonEscolhido"` (com `false`, volta a tela da primeira escolha).
- **Janela:** `"fixado"` (sempre no topo), `"aba"` (a aba que abre; a `term` nunca abre sozinha) e `"janela"` (o tamanho salvo).
- **Apps (1 clique):** na aba `apps`, clique em **[+ adicionar]**: aparecem os programas abertos agora, sites populares e tudo o que está no Menu Iniciar (inclusive apps da Microsoft Store). Clique num item para adicionar (✓) e clique de novo para tirar. Digite no campo para buscar e Enter adiciona o primeiro. Também dá para **colar um link ou caminho** e dar Enter (ou Ctrl+V direto na aba) e **arrastar** um programa, atalho, pasta ou link para a aba. Cada app aparece com a sua foto (o mesmo ícone que o Windows mostra, inclusive para apps da Microsoft Store; sites usam o favicon), e atalhos de programas já desinstalados não entram na lista. **Clicar num app que já está aberto traz a janela dele para a frente** (em vez de abrir outra cópia); sites abrem normalmente. **Botão direito num app abre "editar app"**: trocar o nome, escolher outro ícone (qualquer imagem; clique no ícone ou em "trocar ícone"), voltar ao ícone original ou remover. Atalhos .url (como os de jogos do Steam) mostram o ícone de verdade. **Para reorganizar, segure um app por uns 0,6 s**: ele levanta, e é só arrastar para onde quiser (os outros abrem espaço); soltar grava a nova ordem, e Esc cancela. Na config: `"apps"` (a ordem da lista é a ordem na tela; o ícone escolhido fica em `"icone"`).
- **Visual:** `"estilo"` (`"cmd"` ou `"ios"`).
- **Leveza:** o widget usa um programinha auxiliar (compilado sozinho na primeira abertura, em `%APPDATA%\meu-widget`) em vez de um PowerShell residente: **~125 MB de RAM** em vez de ~185 MB. Se ele não puder ser usado, o PowerShell assume, sem perder nada. `"redeEmProcesso": true` tira mais ~12 MB (a rede roda no processo principal, com menos isolamento).
- **Desempenho e recursos:** `"desempenho"` (`"normal"` ou `"economico"`), `"economiaAutomatica"`, `"visualizador"`, `"animacoes"`, `"gifAnimado"` e `"aceleracaoGPU"`. O custo medido de cada um está em [docs/OTIMIZACAO.md](docs/OTIMIZACAO.md).
- **Boas-vindas:** `"boasVindas": { "ativo", "voz", "chamar" }` (o Pokémon não grita mais: nem ao abrir, nem ao trocar).
