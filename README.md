# Meu Widget

Widget pessoal para Windows 10: um Pokémon no canto da tela que mostra CPU e RAM,
controla a música (com visualizador e volume), guarda atalhos de apps e sites e mostra
o personagem que você escolher (Pokémon ou anime).

> Esta é a versão para **usuários comuns**, sem terminal. A versão para desenvolvedores (com terminal e outras
> ferramentas) é separada. A última versão com terminal é a **v1.6**.

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
| Abrir o widget (pelo `.exe`) | dois cliques em `MeuWidget.exe` (na raiz da pasta) |
| Gerar o `.exe` | `npm run dist` (feche o widget antes). O `MeuWidget.exe` novo fica na raiz e a pasta `dist` é apagada. É portátil: não precisa instalar e dá para copiar para qualquer pasta |
| Editar a minha config | dois cliques em `abrir-config.bat` (feche o widget antes) |
| Abrir junto com o Windows (modo `npm start`) | atalho do `iniciar-widget.vbs` em `shell:startup` (veja abaixo) |
| Medir o consumo de CPU e RAM | `npm run medir -- -Cenario A` (veja [docs/OTIMIZACAO.md](docs/OTIMIZACAO.md)) |
| Refazer o ícone | `npm run icone` |

## Estrutura da pasta

```
widget/
├─ app/                  o código do widget
│  ├─ main.js            processo principal (janela, config, música, sistema, apps)
│  ├─ preload.js         ponte segura entre a tela e o main.js
│  ├─ index.html         a tela
│  ├─ style.css          o visual (CMD e iOS)
│  ├─ estilo.js          escolhe o visual antes de desenhar a tela
│  ├─ renderer.js        a lógica da tela (abas, Pokémon, narração...)
│  ├─ temas.js           cor, animação e bordão de cada tipo de Pokémon (e de cada fonte de anime)
│  ├─ franquias.js       personagens de anime (AniList) e a cor de cada um
│  ├─ falas.js           as frases de cada dono (Pokémon, anime e personagens conhecidos)
│  ├─ ias-dados.json     os dados de cada IA (Claude Code e Antigravity: executável, modelos, variável da chave, regras...)
│  ├─ ias.js             os argumentos, limpeza de ambiente e telas de cada IA
│  ├─ abrir.js           abre a sessão da IA (dentro do widget ou no terminal externo), trava por pasta e worktree
│  ├─ embutido.js        gerencia as sessões que rodam dentro do widget (ConPTY + xterm.js)
│  ├─ pty.cs / pty.js    o host de pseudo-console (ConPTY) compilado uma vez com o csc.exe do Windows
│  ├─ sessoes.js         acompanha as sessões ativas (claude.exe e agy.exe), foca e encerra
│  ├─ uso-tela.js        lê da tela embutida os medidores do /usage do Claude Code
│  ├─ uso-tela-agy.js    lê da tela embutida os medidores do /usage do Antigravity (o que resta)
│  ├─ conta.js           migra e sanitiza por IA o último /usage lido e o aviso de trocar conta
│  ├─ helper.cs          o "medidor": música, volume, processos, vidro... compilado uma vez (leve)
│  ├─ media.ps1          o mesmo trabalho em PowerShell (reserva, se o medidor não puder ser usado)
│  └─ config.json        modelo da config (a sua fica em %APPDATA%\meu-widget)
├─ assets/               ícone (a pokébola cúbica vermelha)
├─ cerebro/              a memória (conversas, estado) e as ferramentas em Python (tools/)
├─ skills-biblioteca/    as skills do cérebro (e variantes por IA) e o skills.py (instalar, remover, importar)
├─ docs/                 WIDGET.md, OTIMIZACAO.md (medições), FRANQUIAS.md, claude-code.md, antigravity.md e teste-economia.md
├─ tools/                medidor de consumo, gerador do ícone e testes automatizados
├─ MeuWidget.exe         o executável (gerado por npm run dist)
├─ abrir-config.bat      abre a sua config no Bloco de Notas
├─ iniciar-widget.vbs    abre o widget sem janela de console (para o shell:startup)
├─ README.md             este arquivo
├─ CLAUDE.md             contexto e regras do projeto para o Claude Code
└─ AGENTS.md             contexto e regras do projeto para o Antigravity (mesmo conteúdo do CLAUDE.md, conferido por regras.py)
```

## Como é o widget

Um terminal horizontal no canto superior direito que um Pokémon "invadiu":

- **Abertura:** uma pokébola cúbica gira enquanto a barra enche (vermelha antes de escolher o Pokémon; depois, na cor dele).
- **Primeira vez:** tudo fica bloqueado até você escolher o Pokémon (digite o nome ou clique numa sugestão). Depois ele sempre volta ao abrir, até você trocar.
- **Dois visuais** (engrenagem ⚙ → Settings → **visual**): **CMD** (fundo preto, texto cinza, Consolas) ou **iOS** (vidro fosco opaco, cantos bem redondos, abas em pílula, balões de conversa e chaves). No iOS, **as cores do fundo acompanham o que está AO REDOR do widget**, lado a lado: uma janela vermelha encostada à esquerda deixa a borda esquerda avermelhada, o papel de parede embaixo tinge a parte de baixo. O que está atrás do widget não aparece. A troca é suave, a cada 1,5 s. Nos dois, o tipo do Pokémon muda a cor de destaque.
- **Esquerda:** o Pokémon grande (sprite em pixel art, sempre inteiro), o nome e a **narração**, com ele comentando o que você faz.
- **Tamanho:** puxe as bordas para redimensionar (de 720x320 até 1400x900). O tamanho fica salvo, e o Pokémon cresce junto.
- **Abas** (clique ou `Alt+1` a `Alt+6`): **System** (gerenciador de tarefas), **Music** (player, visualizador e volume), **Apps** (atalhos) e as três do cérebro: **Brain**, **Projects** e **Skills** (veja [Como usar as abas do cérebro](#como-usar-as-abas-do-cérebro)). A **engrenagem ⚙** (ou `Alt+0`) abre o **Settings**: trocar Pokémon ou personagem, favoritos, shiny, visual e ajustes.
- **Barra de status:** CPU e RAM do PC, **a RAM que o próprio widget está usando** ("widget 125 MB", somando todos os processos dele), música e hora, sempre visíveis (também no modo mini).
- **Botões do topo:** ⚙ abre o Settings, 📌 fixa ou solta o "sempre no topo" (solto, ele aparece na barra de tarefas), `_` minimiza para o modo mini (só o Pokémon e o status), ⏻ **desliga o PC** e ✕ fecha. O ⏻ pede **duas confirmações** em sequência e depois dá 20 segundos para cancelar (`shutdown /a`).
- **Rosto:** clicar nele abre o Settings.

## System (`Alt+1`): o Gerenciador de Tarefas

Duas listas, com busca e ordem por nome, CPU ou memória:
- **Apps:** os programas com janela aberta (como a lista "Aplicativos" do Gerenciador de Tarefas). **`[fechar]`** pede para o programa fechar (ele pode perguntar se você quer salvar); se não fechar, aparece **`[forçar]`**.
- **Processes:** todos os processos, agrupados por nome, com CPU e memória. **`[encerrar]`** pede um segundo clique de certeza.
- **`[fechar todos os apps]`:** mostra a lista do que dá para fechar (com caixas para desmarcar), fecha com educação e depois diz o que ficou aberto. **Nunca entram** o Windows, o shell, o que roda em segundo plano do sistema e o próprio widget: o processo principal recusa mesmo que a tela peça.
- A lista só é lida enquanto a aba está aberta.

## Como usar as abas do cérebro

O **cérebro** é uma memória em Markdown (pasta `cerebro/`) que o **Claude Code** (`claude`) e o **Antigravity** (`agy`) consultam para não gastar tokens reexplicando os seus projetos.
Tudo nas abas abaixo **só roda quando você clica**: nada fica em segundo plano. Precisam do Python 3. Detalhes e comandos em
[cerebro/README.md](cerebro/README.md), [docs/WIDGET.md](docs/WIDGET.md), [docs/claude-code.md](docs/claude-code.md) e [docs/antigravity.md](docs/antigravity.md).

### Brain (`Alt+4`)
A aba **abre sempre no grafo 3D**. A troca **Graph | Search** (no topo das duas telas) leva à tela de busca e de volta.
- **Grafo 3D:** cada projeto é o centro de uma estrela, na cor dele; cada conversa e cada estado é uma bolinha ligada ao seu projeto, e conversas com 2+
  palavras-chave em comum se ligam. **Arrastar o fundo gira**, **a roda amplia** (na direção do cursor), **botão direito ou Shift+arrastar move a vista** e
  **arrastar uma bolinha move o arquivo** (os vizinhos acompanham e ela fica onde você soltou, com um anel branco; `[soltar]` a devolve).
  Clique mostra os detalhes, duplo clique abre o arquivo, a barra de cima filtra (Enter vai até o resultado) e `R`/`[centralizar]` enquadra tudo.
- **Search:** escreva termos + Enter (escolha o projeto ao lado). Clique num resultado para ler; `[copiar]` e `[abrir no editor]` estão ali. Quem abre um arquivo pelo grafo volta ao grafo com `[< voltar]`.
- **`[mais ▾]`** (na busca) guarda as ações menos usadas: **compactar conversa** (guarda no cérebro o resumo de um chat, com origem `claude-code`, `antigravity`, `claude`, `chatgpt` ou `gemini`), **copiar prompt de compactação** (para colar no fim de um chat de site ou app), **validar formato**, **refazer índice** (`INDICE.md`), a economia e a manutenção.
- **Economia:** o cérebro está compensando? Consultas por semana, tokens evitados (estimativa) e o teste A/B manual (roteiro em [docs/teste-economia.md](docs/teste-economia.md)).
- **Manutenção:** diagnóstico sem IA (arquivos parados, palavras-chave quase iguais, resumos parecidos, estados velhos), sinônimos para a busca, consolidação e proposta de estado (essas duas usam o Claude Code em modo sem ferramentas, mostram a estimativa de tokens e pedem confirmação), índices por projeto e **backup** em `.zip` (pode ter dados pessoais: não envie a repositório público).

### Projects (`Alt+5`)
- **`[+ adicionar]`:** cadastra um projeto (pasta, IA padrão — Claude Code ou Antigravity —, modelo padrão, IA reserva e cor); o `id` é o mesmo do cérebro. Cada cartão mostra o seletor de IA (**`claude`** | **`agy`**), o **modelo** (no Claude em pílulas Sonnet/Opus/Haiku; no Antigravity na lista dos modelos dele), **`[▶ abrir claude]`** / **`[▶ abrir agy]`**, **`[continuar no {outra IA}]`** (com a data da última sessão nela) e **`[continuar última]`**. O **`[mais ▾]`** guarda **escolher sessão anterior** (no Claude; no `agy` use `/resume` dentro da sessão), **editar**, **preparar projeto** (cria ou acrescenta a seção Cérebro no `CLAUDE.md` e no `AGENTS.md` da pasta), **pausar com segurança** e **remover**.
- **O Claude e o Antigravity abrem dentro do widget**, num **painel lateral** ao lado da lista de projetos, com o mesmo visual (CMD ou iOS): um terminal de verdade (xterm.js + pseudo-console do Windows), com uma aba por sessão. **`[▶ abrir claude]` / `[▶ abrir agy]` abrem direto**, sem perguntar tarefa e sem prompt inicial: a IA já fica pronta para você digitar. Funcionam Esc, Ctrl+C (com texto selecionado, copia), **colar (Ctrl+V, Shift+Insert ou botão direito)** e o tamanho acompanha a janela. `[esconder]` recolhe o painel **sem encerrar** nada; em janela estreita o Pokémon se esconde sozinho para dar espaço (`[ampliar]`/`[reduzir]` inverte); o ✕ da aba pede um segundo clique para encerrar. A trava por pasta vale **entre IAs** (Claude aberto na pasta avisa ao abrir o `agy` e oferece `git worktree`). Nunca pula permissões, a menos que você ligue isso no projeto (e nunca herda ao continuar em outra IA). Sem o `csc.exe` do Windows, abre no terminal externo de sempre.
- **Sessões ativas:** lista o que o widget abriu com o selo da IA (`claude` ou `agy`; `[abrir]` mostra o terminal, `[encerrar]` oferece compactar antes com `/cerebro-compactar`). O aviso aparece a partir de `max_sessoes` (3). `Ctrl+Alt+A` abre o seletor rápido.
- **`[uso e continuidade]`:** escolha a IA e clique em **`[ver agora]`**: ela abre aqui dentro (ou usa a sessão já aberta), digita `/usage` sozinho **só quando estiver esperando você** (numa pergunta de confirmação, nunca digita nem aperta nada) e lê da tela os medidores (no Claude, o % **usado** da sessão e semana; no Antigravity, o % **restante** por grupo de modelos), desenhando as barras. Embaixo, a contagem local de **sessões abertas pelo widget** nos 7 dias agrupada por IA e por modelo (`C2 A1`), e os atalhos **`[pausar com segurança]`** (compacta com `/cerebro-compactar`, atualiza o estado, anota a pausa com a IA pausada e sugere continuar na IA com menos sessões nas últimas 24 h) e **`[trocar de conta]`** (passos conferidos de cada IA, nada automático).

### Skills (`Alt+6`)
- Na primeira vez (e em **`[como funciona]`**) um quadro explica em 3 passos: **Biblioteca** (suas skills, num lugar só), **Instalar** (no projeto ou global) e **A IA usa** (custo fixo em toda conversa; o texto inteiro só quando a skill é usada).
- Seletor de IA no topo (**`Claude`** | **`Antigravity`** | **`Ambos`**): mostra o **imposto fixo** de cada IA numa barra de 0 a 3.000 tokens (verde, amarela, vermelha; no Antigravity é sempre estimado e o `GEMINI.md` global não confirmado fica fora da conta, indicado na dica).
- **`[buscar online]`:** catálogo de skills no GitHub: as oficiais da **Anthropic** (Claude), as da **OpenAI** (Codex, mesmo formato `SKILL.md`), **repositórios da comunidade** (pelos mais estrelados) ou qualquer `dono/repositório` que você digitar, com filtro pela descrição. **`[baixar]`** traz só a pasta da skill (até 80 arquivos, 1 MB cada e 5 MB no total) e abre a **mesma revisão segura** de importar: o `SKILL.md` inteiro, os scripts e os alertas. Só entra na biblioteca com o seu clique e **nada é executado**. Sem internet ou com o limite do GitHub (60 consultas por hora sem conta) estourado, mostra a lista guardada e explica.
- Um cartão por skill da biblioteca, com selos por IA (`Claude: projeto`, `Antigravity: projeto`), custo fixo e "ao usar" (respeitando variantes em `variantes/<ia>/SKILL.md`). **`[instalar]`/`[remover]`** (projeto ou global) perguntam em qual IA (`Claude`, `Antigravity` ou `Ambos`), mostram antes quanto o imposto muda em cada uma e pedem confirmação. **`[comparar]`** põe todas lado a lado e **`[importar]`** (pasta ou `.zip` seu) revisa o conteúdo antes de adicionar (nada é executado).

### Importar conversas antigas (linha de comando)
Coloque as exportações do Claude, ChatGPT ou Gemini em `importacoes/` (fica fora do git) e rode `python cerebro/tools/importar.py rodar` (sem IA; limpa segredos e gera o `candidatas.csv` para você revisar no Excel). Depois `importar.py resumir --simular` (3 de amostra) e `--lote 20`: esta etapa usa o Claude Code e pede confirmação a cada lote.

## Iniciar com o Windows

- **Com o `.exe`:** abra o `.exe` uma vez. Com **"iniciar com o Windows"** marcado no Settings (⚙) (vem marcado), ele se registra para abrir no login.
- **Sem o `.exe` (modo `npm start`):**
  1. Aperte `Win+R`, digite `shell:startup` e dê Enter.
  2. Na pasta do projeto, clique com o botão direito em `iniciar-widget.vbs` e escolha **Criar atalho**.
  3. Mova esse atalho para a pasta que abriu no passo 1.

  O `.vbs` roda `npm start` escondido, sem janela de console.

**Desativar:**
- `.exe`: desmarque "iniciar com o Windows" no Settings (⚙), ou desative "Meu Widget" em Gerenciador de Tarefas > Inicializar.
- `npm start`: apague o atalho da pasta `shell:startup`.

## Configuração

Fica em `%APPDATA%\meu-widget\config.json`, criada na primeira execução a partir do
modelo `app/config.json`. Feche o widget, abra com `abrir-config.bat`, edite e abra o widget de novo.

- **Anime (franquias):** no Settings (⚙), troque a fonte para **Anime · AniList** e busque um personagem (Enter). As cores do widget passam a ser as do personagem (tiradas da imagem dele). Clique em outro resultado para trocar. A ☆ funciona igual; o ✦ só vale para Pokémon. Detalhes em [docs/FRANQUIAS.md](docs/FRANQUIAS.md). Na config: `"fonte"`, `"personagem"`, `"ultimaBusca"` e `"favoritosFranquias"`.
- **Pokémon:** no Settings (⚙), digite o nome ou o número e dê Enter. A ★ guarda nos favoritos (botão direito no favorito remove) e o ✦ alterna a versão brilhante. Na config: `"pokemon"`, `"shiny"`, `"favoritos"` e `"pokemonEscolhido"` (com `false`, volta a tela da primeira escolha).
- **Janela:** `"fixado"` (sempre no topo), `"aba"` (a última aba aberta) e `"janela"` (o tamanho salvo).
- **Apps (1 clique):** na aba `apps`, clique em **[+ adicionar]**: aparecem os programas abertos agora, sites populares e tudo o que está no Menu Iniciar (inclusive apps da Microsoft Store). Clique num item para adicionar (✓) e clique de novo para tirar. Digite no campo para buscar e Enter adiciona o primeiro. Também dá para **colar um link ou caminho** e dar Enter (ou Ctrl+V direto na aba) e **arrastar** um programa, atalho, pasta ou link para a aba. Cada app aparece com a sua foto (o mesmo ícone que o Windows mostra, inclusive para apps da Microsoft Store; sites usam o favicon), e atalhos de programas já desinstalados não entram na lista. **Clicar num app que já está aberto traz a janela dele para a frente** (em vez de abrir outra cópia); sites abrem normalmente. **Botão direito num app abre "editar app"**: trocar o nome, escolher outro ícone (qualquer imagem; clique no ícone ou em "trocar ícone"), voltar ao ícone original ou remover. Atalhos .url (como os de jogos do Steam) mostram o ícone de verdade. **Para reorganizar, segure um app por uns 0,6 s**: ele levanta, e é só arrastar para onde quiser (os outros abrem espaço); soltar grava a nova ordem, e Esc cancela. Na config: `"apps"` (a ordem da lista é a ordem na tela; o ícone escolhido fica em `"icone"`).
- **Visual:** `"estilo"` (`"cmd"` ou `"ios"`).
- **Leveza:** o widget usa um programinha auxiliar (compilado sozinho na primeira abertura, em `%APPDATA%\meu-widget`) em vez de um PowerShell residente: **~125 MB de RAM** em vez de ~185 MB. Se ele não puder ser usado, o PowerShell assume, sem perder nada. `"redeEmProcesso": true` tira mais ~12 MB (a rede roda no processo principal, com menos isolamento).
- **Desempenho e recursos:** `"desempenho"` (`"normal"` ou `"economico"`), `"economiaAutomatica"`, `"visualizador"`, `"animacoes"`, `"gifAnimado"` e `"aceleracaoGPU"`. O custo medido de cada um está em [docs/OTIMIZACAO.md](docs/OTIMIZACAO.md).
- **Boas-vindas:** `"boasVindas": { "ativo", "voz", "chamar" }` (o Pokémon não grita mais: nem ao abrir, nem ao trocar).
