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

// o acervo da busca por projeto ([buscar online] no card): todas as skills destes repositórios são lidas, e as de cada repositório vêm só uma vez.
// oficial = a skill vem de quem faz a IA; o resto aparece como "comunidade, não verificada". indice = arquivo do próprio repositório com todas as
// descrições (1 pedido em vez de milhares; o repositório de 9 mil pastas são ~2.900 skills copiadas em plugins/).
const ACERVO = [
  { repo: 'anthropics/skills', rotulo: 'Anthropic', oficial: true },
  { repo: 'openai/skills', rotulo: 'OpenAI', oficial: true },
  { repo: 'obra/superpowers', rotulo: 'Superpowers' },
  { repo: 'addyosmani/agent-skills', rotulo: 'Addy Osmani' },
  { repo: 'wshobson/agents', rotulo: 'wshobson' },
  { repo: 'alirezarezvani/claude-skills', rotulo: 'alirezarezvani' },
  { repo: 'K-Dense-AI/scientific-agent-skills', rotulo: 'K-Dense (ciência)' },
  { repo: 'coreyhaines31/marketingskills', rotulo: 'Marketing Skills' },
  { repo: 'ComposioHQ/awesome-claude-skills', rotulo: 'Composio' },
  { repo: 'sickn33/agentic-awesome-skills', rotulo: 'Awesome Skills', indice: 'skills_index.json' },
];

const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/; // o nome do repositório nunca é "." nem ".."
const LIMITES = {
  arquivos: 300,           // arquivos por skill
  arquivo: 25 * 1024 * 1024,   // bytes por arquivo (até 25 MB)
  total: 60 * 1024 * 1024,     // bytes por skill (até 60 MB)
  descricoes: 60,          // quantas descrições (SKILL.md) buscar por vez
  cabecalho: 64 * 1024,    // o começo do SKILL.md basta para o nome e a descrição
  espera: 30000,           // ms por pedido
  validade: 30 * 60 * 1000, // quanto tempo a lista da memória vale
  arvore: 32 * 1024 * 1024, // a árvore de um repositório grande passa de 14 MB
  indiceValidade: 24 * 60 * 60 * 1000, // quanto tempo a lista de cada repositório do índice vale
  porRepositorio: 1500,    // pastas de skill lidas por repositório
  repoDescobertos: 10,     // repositórios da comunidade somados por busca (cada um gasta 1 das 60 consultas por hora)
  termosDescoberta: 3,     // termos enviados à busca do GitHub
  estrelasMinimas: 20,     // abaixo disso a busca nem abre o repositório
  tempoDescricoes: 150000, // ms lendo descrições por clique; o que faltar fica para o próximo
  faixaDescricao: 8192,    // bytes pedidos de cada SKILL.md (o cabeçalho fica no começo)
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

// ---------- nota de uma skill para um projeto ----------
// Compara os termos do perfil do projeto (em inglês, escritos pela IA no [ler projeto]) com o nome, a descrição e o caminho de cada skill.
const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_/]+/g, ' ');
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regraDeTermo = (t) => new RegExp('(^|[^a-z0-9+#])' + t.split(/[\s-]+/).map(escapar).join('[\\s-]*') + '(s|es)?($|[^a-z0-9+#])');

function prepararTermos(perfil) {
  const vistos = new Set();
  const lista = [];
  const somar = (t, peso) => {
    const texto = normalizar(t).trim();
    if (texto.length < 1 || vistos.has(texto)) return;
    vistos.add(texto);
    const palavras = texto.split(/[\s-]+/).filter((p) => p.length > 2);
    lista.push({ texto, peso, curto: texto.length < 3, re: regraDeTermo(texto), partes: palavras.length > 1 ? palavras.map(regraDeTermo) : null });
  };
  const termos = Array.isArray(perfil && perfil.termos) ? perfil.termos : [];
  for (const t of (perfil && perfil.stack) || []) somar(t, 3);
  termos.forEach((t, i) => somar(t, i < termos.length / 3 ? 3 : i < (2 * termos.length) / 3 ? 2 : 1)); // a IA escreve do mais específico ao mais geral
  const evitar = ((perfil && perfil.evitar) || []).map((t) => normalizar(t).trim()).filter(Boolean).map(regraDeTermo);
  return { lista, evitar };
}

// { pontos, nivel, casou } de uma skill. Nota 0 = nada a ver com o projeto (não aparece).
function pontuar(item, { lista, evitar }, oficial = false) {
  const nome = normalizar(item.nome + ' ' + String(item.caminho || '').split('/').pop());
  const desc = normalizar(item.descricao);
  const cam = normalizar(item.caminho);
  let total = 0;
  const casou = [];
  for (const t of lista) {
    let v = 0;
    if (t.re.test(nome)) v = 6;
    else if (!t.curto && t.re.test(desc)) v = 3; // "go" e "c" só valem no nome: na descrição são palavras comuns
    else if (!t.curto && t.re.test(cam)) v = 2;
    else if (t.partes && t.partes.every((p) => p.test(nome + ' ' + desc))) v = 1.5;
    if (v) { total += v * t.peso; casou.push({ texto: t.texto, v: v * t.peso }); }
  }
  if (!total) return { pontos: 0, nivel: 'opcional', casou: [] };
  for (const r of evitar) { if (r.test(nome)) total -= 18; else if (r.test(desc)) total -= 9; }
  if (total <= 0) return { pontos: 0, nivel: 'opcional', casou: [] };
  if (oficial) total *= 1.15;
  const pontos = Math.min(99, Math.round(18 + 13 * Math.sqrt(total)));
  casou.sort((a, b) => b.v - a.v);
  return { pontos, nivel: total >= 24 ? 'essencial' : total >= 9 ? 'util' : 'opcional', casou: casou.map((c) => c.texto) };
}

const ROTULOS_NIVEL = { essencial: 'Essencial (Alta)', util: 'Útil (Média)', opcional: 'Opcional (Baixa)' };
const ORDEM_NIVEL = { essencial: 0, util: 1, opcional: 2 };

// Junta a avaliação local (avaliar_skills.py) com a busca: a skill que já está na biblioteca fica como local, que instala sem baixar nada.
function juntarAvaliacao(local, busca) {
  const nomes = new Set((local.skills || []).map((s) => s.nome));
  const novas = busca.skills.filter((s) => !nomes.has(s.nome));
  const skills = [...(local.skills || []), ...novas].sort((a, b) => (ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]) || (b.pontos - a.pontos) || a.nome.localeCompare(b.nome));
  const conta = (f) => skills.filter(f).length;
  return {
    ...local,
    projeto: { ...local.projeto, online: true },
    skills,
    busca: { ...busca, skills: undefined },
    resumo: {
      ...local.resumo, total: skills.length, online: novas.length, locais: conta((s) => s.origem !== 'online'),
      essenciais: conta((s) => s.nivel === 'essencial'), uteis: conta((s) => s.nivel === 'util'), opcionais: conta((s) => s.nivel === 'opcional'),
    },
  };
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

function criarCatalogo({ api = API, raw = RAW, buscar = globalThis.fetch, arquivoCache = null, arquivoIndice = null, agora = () => Date.now() } = {}) {
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
  async function pedir(url, { max = LIMITES.arquivo, faixa = 0 } = {}) {
    let r;
    try {
      r = await buscar(url, { headers: { 'User-Agent': 'meu-widget', Accept: 'application/vnd.github+json', ...(faixa ? { Range: 'bytes=0-' + (faixa - 1) } : {}) }, signal: AbortSignal.timeout(LIMITES.espera), redirect: 'follow' });
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
    const d = await json(`${api}/repos/${repo}/git/trees/HEAD?recursive=1`, { max: LIMITES.arvore });
    if (!Array.isArray(d.tree)) throw new ErroCatalogo('erro', 'resposta inesperada do GitHub');
    return d;
  }
  // as pastas que têm um SKILL.md: [{ caminho, arquivos, sha }]. sha = a versão do SKILL.md (só relê a descrição quando ele muda)
  function pastasDeSkill(d) {
    const blobs = d.tree.filter((x) => x && x.type === 'blob' && typeof x.path === 'string');
    const pastas = new Map();
    for (const b of blobs) {
      if (b.path !== 'SKILL.md' && !b.path.endsWith('/SKILL.md')) continue;
      const caminho = b.path === 'SKILL.md' ? '' : b.path.slice(0, -'/SKILL.md'.length);
      if (/(^|\/)(template|templates|node_modules|\.git)(\/|$)/i.test(caminho)) continue; // modelos em branco não são skills
      pastas.set(caminho, { caminho, arquivos: 0, sha: String(b.sha || '') });
    }
    for (const b of blobs) { // cada arquivo conta para as pastas de skill que o contêm (o caminho vazio é a raiz)
      let p = b.path;
      for (;;) {
        const i = p.lastIndexOf('/');
        p = i < 0 ? '' : p.slice(0, i);
        const pasta = pastas.get(p);
        if (pasta) pasta.arquivos++;
        if (i < 0) break;
      }
    }
    return [...pastas.values()].sort((a, b) => a.caminho.localeCompare(b.caminho));
  }

  // skills de um repositório (com o nome e a descrição lidos do começo de cada SKILL.md). termo filtra pelo caminho e pelo texto.
  async function listar(repo, termo = '') {
    validarRepo(repo);
    const t = String(termo || '').trim().toLowerCase().slice(0, 250);
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
          lista.descritas.set(p.caminho, { caminho: p.caminho, arquivos: p.arquivos, nome: (c.name || nomePasta).slice(0, 250), descricao: (c.description || '').slice(0, 400) });
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
    const t = String(termo || '').trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 250);
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
  async function baixar(repo, caminho, destino, arvorePronta = null) {
    validarRepo(repo);
    if (typeof caminho !== 'string' || caminho.length > 300 || /(^|\/)\.\.?(\/|$)|[\\:*?"<>|\0]/.test(caminho) || caminho.startsWith('/')) throw new ErroCatalogo('erro', 'caminho inválido');
    const d = arvorePronta || await arvore(repo);
    const prefixo = caminho ? caminho + '/' : '';
    if (!d.tree.some((x) => x && x.type === 'blob' && x.path === prefixo + 'SKILL.md')) throw new ErroCatalogo('naoEncontrado', 'essa pasta não tem SKILL.md');
    const arquivos = d.tree.filter((x) => x && x.type === 'blob' && typeof x.path === 'string' && x.path.startsWith(prefixo) && !/(^|\/)\.git(\/|$)/.test(x.path));
    if (arquivos.length > LIMITES.arquivos) throw new ErroCatalogo('grande', `a skill tem ${arquivos.length} arquivos (o limite é ${LIMITES.arquivos})`);
    if (arquivos.some((a) => Number(a.size) > LIMITES.arquivo)) throw new ErroCatalogo('grande', `a skill tem um arquivo maior que ${Math.round(LIMITES.arquivo / (1024 * 1024))} MB`);
    if (arquivos.reduce((s, a) => s + (Number(a.size) || 0), 0) > LIMITES.total) throw new ErroCatalogo('grande', `a skill passa de ${Math.round(LIMITES.total / (1024 * 1024))} MB`);
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
      if (bytes > LIMITES.total) throw new ErroCatalogo('grande', `a skill passa de ${Math.round(LIMITES.total / (1024 * 1024))} MB`);
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, conteudo);
    });
    return { pasta: raiz, nome: nomePasta, arquivos: arquivos.length, bytes };
  }

  // ---------- busca por projeto ----------
  // O índice no disco guarda nome e descrição de cada skill de cada repositório. Na primeira vez lê tudo (1 a 2 minutos); depois só refaz a lista de
  // quem passou de 24 h e só relê o SKILL.md que mudou (sha diferente), então a busca dos outros projetos sai quase de graça.
  function lerIndice() {
    try {
      const d = JSON.parse(fs.readFileSync(arquivoIndice, 'utf8'));
      if (d && typeof d === 'object' && d.repos) return { repos: d.repos, descobertas: d.descobertas || {} };
    } catch { /* primeiro uso, ou arquivo estragado: recomeça */ }
    return { repos: {}, descobertas: {} };
  }
  function guardarIndice(indice) {
    if (!arquivoIndice) return;
    try {
      fs.mkdirSync(path.dirname(arquivoIndice), { recursive: true });
      fs.writeFileSync(arquivoIndice + '.tmp', JSON.stringify(indice), 'utf8');
      fs.renameSync(arquivoIndice + '.tmp', arquivoIndice);
    } catch { /* sem disco a busca ainda responde; só repete o trabalho na próxima */ }
  }

  // uma pasta por skill: as cópias de um mesmo repositório (skills/x e plugins/y/skills/x) ficam no caminho mais curto
  function semCopias(pastas) {
    const melhor = new Map();
    for (const p of pastas) {
      const nome = (p.caminho.split('/').pop() || '').toLowerCase();
      const atual = melhor.get(nome);
      if (!atual || p.caminho.length < atual.caminho.length) melhor.set(nome, p);
    }
    return [...melhor.values()];
  }

  async function atualizarRepo(indice, fonte) {
    const atual = indice.repos[fonte.repo];
    if (atual && agora() - atual.quando < LIMITES.indiceValidade) return;
    if (fonte.indice) {
      const lista = JSON.parse((await pedir(`${raw}/${fonte.repo}/HEAD/${fonte.indice}`, { max: LIMITES.arvore })).toString('utf8'));
      if (!Array.isArray(lista)) throw new ErroCatalogo('erro', 'índice inesperado em ' + fonte.repo);
      const itens = lista.filter((x) => x && typeof x.path === 'string' && !/\.\.|^\//.test(x.path)).slice(0, 6000)
        .map((x) => ({ caminho: x.path, arquivos: 0, sha: '', nome: String(x.name || x.id || x.path.split('/').pop()).slice(0, 250), descricao: String(x.description || '').slice(0, 400), lida: true }));
      indice.repos[fonte.repo] = { quando: agora(), itens };
      return;
    }
    const d = await arvore(fonte.repo);
    const antigas = new Map((atual ? atual.itens : []).map((i) => [i.caminho, i]));
    const pastas = semCopias(pastasDeSkill(d));
    const itens = pastas.slice(0, LIMITES.porRepositorio).map((p) => {
      const velha = antigas.get(p.caminho);
      return velha && velha.lida && velha.sha === p.sha ? { ...velha, arquivos: p.arquivos } : { caminho: p.caminho, arquivos: p.arquivos, sha: p.sha, nome: p.caminho.split('/').pop() || fonte.repo.split('/')[1], descricao: '', lida: false };
    });
    indice.repos[fonte.repo] = { quando: agora(), itens, parcial: !!d.truncated || pastas.length > itens.length };
  }

  // repositórios da comunidade para os termos do projeto, guardados por 24 h para não gastar a busca do GitHub (10 por minuto sem conta)
  async function descobrirRepos(indice, termos) {
    const achados = new Map();
    for (const termo of termos.slice(0, LIMITES.termosDescoberta)) {
      let guardado = indice.descobertas[termo];
      if (!guardado || agora() - guardado.quando >= LIMITES.indiceValidade) {
        const r = await repositorios(termo);
        guardado = { quando: agora(), repos: r.repos.filter((x) => x.estrelas >= LIMITES.estrelasMinimas).map((x) => ({ repo: x.repo, estrelas: x.estrelas })) };
        indice.descobertas[termo] = guardado;
      }
      for (const x of guardado.repos) achados.set(x.repo, x);
    }
    const doAcervo = new Set(ACERVO.map((f) => f.repo));
    return [...achados.values()].filter((x) => !doAcervo.has(x.repo)).sort((a, b) => b.estrelas - a.estrelas).slice(0, LIMITES.repoDescobertos)
      .map((x) => ({ repo: x.repo, rotulo: x.repo.split('/')[0] }));
  }

  async function lerDescricoes(indice, fontes, avisar) {
    const faltam = [];
    for (const f of fontes) for (const i of (indice.repos[f.repo] ? indice.repos[f.repo].itens : [])) if (!i.lida) faltam.push({ repo: f.repo, i });
    const fim = agora() + LIMITES.tempoDescricoes;
    let feitas = 0;
    let limite = false;
    await emLotes(faltam, 12, async ({ repo, i }) => {
      if (limite || agora() > fim) return;
      try {
        const md = (await pedir(`${raw}/${repo}/HEAD/${i.caminho ? i.caminho.split('/').map(encodeURIComponent).join('/') + '/' : ''}SKILL.md`, { max: LIMITES.cabecalho * 8, faixa: LIMITES.faixaDescricao })).toString('utf8');
        const c = cabecalhoSkill(md);
        i.nome = (c.name || i.nome).slice(0, 250);
        i.descricao = (c.description || '').slice(0, 400);
        i.lida = true;
      } catch (e) {
        if (e.tipo === 'limite') limite = true;
        else if (e.tipo === 'naoEncontrado') i.lida = true; // sumiu do repositório: fica sem descrição até a próxima lista
      }
      if (++feitas % 25 === 0) avisar({ etapa: 'descricoes', feitas, total: faltam.length });
    });
    return faltam.filter((x) => !x.i.lida).length; // quantas ficaram para a próxima vez
  }

  // { skills, repositorios, lidas, faltaram, avisos }. perfil = { termos, stack, evitar }. Erro de rede em um repositório não derruba a busca:
  // ele usa o que estiver no índice, e a tela diz o que ficou de fora.
  async function buscarParaProjeto(perfil, aoProgredir = null) {
    const avisar = (x) => { if (aoProgredir) { try { aoProgredir(x); } catch { /* a janela pode ter fechado */ } } };
    const preparados = prepararTermos(perfil);
    if (!preparados.lista.length) throw new ErroCatalogo('erro', 'o projeto ainda não tem termos de busca: use [ler projeto] primeiro');
    const indice = lerIndice();
    const avisos = [];
    let fontes = ACERVO;
    avisar({ etapa: 'repositorios', feitas: 0, total: ACERVO.length });
    try {
      const paraBuscar = [...((perfil && perfil.termos) || []), ...((perfil && perfil.stack) || [])].map((t) => normalizar(t).trim()).filter(Boolean);
      fontes = [...ACERVO, ...(await descobrirRepos(indice, paraBuscar))];
    } catch (e) { avisos.push('a busca por novos repositórios falhou: ' + e.message); }
    let feitos = 0;
    let parar = false;
    for (const f of fontes) {
      if (!parar) {
        try { await atualizarRepo(indice, f); } catch (e) {
          if (e.tipo === 'limite') { parar = true; avisos.push(e.message); }
          else if (e.tipo === 'naoEncontrado') indice.repos[f.repo] = { quando: agora(), itens: [] }; // saiu do ar: não gasta consulta de novo por 24 h
          else if (!indice.repos[f.repo]) avisos.push(`${f.repo}: ${e.message}`);
        }
      }
      avisar({ etapa: 'repositorios', feitas: ++feitos, total: fontes.length });
    }
    guardarIndice(indice);
    const faltaram = await lerDescricoes(indice, fontes, avisar);
    guardarIndice(indice);
    avisar({ etapa: 'nota', feitas: 0, total: 0 });

    const porNome = new Map();
    let lidas = 0;
    const repositoriosLidos = [];
    for (const f of fontes) {
      const dados = indice.repos[f.repo];
      if (!dados) continue;
      if (dados.itens.length) repositoriosLidos.push({ repo: f.repo, skills: dados.itens.length, oficial: !!f.oficial, parcial: !!dados.parcial });
      for (const i of dados.itens) {
        lidas++;
        const nota = pontuar(i, preparados, !!f.oficial);
        if (!nota.pontos) continue;
        const chave = normalizar(i.nome).replace(/[^a-z0-9]+/g, '-');
        const atual = porNome.get(chave);
        const item = {
          nome: i.nome, titulo: i.nome, categoria: 'online', origem: 'online', fonte: f.rotulo || f.repo, verificada: !!f.oficial, repo: f.repo, caminho: i.caminho,
          descricao: i.descricao, nivel: nota.nivel, nivel_rotulo: ROTULOS_NIVEL[nota.nivel], pontos: nota.pontos, razao: 'Combina com o projeto: ' + nota.casou.slice(0, 5).join(', ') + '.',
          economia_estimada: f.oficial ? 'fonte oficial' : 'comunidade, não verificada', instalada_projeto: false, instalada_global: false, compativel: ['claude'], instalavel: true, copias: 1,
        };
        if (!atual) porNome.set(chave, item);
        else { // a mesma skill em vários repositórios: fica a de nota maior, e a oficial ganha sempre
          item.copias = atual.copias + 1;
          if ((item.verificada && !atual.verificada) || (item.verificada === atual.verificada && item.pontos > atual.pontos)) porNome.set(chave, item);
          else atual.copias = item.copias;
        }
      }
    }
    const skills = [...porNome.values()].sort((a, b) => (ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]) || (b.pontos - a.pontos) || a.nome.localeCompare(b.nome));
    return { skills, repositorios: repositoriosLidos, lidas, faltaram, avisos };
  }

  return { listar, repositorios, baixar, validarRepo, arvore, buscarParaProjeto };
}

module.exports = { criarCatalogo, FONTES, ACERVO, ErroCatalogo, cabecalhoSkill, REPO, LIMITES, prepararTermos, pontuar, juntarAvaliacao };
