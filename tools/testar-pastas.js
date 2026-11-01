// Teste de pastas de organização na aba Projects.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const estilo = process.argv[2] === 'ios' ? 'ios' : 'cmd';
const PORTA = 9488 + (estilo === 'ios' ? 1 : 0);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'ok    ' : 'FALHOU ') + m); if (!c) falhas++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pastas-'));
  const cerebroDir = path.join(tmp, 'cerebro');
  for (const d of ['conversas', 'estado', '.log']) fs.mkdirSync(path.join(cerebroDir, d), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'widget'));
  fs.writeFileSync(path.join(tmp, 'cerebro.json'), JSON.stringify({ cerebro_dir: cerebroDir }), 'utf8');
  fs.writeFileSync(path.join(tmp, 'widget', 'config.json'), JSON.stringify({
    pokemon: 'snivy', pokemonEscolhido: true, estilo,
    janela: { largura: 840, altura: 520 }, aba: 'projetos',
    appsSemeados: true, boasVindas: { ativo: false, voz: false },
  }), 'utf8');

  const falso = path.join(tmp, 'falso-bin');
  fs.mkdirSync(falso);
  fs.writeFileSync(path.join(falso, 'fake.js'), 'console.log("FAKE");\n', 'utf8');
  fs.writeFileSync(path.join(falso, 'claude.cmd'), '@echo off\r\n', 'utf8');
  fs.writeFileSync(path.join(falso, 'agy.cmd'), '@echo off\r\n', 'utf8');

  const env = {
    ...process.env, PATH: falso + path.delimiter + process.env.PATH,
    CEREBRO_CONFIG: path.join(tmp, 'cerebro.json'), CEREBRO_DIR: cerebroDir, PROJETOS_JSON: path.join(tmp, 'projetos.json'),
    MEU_WIDGET_PASTA: path.join(tmp, 'widget'), MEU_WIDGET_SESSOES: path.join(tmp, 'widget', 'sessoes.json'),
  };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ANTHROPIC_API_KEY;

  // Projeto 1: Mão dentro da pasta PIBIC
  const pastaMao = path.join(tmp, 'Mao');
  fs.mkdirSync(pastaMao);
  execFileSync('python', ['-X', 'utf8', 'cerebro/tools/projetos.py', 'adicionar', '--json'], {
    cwd: REPO, env, input: JSON.stringify({
      nome: 'Mão', id: 'mao', pasta: pastaMao, cor: '#ff6b6b', modelo_padrao: 'sonnet', grupo: 'PIBIC',
    }), encoding: 'utf8',
  });

  // Projeto 2: pokeBOX sem pasta
  const pastaPoke = path.join(tmp, 'pokeBOX');
  fs.mkdirSync(pastaPoke);
  execFileSync('python', ['-X', 'utf8', 'cerebro/tools/projetos.py', 'adicionar', '--json'], {
    cwd: REPO, env, input: JSON.stringify({
      nome: 'pokeBOX', id: 'pokebox', pasta: pastaPoke, cor: '#4c0075', modelo_padrao: 'sonnet',
    }), encoding: 'utf8',
  });

  const electronPath = require(path.join(REPO, 'node_modules', 'electron'));
  const filho = spawn(electronPath, ['.', '--remote-debugging-port=' + PORTA], { cwd: REPO, env, stdio: 'ignore' });

  let ws; let id = 0; const pend = new Map();
  const enviar = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async (expr) => {
    const r = await enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const foto = async (destino) => {
    const r = await enviar('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(destino, Buffer.from(r.data, 'base64'));
    console.log('  [captura salva em]', destino);
  };

  try {
    for (let i = 0; i < 60 && !ws; i++) {
      try {
        const alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json();
        const p = alvos.find((a) => a.type === 'page' && /index\.html/.test(a.url));
        if (p) {
          ws = new WebSocket(p.webSocketDebuggerUrl);
          await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
          ws.onmessage = (m) => {
            const d = JSON.parse(m.data);
            if (d.id && pend.has(d.id)) {
              const q = pend.get(d.id);
              pend.delete(d.id);
              d.error ? q.rej(new Error(d.error.message)) : q.res(d.result);
            }
          };
        }
      } catch { /* aguardando */ }
      if (!ws) await pausa(500);
    }
    if (!ws) throw new Error('Não conectou ao widget');

    await enviar('Runtime.enable');
    await pausa(4000);

    // Garante que a aba de projetos está aberta
    await ev(`document.querySelector('[data-aba="projetos"]').click()`);
    await pausa(1200);

    // 1. Verifica seções de pasta
    const secoes = await ev(`document.querySelectorAll('.proj-pasta-secao').length`);
    ok(secoes === 2, `Existem 2 seções de pasta na tela (PIBIC e sem pasta): encontrado ${secoes}`);

    // 2. Verifica nome da pasta PIBIC
    const nomesPastas = await ev(`[...document.querySelectorAll('.proj-pasta-nome')].map(e => e.textContent)`);
    ok(nomesPastas.includes('PIBIC'), `Pasta "PIBIC" encontrada nos títulos: ${nomesPastas.join(', ')}`);
    ok(nomesPastas.includes('sem pasta'), `Pasta "sem pasta" encontrada nos títulos`);

    // 3. Verifica se o projeto Mão está dentro da pasta PIBIC
    const maoNaPibic = await ev(`(() => {
      const secaoPibic = [...document.querySelectorAll('.proj-pasta-secao')].find(s => s.querySelector('.proj-pasta-nome')?.textContent === 'PIBIC');
      return !!secaoPibic && !!secaoPibic.querySelector('.proj-nome')?.textContent.includes('Mão');
    })()`);
    ok(maoNaPibic, 'Projeto "Mão" está dentro da seção "PIBIC"');

    // 4. Verifica badge de pasta no cartão de Mão
    const badgeTexto = await ev(`document.querySelector('.proj-chip-pasta')?.textContent`);
    ok(badgeTexto === 'pasta: PIBIC', `Badge de pasta no cartão está correto: "${badgeTexto}"`);

    // 5. Verifica botões para continuar dentro do projeto Mão na pasta
    const temBotoesContinuar = await ev(`(() => {
      const secaoPibic = [...document.querySelectorAll('.proj-pasta-secao')].find(s => s.querySelector('.proj-pasta-nome')?.textContent === 'PIBIC');
      const abrir = secaoPibic?.querySelector('.proj-abrir')?.textContent;
      const ps = secaoPibic?.querySelector('.proj-ps')?.textContent;
      const skills = secaoPibic?.querySelector('.proj-btn-skills')?.textContent;
      return { abrir, ps, skills };
    })()`);
    ok(!!temBotoesContinuar.abrir, `Botão abrir está presente: ${temBotoesContinuar.abrir}`);
    ok(!!temBotoesContinuar.ps, `Botão powershell está presente: ${temBotoesContinuar.ps}`);
    ok(!!temBotoesContinuar.skills, `Botão skills está presente: ${temBotoesContinuar.skills}`);

    // 6. Verifica filtro de pastas
    const pills = await ev(`[...document.querySelectorAll('.proj-pasta-chip')].map(p => p.textContent)`);
    ok(pills.some(t => t.includes('PIBIC')), `Pílula de filtro "PIBIC" encontrada: ${pills.join(', ')}`);

    // 7. Salva captura da tela das pastas
    const screenshotPath = `C:/Users/weto/.gemini/antigravity/brain/b9018e54-b624-4d03-b9ab-321a793d57f8/test-folders-${estilo}.png`;
    await foto(screenshotPath);

    // 8. Testa recolher e expandir pasta
    await ev(`document.querySelector('.proj-pasta-cab').click()`);
    await pausa(400);
    const recolhido = await ev(`document.querySelector('.proj-pasta-corpo').classList.contains('oculto')`);
    ok(recolhido, 'Clicar no cabeçalho da pasta recolhe o corpo da pasta');

    await ev(`document.querySelector('.proj-pasta-cab').click()`);
    await pausa(400);
    const reexpandido = !await ev(`document.querySelector('.proj-pasta-corpo').classList.contains('oculto')`);
    ok(reexpandido, 'Clicar novamente re-expande a pasta');

  } finally {
    if (ws) ws.close();
    filho.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignora */ }
  }

  if (falhas > 0) {
    console.error(`\n${falhas} teste(s) falharam!`);
    process.exit(1);
  } else {
    console.log('\nTodos os testes de pastas passaram perfeitamente!');
    process.exit(0);
  }
})();
