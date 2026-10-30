// Testa o painel de sessões (app/sessoes.js), a trava por pasta e o limite (app/abrir.js) e o worktree
// (projetos.py), sem abrir janela: os processos são de mentira e o git roda numa pasta temporária.
//   node tools/testar-sessoes.js
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sessoes-teste-'));
const base = path.join(tmp, 'cerebro');
fs.mkdirSync(path.join(base, 'conversas'), { recursive: true });
fs.mkdirSync(path.join(base, 'estado'));
process.env.CEREBRO_DIR = base;
process.env.PROJETOS_JSON = path.join(tmp, 'projetos.json');

const { criarRegistro, pidVivo, listarProcessos } = require('../app/sessoes');
const projetos = require('../app/projetos');
const { abrirIA } = require('../app/abrir');

let n = 0;
const teste = async (nome, fn) => {
  try { await fn(); n++; console.log('ok   ' + nome); } catch (e) { console.log('FALHOU ' + nome + '\n  ' + (e.stack || e.message)); process.exitCode = 1; }
};

// mundo de mentira: processos, quem está vivo e o relógio
function mundo() {
  const m = { procs: [], vivos: new Set(), mortos: [], t: Date.parse('2026-10-28T10:00:00Z'), consultas: 0 };
  m.registro = (arquivo) => criarRegistro({
    arquivo,
    processos: async () => { m.consultas++; return m.procs; },
    vivo: (pid) => m.vivos.has(pid),
    matar: async (pid) => { m.mortos.push(pid); m.vivos.delete(pid); return true; },
    agora: () => m.t,
  });
  return m;
}

(async () => {
  await teste('processo vivo / lista real de processos (wmic)', async () => {
    assert.strictEqual(pidVivo(process.pid), true);
    assert.strictEqual(pidVivo(999999), false);
    assert.strictEqual(pidVivo('12'), false);
    const lista = await listarProcessos();
    assert.ok(lista && lista.some((p) => p.pid === process.pid && p.nome === 'node.exe'), 'acha este node na lista');
  });

  await teste('sessão nova: liga widget -> cmd da janela -> claude.exe e acompanha', async () => {
    const m = mundo();
    const arq = path.join(tmp, 'sessoes-1.json');
    const r = m.registro(arq);
    const s = r.adicionar({ projeto: 'jogo', pasta: 'C:\\Jogos\\Roblox', executavel: 'claude', modelo: 'sonnet', via: 'cmd', spawnPid: 100 });
    m.procs = [{ nome: 'cmd.exe', pid: 200, ppid: 100 }, { nome: 'claude.exe', pid: 300, ppid: 200 }, { nome: 'claude.exe', pid: 999, ppid: 1 }];
    m.vivos = new Set([200, 300]);
    let ativas = await r.listar();
    assert.deepStrictEqual([ativas.length, ativas[0].janelaPid, ativas[0].iaPid], [1, 200, 300]);
    assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8'))[0].iaPid, 300, 'os PIDs achados vão para o arquivo');
    // já resolvida: as próximas listagens não consultam a lista de processos de novo
    const c = m.consultas;
    await r.listar(); await r.listar();
    assert.strictEqual(m.consultas, c);
    // sobrevive a um reinício do widget (arquivo)
    assert.strictEqual((await m.registro(arq).listar()).length, 1);
    // o claude terminou: sai da lista
    m.vivos.delete(300);
    ativas = await r.listar();
    assert.strictEqual(ativas.length, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), []);
    assert.ok(s.id && s.inicio);
  });

  await teste('janela fechada antes de achar o claude: some depois de 1 min; Windows Terminal: fica até 12 h', async () => {
    const m = mundo();
    const r = m.registro(null);
    r.adicionar({ projeto: 'a', pasta: 'C:\\A', executavel: 'claude', via: 'cmd', spawnPid: 1 });
    r.adicionar({ projeto: 'b', pasta: 'C:\\B', executavel: 'claude', via: 'wt', spawnPid: 2 });
    assert.strictEqual((await r.listar()).length, 2);
    m.t += 61 * 1000;
    assert.deepStrictEqual((await r.listar()).map((s) => s.projeto), ['b']);
    m.t += 12 * 3600 * 1000;
    assert.strictEqual((await r.listar()).length, 0);
  });

  await teste('encerrar fecha a janela (cmd) e tira da lista', async () => {
    const m = mundo();
    const r = m.registro(null);
    const s = r.adicionar({ projeto: 'a', pasta: 'C:\\A', executavel: 'claude', via: 'cmd', spawnPid: 10 });
    m.procs = [{ nome: 'cmd.exe', pid: 20, ppid: 10 }, { nome: 'claude.exe', pid: 30, ppid: 20 }];
    m.vivos = new Set([20, 30]);
    await r.listar();
    assert.deepStrictEqual(await r.encerrar(s.id), { ok: true, fechou: true });
    assert.deepStrictEqual(m.mortos, [20]);
    assert.strictEqual((await r.listar()).length, 0);
    assert.strictEqual((await r.encerrar('nao-existe')).ok, false);
  });

  // projetos reais (temporários) para a trava e o limite
  const pastaA = path.join(tmp, 'Projeto A');
  const pastaB = path.join(tmp, 'projeto b');
  fs.mkdirSync(pastaA); fs.mkdirSync(pastaB);
  await projetos.adicionar({ nome: 'Projeto A', id: 'a', pasta: pastaA });
  await projetos.adicionar({ nome: 'Projeto B', id: 'b', pasta: pastaB });

  await teste('trava por pasta: avisa, oferece worktree e "abrir mesmo assim"', async () => {
    const m = mundo();
    const r = m.registro(null);
    r.adicionar({ projeto: 'a', pasta: pastaA.toUpperCase() + '\\', executavel: 'claude', via: 'cmd', spawnPid: 1 }); // mesma pasta, escrita diferente
    const ocupada = await abrirIA('a', {}, { simular: true, registro: r, max: 3 });
    assert.deepStrictEqual([ocupada.ok, ocupada.tipo, ocupada.podeWorktree, ocupada.sessao.projeto], [false, 'pastaOcupada', true, 'a']);
    assert.ok((await abrirIA('a', { forcar: true }, { simular: true, registro: r, max: 3 })).ok);
    assert.ok((await abrirIA('b', {}, { simular: true, registro: r, max: 3 })).ok, 'outro projeto abre normalmente');
  });

  await teste('limite de sessões (max_sessoes): avisa; "abrir mesmo assim" passa', async () => {
    const m = mundo();
    const r = m.registro(null);
    for (const p of ['C:\\X', 'C:\\Y']) r.adicionar({ projeto: 'x', pasta: p, executavel: 'claude', via: 'cmd', spawnPid: 1 });
    assert.ok((await abrirIA('a', {}, { simular: true, registro: r, max: 3 })).ok);
    const cheio = await abrirIA('a', {}, { simular: true, registro: r, max: 2 });
    assert.deepStrictEqual([cheio.ok, cheio.tipo, cheio.max, cheio.ativas], [false, 'limite', 2, 2]);
    assert.ok((await abrirIA('a', { ignorarLimite: true }, { simular: true, registro: r, max: 2 })).ok);
  });

  await teste('worktree pela ponte: {pasta}-sessao2 numa branch nova + comandos para juntar', async () => {
    const git = (...a) => execFileSync('git', ['-C', pastaA, ...a], { encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@e'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(pastaA, 'x.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'um');
    const w = await projetos.criarWorktree('a');
    assert.ok(w.ok, w.erro);
    assert.strictEqual(w.dados.pasta, pastaA + '-sessao2');
    assert.match(w.dados.branch, /^sessao2-\d{8}-\d{6}$/);
    assert.ok(fs.existsSync(path.join(pastaA + '-sessao2', 'x.txt')));
    assert.ok(w.dados.comandos.includes('git merge ' + w.dados.branch));
    const semGit = await projetos.criarWorktree('b');
    assert.ok(!semGit.ok && /não é um repositório git/.test(semGit.erro), semGit.erro);
    git('worktree', 'remove', '--force', pastaA + '-sessao2');
  });

  // ---------- fase 10.2: o Antigravity (agy) ----------
  await teste('sessão do agy: acha o agy.exe (nome real do processo) filho do cmd da janela', async () => {
    const m = mundo();
    const r = m.registro(null);
    r.adicionar({ projeto: 'a', pasta: 'C:\\A', ia: 'antigravity', executavel: 'agy', processo: 'agy.exe', via: 'cmd', spawnPid: 100 });
    m.procs = [{ nome: 'cmd.exe', pid: 200, ppid: 100 }, { nome: 'claude.exe', pid: 250, ppid: 200 }, { nome: 'agy.exe', pid: 300, ppid: 200 }];
    m.vivos = new Set([200, 250, 300]);
    const ativas = await r.listar();
    assert.deepStrictEqual([ativas[0].janelaPid, ativas[0].iaPid, ativas[0].ia], [200, 300, 'antigravity']);
    // sessões antigas (sem "processo" gravado) continuam usando {executavel}.exe
    const r2 = mundo();
    const reg2 = r2.registro(null);
    reg2.adicionar({ projeto: 'b', pasta: 'C:\\B', executavel: 'claude', via: 'cmd', spawnPid: 1 });
    r2.procs = [{ nome: 'cmd.exe', pid: 2, ppid: 1 }, { nome: 'claude.exe', pid: 3, ppid: 2 }];
    r2.vivos = new Set([2, 3]);
    assert.strictEqual((await reg2.listar())[0].iaPid, 3);
  });

  await teste('trava por pasta entre IAs: Claude aberto na pasta -> agy dá "pastaOcupada" com a oferta de worktree, e vice-versa', async () => {
    const falsoBin = path.join(tmp, 'falso-bin');
    fs.mkdirSync(falsoBin, { recursive: true });
    fs.writeFileSync(path.join(falsoBin, 'agy.cmd'), '@echo off\r\n', 'utf8');
    const pathAntes = process.env.PATH;
    process.env.PATH = falsoBin + path.delimiter + pathAntes;
    try {
      const m = mundo();
      const r = m.registro(null);
      r.adicionar({ projeto: 'a', pasta: pastaA, ia: 'claude', executavel: 'claude', via: 'cmd', spawnPid: 1 });
      const agy = await abrirIA('a', { ia: 'antigravity' }, { simular: true, registro: r, max: 3 });
      assert.deepStrictEqual([agy.ok, agy.tipo, agy.podeWorktree, agy.sessao.ia], [false, 'pastaOcupada', true, 'claude']);
      assert.ok((await abrirIA('a', { ia: 'antigravity', forcar: true }, { simular: true, registro: r, max: 3 })).ok, '"abrir mesmo assim" continua possível');
      const m2 = mundo();
      const r2 = m2.registro(null);
      r2.adicionar({ projeto: 'a', pasta: pastaA.toUpperCase(), ia: 'antigravity', executavel: 'agy', processo: 'agy.exe', via: 'widget', spawnPid: 5, iaPid: 6 });
      m2.vivos = new Set([6]);
      const claude = await abrirIA('a', {}, { simular: true, registro: r2, max: 3 });
      assert.deepStrictEqual([claude.tipo, claude.podeWorktree], ['pastaOcupada', true]);
    } finally { process.env.PATH = pathAntes; }
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} testes passaram${process.exitCode ? ' (houve falhas)' : ''}`);
})();
