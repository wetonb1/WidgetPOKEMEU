// projetos.js — ponte entre o widget e o cerebro/tools/projetos.py (a aba "Projetos").
// Igual ao cerebro.js: aqui não tem regra de negócio; cada função só limpa os dados da tela e
// executa "python projetos.py <comando> --json". As regras (id único, pasta existe, escrita
// atômica do projetos.json, estado no cérebro, CLAUDE.md do projeto) são do projetos.py.
// Os dados de adicionar/editar vão pela entrada padrão, em JSON (sem problema de aspas ou acentos).
// Sem dependência do Electron: dá para testar com "node tools/testar-cerebro.js".
const fs = require('fs');
const path = require('path');
const { executar, pastaRaizWidget } = require('./cerebro');
const ias = require('./ias');

const ID = /^[a-z0-9][a-z0-9-]{0,29}$/;
const falhou = (erro) => Promise.resolve({ ok: false, tipo: 'erro', erro });
const rodar = (args, entrada) => executar(args, entrada, 'projetos.py');
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Cache em memória do listar() para não abrir processo Python toda vez que a aba Projetos entra na tela.
// Só roda o Python quando o arquivo projetos.json ou o sessoes.jsonl mudar no disco.
let cacheListar = null;
let mtimeAssinatura = '';

function arqProjetos() {
  const raiz = typeof pastaRaizWidget === 'function' ? pastaRaizWidget() : path.resolve(__dirname, '..');
  return process.env.PROJETOS_JSON || path.join(raiz, 'projetos.json');
}

function obterAssinatura() {
  try {
    const ap = arqProjetos();
    const st1 = fs.statSync(ap);
    let sig = `${ap}:${st1.mtimeMs}:${st1.size}`;
    const log = path.join(path.dirname(ap), 'cerebro', '.log', 'sessoes.jsonl');
    try {
      const st2 = fs.statSync(log);
      sig += `|${st2.mtimeMs}:${st2.size}`;
    } catch { /* sem log: segue só com o projetos.json */ }
    return sig;
  } catch {
    return '';
  }
}

function invalidarCache() {
  cacheListar = null;
  mtimeAssinatura = '';
}

// só os campos que a tela edita, com tamanho limitado (o projetos.py valida de verdade)
function campos(c) {
  const saida = {};
  const origem = c && typeof c === 'object' ? c : {};
  for (const [chave, max] of [['id', 40], ['nome', 100], ['pasta', 500], ['ia', 20], ['modelo_padrao', 40], ['descricao', 300], ['cor', 9]]) {
    if (chave in origem) saida[chave] = texto(origem[chave], max);
  }
  // outra IA para "continuar em outra IA" (vazio/null tira) e o modelo de cada IA: só textos curtos; o projetos.py valida contra o ias-dados.json
  if ('ia_reserva' in origem) saida.ia_reserva = origem.ia_reserva ? texto(origem.ia_reserva, 20) : null;
  if ('modelos_por_ia' in origem) {
    const m = origem.modelos_por_ia;
    saida.modelos_por_ia = m && typeof m === 'object' && !Array.isArray(m)
      ? Object.fromEntries(Object.entries(m).slice(0, 10).map(([ia, modelo]) => [texto(ia, 20), texto(modelo, 40)]))
      : null;
  }
  for (const chave of ['pular_permissoes', 'usar_api_key']) if (typeof origem[chave] === 'boolean') saida[chave] = origem[chave];
  if ('tags' in origem) saida.tags = Array.isArray(origem.tags) ? origem.tags.slice(0, 20).map((t) => texto(t, 30)) : texto(origem.tags, 300);
  return saida;
}

async function listar() {
  const ass = obterAssinatura();
  if (cacheListar && ass && ass === mtimeAssinatura) {
    return JSON.parse(JSON.stringify(cacheListar));
  }
  const r = await rodar(['listar', '--json']);
  if (r && r.ok) {
    cacheListar = r;
    mtimeAssinatura = ass;
  }
  return r;
}

const adicionar = async (dados) => { invalidarCache(); return rodar(['adicionar', '--json'], JSON.stringify(campos(dados))); };
const editar = async (id, dados) => { invalidarCache(); return ID.test(id) ? rodar(['editar', id, '--json'], JSON.stringify(campos(dados))) : falhou('id inválido'); };
const remover = async (id) => { invalidarCache(); return ID.test(id) ? rodar(['remover', id, '--json']) : falhou('id inválido'); };
const validar = () => rodar(['validar', '--json']);
const marcarAbertura = async (id) => { invalidarCache(); return ID.test(id) ? rodar(['abertura', id, '--json']) : falhou('id inválido'); };
// sem confirmar só devolve o diff para você aprovar; com confirmar grava
const preparar = async (id, confirmar) => { if (confirmar) invalidarCache(); return ID.test(id) ? rodar(['preparar', id, '--json', ...(confirmar === true ? ['--confirmar'] : [])]) : falhou('id inválido'); };
const preencherEstado = async (id, dados) => {
  invalidarCache();
  return ID.test(id)
    ? rodar(['preencher', id, '--json'], JSON.stringify({ objetivo: texto(dados && dados.objetivo, 200), stack: texto(dados && dados.stack, 200) }))
    : falhou('id inválido');
};

// prompt inicial de uma sessão nova (prompt_inicial.txt + tema tirado da tarefa)
// retomada: true = prompt de "continuar de onde paramos" (depois de uma pausa), lendo o estado do cérebro
const montarPrompt = (id, tarefa, retomada = false) => (ID.test(id)
  ? rodar(['prompt', id, '--json'], JSON.stringify({ tarefa: texto(tarefa, 500), retomada: retomada === true }))
  : falhou('id inválido'));
// marca a última abertura e anota em cerebro/.log/sessoes.jsonl
const registrarSessao = async (id, { ia, modelo, tarefa, modo, motivo } = {}) => {
  invalidarCache();
  return ID.test(id)
    ? rodar(['sessao', id, '--json'], JSON.stringify({ ia: texto(ia, 20), modelo: texto(modelo, 40), tarefa: texto(tarefa, 500), modo: texto(modo, 20), motivo: texto(motivo, 40) }))
    : falhou('id inválido');
};

// "Pausar com segurança": ler/gravar só Estado atual e Próximos passos do estado do projeto e anotar a pausa
const estadoDaPausa = (id) => (ID.test(id) ? rodar(['pausa-estado', id, '--json']) : falhou('id inválido'));
const salvarEstadoDaPausa = async (id, dados) => {
  invalidarCache();
  return ID.test(id)
    ? rodar(['pausa-salvar', id, '--json'], JSON.stringify({ estado_atual: String((dados && dados.estado_atual) || '').slice(0, 2000), proximos: String((dados && dados.proximos) || '').slice(0, 2000) }))
    : falhou('id inválido');
};
// ia: a IA da sessão pausada (só uma IA conhecida; sem ela vale a do projeto)
const registrarPausa = async (id, motivo = 'limite', ia = '') => {
  invalidarCache();
  return (ID.test(id) && ['limite', 'manual'].includes(motivo) && (!ia || ias.obter(ia))
    ? rodar(['pausa-registrar', id, '--motivo', motivo, ...(ia ? ['--ia', ia] : []), '--json']) : falhou('id, motivo ou IA inválidos'));
};

// git worktree em {pasta}-sessao2 (branch nova) para uma 2a sessão no mesmo projeto
const criarWorktree = (id) => (ID.test(id) ? rodar(['worktree', id, '--json']) : falhou('id inválido'));

// Avalia a aderência de skills para o projeto com base no cérebro e stack (0 tokens)
const avaliarSkills = (id) => (ID.test(id) ? rodar(['avaliar-skills', id, '--json']) : falhou('id inválido'));

module.exports = { criarWorktree, avaliarSkills, listar, adicionar, editar, remover, validar, marcarAbertura, preparar, preencherEstado, montarPrompt, registrarSessao, estadoDaPausa, salvarEstadoDaPausa, registrarPausa };
