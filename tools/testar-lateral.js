// Teste de tela do terminal lateral da aba Projects: abre o widget de verdade (Electron, em pastas temporárias; nunca toca na sua config, no seu
// cérebro nem no widget que você deixou aberto) com um "claude" de mentira. Confere: [▶ abrir claude] abre direto, sem perguntar tarefa e sem
// prompt inicial, e o terminal aparece num painel LATERAL, ao lado da lista de projetos.   uso: npm run testar-lateral [cmd|ios]
// Salva capturas em %TEMP%\testar-lateral-*.png para você olhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync, execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const estilo = process.argv[2] === 'ios' ? 'ios' : 'cmd';
const janela = estilo === 'cmd' ? { largura: 720, altura: 320 } : { largura: 1100, altura: 680 };
const PORTA = 9360 + (estilo === 'ios' ? 1 : 0);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'ok    ' : 'FALHOU ') + m); if (!c) falhas++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lateral-'));
  const cerebroDir = path.join(tmp, 'cerebro');
  for (const d of ['conversas', 'estado', '.log']) fs.mkdirSync(path.join(cerebroDir, d), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'widget'));
  fs.writeFileSync(path.join(tmp, 'cerebro.json'), JSON.stringify({ cerebro_dir: cerebroDir }), 'utf8');
  fs.writeFileSync(path.join(tmp, 'widget', 'config.json'), JSON.stringify({ pokemon: 'cubone', pokemonEscolhido: true, estilo, janela, aba: 'music', appsSemeados: true, boasVindas: { ativo: false, voz: false } }), 'utf8');
  const falso = path.join(tmp, 'falso-bin');
  fs.mkdirSync(falso);
  const LOG = path.join(tmp, 'fake-log.txt');
  fs.writeFileSync(path.join(falso, 'fake.js'), `
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_LOG, 'ARGS ' + JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('CLAUDE FALSO ' + process.argv.slice(2).join(' '));
setTimeout(() => { console.log('❯ Try "algo"'); console.log('  ⏵⏵ auto mode on (shift+tab to cycle)'); }, 600);
process.stdin.setRawMode && process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (d) => { fs.appendFileSync(process.env.FAKE_LOG, 'IN ' + JSON.stringify(d.toString()) + '\\n'); console.log('RECEBIDO ' + JSON.stringify(d.toString())); });
setInterval(() => {}, 1000);
`, 'utf8');
  fs.writeFileSync(path.join(falso, 'claude.cmd'), '@echo off\r\n"%FAKE_NODE%" "%FAKE_JS%" %*\r\n', 'utf8');
  fs.writeFileSync(path.join(falso, 'agy.cmd'), '@echo off\r\n"%FAKE_NODE%" "%FAKE_JS%" %*\r\n', 'utf8'); // o mesmo programa de mentira, chamado de agy
  const env = { ...process.env, PATH: falso + path.delimiter + process.env.PATH, FAKE_NODE: process.execPath, FAKE_JS: path.join(falso, 'fake.js'), FAKE_LOG: LOG,
    CEREBRO_CONFIG: path.join(tmp, 'cerebro.json'), CEREBRO_DIR: cerebroDir, PROJETOS_JSON: path.join(tmp, 'projetos.json'),
    MEU_WIDGET_PASTA: path.join(tmp, 'widget'), MEU_WIDGET_SESSOES: path.join(tmp, 'widget', 'sessoes.json') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ANTHROPIC_API_KEY;
  const pastaProj = path.join(tmp, 'Jogo Roblox');
  fs.mkdirSync(pastaProj);
  execFileSync('python', ['-X', 'utf8', 'cerebro/tools/projetos.py', 'adicionar', '--json'], { cwd: REPO, env, input: JSON.stringify({ nome: 'Jogo Roblox', id: 'jogo', pasta: pastaProj, cor: '#ff6b6b', modelo_padrao: 'sonnet' }), encoding: 'utf8' });

  // um segundo projeto, este com o Antigravity (agy) como IA padrão e o Claude como reserva
  const pastaAgy = path.join(tmp, 'Site com agy');
  fs.mkdirSync(pastaAgy);
  execFileSync('python', ['-X', 'utf8', 'cerebro/tools/projetos.py', 'adicionar', '--json'], { cwd: REPO, env, input: JSON.stringify({ nome: 'Site com agy', id: 'site', pasta: pastaAgy, cor: '#3ddc84', ia: 'antigravity', ia_reserva: 'claude' }), encoding: 'utf8' });

  const filho = spawn(require(path.join(REPO, 'node_modules', 'electron')), ['.', '--remote-debugging-port=' + PORTA], { cwd: REPO, env, stdio: 'ignore' });
  let ws; let id = 0; const pend = new Map();
  const enviar = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expr) => { const r = await enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const foto = async (nome) => { const r = await enviar('Page.captureScreenshot', { format: 'png' }); const f = path.join(os.tmpdir(), `testar-lateral-${estilo}-${nome}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  [captura]', f); };
  const aguardar = async (cond, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await pausa(200); } return cond(); };
  const caixa = (s) => ev(`(() => { const r = document.querySelector(${JSON.stringify(s)}).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  const visivel = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); return !!e && e.offsetParent !== null; })()`);
  try {
    for (let i = 0; i < 60 && !ws; i++) {
      try {
        const alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json();
        const p = alvos.find((a) => a.type === 'page' && /index\.html/.test(a.url));
        if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const q = pend.get(d.id); pend.delete(d.id); d.error ? q.rej(new Error(d.error.message)) : q.res(d.result); } }; }
      } catch { /* ainda subindo */ }
      if (!ws) await pausa(500);
    }
    if (!ws) throw new Error('não conectou ao widget');
    await enviar('Runtime.enable');
    await pausa(5000);
    console.log(`estilo=${estilo} janela=${await ev('innerWidth + "x" + innerHeight')}`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', altKey: true, bubbles: true }))`);
    await pausa(1500);
    ok((await ev(`document.querySelectorAll('.proj-cartao').length`)) === 2, 'Projects mostra os dois cartões (Claude e Antigravity)');
    await foto('1-antes');

    // ---- abrir direto, sem tarefa, sem prompt ----
    await ev(`document.querySelector('.proj-abrir').click()`);
    ok(await aguardar(async () => await ev(`document.getElementById('aba-projetos').classList.contains('terminal')`)), '[▶ abrir claude] abre o terminal na hora');
    ok(!(await visivel('#pa-form')), 'sem a janelinha de tarefa (nada para escrever antes)');
    ok(await aguardar(async () => fs.existsSync(LOG) && /ARGS/.test(fs.readFileSync(LOG, 'utf8'))), 'o Claude (de mentira) foi aberto');
    const args = JSON.parse(/ARGS (.*)/.exec(fs.readFileSync(LOG, 'utf8'))[1]);
    ok(JSON.stringify(args) === JSON.stringify(['--model', 'sonnet']), 'só com o modelo escolhido, SEM prompt inicial (' + JSON.stringify(args) + ')');
    const tela = () => ev(`(document.querySelector('.et-term.ativo .xterm-rows') || { textContent: '' }).textContent`);
    ok(await aguardar(async () => /shift\+tab/.test(await tela()), 15000), 'a caixa de entrada aparece, pronta para você digitar');

    // ---- painel lateral ----
    await pausa(600);
    const L = await caixa('#proj-lista'); const T = await caixa('#et-corpo');
    ok(await visivel('#proj-lista') && L[0] + L[2] <= T[0] + 2, `o terminal é um painel LATERAL: a lista fica ao lado (lista termina em x=${Math.round(L[0] + L[2])}, terminal começa em x=${Math.round(T[0])})`);
    ok(Math.abs(L[1] - T[1]) < 80 || T[1] < L[1] + 80, 'os dois painéis ficam lado a lado na mesma altura');
    const estreito = janela.largura < 1000;
    ok((await ev(`document.getElementById('cartao').classList.contains('term-largo')`)) === estreito, estreito ? 'janela estreita: o Pokémon se esconde sozinho para dar espaço' : 'janela larga: o Pokémon continua à vista');
    await foto('2-lateral');
    await ev(`document.querySelector('.et-term.ativo .xterm-helper-textarea').focus()`);
    await enviar('Input.dispatchKeyEvent', { type: 'char', text: 'o' });
    ok(await aguardar(async () => /IN "o"/.test(fs.readFileSync(LOG, 'utf8')), 8000), 'dá para digitar direto no painel (a tecla chega ao Claude)');
    // ---- colar: Ctrl+V, Shift+Insert e botão direito (usa a área de transferência do Windows, que este teste troca por um texto seu) ----
    const colado = async (rotulo, disparar, texto) => {
      await ev(`window.widget.cerebroCopiar(${JSON.stringify(texto)})`);
      await disparar();
      ok(await aguardar(async () => fs.readFileSync(LOG, 'utf8').includes(texto), 8000), `${rotulo} cola o texto no Claude`);
    };
    const tecla = (key, code, vk, modifiers) => async () => { await enviar('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers }); await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }); };
    await colado('Ctrl+V', tecla('v', 'KeyV', 86, 2), 'COLADO-CTRL-V');
    ok(fs.readFileSync(LOG, 'utf8').split('COLADO-CTRL-V').length === 2, 'e cola UMA vez só (não duplica)');
    await colado('Shift+Insert', tecla('Insert', 'Insert', 45, 8), 'COLADO-SHIFT-INS');
    await colado('botão direito', () => ev(`document.querySelector('.et-term.ativo').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`), 'COLADO-DIREITO');
    await ev(`document.getElementById('et-ampliar').click()`);
    await pausa(500);
    ok((await ev(`document.getElementById('cartao').classList.contains('term-largo')`)) === !estreito, '[ampliar]/[reduzir] inverte o Pokémon');
    await ev(`document.getElementById('et-ampliar').click()`);

    // ---- esconder e voltar ----
    await ev(`document.getElementById('et-voltar').click()`);
    await pausa(500);
    ok(!(await visivel('#et-corpo')) && await visivel('#proj-lista'), '[esconder] recolhe o painel (a lista volta a ocupar tudo)');
    const L2 = await caixa('#proj-lista');
    ok(L2[2] > L[2] + 40, 'e a lista fica mais larga de novo');
    ok(await aguardar(async () => (await ev(`document.querySelectorAll('#ps-lista .ps-linha').length`)) === 1), 'a sessão continua em "sessões ativas"');
    await ev(`document.querySelector('#ps-lista .ps-linha button').click()`);
    ok(await aguardar(async () => await visivel('#et-corpo')), '[abrir] traz o painel de volta');
    await foto('3-de-volta');

    // ---- a tela de uso continua funcionando com o painel aberto ----
    await ev(`document.getElementById('proj-uso-abrir').click()`);
    await pausa(800);
    ok(await visivel('#proj-uso') && !(await visivel('#et-corpo')), '"uso e continuidade" ocupa a tela e o painel sai da frente');
    await ev(`document.getElementById('pu-voltar').click()`);
    await pausa(500);
    ok(await visivel('#et-corpo') && await visivel('#proj-lista'), 'ao voltar, o painel lateral e a lista estão de novo lado a lado');
    // o registro da sessão: abrir vazio conta como sessão de trabalho (não é "só ver o uso")
    const log = path.join(cerebroDir, '.log', 'sessoes.jsonl');
    const ultima = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop());
    ok(!ultima.motivo, 'a sessão aberta vazia entra na contagem local (sem motivo "uso"): ' + JSON.stringify(ultima));

    // ================= 10.3: várias IAs na mesma tela =================
    await ev(`document.getElementById('et-voltar').click()`);
    await pausa(300);
    const cartao = (id) => `[...document.querySelectorAll('.proj-cartao')].find(c => c.querySelector('.proj-id').textContent === '${id}')`;
    const texto = (id, sel) => ev(`${cartao(id)}.querySelector(${JSON.stringify(sel)}).textContent`);
    const botoes = (id) => ev(`[...${cartao(id)}.querySelectorAll('button')].map(b => ({ t: b.textContent.trim(), off: b.disabled, dica: b.title }))`);
    const clicarIA = (id, nome) => ev(`[...${cartao(id)}.querySelectorAll('.proj-ias .proj-pill')].find(x => x.textContent === ${JSON.stringify(nome)}).click()`);
    ok(/abrir claude/.test(await texto('jogo', '.proj-abrir')) && /abrir agy/.test(await texto('site', '.proj-abrir')), 'o botão principal diz a IA: [▶ abrir claude] / [▶ abrir agy]');
    ok((await ev(`${cartao('jogo')}.querySelectorAll('.proj-ias .proj-pill').length`)) === 2 && (await ev(`${cartao('jogo')}.querySelector('.proj-ias .proj-pill.ativa').textContent`)) === 'Claude' && (await ev(`${cartao('site')}.querySelector('.proj-ias .proj-pill.ativa').textContent`)) === 'Antigravity', 'o seletor de IA tem Claude e Antigravity, com a IA padrão do projeto marcada');
    ok((await ev(`[...${cartao('jogo')}.querySelectorAll('select.proj-select option')].map(o => o.value).join()`)) === 'sonnet,opus,haiku' && (await ev(`${cartao('jogo')}.querySelector('select.proj-select').value`)) === 'sonnet', 'Claude: modelos na lista suspensa igual ao Antigravity (sonnet, opus, haiku)');
    ok((await ev(`[...${cartao('site')}.querySelectorAll('select.proj-select option')].map(o => o.value).join()`)) === 'gemini-3.8-flash-medium,gemini-3.8-flash-low,gemini-3.8-flash-high,gemini-4-argon-low,gemini-4-argon-medium,gemini-4-argon-high,claude-sonnet-5-5-low,claude-sonnet-5-5-medium,claude-sonnet-5-5-high,claude-opus-5-5-low,claude-opus-5-5-medium,claude-opus-5-5-high,gpt-oss-120b-medium' && (await ev(`${cartao('site')}.querySelector('select.proj-select').value`)) === 'gemini-3.8-flash-medium', 'Antigravity: todos os 13 modelos (Gemini, Claude e GPT) numa lista, com o padrão selecionado');
    let b = await botoes('site');
    const cont = b.find((x) => /continuar última/.test(x.t));
    const ret = b.find((x) => /sessão anterior/.test(x.t));
    ok(!cont.off && /agy -c/.test(cont.dica), '[continuar última] vale no agy e o título vem da IA (agy -c)');
    ok(ret.off && /\/resume/.test(ret.dica), '[escolher sessão anterior] fica desabilitado no agy, com a dica do /resume');
    b = await botoes('jogo');
    const retClaude = b.find((x) => /sessão anterior/.test(x.t));
    ok(!retClaude.off && /claude --resume/.test(retClaude.dica), 'no Claude continua habilitado, com o título do claude --resume');
    // trocar a IA no cartão do agy para Claude: botão, modelos e suporte mudam
    await clicarIA('site', 'Claude');
    ok(/abrir claude/.test(await texto('site', '.proj-abrir')) && (await ev(`[...${cartao('site')}.querySelectorAll('select.proj-select option')].map(o => o.value).join()`)) === 'sonnet,opus,haiku' && !(await botoes('site')).find((x) => /sessão anterior/.test(x.t)).off, 'trocar para Claude no cartão: rótulo, modelos e suporte acompanham');
    await clicarIA('site', 'Antigravity');
    await foto('4-duas-ias');

    // abrir o agy: argumentos certos, selo na sessão
    await ev(`${cartao('site')}.querySelector('.proj-abrir').click()`);
    ok(await aguardar(async () => /gemini-3\.8-flash-medium/.test(fs.readFileSync(LOG, 'utf8'))), 'abrir agy: o programa recebe --model gemini-3.8-flash-medium');
    const ultimoArgs = JSON.parse([...fs.readFileSync(LOG, 'utf8').matchAll(/ARGS (.*)/g)].pop()[1]);
    ok(JSON.stringify(ultimoArgs) === JSON.stringify(['--model', 'gemini-3.8-flash-medium']), 'e só isso (sem prompt, sem permissões puladas): ' + JSON.stringify(ultimoArgs));
    ok(await aguardar(async () => (await ev(`document.querySelectorAll('.et-aba').length`)) === 2), 'o agy abre no mesmo painel lateral, numa aba nova');
    await ev(`document.getElementById('et-voltar').click()`);
    await pausa(500);
    ok(await aguardar(async () => (await ev(`document.querySelectorAll('#ps-lista .ps-ia').length`)) === 2), 'sessões ativas: cada linha com o selo da IA');
    ok((await ev(`[...document.querySelectorAll('#ps-lista .ps-ia')].map(x => x.textContent).sort().join()`)) === 'agy,claude', 'os selos são "claude" e "agy"');

    // a trava por pasta vale entre IAs: o projeto do agy já tem o agy aberto; pedir o Claude nele
    await clicarIA('site', 'Claude');
    await ev(`${cartao('site')}.querySelector('.proj-abrir').click()`);
    ok(await aguardar(async () => await visivel('#px-caixa')) && /já existe uma sessão/.test(await ev(`document.getElementById('px-titulo').textContent`)) && /agy/.test(await ev(`document.getElementById('px-texto').textContent`)), 'abrir o Claude onde o agy já está: "já existe uma sessão neste projeto" (e diz que é a do agy)');
    ok(/worktree/.test(await ev(`document.getElementById('px-botoes').textContent`)), 'com a oferta de abrir num worktree');
    await foto('5-trava');
    await ev(`[...document.querySelectorAll('#px-botoes button')].find(x => /cancelar/.test(x.textContent)).click()`);

    // formulário de editar: IA, modelo (da IA), reserva
    await ev(`[...${cartao('site')}.querySelectorAll('button')].find(x => /mais/.test(x.textContent)).click()`);
    await ev(`[...${cartao('site')}.querySelectorAll('.proj-extra button')].find(x => /editar/.test(x.textContent)).click()`);
    ok(await aguardar(async () => await visivel('#pj-form')), 'editar abre o formulário');
    ok((await ev(`document.getElementById('pj-ia').value`)) === 'antigravity' && (await ev(`document.getElementById('pj-modelo').value`)) === 'gemini-3.8-flash-medium' && (await ev(`document.getElementById('pj-ia-reserva').value`)) === 'claude', 'IA, modelo e IA reserva vêm do projeto');
    ok(/GEMINI_API_KEY/.test(await ev(`document.getElementById('pj-chave-rotulo').textContent`)), 'o texto da chave cita a variável da IA (GEMINI_API_KEY)');
    await ev(`(() => { const s = document.getElementById('pj-ia'); s.value = 'claude'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    ok((await ev(`[...document.getElementById('pj-modelo').options].map(o => o.value).join()`)) === 'sonnet,opus,haiku' && /ANTHROPIC_API_KEY/.test(await ev(`document.getElementById('pj-chave-rotulo').textContent`)), 'trocar a IA: a lista de modelos e o texto da chave acompanham (sonnet/opus/haiku, ANTHROPIC_API_KEY)');
    ok((await ev(`[...document.getElementById('pj-ia-reserva').options].map(o => o.value).join()`)) === ',antigravity', 'a IA reserva só oferece a outra IA');
    await foto('6-formulario');
    await ev(`document.getElementById('pj-cancelar').click()`);
  } catch (e) { console.log('ERRO DO TESTE:', e.message); falhas++; }
  try { execSync(`taskkill /PID ${filho.pid} /T /F`, { stdio: 'ignore' }); } catch { /* já fechou */ }
  await pausa(1500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* em uso: o Windows limpa depois */ }
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
