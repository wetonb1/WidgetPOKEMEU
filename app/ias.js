// ias.js — tudo o que é específico de cada IA, num lugar só (CLAUDE.md: "caminhos e comandos de
// cada IA ficam centralizados"). Os DADOS (nome, executável, modelos, como instalar, variável da chave,
// arquivo de regras, o que cada uma suporta...) ficam em app/ias-dados.json, o mesmo arquivo que o Python
// do cérebro lê (cerebro/tools/ias.py). Aqui fica só o que é código: argumentos(), as variáveis a limpar
// e as telas do terminal embutido. Para outra IA: uma entrada no JSON + uma em CODIGO; o resto não muda.
// Claude: confirmado no "claude --help" da 2.1.292 (docs/claude-code.md).
// Antigravity: só o que o docs/antigravity.md marca como CONFIRMADO (agy 1.4.9).
const fs = require('fs');
const path = require('path');

// IAS_DADOS troca o arquivo (só para os testes automáticos)
const ARQUIVO_DADOS = process.env.IAS_DADOS || path.join(__dirname, 'ias-dados.json');

const CODIGO = {
  claude: {
    // "claude [prompt]" abre a sessão interativa já com o prompt (não precisa colar)
    // Marcas que uma sessão do Claude Code põe no ambiente dos programas que ela abre. Se o widget foi
    // aberto de dentro de uma sessão (ex.: "npm start" no terminal do Claude), a sessão nova herdaria
    // CLAUDE_CODE_CHILD_SESSION e NÃO gravaria a conversa (e "continuar" não acharia nada). Tiramos só
    // essas; configurações suas (ex.: CLAUDE_CODE_GIT_BASH_PATH) passam normalmente.
    limparAmbiente: [
      'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ATTENDED',
      'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EMIT_STARTUP_TIMING',
      'CLAUDE_CODE_STARTUP_FAILURE_RESULTS', 'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
      'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT', 'CLAUDE_CODE_ENABLE_TASKS',
    ],
    // modo: novo | continuar (-c: a conversa mais recente da pasta) | retomar (-r: escolher numa lista)
    argumentos({ modo = 'novo', modelo, prompt, pularPermissoes = false }) {
      const args = [];
      if (modo === 'continuar') args.push('--continue');
      if (modo === 'retomar') args.push('--resume');
      if (modelo) args.push('--model', modelo);
      // só quando o projeto tem "pular_permissoes": true (desligado por padrão, com aviso na tela)
      if (pularPermissoes === true) args.push('--dangerously-skip-permissions');
      if (modo === 'novo' && prompt) args.push(prompt);
      return args;
    },
    // terminal embutido (app/embutido.js): quando o Claude está esperando você e quando pede uma decisão
    telas: {
      // telas em que ele pede UMA DECISÃO sua (confiar na pasta, entrar na conta...): o widget nunca digita nem aperta nada nelas
      bloqueios: /Do you trust|trust the files|trust this folder|Yes, proceed|Yes, I trust|Select login method|Choose the text style|Paste code here|Press Enter to continue|Welcome to Claude Code/i,
      // "pronto para digitar": a caixa de entrada (caixa) mais o rodapé do Claude Code (pronto)
      pronto: /(shift\+tab to cycle|\? for shortcuts|for agents)/i,
      caixa: /❯/,
      entreTextoEEnter: 600, // o Claude trata texto + Enter juntos como "colar"; separados, é "digitar e enviar"
    },
  },
  antigravity: {
    // nomes que o agy põe no ambiente dos programas que ele abre (docs/antigravity.md, seção 5)
    limparAmbiente: [
      'ANTIGRAVITY_AGENT', 'ANTIGRAVITY_AGENTAPI_EXE', 'ANTIGRAVITY_APP_DATA_DIR', 'ANTIGRAVITY_CONVERSATION_ID',
      'ANTIGRAVITY_CSRF_TOKEN', 'ANTIGRAVITY_LS_ADDRESS', 'ANTIGRAVITY_LS_VERSION', 'ANTIGRAVITY_PROJECT_ID',
      'ANTIGRAVITY_SOURCE_METADATA', 'ANTIGRAVITY_TRAJECTORY_ID', 'HGEDITOR', 'JJ_EDITOR',
    ],
    // novo: --model + "-i prompt" (o agy recusa o prompt como argumento solto); continuar: -c (a da pasta);
    // retomar: não existe na linha de comando (só /resume dentro da sessão) -> null
    argumentos({ modo = 'novo', modelo, prompt, pularPermissoes = false }) {
      if (modo === 'retomar') return null;
      const args = [];
      if (modo === 'continuar') args.push('-c');
      if (modelo) args.push('--model', modelo);
      if (pularPermissoes === true) args.push('--dangerously-skip-permissions');
      if (modo === 'novo' && prompt) args.push('-i', prompt);
      return args;
    },
    // frases capturadas no agy 1.4.9 (docs/antigravity.md, seção 6; capturas em tools/fixtures/agy-*.txt). A tela de login não foi
    // capturada: sem o rodapé "? for shortcuts" ela nunca conta como "pronto", então o widget não digita nada nela.
    telas: {
      bloqueios: /Do you trust the contents of this project|Yes, I trust this folder|Requesting permission for:|Run this command\?/i,
      pronto: /\? for shortcuts/i,
      caixa: /^\s*>(\s|$)/m, // a linha da caixa de entrada começa com ">"
      entreTextoEEnter: 600, // testado no 10.0 (junto também envia; separado é o que já se viu funcionar)
    },
  },
};

function carregarDados() {
  const dados = JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8'));
  const ias = {};
  for (const [id, d] of Object.entries(dados)) {
    if (!d || typeof d !== 'object') continue;
    const codigo = CODIGO[id] || { limparAmbiente: [], argumentos: () => null, telas: null };
    ias[id] = {
      ...d,
      id,
      promptPorArgumento: !!(d.suporta && d.suporta.promptPorArgumento),
      processo: d.processo || `${d.executavel}.exe`,
      limparAmbiente: codigo.limparAmbiente,
      argumentos: codigo.argumentos,
      telas: codigo.telas,
    };
  }
  return ias;
}

const IAS = carregarDados();

// ambiente para a sessão nova: o do widget, sem as marcas de sessão da IA e (por padrão) sem a chave de API,
// para a sessão usar o login da assinatura. usarChave: true deixa a chave do Windows passar (opção do projeto).
function ambiente(ia, base = process.env, { usarChave = false } = {}) {
  const env = { ...base };
  const tirar = new Set(ia.limparAmbiente || []);
  if (usarChave !== true && ia.variavelChave) tirar.add(ia.variavelChave);
  for (const nome of tirar) {
    for (const chave of Object.keys(env)) if (chave.toUpperCase() === nome) delete env[chave];
  }
  return env;
}

// A chave de API existe no ambiente do Windows? (só sim/não; o valor nunca sai daqui)
function temChave(ia, base = process.env) {
  if (!ia.variavelChave) return false;
  return Object.keys(base).some((c) => c.toUpperCase() === ia.variavelChave && String(base[c] || '').trim() !== '');
}

const obter = (id) => (Object.prototype.hasOwnProperty.call(IAS, id) ? IAS[id] : null);

// Procura um executável no PATH, como o "where" do Windows (PATHEXT: .EXE, .CMD...).
// Guarda em cache por 30 s para não varrer dezenas de pastas do PATH a cada chamada da tela.
const cacheLocalizar = new Map();
function localizar(nome, env = process.env) {
  const chave = String(nome) + '|' + String(env.PATH || env.Path || '');
  const item = cacheLocalizar.get(chave);
  if (item && Date.now() - item.hora < 30000) return item.res;
  const pastas = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const extensoes = process.platform === 'win32' ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  let achou = null;
  for (const pasta of pastas) {
    for (const ext of extensoes) {
      const candidato = path.join(pasta.replace(/^"|"$/g, ''), nome + ext.toLowerCase());
      try { if (fs.statSync(candidato).isFile()) { achou = candidato; break; } } catch { /* não está aqui */ }
    }
    if (achou) break;
  }
  cacheLocalizar.set(chave, { hora: Date.now(), res: achou });
  return achou;
}

// O que a tela precisa saber de cada IA (sem funções e sem o valor da chave): nome, modelos e dicas, se está
// instalada, o que suporta, os comandos úteis e o NOME da variável da chave
function resumo() {
  const saida = {};
  for (const [id, ia] of Object.entries(IAS)) {
    const instalada = !!localizar(ia.executavel);
    saida[id] = {
      nome: ia.nome, executavel: ia.executavel, titulos: { ...(ia.titulos || {}) }, modelos: ia.modelos, modeloPadrao: ia.modeloPadrao, instalada, chaveNoAmbiente: temChave(ia),
      instalar: ia.instalar, instalarAlternativa: ia.instalarAlternativa, docs: ia.docs,
      suporta: { ...ia.suporta }, dicas: { ...(ia.dicas || {}) }, comandosUteis: [...(ia.comandosUteis || [])],
      variavelChave: ia.variavelChave || null, arquivoRegras: ia.arquivoRegras,
    };
  }
  return saida;
}

module.exports = { IAS, obter, localizar, resumo, ambiente, temChave };
