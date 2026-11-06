// Teste do catálogo online de skills (app/catalogo-skills.js) contra um "GitHub de mentira" numa porta local: nada sai para a internet.
// uso: npm run testar-catalogo
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { criarCatalogo, cabecalhoSkill, FONTES, ACERVO, prepararTermos, pontuar, juntarAvaliacao } = require('../app/catalogo-skills');

let falhas = 0;
const teste = async (nome, fn) => {
  try { await fn(); console.log('ok    ' + nome); } catch (e) { falhas++; console.log('FALHOU ' + nome + '\n      ' + String(e.stack || e).split('\n').slice(0, 3).join('\n      ')); }
};

const PDF_MD = '---\nname: pdf\ndescription: Use para PDFs: ler, juntar e dividir\nlicense: MIT\n---\n# PDF\n';
const XLS_MD = '---\nname: "planilha"\ndescription: >-\n  Cria e edita planilhas\n  do Excel (xlsx)\n---\n# Planilha\n';
const GRANDE = 'x'.repeat(2000);
const REPOS = {
  'dono/skills': {
    tree: [
      { path: 'README.md', type: 'blob', size: 10 },
      { path: 'skills/pdf/SKILL.md', type: 'blob', size: PDF_MD.length },
      { path: 'skills/pdf/scripts/ler.py', type: 'blob', size: 12 },
      { path: 'skills/pdf/LICENSE.txt', type: 'blob', size: 5 },
      { path: 'skills/xlsx/SKILL.md', type: 'blob', size: XLS_MD.length },
      { path: 'template/SKILL.md', type: 'blob', size: 20 },
      { path: 'skills/evil/SKILL.md', type: 'blob', size: 10 },
      { path: 'skills/evil/../../fora.txt', type: 'blob', size: 5 },
      { path: 'skills/enorme/SKILL.md', type: 'blob', size: 10 },
      { path: 'skills/enorme/dados.bin', type: 'blob', size: 30 * 1024 * 1024 },
      { path: 'skills/sub', type: 'tree' },
    ],
    arquivos: {
      'skills/pdf/SKILL.md': PDF_MD, 'skills/pdf/scripts/ler.py': 'print(1)\n', 'skills/pdf/LICENSE.txt': 'MIT\n', 'skills/xlsx/SKILL.md': XLS_MD,
      'skills/evil/SKILL.md': '---\nname: evil\n---\n', 'skills/evil/../../fora.txt': 'pwn\n', 'skills/enorme/SKILL.md': '---\nname: enorme\n---\n',
    },
  },
  'dono/muitos': {
    tree: Array.from({ length: 310 }, (_, i) => ({ path: `s/a${i}.txt`, type: 'blob', size: 3 })).concat([{ path: 's/SKILL.md', type: 'blob', size: 10 }]),
    arquivos: { 's/SKILL.md': '---\nname: muitos\n---\n' },
  },
};

let pedidos = [];
let modo = 'ok'; // ok | limite | cai
const servidor = http.createServer((req, res) => {
  pedidos.push(req.url);
  const url = new URL(req.url, 'http://x');
  const responder = (status, corpo, tipo = 'application/json') => { res.writeHead(status, { 'Content-Type': tipo }); res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo)); };
  if (modo === 'limite') return responder(403, { message: 'API rate limit exceeded' });
  let m = /^\/repos\/([^/]+\/[^/]+)\/git\/trees\/HEAD$/.exec(url.pathname);
  if (m) return REPOS[m[1]] ? responder(200, { sha: 'abc', truncated: false, tree: REPOS[m[1]].tree }) : responder(404, { message: 'Not Found' });
  if (url.pathname === '/search/repositories') {
    const q = decodeURIComponent(url.searchParams.get('q'));
    const itens = q.includes('agent-skills')
      ? [{ full_name: 'dono/skills', description: 'Skills do dono', stargazers_count: 50, pushed_at: '2026-05-01T10:00:00Z' }, { full_name: 'lixo/../x', description: 'inválido', stargazers_count: 999 }]
      : [{ full_name: 'dono/skills', description: 'repetido', stargazers_count: 50 }, { full_name: 'outra/pessoa', description: 'Claude skills', stargazers_count: 80, pushed_at: '2026-04-01T00:00:00Z' }];
    return responder(200, { total_count: itens.length, items: itens });
  }
  m = /^\/([^/]+\/[^/]+)\/HEAD\/(.+)$/.exec(url.pathname);
  if (m) {
    const repo = REPOS[m[1]];
    const arq = repo && repo.arquivos[decodeURIComponent(m[2])];
    return arq === undefined ? responder(404, 'nao existe', 'text/plain') : responder(200, arq, 'text/plain');
  }
  return responder(404, { message: 'Not Found' });
});

(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogo-teste-'));
  const cache = path.join(pasta, 'cache.json');
  const novo = () => criarCatalogo({ api: base, raw: base, arquivoCache: cache });
  let cat = novo();

  await teste('cabeçalho do SKILL.md: aspas, bloco > e campos que faltam', () => {
    assert.deepStrictEqual([cabecalhoSkill(PDF_MD).name, cabecalhoSkill(PDF_MD).description], ['pdf', 'Use para PDFs: ler, juntar e dividir']);
    assert.deepStrictEqual([cabecalhoSkill(XLS_MD).name, cabecalhoSkill(XLS_MD).description], ['planilha', 'Cria e edita planilhas do Excel (xlsx)']);
    assert.deepStrictEqual(cabecalhoSkill('sem cabeçalho'), {});
  });
  await teste('as fontes: Anthropic, OpenAI e bibliotecas oficiais/comunidade vêm prontas, mais busca e "outro repositório"', () => {
    const ids = FONTES.map((f) => f.id);
    assert.strictEqual(ids[0], 'anthropics/skills');
    assert.strictEqual(ids[1], 'openai/skills');
    assert.ok(ids.includes('microsoft/skills') && ids.includes('google/skills') && ids.includes('arjun988/blender-skills'));
    assert.deepStrictEqual(ids.slice(-2), ['comunidade', 'outro']);
    assert.ok(ACERVO.length >= 50, 'acervo amplo de bibliotecas de skills');
  });
  await teste('nomes de repositório inválidos são recusados', () => {
    for (const ruim of ['', 'a', 'a/b/c', '../x', 'a/..', 'a b/c', 'dono/repo?x=1', null, 42]) assert.throws(() => cat.validarRepo(ruim), /inválido/);
    assert.strictEqual(cat.validarRepo('anthropics/skills'), 'anthropics/skills');
  });

  await teste('listar: acha as pastas com SKILL.md (sem os modelos em branco) com nome, descrição e nº de arquivos', async () => {
    const r = await cat.listar('dono/skills');
    const nomes = r.itens.map((i) => i.nome).sort();
    assert.deepStrictEqual(nomes, ['enorme', 'evil', 'pdf', 'planilha']);
    const pdf = r.itens.find((i) => i.nome === 'pdf');
    assert.deepStrictEqual([pdf.caminho, pdf.arquivos, pdf.descricao, pdf.repo], ['skills/pdf', 3, 'Use para PDFs: ler, juntar e dividir', 'dono/skills']);
    assert.strictEqual(r.itens.find((i) => i.nome === 'planilha').descricao, 'Cria e edita planilhas do Excel (xlsx)');
    assert.strictEqual(r.offline, false);
    assert.strictEqual(r.total, 4);
  });
  await teste('a segunda consulta vem da memória: nenhum pedido novo à internet', async () => {
    const antes = pedidos.length;
    const r = await cat.listar('dono/skills');
    assert.strictEqual(pedidos.length, antes);
    assert.strictEqual(r.itens.length, 4);
  });
  await teste('o filtro acha pelo texto da descrição (planilha -> excel)', async () => {
    const r = await cat.listar('dono/skills', 'EXCEL');
    assert.deepStrictEqual(r.itens.map((i) => i.nome), ['planilha']);
    assert.strictEqual((await cat.listar('dono/skills', 'nada-disso')).itens.length, 0);
  });
  await teste('repositório que não existe: erro claro', async () => {
    await assert.rejects(() => cat.listar('dono/inexistente'), (e) => e.tipo === 'naoEncontrado' && /não encontrei/.test(e.message));
  });

  await teste('comunidade: junta os dois tópicos, tira repetidos e nomes inválidos, mais estrelados primeiro', async () => {
    const r = await cat.repositorios('pdf');
    assert.deepStrictEqual(r.repos.map((x) => x.repo), ['outra/pessoa', 'dono/skills']);
    assert.deepStrictEqual([r.repos[0].estrelas, r.repos[1].descricao, r.repos[1].atualizado], [80, 'Skills do dono', '2026-05-01']);
  });

  await teste('sem internet: usa a lista guardada no disco e diz que é antiga', async () => {
    const offline = criarCatalogo({ api: 'http://127.0.0.1:1', raw: 'http://127.0.0.1:1', arquivoCache: cache }); // porta fechada
    const r = await offline.listar('dono/skills');
    assert.strictEqual(r.offline, true);
    assert.ok(r.quando > 0 && /conexão|internet/.test(r.motivo), r.motivo);
    assert.deepStrictEqual(r.itens.map((i) => i.nome).sort(), ['enorme', 'evil', 'pdf', 'planilha']);
    assert.strictEqual(r.itens.find((i) => i.nome === 'pdf').descricao, 'Use para PDFs: ler, juntar e dividir');
    await assert.rejects(() => offline.listar('dono/outro-que-nunca-abri'), (e) => e.tipo === 'rede');
  });
  await teste('limite do GitHub (403): explica; com lista guardada ainda mostra', async () => {
    modo = 'limite';
    try {
      const limpo = criarCatalogo({ api: base, raw: base, arquivoCache: path.join(pasta, 'vazio.json') });
      await assert.rejects(() => limpo.listar('dono/skills'), (e) => e.tipo === 'limite' && /60 por hora/.test(e.message));
      const comCache = criarCatalogo({ api: base, raw: base, arquivoCache: cache });
      const r = await comCache.listar('dono/skills');
      assert.ok(r.offline && /limitou/.test(r.motivo));
    } finally { modo = 'ok'; }
  });

  await teste('baixar: traz só a pasta da skill (com subpastas) para uma pasta temporária', async () => {
    const destino = path.join(pasta, 'baixadas');
    const b = await cat.baixar('dono/skills', 'skills/pdf', destino);
    assert.deepStrictEqual([b.nome, b.arquivos], ['pdf', 3]);
    assert.strictEqual(b.pasta, path.join(destino, 'pdf'));
    assert.strictEqual(fs.readFileSync(path.join(b.pasta, 'SKILL.md'), 'utf8'), PDF_MD);
    assert.strictEqual(fs.readFileSync(path.join(b.pasta, 'scripts', 'ler.py'), 'utf8'), 'print(1)\n');
    assert.deepStrictEqual(fs.readdirSync(destino), ['pdf']);
  });
  await teste('baixar de novo recomeça do zero (não sobra arquivo antigo)', async () => {
    const destino = path.join(pasta, 'baixadas');
    fs.writeFileSync(path.join(destino, 'pdf', 'velho.txt'), 'x');
    await cat.baixar('dono/skills', 'skills/pdf', destino);
    assert.ok(!fs.existsSync(path.join(destino, 'pdf', 'velho.txt')));
  });
  await teste('um arquivo com caminho "../" no repositório é recusado e nada é gravado fora da pasta', async () => {
    const destino = path.join(pasta, 'seguro');
    await assert.rejects(() => cat.baixar('dono/skills', 'skills/evil', destino), /suspeito/);
    assert.ok(!fs.existsSync(path.join(destino, 'fora.txt')) && !fs.existsSync(path.join(pasta, 'fora.txt')) && !fs.existsSync(path.join(destino, '..', 'fora.txt')));
  });
  await teste('caminhos inválidos, pasta sem SKILL.md, arquivo grande e pastas com arquivos demais', async () => {
    const d = path.join(pasta, 'x');
    for (const ruim of ['../x', 'a/../b', '/abs', 'c:/x', 'a\\b', 'a'.repeat(400)]) await assert.rejects(() => cat.baixar('dono/skills', ruim, d), /caminho inválido/);
    await assert.rejects(() => cat.baixar('dono/skills', 'skills/nao-tem', d), (e) => e.tipo === 'naoEncontrado');
    await assert.rejects(() => cat.baixar('dono/skills', 'skills/enorme', d), (e) => e.tipo === 'grande' && /25 MB/.test(e.message));
    await assert.rejects(() => cat.baixar('dono/muitos', 's', d), (e) => e.tipo === 'grande' && /311 arquivos/.test(e.message));
    await assert.rejects(() => cat.baixar('x/../y', 'a', d), /inválido/);
  });

  // ---------- busca por projeto ----------
  const fontesFalsas = ACERVO.map((f) => f.repo);
  REPOS['anthropics/skills'] = {
    tree: [
      { path: 'skills/pdf/SKILL.md', type: 'blob', sha: 'a1', size: 10 },
      { path: 'skills/pdf/ler.py', type: 'blob', sha: 'a2', size: 10 },
      { path: 'skills/receita/SKILL.md', type: 'blob', sha: 'a3', size: 10 },
    ],
    arquivos: {
      'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Create and merge PDF files with python\n---\n',
      'skills/receita/SKILL.md': '---\nname: receita\ndescription: Cooking helper\n---\n',
    },
  };
  REPOS['obra/superpowers'] = {
    tree: [
      { path: 'skills/react-tests/SKILL.md', type: 'blob', sha: 'b1', size: 10 },
      { path: 'plugins/x/skills/react-tests/SKILL.md', type: 'blob', sha: 'b2', size: 10 }, // cópia dentro do mesmo repositório
      { path: 'skills/pdf/SKILL.md', type: 'blob', sha: 'b3', size: 10 }, // a mesma skill de um repositório oficial
    ],
    arquivos: {
      'skills/react-tests/SKILL.md': '---\nname: react-tests\ndescription: Testing components\n---\n',
      'plugins/x/skills/react-tests/SKILL.md': '---\nname: react-tests\ndescription: cópia\n---\n',
      'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: outra versão\n---\n',
    },
  };
  REPOS['sickn33/agentic-awesome-skills'] = {
    tree: [],
    arquivos: { 'skills_index.json': JSON.stringify([
      { id: 'blender-tool', path: 'skills/blender-tool', name: 'blender-tool', description: 'Modeling inside Blender' },
      { id: 'fora', path: '../fora', name: 'fora', description: 'python' },
    ]) },
  };
  const perfil = { stack: ['python'], termos: ['react', 'pdf', 'blender', 'web testing'], evitar: ['cooking'] };
  const comIndice = (extra = {}) => criarCatalogo({ api: base, raw: base, arquivoCache: cache, arquivoIndice: path.join(pasta, 'indice.json'), ...extra });

  await teste('nota: nome vale mais que descrição, "evitar" tira e sem relação fica de fora', () => {
    const t = prepararTermos(perfil);
    const noNome = pontuar({ nome: 'pdf', descricao: '', caminho: 'skills/pdf' }, t);
    const naDescricao = pontuar({ nome: 'x', descricao: 'works with pdf files', caminho: 'skills/x' }, t);
    assert.ok(noNome.pontos > naDescricao.pontos && naDescricao.pontos > 0);
    assert.strictEqual(pontuar({ nome: 'nada', descricao: 'sem relação', caminho: 's/nada' }, t).pontos, 0);
    assert.strictEqual(pontuar({ nome: 'pdf-cooking', descricao: '', caminho: 's/x' }, prepararTermos({ termos: ['pdf'], evitar: ['cooking'] })).pontos, 0);
  });
  await teste('nota: termo curto não casa no meio do texto nem em palavra comum da descrição', () => {
    const t = prepararTermos({ termos: ['go', 'test'] });
    assert.strictEqual(pontuar({ nome: 'latest', descricao: 'let us go now', caminho: 's/x' }, t).pontos, 0);
    assert.ok(pontuar({ nome: 'go-tools', descricao: '', caminho: 's/x' }, t).pontos > 0);
  });
  await teste('nota: termo de duas palavras casa com hífen e fora de ordem', () => {
    const t = prepararTermos({ termos: ['code review'] });
    const certo = pontuar({ nome: 'code-review', descricao: '', caminho: 's/a' }, t);
    const fora = pontuar({ nome: 'x', descricao: 'review your code', caminho: 's/b' }, t);
    assert.ok(certo.pontos > fora.pontos && fora.pontos > 0);
  });

  await teste('busca: lê todo o acervo, tira cópias, fica com a oficial e recusa caminho de fora', async () => {
    const cat2 = comIndice();
    const etapas = new Set();
    const r = await cat2.buscarParaProjeto(perfil, (p) => etapas.add(p.etapa));
    const nomes = r.skills.map((s) => s.nome);
    assert.deepStrictEqual([...nomes].sort(), ['blender-tool', 'pdf', 'react-tests']);
    const pdf = r.skills.find((s) => s.nome === 'pdf');
    assert.deepStrictEqual([pdf.repo, pdf.verificada, pdf.copias], ['anthropics/skills', true, 3]); // oficial, superpowers e o repositório achado pela busca
    assert.strictEqual(r.skills.find((s) => s.nome === 'react-tests').caminho, 'skills/react-tests');
    assert.strictEqual(r.skills.find((s) => s.nome === 'blender-tool').verificada, false);
    assert.ok(/python/.test(pdf.razao) && /pdf/.test(pdf.razao), pdf.razao);
    assert.ok(etapas.has('repositorios') && etapas.has('nota'));
    assert.strictEqual(r.faltaram, 0);
  });
  await teste('busca: a segunda vez não pede nada (nem a outro projeto, que só muda a nota)', async () => {
    const antes = pedidos.length;
    const r = await comIndice().buscarParaProjeto({ ...perfil, termos: perfil.termos });
    assert.strictEqual(pedidos.length, antes, pedidos.slice(antes).join(' '));
    assert.strictEqual(r.skills.length, 3);
  });
  await teste('busca: passadas 24 h só relê o SKILL.md que mudou (sha diferente)', async () => {
    const depois = comIndice({ agora: () => Date.now() + 25 * 60 * 60 * 1000 });
    REPOS['anthropics/skills'].tree[0].sha = 'a1-novo';
    REPOS['anthropics/skills'].arquivos['skills/pdf/SKILL.md'] = '---\nname: pdf\ndescription: Nova descrição de pdf\n---\n';
    const antes = pedidos.length;
    const r = await depois.buscarParaProjeto(perfil);
    const lidos = pedidos.slice(antes).filter((u) => u.endsWith('SKILL.md'));
    assert.deepStrictEqual(lidos, ['/anthropics/skills/HEAD/skills/pdf/SKILL.md']);
    assert.strictEqual(r.skills.find((s) => s.nome === 'pdf').descricao, 'Nova descrição de pdf');
  });
  await teste('busca: limite do GitHub não derruba, responde com o que tem e avisa', async () => {
    const limpo = criarCatalogo({ api: base, raw: base, arquivoCache: cache, arquivoIndice: path.join(pasta, 'indice2.json') });
    modo = 'limite';
    try {
      const r = await limpo.buscarParaProjeto(perfil);
      assert.deepStrictEqual(r.skills, []);
      assert.ok(r.avisos.some((a) => /limitou/.test(a)), r.avisos.join(' | '));
    } finally { modo = 'ok'; }
    const comIdx = comIndice();
    const antes = pedidos.length;
    modo = 'limite';
    try {
      const r = await comIdx.buscarParaProjeto(perfil);
      assert.ok(r.skills.length >= 3, 'o índice guardado continua servindo');
    } finally { modo = 'ok'; }
    assert.ok(pedidos.length >= antes);
  });
  await teste('busca: sem nenhum termo explica o que fazer', async () => {
    await assert.rejects(() => comIndice().buscarParaProjeto({ termos: [], stack: [] }), /\[ler projeto\]/);
  });
  await teste('juntar: a skill que já está na biblioteca fica como local e o resumo recalcula', () => {
    const local = { projeto: { id: 'x', online: false }, resumo: { instaladas_projeto: 1 }, skills: [{ nome: 'pdf', origem: 'local', nivel: 'util', pontos: 50 }] };
    const busca = { repositorios: [], lidas: 9, faltaram: 0, avisos: [], skills: [
      { nome: 'pdf', origem: 'online', nivel: 'essencial', pontos: 90 }, { nome: 'react', origem: 'online', nivel: 'essencial', pontos: 80 },
    ] };
    const j = juntarAvaliacao(local, busca);
    assert.deepStrictEqual(j.skills.map((s) => `${s.nome}:${s.origem}`), ['react:online', 'pdf:local']);
    assert.deepStrictEqual([j.resumo.total, j.resumo.online, j.resumo.locais, j.resumo.essenciais, j.resumo.uteis, j.resumo.instaladas_projeto], [2, 1, 1, 1, 1, 1]);
    assert.strictEqual(j.projeto.online, true);
    assert.strictEqual(j.busca.lidas, 9);
  });
  await teste('baixar reaproveita a árvore de um lote: nenhum pedido novo de árvore', async () => {
    const a = await cat.arvore('dono/skills');
    const antes = pedidos.filter((u) => u.includes('/git/trees/')).length;
    await cat.baixar('dono/skills', 'skills/pdf', path.join(pasta, 'lote'), a);
    assert.strictEqual(pedidos.filter((u) => u.includes('/git/trees/')).length, antes);
  });
  assert.ok(fontesFalsas.includes('anthropics/skills'));

  servidor.close();
  fs.rmSync(pasta, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('ERRO DO TESTE:', e.stack); process.exit(1); });
