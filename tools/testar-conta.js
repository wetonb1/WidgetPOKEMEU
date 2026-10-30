// Testa o que a config guarda por IA sobre o uso e a troca de conta (app/conta.js). uso: npm run testar-conta
const assert = require('assert');
const { migrarAvisoConta, sanitizarUso } = require('../app/conta');

let falhas = 0;
const teste = (nome, fn) => { try { fn(); console.log('ok    ' + nome); } catch (e) { falhas++; console.log('FALHOU ' + nome + '\n      ' + e.message.split('\n')[0]); } };

teste('aviso de trocar conta: o booleano antigo migra para o Claude, sem perder o que já foi visto', () => {
  assert.deepStrictEqual(migrarAvisoConta(true), { claude: true, antigravity: false });
  assert.deepStrictEqual(migrarAvisoConta(false), { claude: false, antigravity: false });
  assert.deepStrictEqual(migrarAvisoConta(undefined), { claude: false, antigravity: false });
});

teste('aviso por IA: objeto novo é respeitado; só true de verdade vale; ids desconhecidos somem', () => {
  assert.deepStrictEqual(migrarAvisoConta({ claude: true, antigravity: true }), { claude: true, antigravity: true });
  assert.deepStrictEqual(migrarAvisoConta({ antigravity: true }), { claude: false, antigravity: true });
  assert.deepStrictEqual(migrarAvisoConta({ claude: 'true', antigravity: 1, chatgpt: true }), { claude: false, antigravity: false });
  for (const ruim of ['sim', 1, [], null]) assert.deepStrictEqual(migrarAvisoConta(ruim), { claude: false, antigravity: false });
  assert.deepStrictEqual(migrarAvisoConta(migrarAvisoConta(true)), { claude: true, antigravity: false }, 'migrar de novo não muda nada');
});

const leitura = (extra = {}) => ({ quando: '2026-10-29T12:00:00.000Z', medidores: [{ nome: 'Sessão atual', pct: 34.4, reinicia: '10:50pm' }], ...extra });

teste('última leitura do uso: o formato antigo (uma só) migra para o Claude', () => {
  assert.deepStrictEqual(sanitizarUso(leitura()), { claude: { quando: '2026-10-29T12:00:00.000Z', medidores: [{ nome: 'Sessão atual', pct: 34, reinicia: '10:50pm' }] } });
});

teste('última leitura do uso: uma por IA; o agy guarda o que RESTA com 1 casa e a marca restante', () => {
  const r = sanitizarUso({
    claude: leitura(),
    antigravity: { quando: '2026-10-29T13:00:00Z', medidores: [{ nome: 'Gemini · semana', pct: 96.84, restante: true, reinicia: '165h 2m' }] },
    chatgpt: leitura(),
  });
  assert.deepStrictEqual(Object.keys(r), ['claude', 'antigravity'], 'IA desconhecida some');
  assert.deepStrictEqual(r.antigravity.medidores, [{ nome: 'Gemini · semana', pct: 96.8, reinicia: '165h 2m', restante: true }]);
  assert.strictEqual(r.claude.medidores[0].restante, undefined);
});

teste('última leitura do uso: lixo vira vazio e nada passa do limite', () => {
  for (const ruim of [null, undefined, 5, 'x', [], { medidores: 'x' }, { claude: { quando: 'ontem', medidores: [{ nome: 'a', pct: 1 }] } }, { claude: { quando: '2026-10-29T12:00:00Z', medidores: [{ nome: '', pct: 1 }, { nome: 'a', pct: 'x' }] } }]) {
    assert.deepStrictEqual(sanitizarUso(ruim), {}, JSON.stringify(ruim));
  }
  const muitos = sanitizarUso({ antigravity: { quando: '2026-10-29T12:00:00Z', medidores: Array.from({ length: 12 }, (_, i) => ({ nome: 'm' + i, pct: 150, restante: true })) } });
  assert.strictEqual(muitos.antigravity.medidores.length, 6);
  assert.ok(muitos.antigravity.medidores.every((m) => m.pct === 100));
});

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
