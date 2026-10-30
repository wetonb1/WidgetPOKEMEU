// skills.js — ponte entre o widget e a biblioteca de skills (aba "Skills").
// Sem regra de negócio: o painel (custos, imposto fixo, simulação, cache) vem do cerebro/tools/tokens.py e
// instalar/remover/ler/importar vêm do skills-biblioteca/skills.py. Aqui só se limpa o que veio da tela e se
// executa "python <script> <comando> --json". Não depende do Electron (testável com node).
const fs = require('fs');
const path = require('path');
const { executar, pastaTools } = require('./cerebro');
const ias = require('./ias');

const NOME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJETO = /^[a-z0-9][a-z0-9-]{0,40}$/;
const CATEGORIAS = new Set(['cerebro', 'codigo', 'escrita', 'blender', 'roblox', 'design', 'outros']);

// o skills.py mora em skills-biblioteca/, ao lado da pasta do cérebro (a mesma relação do repositório)
const scriptSkills = () => path.join(pastaTools(), '..', '..', 'skills-biblioteca', 'skills.py');
const falhou = (erro) => Promise.resolve({ ok: false, tipo: 'erro', erro });
const escopoValido = (e) => (e === 'global' ? 'global' : 'projeto');
const projetoValido = (p) => (typeof p === 'string' && PROJETO.test(p) ? p : null);
// o alvo: uma IA que o ias.js conhece (nunca texto livre). Sem alvo, o Claude (como sempre foi). instalar/remover aceitam também "ambos".
const alvoValido = (a, ambos = false) => {
  if (a === undefined || a === null || a === '') return 'claude';
  if (ambos && a === 'ambos') return 'ambos';
  return typeof a === 'string' && ias.obter(a) ? a : null;
};
const alvoInvalido = (a) => falhou('alvo inválido: ' + String(a).slice(0, 30));

// custos, imposto fixo do contexto escolhido, um cartão por skill e a simulação de instalar/remover
function painel(escopo, projeto, alvo) {
  const p = projetoValido(projeto);
  const a = alvoValido(alvo);
  if (!a) return alvoInvalido(alvo);
  return executar(['painel', '--json', '--escopo=' + escopoValido(escopo), '--alvo=' + a, ...(p ? ['--projeto=' + p] : [])], undefined, 'tokens.py');
}

// alvo "ambos": o skills.py faz cada IA por conta própria e devolve { resultados: [{ alvo, ok, dados | erro }] }
function instalar(nome, escopo, projeto, alvo) {
  if (!NOME.test(String(nome))) return falhou('nome de skill inválido');
  const e = escopoValido(escopo);
  const p = projetoValido(projeto);
  const a = alvoValido(alvo, true);
  if (!a) return alvoInvalido(alvo);
  if (e === 'projeto' && !p) return falhou('escolha um projeto para instalar no projeto');
  return executar(['instalar', nome, '--json', '--alvo=' + a, '--escopo=' + e, ...(e === 'projeto' ? ['--projeto=' + p] : [])], undefined, scriptSkills());
}

function remover(nome, escopo, projeto, alvo) {
  if (!NOME.test(String(nome))) return falhou('nome de skill inválido');
  const e = escopoValido(escopo);
  const p = projetoValido(projeto);
  const a = alvoValido(alvo, true);
  if (!a) return alvoInvalido(alvo);
  if (e === 'projeto' && !p) return falhou('escolha um projeto');
  return executar(['remover', nome, '--json', '--alvo=' + a, '--escopo=' + e, ...(e === 'projeto' ? ['--projeto=' + p] : [])], undefined, scriptSkills());
}

// SKILL.md da biblioteca, só para leitura (com a variante do alvo, se a skill tiver uma)
function ler(nome, alvo) {
  if (!NOME.test(String(nome))) return falhou('nome de skill inválido');
  const a = alvo === undefined || alvo === null || alvo === '' ? null : alvoValido(alvo);
  if (alvo && !a) return alvoInvalido(alvo);
  return executar(['ler', nome, '--json', ...(a ? ['--alvo=' + a] : [])], undefined, scriptSkills());
}

// Importar de fora: sem confirmar só LÊ (SKILL.md inteiro, arquivos e alertas); com confirmar copia para a
// biblioteca. Nada da skill é executado em nenhum dos dois.
function importar(origem, confirmar, categoria, rotulo) {
  if (typeof origem !== 'string' || !path.isAbsolute(origem) || origem.length > 500) return falhou('origem inválida');
  try { fs.statSync(origem); } catch { return falhou('a pasta ou o zip não existe mais'); }
  const cat = CATEGORIAS.has(categoria) ? categoria : null;
  const de = typeof rotulo === 'string' && /^github:[A-Za-z0-9._/-]{1,250}$/.test(rotulo) ? rotulo : null; // de onde veio (catálogo online)
  return executar(['importar', '--json', ...(confirmar === true ? ['--confirmar'] : []), ...(cat ? ['--categoria=' + cat] : []), ...(de ? ['--rotulo=' + de] : []), '--', origem],
    undefined, scriptSkills());
}

module.exports = { painel, instalar, remover, ler, importar };
