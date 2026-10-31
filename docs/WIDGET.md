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

**Dois visuais (config `estilo`):** `"cmd"` (o padrão acima) e `"ios"`, pedido pelo usuário: "formas mais arredondadas com blur e fundo meio transparente". Desde a v1.9 o cartão do iOS é **OPACO** (pedido do usuário: "não quero que o fundo seja transparente, quero que responda só às cores em volta, não dentro"): nada do que está atrás aparece. A janela continua transparente só para os cantos de 22 px do CSS saírem lisos; não há mais desfoque do Windows nem `SetWindowRgn` (os comandos `vidro`/`cantos`/`reparar` continuam no medidor e no `media.ps1`, sem uso). O fundo é um "vidro fosco" pintado: o comando `fundo HWND` lê uma faixa de 10 px logo FORA de cada lado do widget e devolve `esquerda direita cima baixo` (`#rrggbb` ou `-` quando o lado encosta na borda da tela), a cada 1,5 s; o `renderer.js` escurece cada cor até brilho 0,2 (texto branco legível) e o CSS faz de cada uma uma mancha difusa vinda do seu lado, sobre a média (`--c-esq/--c-dir/--c-topo/--c-baixo/--c-media`, registradas com `@property` para a troca ser suave). O CSS do iOS fica num bloco `[data-estilo="ios"]` no fim do `style.css`; o `estilo.js` marca o `<html>` antes de desenhar. Como a transparência só vale ao criar a janela, trocar de visual cria uma janela nova (escondida até ficar pronta, sem a tela de carregamento) e fecha a antiga.

**Leveza (medidor):** um PowerShell vazio já gasta 55 MB, então o trabalho do `media.ps1` (mídia/SMTC, volume, processos, tela cheia, vidro, ícones, janelas) também existe em C# no `app/helper.cs`, compilado pelo `main.js` com o `csc.exe` do Windows para `%APPDATA%\meu-widget\medidor-<hash>.exe` (winexe, sem console) e falando o MESMO protocolo de linhas. Se falhar (sem csc, erro, arquivo ruim), cai no `media.ps1` e apaga o arquivo ruim. As classes ListaProcessos, TelaCheia, VolumeSistema, Vidro e IconeApp existem nos dois arquivos: mudou uma, mude a outra (e confira com os 13 comandos de paridade). `startapps` só existe no PowerShell (avulso, só quando a loja abre). CPU/RAM do sistema vêm do `os`, sem `systeminformation`; `node-pty` carrega só ao abrir o terminal. Chave opcional `redeEmProcesso` (rede dentro do processo principal, -12 MB, menos isolamento; desligada por padrão). Detalhes e medições em docs/OTIMIZACAO.md.

**v1.6:** barra de status mostra a RAM do próprio widget (app.getAppMetrics privateBytes + "mem" do medidor). Apps: botão direito abre "editar app" (nome, ícone próprio em PNG 64 px base64 na chave `icone`, ícone original, remover); clicar num app já aberto traz a janela para a frente (comandos `focar-exe` pelo caminho do .exe/destino do .lnk e `focar-app` pelo AppUserModelID; o Alt "solto" antes do SetForegroundWindow é a forma de o Windows permitir a troca de foco). .url usa o `IconFile=` do arquivo. No iOS (até a v1.8.1) o vidro era transparente com o desfoque do Windows; tentar pintar a cor de trás por palpite errava e ficava sobreposto, e por isso a v1.9 trocou para o cartão opaco com as cores ao redor (acima). Histórico: a tinta do vidro seguia a cor da janela que está atrás (comando `fundo HWND`: lê os pixels da TELA em faixas ao redor do widget, reduzidas a 16x16, a cada 1,5 s; limiar de 5/255 para repintar. Antes usava PrintWindow da janela de trás, que demorava até 8 s para reagir e vinha preto no papel de parede animado). **Vigia do arredondado** (até a v1.8.1; saiu junto com o desfoque) (comando `reparar HWND L A RAIO`): o Windows/Chromium às vezes zera a região da janela e o vidro volta quadrado; o medidor confere a região a cada 0,7 s e nos eventos focus/blur/show/restore/moved/display-metrics-changed/unlock/resume, e refaz arredondado + desfoque se preciso (reparo em 0,1–0,4 s). O medidor agora chama SetProcessDPIAware (coordenadas certas em escala ≠ 100%). Custo medido: iOS ocioso 0,8–1,0% de um núcleo no total. Sem o medidor (PowerShell de reserva), esses três recursos ficam desligados sem erro.

**Franquias (Etapa 6C):** além do Pokémon (PokéAPI, `loadPokemon`, intocado), o dono pode ser um personagem de anime do AniList (`app/franquias.js`, contrato `{ nome, imagem, fonte, tema, id }`, cache de 24 h, pausa de 60 s no 429). O Jikan foi retirado a pedido do usuário. No anime, as cores seguem o personagem: a cor é tirada da imagem num canvas (a CDN do AniList libera CORS) e salva em `personagem.cor`; a paleta de `FONTE_TEMA` é só reserva. Sem brilho. As falas ficam em `app/falas.js` (várias por situação; Pokémon com bordão, ~22 personagens de anime com frases próprias e um conjunto geral de anime diferente do Pokémon). Tudo em docs/FRANQUIAS.md.

**Apps em poucos cliques:** o usuário pediu que adicionar apps seja "MUITO mais fácil". A aba `apps` tem uma "loja" (programas abertos, sites populares e apps do Menu Iniciar via `Get-StartApps`, inclusive da Store), na qual 1 clique adiciona. Há também colar link/caminho + Enter e arrastar-e-soltar. Os apps se reorganizam segurando ~0,6 s e arrastando (eventos de ponteiro, não o drag-and-drop do navegador, que conflitaria com o arrastar de arquivos; fantasma que segue o mouse, vizinhos deslizam, Esc cancela, a ordem salva é a de `apps`). Cada app mostra a sua foto: programas e atalhos pelo ícone do arquivo (`getFileIcon`; para .lnk com ícone quebrado, o do programa de destino), apps da Store pelo comando `iconeapp` do `media.ps1` (IShellItemImageFactory, o mesmo do Explorer; compilado só no primeiro pedido, com cache), sites pelo favicon. Atalhos de programas desinstalados são escondidos do catálogo. Apps sem `.lnk`/`.exe` conhecido viram o tipo `"app"` (AppID, aberto com `explorer.exe shell:AppsFolder<AppID>`).

**Aba Cérebro (`cerebro`, Alt+4; as abas mudaram na fase 9, veja a seção "Fase 9" no fim):** painel da memória em Markdown (`cerebro/`). Busca (comando `buscar` do cerebro.py, com
`--com-palavras --limite=12`) com seletor de projeto, resultados com pontos e palavras-chave, leitura somente leitura com
Copiar e "Abrir no editor" (`code arquivo`; se o VS Code não responder, abre no programa padrão), estado do projeto com a data da
última atualização, "Compactar conversa" (janela que chama `salvar`; colar o resumo gerado pelo prompt preenche os campos),
"Copiar prompt de compactação" (texto em `cerebro/tools/prompt_compactacao.txt`, editável) e rodapé com estatísticas, Validar
e Reindexar. `app/cerebro.js` é só a ponte (monta os argumentos e lê o JSON; não depende do Electron e tem teste:
`npm run testar-cerebro`). Cérebro não encontrado (cerebro.py sai com 3): a tela oferece escolher a pasta e grava com
`config --definir`. O seletor de projeto lê `cerebro/projetos.json` se existir; senão, os campos "projeto" dos cabeçalhos.
No modo leitura a busca e os botões somem para o texto ter espaço (janela 720x320). **Custo:** zero em repouso (nada em
segundo plano, nenhum timer); cada clique abre um Python que dura ~195 ms, usa ~15 MB de pico e some ao terminar (medido).
O `.exe` não leva o cérebro junto (`!cerebro/**` no package.json, para as conversas não irem dentro do executável): o
`app/cerebro.js` acha o cerebro.py pela pasta do cérebro (`CEREBRO_DIR` ou `~/.cerebro.json`).

**Aba Projetos (`projetos`, Alt+5):** cadastro dos projetos que o widget vai abrir no Claude Code, em `projetos.json` na raiz
(lista de objetos: `id`, `nome`, `pasta`, `ia` ("claude" por enquanto), `modelo_padrao` (sonnet/opus/haiku), `descricao`, `tags`,
`cor`, `ultima_abertura`). Regras no `cerebro/tools/projetos.py` (listar, adicionar, editar, remover, validar, marcar_abertura,
preparar_projeto), com escrita atômica (arquivo temporário + renomear; JSON quebrado nunca é sobrescrito); `app/projetos.js` só
chama (dados pela entrada padrão em JSON). Cartões com nome, cor, descrição, modelo e última abertura; Adicionar (seletor de
pasta; Shift+clique abre o formulário para colar o caminho), Editar (o `id` não muda: é o elo com o cérebro), Remover (confirma;
só tira do cadastro) e Preparar projeto. Ao adicionar, se não existir `cerebro/estado/{id}.md`, nasce um esqueleto (cabeçalho
oficial + 6 seções vazias) e a tela pergunta se quer preencher Objetivo e Stack agora (o agente completa o resto depois).
"Preparar projeto" mostra o diff e só grava ao confirmar: cria um CLAUDE.md mínimo (≤ 20 linhas) na pasta do projeto ou, se já
existir, acrescenta só a seção "## Cérebro" (nunca sobrescreve; se já houver uma seção "Cérebro", não faz nada). O seletor de
projeto da aba Cérebro passou a usar os `id` do cadastro. A `cor` e as `tags` também vão alimentar o grafo do cérebro (planejado).
**Custo:** zero em repouso; cada clique abre um Python (~0,2 s, ~15 MB) que some ao terminar.

**Abrir Claude (fase 2.2):** cada cartão da aba Projetos tem um seletor de modelo (Sonnet, Opus, Haiku; vem no
`modelo_padrao`, com a dica: Opus = planejamento e tarefas difíceis, Sonnet = dia a dia, Haiku = tarefas simples e baratas)
e os botões "abrir claude" (pede a "Tarefa desta sessão", opcional), "continuar última sessão" (`--continue`) e "escolher
sessão anterior" (`--resume`). `app/ias.js` guarda tudo o que é de cada IA (executável, modelos, argumentos, como instalar,
variáveis a limpar); `app/terminal.js` abre a janela (Windows Terminal ou `cmd start`, solta: o widget não espera);
`app/abrir.js` junta as peças. Se o `claude` não está no PATH, a tela mostra o comando oficial de instalação e o link (não
instala). O prompt inicial é o `cerebro/tools/prompt_inicial.txt` com `{projeto}`, `{tema}` (tirado da tarefa) e `{depois}`
(com tarefa, a sessão já começa por ela). Cada abertura atualiza `ultima_abertura` e grava em `cerebro/.log/sessoes.jsonl`.
Pular permissões: só com `pular_permissoes: true` no projeto (caixa no editar, desligada, com aviso). O terminal
embutido que saiu na v1.6 voltou na fase 9.4 a 9.6 (sem dependência nativa; veja "Fase 9"). Testes: `node tools/testar-abrir.js`. Detalhes da CLI: `docs/claude-code.md`.

**Multitarefa (fase 2.3):** painel "sessões ativas" na aba Projetos (`app/sessoes.js`, salvo em
`%APPDATA%\meu-widget\sessoes.json`). O widget acha a sessão pela cadeia de processos: o processo que ele cria abre a janela
(`cmd` filho dele) e o `claude.exe` é filho desse `cmd`; isso é procurado uma vez, logo depois de abrir (`wmic`, ~0,2 s).
Depois, "a sessão continua viva?" é só `process.kill(pid, 0)`, sem abrir processo, a cada 10 s e só com a aba visível.
"Focar janela" usa o comando `focar-pid` do medidor (`helper.cs`; o dono da janela de console é o `cmd` dela); sem o medidor,
avisa que não dá. "Encerrar" pergunta "Compactar a sessão antes?": "sim" só mostra a instrução do /compactar (não fecha nada);
"não" fecha a janela (`taskkill /T` no `cmd` dela). Trava por pasta: com uma sessão já aberta na mesma pasta, oferece focar a
existente, abrir mesmo assim (desaconselhado) ou abrir num git worktree (`projetos.py worktree`: `{pasta}-sessao2`, branch
nova, só o que está commitado; mostra os comandos para juntar). Limite `max_sessoes` na config (padrão 3, de 1 a 10): passar
dele avisa que sessões paralelas gastam tokens ao mesmo tempo e somam no mesmo limite de uso da conta. Atalho global
Ctrl+Alt+A (`globalShortcut` do Electron, sem dependência; desliga com `"atalho_projetos": false`): mostra o widget na aba
Projetos com um seletor rápido (filtra, setas, Enter abre o Claude no modelo padrão). Com Windows Terminal não há PID (a
sessão nasce no processo do Terminal): ela aparece no painel, não tem "focar" e some depois de 12 h ou ao encerrar.
**Custo:** zero com a aba escondida; com ela aberta, uma checagem por sessão a cada 10 s (sem processo novo).

**Biblioteca de skills (fase 3.1):** `skills-biblioteca/{nome}/` = `SKILL.md` + `skill.json` (nome, titulo,
descricao_curta, exemplo_de_uso, categoria [cerebro, codigo, escrita, blender, roblox, design, outros], versao, autor, origem,
compativel, arquivos_extras, alternativa_a opcional). `catalogo.json` é gerado dos manifestos válidos (sem data: só muda quando
uma skill muda). `skills.py`: `listar`, `catalogo`, `instalar NOME --alvo claude --escopo projeto|global [--projeto ID]`,
`remover`, `status`, `atualizar`, `importar PASTA|ZIP [--confirmar]`. Destinos por IA no dicionário `DESTINOS` (hoje só
"claude": global `~/.claude/skills`, projeto `{pasta}/.claude/skills`). Instalar troca `{CAMINHO_CEREBRO}` e grava
`.instalado.json` (versão, data, origem); só pastas com esse arquivo são removidas ou atualizadas (se o Windows não deixar
apagar, vão para `_removidas/` com o SKILL.md renomeado). Uma instalação antiga idêntica ao que seria instalado é "adotada".
Importar mostra o SKILL.md inteiro, os arquivos (scripts marcados) e alertas de trechos perigosos (apagar, formatar, baixar e
executar, Invoke-Expression, credenciais, registro, rodar outros programas...) e só copia com `--confirmar`; nada da skill é
executado; zip com caminho para fora da pasta é recusado. O `instalar_basico.py` virou atalho: as 4 skills do cérebro pelo
`skills.py`, mais o `/compactar` e o bloco do CLAUDE.md global. Testes: `python skills-biblioteca/test_skills.py`.

**Custo das skills em tokens (fase 3.2, `cerebro/tools/tokens.py`; alimenta o gráfico da aba Skills):** três custos.
*Fixo*: nome e descrição ficam no contexto de toda conversa em que a skill está instalada, mesmo sem uso (lido só do cabeçalho
YAML). *Ao usar*: o corpo do SKILL.md (e às vezes extras) entra quando a skill é acionada. *Saída de ferramenta*: o que o
`cerebro.py` devolve (média real de `cerebro/.log/consultas.jsonl`, ou valores padrão marcados "padrão"). *Por uso* = ao usar +
extras + saída (o fixo já está pago). *Imposto fixo por conversa* = fixo de todas as skills instaladas (globais + do projeto, a do
projeto vale no lugar da global de mesmo nome) + `~/.claude/CLAUDE.md` + `CLAUDE.md` do projeto. É sempre uma ESTIMATIVA: caracteres/4
para cima, x1,1 em português com acentos (CRLF conta como 1). `tokens.py relatorio [--json]` (uma linha por skill, total, imposto
por conversa e alertas: descrição > 200 caracteres, corpo > 2.000 tokens, imposto > 8.000; o JSON traz o texto do conceito para a
interface), `estimar [ARQUIVO]`, `calibrar`. A opção precisa usa o endpoint oficial `POST /v1/messages/count_tokens` (gratuito, com
limite de requisições por minuto; cabeçalhos `x-api-key`, `anthropic-version: 2023-06-01`, `content-type`; corpo `{model, messages}`;
resposta `{input_tokens}`): `calibrar` sem `--enviar` só mostra o que enviaria; com `--enviar` e `ANTHROPIC_API_KEY` conta os
SKILL.md da biblioteca, descobre o fator e o grava em `~/.cerebro.json` (`tokens_fator`; a chave nunca é gravada). O tokenizador é do
modelo (padrão `claude-sonnet-5-5`; os modelos 4.7 em diante geram ~30% mais tokens que os anteriores). Testes:
`python cerebro/tools/test_tokens.py` (a API é um servidor local falso).

**Aba Skills (fase 3.3, Alt+6):** topo com o "imposto fixo por conversa" (número grande + barra de 0 a 8.000 tokens: verde até
4.000 na faixa de economia menor que busca normal, amarela até 8.000, vermelha acima), para o projeto escolhido (seletor) e o escopo `projeto`/`global` (o mesmo escopo vale
para Instalar e Remover; sem projeto só existe o global). Depois, filtro por categoria e busca, e um cartão por skill da biblioteca:
título, descrição curta, exemplo de uso em itálico, selos "Instalado no projeto" / "Instalado global" (amarelo se a versão
instalada é velha, vermelho se foi instalada por outro meio), versão, ⚠ de alerta e duas barras (fixo azul, ao usar roxo) na
MESMA escala em todos os cartões, com o valor ao lado. `alternativa_a` mostra "substitui X, Y, Z: instale uma ou outra" e, se
alguma já está instalada, que instalar paga o custo fixo das duas. **Simulação:** passar o mouse em [instalar]/[remover] mostra
"o imposto fixo passará de N para M tokens" (e um marcador na barra); o mesmo texto aparece na confirmação antes de agir.
[comparar] desenha (canvas puro, sem biblioteca de gráficos) todas as skills, fixo e ao usar lado a lado, da mais cara para a mais
barata; [?] explica o cálculo; [importar skill] usa o fluxo seguro do 3.1 (escolhe pasta ou .zip; mostra o SKILL.md inteiro, os
scripts e os alertas; só adiciona se confirmar; nada é executado; a pasta escolhida fica guardada no `main.js`, a tela nunca manda
caminho). **Leveza:** os custos são calculados ao abrir a aba (no máximo a cada 10 s) e em [atualizar]; o `tokens.py painel` devolve
tudo numa chamada (~0,3 s) e guarda cache por arquivo em `cerebro/.log/tokens-cache.json` (data de modificação + tamanho + fator
de estimativa: mudou, recalcula só aquele arquivo). Testes: `node tools/testar-skills.js` e `python cerebro/tools/test_tokens.py`.
Variáveis só para teste: `SKILLS_BIBLIOTECA`, `SKILLS_GLOBAL_CLAUDE`, `MEU_WIDGET_PASTA` (config e trava de instância separadas).

**Uso e continuidade (fase 4.1; a tela foi refeita na 9.7, veja "Fase 9"):** botão `[uso e continuidade]` no topo da aba Projetos (sub-tela com [< voltar]; a lista de
cartões some enquanto ela está aberta). Cinco blocos. **1. Ver o uso de verdade:** o Claude Code não tem leitura oficial de
uso/limites para um programa de fora, então o widget NÃO mostra número nenhum; ensina `/usage` (apelidos `/cost`, `/stats`) e
`/status` (assinatura ou chave de API), e o botão abre o Claude vazio na pasta do projeto escolhido com `/usage` já na área de
transferência (cole e Enter). A sessão fica no log com `motivo: "uso"` e não entra na contagem. **2. Estimativa local:**
`cerebro/tools/uso.py resumo` conta as sessões abertas pelo widget (`cerebro/.log/sessoes.jsonl`) nos últimos 7 dias, por dia e
por modelo (barras empilhadas, canvas não: só divs), e avisa "considere Sonnet para tarefas comuns" com 3 sessões seguidas em
Opus ou mais da metade em Opus (a partir de 5 sessões). É contagem do que o widget abriu, não o uso real da conta (a nota está
na tela). **3. Cheguei no limite:** `[pausar com segurança]` (no cartão e na sub-tela) abre um assistente de 3 passos: (a)
compactar: com uso, `/compactar` na janela do Claude; sem uso, `[sem uso: escrever à mão]` leva à aba Cérebro com a janela
"Compactar conversa" aberta no projeto e, ao voltar à aba Projetos, o assistente segue do passo b; (b) atualizar só "Estado atual"
e "Próximos passos" de `estado/{id}.md` (o resto fica; backup antes; limite de 300 palavras); (c) anotar em `sessoes.jsonl`
`{"modo":"pausa","motivo":"limite", data e hora}` (pausa não é sessão). O cartão passa a mostrar "pausado (limite)" e o botão
`[continuar da pausa]`: abre uma sessão nova (`motivo: "retomada"`) cujo prompt manda ler o estado do cérebro e retomar sem
reexplicar; abrir qualquer sessão nova depois da pausa a desfaz. Não há espera nem retomada automática de nada. **4. Trocar conta:**
só passos escritos (`/logout`, `/exit`, abrir e `/login`, `/status`); o aviso "Trocar de conta é permitido, mas alternar só para
contornar limites pode violar os termos e bloquear a conta." aparece até você marcar "não mostrar este aviso novamente"
(`avisoTrocaContaVisto` na config). O widget não executa nada disso e **não implementa rotação de contas**. **5. Economia:** modelo
padrão por projeto (Sonnet recomendado) e `usar_api_key` por projeto (desligado): por padrão a sessão aberta pelo widget usa o login
da assinatura, porque `ias.js` tira `ANTHROPIC_API_KEY` do ambiente dela (a chave tem prioridade sobre o login e cobra por uso);
com `usar_api_key` ligado a variável do Windows passa, e se ela não existir o projeto não abre (aviso, com opção de voltar à
assinatura). O widget só sabe se a variável existe (sim/não); o valor nunca é lido, exibido, gravado nem registrado, e não há campo
para digitar chave. Leveza: nada em segundo plano; a contagem roda ao abrir a sub-tela e em ação sua (~0,1 s). Testes:
`python cerebro/tools/test_uso.py`, `python cerebro/tools/test_projetos.py`, `node tools/testar-abrir.js`.

**Economia do cérebro (fase 6.1, Alt+4 > Search > `[mais ▾]` > Economia):** subaba da aba Cérebro (a busca e os resultados somem enquanto ela está
aberta; `[< voltar]` ou Esc volta). Tudo vem do `cerebro/tools/economia.py` (ponte `app/economia.js`), que lê só os logs locais
(`consultas.jsonl`, `sessoes.jsonl`, `ab.jsonl` em `cerebro/.log/`), sem IA e sem rede, numa chamada Python curta (~0,3 s com os logs
atuais; ~3 s no pior caso, com 4.000 conversas importadas num só projeto) feita ao abrir, em `[atualizar]` e ao registrar/remover um resultado do A/B; não há timer. **TUDO é estimativa** (a tela
diz isso): tokens = caracteres/4 (x1,1 com acentos, ou o fator calibrado do `tokens.py`). **1. Consultas por semana:** por semana
(segunda a domingo, 8 semanas): consultas, caracteres e tokens estimados devolvidos e uso por nível (`titulos` = nível 1, `cabecalho`
= nível 2, `ler` = nível 3, `buscar` = busca combinada). A **proporção** conta *buscas*: consultas seguidas, com até 10 min entre
si, são uma busca; ela "foi ao nível 3" só se chegou em `ler`, senão foi resolvida nos níveis 1 e 2. Quanto maior essa parcela,
melhor. **Gráfico** (canvas puro, a mesma técnica do comparar da aba Skills): barras empilhadas por nível + linha de tokens evitados
(eixo da direita, pode ficar negativo). **2. Tokens evitados por sessão (estimado):** para cada sessão NOVA aberta pelo widget com pelo
menos 1 consulta registrada: *com cérebro* = tokens do `estado/{projeto}.md` + o que as consultas daquela sessão devolveram; *sem
cérebro* = tokens de TODAS as conversas daquele projeto no cérebro (o que custaria reexplicar); evitados = sem − com (negativo = o
cérebro custou mais). As consultas não têm id de sessão: cada uma vai para a sessão aberta nas 6 h anteriores, ou para a mais recente
do projeto citado nos termos da busca. Sessões `continuar`/`retomar` (a conversa já tinha o contexto), pausas e sessões abertas só
para ver o `/usage` não contam. É uma estimativa otimista (ninguém cola todo o histórico) e usa o tamanho ATUAL dos arquivos.
**3. Teste A/B manual:** roteiro em `docs/teste-economia.md`; o formulário grava tarefa, variante (com/sem cérebro), tokens de entrada
e saída, custo opcional e notas em `cerebro/.log/ab.jsonl` (fora do git; `[remover]` pede um segundo clique). O gráfico compara,
por tarefa, a média COM e SEM e a redução em % (o número real, digitado por você). Testes: `python cerebro/tools/test_economia.py`,
`node tools/testar-cerebro.js`.

**Grafo 3D do cérebro (fase 8.1; desde a 9.3 é a tela em que a aba abre, com a troca Graph | Search):** a escolha de tela NÃO é mais gravada
(a chave `cerebroTela` saiu da config). Dados do `cerebro/tools/grafo.py` (só leitura, sem IA; lê só o cabeçalho de cada conversa): um nó por projeto (centro da
"estrela", cor do `projetos.json`), por conversa e por estado; ligações arquivo -> projeto e conversa <-> conversa com 2+ palavras-chave em comum
(no máximo 3 por arquivo; palavra-chave presente em mais de 60 arquivos não liga). O 3D é feito à mão num `<canvas>` 2D, sem biblioteca: perspectiva,
névoa pela profundidade, brilho nos projetos, nomes dos projetos sempre e dos arquivos quando ampliados. A simulação de forças (molas, repulsão numa
grade 3D só entre vizinhos próximos, repulsão de longe entre projetos) roda ao abrir e PARA quando esfria (~2 s com 600 arquivos, ~3 s com 3.000);
depois disso **nada é desenhado sem você mexer** (nenhum laço parado) e, fora da aba, nada roda. Interação: arrastar o fundo gira, roda amplia na
direção do cursor, botão direito/Shift move a vista, arrastar uma bolinha move o arquivo (ela fica presa onde você soltou; os vizinhos acompanham),
clique = detalhes (com `[abrir]`, `[centralizar aqui]`, `[soltar]`), duplo clique abre o arquivo na lista, filtro por cima (Enter vai até o resultado),
`R` enquadra. As posições ficam em memória enquanto o widget está aberto. Teste: `python cerebro/tools/test_grafo.py`.

**Manutenção do cérebro (fase 6.2, Alt+4 > Search > `[mais ▾]` > Manutenção):** subaba da aba Cérebro (a busca some enquanto ela está aberta; `[< voltar]`
ou Esc volta). **Nada roda sozinho**: ao abrir a subaba roda o diagnóstico (um Python, ~1,2 s com 4.000 conversas) e cada ação é um clique.
Tudo vem do `cerebro/tools/manutencao.py` (ponte `app/manutencao.js`). **1. Diagnóstico (sem IA, sem tokens):** tamanho do cérebro por
pasta (sem a `tools/`); conversas com mais de 6 meses que nenhuma consulta abriu nem devolveu (cruza com o `consultas.jsonl`, que desde
a 6.2 guarda os arquivos devolvidos; com um log curto a tela avisa que a lista ainda não prova nada); palavras-chave quase iguais
(plural/singular, hífen, erro de digitação de 1 letra e sigla, como bd = banco-de-dados; palavras com número ficam de fora); arquivos
parecidos (mesmo projeto, 80%+ das palavras-chave: cada grupo nasce da conversa mais antiga e leva as parecidas com ELA, no máximo 8) e estados
com mais de 30 dias. **2. Sinônimos:** `cerebro/sinonimos.json` (`{"bd": "banco-de-dados"}`); a busca do `cerebro.py` (titulos, cabecalho e
buscar) expande os termos nos dois sentidos e avisa o que expandiu (`sinonimos: bd -> banco-de-dados`); as sugestões do diagnóstico só
são gravadas depois de você marcar e aprovar. **3. Consolidação (USA IA):** cada grupo parecido vira 1 resumo no formato oficial (com a data do
mais recente e a origem comum ou `outro`) e os originais são MOVIDOS para `cerebro/arquivo-morto/` (nunca apagados; o `consolidacoes.jsonl`
dessa pasta registra quais arquivos viraram qual resumo, para desfazer à mão); o arquivo-morto não é buscado nem validado. Para conversas
com mais de 90 dias de um projeto com estado, `[propor estado]` pede ao Claude Code um estado atualizado e mostra o DIFF; só grava se você clicar
em aplicar (o `salvar_estado` valida e guarda a versão anterior em `estado/.anteriores/`). Antes de qualquer chamada a tela mostra a estimativa
de tokens, o modelo (haiku por padrão, sonnet opcional) e pede confirmação; limite de uso, login ou claude ausente param na hora, sem insistir e
sem mexer nos arquivos. **4. Índice por tema:** com mais de 100 arquivos o `cerebro.py` (a cada salvamento ou em `[gerar índices agora]`) grava
`cerebro/indices/{projeto}.md` e `titulos --projeto X` consulta primeiro o índice desse projeto (nome + palavras-chave, sem abrir nem varrer
pasta nenhuma; se o índice estiver velho, isto é, a pasta mudou depois dele, volta à varredura normal). **5. Backup:** `[exportar cérebro]`
escolhe uma pasta e gera `cerebro-AAAA-MM-DD.zip` (nunca sobrescreve; leva conversas, estados, arquivo-morto, índices, `INDICE.md` e
`sinonimos.json`; não leva o `.log` nem a `tools/`), sempre lembrando que o cérebro pode ter dados pessoais e não deve ir para repositório público
(avisa se a pasta escolhida está dentro de um repositório git). A tela nunca manda caminhos nem texto para gravar: o main guarda a pasta do backup e
a proposta de estado. Testes: `python cerebro/tools/test_manutencao.py`, `python cerebro/tools/test_cerebro.py`, `node tools/testar-cerebro.js`.
Variável só para teste: `MEU_WIDGET_DESTINO_TESTE` (pula o seletor de pasta do backup).

## Atualização pelo GitHub (botão "update")

- **Quando aparece**: ~20 s depois de abrir, o `main.js` faz UMA consulta leve (`GET api.github.com/repos/<repo>/commits/<branch>` com `Accept: application/vnd.github.sha`, resposta de 40 bytes) e compara com o commit instalado. Se for diferente, o botão de download aparece no cabeçalho e o Pokémon avisa. Qualquer `push` na branch gera o botão (não precisa criar release). Desliga em **Settings → avisar de atualizações** (ligar de novo confere na hora).
- **Qual branch**: `app/atualizacao.json` (`{ "repo": "wetonb1/WidgetPOKEMEU", "branch": "devs" }`); a versão Ubuntu aponta para `devs(ubunto)`. Cada versão só se atualiza da própria branch.
- **Qual commit está instalado**: `%APPDATA%\meu-widget\atualizacao.json` (gravado a cada atualização) ou, em clone git na MESMA branch, o `.git`. Sem nenhuma pista (pasta baixada em zip), o commit de agora vira o ponto de partida.
- **Ao clicar**: confirma → baixa o tarball do commit EXATO anunciado (`codeload.github.com`, só hosts do GitHub, só https, limite de 150 MB) → `tar` do sistema descompacta numa pasta temporária → valida (precisa ter `package.json`, `app/main.js`...) → guarda backup do que vai trocar em `<config>/atualizacao-backup/` → copia só código → grava o commit → reinicia (`app.relaunch`). Se qualquer cópia falhar, tudo é desfeito.
- **Dados do usuário (nunca tocados)**: a config (fica fora da pasta do código), `cerebro/conversas`, `cerebro/estado`, `cerebro/indices`, `cerebro/.log`, `cerebro/INDICE.md`, `cerebro/sinonimos.json`, `projetos.json`, `importacoes/`, `node_modules/`, `.git/`, `.claude/`, `.agents/`, `dist/`, executáveis. **Nada é apagado.** O `skills-biblioteca/catalogo.json` é mesclado: skill oficial atualiza, skill nova entra, skill importada pelo usuário fica. Chaves novas da config entram com o valor padrão sem mexer nas existentes (o `carregarConfig` já faz isso).
- **Limites**: só vale rodando do código (`npm start` / `iniciar-widget.sh`); o `.exe`/AppImage não troca os próprios arquivos (o botão nem aparece). Se o `package.json` mudar as dependências, a tela avisa para rodar `npm install`.
- **Custo**: 1 requisição de ~40 bytes por abertura; o download (~4 MB) só por clique. Nada fica rodando em segundo plano.
- **Testes**: `npm run testar-atualizador` (sem rede: troca de arquivos, proteção dos dados, desfazer, tarball real, registro do commit).
- **Para lançar uma atualização**: é só dar `git push` na branch (`devs` para a versão Windows, `devs(ubunto)` para a Ubuntu). Quem tem o widget com o atualizador vê o botão na próxima abertura.

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

## Fase 9: reformulação do visual (9.1 a 9.8)

**9.1 Abas em inglês, engrenagem e desligar.** As abas são `System, Music, Apps, Brain, Projects, Skills` (Alt+1 a Alt+6; no CMD: `1:sys` ...
`6:skills`). A aba Pokémon deixou de existir como aba: a **engrenagem ⚙** do cabeçalho (ou Alt+0) abre o painel **Settings** (busca de Pokémon ou
personagem, favoritos, shiny, visual e ajustes) com `[< back]`; a config nunca guarda "settings" como última aba. O botão **⏻** pede 2
confirmações **em ordem** (o processo principal confere: `power:etapa 1`, `power:etapa 2`, só então `power:desligar`; a permissão vale 60 s e
some depois de usada), executa `shutdown /s /t 20` e mostra a contagem com `[cancelar o desligamento]` (`shutdown /a`).
`MEU_WIDGET_DESLIGAR_TESTE=<arquivo>` (só para os testes) grava o comando em vez de executá-lo.

**9.2 System como o Gerenciador de Tarefas.** Duas listas, **Apps** (janelas abertas: `EnumWindows` no `helper.cs`, comando `apps`; o `media.ps1`
de reserva tem o mesmo protocolo) e **Processes** (todos, agrupados por nome; os PIDs vêm no campo `i` do comando `processos`). A tela nunca manda
PID nem caminho: manda um id (`a:...`/`p:...`) e o processo principal resolve na última leitura e **recusa** o que é do Windows (`PROTEGIDOS`:
system, svchost, explorer, dwm...) ou do próprio widget (todos os PIDs de `app.getAppMetrics()` + o medidor). **Fechar** = `taskkill /PID` sem
`/F` (o programa pode perguntar se quer salvar); **forçar/encerrar** = `/F`, com segundo clique. **Fechar todos os apps** primeiro PREVÊ
(`sys:fechar-todos-prever`: só o que dá para fechar, com caixas), fecha o que você confirmou (só ids da última previsão), espera 2,5 s e relata o que
ficou aberto, com `[forçar]`. A lista só é lida com a aba aberta. `MEU_WIDGET_SYS_FILTRO=<regex>` (só para os testes) limita o que a lista enxerga.

**9.3 Brain abre no grafo 3D.** A troca **Graph | Search** existe nas duas telas. O grafo ficou só com o filtro e `[centralizar]` (saíram
`[reorganizar]`, o texto de ajuda e o `[< lista]`; as dicas de mouse estão no título do botão). A busca ficou com o campo, o projeto e `[buscar]`;
compactar conversa, copiar prompt, economia, manutenção, validar e refazer índice moraram em `[mais ▾]`. Abrir um arquivo pelo grafo e tocar em
`[< voltar]` volta ao grafo.

**9.4 a 9.6 O Claude dentro do widget (terminal embutido).** Sem dependência nativa: `app/pty.cs` é um host de ~20 KB que cria um pseudo-console do
Windows (ConPTY: `CreatePseudoConsole`) e roda o programa dentro dele; é compilado **uma vez** com o `csc.exe` (só ao abrir a 1ª sessão, em
`%APPDATA%\meu-widget\pty-<hash>.exe`). Protocolo: `stdin` do host recebe quadros `[tipo][tamanho][dados]` (0 = teclas, 1 = redimensionar),
`stdout` é a saída do programa (bytes) e `stderr` leva `PID n`/`ERRO ...`. Pontos que custaram caro: (1) os handles padrão do host são
**zerados antes do CreateProcess**, senão o programa herda o `stdout` do host e escreve direto no canal, sem passar pelo pseudo-console (o sintoma
era texto em OEM sem sequências ANSI e nenhuma resposta às teclas); (2) a entrada é lida com `ReadFile` direto e separada em quadros de um buffer;
(3) um Job Object com `KILL_ON_JOB_CLOSE` mata tudo o que o programa abriu quando o host acaba, e o host acaba quando o widget some (stdin fecha).
`app/pty.js` compila, monta a linha de comando do Windows (regras do CommandLineToArgvW; `.cmd`/`.bat` passam pelo `cmd.exe` com os argumentos
filtrados) e fala com o host. `app/embutido.js` guarda a saída até a tela se ligar, manda em lotes de 12 ms e **digita comandos** (hoje só `/usage`,
lista fechada no `main.js`) só quando o Claude está esperando você: a caixa de entrada `❯` mais o rodapé (`shift+tab to cycle`, `? for shortcuts`);
numa tela de confirmação (confiar na pasta, login, onboarding) **nunca digita nem aperta nada** e avisa a tela; o texto vai separado do Enter (600 ms),
porque junto o Claude o trata como "colar". `abrir.js` ganhou o 3º argumento `embutido` (null = cai no terminal externo: sem csc, Windows sem ConPTY ou
`MEU_WIDGET_TERMINAL_EXTERNO=1`). A sessão se registra com `via: "widget"`, `iaPid` e `termId` (não precisa procurar a janela).
Na tela (`terminalEmb` no `renderer.js`) o xterm.js 6.0.0 + addon-fit (MIT, em `app/vendor/xterm`, carregados só quando você abre a 1ª sessão) usa o
tema, o cursor e uma fonte monoespaçada do widget; uma aba por sessão; Esc/Ctrl+C/colar vão ao programa (Ctrl+C com seleção copia). A tela só manda
teclas, tamanho e pedidos; quem monta o comando é sempre o `abrir.js`. **Custo medido** (1 sessão ociosa): host ~12 MB (9 MB privados) + o conhost
da sessão ~6 MB, 0 s de CPU em 10 s; o widget foi de 137 para 142 MB (xterm e a tela do terminal). Testes: `npm run testar-pty`, `testar-embutido`
(com um Claude de mentira) e `testar-abrir`.

**9.7 Projects e "uso e continuidade".** O cartão do projeto mostra o modelo em pílulas, `[▶ abrir claude]`, `[continuar última]` e `[mais ▾]` (sessão
anterior, editar, preparar, pausar, remover). A tela de uso ficou com 3 coisas: **seu uso agora** (`[ver agora: /usage]` abre o Claude embutido, ou usa a
sessão já aberta do projeto, digita `/usage` e `app/uso-tela.js` lê da tela do xterm a **sessão atual** e a **semana**: nome, `% used` e `Resets ...`,
que viram barras verde/amarela/vermelha; a última leitura fica em `ultimoUso` na config, só nomes e %), a **estimativa** de sessões abertas pelo
widget em 7 dias (com uma frase e o dia de hoje destacado) e os atalhos pausar e trocar de conta. O widget continua sem ler nada da conta por
conta própria: só lê o texto que o Claude mostrou no terminal, por clique seu. Teste: `npm run testar-uso-tela`.

**9.8 Skills: como funciona + catálogo online.** Quadro de 3 passos (Biblioteca, Instalar, O Claude usa), dispensável (`skillsGuiaVisto`) e
reaberto em `[como funciona]`. `[buscar online]` abre o catálogo (`app/catalogo-skills.js`, no processo principal, só por clique): fontes
`anthropics/skills` (Claude), `openai/skills` (Codex), a comunidade (busca de repositórios pelos tópicos `agent-skills`/`claude-skills`, por estrelas) e
"outro" (`dono/repo`). Uma consulta à árvore do repositório (`/git/trees/HEAD?recursive=1`) acha as pastas com `SKILL.md` (modelos em branco ficam de
fora); o nome e a descrição vêm do começo de cada `SKILL.md` (até 60 por vez, 6 pedidos juntos). **Baixar** leva só os arquivos da pasta da skill
(até 80 arquivos, 1 MB cada, 5 MB), recusa caminhos com `..`, e entrega a pasta temporária ao mesmo `skills.py importar` de sempre (revisão com
scripts e alertas; só entra com o seu clique; nada é executado). A biblioteca registra `origem: github:dono/repo/pasta` e o autor (`importar
--rotulo=`). Sem internet ou com o limite do GitHub (60 por hora sem conta): a lista fica em `%APPDATA%\meu-widget\skills-catalogo.json` e a tela
avisa de quando é. `MEU_WIDGET_GITHUB_API/RAW` trocam os endereços (só testes). Teste: `npm run testar-catalogo` (um GitHub de mentira local).

**9.11 Terminal como painel lateral e abrir sem prompt.** `[▶ abrir claude]` não abre mais a janelinha de tarefa: chama `abrirSessao(..., { semPrompt: true })`, então
o Claude abre só com `--model` (sem o prompt do cérebro; o `CLAUDE.md` do projeto continua mandando consultar o cérebro). Em `abrir.js` o motivo `"uso"` só vale com
`semPrompt` **e** comando (`/usage`): abrir vazio conta como sessão de trabalho na estimativa. O terminal deixou de cobrir a aba: com `#aba-projetos.terminal` a aba
vira uma grade de 2 colunas (`.proj-esq` = topo, sessões e lista, estreita; `.proj-term` = o painel). A tela "uso e continuidade" esconde o painel enquanto está aberta.
Abaixo de 1000 px de largura o Pokémon se esconde sozinho (`ampliado === null` = automático; o botão passa a escolha para manual). `[< projetos]` virou `[esconder]`.
Teste: `npm run testar-lateral [cmd|ios]` (abre o widget de verdade em pastas temporárias, com um Claude de mentira; capturas em `%TEMP%`).

**10.3 Interface multi-IA (aba Projects).** O cartão ganhou o seletor de IA (pílulas `Claude | Antigravity`; a padrão do projeto vem marcada, a reserva
tem a dica no título). O modelo acompanha a IA: pílulas quando os nomes são curtos (Claude) e uma lista quando são longos (`gemini-3.8-flash-medium`); o inicial é o
`modelo_padrao` (na IA padrão), o de `modelos_por_ia` ou o padrão da IA. O botão principal usa o executável da IA (`[▶ abrir claude]`, `[▶ abrir agy]`) e os
botões que a IA não suporta (`suporta` do `ias:resumo`) ficam desabilitados com a dica (hoje, "escolher sessão anterior" no agy: use `/resume`); os títulos
(`claude --continue`, `agy -c`...) vêm de `titulos` no `app/ias-dados.json`. Toda abertura manda `ia` ao `projetos:abrir-ia`; o modal "não encontrado" usa o comando e a
documentação da IA aberta, `semSuporte` ganhou a sua janelinha e a trava por pasta diz de qual IA é a sessão. Adicionar/editar: IA, modelo (lista da IA), IA reserva (opcional),
e os textos de "pular permissões"/"chave de API" seguem a IA (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`; só sim/não). "Sessões ativas" mostra o selo da IA; o `Ctrl+Alt+A` fala
"abrir IA em..." e abre na IA padrão do projeto. O `modelos_por_ia` só se edita no arquivo. A tela "uso e continuidade" continua lendo só o formato do `/usage` do Claude.
Teste: `npm run testar-lateral [cmd|ios]` (agora com um projeto do agy, um `agy` de mentira).

**10.4 Regras para as duas IAs.** O `preparar` do `projetos.py` gera, na pasta do projeto, o arquivo que cada IA lê (`arquivoRegras` do `ias-dados.json`: `CLAUDE.md` para o
Claude Code, `AGENTS.md` para o Antigravity) para a IA do projeto e para a `ia_reserva`, sempre com o mesmo bloco "## Cérebro" neutro (até 20 linhas; nunca sobrescreve; confere
tudo antes de gravar). `cerebro/tools/regras.py verificar|sincronizar` mantém o `AGENTS.md` da raiz do widget igual ao `CLAUDE.md` (o principal; cada um com o seu título).
`skills-biblioteca/instalar_basico.py --alvo claude|antigravity|ambos` (padrão `claude`) acrescenta o bloco do `~/.gemini/GEMINI.md` (`gemini-global.md`, 8 linhas), que só é gravado
com `--aplicar-gemini-md` e mostra os tokens que soma a toda conversa; as skills só são instaladas no Claude (a partir da 10.5 também no agy). Resultado do teste de adesão do agy em `docs/antigravity.md`.
Testes: `python cerebro/tools/test_regras.py`, `test_projetos.py` e `skills-biblioteca/test_instalar_basico.py`.

**10.5 Skills no Antigravity.** O `skills.py` ganhou o destino `antigravity` (`DESTINOS`: projeto `<pasta>/.agents/skills`, confirmado; global `~/.gemini/antigravity-cli/skills`, só pela
documentação; `SKILLS_GLOBAL_ANTIGRAVITY` nos testes). `--alvo antigravity|claude|ambos` em `instalar`/`remover` ("ambos" mostra um resultado por alvo e falhar num não desfaz o outro);
`status` e o `.instalado.json` guardam o alvo. Uma skill pode ter uma variante por IA em `skills-biblioteca/NOME/variantes/<alvo>/SKILL.md` (hoje só a do PowerShell no
`cerebro-compactar`): o `skills.py` escolhe a variante pelo alvo ao instalar, ao ler e no custo (`tokens.py painel --alvo`), e a pasta `variantes/` nunca é copiada. `compativel` só aceita
ids de IA do `ias-dados.json` e só recebeu `antigravity` nas skills testadas no agy (`cerebro-buscar` e `cerebro-compactar`). Os textos das skills `cerebro-*` ficaram neutros
("ferramenta de terminal"). O `app/skills.js` (instalar, remover, painel e ler) e os IPC/preload recebem o alvo como último parâmetro opcional, validado contra as IAs conhecidas (sem alvo =
Claude; a tela da aba Skills ainda não escolhe o alvo). `instalar_basico.py --alvo antigravity|ambos` instala também as 2 skills (no projeto do widget direto; com `--global` só com
`--aplicar-skills-agy`). `.gitignore` e `build.files` ignoram `.agents`. Catálogo online: sem fonte oficial de skills do Antigravity, então só a nota (mesmo formato SKILL.md; a
compatibilidade com cada IA é revisão sua). Testes: `python -X utf8 skills-biblioteca/test_skills.py`, `test_instalar_basico.py`, `npm run testar-skills`. Resultado do teste real em `docs/antigravity.md`.

**10.6 Custo por IA.** O `tokens.py` mede o imposto fixo por IA: as instruções de cada uma são uma lista de arquivos (Claude: `CLAUDE.md` global e do projeto; Antigravity: `AGENTS.md` +
`.agents/rules/*.md` e `.agent/rules/*.md` com `trigger: always_on`, confirmados no 10.0). O `~/.gemini/GEMINI.md` global do agy não foi confirmado: aparece no painel como "não confirmado" e
fica FORA do total. Skills de plugins são só do Claude (no agy, zero). O fator calibrado pela API vale só para o Claude; o agy usa a estimativa padrão (caracteres/4, x1,1 com acentos),
rotulada "estimado", porque cada modelo conta tokens de um jeito (nenhuma API é chamada). O cache por arquivo leva a IA na chave. `tokens.py relatorio [--alvo claude|antigravity|ambos]`
(padrão: ambos) traz uma seção por IA e o imposto lado a lado; um projeto entra na seção das IAs dele (`ia` e `ia_reserva`); o relatório mudou de formato (`secoes`). A aba Skills ganhou o
seletor Claude | Antigravity | Ambos (uma barra de 0 a 8.000 por IA, selos "Claude: projeto v1.0.0", "sem teste no Antigravity") e [instalar]/[remover] abrem a janela que pergunta em qual
IA (Claude, Antigravity ou Ambos) com a simulação de cada uma. Custo: cada IA mostrada é 1 chamada ao `tokens.py painel` (~0,3 s com cache), só ao abrir a aba ou em [atualizar]; "Ambos"
faz 2, uma depois da outra (o cache é um arquivo só); a janela de instalar busca a IA que faltar só no clique. Testes: `python -X utf8 cerebro/tools/test_tokens.py` (36), `npm run testar-skills`.

**10.7 Compactar e origem no Antigravity.** Convenção de origem: `claude-code` (Claude Code) e `antigravity` (agy), gravadas pela skill de cada IA; `claude`, `chatgpt`, `gemini` para chats de sites e
apps (`prompt_compactacao.txt` só ganhou "antigravity" na lista, o formato não mudou). A janela "Compactar conversa" (aba Cérebro) ganhou `claude-code` e `antigravity` na lista de origem
(`ORIGENS` e o `<select id="cc-origem">`). O `cerebro.py validar` só exige que a origem exista (aceita qualquer valor); o grafo e o `INDICE.md` agrupam por projeto, então não mostram nem colorem por origem
e não mudaram. No agy não há comando de barra próprio: `/cerebro-compactar` (a skill) é o equivalente do `/compactar`. Em vez de gerar os dois textos de um arquivo-base, um teste
(`test_skills.py`) garante que a skill do Claude e a variante do agy só diferem nos passos de shell. Teste de qualidade com os dois CLIs em `docs/antigravity.md`. Testes:
`python -X utf8 cerebro/tools/test_cerebro.py` (68), `skills-biblioteca/test_skills.py` (25), `npm run testar-cerebro`.

**10.8 Continuar em outra IA, uso e conta.** O cartão do projeto ganhou "[continuar no {outra IA}]" (a `ia_reserva` instalada ou, sem ela, outra IA instalada), com a data da última sessão
naquela IA (vem do `sessoes.jsonl`; o `projetos.py listar` traz `ultima_sessao_por_ia` e `recentes_por_ia`). Ele chama `abrirIA(id, { ia, retomada: true, modelo, semPularPermissoes: true })`: sessão nova
que lê o estado do cérebro; pular permissões nunca é herdado. No fim da "pausar com segurança" (que agora vale para as duas IAs: `/cerebro-compactar` na IA da sessão, e o registro da pausa anota a IA pausada)
aparece o mesmo botão; se a pausa foi por limite, sugere a IA com MENOS sessões nas últimas 24 h, deixando claro que é CONTAGEM LOCAL, não a cota real. O painel de uso agrupa o gráfico dos 7 dias por IA e
por modelo (rótulo "C2 A1" em cada barra; legenda por IA). O `/usage` real: Claude pelo `uso-tela.js`; Antigravity pelo novo `uso-tela-agy.js` (mostra o que RESTA; só lê a tela do terminal embutido, ao clicar).
"Trocar conta" virou por IA (passos conferidos de cada uma); `avisoTrocaContaVisto` e `ultimoUso` da config viraram objetos por IA, com migração do formato antigo para o Claude (`app/conta.js`).
Nada em segundo plano, nenhuma rotação de contas, nada de login/HOME/chaveiro/credenciais. Testes: `test_uso.py`, `test_projetos.py`, `npm run testar-abrir`, `testar-uso-tela` (Claude e agy), `testar-conta`.

**10.9 Motor Antigravity no importador (parado por segurança).** Testado `agy -p` em `%TEMP%` (`gemini-3.8-flash-low`): ao contrário do `claude -p --tools ""`, o `agy -p` não permite desligar as ferramentas de arquivo (`read_file` e `write_file` rodam sem pedir permissão mesmo com `--sandbox --disable-slash-commands` e `--mode plan`), não aceita conversa via `stdin` junto com `-p "prompt"`, não desliga MCP por execução e grava cada chamada como sessão em `~/.gemini/antigravity-cli/conversations/`. Como resumir conversas antigas com ferramentas de arquivo ativas traria risco de leitura/escrita indevida no disco, o `importar.py resumir` e a manutenção (`consolidar`/`propor-estado`) continuam usando exclusivamente o Claude Code (`claude -p`), conforme documentado em `docs/antigravity.md`.

**10.10 Auditoria, paridade e documentação.** Matriz de paridade Claude × Antigravity revisada; todas as 21 suítes de testes (15 scripts `npm run testar-*` + 6 suítes `python -X utf8`) verdes sem regressão. Medição de leveza (`npm run medir -- -Cenario A`, 3 rodadas de 30 s): antes da fase 10 (`2898529`) mediana CPU `6,3%` de 1 núcleo (`0,40%` total) e RAM `377 MB` WS / `158 MB` privada (5 processos); depois da fase 10 mediana CPU `7,0%` de 1 núcleo (`0,44%` total) e RAM `374 MB` WS / `156 MB` privada (5 processos). Teste de adesão refeito nas duas IAs (com e sem `prompt_inicial`): ambas consultam `cerebro.py buscar` na 1ª ação. Documentação (`README.md`, `cerebro/README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/antigravity.md` e `docs/WIDGET.md`) atualizada e sincronizada (`python cerebro/tools/regras.py verificar`).

