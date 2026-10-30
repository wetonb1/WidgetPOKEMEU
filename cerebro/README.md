# O cérebro

Uma memória compartilhada, em arquivos Markdown simples, que o **Claude Code** (`claude`) e o **Antigravity** (`agy`) leem **antes** de
pesquisar. Se a resposta já está aqui, a IA não precisa reler o
código nem buscar na web, e isso economiza tokens. Não há banco de dados, servidor nem processo
rodando: são só arquivos de texto.

## Estrutura

```
cerebro/
  estado/       um arquivo por projeto: onde o projeto está agora
  conversas/    um resumo curto por conversa que valeu a pena guardar
  tools/        cerebro.py (Python 3, sem dependências) e seus testes
  INDICE.md     gerado por `cerebro.py indice`: uma linha por arquivo, agrupado por projeto
  .log/         logs locais (não vão para o git)
```

Fora daqui: `skills-biblioteca/` guarda skills e `importacoes/` recebe exportações de chats
antigos (não vai para o git).

## Formato de uma conversa

Nome: `AAAA-MM-DD_assunto-principal.md`, com o assunto em 3 a 6 palavras, minúsculas, sem
acento e separadas por hífens. Exemplo: `2026-10-28_estrutura-inicial-do-cerebro.md`.

```
palavras-chave: cerebro, estrutura, claude-md, pastas, instrucoes
data: 2026-10-28 | origem: claude-code | projeto: meu-widget

- Tópico curto 1
- Tópico curto 2
```

- Linha 1: de 5 a 10 palavras-chave.
- Linha 2: data, origem (`claude-code` para o Claude Code, `antigravity` para o `agy`, `claude`/`chatgpt`/`gemini` para chats de sites e apps, `outro` ou `importado`) e projeto.
- Linha 3: vazia.
- Corpo: no máximo 12 tópicos ou 150 palavras.

## Formato do estado de um projeto

`estado/{projeto}.md`, com no máximo 300 palavras, nestas seções:
`Objetivo`, `Stack`, `Decisões`, `Estado atual`, `Próximos passos`, `Armadilhas`.

## Ordem de consulta (o que a IA faz)

1. Lê o estado do projeto.
2. Procura pelo nome dos arquivos em `conversas/`.
3. Lê só as duas primeiras linhas (o cabeçalho) dos candidatos.
4. Abre por inteiro no máximo 3 arquivos.
5. Se nada combinar, segue normalmente.

Os limites de tamanho existem para que essa consulta custe poucos tokens. Um arquivo grande
demais anula a economia.

## A ferramenta `cerebro.py`

```
python cerebro/tools/cerebro.py validar [--corrigir]   confere o formato (corrige só o seguro)
python cerebro/tools/cerebro.py indice                 gera cerebro/INDICE.md
python cerebro/tools/cerebro.py config [--definir C]   mostra ou grava a pasta do cérebro
```

Busca em 3 níveis (cada um só deve rodar se o anterior não bastar):

```
cerebro.py titulos TERMOS [--projeto X] [--limite 8]       1. só os nomes dos arquivos
cerebro.py cabecalho TERMOS [--arquivos A B] [--limite 5]  2. as 2 primeiras linhas (palavras-chave)
cerebro.py ler ARQUIVO... [--max 3]                        3. o arquivo inteiro (no máximo 3)
cerebro.py buscar TERMOS [--projeto X]                     estado + 1 + 2, e sugere "abrir: ..."
```

O `buscar` nunca abre arquivo inteiro: quem decide chamar `ler` é a IA. Cada consulta é anotada em
`cerebro/.log/consultas.jsonl` (data, comando, termos, resultados, caracteres), para medir a economia.
No nível 1 o bônus do `--projeto` só vale para nomes que trazem o projeto, porque nenhum arquivo é aberto.

Para gravar (é o que o `/compactar` do Claude Code faz), o corpo vai pela entrada padrão:

```
cerebro.py salvar --titulo "assunto em 3 a 6 palavras" --palavras "a,b,c" --origem claude-code --projeto X <<'FIM'
- tópico
FIM
cerebro.py salvar --projeto X --estado < estado.md    sobrescreve estado/X.md (guarda 5 versões em estado/.anteriores)
```

O `salvar` recusa, numa linha só, o que o `validar` apontaria e o que parecer senha, token ou e-mail.
Depois de gravar, ele atualiza o `INDICE.md` e imprime só o nome do arquivo.

## Usar o cérebro em qualquer projeto

`python skills-biblioteca/instalar_basico.py [--global] [--alvo claude|antigravity|ambos]` instala as 2 skills básicas (`cerebro-buscar` e `cerebro-compactar`, usando a variante de cada IA quando existir) e os blocos globais:
- **Claude (`claude`):** em `~/.claude` instala as skills e um bloco curto no `CLAUDE.md` global. O `~/.claude/CLAUDE.md` nunca é sobrescrito: se já existir com outro conteúdo, mostra o diff e só grava com `--aplicar-claude-md`.
- **Antigravity (`antigravity`):** no projeto grava em `.agents/skills/`. Com `--global`, como `~/.gemini/GEMINI.md` e `~/.gemini/antigravity-cli/skills/` ficam fora da pasta do widget (e não foram confirmados por teste prático), só mostra o que gravaria e os tokens; para gravar de verdade, passe `--aplicar-gemini-md` e `--aplicar-skills-agy`.

`cerebro/tools/prompt_inicial.txt` é o texto que o widget manda no início de cada sessão com tarefa (ou retomada de pausa),
para garantir a consulta mesmo se a regra for ignorada. O widget troca `{projeto}`, `{tema}` (se não
houver tema, use o nome do projeto, pois o `buscar` exige ao menos 1 termo) e `{CAMINHO_CEREBRO}`.

Para a aba Cérebro do widget (`app/cerebro.js` chama estes comandos com `--json`):

```
cerebro.py painel [--projeto X]            projetos, estatísticas (arquivos, KB, última compactação) e resumo do estado
cerebro.py buscar TERMOS --limite N --com-palavras   como o buscar normal, mas até N candidatos, todos com palavras-chave
cerebro.py ler ARQUIVO --json              traz também a data da última atualização do arquivo
```

Os projetos vêm de `cerebro/projetos.json` (lista de nomes ou objetos com `nome`) se existir; senão, dos campos `projeto` dos
cabeçalhos e dos nomes em `estado/`. Se a pasta do cérebro não existir, todos os comandos saem com código 3.

## Skills (`skills-biblioteca/skills.py`)

As skills que ensinam a IA a usar o cérebro ficam em `skills-biblioteca/` e são instaladas por `skills.py`
(`instalar NOME --alvo claude|antigravity|ambos --escopo projeto|global [--projeto ID]`, `status`, `atualizar`, `remover`, `ler NOME [--alvo IA]`).
Se uma skill tiver `variantes/<alvo>/SKILL.md` (como `cerebro-compactar/variantes/antigravity/SKILL.md`, que usa here-string do PowerShell e `--origem antigravity`), o `skills.py` e o `tokens.py` usam essa variante automaticamente para aquele alvo. Skills de fora entram com `skills.py importar PASTA|ZIP` (mostra tudo antes; `--confirmar` adiciona).

## Custo em tokens (`tokens.py`)

`python cerebro/tools/tokens.py relatorio [--alvo claude|antigravity|ambos]` mostra quanto cada skill custa: **fixo** (nome + descrição, em toda conversa),
**ao usar** (corpo do SKILL.md da IA), **saída** (o que o cerebro.py devolve) e o **imposto fixo por conversa** (no Claude: skills + plugins + `CLAUDE.md` global e do projeto; no Antigravity: skills + `AGENTS.md` e regras `always_on` do projeto, com `GEMINI.md` global listado à parte como não confirmado). É uma estimativa (caracteres/4, x1,1 com acentos). `tokens.py calibrar` mostra o que seria enviado
à API da Anthropic para medir o fator real do Claude; só envia com `--enviar` (precisa de `ANTHROPIC_API_KEY`; no Antigravity o cálculo é sempre estimado, sem chamar rede).

## Projetos (`projetos.py`) e regras (`regras.py`)

`projetos.json` (raiz do widget) é o cadastro dos projetos; os dados de cada IA suportada (`claude` e `antigravity`) vêm de `app/ias-dados.json` (lido por `cerebro/tools/ias.py`). O `id` de cada projeto é o nome usado no cérebro (`estado/{id}.md`,
campo `projeto` das conversas). Comandos (dados de adicionar/editar pela entrada padrão, em JSON):

```
projetos.py listar | validar | remover ID | abertura ID
projetos.py adicionar < {"nome": "...", "pasta": "C:\...", "ia": "claude", "ia_reserva": "antigravity"}   cria também estado/{id}.md se faltar
projetos.py editar ID < {"descricao": "...", "ia_reserva": "antigravity", "modelos_por_ia": {...}}
projetos.py preparar ID [--confirmar]    cria/atualiza CLAUDE.md e AGENTS.md na pasta do projeto (sem --confirmar só mostra o diff)
projetos.py preencher ID < {"objetivo": "...", "stack": "..."}
projetos.py prompt ID < {"tarefa": "..."}          prompt inicial da sessão (prompt_inicial.txt com projeto, tema e tarefa)
projetos.py sessao ID < {"ia", "modelo", "tarefa", "modo", "motivo"?}   marca a abertura e grava em .log/sessoes.jsonl
projetos.py prompt ID < {"retomada": true}         prompt de "continuar de onde paramos" (lê estado/ID.md, sem reexplicar)
projetos.py pausa-estado ID                        Estado atual e Próximos passos do estado do projeto
projetos.py pausa-salvar ID < {"estado_atual", "proximos"}   troca só essas duas seções (backup antes)
projetos.py pausa-registrar ID [--motivo limite] [--ia claude]  anota a pausa (motivo, IA e hora) em .log/sessoes.jsonl
uso.py resumo [--dias 7]                           sessões por dia, por IA e por modelo + últimas 24 h por IA (contagem local, não é o uso real)
regras.py verificar | sincronizar [--confirmar]    mantém o AGENTS.md idêntico ao CLAUDE.md (fora o título da linha 1)
```

O estado criado pelo cadastro leva o cabeçalho de 2 linhas (palavras-chave e data/origem/projeto); nos outros estados ele é opcional.

Todos aceitam `--json`. A pasta do cérebro é achada pela variável `CEREBRO_DIR`, depois por
`~/.cerebro.json` (chave `cerebro_dir`) e, por último, pela pasta pai de `tools/`. Use
`config --definir` para que skills de outros projetos achem o mesmo cérebro.
O validador aceita de 3 a 10 palavras-chave (o ideal continua sendo 5 a 10).

As regras completas para as IAs estão no `CLAUDE.md` e no `AGENTS.md` da raiz.

## Importar conversas (`importar.py`, etapa 1)

Lê as exportações de conversas (Claude, ChatGPT e Gemini/Takeout) que você coloca em `importacoes/` (pasta fora do git) e decide
quais valem virar resumo. **Nenhuma IA é chamada e nenhum token é gasto**: o script não tem rede. A etapa seguinte (resumir) é outra.

```
importar.py inspecionar [--pasta P]    só campos e tipos dos arquivos reais (datas viram máscara; o texto nunca aparece)
importar.py rodar [--pasta P] [--sep ;] [--forcar] [--json] [--preco-entrada USD] [--preco-saida USD]
```

1. Descompacta os `.zip` em `importacoes/_extraido/NOME/` e reconhece cada arquivo pelo **conteúdo** (`chat_messages` = Claude,
   `mapping` = ChatGPT, `header`/`time`/`safeHtmlItem` = Gemini); o resto (users.json etc.) é listado como ignorado.
2. Grava `importacoes/normalizado.jsonl` (uma conversa por linha: `id, origem, titulo_original, data_criacao, total_mensagens,
   total_caracteres, texto` com "EU: ..." / "IA: ...").
3. **Antes de gravar**, troca por `[removido]` chaves de API (sk-, AIza, ghp_, github_pat_, xox, AKIA), tokens longos (32+ caracteres
   com letras e números), `Bearer ...`, o resto da linha de "senha"/"password", cartões (só se passam no Luhn) e CPF (formatado,
   ou 11 dígitos com dígito verificador válido). O relatório mostra quantas trocas por tipo. Não é garantia: revise antes de mandar
   o texto a uma IA.
4. Gera `importacoes/candidatas.csv` (`;` e UTF-8 com BOM, para o Excel em português): `id, origem, data, titulo, mensagens,
   caracteres, tokens_estimados (caracteres/4), projeto_sugerido, importar`. **SIM** = 4+ mensagens E (combina com um projeto do
   `projetos.json` por id/nome/tags, OU tem termo técnico: código, erro, decisão, configurar, deploy...); senão NAO. Rodar de novo
   mantém o que você já marcou no CSV (`--forcar` recalcula tudo).
5. Relatório: total por origem, quantas SIM, tokens de entrada das SIM e de saída (200 por resumo). Dólares só se você passar os
   preços (o script não consulta preço nenhum).

Formatos: escritos a partir da documentação de cada serviço, **ainda sem uma exportação real** (a pasta estava vazia). Rode
`importar.py inspecionar` nos seus arquivos e confira. O Gemini não traz id de conversa: entradas a até 30 min uma da outra viram
uma conversa só. Testes (dados inventados): `python cerebro/tools/test_importar.py`.

### Etapa 2: resumir (`importar.py resumir`) — GASTA TOKENS

Resume só as conversas marcadas **SIM** no `candidatas.csv` e salva no cérebro. Nada roda sozinho e nada é enviado sem a sua
confirmação. Ordem recomendada:

```
importar.py resumir --simular              plano + estimativa de tokens e SÓ 3 conversas de amostra (espalhadas pela lista)
   ... você lê os 3 arquivos em cerebro/conversas/ e decide ...
importar.py resumir --descartar-amostra    (se não gostou) apaga só os resumos da amostra; ajuste o prompt ou use --modelo sonnet
importar.py resumir --lote 20              de 20 em 20, perguntando "Processar?" antes de cada lote
```

- **Motor:** `claude -p --model haiku --output-format json --tools "" --disable-slash-commands --no-session-persistence
  --strict-mcp-config` (confirmado no `claude --help` da 2.1.292). Sem ferramentas, sem skills, sem MCP, sem gravar sessão; roda numa
  pasta temporária vazia (não carrega o CLAUDE.md de nenhum projeto). O prompt vai em `--system-prompt` (troca o prompt padrão, grande) e a
  conversa pela entrada padrão. `--modelo sonnet` (ou opus) troca o modelo; `--claude-args "--effort low"` repassa opções ao claude.
- **Login:** por padrão a chamada usa o **login da assinatura**: a `ANTHROPIC_API_KEY` é retirada do ambiente dela (a chave tem prioridade
  e cobraria por uso). `--usar-chave-api` deixa a chave passar. `--bare` não é usado: ele só aceita chave de API.
- **Prompt:** `cerebro/tools/prompt_resumo.txt` (edite à vontade). Exige `titulo:` (3 a 6 palavras), `palavras-chave:` (5 a 10), `projeto:`
  (id conhecido ou `geral`) e o corpo (máx. 12 tópicos / 150 palavras: decisões, soluções, estado, pendências; sem conversa fiada).
- **Corte de entrada:** conversa acima de 60.000 caracteres (`--limite-entrada`) é reduzida: primeiras e últimas mensagens + as com
  código, erro ou decisão (espalhadas), cada mensagem enorme cortada no meio, com avisos `[... N mensagens omitidas ...]`.
- **Validação:** a resposta passa pelo mesmo `salvar` do `cerebro.py` (recusa título fora de 3 a 6 palavras, 3 a 10 palavras-chave, corpo
  grande, segredos, e-mail...). Se recusar, **1** nova tentativa pedindo a correção (leva só a resposta anterior, não a conversa); falhou
  de novo = falha registrada. O arquivo usa a **data original** da conversa (`2023-05-17_assunto.md`) e a origem correta
  (`claude`/`chatgpt`/`gemini`); conversa sem data original falha sem gastar nada. (`cerebro.py salvar --data AAAA-MM-DD` existe para isso.)
- **Retomada:** `importacoes/progresso.json` (ids concluídos, falhas com o motivo, tokens, amostra, última parada), gravado a cada
  conversa. Interrompeu (Ctrl+C), acabou o limite ou caiu: rode o mesmo comando e ele continua de onde parou. Falhas não são refeitas
  sozinhas (`--refazer-falhas`). **Limite de uso, login ou claude ausente = para na hora**, salva e avisa (código de saída 3), sem
  tentar de novo; 3 falhas seguidas também param.
- **Confirmação:** sem terminal ele recusa e pede `--sim` (que confirma tudo, inclusive entre lotes: use só se tiver certeza).
- **Fim:** roda `validar`, atualiza o `INDICE.md` e mostra o relatório: resumos criados, falhas (com o motivo), tokens gastos
  (**medidos** pelo `usage` que o Claude Code devolve; só estimados quando faltar) e os 10 projetos com mais arquivos em `conversas/`.
- Custo: depende do volume. O `--simular` mostra a estimativa antes (caracteres/4, mais o prompt a cada chamada, mais ~200 de saída).
  Cada chamada também carrega o que o seu Claude Code injeta por conta própria (hooks e plugins do usuário), então confira o gasto
  real nos 3 da amostra antes de soltar o lote; dá para cortar isso com `--claude-args "--setting-sources project"` se for o caso.

## Economia (`economia.py`)

O cérebro está compensando? Lê só os logs de `cerebro/.log/` (nenhuma IA, nenhuma rede). **Tudo é estimativa** (tokens = caracteres/4,
x1,1 com acentos); o único dado real é o do teste A/B que você digita (roteiro em `docs/teste-economia.md`).

```
economia.py painel [--semanas 8] [--json]    consultas por semana, proporção por nível, tokens evitados por sessão, A/B
economia.py ab-registrar --json < {"tarefa", "variante": "com"|"sem", "entrada", "saida", "custo_usd"?, "notas"?}
economia.py ab-remover ID [--json]           tira um registro do cerebro/.log/ab.jsonl
```

- **Por semana:** consultas, caracteres, tokens e uso de cada nível (titulos, cabecalho, ler, buscar). Uma *busca* = consultas seguidas
  com até 10 min entre si; "resolvida nos níveis 1-2" = não chegou ao `ler`. Quanto maior essa parcela, melhor.
- **Tokens evitados:** por sessão nova do `sessoes.jsonl` com consultas = (tokens de todas as conversas do projeto) - (tokens do estado
  + o que as consultas devolveram). Pode dar negativo. Estimativa otimista; veja o aviso no painel.
- **Painel:** Alt+4 > Search > `[mais ▾]` > Economia: dois gráficos em canvas (barras por nível + linha de tokens evitados; A/B com x sem cérebro).
  Testes: `python cerebro/tools/test_economia.py`.

## Manutenção (`manutencao.py`), sinônimos e índices por tema

Botão **Cérebro > `[manutenção]`** no widget, ou na linha de comando. **Só roda quando você manda**; só `consolidar` e `propor-estado` usam IA
(o Claude Code, `claude -p`, com a estimativa de tokens e a confirmação feitas pela tela).

```
manutencao.py diagnostico [--json]                 tamanho, nunca consultados (6+ meses), palavras-chave quase iguais, arquivos parecidos (80%+),
                                                   estados com 30+ dias, sinônimos sugeridos
manutencao.py sinonimos-aprovar --json < {"pares": {"bd": "banco-de-dados"}}      grava em cerebro/sinonimos.json
manutencao.py sinonimos-remover APELIDO
manutencao.py estimar-consolidar | consolidar GRUPO_ID [--modelo haiku]   (consolidar USA IA; originais -> cerebro/arquivo-morto/)
manutencao.py estimar-estado PROJETO | propor-estado PROJETO [--dias 90] [--modelo haiku] | aplicar-estado PROJETO < {"texto": "..."}
manutencao.py indices                              refaz o INDICE.md e, com mais de 100 arquivos, cerebro/indices/{projeto}.md
manutencao.py exportar --destino PASTA             cerebro-AAAA-MM-DD.zip (pode ter dados pessoais: não envie a repositório público)
```

- **Sinônimos** (`cerebro/sinonimos.json`, `{"bd": "banco-de-dados", "ia": "inteligencia-artificial"}`; chaves começando com `_` são comentários):
  `titulos`, `cabecalho` e `buscar` expandem os termos nos dois sentidos e imprimem `sinonimos: bd -> banco-de-dados` quando isso acontece
  (no JSON, o campo `sinonimos`). O log de consultas guarda o que você digitou. Na busca de títulos, partículas (de, da, do, e...) não pontuam.
- **Log de consultas:** cada linha agora tem `arquivos` (o que a consulta devolveu): é o que permite saber o que já foi consultado.
- **Prompts:** `cerebro/tools/prompt_consolidar.txt` e `prompt_estado.txt` (edite à vontade). A resposta passa pelo mesmo `salvar` (consolidar,
  com 1 nova tentativa se ele recusar) ou pela validação do estado (6 seções, 300 palavras).
- **Índice por projeto:** `cerebro/indices/{projeto}.md` (uma linha por arquivo: nome + palavras-chave). `titulos --projeto X` consulta primeiro
  esse índice (o JSON traz `"indice"`); se ele estiver velho (a pasta mudou depois dele) ou não achar nada, a busca segue a varredura normal.
- **Desfazer uma consolidação:** devolva à mão os arquivos listados em `cerebro/arquivo-morto/consolidacoes.jsonl` para `cerebro/conversas/`
  e apague o resumo consolidado. Testes: `python cerebro/tools/test_manutencao.py`.

## Privacidade do repositório (leia antes de dar `git push`)

O cérebro (conversas, estados, arquivo-morto) e o `projetos.json` podem ter **dados pessoais**. Este projeto deve ir **só para o repositório PRIVADO**
`https://github.com/wetonb1/Widget-brain` (remoto `brain`). O repositório `WidgetPOKEMEU` (remoto `origin`) é **público**.
- O `main` acompanha o `brain/main` e o `push` padrão vai para o `brain` (`remote.pushDefault`).
- O hook `tools/git-hooks/pre-push` **recusa** push para o `WidgetPOKEMEU`. Ativação, em qualquer clone: `git config core.hooksPath tools/git-hooks`.
- Ficam fora do git: `importacoes/`, `cerebro/.log/`, `*.zip` (backups) e `cerebro/indices/`. Antes de um `git add`, confira o `git status`.
- Skills: o básico é `cerebro-buscar` + `cerebro-compactar` (global). As três separadas (`cerebro-titulos`, `-cabecalho`, `-ler`) ficam na biblioteca;
  não instale junto com a combinada (cada uma paga o imposto fixo em toda conversa).

## Grafo (`grafo.py`)

Os dados da tela de grafo 3D da aba Cérebro: `grafo.py [--json] [--max-ligacoes 3] [--min-comum 2]`. Só leitura, sem IA. Um nó por projeto, por
conversa e por estado; ligações arquivo -> projeto e conversa <-> conversa com 2+ palavras-chave em comum (no máximo 3 por arquivo; palavras-chave
em mais de 60 arquivos não ligam nada). Testes: `python cerebro/tools/test_grafo.py`.
