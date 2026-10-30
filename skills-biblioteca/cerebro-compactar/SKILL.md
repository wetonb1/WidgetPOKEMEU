---
name: cerebro-compactar
description: "Use quando o dono pedir para compactar, resumir ou salvar a conversa/sessão no cérebro: grava um resumo minúsculo com cerebro.py salvar e atualiza o estado do projeto se ele mudou."
---

# Cérebro: compactar a sessão

**Regra:** não abra os arquivos do cérebro direto; use sempre o cerebro.py, rodado na ferramenta de terminal, que lê só o necessário.

1. Releia a conversa e extraia SÓ o que vale no futuro: decisões tomadas pelo dono, estado do
   trabalho, pendências, erros e soluções, comandos ou trechos de código essenciais (máx. 15 linhas).
   Ignore cumprimentos, tentativas descartadas e explicações genéricas.
   Se nada disso existir, responda só `nada para compactar` e pare.
2. Escreva um título descritivo de 3 a 6 palavras e de 5 a 10 palavras-chave
   (inclua o nome do projeto, a tecnologia e o tema).
3. Corpo: no máximo 12 tópicos ou 150 palavras, frases curtas, sem enrolação.
4. Nunca salve senhas, tokens de API, e-mails de terceiros ou dados pessoais sensíveis:
   troque por `[removido]`. O salvar também recusa o que parecer segredo.
5. Salve passando o corpo pela entrada padrão do terminal (num shell estilo bash, com heredoc, que mantém o UTF-8):
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" salvar --titulo "busca em tres niveis" --palavras "meu-widget,cerebro,python,busca,tokens" --origem claude-code --projeto meu-widget <<'FIM'
   - Decidido: o buscar nunca abre arquivo inteiro.
   - Pendente: medir a economia na fase 6.
   FIM
   ```
   No PowerShell (sem heredoc): `$OutputEncoding = [Text.UTF8Encoding]::new($false)` e depois
   `@'...'@ | python ...`. Se vier `recusado: ...`, corrija o que a linha diz e salve de novo.
6. Se o estado do projeto mudou, leia o atual (`cerebro.py ler estado/meu-widget.md`), reescreva-o
   inteiro (o comando sobrescreve; a versão anterior é guardada sozinha) e salve com `--estado`:
   ```
   python "{CAMINHO_CEREBRO}/tools/cerebro.py" salvar --projeto meu-widget --estado <<'FIM'
   ## Objetivo
   ## Stack
   ## Decisões
   ## Estado atual
   ## Próximos passos
   ## Armadilhas
   FIM
   ```
   As 6 seções são obrigatórias, com no máximo 300 palavras no total.
7. Responda ao dono só: o nome do arquivo salvo e as palavras-chave.
