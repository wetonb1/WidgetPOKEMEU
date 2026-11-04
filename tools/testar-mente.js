// tools/testar-mente.js — testes da inteligência do grafo (app/mente.js), sem abrir o widget. Uso: npm run testar-mente
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const mente = require('../app/mente.js');

const nos = [
  { id: 'p:a', t: 'p', n: 'Alfa', p: 'alfa' },
  { id: 'p:b', t: 'p', n: 'Beta', p: 'beta' },
  { id: 'p:c', t: 'p', n: 'Gama', p: 'gama' },
  { id: 'c:1', t: 'c', n: 'pdf e blender', p: 'alfa', d: '2026-10-01', k: ['pdf', 'blender', 'alfa'] },
  { id: 'c:2', t: 'c', n: 'pdf e n8n', p: 'alfa', d: '2026-10-02', k: ['pdf', 'n8n'] },
  { id: 'c:3', t: 'c', n: 'blender e pdf', p: 'beta', d: '2026-10-20', k: ['pdf', 'blender', 'mao'] },
  { id: 'c:4', t: 'c', n: 'solitaria de video', p: 'gama', d: '2026-10-21', k: ['video'] },
  { id: 'e:5', t: 'e', n: 'estado video mao', p: 'beta', d: '2026-10-22', k: ['diferente'] },
];
const ligs = [[3, 0, 1, 'p'], [4, 0, 1, 'p'], [5, 1, 1, 'p'], [7, 1, 1, 'p'], [6, 2, 1, 'p'], [3, 4, 2, 'k'], [3, 5, 2, 'k']];

const r = mente.analisar(nos, ligs);
assert.strictEqual(r.rel.length, nos.length);
assert.ok(r.rel.every((v) => v >= 0 && v <= 1), 'relevância entre 0 e 1');
assert.strictEqual(r.rel[0], 1, 'projeto fica no topo');
assert.strictEqual(nos[r.centrais[0]].id, 'c:1', 'o arquivo com mais ligações é o mais central');
assert.deepStrictEqual(mente.analisar(nos, ligs).com, r.com, 'os temas são determinísticos');
assert.ok(!r.conceitos.some((c) => c.termo === 'alfa'), 'o nome do próprio projeto não conta como conceito');
assert.deepStrictEqual(r.conceitos.map((c) => c.termo), ['pdf', 'blender'], 'mesmo nº de projetos: vem antes o que aparece em mais arquivos');
assert.deepStrictEqual(r.pontes.map((p) => p.projetos), [['alfa', 'beta']], 'ponte entre projetos');
assert.ok(r.pontes[0].via.includes('pdf'), 'a ponte diz por qual palavra passa');
assert.deepStrictEqual(r.solitarias.map((i) => nos[i].id), ['c:4', 'e:5'], 'sem ligação de palavra');
assert.deepStrictEqual(r.ilhas.map((i) => nos[i].id), ['p:c'], 'projeto sem ponte é ilha');
assert.ok(r.sintese.length >= 3 && r.sintese.every((s) => typeof s === 'string' && s.endsWith('.')));
assert.strictEqual(nos[r.adormecidas[0]].id, 'c:1', 'antiga e muito ligada');

const par = mente.parecidas(nos, r.mapa, 3);
assert.strictEqual(nos[par[0].j].id, 'c:3', 'dois termos em comum vencem um');
assert.deepStrictEqual(par[0].comum.sort(), ['blender', 'pdf']);

assert.deepStrictEqual(mente.caminho(nos.length, ligs, 4, 5), [4, 3, 5], 'prefere palavras a passar pelo projeto');
assert.deepStrictEqual(mente.caminho(nos.length, ligs, 3, 3), [3]);
assert.deepStrictEqual(mente.caminho(nos.length, ligs, 3, 6), [], 'sem caminho devolve vazio');

const o = mente.onda(nos.length, r.viz, 3, 2);
assert.strictEqual(o.saltos[3], 0);
assert.strictEqual(o.saltos[5], 1);
assert.strictEqual(o.saltos[1], 2);
assert.strictEqual(o.saltos[6], -1, 'fora do alcance');
assert.ok(mente.onda(nos.length, r.viz, 3, 3, 2).arestas.length <= 2, 'respeita o teto de faíscas');

assert.ok(r.explorar.some((e) => nos[e.a].id !== nos[e.b].id && nos[e.a].p !== nos[e.b].p), 'sugere ligação entre projetos');
assert.ok(r.explorar.every((e) => e.comum.length));

const comK = mente.comConceitos({ nos, ligacoes: ligs });
assert.strictEqual(comK.nos.filter((n) => n.t === 'k').length, 2, 'só palavras repetidas viram nó');
assert.strictEqual(nos.length, 8, 'não mexe nos dados originais');
assert.ok(comK.ligacoes.every(([a, b]) => comK.nos[a] && comK.nos[b]));

assert.deepStrictEqual(mente.analisar([], []).temas, [], 'cérebro vazio não quebra');

// o cérebro de verdade: não pode quebrar e precisa dar a resposta em tempo de clique
const raiz = path.join(__dirname, '..');
const real = JSON.parse(execFileSync('python', ['-X', 'utf8', path.join(raiz, 'cerebro', 'tools', 'grafo.py'), '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
const t0 = process.hrtime.bigint();
const a = mente.analisar(real.nos, real.ligacoes);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`cérebro real: ${real.nos.length} nós, ${a.temas.length} temas, ${a.pontes.length} pontes, ${ms.toFixed(1)} ms`);
a.sintese.forEach((s) => console.log('  ' + s));

// pior caso previsto: 4.000 arquivos
const grandes = Array.from({ length: 4000 }, (_, i) => ({ id: 'c' + i, t: 'c', n: 'nota ' + i, p: 'p' + (i % 20), d: '2026-01-01', k: ['k' + (i % 300), 't' + (i % 170)] }));
const ligGrandes = grandes.slice(1).map((_, i) => [i + 1, Math.floor(i / 3), 1, 'k']);
const t1 = process.hrtime.bigint();
mente.analisar(grandes, ligGrandes);
const msG = Number(process.hrtime.bigint() - t1) / 1e6;
console.log(`pior caso: 4.000 nós em ${msG.toFixed(0)} ms`);
assert.ok(msG < 1500, 'precisa caber em ~1 s no pior caso');

console.log('ok: mente');
