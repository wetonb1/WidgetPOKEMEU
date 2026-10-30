# Claude Code — o que foi confirmado

Versão instalada: **2.1.292** (`claude --version`, em 2026-10-28).
Fontes: `claude --help` dessa versão e a documentação oficial (https://code.claude.com/docs/en/skills).

## Caminhos do projeto

| O quê | Caminho | Fonte |
|---|---|---|
| Instruções do projeto | `CLAUDE.md` na raiz | lido automaticamente (o `--bare` desliga essa leitura) |
| Skills do projeto | `.claude/skills/<nome>/SKILL.md` | docs oficiais |
| Comandos do projeto | `.claude/commands/<nome>.md` | docs oficiais |

Os comandos foram **unidos às skills**: `.claude/commands/deploy.md` e `.claude/skills/deploy/SKILL.md`
criam o mesmo `/deploy`. A pasta `commands/` é o formato antigo e continua funcionando, mas a
documentação recomenda skills para coisas novas, porque elas aceitam arquivos de apoio e o Claude
pode carregá-las sozinho quando forem úteis.

## Trocar de modelo

- Ao abrir: `claude --model opus` (apelidos `fable`, `opus` e `sonnet`, ou o nome completo do modelo).
- Durante a sessão: `/model opus`.
- Modelo reserva se o principal estiver sobrecarregado: `--fallback-model <modelo>`.
- Esforço: `--effort low|medium|high|xhigh|max`.

## Continuar sessões

- `claude -c` / `--continue`: continua a conversa mais recente **desta pasta**.
- `claude -r` / `--resume [id ou termo]`: continua pelo ID ou abre a lista para escolher.
- `--fork-session` (junto com `-c` ou `-r`): continua numa cópia, com um ID novo.
- `-n` / `--name <nome>`: dá um nome à sessão (aparece na lista do `/resume`).
- `--session-id <uuid>`: usa um ID escolhido por você.
- Em segundo plano: `claude --bg` devolve um ID; depois `claude agents` lista as sessões,
  `claude attach <id>` abre uma delas, `claude logs <id>` mostra a saída e `claude stop <id>` para.

## Modo não interativo (útil para o widget disparar tarefas)

- `claude -p "pergunta"`: responde e sai. Nesse modo o aviso de confiança da pasta é pulado.
- `--output-format text|json|stream-json`: formato da saída (`json` facilita ler o resultado).
- `--max-budget-usd <valor>`: teto de gasto (só com `-p`).
- `--allowedTools` / `--disallowedTools` / `--permission-mode`: limitam o que ele pode fazer.
- `--no-session-persistence`: não grava a sessão em disco.
- `--json-schema <schema>`: força uma saída estruturada.

## Abrir pelo widget (aba Projetos, fase 2.2)

Conferido de novo no `claude --help` da 2.1.292 (2026-10-28):

| Botão | Comando que o widget roda na pasta do projeto |
|---|---|
| Abrir Claude | `claude --model <sonnet\|opus\|haiku> "<prompt inicial>"` |
| Continuar última sessão | `claude --continue --model <modelo>` (a conversa mais recente **desta pasta**) |
| Escolher sessão anterior | `claude --resume --model <modelo>` (abre a lista para escolher) |

- `prompt` como argumento abre a sessão **interativa** já com a mensagem: não precisa copiar e colar.
- Pular permissões (`--dangerously-skip-permissions`) **nunca** é usado por padrão. Só entra se o projeto tiver
  `"pular_permissoes": true` (caixa no "editar", com aviso). A ajuda recomenda isso só em ambientes isolados sem internet.
- Janela: `wt.exe -d <pasta> --title <nome> cmd /k claude ...` (Windows Terminal) ou, sem ele,
  `cmd /d /s /c "start "<nome>" /d "<pasta>" cmd /k claude ..."`. O widget não espera a sessão terminar.
- O prompt vira uma linha só: o cmd não aceita quebra de linha num argumento, aspas duplas viram simples, `%` sai
  (o cmd expandiria) e `;` vira `,` (o wt separa comandos com `;`).
- Instalação oficial (o widget só mostra, não instala): `irm https://claude.ai/install.ps1 | iex` no PowerShell, ou
  `winget install Anthropic.ClaudeCode`. Documentação: https://code.claude.com/docs/en/setup

### O que se viu nos testes reais

- **Primeira vez numa pasta**: o Claude Code pergunta "Is this a project you created or trust?" antes de tudo
  (sessões da extensão do VS Code não contam). Escolha "Yes, I trust this folder" uma vez; depois o prompt roda.
- **Sessão-filha**: se o widget for aberto de dentro de uma sessão do Claude Code (ex.: `npm start` no terminal dele),
  o ambiente traz `CLAUDE_CODE_CHILD_SESSION` e a sessão nova **não grava a conversa** ("continuar" não acha nada).
  O widget tira essas marcas antes de abrir (lista em `app/ias.js`, `limparAmbiente`).
- `--continue` pega a conversa mais recente da pasta, inclusive uma que esteja aberta em outro lugar (ex.: no VS Code).
- Duas sessões na mesma pasta disputam os mesmos arquivos: o widget avisa e oferece um git worktree (`{pasta}-sessao2`).
  Sessões paralelas consomem o mesmo limite de uso da conta (o widget avisa a partir de `max_sessoes`, padrão 3).

## Uso, limites, trocar de conta e chave de API (fase 4.1)

Conferido na documentação oficial (versão 2.1.292, 2026-10-28):

- **Ver o uso:** `/usage` (apelidos `/cost` e `/stats`) mostra o uso da sessão e dos limites da conta; `/status` mostra qual método de
  login está ativo (assinatura ou chave de API); `/usage-credits` trata de créditos. **Não existe leitura oficial para um programa
  de fora**: por isso o widget só ensina e abre o comando, sem inventar números.
- Os limites da sessão e semanais valem para todos os modelos juntos. Versões recentes (desde a 2.1.234) podem esperar a
  renovação do limite e continuar sozinhas (Esc cancela).
- **Trocar de conta:** `/logout`, `/exit`, reabrir e `/login` (confirme com `/help`). Só o próprio dono faz isso, à mão; o widget
  não troca nem alterna contas.
- **Chave de API:** a variável `ANTHROPIC_API_KEY`, se existir, tem prioridade sobre o login da assinatura (o Claude Code pergunta
  uma vez se aceita) e passa a **cobrar pela API**. Para voltar à assinatura, remova a variável da sessão. O widget abre as sessões
  sem ela (`ias.js`, `variavelChave`) e só a deixa passar no projeto com `"usar_api_key": true`. Nunca guarde a chave em arquivo do
  projeto: use as variáveis de ambiente do usuário do Windows.
- **Pausar e continuar:** a pausa grava o estado no cérebro e a retomada abre uma sessão nova lendo-o (o `--continue` continua
  disponível no cartão para quem quer a mesma conversa).

## Modo não interativo: `claude -p` (importador, fase 5.2)

Conferido no `claude --help` da 2.1.292 (2026-10-28):

- `-p, --print` responde e sai. A conversa pode vir pela entrada padrão; `--output-format json` devolve um objeto com `result`,
  `is_error`, `total_cost_usd` e `usage` (`input_tokens`, `output_tokens`, cache): é de onde o importador tira os tokens gastos.
- `--tools ""` desliga todas as ferramentas; `--disable-slash-commands` desliga as skills; `--no-session-persistence` não grava a sessão;
  `--strict-mcp-config` (sem `--mcp-config`) não carrega MCP; `--system-prompt` troca o prompt padrão (só com `-p`, vale a sessão toda).
- `--bare` pula hooks, plugins e CLAUDE.md, **mas só autentica por `ANTHROPIC_API_KEY`** (nunca lê o login da assinatura): por isso o
  importador não o usa. Não existe `--system-prompt-file` nesta versão (o prompt vai como argumento; em `.cmd`/`.bat`, junto da entrada).
- Erro de limite de uso, de login ou de chave aparece em `result` (com `is_error: true`) e/ou no stderr, com saída diferente de 0; o
  importador classifica por texto e **para** em vez de tentar de novo.
- Verificado sem gastar nada: com uma chave de API inválida de propósito o comando é aceito e termina em
  `Invalid API key · Fix external API key` (erro de autenticação, nenhuma conversa enviada).
