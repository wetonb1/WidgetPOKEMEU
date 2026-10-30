# Google Antigravity CLI (agy) — o que foi confirmado

Versão instalada: **1.4.9** (`agy --version`, em 2026-10-28), em `C:\Users\weto\.gemini\bin\agy.exe` (`where agy`).
Fontes: `agy --help` e `agy help <subcomando>` dessa versão, `agy changelog`, testes reais (abaixo) e a documentação
oficial: [instalação](https://antigravity.google/docs/getting-started), [autenticação](https://antigravity.google/docs/install),
[comandos do CLI](https://antigravity.google/docs/cli/reference/), [regras](https://antigravity.google/docs/rules/),
[skills](https://antigravity.google/docs/skills/) e [migração do Gemini CLI](https://antigravity.google/docs/cli/gcli-migration/).

Os testes usaram o modelo mais leve (`gemini-3.8-flash-low`) e perguntas de uma linha, em pastas temporárias de `%TEMP%`
(já apagadas). Nenhuma chave, token ou arquivo de login foi lido; das variáveis de ambiente só se anotaram NOMES.

## 1. Instalação e pastas

| Item | Comando ou caminho | Status | Como foi confirmado |
|---|---|---|---|
| Está no PATH | `C:\Users\weto\.gemini\bin\agy.exe` | CONFIRMADO | `where agy` |
| Versão | 1.4.9 | CONFIRMADO | `agy --version` |
| Instalar (Windows, PowerShell) | `irm https://antigravity.google/cli/install.ps1 \| iex` | CONFIRMADO (docs) | página de instalação; o padrão dela é `%LOCALAPPDATA%\agy\bin`, mas aqui ele está em `~/.gemini/bin` |
| Instalar (Windows, cmd) | `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd` | CONFIRMADO (docs) | idem |
| Atualizar | `agy update` | CONFIRMADO | `agy --help` |
| `~/.agents` | existe; só `.skill-lock.json` | CONFIRMADO | listagem dos nomes |
| `~/.gemini` | `antigravity`, `antigravity-cli`, `bin`, `config`, `logs` | CONFIRMADO | listagem dos nomes de primeiro nível |
| `~/.gemini/GEMINI.md` (regras globais) | não existe | CONFIRMADO | `test -f` |
| Conversas do CLI | `~/.gemini/antigravity-cli/conversations/<id>.db` | CONFIRMADO | o `conversation_id` de cada teste apareceu ali (só nomes de arquivo) |
| Configurações do CLI | `~/.gemini/antigravity-cli/settings.json` | CONFIRMADO (existe) | listagem; docs: `trustedWorkspaces`, `permissions.allow`, `modelProvider` ficam aí |

## 2. Ajuda e opções

| Item | Comando ou caminho | Status | Como foi confirmado |
|---|---|---|---|
| a) Abrir interativo já com um prompt | `agy -i "prompt"` (`--prompt-interactive`) | CONFIRMADO | teste: respondeu e ficou esperando a próxima mensagem |
| a') Prompt como argumento solto (`agy "prompt"`, como no `claude`) | não existe | CONFIRMADO (não aceita) | teste: `Error: unexpected argument ... Prompts are read only from -p/--print, -i/--prompt-interactive, or stdin` |
| b) Escolher o modelo | `--model <id>`; durante a sessão `/model` | CONFIRMADO | `agy --help`, `agy models`, testes |
| b) Modelos Flash | `gemini-3.8-flash-low`, `-medium`, `-high` | CONFIRMADO | `agy models` |
| b) Modelos Pro | não há "Pro" com esse nome; o maior Gemini é `gemini-4-argon-low/medium/high`. O `/usage` agrupa "Gemini Flash, Gemini Pro" | NÃO CONFIRMADO que Argon = Pro | `agy models`, tela do `/usage` |
| b) Outros modelos | `claude-opus-5-5-*`, `claude-sonnet-5-5-*`, `gpt-oss-120b-medium` | CONFIRMADO | `agy models` |
| b) Esforço | `--effort low\|medium\|high\|xhigh\|max` | CONFIRMADO | `agy --help` |
| c) Continuar a última conversa **desta pasta** | `agy -c` (`--continue`) | CONFIRMADO | teste: em outra pasta havia conversas mais novas e mesmo assim retomou a da pasta |
| c) Retomar por id | `agy --conversation <id>` | CONFIRMADO | teste (funciona até rodando de outra pasta) |
| c) Escolher numa lista | `/resume` (apelidos `/switch`, `/conversation`) dentro da sessão | CONFIRMADO | lista de comandos de barra; não há opção de CLI para abrir a lista |
| d) Não interativo | `agy -p "prompt"` (`--print`, `--prompt`; ou stdin) | CONFIRMADO | testes |
| d) Formato de saída | `--output-format text\|json\|stream-json`; `--json-schema`; `--input-format stream-json`; `--print-timeout` | CONFIRMADO | `agy --help`, teste com `json` |
| d) Tokens e custo | o `json` traz `usage` (input, output, thinking, cache_read, total) e `conversation_id`, `status`, `duration_seconds`, `num_turns`; **sem custo** | CONFIRMADO | teste |
| d) Ferramentas no `-p` | comandos de terminal são **recusados** sem uma regra em `permissions.allow` do `settings.json` (`denied_actions` no json) | CONFIRMADO | teste |
| d) Desligar skills/comandos | `--disable-slash-commands` (só no `-p`: não expande `/` nem skills) | CONFIRMADO (help) | não testado |
| d) Desligar MCP | `agy mcp disable <nome>` (persistente; não há opção por execução) | CONFIRMADO (help) | não testado |
| d) Sandbox | `--sandbox` (restrições de terminal; desde a 1.4.4 não faz nada se a máquina não tiver sandbox) | CONFIRMADO (help e docs) | não testado |
| d) Não gravar a conversa | não existe opção equivalente ao `--no-session-persistence` | NÃO CONFIRMADO | não aparece no help |
| e) Autoaprovação total | `--dangerously-skip-permissions` | CONFIRMADO (help) | **nunca usado** |
| e) Outros modos | `--mode accept-edits\|auto\|plan` | CONFIRMADO (help) | não testado |
| f) Login | não há `/login` nem subcomando: a tela de entrada aparece ao abrir sem conta | CONFIRMADO que não há comando | lista de `/` e `agy --help`; a tela de login em si NÃO CONFIRMADA (não deslogamos) |
| f) Logout | `/logout` | CONFIRMADO | lista de `/` |
| f) Status da conta | não há `/status`; o cabeçalho da sessão mostra a conta e o plano, e o `/usage` mostra `Account:` | CONFIRMADO | telas reais |
| g) Variável de chave de API | `GEMINI_API_KEY` (`GOOGLE_API_KEY` não tem efeito; `.env` não é lido) | CONFIRMADO (docs) | não testado (sem chave) |
| g) Prioridade sobre o login | **não** por si só: a chave só vale com `modelProvider: "gemini"` no `settings.json`; aí ele pula a tela de entrada | CONFIRMADO (docs) | não testado |
| g) Outras | `AGY_ADC_AUTH=true` (credenciais do Google Cloud), `GOOGLE_GEMINI_BASE_URL` | CONFIRMADO (docs) | não testado |
| h) Uso/cota | `/usage` (apelido `/quota`); `/credits` para créditos | CONFIRMADO | tela real (abaixo) |
| h) Programa de fora ler a cota | não há subcomando nem campo no `json`; só lendo a tela do `/usage` (como o widget faz com o Claude) | CONFIRMADO que não há meio oficial | help, json e telas |

## 3. Arquivos de regras que ele lê

Teste: em pastas temporárias distintas, a regra "Comece sempre a resposta com a palavra BANANA" e a pergunta "quanto é 2+2?".

| Arquivo | Status | Resultado |
|---|---|---|
| `AGENTS.md` na raiz | CONFIRMADO | `BANANA 2 + 2 é igual a 4.` |
| `GEMINI.md` na raiz | CONFIRMADO | `BANANA ...` |
| `.agents/rules/teste.md` **sem** cabeçalho | CONFIRMADO que é ignorado | `2 + 2 é igual a 4.` |
| `.agents/rules/teste.md` com `---\ntrigger: always_on\n---` | CONFIRMADO | `BANANA ...` |
| `.agent/rules/teste.md` (singular, nome antigo) com `trigger: always_on` | CONFIRMADO | `BANANA ...` |
| Pasta sem nada (controle) | CONFIRMADO | `2 + 2 é igual a 4.` |
| Globais: `~/.gemini/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.gemini/config/rules/*.md`, `~/.gemini/antigravity-cli/rules/*.md` | NÃO CONFIRMADO por teste (docs) | não testado para não mexer nas suas regras globais; os arquivos soltos não precisam de cabeçalho |

Limites (docs): um arquivo de regra é cortado depois de 24.000 bytes; as regras globais e `always_on` dividem 20.000 tokens.

## 4. Skills, comandos e o shell

| Item | Comando ou caminho | Status | Como foi confirmado |
|---|---|---|---|
| Skills do projeto | `<pasta>/.agents/skills/<nome>/SKILL.md` (`.agent/skills` também) | CONFIRMADO | teste com `teste-banana` |
| Skills globais do CLI | `~/.gemini/antigravity-cli/skills/<nome>/` (hoje não existe) | NÃO CONFIRMADO por teste (docs) | o app/IDE usa outra: `~/.gemini/config/skills/` |
| Skills de plugins | `~/.gemini/antigravity-cli/plugins/<nome>/skills/` | NÃO CONFIRMADO por teste (docs) | |
| Cabeçalho do SKILL.md | `name` (opcional; minúsculas e hífen; padrão = nome da pasta) e `description` (obrigatória) | CONFIRMADO (docs + teste) | limites de tamanho não documentados: NÃO CONFIRMADO |
| Como é acionada | o agente vê nome e descrição no começo; lê o SKILL.md quando parece útil | CONFIRMADO | teste: "qual fruta amarela você conhece?" respondeu `SKILL-BANANA-OK` sem citar a skill |
| Comando de barra por skill | cada skill vira `/<nome>` | CONFIRMADO | `/teste-banana` apareceu na lista de `/` |
| Comandos/workflows próprios | os "workflows" antigos viraram skills (docs de migração); não há pasta própria de comandos no CLI | NÃO CONFIRMADO por teste | |
| Rodar `python scripts\oi.py` | funciona (pede permissão antes) | CONFIRMADO | teste interativo: `PYTHON-OK 3.14.7` |
| Shell | **Windows PowerShell 5.1** (`$PSVersionTable.PSEdition` = `Desktop`; `%COMSPEC%` não é expandido) | CONFIRMADO | teste |
| stdin com here-string | `@"`…`"@ \| python scripts\oi.py` funciona | CONFIRMADO | teste: `PYTHON-OK 3.14.7 ola-stdin` |

## 5. Ambiente dos programas que ele abre

Comparando os NOMES das variáveis passadas ao `agy` com as que um script dentro dele enxerga:

- Aparecem só dentro do agy: `ANTIGRAVITY_AGENT`, `ANTIGRAVITY_AGENTAPI_EXE`, `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_CONVERSATION_ID`,
  `ANTIGRAVITY_CSRF_TOKEN`, `ANTIGRAVITY_LS_ADDRESS`, `ANTIGRAVITY_LS_VERSION`, `ANTIGRAVITY_PROJECT_ID`, `ANTIGRAVITY_SOURCE_METADATA`,
  `ANTIGRAVITY_TRAJECTORY_ID`, `HGEDITOR`, `JJ_EDITOR` (candidatas ao `limparAmbiente`). O `COLORTERM` também apareceu, mas foi posto
  pelo host de teste (`app/pty.js`), não pelo agy.
- Nenhuma variável some.
- Aninhar: um `agy -p` rodado de dentro de uma sessão do agy **foi gravado** (o `conversation_id` dele apareceu em `conversations/`),
  e os `agy -p` rodados daqui, de dentro de uma sessão do Claude Code, também. Não há equivalente ao `CLAUDE_CODE_CHILD_SESSION`.
  NÃO CONFIRMADO: o que as `ANTIGRAVITY_*` herdadas mudam numa sessão **interativa** aberta de dentro de outra.

## 6. Terminal embutido (frases exatas, sem ANSI)

| Situação | Frases | Status |
|---|---|---|
| Confiar na pasta (bloqueio) | `Do you trust the contents of this project?` / `Antigravity CLI requires permission to read, edit, and execute files here.` / `> Yes, I trust this folder` / `No, exit` / `↑/↓ Navigate · enter Confirm` | CONFIRMADO |
| Permissão de comando (bloqueio) | `Requesting permission for:` / `Run this command?` / `> 1. Yes, run command` / `2. Yes, and always allow in this conversation ...` / `3. ... (Persist to settings.json)` / `4. No, cancel` | CONFIRMADO |
| Aviso inicial que some com Esc | `┃ esc to dismiss` | CONFIRMADO |
| Trabalhando | `esc to cancel` (com `Generating...`, `Running command...`) | CONFIRMADO |
| Pronto para digitar | linha `>` entre dois traços e o rodapé `? for shortcuts` + `Gemini 3.8 Flash · low` | CONFIRMADO |
| Login | não capturado (não deslogamos) | NÃO CONFIRMADO |
| Texto + Enter juntos | **envia** (não vira colagem); `\n` sozinho quebra a linha; `\r` envia | CONFIRMADO |

Diferenças para o `app/embutido.js` de hoje: o prompt é `>` (não `❯`), então o `PRONTO` atual não serve; `? for shortcuts` já está na lista;
`Do you trust`/`Yes, I trust` já estão no `BLOQUEIOS`, mas `Run this command?` e `Requesting permission for:` não. Na tela de confiança,
Enter já aceita (a opção 1 vem marcada); o widget nunca deve mandar Enter ali.

Tela real do `/usage` (mostra o que **resta**, não o que foi usado como no Claude):

```
Models & Quota
  Account: <email>
GEMINI MODELS
  Models within this group: Gemini Flash, Gemini Pro
  Weekly Limit Remaining
    [██████████...] 99.19%
    Refreshes in 167h 11m
  Five Hour Limit Remaining
    [██████████...] 97.26%
    Refreshes in 4h 11m
CLAUDE AND GPT MODELS
  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS
  Weekly Limit Remaining ... 49.67%  ·  Five Hour Limit Remaining ... 0.00%
  (1–21 of 38 lines)  ↑/↓ Scroll · ... · esc Close
```

## 7. Processos

| Item | Resultado | Status |
|---|---|---|
| Nome do processo | `agy.exe` (um processo só, sem filhos próprios) | CONFIRMADO |
| `cmd /k agy` | `cmd.exe` → `agy.exe` (filho direto) | CONFIRMADO |
| Sessão embutida | host `pty-*.exe` → `conhost.exe` + `agy.exe` | CONFIRMADO |

O `sessoes.js` (que procura `{executavel}.exe` filho do `cmd.exe`) acharia o `agy.exe` sem mudança.

## 8. MCP

- Arquivo central: `~/.gemini/config/mcp_config.json`. CONFIRMADO: um `agy mcp add` com `USERPROFILE` apontado para uma pasta
  temporária criou exatamente `.gemini/config/mcp_config.json` (o seu arquivo não foi tocado).
- Gerenciar: `agy mcp add|remove|list|enable|disable`; dentro da sessão, `/mcp`. Hoje: `No MCP servers configured.`

## O que se viu nos testes reais

- `agy -p ... --model gemini-3.8-flash-low --output-format json`: ~2,5 s e ~6.900 tokens de entrada para "2+2" (o contexto fixo dele).
- Rodar o agy pelo host ConPTY do widget (`app/pty.js`, sem alterar nada) funcionou de primeira: tela, teclas, Enter e encerramento.
- Pasta nova pede confiança toda vez (a aceita fica em `trustedWorkspaces`). Os testes deixaram lá as pastas temporárias de `%TEMP%`
  (já apagadas) e algumas conversas de teste em `~/.gemini/antigravity-cli/conversations/`.
- No `-p`, qualquer comando de terminal é recusado sem regra em `permissions.allow`; o json avisa em `denied_actions`.
- `-c` respeita a pasta; `--conversation <id>` retoma de qualquer pasta e mantém as regras da pasta original.
- A cota é dividida em dois grupos (Gemini; Claude e GPT), cada um com limite semanal e de 5 horas.

## Regras por projeto e globais (fase 10.4)

| Item | Comando ou caminho | Status | Como foi confirmado |
|---|---|---|---|
| Arquivo de instruções do projeto | `AGENTS.md` na raiz (o `projetos.py preparar` gera o do Antigravity e o `CLAUDE.md` do Claude, conforme `ia` e `ia_reserva`) | CONFIRMADO | teste BANANA (seção 3) e o teste de adesão abaixo |
| `.agents/rules/*.md` | só vale com `trigger: always_on`; o `preparar` não usa | CONFIRMADO (seção 3) | |
| Arquivo global do agy | `~/.gemini/GEMINI.md` (`skills-biblioteca/gemini-global.md`, instalado por `instalar_basico.py --alvo antigravity --aplicar-gemini-md`) | NÃO CONFIRMADO por teste (só a documentação) | o teste (criar o arquivo com a regra BANANA, perguntar e apagar) foi bloqueado pelo sistema de segurança por mexer fora da pasta do widget; para confirmar, crie você mesmo um `~/.gemini/GEMINI.md` temporário com "Comece sempre a resposta com a palavra BANANA", rode `agy -p "quanto é 2+2?" --model gemini-3.8-flash-low` numa pasta sem regras e apague o arquivo |
| Skills globais do agy | `~/.gemini/antigravity-cli/skills/` | NÃO CONFIRMADO por teste | o instalador só grava aí com `--global --aplicar-skills-agy` (no projeto do widget grava direto em `.agents/skills`) |

O `instalar_basico.py` nunca grava no `~/.gemini` sem `--aplicar-gemini-md` (nem criar o arquivo) e sempre mostra quantos tokens o bloco soma a toda conversa
(estimativa do `tokens.py`; o bloco do agy tem 8 linhas).

### Teste de adesão: o agy consulta o cérebro sozinho? (2026-10-28, `gemini-3.8-flash-low`)

Montagem: pasta temporária com um cérebro de mentira (uma decisão inventada: "paleta verde-musgo #3a5f3a e laranja-queimado #d9822b"), um projeto
cadastrado com `ia: antigravity` e o `AGENTS.md` gerado pelo `projetos.py preparar --confirmar`. Pergunta: "o que decidimos sobre a paleta de cores do jogo?".
O agy foi aberto como o widget abre (`agy --model ... -i "<texto>"`) numa sessão interativa; o primeiro comando que ele pediu foi lido na tela de permissão e
**recusado** (nada foi executado). Uma rodada de cada (n = 1, não é estatística).

| Rodada | O que ele pediu para rodar primeiro | Consultou o cérebro? |
|---|---|---|
| A: só a pergunta (o `AGENTS.md` com o bloco "## Cérebro" estava na pasta) | `Get-ChildItem` procurando `*.md` na pasta dele (`~/.gemini/antigravity-cli/scratch`) | **Não** |
| B: o prompt inicial do widget (`prompt_inicial.txt` com a pergunta como tarefa) | `python ".../cerebro/tools/cerebro.py" buscar ... --projeto jogo-demo` | **Sim**, já como primeiro comando |

Leituras: (1) só o bloco do `AGENTS.md` não bastou no Flash leve; o prompt inicial garante a consulta, então o widget continua mandando o prompt também
no agy (`-i`). (2) Na rodada B os termos da busca saíram ruins ("responda poucas linhas decidimos paleta") porque o tema é extraído do texto da tarefa, que
aqui incluía "responda em poucas linhas": é um efeito do teste, não do agy. (3) Em `-p` (sem terminal) os dois casos aparecem só como `RunCommand` negado,
sem mostrar qual comando, por isso a medição foi feita no modo interativo. Não testado: modelos mais fortes (`gemini-4-argon-*`) e se `-i` aceita o prompt
inicial completo (várias linhas, aspas) pelo terminal externo.

## Paridade com o Claude

**Dá para fazer igual**
- Abrir pelo widget, inclusive embutido: `agy --model <id> -i "<prompt>"` (ou só `--model` para abrir vazio); `-c` para continuar a da pasta.
- Sessões ativas: o processo é `agy.exe`, filho direto do `cmd.exe`; com o ConPTY o PID vem direto.
- Mesmas regras: o `AGENTS.md` da raiz é lido (o projeto já tem um, igual ao `CLAUDE.md`).
- Mesmas skills no projeto: copiando para `.agents/skills/<nome>/` (mesmo formato `name` + `description`).
- Scripts do cérebro: ele roda `python ...` no PowerShell e aceita here-string no stdin.
- MCP num arquivo central conhecido.

**Dá parcialmente (e por quê)**
- Pronto/bloqueio no terminal embutido: as frases são outras (`>` em vez de `❯`; `Run this command?`), então o `embutido.js` precisa de
  marcadores por IA; a tela de login não foi capturada.
- `/usage`: existe, mas mostra o que **resta** e em dois grupos de modelos, com outro texto; o `uso-tela.js` precisa de outro leitor.
- Modelos: os nomes são outros (`gemini-3.8-flash-*`, `gemini-4-argon-*`) e não há "haiku/sonnet/opus"; o widget precisa de uma tabela própria.
- Retomar escolhendo numa lista: só `/resume` dentro da sessão (não há `--resume` sem id na linha de comando).
- Skills globais: a pasta do CLI (`~/.gemini/antigravity-cli/skills`) é diferente da do app/IDE (`~/.gemini/config/skills`); não testada.
- Regras globais: documentadas, não testadas (para não mexer nas suas).
- Chave de API: `GEMINI_API_KEY` só vale com `modelProvider: "gemini"` no `settings.json`; tirar a variável do ambiente não basta para "voltar à assinatura".
- Comandos do cérebro (`/compactar` etc.): no agy os comandos de barra próprios são as skills, então precisam virar skills em `.agents/skills`.
- Limpar ambiente: as `ANTIGRAVITY_*` são conhecidas, mas não se sabe se atrapalham uma sessão interativa aninhada.

**Não dá (e por quê)**
- Prompt inicial como argumento solto (`agy "texto"`): ele recusa; precisa de `-i`.
- Não gravar a sessão (`--no-session-persistence`): não existe opção.
- Teto de gasto (`--max-budget-usd`) e custo em dinheiro no json: não existem (só tokens).
- Ler a cota por um programa de fora sem passar pela tela: não há comando nem campo.

## Skills do cérebro no agy (fase 10.5)

| Item | Resultado | Status |
|---|---|---|
| Destino no projeto | `<pasta>/.agents/skills/<nome>/` (o `skills.py instalar --alvo antigravity --escopo projeto`) | CONFIRMADO (seção 4 e teste 10.5) |
| Destino global | `~/.gemini/antigravity-cli/skills/` (variável `SKILLS_GLOBAL_ANTIGRAVITY` nos testes) | NÃO CONFIRMADO por teste: só a documentação |
| `cerebro-buscar` no agy (texto neutro, sem variante) | pergunta "use a skill cerebro-buscar: o que decidimos sobre o grafo 3d do cerebro?" (`gemini-3.8-flash-low`, na pasta do widget): leu o `SKILL.md` da skill, rodou `python ".../cerebro.py" buscar grafo 3d cerebro --projeto meu-widget` (permissão pedida e aprovada) e depois pediu o `cerebro.py ler estado/meu-widget.md ...` (passo 4 da skill; recusado de propósito neste teste). **Não leu nenhum arquivo do cérebro direto.** Obs.: o `AGENTS.md` do widget também manda consultar o cérebro, então o teste não separa as duas instruções | CONFIRMADO |
| `cerebro-compactar` no agy (variante PowerShell) | num projeto temporário, `/cerebro-compactar salve no cérebro esta conversa de teste: ...`: leu o `SKILL.md`, montou `$OutputEncoding = ...; @' ... '@ \| python ".../cerebro.py" salvar ... --origem antigravity`, a permissão foi aprovada e o arquivo foi salvo com acentos intactos (`Decisão`, `Pendência`) e `origem: antigravity` | CONFIRMADO |
| Acionar pelo texto livre | no mesmo projeto temporário, "use a skill cerebro-compactar: salve no cérebro..." o modelo NÃO abriu a skill: procurou "cerebro" em `~/.gemini` com `Get-ChildItem` (recusado). Com a barra (`/cerebro-compactar ...`) funcionou na hora | CONFIRMADO (use a barra quando a skill é pedida de propósito) |
| `compativel` | `antigravity` só consta nas skills testadas acima (`cerebro-buscar` e `cerebro-compactar`); `cerebro-titulos`, `cerebro-cabecalho` e `cerebro-ler` continuam só `claude` | |

Cuidado visto no teste: o `cerebro.py` usa o cérebro **configurado** (`~/.cerebro.json` / `CEREBRO_CONFIG` / `CEREBRO_DIR`), não a pasta onde o script está. Um teste que copia
o `tools/` para um cérebro temporário precisa levar a variável `CEREBRO_DIR` para dentro do agy; sem ela o `salvar` grava no cérebro de verdade (aconteceu no teste 10.5 e
o arquivo de teste foi apagado e o índice regenerado).

## Compactar nos dois (fase 10.7)

| Item | Resultado | Status |
|---|---|---|
| Como acionar no agy | a skill `cerebro-compactar` vira o comando `/cerebro-compactar` (o agy não tem pasta de comandos própria; os "workflows" viraram skills). Na pasta do projeto: `/cerebro-compactar salve no cérebro esta sessão`. No Claude Code a mesma skill responde a "use a skill cerebro-compactar ..." | CONFIRMADO (testes 10.5 e 10.7) |
| Origem gravada | cada skill escreve a sua sozinha: `claude-code` (Claude Code) e `antigravity` (agy); `claude`, `chatgpt` e `gemini` ficam para chats de sites e apps. A origem de cada IA vem do `origemCerebro` do `app/ias-dados.json` | CONFIRMADO |
| Primeira sessão numa pasta nova | OBSERVADO em 2 testes (10.5 e 10.7): na 1ª sessão numa pasta que o agy ainda não conhecia (tela "Do you trust the contents of this project?") ele NÃO abriu a skill do projeto e foi procurar "cerebro" em `~/.gemini`; na 2ª sessão, na mesma pasta já confiável, abriu o `SKILL.md` e usou a skill. A causa não foi isolada: abra o agy uma vez na pasta, aceite a confiança e só depois use as skills | OBSERVADO |
| Qualidade do resumo | mesma conversa de teste nas duas IAs (projetos e cérebro temporários; Claude Code com `--model haiku`, agy com `gemini-3.8-flash-low`): `cerebro.py validar` sem erros nos dois; Claude: 5 palavras-chave, 6 tópicos, 49 palavras no corpo, 459 caracteres; agy: 6 palavras-chave, 5 tópicos, 44 palavras, 404 caracteres. Mesmo cabeçalho, origem certa em cada um. Nenhum ajuste na variante foi necessário | CONFIRMADO |
| Tela de permissão | para comandos longos o agy mostra só o começo e o fim ("⋯ 3 lines hidden"): quem aprova comandos por programa não enxerga o caminho do meio | CONFIRMADO |
| Texto igual nas duas | `skills-biblioteca/test_skills.py` compara o cabeçalho, a regra, os passos 1 a 4 e o 7 do `SKILL.md` do Claude com a variante do agy: só os passos de shell (5 e 6) podem diferir | |

## Continuar em outra IA, uso e conta (fase 10.8)

| Item | Resultado | Status |
|---|---|---|
| `/usage` do agy lido pelo widget | `app/uso-tela-agy.js` lê, da tela do terminal embutido e só quando você clica em [ver agora], os grupos "GEMINI MODELS" e "CLAUDE AND GPT MODELS" (e "GEMINI 4 ARGON", se aparecer) com "Weekly Limit Remaining" e "Five Hour Limit Remaining": o percentual que RESTA e o "Refreshes in ...". Fixture real anonimizada: `tools/fixtures/agy-uso.txt`; teste: `tools/testar-uso-tela-agy.js` | CONFIRMADO (captura real, versão 1.4.9) |
| A tela do `/usage` rola | só 27 das 38 linhas aparecem de início ("(1–27 of 38 lines)", "↑/↓ Scroll"): o grupo "GEMINI 4 ARGON" fica cortado e o leitor não inventa números para ele; ele só entra se estiver visível na tela | CONFIRMADO |
| Sentido dos números | no agy as barras mostram o que RESTA (no Claude, o que foi USADO); a tela do widget inverte a cor (pouco restante = alerta) e rotula cada IA | CONFIRMADO |
| Conta | a linha `Account:` do `/usage` mostra o e-mail na tela, mas o leitor nunca a guarda, e a fixture a troca por `<conta>` | CONFIRMADO |
| Trocar conta no agy | só `/logout` está conferido; não há `/login` nem `/status` (a conta aparece no cabeçalho e no `/usage`); a tela de entrada não foi capturada (ninguém foi deslogado). O widget só mostra os passos, por IA; o aviso dos termos aparece uma vez por IA | CONFIRMADO só o `/logout`; o resto NÃO CONFIRMADO |
| Continuar em outra IA | o botão "continuar no {outra IA}" abre uma sessão NOVA que lê o estado do cérebro (a mesma retomada da pausa). Teste real (3 sessões, `gemini-3.8-flash-low`, projeto e cérebro temporários com um estado de fatos inventados): o agy rodou o `cerebro.py buscar`, depois o `cerebro.py ler estado/...` e foi atrás do primeiro passo pendente (`test_zeta_vazio`, que só existe no estado), sem que ninguém explicasse nada. **A resposta final de 1 linha não foi capturada**: depois de ler o estado ele tenta listar a pasta (`dir`, `Get-ChildItem`) e o teste só aprovava comandos do `cerebro.py`, o que interrompe o turno | CONFIRMADO que lê o estado e segue o 1º passo; resposta final NÃO CAPTURADA |
| Pular permissões | nunca é herdado: o abrirIA recebe `semPularPermissoes: true` ao continuar em outra IA (e a IA reserva já não herdava) | CONFIRMADO (testes) |
| Chave de API | o widget abre as sessões SEM a variável da IA (`ANTHROPIC_API_KEY` ou `GEMINI_API_KEY`), mesmo que ela exista no Windows, a menos que o projeto ligue `usar_api_key`; o valor nunca vai para a tela | CONFIRMADO (testes) |

## Importador e manutenção em lote (fase 10.9 — não implementada)

O `importar.py resumir` e a manutenção (`consolidar` e `propor-estado`) continuam usando **só o Claude Code** (`claude -p`), que desliga todas as ferramentas (`--tools ""`), as skills (`--disable-slash-commands`), o MCP (`--strict-mcp-config`) e a gravação da sessão (`--no-session-persistence`). No `agy` 1.4.9 isso não é possível:

| O que o resumo em lote precisa | No `claude -p` | No `agy -p` (confirmado em `%TEMP%` com `gemini-3.8-flash-low`) |
|---|---|---|
| Desligar ferramentas (`read_file`, `write_file`, `edit_file`...) | `--tools ""` | **NÃO EXISTE**: mesmo com `--sandbox --disable-slash-commands` (e com `--mode plan`), o `agy -p` leu um arquivo da pasta e criou `gravou.txt` sem pedir permissão |
| Passar a conversa por `stdin` junto com `-p "prompt"` | funciona | **NÃO FUNCIONA** como esperado: com texto no `stdin` + `-p "instrução"`, o `agy` não enxergou a entrada como parte do prompt e tentou rodar um comando de terminal (`RunCommand`, negado no modo headless) |
| Desligar MCP só nesta chamada | `--strict-mcp-config` | **NÃO EXISTE** flag por execução (só `agy mcp disable <nome>`, que altera a configuração global) |
| Não gravar cada resumo como conversa | `--no-session-persistence` | **NÃO EXISTE**: cada chamada cria um `.db` em `~/.gemini/antigravity-cli/conversations/` |

**Decisão:** sem ferramentas desligadas, resumir conversas antigas (que podem conter caminhos de arquivos, comandos ou instruções coladas) rodaria com acesso real de leitura e escrita a arquivos da máquina — e esse risco não vale a pena. A etapa 10.9 foi parada como previsto na regra da fase.

## Auditoria, reconfirmação de adesão e lacunas conhecidas (fase 10.10)

### Reconfirmação do teste de adesão (2 IAs × 2 modos)

Em pasta temporária (`%TEMP%\teste-adesao-10-10`, apagada ao final), com um cérebro falso contendo a decisão inventada `Paleta Cyberpunk Neon (roxo #7B2CBF e ciano #00F5D4)` em `estado/jogo-paleta.md`, projeto preparado com `CLAUDE.md` + `AGENTS.md` e a skill `cerebro-buscar` instalada em `.claude/skills/` e `.agents/skills/`:

| IA e modelo | Sem `prompt_inicial` (só a pergunta `"o que decidimos sobre a paleta de cores do jogo?"`) | Com `prompt_inicial` (`projetos.py prompt`) | Consultou sozinha? |
|---|---|---|---|
| **Antigravity** (`agy --model gemini-3.8-flash-low`) | **SIM** — na 1ª ação pediu permissão para `python ".../cerebro/tools/cerebro.py" buscar "paleta de cores" --projeto jogo-paleta` | **SIM** — na 1ª ação pediu permissão para `python ".../cerebro/tools/cerebro.py" buscar decidimos paleta cores jogo --projeto jogo-paleta` | **Sim, nos dois modos** |
| **Claude Code** (`claude --model haiku`) | **SIM** — na 1ª ação pediu permissão (`PowerShell command`) para `python ".../cerebro/tools/cerebro.py" buscar paleta cores --projeto jogo-paleta` | **SIM** (confirmado no 10.4; na repetição da 10.10 a conta bateu 100% do limite de 5h logo após a 1ª rodada) | **Sim, nos dois modos** |

### Resumo das lacunas conhecidas do `agy` 1.4.9

1. **Escolher sessão anterior pela linha de comando (`retomar`):** `agy -r` exige o ID exato da sessão; para escolher numa lista, abra a sessão e digite `/resume` (o botão na aba Projects fica desabilitado com essa dica).
2. **Arquivos globais fora da pasta do widget (`~/.gemini/GEMINI.md` e `~/.gemini/antigravity-cli/skills/`):** documentados oficialmente, mas não confirmados por teste prático (para não alterar a pasta `~/.gemini` do usuário). O `instalar_basico.py --global` só grava neles com `--aplicar-gemini-md` / `--aplicar-skills-agy`, e o `tokens.py` mostra o `GEMINI.md` global fora da soma principal do imposto fixo.
3. **Comandos de conta (`/login` e `/status`) e tela de login:** o `agy` 1.4.9 tem `/logout`, mas não tem `/login` nem `/status` (o login abre quando não há conta ativa; a conta aparece no cabeçalho da TUI e na linha `Account:` do `/usage`). A tela de login não foi capturada; sem o rodapé `? for shortcuts`, o `embutido.js` nunca digita nela.
4. **Rolagem do `/usage`:** a tela do `/usage` no `agy` mostra 27 de 38 linhas de início (`(1–27 of 38 lines)`); o 3º grupo (`GEMINI 4 ARGON`) fica abaixo da rolagem inicial e só entra nas barras se estiver visível na tela.
5. **Modo headless (`agy -p`) com ferramentas de arquivo ativas:** não há equivalente a `--tools ""` nem a `--no-session-persistence`, por isso o importador (`importar.py resumir`) e a manutenção assistida por IA (`consolidar` e `propor-estado`) usam apenas o Claude Code.
