// atualizador.js — atualiza o widget a partir do GitHub SEM mexer nos dados do usuário.
// Não depende do Electron (testável com "node tools/testar-atualizador.js").
//
// Como funciona:
//   verificar()  1 chamada leve: pede só o SHA do último commit da branch e compara com o que está instalado.
//   atualizar()  (só quando o dono clica) baixa o tarball EXATO desse commit, descompacta numa pasta temporária,
//                guarda backup do que vai trocar e copia só arquivos de CÓDIGO. Se algo falhar no meio, desfaz.
//
// O que NUNCA é tocado (dados do usuário): config (%APPDATA%\meu-widget ou ~/.config/meu-widget, fora da pasta do código),
// cerebro/conversas, cerebro/estado, cerebro/indices, cerebro/.log, cerebro/INDICE.md, cerebro/sinonimos.json, projetos.json,
// importacoes/, node_modules/, .git/, .claude/, .agents/, dist/ e executáveis. Nada é apagado: arquivos que sumirem da
// versão nova ficam onde estão. O skills-biblioteca/catalogo.json é MESCLADO (as skills que o usuário importou ficam).
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const SHA = /^[0-9a-f]{40}$/;
const HOSTS_PERMITIDOS = /^(api\.github\.com|codeload\.github\.com|github\.com|[a-z0-9-]+\.githubusercontent\.com)$/;
const LIMITE_DOWNLOAD = 150 * 1024 * 1024;

// caminhos (relativos à raiz, com "/") que são dados do usuário ou do ambiente: o atualizador nem olha
const PROTEGIDOS_EXATOS = new Set(['projetos.json', 'cerebro/INDICE.md', 'cerebro/sinonimos.json']);
const PROTEGIDOS_PASTAS = ['.git', 'node_modules', 'dist', 'importacoes', '.claude', '.agents',
  'cerebro/conversas', 'cerebro/estado', 'cerebro/indices', 'cerebro/.log'];
const LIXO = /(^|\/)__pycache__(\/|$)|\.(pyc|exe|tmp|atualizando)$/i;

function ehProtegido(rel) {
  if (PROTEGIDOS_EXATOS.has(rel)) return true;
  return PROTEGIDOS_PASTAS.some((p) => rel === p || rel.startsWith(p + '/'));
}

// { repo: "dono/nome", branch: "devs" } — vem do app/atualizacao.json (cada versão do widget aponta para a sua branch)
function lerConfig(pastaApp) {
  const c = JSON.parse(fs.readFileSync(path.join(pastaApp, 'atualizacao.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo || '') || !/^[\w./()-]{1,80}$/.test(c.branch || '')) throw new Error('atualizacao.json inválido');
  return { repo: c.repo, branch: c.branch };
}

// ---------- rede (só https, só hosts do GitHub) ----------
function requisitar(url, { headers = {}, destino = null, limite = 1024 * 1024, timeout = 10000, redirecoes = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('endereço inválido')); }
    if (u.protocol !== 'https:' || !HOSTS_PERMITIDOS.test(u.hostname)) return reject(new Error('endereço não permitido: ' + u.hostname));
    const req = https.get(u, { headers: { 'User-Agent': 'meu-widget-atualizador', ...headers }, timeout }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirecoes <= 0) return reject(new Error('redirecionamentos demais'));
        return resolve(requisitar(new URL(res.headers.location, u).href, { headers, destino, limite, timeout, redirecoes: redirecoes - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('o GitHub respondeu ' + res.statusCode)); }
      let total = 0;
      const partes = [];
      const saida = destino ? fs.createWriteStream(destino) : null;
      res.on('data', (d) => {
        total += d.length;
        if (total > limite) { req.destroy(new Error('arquivo grande demais')); return; }
        if (!saida) partes.push(d);
      });
      res.on('error', reject);
      if (saida) {
        saida.on('error', reject);
        saida.on('finish', () => resolve(null));
        res.pipe(saida);
      } else {
        res.on('end', () => resolve(Buffer.concat(partes)));
      }
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

// SHA (40 hex) do último commit da branch: resposta de ~40 bytes
async function shaRemoto(config) {
  const url = `https://api.github.com/repos/${config.repo}/commits/${encodeURIComponent(config.branch)}`;
  const corpo = await requisitar(url, { headers: { Accept: 'application/vnd.github.sha' }, limite: 4096 });
  const sha = corpo.toString('utf8').trim();
  if (!SHA.test(sha)) throw new Error('resposta inesperada do GitHub');
  return sha;
}

// o tarball do commit exato (nada de "branch mudou no meio do caminho")
function baixarTarball(config, sha, destino) {
  return requisitar(`https://codeload.github.com/${config.repo}/tar.gz/${sha}`, { destino, limite: LIMITE_DOWNLOAD, timeout: 30000 });
}

// tar.exe já vem no Windows 10 (1803+); no Linux é o tar de sempre
function extrairTarball(arquivo, destino) {
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xzf', arquivo, '-C', destino], { timeout: 120000, windowsHide: true }, (erro, _saida, saidaErro) => {
      if (erro) reject(new Error('não consegui descompactar: ' + String(saidaErro || erro.message).slice(0, 200)));
      else resolve();
    });
  });
}

// ---------- o que está instalado ----------
const arquivoRegistro = (pastaConfig) => path.join(pastaConfig, 'atualizacao.json');

function lerRegistro(pastaConfig, config) {
  try {
    const r = JSON.parse(fs.readFileSync(arquivoRegistro(pastaConfig), 'utf8').replace(/^\uFEFF/, ''));
    return r && r.repo === config.repo && r.branch === config.branch && SHA.test(r.sha || '') ? r.sha : null;
  } catch { return null; }
}

function registrar(pastaConfig, sha, config) {
  fs.mkdirSync(pastaConfig, { recursive: true });
  const temp = arquivoRegistro(pastaConfig) + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ repo: config.repo, branch: config.branch, sha, data: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(temp, arquivoRegistro(pastaConfig));
}

// Quem baixou com "git clone" tem o commit no .git; só vale se o clone está na MESMA branch do widget
function shaDoGit(raiz, branch) {
  try {
    const head = fs.readFileSync(path.join(raiz, '.git', 'HEAD'), 'utf8').trim();
    const m = /^ref:\s*(\S+)$/.exec(head);
    if (!m || m[1] !== 'refs/heads/' + branch) return null;
    try {
      const s = fs.readFileSync(path.join(raiz, '.git', ...m[1].split('/')), 'utf8').trim();
      if (SHA.test(s)) return s;
    } catch { /* o ref pode estar só no packed-refs */ }
    for (const linha of fs.readFileSync(path.join(raiz, '.git', 'packed-refs'), 'utf8').split(/\r?\n/)) {
      const [sha, nome] = linha.split(' ');
      if (nome === m[1] && SHA.test(sha)) return sha;
    }
  } catch { /* sem git */ }
  return null;
}

// { disponivel, atual, remoto, primeiraVez }
// Sem nenhuma pista do que está instalado (pasta baixada em zip, nunca atualizada), a versão de agora vira o ponto de partida.
async function verificar({ raiz, pastaConfig, config, buscarSha = shaRemoto }) {
  const remoto = await buscarSha(config);
  const guardado = lerRegistro(pastaConfig, config);
  const git = shaDoGit(raiz, config.branch);
  if (remoto === guardado || remoto === git) return { disponivel: false, atual: remoto, remoto, primeiraVez: false };
  const atual = guardado || git;
  if (!atual) {
    registrar(pastaConfig, remoto, config);
    return { disponivel: false, atual: remoto, remoto, primeiraVez: true };
  }
  return { disponivel: true, atual, remoto, primeiraVez: false };
}

// ---------- aplicar ----------
function* listar(base, rel = '') {
  for (const it of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
    if (it.isSymbolicLink()) continue;
    const r = rel ? rel + '/' + it.name : it.name;
    if (it.isDirectory()) yield* listar(base, r);
    else if (it.isFile()) yield r;
  }
}

const dentro = (raiz, alvo) => {
  const a = path.resolve(alvo);
  const r = path.resolve(raiz);
  return a === r || a.startsWith(r + path.sep);
};

// o catálogo de skills: o que é do usuário (importado) fica; o que é oficial (origem "local") atualiza; skill nova entra
function mesclarCatalogo(arquivoLocal, textoRemoto) {
  let remoto;
  try { remoto = JSON.parse(textoRemoto.replace(/^\uFEFF/, '')); } catch { return null; }
  if (!remoto || !Array.isArray(remoto.skills)) return null;
  let local = { skills: [] };
  try { local = JSON.parse(fs.readFileSync(arquivoLocal, 'utf8').replace(/^\uFEFF/, '')); } catch { /* sem catálogo ainda */ }
  if (!local || !Array.isArray(local.skills)) local = { skills: [] };
  const lista = local.skills.slice();
  for (const s of remoto.skills) {
    const i = lista.findIndex((x) => x && x.nome === s.nome);
    if (i < 0) lista.push(s);
    else if (lista[i].origem === 'local') lista[i] = s;
  }
  const novo = JSON.stringify({ ...local, ...remoto, skills: lista }, null, 2) + '\n';
  return novo;
}

function dependencias(arquivo) {
  try {
    const p = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return JSON.stringify([p.dependencies || {}, p.devDependencies || {}]);
  } catch { return ''; }
}

function validarOrigem(origem) {
  for (const f of ['package.json', 'app/main.js', 'app/index.html', 'app/preload.js', 'app/atualizador.js']) {
    if (!fs.existsSync(path.join(origem, ...f.split('/')))) throw new Error('a versão baixada está incompleta (falta ' + f + ')');
  }
  const p = JSON.parse(fs.readFileSync(path.join(origem, 'package.json'), 'utf8'));
  if (p.main !== 'app/main.js') throw new Error('a versão baixada não parece ser o widget');
}

// Copia só código. Devolve { atualizados, novos, iguais, depsMudaram }. Se algo falhar, desfaz tudo e lança o erro.
function aplicar({ origem, raiz, backup }) {
  const plano = [];
  for (const rel of listar(origem)) {
    const partes = rel.split('/');
    if (partes.some((p) => p === '' || p === '..') || ehProtegido(rel) || LIXO.test(rel)) continue;
    const para = path.join(raiz, ...partes);
    if (!dentro(raiz, para)) continue;
    plano.push({ rel, de: path.join(origem, ...partes), para });
  }
  const depsAntes = dependencias(path.join(raiz, 'package.json'));
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(backup, { recursive: true });

  const feitos = []; // { para, existia, copia }
  const resumo = { atualizados: 0, novos: 0, iguais: 0, depsMudaram: false };
  try {
    for (const item of plano) {
      let conteudo = fs.readFileSync(item.de);
      if (item.rel === 'skills-biblioteca/catalogo.json') {
        const mesclado = mesclarCatalogo(item.para, conteudo.toString('utf8'));
        if (mesclado === null) continue;
        conteudo = Buffer.from(mesclado, 'utf8');
      }
      let atual = null;
      try { atual = fs.readFileSync(item.para); } catch { /* arquivo novo */ }
      if (atual && atual.equals(conteudo)) { resumo.iguais++; continue; }
      let copia = null;
      if (atual) {
        copia = path.join(backup, ...item.rel.split('/'));
        fs.mkdirSync(path.dirname(copia), { recursive: true });
        fs.writeFileSync(copia, atual);
      }
      fs.mkdirSync(path.dirname(item.para), { recursive: true });
      const temp = item.para + '.atualizando';
      fs.writeFileSync(temp, conteudo);
      try { fs.chmodSync(temp, (atual ? fs.statSync(item.para) : fs.statSync(item.de)).mode & 0o777); } catch { /* sem permissões (Windows) */ }
      fs.renameSync(temp, item.para);
      feitos.push({ para: item.para, existia: !!atual, copia });
      if (atual) resumo.atualizados++; else resumo.novos++;
    }
  } catch (erro) {
    for (const f of feitos.reverse()) {
      try {
        if (f.existia) fs.writeFileSync(f.para, fs.readFileSync(f.copia));
        else fs.rmSync(f.para, { force: true });
      } catch { /* melhor esforço: o backup continua na pasta de config */ }
    }
    throw new Error('a atualização foi desfeita (' + erro.message + ')');
  }
  resumo.depsMudaram = depsAntes !== dependencias(path.join(raiz, 'package.json'));
  return resumo;
}

// baixa, confere e aplica. Devolve { sha, atualizados, novos, iguais, depsMudaram }
async function atualizar({ raiz, pastaConfig, config, buscarSha = shaRemoto, baixar = baixarTarball, extrair = extrairTarball }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-widget-update-'));
  try {
    const sha = await buscarSha(config);
    const arquivo = path.join(tmp, 'codigo.tar.gz');
    await baixar(config, sha, arquivo);
    const pasta = path.join(tmp, 'extraido');
    fs.mkdirSync(pasta);
    await extrair(arquivo, pasta);
    const topos = fs.readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (topos.length !== 1) throw new Error('pacote baixado com formato inesperado');
    const origem = path.join(pasta, topos[0].name);
    validarOrigem(origem);
    const resumo = aplicar({ origem, raiz, backup: path.join(pastaConfig, 'atualizacao-backup') });
    registrar(pastaConfig, sha, config);
    return { sha, ...resumo };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { lerConfig, shaRemoto, verificar, atualizar, aplicar, ehProtegido, shaDoGit, mesclarCatalogo, extrairTarball, registrar, lerRegistro };
