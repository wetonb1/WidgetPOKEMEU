// catalogo-skills.js — o catálogo online de skills (aba Skills > [buscar online]). Procura skills nos repositórios do GitHub (as oficiais da
// Anthropic para o Claude, as da OpenAI para o Codex, repositórios da comunidade ou um que você digitar) e baixa a PASTA de uma skill para
// uma pasta temporária, de onde o fluxo seguro de sempre (skills.py importar) mostra tudo para você revisar. Nada daqui é executado nem
// instalado: este módulo só LÊ da internet e GRAVA arquivos de texto numa pasta temporária.
// Só roda por clique seu (nada em segundo plano). Sem conta no GitHub o limite é de 60 consultas por hora: a lista fica guardada no disco
// (funciona sem internet) e o erro de limite é explicado. Não depende do Electron (testável com node); os endereços entram por parâmetro.
const fs = require('fs');
const path = require('path');

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

// de onde vêm as skills (o "ia" é para quem a skill serve; o formato SKILL.md é o mesmo nas duas)
const FONTES = [
  { id: 'anthropics/skills', rotulo: 'Anthropic (Claude)', ia: 'claude', descricao: 'as skills oficiais do Claude' },
  { id: 'openai/skills', rotulo: 'OpenAI (Codex)', ia: 'codex', descricao: 'skills do Codex, no mesmo formato SKILL.md' },
  { id: 'comunidade', rotulo: 'Comunidade (GitHub)', busca: true, descricao: 'repositórios de skills de qualquer pessoa, pelos mais estrelados' },
  { id: 'outro', rotulo: 'Outro repositório', outro: true, descricao: 'digite dono/repositório' },
];

const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/; // o nome do repositório nunca é "." nem ".."
const LIMITES = {
  arquivos: 80,            // arquivos por skill
  arquivo: 1024 * 1024,    // bytes por arquivo
  total: 5 * 1024 * 1024,  // bytes por skill
  descricoes: 60,          // quantas descrições (SKILL.md) buscar por vez
  cabecalho: 64 * 1024,    // o começo do SKILL.md basta para o nome e a descrição
  espera: 20000,           // ms por pedido
  validade: 30 * 60 * 1000, // quanto tempo a lista da memória vale
};

class ErroCatalogo extends Error {
  constructor(tipo, mensagem) { super(mensagem); this.tipo = tipo; }
}

// "name:" e "description:" do começo de um SKILL.md (aceita aspas e os blocos > e | do YAML)
function cabecalhoSkill(texto) {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(String(texto || '').replace(/^﻿/, ''));
  const linhas = (m ? m[1] : '').split(/\r?\n/);
  const campos = {};
  for (let i = 0; i < linhas.length; i++) {
    const c = /^([A-Za-z_-]+):\s*(.*)$/.exec(linhas[i]);
    if (!c) continue;
    let valor = c[2].trim();
    if (/^[>|][+-]?$/.test(valor)) {
      const partes = [];
      while (i + 1 < linhas.length && /^\s+\S/.test(linhas[i + 1])) partes.push(linhas[++i].trim());
      valor = partes.join(' ');
    }
    campos[c[1].toLowerCase()] = valor.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  }
  return campos;
}

// ajuda a limitar quantos pedidos andam juntos
async function emLotes(itens, n, fn) {
  const saida = new Array(itens.length);
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; saida[k] = await fn(itens[k], k); }
  });
  await Promise.all(trabalhadores);
  return saida;
}

function criarCatalogo({ api = API, raw = RAW, buscar = globalThis.fetch, arquivoCache = null, agora = () => Date.now() } = {}) {
  const memoria = new Map(); // repo -> { quando, itens, total }
  let cacheDisco = null;

  function lerCache() {
    if (cacheDisco) return cacheDisco;
    try { cacheDisco = JSON.parse(fs.readFileSync(arquivoCache, 'utf8')); } catch { cacheDisco = {}; }
    if (!cacheDisco || typeof cacheDisco !== 'object' || Array.isArray(cacheDisco)) cacheDisco = {};
    return cacheDisco;
  }
  function guardarCache(repo, dados) {
    if (!arquivoCache) return;
    const c = lerCache();
    c[repo] = dados;
    const chaves = Object.keys(c).sort((a, b) => (c[b].quando || 0) - (c[a].quando || 0)).slice(0, 8); // só os 8 mais recentes
    const novo = {};
    for (const k of chaves) novo[k] = c[k];
    cacheDisco = novo;
    try {
      fs.mkdirSync(path.dirname(arquivoCache), { recursive: true });
      fs.writeFileSync(arquivoCache + '.tmp', JSON.stringify(novo), 'utf8');
      fs.renameSync(arquivoCache + '.tmp', arquivoCache);
    } catch { /* o cache é só um conforto */ }
  }

  // um pedido ao GitHub; devolve { corpo (Buffer), tipo } ou joga ErroCatalogo com um motivo que a tela sabe explicar
  async function pedir(url, { max = LIMITES.arquivo } = {}) {
    let r;
    try {
      r = await buscar(url, { headers: { 'User-Agent': 'meu-widget', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(LIMITES.espera), redirect: 'follow' });
    } catch (e) {
      throw new ErroCatalogo('rede', e && e.name === 'TimeoutError' ? 'o GitHub demorou demais para responder' : 'sem conexão com a internet (ou o GitHub está fora do ar)');
    }
    if (r.status === 403 || r.status === 429) throw new ErroCatalogo('limite', 'o GitHub limitou as consultas (sem conta são 60 por hora). Tente de novo mais tarde.');
    if (r.status === 404) throw new ErroCatalogo('naoEncontrado', 'não encontrei esse repositório ou arquivo no GitHub');
    if (!r.ok) throw new ErroCatalogo('rede', 'o GitHub respondeu com erro ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new ErroCatalogo('grande', 'arquivo grande demais (' + Math.round(buf.length / 1024) + ' KB)');
    return buf;
  }
  const json = async (url, opcoes) => JSON.parse((await pedir(url, { max: 8 * 1024 * 1024, ...opcoes })).toString('utf8'));

  const validarRepo = (repo) => { if (typeof repo !== 'string' || !REPO.test(repo)) throw new ErroCatalogo('erro', 'repositório inválido (use dono/repositório)'); return repo; };

  // a árvore de arquivos do repositório inteira (1 pedido)
  async function arvore(repo) {
    const d = await json(`${api}/repos/${repo}/git/trees/HEAD?recursive=1`);
    if (!Array.isArray(d.tree)) throw new ErroCatalogo('erro', 'resposta inesperada do GitHub');
    return d;
  }
  // as pastas que têm um SKILL.md: [{ caminho, arquivos }]
  function pastasDeSkill(d) {
    const blobs = d.tree.filter((x) => x && x.type === 'blob' && typeof x.path === 'string');
    const pastas = [];
    for (const b of blobs) {
      if (b.path !== 'SKILL.md' && !b.path.endsWith('/SKILL.md')) continue;
      const caminho = b.path === 'SKILL.md' ? '' : b.path.slice(0, -'/SKILL.md'.length);
      if (/(^|\/)(template|templates|node_modules|\.git)(\/|$)/i.test(caminho)) continue; // modelos em branco não são skills
      const prefixo = caminho ? caminho + '/' : '';
      pastas.push({ caminho, arquivos: blobs.filter((x) => x.path.startsWith(prefixo)).length });
    }
    return pastas.sort((a, b) => a.caminho.localeCompare(b.caminho));
  }

  // skills de um repositório (com o nome e a descrição lidos do começo de cada SKILL.md). termo filtra pelo caminho e pelo texto.
  async function listar(repo, termo = '') {
    validarRepo(repo);
    const t = String(termo || '').trim().toLowerCase().slice(0, 60);
    let lista = memoria.get(repo);
    let offline = false;
    if (!lista || agora() - lista.quando > LIMITES.validade) {
      try {
        const pastas = pastasDeSkill(await arvore(repo));
        lista = { quando: agora(), pastas, descritas: new Map() };
        memoria.set(repo, lista);
      } catch (e) {
        const guardado = lerCache()[repo];
        if (!guardado || !(e instanceof ErroCatalogo) || !['rede', 'limite'].includes(e.tipo)) throw e;
        // sem internet (ou limite): usa a lista que ficou guardada, dizendo de quando é
        offline = true;
        lista = { quando: guardado.quando, pastas: guardado.itens.map((i) => ({ caminho: i.caminho, arquivos: i.arquivos })), descritas: new Map(guardado.itens.map((i) => [i.caminho, i])), deDisco: true, motivo: e.message };
      }
    }
    const casam = lista.pastas.filter((p) => {
      if (!t) return true;
      const d = lista.descritas.get(p.caminho);
      return `${p.caminho} ${d ? d.nome + ' ' + d.descricao : ''}`.toLowerCase().includes(t);
    });
    // descrições: só das que vão aparecer (as primeiras), e só as que ainda não foram lidas
    const aparecem = casam.slice(0, LIMITES.descricoes);
    if (!offline) {
      await emLotes(aparecem.filter((p) => !lista.descritas.has(p.caminho)), 6, async (p) => {
        const nomePasta = p.caminho.split('/').pop() || repo.split('/')[1];
        try {
          const md = (await pedir(`${raw}/${repo}/HEAD/${p.caminho ? p.caminho + '/' : ''}SKILL.md`, { max: LIMITES.cabecalho * 8 })).toString('utf8').slice(0, LIMITES.cabecalho);
          const c = cabecalhoSkill(md);
          lista.descritas.set(p.caminho, { caminho: p.caminho, arquivos: p.arquivos, nome: (c.name || nomePasta).slice(0, 80), descricao: (c.description || '').slice(0, 400) });
        } catch (e) {
          lista.descritas.set(p.caminho, { caminho: p.caminho, arquivos: p.arquivos, nome: nomePasta, descricao: '', semDescricao: true });
        }
      });
    }
    // a descrição pode ter ajudado a casar com o termo: refaz o filtro agora que há mais texto
    const itens = lista.pastas
      .map((p) => lista.descritas.get(p.caminho) || { caminho: p.caminho, arquivos: p.arquivos, nome: p.caminho.split('/').pop() || repo.split('/')[1], descricao: '', semDescricao: true })
      .filter((i) => !t || `${i.caminho} ${i.nome} ${i.descricao}`.toLowerCase().includes(t));
    if (!offline && !t) guardarCache(repo, { quando: lista.quando, itens: itens.slice(0, 200) });
    return {
      repo, total: lista.pastas.length, itens: itens.slice(0, 120).map((i) => ({ ...i, repo })), offline, quando: lista.quando, motivo: lista.motivo || '',
      mais: itens.length > 120 || (casam.length > LIMITES.descricoes && !t),
    };
  }

  // repositórios da comunidade que têm skills (pelos tópicos do GitHub), os mais estrelados primeiro
  async function repositorios(termo = '') {
    const t = String(termo || '').trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60);
    const consultas = ['agent-skills', 'claude-skills'].map((topico) => `${t ? t + '+' : ''}topic:${topico}`);
    const vistos = new Map();
    let erro = null;
    for (const q of consultas) {
      try {
        const d = await json(`${api}/search/repositories?q=${encodeURIComponent(q).replace(/%2B/g, '+')}&sort=stars&order=desc&per_page=15`);
        for (const r of d.items || []) {
          if (!r || !REPO.test(r.full_name || '') || vistos.has(r.full_name)) continue;
          vistos.set(r.full_name, { repo: r.full_name, descricao: String(r.description || '').slice(0, 300), estrelas: Number(r.stargazers_count) || 0, atualizado: String(r.pushed_at || '').slice(0, 10) });
        }
      } catch (e) { erro = e; }
    }
    if (!vistos.size && erro) throw erro;
    return { repos: [...vistos.values()].sort((a, b) => b.estrelas - a.estrelas).slice(0, 25) };
  }

  // baixa a pasta de UMA skill para destino/<nome-da-pasta>/ e devolve o caminho. Só arquivos da pasta, com limites de quantidade e tamanho.
  async function baixar(repo, caminho, destino) {
    validarRepo(repo);
    if (typeof caminho !== 'string' || caminho.length > 300 || /(^|\/)\.\.?(\/|$)|[\\:*?"<>|\0]/.test(caminho) || caminho.startsWith('/')) throw new ErroCatalogo('erro', 'caminho inválido');
    const d = await arvore(repo);
    const prefixo = caminho ? caminho + '/' : '';
    if (!d.tree.some((x) => x && x.type === 'blob' && x.path === prefixo + 'SKILL.md')) throw new ErroCatalogo('naoEncontrado', 'essa pasta não tem SKILL.md');
    const arquivos = d.tree.filter((x) => x && x.type === 'blob' && typeof x.path === 'string' && x.path.startsWith(prefixo) && !/(^|\/)\.git(\/|$)/.test(x.path));
    if (arquivos.length > LIMITES.arquivos) throw new ErroCatalogo('grande', `a skill tem ${arquivos.length} arquivos (o limite é ${LIMITES.arquivos})`);
    if (arquivos.some((a) => Number(a.size) > LIMITES.arquivo)) throw new ErroCatalogo('grande', 'a skill tem um arquivo maior que 1 MB');
    if (arquivos.reduce((s, a) => s + (Number(a.size) || 0), 0) > LIMITES.total) throw new ErroCatalogo('grande', 'a skill passa de 5 MB');
    const nomePasta = (caminho.split('/').pop() || repo.split('/')[1]).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '') || 'skill';
    const raiz = path.resolve(destino, nomePasta);
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.mkdirSync(raiz, { recursive: true });
    let bytes = 0;
    await emLotes(arquivos, 6, async (a) => {
      const rel = a.path.slice(prefixo.length);
      const alvo = path.resolve(raiz, ...rel.split('/'));
      if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) throw new ErroCatalogo('erro', 'caminho de arquivo suspeito: ' + rel); // nada fora da pasta
      const conteudo = await pedir(`${raw}/${repo}/HEAD/${a.path.split('/').map(encodeURIComponent).join('/')}`);
      bytes += conteudo.length;
      if (bytes > LIMITES.total) throw new ErroCatalogo('grande', 'a skill passa de 5 MB');
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, conteudo);
    });
    return { pasta: raiz, nome: nomePasta, arquivos: arquivos.length, bytes };
  }

  return { listar, repositorios, baixar, validarRepo };
}

module.exports = { criarCatalogo, FONTES, ErroCatalogo, cabecalhoSkill, REPO, LIMITES };
