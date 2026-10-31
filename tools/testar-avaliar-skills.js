// testar-avaliar-skills.js - testes unitários do motor de avaliação de skills para projetos.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

console.log('=== Testes do Avaliador de Skills para Projetos ===\n');

// Cria pasta temporária com fixture de projetos para garantir independência de dados pessoais
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-skills-eval-'));
const tempProjetosJson = path.join(tempDir, 'projetos.json');
const tempCerebro = path.join(tempDir, 'cerebro');
const tempEstado = path.join(tempCerebro, 'estado');
fs.mkdirSync(tempEstado, { recursive: true });

// Projeto 1: 3D / Blender
const pastaMao = path.join(tempDir, 'pasta-mao');
fs.mkdirSync(pastaMao, { recursive: true });
fs.writeFileSync(path.join(pastaMao, 'modelo.blend'), '');

// Projeto 2: Web / Node
const pastaWeb = path.join(tempDir, 'pasta-web');
fs.mkdirSync(pastaWeb, { recursive: true });
fs.writeFileSync(path.join(pastaWeb, 'package.json'), '{}');

const fixtureProjetos = [
  {
    id: 'teste-3d',
    nome: 'Projeto 3D Blender',
    pasta: pastaMao,
    ia: 'claude',
    modelo_padrao: 'sonnet',
    descricao: 'Modelagem 3D e impressao',
    tags: ['blender', '3d'],
  },
  {
    id: 'teste-web',
    nome: 'Projeto Web Node',
    pasta: pastaWeb,
    ia: 'claude',
    modelo_padrao: 'sonnet',
    descricao: 'Aplicacao web frontend',
    tags: ['web', 'node'],
  },
];
fs.writeFileSync(tempProjetosJson, JSON.stringify(fixtureProjetos, null, 2));

// Estados no cérebro temporário
fs.writeFileSync(
  path.join(tempEstado, 'teste-3d.md'),
  '## Objetivo\nCriar pecas no Blender 3D.\n\n## Stack\nBlender 5.2.3, STL, PETG-CF.\n'
);
fs.writeFileSync(
  path.join(tempEstado, 'teste-web.md'),
  '## Objetivo\nCriar app web.\n\n## Stack\nNode.js, React, Tailwind.\n'
);

function rodarPython(args) {
  const env = { ...process.env, PROJETOS_JSON: tempProjetosJson, CAMINHO_CEREBRO: tempCerebro };
  const p = spawnSync('python', args, { cwd: path.resolve(__dirname, '..'), encoding: 'utf-8', env });
  assert.strictEqual(p.status, 0, `Python falhou: ${p.stderr || p.stdout}`);
  return JSON.parse(p.stdout);
}

try {
  // 1. Teste CLI: projetos.py avaliar-skills teste-3d --json
  {
    const r = rodarPython(['cerebro/tools/projetos.py', 'avaliar-skills', 'teste-3d', '--json']);
    assert.strictEqual(r.ok, true, 'teste-3d deve retornar ok');
    assert.strictEqual(r.projeto.id, 'teste-3d');
    assert.ok(r.skills && r.skills.length >= 7, 'deve ter pelo menos 7 skills');
    assert.ok(r.resumo.essenciais >= 3, 'teste-3d deve ter pelo menos 3 essenciais');

    const blender = r.skills.find((s) => s.nome === 'blender-modeler');
    assert.ok(blender, 'blender-modeler deve estar nas skills');
    assert.strictEqual(blender.nivel, 'essencial', 'blender-modeler deve ser essencial para teste-3d');

    const asset = r.skills.find((s) => s.nome === 'asset-optimization');
    assert.ok(asset, 'asset-optimization deve estar nas skills');
    assert.strictEqual(asset.nivel, 'essencial', 'asset-optimization deve ser essencial para teste-3d');

    console.log('ok   CLI python avaliar-skills (reconhece Blender/3D como essencial)');
  }

  // 2. Teste CLI: projetos.py avaliar-skills teste-web --json
  {
    const r = rodarPython(['cerebro/tools/projetos.py', 'avaliar-skills', 'teste-web', '--json']);
    assert.strictEqual(r.ok, true, 'teste-web deve retornar ok');
    assert.strictEqual(r.projeto.id, 'teste-web');

    const blender = r.skills.find((s) => s.nome === 'blender-modeler');
    assert.ok(blender, 'blender-modeler deve estar presente');
    assert.strictEqual(blender.nivel, 'opcional', 'blender-modeler deve ser opcional para web');

    const buscar = r.skills.find((s) => s.nome === 'cerebro-buscar');
    assert.strictEqual(buscar.nivel, 'essencial', 'cerebro-buscar deve ser sempre essencial');

    const compactar = r.skills.find((s) => s.nome === 'cerebro-compactar');
    assert.strictEqual(compactar.nivel, 'essencial', 'cerebro-compactar deve ser sempre essencial');

    console.log('ok   CLI python avaliar-skills (web/node: blender é opcional, cérebro é essencial)');
  }

  // 3. Teste Ponte Node.js: app/projetos.js avaliarSkills
  (async () => {
    process.env.PROJETOS_JSON = tempProjetosJson;
    process.env.CAMINHO_CEREBRO = tempCerebro;
    const projetos = require('../app/projetos');
    const r = await projetos.avaliarSkills('teste-3d');
    assert.strictEqual(r.ok, true, 'ponte Node.js deve retornar ok');
    const dados = r.dados || r;
    assert.strictEqual(dados.projeto.id, 'teste-3d');
    assert.ok(Array.isArray(dados.skills), 'skills deve ser array');
    console.log('ok   Ponte Node.js app/projetos.js avaliarSkills funciona');

    // 4. Teste Skill /avaliar existe no catálogo
    const catJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../skills-biblioteca/catalogo.json'), 'utf-8'));
    const listaCat = catJson.skills || [];
    const sAvaliar = listaCat.find((s) => s.nome === 'cerebro-avaliar');
    assert.ok(sAvaliar, 'cerebro-avaliar deve existir no catálogo de skills');
    assert.ok(sAvaliar.compativel.includes('claude'), 'cerebro-avaliar deve ser compatível com claude');
    assert.ok(sAvaliar.compativel.includes('antigravity'), 'cerebro-avaliar deve ser compatível com antigravity');
    console.log('ok   Skill oficial cerebro-avaliar registrada e compatível');

    // Limpa pasta temporária
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('\nTodos os testes do avaliador de skills passaram!');
  })();
} catch (e) {
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw e;
}
