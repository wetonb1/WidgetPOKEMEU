# Teste A/B manual: o cérebro compensa?

O painel **Cérebro > [economia]** estima quantos tokens o cérebro evita, mas é só uma conta feita com os logs (veja a nota na
própria tela). Este roteiro é a conferência com números **reais**: a mesma tarefa duas vezes, uma com o cérebro e outra sem, e você
anota o que o próprio Claude Code mostra. Os números vão para o formulário do painel (bloco 3), que desenha a comparação.

> Uma tarefa só não prova nada. Faça **3 tarefas diferentes**, cada uma de **2 a 3 rodadas por variante**. O painel usa a média por
> variante. Gasta uso da sua conta: escolha tarefas pequenas (10 a 15 minutos).

## 1. Escolha das tarefas

Boas tarefas dependem de contexto do projeto (decisões passadas, como as coisas foram feitas), podem ser repetidas do mesmo jeito e,
de preferência, **só respondem ou leem** (não mudam arquivos). Exemplos:

- "Explique como a aba Projetos decide se abre uma sessão nova ou pede para focar a existente, e cite os arquivos envolvidos."
- "O que ficou pendente do importador de conversas e quais foram as decisões sobre segredos?"
- "Por que o gráfico da aba Skills é feito em canvas e não com uma biblioteca?"

Escreva o **texto exato** de cada tarefa e use **o mesmo texto** nas duas variantes (copie e cole).

## 2. Regras para valer como comparação

- **Mesmo modelo** nas duas (por exemplo `--model sonnet`).
- **Sessão nova em cada rodada** (nada de `--continue`; feche a janela entre uma rodada e outra).
- **Mesmo ponto de partida do código.** Se a tarefa mexer em arquivos, volte ao estado inicial antes da próxima rodada
  (`git status` limpo; para descartar as mudanças de teste use `git restore .` só se tiver certeza de que não há nada seu pendente).
- **Alterne a ordem** para o cache e o cansaço não favorecerem um lado: com, sem, sem, com, com, sem.
- Anote a qualidade da resposta (de 1 a 5) no campo *notas*: gastar menos token não vale se a resposta ficou pior.

## 3. Variante A: COM cérebro

1. Abra o Claude **pelo widget** (aba Projects, `[▶ abrir claude]`; ele abre dentro do widget; cole a tarefa no campo de tarefa) ou rode `claude --model sonnet`
   na pasta do projeto e digite a tarefa. O projeto tem o `CLAUDE.md`, as skills e o cérebro, então a sessão consulta o cérebro.
2. Quando ele terminar, **antes de fechar**, digite `/usage` (apelidos `/cost` e `/stats`). Esse comando mostra o custo da sessão, os
   limites do plano e estatísticas de uso. Anote os números (veja a seção 5).

## 4. Variante B: SEM cérebro

O objetivo é uma sessão **sem nenhuma regra e sem nenhuma skill do cérebro**, nem as do projeto, nem as globais.

1. **Copie o projeto sem as regras e sem o cérebro**, numa pasta de teste (PowerShell):

   ```powershell
   robocopy D:\programação\widget-dev\WidgetBRAIN D:\teste-sem-cerebro /E /XD .git .claude node_modules cerebro skills-biblioteca importacoes /XF CLAUDE.md AGENTS.md
   ```

   (o `robocopy` devolve códigos de 0 a 7 quando deu certo). O código fica igual; somem as regras, as skills do projeto e o cérebro.
2. **Desligue o CLAUDE.md global** só nesta janela do PowerShell. O seu `~/.claude/CLAUDE.md` manda consultar o cérebro, e a
   documentação do Claude Code diz que `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` impede o carregamento de qualquer CLAUDE.md (de usuário, de
   projeto e a memória automática):

   ```powershell
   $env:CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1"
   ```
3. **Tire as skills globais do cérebro** (elas ficam em `~/.claude/skills` e carregariam nas duas variantes, e poderiam achar o
   cérebro pelo `~/.cerebro.json`). Pelo widget (Alt+6, escopo *global*, `[remover]`) ou na linha de comando:

   ```powershell
   cd D:\programação\widget-dev\WidgetBRAIN
   foreach ($s in "cerebro-buscar","cerebro-compactar","cerebro-titulos","cerebro-cabecalho","cerebro-ler") { python skills-biblioteca\skills.py remover $s --escopo global }
   ```

   **Depois dos testes, reinstale** (`python skills-biblioteca\skills.py instalar <nome> --escopo global`, ou Alt+6 `[instalar]`).
4. Abra o Claude **na pasta de teste** (`cd D:\teste-sem-cerebro; claude --model sonnet`) e **confira o isolamento** antes da tarefa:
   `/skills` não pode listar nenhuma `cerebro-*` e `/memory` não pode mostrar nenhum CLAUDE.md carregado.
5. Digite a **mesma tarefa**. Se, durante a resposta, ele falar de "cérebro" ou rodar `cerebro.py`, o isolamento falhou:
   **descarte a rodada**.
6. Ao terminar, digite `/usage` e anote os números, como na variante A.

## 5. O que anotar e onde

No widget: **Alt+4 (Brain) > Search > `[mais ▾]` > Economia > bloco 3**.

| Campo | O que colocar |
|---|---|
| tarefa | o texto da tarefa, **igual** nas duas variantes (o painel junta pelo texto) |
| variante | com cérebro / sem cérebro |
| tokens entrada | os tokens de entrada que o `/usage` mostrou. Se ele mostrar a leitura de cache separada, **some** à entrada e diga isso nas notas |
| tokens saída | os tokens de saída |
| US$ | o custo da sessão, se o `/usage` mostrar (opcional) |
| notas | rodada (1, 2, 3), qualidade da resposta de 1 a 5, qualquer coisa estranha |

Aceita `1.234` (milhar) e `0,35` (decimal). A cada registro o formulário já troca para a outra variante. Depois de registrar as duas,
o painel desenha as barras (verde = com cérebro, vermelho = sem) e mostra a **redução** em %. Redução negativa quer dizer que o cérebro
gastou **mais** nessa tarefa.

> Se o `/usage` da sua versão não mostrar tokens, só custo, registre o custo em US$ e, em *tokens entrada*, o total que aparecer.
> Alternativa mais precisa (opcional): `claude -p --model sonnet --output-format json "SUA TAREFA"` devolve um JSON, em geral com o
> campo `usage` (tokens de entrada, saída e cache) e `total_cost_usd`. Em `-p` o Claude não pode perguntar permissão: para a variante A
> rodar o cérebro, permita só esse comando (`--allowedTools "Bash(python *)"`). Confira no seu `claude --help`.

## 6. Como interpretar

- Compare a **redução do A/B** com os **tokens evitados (estimado)** do bloco 2. Se a estimativa diz que o cérebro evitou milhares de
  tokens e o A/B mostra que ele gastou mais, **vale o A/B**: a estimativa assume que, sem o cérebro, você reexplicaria todo o histórico.
- O cérebro tem um custo fixo (as skills no contexto e a consulta inicial). Em tarefas pequenas ele pode não compensar; o ganho aparece
  em projetos com muito histórico e em tarefas que dependem de decisões antigas.
- Refaça o teste quando mudar o cérebro (novas skills, estado reescrito, importação de conversas), para ver se melhorou ou piorou.
- Aviso: poucas rodadas têm muita variação. Não conclua nada com menos de 3 tarefas.
