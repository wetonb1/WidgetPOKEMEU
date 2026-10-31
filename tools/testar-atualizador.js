// Testa o app/atualizador.js: o que atualiza, o que NUNCA toca (dados do usuário), o desfazer e a descompactação real.
// Não usa a rede (o SHA e o download são simulados); o tar é o do sistema.
//   node tools/testar-atualizador.js     (ou: npm run testar-atualizador)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const at = require('../app/atualizador');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atualizador-teste-'));
const gravar = (base, rel, texto) => { const p = path.join(base, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, texto, 'utf8'); };
const ler = (base, rel) => fs.readFileSync(path.join(base, ...rel.split('/')), 'utf8');
const existe = (base, rel) => fs.existsSync(path.join(base, ...rel.split('/')));
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const CONFIG = { repo: 'dono/projeto', branch: 'devs(ubunto)' };

// uma versão "nova" completa do widget, com arquivos de código E arquivos que são dados do usuário
function montarVersaoNova(base) {
  gravar(base, 'package.json', JSON.stringify({ main: 'app/main.js', devDependencies: { electron: '^45.0.0' } }));
  gravar(base, 'app/main.js', 'NOVO main');
  gravar(base, 'app/index.html', 'NOVO index');
  gravar(base, 'app/preload.js', 'NOVO preload');
  gravar(base, 'app/atualizador.js', 'NOVO atualizador');
  gravar(base, 'app/recurso-novo.js', 'recurso novo');
  gravar(base, 'cerebro/tools/cerebro.py', 'NOVO cerebro.py');
  gravar(base, 'cerebro/conversas/exemplo-do-dev.md', 'conversa pessoal do dev');
  gravar(base, 'cerebro/estado/meu-widget.md', 'estado do dev');
  gravar(base, 'cerebro/INDICE.md', 'indice do dev');
  gravar(base, 'projetos.json', '[{"id":"do-dev"}]');
  gravar(base, 'importacoes/segredo.txt', 'x');
  gravar(base, '.claude/commands/x.md', 'x');
  gravar(base, 'app/__pycache__/x.pyc', 'lixo');
  gravar(base, 'skills-biblioteca/catalogo.json', JSON.stringify({ skills: [
    { nome: 'cerebro-buscar', titulo: 'NOVO titulo', origem: 'local' },
    { nome: 'skill-nova', titulo: 'Skill nova', origem: 'local' },
    { nome: 'importada', titulo: 'do dev', origem: 'local' },
  ] }));
  gravar(base, 'skills-biblioteca/skills.py', 'NOVO skills.py');
}

function montarInstalacaoDoUsuario(raiz) {
  gravar(raiz, 'package.json', JSON.stringify({ main: 'app/main.js', devDependencies: { electron: '^45.0.0' } }));
  gravar(raiz, 'app/main.js', 'ANTIGO main');
  gravar(raiz, 'app/antigo-so-do-usuario.js', 'fica');
  gravar(raiz, 'cerebro/tools/cerebro.py', 'ANTIGO cerebro.py');
  gravar(raiz, 'cerebro/conversas/minha-conversa.md', 'MINHA CONVERSA');
  gravar(raiz, 'cerebro/estado/meu-widget.md', 'MEU ESTADO');
  gravar(raiz, 'cerebro/INDICE.md', 'MEU INDICE');
  gravar(raiz, 'cerebro/sinonimos.json', '{"meu":"termo"}');
  gravar(raiz, 'projetos.json', '[{"id":"meu-projeto"}]');
  gravar(raiz, 'importacoes/meu-arquivo.txt', 'meu');
  gravar(raiz, 'node_modules/pacote/index.js', 'modulo');
  gravar(raiz, 'skills-biblioteca/catalogo.json', JSON.stringify({ skills: [
    { nome: 'cerebro-buscar', titulo: 'ANTIGO titulo', origem: 'local' },
    { nome: 'importada', titulo: 'MINHA skill importada', origem: 'github:alguem/repo' },
  ] }));
  gravar(raiz, 'skills-biblioteca/minha-skill/SKILL.md', 'minha skill');
}

let n = 0;
const teste = async (nome, fn) => {
  try { await fn(); n++; console.log('ok   ' + nome); } catch (e) { console.log('FALHOU ' + nome + '\n  ' + e.message); process.exitCode = 1; }
};

(async () => {
  await teste('caminhos protegidos (dados do usuário)', () => {
    for (const p of ['projetos.json', 'cerebro/conversas/a.md', 'cerebro/estado/.anteriores/x.md', 'cerebro/indices/x.md', 'cerebro/.log/consultas.jsonl',
      'cerebro/INDICE.md', 'cerebro/sinonimos.json', 'importacoes/x', '.git/config', 'node_modules/x/y.js', '.claude/skills/x.md']) assert.ok(at.ehProtegido(p), p);
    for (const p of ['app/main.js', 'cerebro/tools/cerebro.py', 'cerebro/README.md', 'skills-biblioteca/skills.py', 'docs/WIDGET.md', 'package.json']) assert.ok(!at.ehProtegido(p), p);
  });

  await teste('aplicar: troca o código, mantém TODOS os dados, nada é apagado', () => {
    const origem = path.join(tmp, 'a-origem');
    const raiz = path.join(tmp, 'a-raiz');
    montarVersaoNova(origem);
    montarInstalacaoDoUsuario(raiz);
    const r = at.aplicar({ origem, raiz, backup: path.join(tmp, 'a-backup') });
    // código novo
    assert.strictEqual(ler(raiz, 'app/main.js'), 'NOVO main');
    assert.strictEqual(ler(raiz, 'app/recurso-novo.js'), 'recurso novo');
    assert.strictEqual(ler(raiz, 'cerebro/tools/cerebro.py'), 'NOVO cerebro.py');
    assert.strictEqual(ler(raiz, 'skills-biblioteca/skills.py'), 'NOVO skills.py');
    // dados do usuário intactos
    assert.strictEqual(ler(raiz, 'cerebro/conversas/minha-conversa.md'), 'MINHA CONVERSA');
    assert.strictEqual(ler(raiz, 'cerebro/estado/meu-widget.md'), 'MEU ESTADO');
    assert.strictEqual(ler(raiz, 'cerebro/INDICE.md'), 'MEU INDICE');
    assert.strictEqual(ler(raiz, 'cerebro/sinonimos.json'), '{"meu":"termo"}');
    assert.strictEqual(ler(raiz, 'projetos.json'), '[{"id":"meu-projeto"}]');
    assert.strictEqual(ler(raiz, 'importacoes/meu-arquivo.txt'), 'meu');
    assert.strictEqual(ler(raiz, 'node_modules/pacote/index.js'), 'modulo');
    assert.strictEqual(ler(raiz, 'skills-biblioteca/minha-skill/SKILL.md'), 'minha skill');
    // dados do dev que vieram no pacote NÃO entram
    for (const p of ['cerebro/conversas/exemplo-do-dev.md', 'importacoes/segredo.txt', '.claude/commands/x.md', 'app/__pycache__/x.pyc']) assert.ok(!existe(raiz, p), p);
    // nada é apagado
    assert.ok(existe(raiz, 'app/antigo-so-do-usuario.js'));
    // catálogo: oficial atualiza, nova entra, a importada do usuário fica
    const cat = JSON.parse(ler(raiz, 'skills-biblioteca/catalogo.json')).skills;
    assert.strictEqual(cat.find((s) => s.nome === 'cerebro-buscar').titulo, 'NOVO titulo');
    assert.ok(cat.some((s) => s.nome === 'skill-nova'));
    assert.strictEqual(cat.find((s) => s.nome === 'importada').titulo, 'MINHA skill importada');
    // backup do que foi trocado, e o resumo
    assert.strictEqual(ler(path.join(tmp, 'a-backup'), 'app/main.js'), 'ANTIGO main');
    assert.ok(r.atualizados >= 3 && r.novos >= 2 && r.depsMudaram === false, JSON.stringify(r));
    // segunda vez: nada muda
    const r2 = at.aplicar({ origem, raiz, backup: path.join(tmp, 'a-backup') });
    assert.deepStrictEqual([r2.atualizados, r2.novos], [0, 0]);
  });

  await teste('aplicar: aviso quando as dependências do package.json mudam', () => {
    const origem = path.join(tmp, 'd-origem');
    const raiz = path.join(tmp, 'd-raiz');
    montarVersaoNova(origem);
    gravar(origem, 'package.json', JSON.stringify({ main: 'app/main.js', devDependencies: { electron: '^99.0.0' } }));
    montarInstalacaoDoUsuario(raiz);
    assert.strictEqual(at.aplicar({ origem, raiz, backup: path.join(tmp, 'd-backup') }).depsMudaram, true);
  });

  await teste('aplicar: se falhar no meio, desfaz tudo', () => {
    const origem = path.join(tmp, 'f-origem');
    const raiz = path.join(tmp, 'f-raiz');
    gravar(origem, 'app/a.js', 'NOVO a');
    gravar(origem, 'zzz/sub.js', 'NOVO sub');
    gravar(raiz, 'app/a.js', 'ANTIGO a');
    gravar(raiz, 'zzz', 'sou um arquivo, não uma pasta'); // o mkdir de "zzz" vai falhar
    assert.throws(() => at.aplicar({ origem, raiz, backup: path.join(tmp, 'f-backup') }), /desfeita/);
    assert.strictEqual(ler(raiz, 'app/a.js'), 'ANTIGO a');
    assert.strictEqual(ler(raiz, 'zzz'), 'sou um arquivo, não uma pasta');
    assert.ok(!existe(raiz, 'app/a.js.atualizando'));
  });

  await teste('verificar: primeira vez vira ponto de partida; igual = sem botão; commit novo = botão', async () => {
    const raiz = path.join(tmp, 'v-raiz');
    const pasta = path.join(tmp, 'v-config');
    fs.mkdirSync(raiz);
    let sha = SHA1;
    const buscarSha = async () => sha;
    const a = await at.verificar({ raiz, pastaConfig: pasta, config: CONFIG, buscarSha });
    assert.deepStrictEqual([a.disponivel, a.primeiraVez], [false, true]);
    assert.strictEqual((await at.verificar({ raiz, pastaConfig: pasta, config: CONFIG, buscarSha })).disponivel, false);
    sha = SHA2;
    const c = await at.verificar({ raiz, pastaConfig: pasta, config: CONFIG, buscarSha });
    assert.deepStrictEqual([c.disponivel, c.atual, c.remoto], [true, SHA1, SHA2]);
    // outra branch no registro não vale
    const outra = await at.verificar({ raiz, pastaConfig: pasta, config: { ...CONFIG, branch: 'outra' }, buscarSha });
    assert.strictEqual(outra.primeiraVez, true);
  });

  await teste('verificar: clone git na mesma branch conta como instalado (e em outra branch não)', async () => {
    const raiz = path.join(tmp, 'g-raiz');
    const pasta = path.join(tmp, 'g-config');
    gravar(raiz, '.git/HEAD', 'ref: refs/heads/devs(ubunto)\n');
    gravar(raiz, '.git/refs/heads/devs(ubunto)', SHA1 + '\n');
    assert.strictEqual(at.shaDoGit(raiz, 'devs(ubunto)'), SHA1);
    assert.strictEqual(at.shaDoGit(raiz, 'main'), null);
    const igual = await at.verificar({ raiz, pastaConfig: pasta, config: CONFIG, buscarSha: async () => SHA1 });
    assert.deepStrictEqual([igual.disponivel, igual.primeiraVez], [false, false]);
    const novo = await at.verificar({ raiz, pastaConfig: pasta, config: CONFIG, buscarSha: async () => SHA2 });
    assert.deepStrictEqual([novo.disponivel, novo.atual], [true, SHA1]);
    // ref só no packed-refs
    gravar(raiz, '.git/packed-refs', `# pack-refs\n${SHA2} refs/heads/devs(ubunto)\n`);
    fs.rmSync(path.join(raiz, '.git', 'refs'), { recursive: true });
    assert.strictEqual(at.shaDoGit(raiz, 'devs(ubunto)'), SHA2);
  });

  await teste('atualizar: tarball real (tar do sistema), aplica, registra o commit e limpa a pasta temporária', async () => {
    const fonte = path.join(tmp, 't-fonte');
    const topo = 'WidgetPOKEMEU-devs-ubunto-' + SHA2.slice(0, 7);
    montarVersaoNova(path.join(fonte, topo));
    const tgz = path.join(tmp, 'versao.tar.gz');
    execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-czf', tgz, '-C', fonte, topo]);
    const raiz = path.join(tmp, 't-raiz');
    const pasta = path.join(tmp, 't-config');
    montarInstalacaoDoUsuario(raiz);
    let pedido = null;
    const r = await at.atualizar({
      raiz, pastaConfig: pasta, config: CONFIG,
      buscarSha: async () => SHA2,
      baixar: async (cfg, sha, destino) => { pedido = sha; fs.copyFileSync(tgz, destino); },
    });
    assert.strictEqual(pedido, SHA2); // baixa o commit exato que foi anunciado
    assert.strictEqual(r.sha, SHA2);
    assert.strictEqual(ler(raiz, 'app/main.js'), 'NOVO main');
    assert.strictEqual(ler(raiz, 'projetos.json'), '[{"id":"meu-projeto"}]');
    assert.strictEqual(ler(raiz, 'cerebro/conversas/minha-conversa.md'), 'MINHA CONVERSA');
    assert.strictEqual(at.lerRegistro(pasta, CONFIG), SHA2);
    // depois de atualizar, não aparece mais o botão
    assert.strictEqual((await at.verificar({ raiz, pastaConfig: pasta, config: CONFIG, buscarSha: async () => SHA2 })).disponivel, false);
  });

  await teste('atualizar: pacote incompleto ou estranho é recusado sem mexer em nada', async () => {
    const raiz = path.join(tmp, 'r-raiz');
    montarInstalacaoDoUsuario(raiz);
    const fonte = path.join(tmp, 'r-fonte');
    gravar(fonte, 'pacote-estranho/leiame.txt', 'nada de widget aqui');
    const tgz = path.join(tmp, 'ruim.tar.gz');
    execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-czf', tgz, '-C', fonte, 'pacote-estranho']);
    await assert.rejects(at.atualizar({
      raiz, pastaConfig: path.join(tmp, 'r-config'), config: CONFIG,
      buscarSha: async () => SHA2, baixar: async (c, s, destino) => fs.copyFileSync(tgz, destino),
    }), /incompleta/);
    assert.strictEqual(ler(raiz, 'app/main.js'), 'ANTIGO main');
    assert.strictEqual(at.lerRegistro(path.join(tmp, 'r-config'), CONFIG), null);
  });

  await teste('a config que acompanha o widget (app/atualizacao.json) é válida', () => {
    const c = at.lerConfig(path.join(__dirname, '..', 'app'));
    assert.match(c.repo, /^[\w.-]+\/[\w.-]+$/);
    assert.ok(c.branch.length > 0);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} testes passaram${process.exitCode ? ' (houve falhas)' : ''}`);
})();
