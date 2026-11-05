// Executa o colarPrint de verdade (recortado do app/renderer.js) com um terminal de mentira. Pega o que o "node --check" não vê,
// como variável sem declaração, e confere as mensagens do selo. Não usa Electron nem a área de transferência.
//   npm run testar-colar
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
const inicio = fonte.indexOf('function colarPrint(');
assert.ok(inicio >= 0, 'não achei o colarPrint');
let fim = fonte.indexOf('{', inicio);
for (let nivel = 0; fim < fonte.length; fim++) {
  if (fonte[fim] === '{') nivel++;
  if (fonte[fim] === '}' && --nivel === 0) break;
}
const codigo = fonte.slice(inicio, fim + 1);
const IMAGEM = 'C:\\tmp\\print-1.png';

// roda até o selo parar de mudar; "tela(quantas vezes já leu)" devolve o que o terminal mostra naquela leitura
function colar({ ia, tela }) {
  const entrada = []; const colado = []; const selos = []; const fila = [];
  let leituras = 0;
  const ctx = vm.createContext({
    window: { widget: { termEntrada: (_id, t) => entrada.push(t) } },
    textoDaTela: () => tela(leituras++, colado),
    seloColagem: (t) => selos.push(t),
    setTimeout: (fn) => fila.push(fn),
  });
  ctx.term = { paste: (t) => colado.push(t) };
  vm.runInContext(`${codigo};colarPrint(term, 1, ${JSON.stringify(ia)}, { bytes: 2048, largura: 320, altura: 120, imagem: ${JSON.stringify(IMAGEM)} })`, ctx);
  while (fila.length) fila.shift()();
  return { entrada, colado, selo: selos[selos.length - 1] };
}

let n = 0;
const teste = (nome, fn) => {
  try { fn(); n++; console.log('ok   ' + nome); } catch (e) { console.log('FALHOU ' + nome + '\n  ' + e.message); process.exitCode = 1; }
};

teste('Claude: Alt+V e [Image #1] confirmado', () => {
  const r = colar({ ia: 'claude', tela: (i) => (i < 2 ? '> ' : '> [Image #1]') });
  assert.deepStrictEqual(r.entrada, ['\x1bv']);
  assert.deepStrictEqual(r.colado, []);
  assert.match(r.selo, /Print anexado/);
});
teste('agy: Alt+V e contador "1 media attached" confirmado', () => {
  const r = colar({ ia: 'antigravity', tela: (i) => (i < 2 ? '> ' : '▸ 📎 1 media attached (clipboard, 1 KB, image/png)\n> ') });
  assert.deepStrictEqual(r.entrada, ['\x1bv']);
  assert.deepStrictEqual(r.colado, []);
  assert.match(r.selo, /Print anexado/);
});
teste('agy: um segundo print sobe o contador', () => {
  const r = colar({ ia: 'antigravity', tela: (i) => (i < 2 ? '1 media attached' : '2 media attached') });
  assert.match(r.selo, /Print anexado/);
});
teste('agy aberto à mão num PowerShell: reconhecido pela tela', () => {
  const r = colar({ ia: '', tela: (i) => 'Antigravity CLI 1.5.0\n' + (i < 2 ? '' : '1 media attached') });
  assert.deepStrictEqual(r.entrada, ['\x1bv']);
  assert.match(r.selo, /Print anexado/);
});
teste('agy sem imagem: cola o caminho do PNG como plano B', () => {
  const r = colar({
    ia: 'antigravity',
    tela: (i, colado) => (colado.length ? IMAGEM : i < 2 ? '> ' : 'No image or video found in the clipboard'),
  });
  assert.deepStrictEqual(r.colado, [IMAGEM]);
  assert.match(r.selo, /Print colado no prompt/);
});
teste('outra IA: cola o caminho, sem Alt+V', () => {
  const r = colar({ ia: 'outra', tela: (_i, colado) => colado.join('') });
  assert.deepStrictEqual(r.entrada, []);
  assert.deepStrictEqual(r.colado, [IMAGEM]);
});

console.log(`\n${n} testes passaram${process.exitCode ? ' (houve falhas)' : ''}`);
