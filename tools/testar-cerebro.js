// Testa a ponte app/cerebro.js (a que a aba "Cérebro" usa) contra o cerebro.py de verdade.
// Cria um cérebro temporário; não mexe no seu cérebro nem no ~/.cerebro.json.
//   node tools/testar-cerebro.js     (ou: npm run testar-cerebro)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebro-teste-'));
const base = path.join(tmp, 'cérebro com espaço'); // espaço e acento de propósito
fs.mkdirSync(path.join(base, 'conversas'), { recursive: true });
fs.mkdirSync(path.join(base, 'estado'));
process.env.CEREBRO_DIR = base;
process.env.CEREBRO_CONFIG = path.join(tmp, 'cerebro.json');

process.env.PROJETOS_JSON = path.join(tmp, 'projetos.json');
const cerebro = require('../app/cerebro');
const projetos = require('../app/projetos');
const escrever = (rel, texto) => fs.writeFileSync(path.join(base, rel), texto, 'utf8');
escrever('conversas/2026-10-28_estrutura-inicial-do-cerebro.md',
  'palavras-chave: cérebro, estrutura, claude-md, pastas, instruções\ndata: 2026-10-28 | origem: claude-code | projeto: meu-widget\n\n- Criamos as pastas\n- Ação com acento ✓\n');
escrever('conversas/2026-10-20_agentes-do-antigravity-por-projeto.md',
  'palavras-chave: agentes, antigravity, projetos, sessoes, abrir\ndata: 2026-10-20 | origem: claude | projeto: outro-app\n\n- Abrir agentes por projeto\n');
escrever('estado/meu-widget.md',
  '## Objetivo\nWidget leve.\n## Stack\nElectron.\n## Decisões\nSem frameworks.\n## Estado atual\nFase 1.\n## Próximos passos\nAba.\n## Armadilhas\nCPU.\n');

let n = 0;
const teste = async (nome, fn) => {
  try { await fn(); n++; console.log('ok   ' + nome); } catch (e) { console.log('FALHOU ' + nome + '\n  ' + e.message); process.exitCode = 1; }
};

(async () => {
  await teste('painel: projetos, estatísticas e estado', async () => {
    const r = await cerebro.painel('meu-widget');
    assert.ok(r.ok, r.erro);
    assert.deepStrictEqual(r.dados.projetos, ['meu-widget', 'outro-app']);
    assert.strictEqual(r.dados.estatisticas.arquivos, 3);
    assert.strictEqual(r.dados.estatisticas.ultima_compactacao, '2026-10-28');
    assert.strictEqual(r.dados.estado.arquivo, 'estado/meu-widget.md');
    assert.strictEqual(r.dados.estado.objetivo, 'Widget leve.');
    assert.strictEqual(r.dados.dir, base);
  });

  await teste('buscar "cerebro": acha, com pontos e palavras-chave', async () => {
    const r = await cerebro.buscar('cerebro', 'meu-widget');
    assert.ok(r.ok, r.erro);
    const c = r.dados.candidatos;
    assert.strictEqual(c[0].arquivo, '2026-10-28_estrutura-inicial-do-cerebro.md');
    assert.ok(c[0].pontos >= 2);
    assert.ok(c[0].palavras_chave.includes('cérebro'));
    assert.strictEqual(r.dados.estado, 'estado/meu-widget.md');
  });

  await teste('buscar: termo com "-" no começo não vira opção; vazio é recusado', async () => {
    const r = await cerebro.buscar('--help cerebro');
    assert.ok(r.ok, r.erro);
    assert.strictEqual(r.dados.candidatos.length, 1);
    const vazio = await cerebro.buscar('   ');
    assert.deepStrictEqual([vazio.ok, vazio.erro], [false, 'digite o que procurar']);
  });

  await teste('ler: conteúdo completo em UTF-8 e data; nome inválido recusado', async () => {
    const r = await cerebro.ler('2026-10-28_estrutura-inicial-do-cerebro.md');
    assert.ok(r.ok, r.erro);
    assert.ok(r.dados.arquivos[0].conteudo.includes('Ação com acento ✓'));
    assert.match(r.dados.arquivos[0].atualizado, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok((await cerebro.ler('estado/meu-widget.md')).dados.arquivos[0].conteudo.startsWith('## Objetivo'));
    for (const ruim of ['../segredo.md', 'x.txt', 'a/b/c.md', '--json', '']) assert.strictEqual((await cerebro.ler(ruim)).ok, false, ruim);
    assert.deepStrictEqual((await cerebro.ler('nao-existe.md')).dados.nao_encontrados, ['nao-existe.md']);
  });

  await teste('salvar: grava resumo colado (acentos e emoji), atualiza índice', async () => {
    const r = await cerebro.salvar({ titulo: 'Resumo colado de um chat', palavras: 'claude, chat, resumo, widget, teste', origem: 'claude', projeto: 'Meu Widget', corpo: '- decisão: usar "aspas" e acentos ção ✓ 😀\n- pendência: nada' });
    assert.ok(r.ok, r.erro);
    const nome = r.dados.arquivo;
    assert.match(nome, /^\d{4}-\d{2}-\d{2}_resumo-colado-de-um-chat\.md$/);
    const texto = fs.readFileSync(path.join(base, 'conversas', nome), 'utf8');
    assert.ok(texto.includes('origem: claude | projeto: meu-widget') && texto.includes('ção ✓ 😀'));
    assert.ok(fs.readFileSync(path.join(base, 'INDICE.md'), 'utf8').includes(nome));
  });

  await teste('salvar: erro de validação vem em uma linha e nada é gravado', async () => {
    const antes = fs.readdirSync(path.join(base, 'conversas')).length;
    const r = await cerebro.salvar({ titulo: 'curto', palavras: 'a, b, c', origem: 'claude', projeto: 'x', corpo: '- ok' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.erro.startsWith('recusado: título com 1 palavra'), r.erro);
    assert.ok(!r.erro.includes('\n'));
    const segredo = await cerebro.salvar({ titulo: 'resumo com segredo dentro', palavras: 'a, b, c', origem: 'claude', projeto: 'x', corpo: '- senha: hunter2hunter2' });
    assert.ok(/senha ou token/.test(segredo.erro), segredo.erro);
    assert.strictEqual(fs.readdirSync(path.join(base, 'conversas')).length, antes);
  });

  await teste('validar: sem problemas, depois com um arquivo ruim; indice', async () => {
    assert.deepStrictEqual((await cerebro.validar()).dados.problemas, []);
    escrever('conversas/Nome Ruim.md', 'sem cabeçalho\n');
    const r = await cerebro.validar();
    assert.strictEqual(r.codigo, 1);
    assert.ok(r.dados.problemas.some((p) => p.arquivo === 'conversas/Nome Ruim.md'));
    fs.unlinkSync(path.join(base, 'conversas', 'Nome Ruim.md'));
    assert.ok((await cerebro.indice()).dados.arquivos >= 3);
  });

  await teste('caminhoDoArquivo (para abrir no editor)', async () => {
    assert.strictEqual(await cerebro.caminhoDoArquivo('estado/meu-widget.md'), path.join(base, 'estado', 'meu-widget.md'));
    assert.strictEqual(await cerebro.caminhoDoArquivo('nao-existe.md'), null);
    assert.strictEqual(await cerebro.caminhoDoArquivo('../x.md'), null);
  });

  await teste('projetos: cadastrar, estado no cérebro, editar, abertura, validar', async () => {
    const pasta = path.join(tmp, 'meu jogo');
    fs.mkdirSync(pasta);
    assert.deepStrictEqual((await projetos.listar()).dados.projetos, []);
    const r = await projetos.adicionar({ nome: 'Jogo do Roblox', pasta, descricao: 'ação ✓', tags: 'roblox, lua', modelo_padrao: 'opus' });
    assert.ok(r.ok, r.erro);
    assert.strictEqual(r.dados.projeto.id, 'jogo-do-roblox');
    assert.deepStrictEqual(r.dados.estado, { arquivo: 'estado/jogo-do-roblox.md', criado: true });
    assert.ok(fs.readFileSync(path.join(base, 'estado', 'jogo-do-roblox.md'), 'utf8').includes('## Armadilhas'));
    const ruim = await projetos.adicionar({ nome: 'X', pasta: path.join(tmp, 'nao-existe') });
    assert.deepStrictEqual([ruim.ok, /pasta não existe/.test(ruim.erro)], [false, true]);
    assert.ok((await projetos.adicionar({ nome: 'Y', pasta, id: 'jogo-do-roblox' })).erro.includes('já existe um projeto com o id'));
    const ed = await projetos.editar('jogo-do-roblox', { nome: 'Roblox ✓', cor: '#ff6b6b' });
    assert.deepStrictEqual([ed.dados.projeto.nome, ed.dados.projeto.cor], ['Roblox ✓', '#ff6b6b']);
    assert.match((await projetos.marcarAbertura('jogo-do-roblox')).dados.projeto.ultima_abertura, /^\d{4}-\d\d-\d\dT/);
    const l = (await projetos.listar()).dados.projetos[0];
    assert.deepStrictEqual([l.pasta_existe, l.estado_existe, l.descricao], [true, true, 'ação ✓']);
    assert.deepStrictEqual((await projetos.validar()).dados.problemas, []);
    for (const f of [() => projetos.editar('Id Ruim', {}), () => projetos.remover('--x'), () => projetos.preparar('../x')]) assert.strictEqual((await f()).ok, false);
  });

  await teste('projetos: preparar mostra o diff e só grava ao confirmar; preencher estado; remover não apaga a pasta', async () => {
    const pasta = path.join(tmp, 'meu jogo');
    fs.writeFileSync(path.join(pasta, 'CLAUDE.md'), '# Meu jogo\n\nRegras minhas.\n', 'utf8');
    const plano = await projetos.preparar('jogo-do-roblox');
    assert.deepStrictEqual([plano.dados.acao, plano.dados.escrito], ['acrescentar', false]);
    assert.ok(plano.dados.diff.includes('+## Cérebro'));
    assert.ok(!fs.readFileSync(path.join(pasta, 'CLAUDE.md'), 'utf8').includes('Cérebro'));
    assert.ok((await projetos.preparar('jogo-do-roblox', true)).dados.escrito);
    const final = fs.readFileSync(path.join(pasta, 'CLAUDE.md'), 'utf8');
    assert.ok(final.startsWith('# Meu jogo\n\nRegras minhas.\n') && final.includes('`jogo-do-roblox`'));
    assert.strictEqual((await projetos.preparar('jogo-do-roblox', true)).dados.acao, 'ja-preparado');

    const p = await projetos.preencherEstado('jogo-do-roblox', { objetivo: 'Jogo de corrida', stack: 'Roblox + Lua' });
    assert.deepStrictEqual(p.dados.preenchido, ['objetivo', 'stack']);
    assert.ok(fs.readFileSync(path.join(base, 'estado', 'jogo-do-roblox.md'), 'utf8').includes('## Objetivo\nJogo de corrida'));

    assert.ok((await projetos.remover('jogo-do-roblox')).ok);
    assert.ok(fs.existsSync(path.join(pasta, 'CLAUDE.md')) && fs.existsSync(path.join(base, 'estado', 'jogo-do-roblox.md')));
    assert.deepStrictEqual((await projetos.listar()).dados.projetos, []);
  });

  await teste('cérebro não encontrado: tipo semCerebro; escolher outra pasta grava o config', async () => {
    process.env.CEREBRO_DIR = path.join(tmp, 'nao-existe');
    const r = await cerebro.painel();
    assert.deepStrictEqual([r.ok, r.tipo], [false, 'semCerebro']);
    assert.ok(r.erro.includes('pasta do cérebro não existe'), r.erro);
    delete process.env.CEREBRO_DIR;
    assert.strictEqual((await cerebro.definirPasta(path.join(tmp, 'nao-existe'))).ok, false);
    fs.mkdirSync(path.join(tmp, 'vazia'));
    assert.ok((await cerebro.definirPasta(path.join(tmp, 'vazia'))).erro.includes('não parece um cérebro'));
    const ok = await cerebro.definirPasta(base);
    assert.ok(ok.ok, ok.erro);
    assert.strictEqual(JSON.parse(fs.readFileSync(process.env.CEREBRO_CONFIG, 'utf8')).cerebro_dir, fs.realpathSync(base));
    assert.ok((await cerebro.painel()).ok); // agora acha sozinho, sem CEREBRO_DIR
  });

  await teste('prompt de compactação', async () => {
    const p = cerebro.promptCompactacao();
    assert.ok(p && p.includes('palavras-chave:') && p.includes('150 palavras') && p.includes('[removido]'));
  });

  await teste('economia: painel dos logs, teste A/B (registrar, validar, comparar, remover)', async () => {
    const economia = require('../app/economia');
    fs.mkdirSync(path.join(base, '.log'), { recursive: true });
    const agora = new Date();
    const iso = (min) => new Date(agora.getTime() - min * 60000).toISOString().slice(0, 19);
    fs.writeFileSync(path.join(base, '.log', 'consultas.jsonl'), [
      { data: iso(30), comando: 'titulos', termos: ['widget'], resultados: 2, caracteres: 120 },
      { data: iso(28), comando: 'cabecalho', termos: ['widget'], resultados: 2, caracteres: 240 },
      { data: iso(24), comando: 'ler', termos: ['estado/meu-widget.md'], resultados: 1, caracteres: 400 },
    ].map((l) => JSON.stringify(l) + '\n').join(''), 'utf8');
    const r = await economia.painel(4);
    assert.ok(r.ok, r.erro);
    assert.strictEqual(r.dados.semanas.length, 4);
    assert.strictEqual(r.dados.totais.consultas, 3);
    assert.deepStrictEqual([r.dados.totais.por_nivel.titulos, r.dados.totais.por_nivel.cabecalho, r.dados.totais.por_nivel.ler], [1, 1, 1]);
    assert.strictEqual(r.dados.totais.buscas, 1); // as 3 consultas seguidas são uma busca só (foi ao nível 3)
    assert.strictEqual(r.dados.totais.pct_nivel12, 0);
    assert.ok(/ESTIMATIVA/.test(r.dados.nota));
    assert.strictEqual((await economia.painel(1000)).dados.semanas.length, 26); // limite
    // A/B
    const ruim = await economia.registrarAB({ tarefa: ' ', variante: 'com', entrada: '10' });
    assert.ok(!ruim.ok && /descreva a tarefa/.test(ruim.erro), ruim.erro);
    assert.ok(!(await economia.registrarAB({ tarefa: 't', variante: 'com' })).ok);
    const a = await economia.registrarAB({ tarefa: 'Explicar o grafo', variante: 'com', entrada: '1.000', saida: '200', custo_usd: '0,5' });
    const b = await economia.registrarAB({ tarefa: 'explicar o grafo', variante: 'sem', entrada: '3000', saida: '0', variante_extra: 'x' });
    assert.ok(a.ok && b.ok, a.erro || b.erro);
    assert.strictEqual(a.dados.registro.total, 1200);
    const ab = (await economia.painel(2)).dados.ab;
    assert.strictEqual(ab.registros.length, 2);
    assert.deepStrictEqual([ab.comparacoes[0].com.total, ab.comparacoes[0].sem.total, ab.comparacoes[0].reducao_pct], [1200, 3000, 60]);
    assert.strictEqual(ab.media_reducao_pct, 60);
    assert.ok(!(await economia.removerAB('../../x')).ok);                     // id fora do formato: nem chega ao Python
    assert.ok(!(await economia.removerAB('20260101000000-abcd')).ok);          // formato certo, mas não existe
    assert.ok((await economia.removerAB(a.dados.registro.id)).ok);
    assert.strictEqual((await economia.painel(2)).dados.ab.registros.length, 1);
    assert.ok(!fs.readFileSync(path.join(base, '.log', 'ab.jsonl'), 'utf8').includes('Explicar o grafo'));
  });

  await teste('manutenção: diagnóstico, sinônimos, índices e backup (sem IA); a IA só com argumentos válidos', async () => {
    const manutencao = require('../app/manutencao');
    for (let i = 1; i <= 3; i++) {
      escrever(`conversas/2026-01-0${i}_resumo-parecido-${i}.md`, `palavras-chave: um, dois, tres, quatro, cinco
data: 2026-01-0${i} | origem: claude | projeto: meu-widget

- topico
`);
    }
    const d = await manutencao.diagnostico();
    assert.ok(d.ok, d.erro);
    assert.strictEqual(d.dados.similares.total_grupos, 1);
    assert.strictEqual(d.dados.similares.grupos[0].arquivos.length, 3);
    assert.ok(d.dados.similares.grupos[0].tokens_entrada > 0);
    assert.ok(/^[0-9a-f]{10}$/.test(d.dados.similares.grupos[0].id));
    assert.ok(d.dados.tamanho.bytes > 0 && !('tools' in d.dados.tamanho.por_pasta));
    // sinônimos
    const a = await manutencao.aprovarSinonimos({ BD: 'Banco de Dados', ia: 'inteligencia-artificial', x: 'x' });
    assert.ok(a.ok, a.erro);
    assert.deepStrictEqual(a.dados.adicionados, ['bd', 'ia']);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(base, 'sinonimos.json'), 'utf8')), { bd: 'banco-de-dados', ia: 'inteligencia-artificial' });
    assert.ok((await manutencao.removerSinonimo('IA')).ok);
    assert.ok(!(await manutencao.removerSinonimo('nao-existe')).ok);
    assert.ok(!(await manutencao.removerSinonimo('')).ok);
    // a IA nem é chamada com argumento inválido
    assert.ok(!(await manutencao.consolidar('../../x', 'haiku')).ok);
    assert.ok(!(await manutencao.consolidar('0123456789', 'haiku')).ok); // formato certo, grupo inexistente: erro do Python, nada gasto
    assert.ok(!(await manutencao.proporEstado('Projeto Inválido!', 'haiku')).ok);
    assert.ok(!(await manutencao.estimarEstado('../x')).ok);
    const est = await manutencao.estimarConsolidacao();
    assert.ok(est.ok && est.dados.chamadas === 1 && est.dados.tokens_entrada > 0, est.erro);
    assert.ok(!(await manutencao.aplicarEstado('meu-widget', '## Objetivo\nincompleto')).ok); // o salvar_estado recusa
    // índices e backup
    const ind = await manutencao.refazerIndices();
    assert.ok(ind.ok && ind.dados.indices_por_projeto === false, ind.erro);
    const dest = path.join(tmp, 'bk');
    fs.mkdirSync(dest);
    const ex = await manutencao.exportar(dest);
    assert.ok(ex.ok, ex.erro);
    assert.ok(/cerebro-\d{4}-\d{2}-\d{2}\.zip$/.test(ex.dados.zip) && fs.existsSync(ex.dados.zip));
    assert.ok(/repositório público/.test(ex.dados.aviso));
    assert.ok(!(await manutencao.exportar('')).ok);
    assert.ok(!(await manutencao.exportar(path.join(tmp, 'nao-existe'))).ok);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} testes passaram${process.exitCode ? ' (houve falhas)' : ''}`);
})();
