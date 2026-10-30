// Teste da leitura da tela do /usage do Antigravity (app/uso-tela-agy.js), com a captura REAL anonimizada (tools/fixtures/agy-uso.txt).
// uso: npm run testar-uso-tela (roda este e o do Claude)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extrairUsoAgy } = require('../app/uso-tela-agy');
const { extrairUso } = require('../app/uso-tela');

let falhas = 0;
const teste = (nome, fn) => { try { fn(); console.log('ok    ' + nome); } catch (e) { falhas++; console.log('FALHOU ' + nome + '\n      ' + e.message.split('\n')[0]); } };
const fix = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

teste('a captura real do /usage: os 4 medidores visíveis, com o que RESTA e quando reinicia', () => {
  const m = extrairUsoAgy(fix('agy-uso.txt'));
  assert.deepStrictEqual(m.map((x) => [x.nome, x.pct, x.reinicia]), [
    ['Gemini · semana', 99, '165h 2m'], // 99,04% (arredonda a 1 casa)
    ['Gemini · 5 horas', 96.8, '2h 2m'],
    ['Claude e GPT · semana', 49.7, '165h 12m'],
    ['Claude e GPT · 5 horas', 0, '2h 12m'],
  ]);
});

teste('é o que resta (restante: true), não o que foi usado; grupo e janela separados', () => {
  const m = extrairUsoAgy(fix('agy-uso.txt'));
  assert.ok(m.every((x) => x.restante === true));
  assert.deepStrictEqual([m[0].grupo, m[0].janela, m[2].grupo, m[3].janela], ['Gemini', 'semana', 'Claude e GPT', '5 horas']);
});

teste('o grupo cortado pela rolagem (Gemini 4 Argon, sem barras na tela) não inventa números', () => {
  const m = extrairUsoAgy(fix('agy-uso.txt'));
  assert.ok(!m.some((x) => /Argon/.test(x.nome)));
});

teste('com o grupo Argon visível, entra também (mesmo formato)', () => {
  const texto = fix('agy-uso.txt').replace('GEMINI 4 ARGON\n', 'GEMINI 4 ARGON\n  Weekly Limit Remaining\n    [█████░░░░░] 12.5%\n    Refreshes in 10h 0m\n');
  const m = extrairUsoAgy(texto);
  assert.deepStrictEqual(m.at(-1), { nome: 'Gemini 4 Argon · semana', grupo: 'Gemini 4 Argon', janela: 'semana', pct: 12.5, restante: true, reinicia: '10h 0m' });
});

teste('outras telas do agy e do Claude não viram medidores', () => {
  for (const n of ['agy-pronto.txt', 'agy-trabalhando.txt', 'agy-permissao.txt', 'agy-confianca.txt', 'agy-depois-da-permissao.txt']) {
    assert.deepStrictEqual(extrairUsoAgy(fix(n)), [], n);
  }
  assert.deepStrictEqual(extrairUsoAgy('  Current session\n  █████  34% used\n  Resets 10:50pm'), [], 'a tela do /usage do Claude fica com o outro leitor');
  assert.deepStrictEqual(extrairUso(fix('agy-uso.txt')), [], 'e o leitor do Claude não lê a tela do agy');
  for (const vazio of ['', null, undefined, 42]) assert.deepStrictEqual(extrairUsoAgy(vazio), []);
});

teste('vírgula decimal, percentual acima de 100, fim de linha do Windows e grupo desconhecido', () => {
  const texto = 'NOVO GRUPO\r\n  Weekly Limit Remaining\r\n    [███] 150,25%\r\n    Refreshes in 1h 1m\r\n  Five Hour Limit Remaining\r\n    [] 7%\r\n';
  assert.deepStrictEqual(extrairUsoAgy(texto), [
    { nome: 'Novo grupo · semana', grupo: 'Novo grupo', janela: 'semana', pct: 100, restante: true, reinicia: '1h 1m' },
    { nome: 'Novo grupo · 5 horas', grupo: 'Novo grupo', janela: '5 horas', pct: 7, restante: true, reinicia: '' },
  ]);
});

teste('nunca lê a conta: a fixture está anonimizada e o leitor não devolve texto livre da tela', () => {
  assert.ok(!/@/.test(fix('agy-uso.txt')) && /Account: <conta>/.test(fix('agy-uso.txt')));
  const m = extrairUsoAgy(fix('agy-uso.txt').replace('<conta>', 'fulano@exemplo.com'));
  assert.ok(!JSON.stringify(m).includes('fulano'));
});

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
