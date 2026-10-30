// Teste do gerenciador de sessões embutidas (app/embutido.js) com um "claude" de mentira (um script node): o widget só digita o
// comando quando a caixa de entrada aparece, nunca numa tela de confirmação, e a saída chega à tela em lotes. Não usa o Claude real.
// uso: npm run testar-embutido
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarGerenciador, promptPronto } = require('../app/embutido');
const ias = require('../app/ias');
// capturas reais do agy (anonimizadas): tools/fixtures/agy-*.txt
const FIX = Object.fromEntries(['confianca', 'pronto', 'trabalhando', 'permissao', 'depois-da-permissao']
  .map((n) => [n, fs.readFileSync(path.join(__dirname, 'fixtures', `agy-${n}.txt`), 'utf8')]));

let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok    ' : 'FALHOU ') + msg); if (!cond) falhas++; };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const esperar = async (cond, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await pausa(80); } return cond(); };

// ---- 1. como reconhecer "pronto" (textos tirados do Claude Code de verdade) ----
const CAIXA = '──────────\n❯ Try "create a util logging.py that..."\n──────────\n  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents';
const CONFIANCA = ' Do you trust the files in this folder?\n ❯ 1. Yes, proceed\n   2. No, exit';
ok(promptPronto(CAIXA).pronto === true, 'a caixa de entrada com o rodapé do Claude = pronto');
ok(promptPronto(CAIXA.replace('auto mode on (shift+tab to cycle) · ← for agents', '? for shortcuts')).pronto === true, '"? for shortcuts" também vale');
ok(promptPronto('\x1b[2J\x1b[H\x1b]0;claude\x07' + CAIXA.replace(/\n/g, '\r\n')).pronto === true, 'com as sequências de cor e cursor no meio');
ok(promptPronto(CONFIANCA).pronto === false && promptPronto(CONFIANCA).bloqueado === true, 'a pergunta "confia nesta pasta?" NÃO é pronto (é bloqueio)');
ok(promptPronto(CONFIANCA + '\n' + CAIXA).pronto === true, 'depois que você responde e a caixa volta, é pronto de novo');
ok(promptPronto(CAIXA + '\n' + CONFIANCA).pronto === false, 'mas a pergunta que aparece DEPOIS da caixa bloqueia');
ok(promptPronto('Claude Code v2.1\nSelect login method:').pronto === false && promptPronto('').pronto === false, 'login e tela vazia não são pronto');

// ---- 1b. as telas do Antigravity (agy), pelas capturas reais ----
const AGY = ias.obter('antigravity').telas;
ok(promptPronto(FIX.pronto, AGY).pronto === true, 'agy: a caixa ">" com "? for shortcuts" = pronto');
ok(promptPronto(FIX.confianca, AGY).pronto === false && promptPronto(FIX.confianca, AGY).bloqueado === true, 'agy: "Do you trust the contents of this project?" é bloqueio (mesmo com o "> Yes, I trust")');
ok(promptPronto(FIX.permissao, AGY).pronto === false && promptPronto(FIX.permissao, AGY).bloqueado === true, 'agy: "Run this command?" é bloqueio');
ok(promptPronto(FIX.trabalhando, AGY).pronto === false && promptPronto(FIX.trabalhando, AGY).bloqueado === false, 'agy: trabalhando ("esc to cancel") não é pronto nem bloqueio');
ok(promptPronto(FIX['depois-da-permissao'], AGY).pronto === true, 'agy: depois de responder a permissão, a caixa volta e é pronto');
ok(promptPronto(FIX.pronto + '\n' + FIX.permissao, AGY).pronto === false, 'agy: a permissão que aparece DEPOIS da caixa bloqueia');
ok(promptPronto(FIX.pronto).pronto === false, 'as telas do Claude (padrão) NÃO reconhecem a caixa do agy (cada IA com as suas)');
ok(promptPronto(CAIXA, AGY).pronto === false, 'e as do agy não reconhecem a do Claude');
ok(promptPronto(FIX.pronto, null).pronto === false, 'sem telas: nunca pronto');

// ---- 2. gerenciador com um "claude" de mentira ----
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'embutido-teste-'));
const fake = path.join(pasta, 'fake-claude.js');
fs.writeFileSync(fake, `
const modo = process.argv[2] || 'normal';
const CAIXA = ${JSON.stringify(CAIXA)};
const CONFIANCA = ${JSON.stringify(CONFIANCA)};
const FIX = ${JSON.stringify(FIX)};
process.stdin.setRawMode && process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (d) => {
  const t = d.toString();
  console.log('RECEBIDO[' + JSON.stringify(t) + ']');
  if (modo === 'confianca' && t === '1') setTimeout(() => console.log(CAIXA), 200); // a pessoa respondeu a pergunta
  if (t === 'SAIR') process.exit(0);
});
if (modo === 'lotes') { for (let i = 0; i < 3000; i++) console.log('linha ' + i + ' ' + 'x'.repeat(60)); }
const TELA = { confianca: CONFIANCA, agy: FIX.pronto, 'agy-permissao': FIX.permissao }[modo] || CAIXA;
setTimeout(() => console.log(TELA), 800);
setInterval(() => {}, 1000);
`, 'utf8');

const eventos = [];
const g = criarGerenciador({ pastaPty: pasta, enviar: (canal, ...args) => eventos.push({ canal, args }) });
const dadosDe = (id) => Buffer.concat(eventos.filter((e) => e.canal === 'term:dados' && e.args[0] === id).map((e) => e.args[1])).toString('utf8');
const avisosDe = (id) => eventos.filter((e) => e.canal === 'term:aviso' && e.args[0] === id).map((e) => e.args[1]);
const iniciar = (modo, extra = {}) => g.iniciar({ pasta, programa: process.execPath, args: [fake, modo], env: { ...process.env }, colunas: 100, linhas: 30, ...extra });

(async () => {
  // normal: o comando é digitado só quando a caixa aparece (texto, pausa, Enter)
  const t0 = Date.now();
  const a = await iniciar('normal', { comandoInicial: '/usage' });
  ok(a && a.termId && Number.isInteger(a.iaPid) && g.existe(a.termId), 'iniciar devolve o id do terminal e o PID do programa');
  const antes = g.anexar(a.termId);
  ok(Buffer.isBuffer(antes), 'anexar entrega o que já saiu (o começo da saída não se perde)');
  ok(await esperar(() => avisosDe(a.termId).includes('digitado')), 'o comando foi digitado sozinho');
  ok(Date.now() - t0 > 900, 'e só depois da caixa de entrada aparecer (' + (Date.now() - t0) + ' ms)');
  ok(await esperar(() => /RECEBIDO\[\"\/usage\"\]/.test(dadosDe(a.termId)) && /RECEBIDO\[\"\\r\"\]/.test(dadosDe(a.termId))), 'o programa recebeu "/usage" e, separado, o Enter');
  ok(dadosDe(a.termId).indexOf('RECEBIDO["/usage"]') < dadosDe(a.termId).indexOf('RECEBIDO["\\r"]'), 'nessa ordem (texto, depois Enter)');
  ok(a.termId && g.comando(a.termId, '/usage') === true, 'pedir de novo é aceito (um novo pedido substitui o anterior)');
  g.entrada(a.termId, 'SAIR');
  ok(await esperar(() => eventos.some((e) => e.canal === 'term:fim' && e.args[0] === a.termId)), 'quando o programa sai, o fim é avisado à tela');

  // confiança: nada é digitado enquanto a pergunta está na tela; quando a pessoa responde, aí sim
  const b = await iniciar('confianca', { comandoInicial: '/usage' });
  g.anexar(b.termId);
  ok(await esperar(() => avisosDe(b.termId).includes('confirmacao'), 8000), 'numa tela de confirmação o widget avisa e espera');
  await pausa(2500);
  ok(!/RECEBIDO/.test(dadosDe(b.termId)) && !avisosDe(b.termId).includes('digitado'), 'e não digita nem aperta nada (nem Enter)');
  g.entrada(b.termId, '1'); // a pessoa responde
  ok(await esperar(() => avisosDe(b.termId).includes('digitado'), 8000), 'depois que a pessoa responde e a caixa volta, o comando é digitado');
  g.entrada(b.termId, 'SAIR');
  await esperar(() => !g.existe(b.termId));

  // lotes: 3000 linhas viram poucos envios
  const c = await iniciar('lotes');
  g.anexar(c.termId);
  await esperar(() => /linha 2999/.test(dadosDe(c.termId)), 15000);
  const envios = eventos.filter((e) => e.canal === 'term:dados' && e.args[0] === c.termId).length;
  ok(/linha 2999/.test(dadosDe(c.termId)) && envios < 400, `a saída grande vai em lotes (${envios} envios para 3000 linhas)`);

  // entrada e tamanho de terminal que não existe: ignorados sem erro
  g.entrada('nao-existe', 'x'); g.tamanho('nao-existe', 80, 24);
  ok(g.anexar('nao-existe') === null && g.comando('nao-existe', '/usage') === false && g.existe('nao-existe') === false, 'ids que não existem são ignorados');

  // encerrar tudo
  const d = await iniciar('normal');
  g.encerrarTodos();
  ok(await esperar(() => !g.existe(d.termId) && !g.existe(c.termId), 8000), 'encerrarTodos fecha todas as sessões');

  // agy: as telas DELE decidem; digita na caixa ">" e nunca na pergunta de permissão
  const ag = await iniciar('agy', { ia: 'antigravity', comandoInicial: '/usage' });
  g.anexar(ag.termId);
  ok(ag.comandoAceito === true && g.iaDe(ag.termId) === 'antigravity', 'a sessão guarda a sua IA (antigravity) e aceita o comando');
  ok(await esperar(() => avisosDe(ag.termId).includes('digitado')), 'agy: digita quando aparece a caixa de entrada dele');
  ok(await esperar(() => /RECEBIDO\[\"\/usage\"\]/.test(dadosDe(ag.termId))), 'e o programa recebe o /usage');
  g.entrada(ag.termId, 'SAIR');
  const ap = await iniciar('agy-permissao', { ia: 'antigravity', comandoInicial: '/usage' });
  g.anexar(ap.termId);
  ok(await esperar(() => avisosDe(ap.termId).includes('confirmacao'), 8000), 'agy: na pergunta "Run this command?" avisa e espera');
  await pausa(2000);
  ok(!/RECEBIDO/.test(dadosDe(ap.termId)), 'e não digita nem aperta nada');
  g.entrada(ap.termId, 'SAIR');
  // uma IA sem telas confirmadas: o widget nunca digita (quem chamou põe na área de transferência)
  const iaAgy = ias.obter('antigravity');
  const telas = iaAgy.telas;
  iaAgy.telas = null;
  try {
    const st = await iniciar('agy', { ia: 'antigravity', comandoInicial: 'prompt do cérebro' });
    g.anexar(st.termId);
    ok(st.comandoAceito === false && g.comando(st.termId, '/usage') === false, 'IA sem telas: comandoAceito false e comando() recusa');
    await pausa(2500);
    ok(!/RECEBIDO/.test(dadosDe(st.termId)) && !avisosDe(st.termId).length, 'nada é digitado, nem aviso');
    g.entrada(st.termId, 'SAIR');
  } finally { iaAgy.telas = telas; }
  const semIa = await iniciar('normal', { comandoInicial: '/usage' });
  ok(g.iaDe(semIa.termId) === 'claude', 'sem dizer a IA: é o Claude (como sempre foi)');
  g.entrada(semIa.termId, 'SAIR');

  // programa que não existe: erro claro
  const e = await g.iniciar({ pasta, programa: 'C:\\nao\\existe\\xyz.exe', args: [], env: process.env });
  ok(e && /CreateProcess|iniciar/.test(e.erro || ''), 'programa inexistente: devolve um erro em vez de abrir uma sessão fantasma (' + (e && e.erro) + ')');

  fs.rmSync(pasta, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('ERRO DO TESTE:', e.stack); process.exit(1); });
