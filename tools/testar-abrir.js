// Testa a abertura da IA (app/ias.js, app/terminal.js, app/abrir.js) sem abrir janela nenhuma.
// Usa um projetos.json e um cérebro temporários.   node tools/testar-abrir.js
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abrir-teste-'));
const base = path.join(tmp, 'cerebro');
fs.mkdirSync(path.join(base, 'conversas'), { recursive: true });
fs.mkdirSync(path.join(base, 'estado'));
process.env.CEREBRO_DIR = base;
process.env.PROJETOS_JSON = path.join(tmp, 'projetos.json');
const pasta = path.join(tmp, 'meu jogo & cia');
fs.mkdirSync(pasta);

const ias = require('../app/ias');
const terminal = require('../app/terminal');
const projetos = require('../app/projetos');
const { abrirIA } = require('../app/abrir');

let n = 0;
const teste = async (nome, fn) => {
  try { await fn(); n++; console.log('ok   ' + nome); } catch (e) { console.log('FALHOU ' + nome + '\n  ' + (e.stack || e.message)); process.exitCode = 1; }
};

(async () => {
  await teste('claude: argumentos por modo (modelo, continuar, retomar, prompt)', () => {
    const c = ias.obter('claude');
    assert.deepStrictEqual(c.argumentos({ modo: 'novo', modelo: 'sonnet', prompt: 'oi' }), ['--model', 'sonnet', 'oi']);
    assert.deepStrictEqual(c.argumentos({ modo: 'continuar', modelo: 'opus', prompt: 'ignorado' }), ['--continue', '--model', 'opus']);
    assert.deepStrictEqual(c.argumentos({ modo: 'retomar', modelo: 'haiku' }), ['--resume', '--model', 'haiku']);
    assert.ok(!c.argumentos({ modo: 'novo', modelo: 'sonnet' }).some((a) => /dangerously/.test(a)), 'sem pular permissões por padrão');
    assert.ok(c.argumentos({ modo: 'novo', modelo: 'sonnet', pularPermissoes: true }).includes('--dangerously-skip-permissions'));
    assert.ok(!c.argumentos({ modo: 'novo', pularPermissoes: 'true' }).includes('--dangerously-skip-permissions'), 'só true de verdade liga');
    assert.deepStrictEqual(Object.keys(c.modelos), ['sonnet', 'opus', 'haiku']);
    assert.strictEqual(ias.obter('nao-existe'), null);
    assert.strictEqual(ias.obter('toString'), null);
  });

  await teste('antigravity (agy): argumentos por modo, retomar sem suporte, pular permissões só com true', () => {
    const a = ias.obter('antigravity');
    assert.ok(a, 'ias.obter("antigravity") existe');
    assert.deepStrictEqual([a.nome, a.executavel, a.processo, a.variavelChave, a.arquivoRegras], ['Antigravity', 'agy', 'agy.exe', 'GEMINI_API_KEY', 'AGENTS.md']);
    assert.deepStrictEqual(a.argumentos({ modo: 'novo', modelo: 'gemini-3.8-flash-medium', prompt: 'oi' }), ['--model', 'gemini-3.8-flash-medium', '-i', 'oi'], 'o prompt vai com -i (o agy recusa o prompt solto)');
    assert.deepStrictEqual(a.argumentos({ modo: 'novo', modelo: 'gemini-3.8-flash-low' }), ['--model', 'gemini-3.8-flash-low'], 'sem prompt: abre vazio');
    assert.deepStrictEqual(a.argumentos({ modo: 'continuar', modelo: 'gemini-4-argon-medium', prompt: 'ignorado' }), ['-c', '--model', 'gemini-4-argon-medium']);
    assert.strictEqual(a.argumentos({ modo: 'retomar', modelo: 'gemini-4-argon-high' }), null, 'retomar não existe na linha de comando');
    assert.deepStrictEqual(a.suporta, { continuar: true, retomar: false, promptPorArgumento: true, pularPermissoes: true });
    assert.ok(/\/resume/.test(a.dicas.retomar), 'a dica explica o /resume');
    assert.ok(a.argumentos({ modo: 'novo', modelo: 'gemini-3.8-flash-low', pularPermissoes: true }).includes('--dangerously-skip-permissions'));
    for (const quase of ['true', 1, 'sim', {}]) assert.ok(!a.argumentos({ modo: 'novo', pularPermissoes: quase }).includes('--dangerously-skip-permissions'), 'só true de verdade liga: ' + JSON.stringify(quase));
    assert.deepStrictEqual(Object.keys(a.modelos), [
      'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'gemini-3.8-flash-high',
      'gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high',
      'claude-sonnet-5-5-low', 'claude-sonnet-5-5-medium', 'claude-sonnet-5-5-high',
      'claude-opus-5-5-low', 'claude-opus-5-5-medium', 'claude-opus-5-5-high',
      'gpt-oss-120b-medium',
    ]);
    assert.strictEqual(a.modeloPadrao, 'gemini-3.8-flash-medium');
    assert.deepStrictEqual(a.comandosUteis, ['/usage']);
    const env = ias.ambiente(a, { PATH: 'x', ANTIGRAVITY_CSRF_TOKEN: 's', antigravity_conversation_id: 'c', JJ_EDITOR: 'e', GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k2' });
    assert.deepStrictEqual(env, { PATH: 'x', ANTHROPIC_API_KEY: 'k2' }, 'tira as marcas do agy e a chave DELE; a de outra IA não é assunto dele');
  });

  await teste('ias.resumo(): o que cada IA suporta, comandos úteis e o NOME da variável da chave (nunca o valor)', () => {
    const r = ias.resumo();
    assert.deepStrictEqual(Object.keys(r), ['claude', 'antigravity']);
    assert.deepStrictEqual(r.claude.suporta, { continuar: true, retomar: true, promptPorArgumento: true, pularPermissoes: true });
    assert.deepStrictEqual([r.claude.variavelChave, r.antigravity.variavelChave], ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY']);
    assert.deepStrictEqual(r.antigravity.comandosUteis, ['/usage']);
    assert.strictEqual(r.antigravity.suporta.retomar, false);
    assert.strictEqual(typeof r.antigravity.instalada, 'boolean');
    assert.ok(!Object.values(r).some((x) => typeof x.argumentos === 'function' || 'limparAmbiente' in x), 'sem funções nem listas internas');
    const antes = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-segredo-de-teste';
    try { assert.ok(!JSON.stringify(ias.resumo()).includes('AIza'), 'o valor da chave nunca vai para a tela'); assert.strictEqual(ias.resumo().antigravity.chaveNoAmbiente, true); } finally {
      if (antes === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = antes;
    }
  });

  await teste('os dados das IAs vêm do app/ias-dados.json (o mesmo arquivo do Python)', () => {
    const dados = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'ias-dados.json'), 'utf8'));
    for (const id of ['claude', 'antigravity']) {
      assert.deepStrictEqual(ias.obter(id).modelos, dados[id].modelos);
      for (const campo of ['id', 'nome', 'executavel', 'modelos', 'modeloPadrao', 'docs', 'instalar', 'instalarAlternativa', 'variavelChave', 'arquivoRegras', 'origemCerebro', 'comandosUteis', 'suporta']) {
        assert.ok(campo in dados[id], `${id}.${campo} no JSON`);
      }
      assert.ok(Object.prototype.hasOwnProperty.call(dados[id].modelos, dados[id].modeloPadrao), `${id}: o modelo padrão está na lista`);
    }
  });

  await teste('ambiente da sessão nova: tira as marcas de sessão-filha, mantém o resto', () => {
    const env = ias.ambiente(ias.obter('claude'), { PATH: 'x', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1', claude_code_session_id: 'a', CLAUDE_CODE_GIT_BASH_PATH: 'C:/bash.exe' });
    assert.deepStrictEqual(env, { PATH: 'x', CLAUDE_CODE_GIT_BASH_PATH: 'C:/bash.exe' });
  });

  await teste('localizar no PATH (como o "where")', () => {
    assert.ok(/python/i.test(ias.localizar('python') || ''), 'acha o python');
    assert.strictEqual(ias.localizar('programa-que-nao-existe-xyz'), null);
    assert.strictEqual(ias.localizar('python', { PATH: '' }), null);
  });

  await teste('argumento seguro: uma linha, sem aspas duplas, %, ; nem barra no fim', () => {
    assert.strictEqual(terminal.argumentoSeguro('linha 1\nlinha "2"; 50% \\'), "linha 1 linha '2', 50 por cento");
    assert.strictEqual(terminal.argumentoSeguro('ação ✓ & <x> | ^y'), 'ação ✓ & <x> | ^y');
  });

  await teste('o prompt chega intacto ao programa passando pelo cmd (mesmas aspas do cmd /k)', () => {
    // um script que só devolve os argumentos que recebeu
    const eco = path.join(tmp, 'eco.js');
    fs.writeFileSync(eco, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const args = ['--model', 'sonnet', terminal.argumentoSeguro('Projeto: x. Rode: python "C:/a b/cerebro.py" buscar fisica --projeto x\nE a & b | c <d> ^e (f) ação ✓; 10% feito')];
    const linha = terminal.linhaDeComando('node', [eco, ...args]);
    const saida = execFileSync('cmd.exe', ['/d', '/s', '/c', `"${linha}"`], { windowsVerbatimArguments: true, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(saida), args);
    assert.ok(JSON.parse(saida)[2].includes("'C:/a b/cerebro.py'") && JSON.parse(saida)[2].includes('ação ✓'));
  });

  await teste('planejar: Windows Terminal quando existe, senão cmd start; nunca espera', () => {
    const op = { pasta, titulo: 'Claude Code - Jogo', programa: 'claude', args: ['--model', 'sonnet', 'faça "x"'] };
    const wt = terminal.planejar(op, true);
    assert.strictEqual(wt.via, 'wt');
    assert.deepStrictEqual(wt.argv.slice(0, 7), ['-d', pasta, '--title', 'Claude Code - Jogo', 'cmd', '/k', 'claude']);
    assert.strictEqual(wt.argv.at(-1), "faça 'x'");
    const cmd = terminal.planejar(op, false);
    assert.strictEqual(cmd.via, 'cmd');
    assert.strictEqual(cmd.argv[3], `"start "Claude Code - Jogo" /d "${pasta}" cmd /k claude --model sonnet "faça 'x'""`);
    assert.throws(() => terminal.planejar({ ...op, pasta: path.join(tmp, 'nao-existe') }), /não existe/);
  });

  await teste('abrirIA (simulado): prompt com tarefa, modelo escolhido, sem gravar nada', async () => {
    assert.ok((await projetos.adicionar({ nome: 'Jogo', pasta, modelo_padrao: 'opus' })).ok);
    const r = await abrirIA('jogo', { modo: 'novo', modelo: 'sonnet', tarefa: 'Arrumar a física do carro' }, { simular: true });
    assert.ok(r.ok, r.erro);
    assert.strictEqual(r.modelo, 'sonnet');
    const ultimo = r.plano.via === 'wt' ? r.plano.argv.at(-1) : r.plano.argv[3];
    assert.ok(ultimo.includes('buscar arrumar fisica carro --projeto jogo'), ultimo);
    assert.ok(ultimo.includes('comece esta tarefa: Arrumar a física do carro'));
    assert.ok(!ultimo.includes('dangerously'));
    assert.strictEqual((await projetos.listar()).dados.projetos[0].ultima_abertura, null, 'simulação não registra');
    // modelo desconhecido -> o padrão do projeto
    assert.strictEqual((await abrirIA('jogo', { modelo: 'gpt-5' }, { simular: true })).modelo, 'opus');
    const cont = await abrirIA('jogo', { modo: 'continuar', modelo: 'haiku' }, { simular: true });
    assert.ok(JSON.stringify(cont.plano.argv).includes('--continue') && !JSON.stringify(cont.plano.argv).includes('cerebro.py'));
    assert.ok(JSON.stringify((await abrirIA('jogo', { modo: 'retomar' }, { simular: true })).plano.argv).includes('--resume'));
    assert.strictEqual((await abrirIA('jogo', { modo: 'apagar-tudo' }, { simular: true })).ok, false);
  });

  await teste('pular permissões só com a opção ligada no projeto', async () => {
    assert.ok((await projetos.editar('jogo', { pular_permissoes: true })).ok);
    const r = await abrirIA('jogo', {}, { simular: true });
    assert.ok(r.pularPermissoes && JSON.stringify(r.plano.argv).includes('--dangerously-skip-permissions'));
    assert.ok((await projetos.editar('jogo', { pular_permissoes: false })).ok);
    assert.ok(!JSON.stringify((await abrirIA('jogo', {}, { simular: true })).plano.argv).includes('dangerously'));
  });

  await teste('registro da sessão: ultima_abertura e sessoes.jsonl', async () => {
    const r = await projetos.registrarSessao('jogo', { ia: 'claude', modelo: 'sonnet', tarefa: 'Arrumar o placar', modo: 'novo' });
    assert.ok(r.ok, r.erro);
    const linhas = fs.readFileSync(path.join(base, '.log', 'sessoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual([linhas[0].projeto, linhas[0].ia, linhas[0].modelo, linhas[0].tarefa], ['jogo', 'claude', 'sonnet', 'Arrumar o placar']);
    assert.match((await projetos.listar()).dados.projetos[0].ultima_abertura, /^\d{4}-\d{2}-\d{2}T/);
  });

  await teste('IA fora do PATH: explica como instalar, sem tentar instalar', async () => {
    const c = ias.obter('claude');
    const antes = c.executavel;
    c.executavel = 'claude-que-nao-existe-xyz';
    try {
      const r = await abrirIA('jogo', {}, { simular: true });
      assert.deepStrictEqual([r.ok, r.tipo], [false, 'semIA']);
      assert.strictEqual(r.instalar, 'irm https://claude.ai/install.ps1 | iex');
      assert.strictEqual(r.docs, 'https://code.claude.com/docs/en/setup');
    } finally { c.executavel = antes; }
  });

  await teste('chave de API: fora do ambiente por padrão, só passa com a opção; existência é só sim/não', () => {
    const c = ias.obter('claude');
    const base = { PATH: 'x', anthropic_api_key: 'sk-ant-segredo', CLAUDECODE: '1' };
    assert.deepStrictEqual(ias.ambiente(c, base), { PATH: 'x' }, 'padrão: a sessão usa o login da assinatura');
    assert.deepStrictEqual(ias.ambiente(c, base, { usarChave: true }), { PATH: 'x', anthropic_api_key: 'sk-ant-segredo' });
    assert.deepStrictEqual(ias.ambiente(c, base, { usarChave: 'true' }), { PATH: 'x' }, 'só true de verdade liga');
    assert.strictEqual(ias.temChave(c, base), true);
    assert.strictEqual(ias.temChave(c, { ANTHROPIC_API_KEY: '  ' }), false);
    assert.strictEqual(ias.temChave(c, { PATH: 'x' }), false);
    assert.ok(!JSON.stringify(ias.resumo()).includes('sk-'), 'o resumo para a tela não leva a chave');
    assert.strictEqual(typeof ias.resumo().claude.chaveNoAmbiente, 'boolean');
  });

  await teste('projeto com usar_api_key sem a variável no Windows: avisa (semChave) e não abre', async () => {
    assert.ok((await projetos.editar('jogo', { usar_api_key: true })).ok);
    const guardada = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await abrirIA('jogo', {}, { simular: true });
      assert.deepStrictEqual([r.ok, r.tipo, r.variavel], [false, 'semChave', 'ANTHROPIC_API_KEY']);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-so-para-o-teste';
      const ok = await abrirIA('jogo', {}, { simular: true });
      assert.ok(ok.ok && ok.usarChave === true);
      assert.ok(!JSON.stringify(ok).includes('sk-ant-so-para-o-teste'), 'o valor da chave nunca vai para o resultado');
    } finally {
      if (guardada === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = guardada;
    }
    assert.ok((await projetos.editar('jogo', { usar_api_key: false })).ok);
    assert.strictEqual((await abrirIA('jogo', {}, { simular: true })).usarChave, false);
  });

  const ultimoArg = (r) => (r.plano.via === 'wt' ? r.plano.argv.at(-1) : r.plano.argv[3]);

  await teste('retomada depois da pausa: prompt lê o estado do cérebro e não pede para explicar de novo', async () => {
    const r = await abrirIA('jogo', { retomada: true, tarefa: 'ignorada' }, { simular: true });
    assert.ok(r.ok, r.erro);
    const prompt = ultimoArg(r);
    assert.ok(prompt.includes('jogo estado proximos passos --projeto jogo'), prompt);
    assert.ok(prompt.includes('retome de onde paramos') && prompt.includes('sem me pedir para explicar tudo de novo'));
    assert.ok(!prompt.includes('ignorada') && !prompt.includes('aguarde minha tarefa'));
  });

  await teste('abrir só para ver o /usage: sessão vazia, comando na área de transferência, motivo "uso"', async () => {
    const copiado = [];
    const sim = await abrirIA('jogo', { semPrompt: true, comando: '/usage' }, { simular: true, copiar: (x) => copiado.push(x) });
    assert.ok(sim.ok, sim.erro);
    assert.ok(!JSON.stringify(sim.plano.argv).includes('cerebro.py'), 'sem prompt inicial');
    assert.deepStrictEqual(copiado, ['/usage']);
    assert.strictEqual(sim.aviso, 'Cole /usage (Ctrl+V) e dê Enter');
  });

  await teste('terminal embutido: abre dentro do widget, registra o PID direto e o /usage é digitado (não copiado)', async () => {
    const copiado = [];
    const registrados = [];
    let recebido = null;
    const registro = { listar: async () => [], adicionar: (s) => { registrados.push(s); return { id: 'x', ...s }; } };
    const r = await abrirIA('jogo', { semPrompt: true, comando: '/usage' }, {
      copiar: (x) => copiado.push(x), registro,
      embutido: async (o) => { recebido = o; return { termId: 't1', pid: 111, iaPid: 222 }; },
    });
    assert.ok(r.ok, r.erro);
    assert.deepStrictEqual([r.via, r.termId], ['widget', 't1']);
    assert.deepStrictEqual([recebido.programa, recebido.comandoInicial], ['claude', '/usage']);
    assert.ok(recebido.pasta && recebido.args.includes('--model') && recebido.env, 'o terminal recebe pasta, argumentos e ambiente já montados');
    assert.deepStrictEqual(copiado, [], 'não usa a área de transferência');
    assert.match(r.aviso, /Vou digitar \/usage/);
    assert.deepStrictEqual([registrados[0].via, registrados[0].iaPid, registrados[0].janelaPid, registrados[0].termId], ['widget', 222, 111, 't1']);
    // erro do terminal embutido: devolve o erro (não abre sessão fantasma nem cai em outra janela sem avisar)
    const e = await abrirIA('jogo', {}, { registro, embutido: async () => ({ erro: 'não consegui iniciar' }) });
    assert.deepStrictEqual([e.ok, e.erro], [false, 'não consegui iniciar']);
    assert.strictEqual(registrados.length, 1);
  });

  await teste('pausa pela ponte: lê e grava só estado atual/próximos passos e anota o motivo "limite"', async () => {
    const e0 = await projetos.estadoDaPausa('jogo');
    assert.ok(e0.ok, e0.erro);
    assert.strictEqual(e0.dados.arquivo, 'estado/jogo.md');
    const s = await projetos.salvarEstadoDaPausa('jogo', { estado_atual: 'Carro anda e freia.', proximos: '1. Curvas' });
    assert.ok(s.ok, s.erro);
    const e1 = (await projetos.estadoDaPausa('jogo')).dados;
    assert.deepStrictEqual([e1.estado_atual, e1.proximos], ['Carro anda e freia.', '1. Curvas']);
    assert.strictEqual((await projetos.registrarPausa('jogo', 'qualquer')).ok, false);
    const p = await projetos.registrarPausa('jogo', 'limite');
    assert.ok(p.ok, p.erro);
    const linhas = fs.readFileSync(path.join(base, '.log', 'sessoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const ultima = linhas.at(-1);
    assert.deepStrictEqual([ultima.modo, ultima.motivo, ultima.projeto], ['pausa', 'limite', 'jogo']);
    assert.match(ultima.data, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const lista = (await projetos.listar()).dados.projetos[0];
    assert.strictEqual(lista.pausa.motivo, 'limite');
    // abrir a sessão de retomada de verdade (registrada) desfaz a pausa pendente
    await projetos.registrarSessao('jogo', { ia: 'claude', modelo: 'sonnet', modo: 'novo', motivo: 'retomada' });
    assert.strictEqual((await projetos.listar()).dados.projetos[0].pausa, null);
  });

  await teste('uso local: conta as sessões do log e avisa Opus em sequência', async () => {
    const uso = require('../app/uso');
    const r = await uso.resumo(7);
    assert.ok(r.ok, r.erro);
    assert.strictEqual(r.dados.dias.length, 7);
    assert.ok(r.dados.total >= 1);
    assert.ok(/\/usage/.test(r.dados.nota) && /Não é o seu uso real/.test(r.dados.nota));
  });

  // ---------- fase 10.2: abrir o Antigravity (agy) pelo mesmo caminho ----------
  // um "agy" de mentira no PATH (nada é executado: os testes simulam ou usam um embutido falso)
  const falsoBin = path.join(tmp, 'falso-bin');
  fs.mkdirSync(falsoBin);
  fs.writeFileSync(path.join(falsoBin, 'agy.cmd'), '@echo off\r\necho AGY FALSO\r\n', 'utf8');
  const pathAntes = process.env.PATH;
  process.env.PATH = falsoBin + path.delimiter + pathAntes;
  const pasta2 = path.join(tmp, 'duas ias');
  fs.mkdirSync(pasta2);
  const adicionado = await projetos.adicionar({
    nome: 'Duas IAs', id: 'duas', pasta: pasta2, modelo_padrao: 'opus', ia_reserva: 'antigravity',
    modelos_por_ia: { antigravity: 'gemini-3.8-flash-low' },
  });
  assert.ok(adicionado.ok, adicionado.erro);
  assert.ok((await projetos.editar('duas', { pular_permissoes: true })).ok);
  const argv = (r) => ' ' + r.plano.argv.join(' ').replace(/"/g, ' ') + ' '; // vale para o wt (itens) e o cmd (uma linha)

  await teste('agy por modo: novo com --model e -i (prompt do cérebro), continuar com -c, retomar = semSuporte com a dica', async () => {
    const novo = await abrirIA('duas', { ia: 'antigravity', modo: 'novo', tarefa: 'arrumar o menu' }, { simular: true });
    assert.ok(novo.ok, novo.erro);
    assert.deepStrictEqual([novo.ia, novo.modelo], ['antigravity', 'gemini-3.8-flash-low'], 'modelo do modelos_por_ia do projeto');
    assert.ok(argv(novo).includes(' agy ') && argv(novo).includes(' --model gemini-3.8-flash-low ') && argv(novo).includes(' -i '), argv(novo));
    assert.ok(/cerebro\.py/.test(argv(novo)), 'o mesmo prompt inicial: manda consultar o cérebro');
    assert.ok(/Antigravity - Duas IAs/.test(argv(novo)), 'o título da janela usa o nome da IA');
    const cont = await abrirIA('duas', { ia: 'antigravity', modo: 'continuar' }, { simular: true });
    assert.ok(cont.ok && argv(cont).includes(' -c ') && !argv(cont).includes(' -i '), argv(cont));
    const ret = await abrirIA('duas', { ia: 'antigravity', modo: 'retomar' }, { simular: true });
    assert.deepStrictEqual([ret.ok, ret.tipo, ret.ia, ret.modo], [false, 'semSuporte', 'antigravity', 'retomar']);
    assert.ok(/Antigravity/.test(ret.erro) && /\/resume/.test(ret.dica), ret.erro + ' | ' + ret.dica);
  });

  await teste('a IA reserva NUNCA herda o "pular permissões" do projeto (só a IA padrão)', async () => {
    const claude = await abrirIA('duas', {}, { simular: true });
    assert.ok(claude.ok && claude.pularPermissoes === true && argv(claude).includes('--dangerously-skip-permissions'), 'na IA padrão (Claude) continua valendo');
    const agy = await abrirIA('duas', { ia: 'antigravity' }, { simular: true });
    assert.ok(agy.ok && agy.pularPermissoes === false && !argv(agy).includes('dangerously'), argv(agy));
  });

  await teste('IA pedida: só ids conhecidos; modelo cai em modelos_por_ia e depois no padrão da IA', async () => {
    for (const ruim of ['chatgpt', 'toString', '__proto__', { toString: () => 'claude' }, 7]) {
      const r = await abrirIA('duas', { ia: ruim }, { simular: true });
      assert.deepStrictEqual([r.ok, r.tipo], [false, 'erro'], 'recusa: ' + String(ruim));
      assert.ok(/IA desconhecida/.test(r.erro));
    }
    assert.strictEqual((await abrirIA('duas', { ia: 'antigravity', modelo: 'sonnet' }, { simular: true })).modelo, 'gemini-3.8-flash-low', 'modelo de outra IA: ignorado');
    assert.strictEqual((await abrirIA('duas', { ia: 'antigravity', modelo: 'gemini-4-argon-high' }, { simular: true })).modelo, 'gemini-4-argon-high');
    assert.strictEqual((await abrirIA('jogo', { ia: 'antigravity' }, { simular: true })).modelo, 'gemini-3.8-flash-medium', 'sem modelos_por_ia: o padrão da IA');
    assert.strictEqual((await abrirIA('duas', { ia: 'claude' }, { simular: true })).modelo, 'opus', 'a IA padrão pedida pelo nome: o modelo do projeto');
  });

  await teste('semChave e semIA citam a IA aberta (GEMINI_API_KEY; o instalador do agy)', async () => {
    assert.ok((await projetos.editar('duas', { usar_api_key: true })).ok);
    const antes = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await abrirIA('duas', { ia: 'antigravity' }, { simular: true });
      assert.deepStrictEqual([r.ok, r.tipo, r.variavel, r.ia], [false, 'semChave', 'GEMINI_API_KEY', 'antigravity']);
      assert.ok(/GEMINI_API_KEY/.test(r.erro) && /Antigravity/.test(r.erro));
    } finally {
      if (antes !== undefined) process.env.GEMINI_API_KEY = antes;
      assert.ok((await projetos.editar('duas', { usar_api_key: false })).ok);
    }
    const a = ias.obter('antigravity');
    const exe = a.executavel;
    a.executavel = 'agy-que-nao-existe-xyz';
    try {
      const r = await abrirIA('duas', { ia: 'antigravity' }, { simular: true });
      assert.deepStrictEqual([r.ok, r.tipo, r.ia], [false, 'semIA', 'antigravity']);
      assert.ok(/Antigravity/.test(r.erro) && /antigravity\.google\/cli\/install\.ps1/.test(r.instalar));
    } finally { a.executavel = exe; }
  });

  await teste('trava por pasta entre IAs: Claude aberto na pasta -> agy dá pastaOcupada (com a oferta de worktree)', async () => {
    const registro = { listar: async () => [{ id: 's1', projeto: 'duas', pasta: pasta2 + path.sep, ia: 'claude', nome: 'Duas IAs' }], adicionar: () => { throw new Error('não devia registrar'); } };
    const r = await abrirIA('duas', { ia: 'antigravity' }, { simular: true, registro });
    assert.deepStrictEqual([r.ok, r.tipo, r.podeWorktree, r.sessao.ia], [false, 'pastaOcupada', true, 'claude']);
    const contrario = await abrirIA('duas', {}, { simular: true, registro: { listar: async () => [{ pasta: pasta2.toUpperCase(), ia: 'antigravity' }] } });
    assert.strictEqual(contrario.tipo, 'pastaOcupada', 'e o contrário também (pasta comparada sem maiúsculas)');
  });

  await teste('prompt inicial numa IA sem prompt por argumento: digitado no embutido, copiado no externo', async () => {
    const a = ias.obter('antigravity');
    const antes = a.promptPorArgumento;
    a.promptPorArgumento = false; // uma IA assim (o agy aceita -i; aqui é só para testar o caminho)
    try {
      // embutido que aceita digitar: o prompt vai como comandoInicial (texto do montarPrompt, nunca da tela) e nada é copiado
      let recebido = null;
      const copiados = [];
      const r = await abrirIA('duas', { ia: 'antigravity', tarefa: 'teste' }, {
        copiar: (x) => copiados.push(x), embutido: async (o) => { recebido = o; return { termId: 't9', pid: 1, iaPid: 2, comandoAceito: true }; },
      });
      assert.ok(r.ok, r.erro);
      assert.ok(!recebido.args.includes('-i') && /cerebro\.py/.test(recebido.comandoInicial), 'sem -i; o prompt do cérebro vai para ser digitado');
      assert.strictEqual(recebido.ia, 'antigravity', 'o embutido sabe a IA (as telas dela)');
      assert.deepStrictEqual(copiados, []);
      assert.match(r.aviso, /Vou digitar o prompt inicial quando o Antigravity estiver pronto/);
      // embutido sem telas confirmadas (comandoAceito false): vai para a área de transferência
      const copiados2 = [];
      const r2 = await abrirIA('duas', { ia: 'antigravity', tarefa: 'teste' }, { copiar: (x) => copiados2.push(x), embutido: async () => ({ termId: 't8', pid: 1, iaPid: 2, comandoAceito: false }) });
      assert.ok(r2.ok && copiados2.length === 1 && /cerebro\.py/.test(copiados2[0]) && r2.aviso === 'Cole o prompt inicial (Ctrl+V)');
      // terminal externo
      const copiados3 = [];
      const r3 = await abrirIA('duas', { ia: 'antigravity' }, { simular: true, copiar: (x) => copiados3.push(x) });
      assert.ok(r3.ok && copiados3.length === 1 && r3.aviso === 'Cole o prompt inicial (Ctrl+V)' && !argv(r3).includes(' -i '));
    } finally { a.promptPorArgumento = antes; }
  });

  await teste('o registro guarda a IA aberta (sessoes.jsonl com ia "antigravity") e o nome do processo', async () => {
    const adicionados = [];
    const r = await abrirIA('duas', { ia: 'antigravity', modo: 'continuar' }, {
      registro: { listar: async () => [], adicionar: (s) => { adicionados.push(s); return { id: 'x', ...s }; } },
      embutido: async () => ({ termId: 't7', pid: 11, iaPid: 12, comandoAceito: false }),
    });
    assert.ok(r.ok, r.erro);
    assert.deepStrictEqual([adicionados[0].ia, adicionados[0].processo, adicionados[0].executavel], ['antigravity', 'agy.exe', 'agy']);
    const linhas = fs.readFileSync(path.join(base, '.log', 'sessoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const ultima = linhas[linhas.length - 1];
    assert.deepStrictEqual([ultima.projeto, ultima.ia, ultima.modelo, ultima.modo], ['duas', 'antigravity', 'gemini-3.8-flash-low', 'continuar']);
  });

  await teste('comando pedido pela tela: só os "comandosUteis" da IA aberta', async () => {
    const c1 = [];
    const r = await abrirIA('duas', { ia: 'antigravity', semPrompt: true, comando: '/usage' }, { simular: true, copiar: (x) => c1.push(x) });
    assert.ok(r.ok && c1[0] === '/usage');
    const c2 = [];
    const r2 = await abrirIA('duas', { ia: 'antigravity', semPrompt: true, comando: '/logout' }, { simular: true, copiar: (x) => c2.push(x) });
    assert.ok(r2.ok && c2.length === 0 && r2.aviso === '', 'comando fora da lista: ignorado');
  });

  // ---------- fase 10.8: continuar em outra IA ----------
  await teste('continuar em outra IA: retomada na IA reserva lê o estado do cérebro, usa o modelo dela e não leva tarefa', async () => {
    const r = await abrirIA('duas', { ia: 'antigravity', retomada: true, tarefa: 'ignorada', semPularPermissoes: true }, { simular: true });
    assert.ok(r.ok, r.erro);
    assert.deepStrictEqual([r.ia, r.modelo, r.pularPermissoes], ['antigravity', 'gemini-3.8-flash-low', false]);
    const texto = argv(r);
    assert.ok(texto.includes(' agy ') && texto.includes(' -i '), texto);
    assert.ok(texto.includes('duas estado proximos passos --projeto duas') && texto.includes('retome de onde paramos'), texto);
    assert.ok(!texto.includes('ignorada') && !texto.includes('aguarde minha tarefa') && !texto.includes('dangerously'));
  });

  await teste('pular permissões nunca é herdado ao continuar em outra IA (nem na IA padrão, com semPularPermissoes)', async () => {
    assert.ok((await abrirIA('duas', {}, { simular: true })).pularPermissoes === true, 'sem a opção, a IA padrão continua com o que o projeto escolheu');
    const sem = await abrirIA('duas', { semPularPermissoes: true }, { simular: true });
    assert.ok(sem.ok && sem.pularPermissoes === false && !argv(sem).includes('dangerously'), argv(sem));
    for (const quase of ['true', 1, 'sim']) {
      assert.ok((await abrirIA('duas', { semPularPermissoes: quase }, { simular: true })).pularPermissoes === true, 'só true de verdade desliga: ' + String(quase));
    }
    // projeto cuja IA padrão é o agy, com o "pular" ligado: continuar nele depois de pausar no Claude também não pula
    const pasta3 = path.join(tmp, 'agy padrao');
    fs.mkdirSync(pasta3);
    assert.ok((await projetos.adicionar({ nome: 'Agy Padrao', id: 'agy-padrao', pasta: pasta3, ia: 'antigravity', ia_reserva: 'claude' })).ok);
    assert.ok((await projetos.editar('agy-padrao', { pular_permissoes: true })).ok);
    assert.ok((await abrirIA('agy-padrao', {}, { simular: true })).pularPermissoes === true);
    const volta = await abrirIA('agy-padrao', { ia: 'antigravity', retomada: true, semPularPermissoes: true }, { simular: true });
    assert.ok(volta.ok && volta.pularPermissoes === false && !argv(volta).includes('dangerously'), argv(volta));
    const claude = await abrirIA('agy-padrao', { ia: 'claude', retomada: true, semPularPermissoes: true }, { simular: true });
    assert.ok(claude.ok && claude.pularPermissoes === false, 'a IA reserva nunca herda');
  });

  await teste('chave de API por IA: o agy abre SEM a GEMINI_API_KEY mesmo existindo no Windows, a menos que o projeto ligue', async () => {
    const guardada = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-so-para-o-teste';
    try {
      const sem = await abrirIA('duas', { ia: 'antigravity' }, { simular: true });
      assert.ok(sem.ok && sem.usarChave === false);
      assert.ok(!('GEMINI_API_KEY' in ias.ambiente(ias.obter('antigravity'), process.env)), 'a variável é retirada do ambiente do agy');
      assert.ok(('GEMINI_API_KEY' in ias.ambiente(ias.obter('antigravity'), process.env, { usarChave: true })), 'só com a opção ligada ela passa');
      assert.ok((await projetos.editar('duas', { usar_api_key: true })).ok);
      const com = await abrirIA('duas', { ia: 'antigravity' }, { simular: true });
      assert.ok(com.ok && com.usarChave === true);
      assert.ok(!JSON.stringify(com).includes('AIza-so-para-o-teste'), 'o valor nunca vai para o resultado');
      assert.ok((await projetos.editar('duas', { usar_api_key: false })).ok);
    } finally {
      if (guardada === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = guardada;
    }
  });

  process.env.PATH = pathAntes;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} testes passaram${process.exitCode ? ' (houve falhas)' : ''}`);
})();
