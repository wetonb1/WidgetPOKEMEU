// Teste do modo mini: abre o widget de verdade (Electron, em pastas temporárias; nunca toca na sua config nem no widget que você deixou aberto) e
// pergunta ao PRÓPRIO WINDOWS (WM_NCHITTEST) o que há em cada botão. Clique por DevTools não serve aqui: ele entra direto na página e passa por cima
// da área de arrasto, então daria "ok" mesmo com o botão morto para o mouse de verdade. Não mexe no seu mouse.   uso: npm run testar-mini [ios|cmd]
// Salva capturas em %TEMP%\testar-mini-*.png para você olhar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const estilo = process.argv[2] === 'cmd' ? 'cmd' : 'ios';
const PORTA = 9370 + (estilo === 'ios' ? 1 : 0);
const HTCLIENT = 1, HTCAPTION = 2;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'ok    ' : 'FALHOU ') + m); if (!c) falhas++; };

// devolve, para cada ponto da janela (em pixels físicos da tela), o código que o Windows responde
function testarPontos(pid, pontos) {
  const ps1 = path.join(os.tmpdir(), `testar-mini-${process.pid}.ps1`);
  fs.writeFileSync(ps1, `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Hit {
  delegate bool Cb(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Cb c, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Rodar(uint alvo, string pontos) {
    IntPtr achada = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (pid == alvo && IsWindowVisible(h) && c.ToString().StartsWith("Chrome_WidgetWin")) { achada = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (achada == IntPtr.Zero) return "SEMJANELA";
    RECT r; GetWindowRect(achada, out r);
    var saida = new StringBuilder(r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T));
    foreach (var par in pontos.Split(';')) {
      var xy = par.Split(',');
      int x = r.L + int.Parse(xy[0]), y = r.T + int.Parse(xy[1]);
      long lp = (long)(((uint)y & 0xFFFFu) << 16 | ((uint)x & 0xFFFFu));
      saida.Append(";" + SendMessage(achada, 0x84, IntPtr.Zero, new IntPtr(lp)).ToInt64());
    }
    return saida.ToString();
  }
}
'@
[Hit]::Rodar(${pid}, '${pontos.map(([x, y]) => `${x},${y}`).join(';')}')
`, 'utf8');
  try {
    const s = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { encoding: 'utf8', timeout: 30000 }).trim();
    if (s === 'SEMJANELA') throw new Error('janela do teste não encontrada');
    const [rect, ...codigos] = s.split(';');
    return { rect: rect.split(',').map(Number), codigos: codigos.map(Number) };
  } finally { fs.rmSync(ps1, { force: true }); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-'));
  const cerebroDir = path.join(tmp, 'cerebro');
  for (const d of ['conversas', 'estado', '.log']) fs.mkdirSync(path.join(cerebroDir, d), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'widget'));
  fs.writeFileSync(path.join(tmp, 'cerebro.json'), JSON.stringify({ cerebro_dir: cerebroDir }), 'utf8');
  fs.writeFileSync(path.join(tmp, 'widget', 'config.json'), JSON.stringify({ pokemon: 'cubone', pokemonEscolhido: true, estilo, janela: { largura: 1100, altura: 680 }, aba: 'sys', appsSemeados: true, avisarAtualizacao: false, boasVindas: { ativo: false, voz: false } }), 'utf8');
  const env = { ...process.env, CEREBRO_CONFIG: path.join(tmp, 'cerebro.json'), CEREBRO_DIR: cerebroDir, PROJETOS_JSON: path.join(tmp, 'projetos.json'),
    MEU_WIDGET_PASTA: path.join(tmp, 'widget'), MEU_WIDGET_SESSOES: path.join(tmp, 'widget', 'sessoes.json') };
  delete env.ELECTRON_RUN_AS_NODE;

  const filho = spawn(require(path.join(REPO, 'node_modules', 'electron')), ['.', '--remote-debugging-port=' + PORTA], { cwd: REPO, env, stdio: 'ignore' });
  let ws; let id = 0; const pend = new Map();
  const enviar = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expr) => { const r = await enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const foto = async (nome) => { const r = await enviar('Page.captureScreenshot', { format: 'png' }); const f = path.join(os.tmpdir(), `testar-mini-${estilo}-${nome}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  [captura]', f); };

  // cada botão visível do cabeçalho + um ponto do fundo do cartão + um ponto na hora
  const alvos = () => ev(`(() => {
    const d = devicePixelRatio, lista = [];
    for (const b of document.querySelectorAll('.cab-botoes .cab-btn')) {
      const r = b.getBoundingClientRect();
      if (b.offsetParent === null || !r.width) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      lista.push({ nome: b.id, x: Math.round(cx * d), y: Math.round(cy * d), w: r.width, h: r.height, topo: (document.elementFromPoint(cx, cy)?.closest('button') || {}).id || '(outro)' });
    }
    return lista;
  })()`);

  try {
    for (let i = 0; i < 60 && !ws; i++) {
      try {
        const lista = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json();
        const p = lista.find((a) => a.type === 'page' && /index\.html/.test(a.url));
        if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const q = pend.get(d.id); pend.delete(d.id); d.error ? q.rej(new Error(d.error.message)) : q.res(d.result); } }; }
      } catch { /* ainda subindo */ }
      if (!ws) await pausa(500);
    }
    if (!ws) throw new Error('não conectou ao widget');
    await enviar('Runtime.enable');
    await pausa(5000);

    // o normal é a referência: se aqui também falhar, o problema não é do mini
    const normal = await alvos();
    const hNormal = testarPontos(filho.pid, normal.map((a) => [a.x, a.y]));
    console.log('normal:', normal.map((a, i) => `${a.nome}=${hNormal.codigos[i]}`).join(' '));
    ok(normal.length > 0 && hNormal.codigos.every((c) => c === HTCLIENT), 'modo normal: o Windows entrega o clique a todos os botões');

    await ev(`document.getElementById('btn-mini').click()`);
    await pausa(1500);
    await foto('mini');
    console.log('janela:', await ev('innerWidth + "x" + innerHeight + " escala " + devicePixelRatio'));
    const mini = await alvos();
    const d = await ev('devicePixelRatio');
    const pts = mini.map((a) => [a.x, a.y]);
    pts.push([Math.round(200 * d), Math.round(116 * d)]); // fundo do cartão: tem de continuar arrastando
    const h = testarPontos(filho.pid, pts);
    const arrasto = h.codigos.pop();
    for (const [i, a] of mini.entries()) console.log(`  ${a.nome}: ${a.w}x${a.h} em (${a.x},${a.y}) windows=${h.codigos[i]} página=${a.topo}`);
    ok(mini.length > 0, 'mini: há botões visíveis');
    ok((await ev('innerWidth')) === 244 && (await ev('innerHeight')) === 124, 'mini: a janela tem 244x124');
    ok(!(await ev(`!!document.getElementById('btn-mini-vidro')`)), 'mini: não existe mais o botão de trocar o vidro');
    const pokemon = await ev(`(() => { const t = document.getElementById('poke-tela') || document.querySelector('.poke-tela'); const r = t.getBoundingClientRect(); return { a: r.height, topo: r.top, base: r.bottom }; })()`);
    ok(pokemon.a / 124 >= 0.9 && pokemon.topo >= 0 && pokemon.base <= 124, `mini: o Pokémon ocupa ${Math.round(pokemon.a / 1.24)}% da altura sem cortar`);
    if (estilo === 'ios') for (let i = 0; i < 12 && !(await ev(`!!document.documentElement.style.getPropertyValue('--mv-base')`)); i++) await pausa(500);
    const tom = await ev(`document.documentElement.style.getPropertyValue('--mv-base')`);
    ok(estilo === 'ios' ? /^rgb\(/.test(tom) : !tom, `mini: tom automático só no iOS, lido das cores ao redor (${tom || 'sem tom'})`);
    for (const [i, a] of mini.entries()) {
      ok(h.codigos[i] === HTCLIENT, `mini: ${a.nome} recebe o clique do mouse (Windows respondeu ${h.codigos[i]}; 1 = clique, 2 = arrasto)`);
      ok(a.topo === a.nome, `mini: nada cobre ${a.nome} na página`);
    }
    ok(arrasto === HTCAPTION, `mini: o fundo do cartão continua arrastando (Windows respondeu ${arrasto})`);


    // menu de posições: abre pelo botão e cada seta tem de receber o clique; depois uma delas tem de mover a janela
    await ev(`document.getElementById('btn-posicoes').click()`);
    await pausa(300);
    await foto('menu');
    const setas = await ev(`[...document.querySelectorAll('.pos-btn')].map((b) => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { pos: b.dataset.pos, x: Math.round(x * devicePixelRatio), y: Math.round(y * devicePixelRatio), topo: document.elementFromPoint(x, y) === b }; })`);
    const hs = testarPontos(filho.pid, setas.map((a) => [a.x, a.y]));
    ok(setas.length === 9 && hs.codigos.every((x) => x === HTCLIENT), `mini: as 9 setas do menu recebem o clique (Windows: ${hs.codigos.join()})`);
    ok(setas.every((a) => a.topo), 'mini: o menu de posições não é cortado nem coberto');
    await ev(`document.querySelector('.pos-btn[data-pos="centro"]').click()`);
    await pausa(900);
    const depois = testarPontos(filho.pid, [[1, 1]]).rect;
    ok(depois[0] !== h.rect[0] || depois[1] !== h.rect[1], `mini: a seta move a janela (${h.rect.slice(0, 2)} -> ${depois.slice(0, 2)})`);
    ok(depois[2] === h.rect[2] && depois[3] === h.rect[3], 'mini: mover não muda o tamanho do mini');

    await ev(`document.getElementById('btn-mini').click()`);
    await pausa(1200);
    ok((await ev('innerWidth')) > 400, 'o botão de restaurar volta ao tamanho normal');
  } finally {
    try { filho.kill(); } catch { /* já fechou */ }
    await pausa(500);
    try { execFileSync('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* já fechou */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
