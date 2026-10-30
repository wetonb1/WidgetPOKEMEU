// Teste da leitura da tela do /usage (app/uso-tela.js), com textos tirados do Claude Code de verdade. uso: npm run testar-uso-tela
const assert = require('assert');
const { extrairUso } = require('../app/uso-tela');

let falhas = 0;
const teste = (nome, fn) => { try { fn(); console.log('ok    ' + nome); } catch (e) { falhas++; console.log('FALHOU ' + nome + '\n      ' + e.message.split('\n')[0]); } };

// o que o xterm mostra (cada linha da tela) depois do /usage
const TELA = `
  Settings   Status   Config   Usage   Stats

  Session
  Total cost:            $0.0000
  Usage:                 0 input, 0 output, 0 cache read, 0 cache write

  Current session
  █████████████████                                  34% used
  Resets 10:50pm (America/Sao_Paulo)

  Current week (all models)
  █████████████████████████████████████▌             75% used
  Resets Nov 2, 10am (America/Sao_Paulo)

  What's contributing to your limits usage?
  Approximate, based on local sessions on this machine
  Esc to cancel
`;

teste('lê a sessão atual e a semana, com a hora em que reiniciam', () => {
  assert.deepStrictEqual(extrairUso(TELA), [
    { nome: 'Sessão atual', pct: 34, reinicia: '10:50pm' },
    { nome: 'Semana (todos os modelos)', pct: 75, reinicia: 'Nov 2, 10am' },
  ]);
});
teste('com as barras coladas no texto (como o terminal estreito mostra)', () => {
  const r = extrairUso('Current session\n█████████ 8% used\nResets 3am (UTC)\nCurrent week (Sonnet only)\n███ 41% used\n');
  assert.deepStrictEqual(r, [{ nome: 'Sessão atual', pct: 8, reinicia: '3am' }, { nome: 'Semana (Sonnet)', pct: 41, reinicia: '' }]);
});
teste('sem a linha "Resets": o medidor vem só com a porcentagem', () => {
  assert.deepStrictEqual(extrairUso('Current session\n50% used\n'), [{ nome: 'Sessão atual', pct: 50, reinicia: '' }]);
});
teste('o mesmo medidor aparecendo de novo (a tela redesenha) vale uma vez só, com o valor mais novo', () => {
  const r = extrairUso('Current session\n10% used\nResets 1am\n\nCurrent session\n12% used\nResets 1am\n');
  assert.deepStrictEqual(r, [{ nome: 'Sessão atual', pct: 12, reinicia: '1am' }]);
});
teste('uma tela que não é a do /usage não dá medidor nenhum', () => {
  assert.deepStrictEqual(extrairUso('❯ Try "create a util logging.py"\n⏵⏵ auto mode on'), []);
  assert.deepStrictEqual(extrairUso(''), []);
  assert.deepStrictEqual(extrairUso(null), []);
});
teste('porcentagem acima de 100 vira 100; um nome desconhecido fica como o Claude escreveu', () => {
  assert.deepStrictEqual(extrairUso('Extra usage\n130% used\n'), [{ nome: 'Extra usage', pct: 100, reinicia: '' }]);
});
teste('no máximo 4 medidores', () => {
  const t = [1, 2, 3, 4, 5, 6].map((i) => `Limite ${i}\n${i * 10}% used\n`).join('\n');
  assert.strictEqual(extrairUso(t).length, 4);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
