// catalogo-skills.js — o catálogo online de skills (aba Skills > [buscar online]). Procura skills nos repositórios do GitHub (as oficiais da
// Anthropic para o Claude, as da OpenAI para o Codex, repositórios da comunidade ou um que você digitar) e baixa a PASTA de uma skill para
// uma pasta temporária, de onde o fluxo seguro de sempre (skills.py importar) mostra tudo para você revisar. Nada daqui é executado nem
// instalado: este módulo só LÊ da internet e GRAVA arquivos de texto numa pasta temporária.
// Só roda por clique seu (nada em segundo plano). Sem conta no GitHub o limite é de 60 consultas por hora: a lista fica guardada no disco
// (funciona sem internet) e o erro de limite é explicado. Não depende do Electron (testável com node); os endereços entram por parâmetro.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const CODELOAD = 'https://codeload.github.com';

// de onde vêm as skills (o "ia" é para quem a skill serve; o formato SKILL.md é o mesmo em todas)
const FONTES = [
  { id: 'anthropics/skills', rotulo: 'Anthropic (Claude)', ia: 'claude', descricao: 'as skills oficiais do Claude' },
  { id: 'openai/skills', rotulo: 'OpenAI (Codex)', ia: 'codex', descricao: 'skills oficiais do Codex, no formato SKILL.md' },
  { id: 'microsoft/skills', rotulo: 'Microsoft (Oficial)', ia: 'claude', descricao: '210+ skills oficiais da Microsoft (Azure, .NET, Python, TS, Playwright)' },
  { id: 'google/skills', rotulo: 'Google Cloud & AI (Oficial)', ia: 'claude', descricao: '190+ skills oficiais do Google (Cloud, BigQuery, Vertex AI, Android, Web)' },
  { id: 'googleworkspace/cli', rotulo: 'Google Workspace (Oficial)', ia: 'claude', descricao: '95+ skills oficiais para Drive, Docs, Sheets, Gmail e Calendar' },
  { id: 'github/awesome-copilot', rotulo: 'GitHub Copilot (Oficial)', ia: 'claude', descricao: '475+ skills da coleção oficial do GitHub para várias linguagens e DevOps' },
  { id: 'NVIDIA/skills', rotulo: 'NVIDIA AI & 3D (Oficial)', ia: 'claude', descricao: '430+ skills oficiais da NVIDIA (CUDA, GPU, PyTorch, Omniverse, Simulação 3D)' },
  { id: 'vercel-labs/agent-skills', rotulo: 'Vercel & Next.js (Oficial)', ia: 'claude', descricao: 'skills oficiais da Vercel para React, Next.js e UI' },
  { id: 'cloudflare/skills', rotulo: 'Cloudflare (Oficial)', ia: 'claude', descricao: 'skills oficiais da Cloudflare (Workers, Pages, D1, R2, Segurança)' },
  { id: 'huggingface/skills', rotulo: 'Hugging Face (Oficial)', ia: 'claude', descricao: 'skills oficiais do Hugging Face (Transformers, Datasets, Treino de LLMs, Spaces)' },
  { id: 'stripe/ai', rotulo: 'Stripe (Oficial)', ia: 'claude', descricao: '60+ skills oficiais da Stripe para pagamentos, checkout e SaaS' },
  { id: 'trailofbits/skills', rotulo: 'Trail of Bits (Segurança)', ia: 'claude', descricao: '98+ skills de auditoria de segurança, análise de código e vulnerabilidades' },
  { id: 'getsentry/skills', rotulo: 'Sentry (Oficial)', ia: 'claude', descricao: 'skills oficiais do Sentry para monitoramento, erros e performance' },
  { id: 'datadog-labs/agent-skills', rotulo: 'Datadog (Oficial)', ia: 'claude', descricao: '69+ skills oficiais da Datadog para observabilidade, logs e APM' },
  { id: 'flutter/skills', rotulo: 'Flutter (Oficial)', ia: 'claude', descricao: '31+ skills oficiais do Flutter para apps mobile, desktop e Dart' },
  { id: 'expo/skills', rotulo: 'Expo / React Native (Oficial)', ia: 'claude', descricao: '25+ skills oficiais do Expo para aplicativos React Native' },
  { id: 'supabase/agent-skills', rotulo: 'Supabase (Oficial)', ia: 'claude', descricao: 'skills oficiais do Supabase para Postgres, RLS e Auth' },
  { id: 'prisma/skills', rotulo: 'Prisma ORM (Oficial)', ia: 'claude', descricao: 'skills oficiais do Prisma para banco de dados, ORM e migrações SQL' },
  { id: 'remotion-dev/skills', rotulo: 'Remotion Vídeo (Oficial)', ia: 'claude', descricao: 'skills oficiais do Remotion para criação programática de vídeos e reels em React' },
  { id: 'affaan-m/ECC', rotulo: 'Everything Claude Code (1000+)', ia: 'claude', descricao: '1.060+ skills de engenharia, arquitetura, segurança, testes e linguagens' },
  { id: 'davila7/claude-code-templates', rotulo: 'Claude Code Templates (900+)', ia: 'claude', descricao: '920+ skills para desenvolvimento full-stack, IA, dados e DevOps' },
  { id: 'sickn33/agentic-awesome-skills', rotulo: 'Awesome Skills (2900+)', ia: 'claude', descricao: '2.900+ skills reunidas da comunidade para todas as stacks' },
  { id: 'alirezarezvani/claude-skills', rotulo: 'Alireza Rezvani (410+)', ia: 'claude', descricao: '410+ skills prontas de engenharia, produto, marketing e infraestrutura' },
  { id: 'NeoLabHQ/context-engineering-kit', rotulo: 'Context Engineering Kit (200+)', ia: 'claude', descricao: '200+ skills focadas em engenharia de contexto, arquitetura e economia de tokens' },
  { id: 'wondelai/skills', rotulo: 'Wondelai (Produto, UX & Livros)', ia: 'claude', descricao: '196+ skills de arquitetura, UX/UI, design de produto e frameworks de livros' },
  { id: 'arjun988/blender-skills', rotulo: 'Blender 3D (188 skills)', ia: 'claude', descricao: '188 skills de modelagem 3D no Blender, malhas, modificadores, render e impressão 3D' },
  { id: 'GarethManning/education-agent-skills', rotulo: 'Educação & Pesquisa (165+)', ia: 'claude', descricao: '165+ skills para pesquisa acadêmica, artigos, escrita científica e estudo' },
  { id: 'K-Dense-AI/scientific-agent-skills', rotulo: 'K-Dense (Ciência & Python)', ia: 'claude', descricao: '140+ skills científicas para Python, dados, GPU, bioinformática e física' },
  { id: 'wshobson/agents', rotulo: 'wshobson (Agentes & Fluxos)', ia: 'claude', descricao: '150+ skills de engenharia de software, revisão e automação' },
  { id: 'LambdaTest/agent-skills', rotulo: 'LambdaTest (QA & Testes)', ia: 'claude', descricao: '87 skills de testes automatizados (Playwright, Cypress, Selenium, Pytest, Jest)' },
  { id: 'garrytan/gstack', rotulo: 'Garry Tan (gstack)', ia: 'claude', descricao: '75 skills de engenharia de produto, revisão de arquitetura, design e QA' },
  { id: 'deanpeters/Product-Manager-Skills', rotulo: 'Product Manager (77 skills)', ia: 'claude', descricao: '77 skills de gestão de produto, descoberta, PRD e roadmaps' },
  { id: 'mattpocock/skills', rotulo: 'Matt Pocock (TypeScript & TDD)', ia: 'claude', descricao: '39 skills práticas de engenharia, TypeScript, TDD e Git' },
  { id: 'coreyhaines31/marketingskills', rotulo: 'Marketing Skills', ia: 'claude', descricao: '31 skills de SEO, copywriting, conversão, crescimento e analytics' },
  { id: 'obra/superpowers', rotulo: 'Superpowers', ia: 'claude', descricao: 'metodologia e skills de desenvolvimento ágil e testes para agentes' },
  { id: 'addyosmani/agent-skills', rotulo: 'Addy Osmani', ia: 'claude', descricao: 'skills de engenharia web de produção por Addy Osmani' },
  { id: 'comunidade', rotulo: 'Comunidade (GitHub)', busca: true, descricao: 'repositórios de skills de qualquer pessoa, pelos mais estrelados' },
  { id: 'outro', rotulo: 'Outro repositório', outro: true, descricao: 'digite dono/repositório' },
];

// o acervo da busca por projeto ([buscar online] no card): todas as skills destes repositórios são lidas, e as de cada repositório vêm só uma vez.
// oficial = a skill vem de quem faz a IA ou a plataforma; o resto aparece como "comunidade, não verificada". indice = arquivo do próprio repositório
// com todas as descrições (1 pedido em vez de milhares; o repositório de 9 mil pastas são ~2.900 skills copiadas em plugins/).
const ACERVO = [
  // Oficiais de plataformas, IAs, nuvem, bancos de dados e ferramentas (33 repositórios)
  { repo: 'anthropics/skills', rotulo: 'Anthropic', oficial: true },
  { repo: 'openai/skills', rotulo: 'OpenAI', oficial: true },
  { repo: 'microsoft/skills', rotulo: 'Microsoft', oficial: true },
  { repo: 'google/skills', rotulo: 'Google', oficial: true },
  { repo: 'google-gemini/gemini-skills', rotulo: 'Google Gemini', oficial: true },
  { repo: 'googleworkspace/cli', rotulo: 'Google Workspace', oficial: true },
  { repo: 'github/awesome-copilot', rotulo: 'GitHub Copilot', oficial: true },
  { repo: 'NVIDIA/skills', rotulo: 'NVIDIA', oficial: true },
  { repo: 'vercel-labs/agent-skills', rotulo: 'Vercel', oficial: true },
  { repo: 'vercel-labs/skills', rotulo: 'Vercel CLI', oficial: true },
  { repo: 'cloudflare/skills', rotulo: 'Cloudflare', oficial: true },
  { repo: 'supabase/agent-skills', rotulo: 'Supabase', oficial: true },
  { repo: 'huggingface/skills', rotulo: 'Hugging Face', oficial: true },
  { repo: 'stripe/ai', rotulo: 'Stripe', oficial: true },
  { repo: 'trailofbits/skills', rotulo: 'Trail of Bits', oficial: true },
  { repo: 'getsentry/skills', rotulo: 'Sentry', oficial: true },
  { repo: 'datadog-labs/agent-skills', rotulo: 'Datadog', oficial: true },
  { repo: 'flutter/skills', rotulo: 'Flutter', oficial: true },
  { repo: 'expo/skills', rotulo: 'Expo', oficial: true },
  { repo: 'firebase/agent-skills', rotulo: 'Firebase', oficial: true },
  { repo: 'hashicorp/agent-skills', rotulo: 'HashiCorp', oficial: true },
  { repo: 'redis/agent-skills', rotulo: 'Redis', oficial: true },
  { repo: 'mongodb/agent-skills', rotulo: 'MongoDB', oficial: true },
  { repo: 'prisma/skills', rotulo: 'Prisma', oficial: true },
  { repo: 'neondatabase/agent-skills', rotulo: 'Neon Postgres', oficial: true },
  { repo: 'qdrant/skills', rotulo: 'Qdrant', oficial: true },
  { repo: 'clickhouse/agent-skills', rotulo: 'ClickHouse', oficial: true },
  { repo: 'duckdb/duckdb-skills', rotulo: 'DuckDB', oficial: true },
  { repo: 'apollographql/skills', rotulo: 'Apollo GraphQL', oficial: true },
  { repo: 'remotion-dev/skills', rotulo: 'Remotion', oficial: true },
  { repo: 'WordPress/agent-skills', rotulo: 'WordPress', oficial: true },
  { repo: 'browserbase/skills', rotulo: 'Browserbase', oficial: true },
  { repo: 'firecrawl/cli', rotulo: 'Firecrawl', oficial: true },
  { repo: 'makenotion/claude-code-notion-plugin', rotulo: 'Notion', oficial: true },
  // Grandes bibliotecas e coleções especializadas da comunidade (26 repositórios)
  { repo: 'obra/superpowers', rotulo: 'Superpowers' },
  { repo: 'addyosmani/agent-skills', rotulo: 'Addy Osmani' },
  { repo: 'mattpocock/skills', rotulo: 'Matt Pocock' },
  { repo: 'wshobson/agents', rotulo: 'wshobson' },
  { repo: 'alirezarezvani/claude-skills', rotulo: 'alirezarezvani' },
  { repo: 'affaan-m/ECC', rotulo: 'Everything Claude Code' },
  { repo: 'davila7/claude-code-templates', rotulo: 'Claude Templates' },
  { repo: 'K-Dense-AI/scientific-agent-skills', rotulo: 'K-Dense (ciência)' },
  { repo: 'arjun988/blender-skills', rotulo: 'Blender Skills (3D)' },
  { repo: 'jangtrinh/design-os-3d-blender', rotulo: 'Design:OS Blender' },
  { repo: 'NeoLabHQ/context-engineering-kit', rotulo: 'Context Kit' },
  { repo: 'muratcankoylan/Agent-Skills-for-Context-Engineering', rotulo: 'Context Engineering' },
  { repo: 'wondelai/skills', rotulo: 'Wondelai (UX & Produto)' },
  { repo: 'GarethManning/education-agent-skills', rotulo: 'Education & Research' },
  { repo: 'deanpeters/Product-Manager-Skills', rotulo: 'Product Manager' },
  { repo: 'garrytan/gstack', rotulo: 'Garry Tan (gstack)' },
  { repo: 'phuryn/pm-skills', rotulo: 'PM Skills' },
  { repo: 'coreyhaines31/marketingskills', rotulo: 'Marketing Skills' },
  { repo: 'ComposioHQ/awesome-claude-skills', rotulo: 'Composio' },
  { repo: 'pbakaus/impeccable', rotulo: 'Impeccable (UI)' },
  { repo: 'nextlevelbuilder/ui-ux-pro-max-skill', rotulo: 'UI/UX Pro Max' },
  { repo: 'czlonkowski/n8n-skills', rotulo: 'n8n Skills' },
  { repo: 'callstackincubator/agent-skills', rotulo: 'Callstack (RN)' },
  { repo: 'sanjay3290/ai-skills', rotulo: 'Sanjay AI Skills' },
  { repo: 'LambdaTest/agent-skills', rotulo: 'LambdaTest (QA)', indice: 'skills_index.json' },
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

  // Lê a árvore direto do tarball (codeload.github.com) quando a API de 60 pedidos/hora do GitHub estourar em produção
  async function arvoreTarball(repo) {
    const gz = await pedir(`${CODELOAD}/${repo}/tar.gz/HEAD`, { max: LIMITES.total });
    let tar;
    try { tar = zlib.gunzipSync(gz); } catch { throw new ErroCatalogo('erro', 'pacote inesperado do GitHub'); }
    const tree = [];
    let pos = 0;
    while (pos + 512 <= tar.length) {
      const cab = tar.subarray(pos, pos + 512);
      if (cab[0] === 0) { pos += 512; continue; }
      let nome = cab.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
      const pref = cab.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
      if (pref) nome = pref + '/' + nome;
      const tam = parseInt(cab.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0;
      const tipo = String.fromCharCode(cab[156]);
      const ini = pos + 512;
      pos = ini + Math.ceil(tam / 512) * 512;
      if ((tipo === '0' || tipo === '\0') && nome) {
        const rel = nome.split('/').slice(1).join('/');
        if (!rel) continue;
        let sha = '';
        if ((rel === 'SKILL.md' || rel.endsWith('/SKILL.md')) && ini + tam <= tar.length) {
          sha = crypto.createHash('sha1').update(`blob ${tam}\0`).update(tar.subarray(ini, ini + tam)).digest('hex');
        }
        tree.push({ path: rel, type: 'blob', size: tam, sha });
      }
    }
    return { sha: 'head', truncated: false, tree };
  }

  // a árvore de arquivos do repositório inteira (1 pedido; se a API de 60/h limitar no GitHub real, cai no codeload)
  async function arvore(repo) {
    try {
      const d = await json(`${api}/repos/${repo}/git/trees/HEAD?recursive=1`, { max: LIMITES.arvore });
      if (!Array.isArray(d.tree)) throw new ErroCatalogo('erro', 'resposta inesperada do GitHub');
      return d;
    } catch (e) {
      if (api === API && e instanceof ErroCatalogo && e.tipo === 'limite') return arvoreTarball(repo);
      throw e;
    }
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
    const consultas = ['agent-skills', 'claude-skills', 'claude-code-skills'].map((topico) => `${t ? t + '+' : ''}topic:${topico}`);
    const vistos = new Map();
    let erro = null;
    for (const q of consultas) {
      try {
        const d = await json(`${api}/search/repositories?q=${encodeURIComponent(q).replace(/%2B/g, '+')}&sort=stars&order=desc&per_page=20`);
        for (const r of d.items || []) {
          if (!r || !REPO.test(r.full_name || '') || vistos.has(r.full_name)) continue;
          vistos.set(r.full_name, { repo: r.full_name, descricao: String(r.description || '').slice(0, 300), estrelas: Number(r.stargazers_count) || 0, atualizado: String(r.pushed_at || '').slice(0, 10) });
        }
      } catch (e) { erro = e; }
    }
    if (!vistos.size && erro) throw erro;
    return { repos: [...vistos.values()].sort((a, b) => b.estrelas - a.estrelas).slice(0, 30) };
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
      const bruto = JSON.parse((await pedir(`${raw}/${fonte.repo}/HEAD/${fonte.indice}`, { max: LIMITES.arvore })).toString('utf8'));
      const lista = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.skills) ? bruto.skills : null);
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

  async function lerDescricoes(indice, fontes, avisar, preparados = null) {
    const faltam = [];
    for (const f of fontes) {
      for (const i of (indice.repos[f.repo] ? indice.repos[f.repo].itens : [])) {
        if (!i.lida) {
          const prio = (preparados ? pontuar(i, preparados, !!f.oficial).pontos : 0) + (f.oficial ? 1 : 0);
          faltam.push({ repo: f.repo, i, prio });
        }
      }
    }
    if (preparados) faltam.sort((a, b) => b.prio - a.prio);
    const fim = agora() + LIMITES.tempoDescricoes;
    let feitas = 0;
    let limite = false;
    await emLotes(faltam, 16, async ({ repo, i }) => {
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
      if (++feitos % 12 === 0) guardarIndice(indice);
      avisar({ etapa: 'repositorios', feitas: feitos, total: fontes.length });
    }
    guardarIndice(indice);
    const faltaram = await lerDescricoes(indice, fontes, avisar, preparados);
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
