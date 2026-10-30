# tools/fixtures

Capturas REAIS de tela (sem os códigos ANSI) usadas pelos testes. Anonimizadas: caminhos viram `<projeto>`/`<usuario>`,
a conta vira `<conta>`; nada de chaves, tokens ou e-mails.

- `agy-*.txt`: Google Antigravity CLI (agy) 1.4.9, capturadas no reconhecimento da fase 10.0 (docs/antigravity.md, seção 6).
  `confianca` e `permissao` são telas de decisão (o widget nunca digita nelas); `pronto` e `depois-da-permissao` são a caixa
  de entrada esperando você; `trabalhando` é o agente ocupado.
- `agy-uso.txt`: a tela do `/usage` do agy ("Models & Quota"), recapturada na fase 10.8; mostra o que RESTA da cota. A conta é `<conta>`. É a fixture do `tools/testar-uso-tela-agy.js`.

