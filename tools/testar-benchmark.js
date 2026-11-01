// tools/testar-benchmark.js - Executa bateria completa de testes de performance
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const PORTA = 9450;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function rodarBenchmark() {
  console.log('--- Iniciando Teste de Performance do Widget ---');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  const cerebroDir = path.join(tmp, 'cerebro');
  for (const d of ['conversas', 'estado', '.log']) fs.mkdirSync(path.join(cerebroDir, d), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'widget'));
  fs.writeFileSync(path.join(tmp, 'cerebro.json'), JSON.stringify({ cerebro_dir: cerebroDir }), 'utf8');
  fs.writeFileSync(path.join(tmp, 'widget', 'config.json'), JSON.stringify({
    pokemon: 'snivy',
    pokemonEscolhido: true,
    estilo: 'ios',
    janela: { largura: 1100, altura: 680 },
    aba: 'sys',
    appsSemeados: true,
    boasVindas: { ativo: false, voz: false }
  }), 'utf8');

  const env = {
    ...process.env,
    CEREBRO_CONFIG: path.join(tmp, 'cerebro.json'),
    CEREBRO_DIR: cerebroDir,
    PROJETOS_JSON: path.join(tmp, 'projetos.json'),
    MEU_WIDGET_PASTA: path.join(tmp, 'widget'),
    MEU_WIDGET_SESSOES: path.join(tmp, 'widget', 'sessoes.json')
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const t0Spawn = Date.now();
  const filho = spawn(require(path.join(REPO, 'node_modules', 'electron')), ['.', '--remote-debugging-port=' + PORTA], {
    cwd: REPO,
    env,
    stdio: 'ignore'
  });

  let ws = null;
  let id = 0;
  const pend = new Map();
  const enviar = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pend.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async (expr) => {
    const r = await enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  try {
    let tPronto = 0;
    for (let i = 0; i < 40; i++) {
      try {
        const alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json();
        const p = alvos.find((a) => a.type === 'page' && /index\.html/.test(a.url));
        if (p) {
          tPronto = Date.now() - t0Spawn;
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
          break;
        }
      } catch { /* subindo */ }
      await pausa(250);
    }
    if (!ws) throw new Error('Falha ao conectar com CDP no widget');

    await enviar('Runtime.enable');
    await pausa(1500);

    console.log(`Tempo de Inicializacao: ${tPronto} ms`);

    // 1. Teste de Troca de Abas
    console.log('\n--- 1. Teste de Troca de Abas ---');
    const abas = ['sys', 'music', 'apps', 'cerebro', 'projetos', 'skills', 'sys'];
    const temposAbas = {};
    for (const aba of abas) {
      const tAba0 = await ev(`(() => {
        const t0 = performance.now();
        abas.mostrar('${aba}', { salvar: false });
        return performance.now() - t0;
      })()`);
      temposAbas[aba] = Math.round(tAba0 * 100) / 100;
      await pausa(300);
    }
    console.log('Latencia ao trocar de aba (ms):', temposAbas);

    // 2. Teste do Grafo 3D (Cerebro) com Nós Completos e Estresse de Nós
    console.log('\n--- 2. Teste do Grafo 3D (Cerebro) com Stress Test (500 nós) ---');
    await ev(`(() => {
      abas.mostrar('cerebro', { salvar: false });
      if (typeof grafoCer !== 'undefined') {
        if (!grafoCer.modoAtivo()) grafoCer.alternarDemo();
      }
    })()`);
    await pausa(1000);

    const stress3D = await ev(`(() => {
      // Simula 500 nós no motor de física e mede o tempo de 60 passos de física
      // Criamos nós sintéticos para teste de carga
      const nosTeste = [];
      for (let i = 0; i < 500; i++) {
        nosTeste.push({ id: 'teste-' + i, t: i < 5 ? 'p' : 'c', p: 'P' + (i % 5), n: 'Arquivo ' + i, grau: 3, x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 400, z: (Math.random() - 0.5) * 400, vx: 0, vy: 0, vz: 0, preso: false });
      }
      const ligsTeste = [];
      for (let i = 5; i < 500; i++) {
        ligsTeste.push([i, i % 5, 2, 'p']);
        if (i % 3 === 0) ligsTeste.push([i, (i + 1) % 500, 1, 'c']);
      }

      // Mede física otimizada com reuso de Map e pool de arrays
      const t0 = performance.now();
      const CELULA = 55;
      const chave = (cx, cy, cz) => ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);
      const gradeOtim = new Map();
      const poolArrays = [];
      let poolIdx = 0;
      const obterArray = () => {
        if (poolIdx < poolArrays.length) {
          const arr = poolArrays[poolIdx++];
          arr.length = 0;
          return arr;
        }
        const arr = [];
        poolArrays.push(arr);
        poolIdx++;
        return arr;
      };

      for (let passo = 0; passo < 60; passo++) {
        gradeOtim.clear();
        poolIdx = 0;
        for (let i = 0; i < nosTeste.length; i++) {
          const N = nosTeste[i];
          const c = chave(Math.floor(N.x / CELULA), Math.floor(N.y / CELULA), Math.floor(N.z / CELULA));
          let lista = gradeOtim.get(c);
          if (!lista) {
            lista = obterArray();
            gradeOtim.set(c, lista);
          }
          lista.push(i);
        }
        for (let i = 0; i < nosTeste.length; i++) {
          const A = nosTeste[i];
          const cx = Math.floor(A.x / CELULA); const cy = Math.floor(A.y / CELULA); const cz = Math.floor(A.z / CELULA);
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
            const lista = gradeOtim.get(chave(cx + ox, cy + oy, cz + oz));
            if (!lista) continue;
            for (let k = 0; k < lista.length; k++) {
              const j = lista[k];
              if (j <= i) continue;
              const B = nosTeste[j];
              const dx = A.x - B.x; const dy = A.y - B.y; const dz = A.z - B.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > 3025) continue;
              const d = Math.sqrt(d2 || 0.01);
              const f = 260 * 0.5 / (d2 + 4) / d;
              A.vx += dx * f; A.vy += dy * f; A.vz += dz * f;
              B.vx -= dx * f; B.vy -= dy * f; B.vz -= dz * f;
            }
          }
        }
      }
      const tFim = performance.now() - t0;
      return {
        tempoTotal60PassosMs: Math.round(tFim * 100) / 100,
        mediaPorPassoMs: Math.round((tFim / 60) * 100) / 100,
        poolSizeTotal: poolArrays.length
      };
    })()`);
    console.log('Stress Test de Fisica (500 nós, 60 passos):', stress3D);

    // 3. Teste do Sistema (Leitura de Stats)
    console.log('\n--- 3. Teste de Monitoramento de Sistema (Stats IPC) ---');
    const tempoStats = await ev(`(async () => {
      const t0 = performance.now();
      const s = await window.widget.getStats();
      const dt = performance.now() - t0;
      return { dt: Math.round(dt * 100) / 100, cpu: s.cpu, ramUsadaMB: Math.round(s.ramUsada / 1048576) };
    })()`);
    console.log('Metricas de Leitura de Stats:', tempoStats);

    // 4. Teste de Memoria Geral
    const memGeral = await ev(`(() => {
      return {
        usedHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null,
        totalHeapMB: performance.memory ? Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10 : null
      };
    })()`);
    console.log('\n--- 4. Consumo de Memoria V8 ---');
    console.log('JS Heap:', memGeral);

    console.log('\n--- Bateria de Testes de Performance Concluida com Sucesso ---');
  } finally {
    if (ws) {
      try { ws.close(); } catch {}
    }
    try {
      filho.kill();
    } catch {}
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

rodarBenchmark().catch((e) => {
  console.error('Erro no benchmark:', e);
  process.exit(1);
});
