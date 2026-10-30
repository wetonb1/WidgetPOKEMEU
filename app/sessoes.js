// sessoes.js — as sessões de IA que o widget abriu (painel "Sessões ativas" da aba Projetos).
// Como acha a sessão: o widget abre "cmd /c start ... cmd /k claude ..."; o cmd da janela é filho do
// processo que o widget criou (PID conhecido) e o claude.exe é filho do cmd da janela. Essa ligação
// é procurada uma vez, logo depois de abrir (lista de processos do wmic, ~0,2 s). Depois, saber se a
// sessão continua viva custa quase nada: process.kill(pid, 0), sem abrir processo nenhum.
// Fica salvo em %APPDATA%\meu-widget\sessoes.json para sobreviver a um reinício do widget.
// Não depende do Electron (dá para testar com node).
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RESOLVER_ATE = 60 * 1000;          // sem achar o claude em 1 min, a janela foi fechada
const SEM_RASTREIO_ATE = 12 * 3600 * 1000; // Windows Terminal: sem PID; some sozinho depois de 12 h

// o processo existe? (EPERM = existe, mas é de outro usuário/elevado)
function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// [{ nome, pid, ppid }] de todos os processos, ou null se não deu
function listarProcessos() {
  return new Promise((resolve) => {
    execFile('wmic', ['process', 'get', 'Name,ParentProcessId,ProcessId', '/format:csv'],
      { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (erro, saida) => {
        if (erro) { resolve(null); return; }
        const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const cab = (linhas.shift() || '').split(',');
        const [iNome, iPai, iPid] = ['Name', 'ParentProcessId', 'ProcessId'].map((c) => cab.indexOf(c));
        if (iNome < 0 || iPai < 0 || iPid < 0) { resolve(null); return; }
        resolve(linhas.map((l) => l.split(',')).map((c) => ({ nome: String(c[iNome]).toLowerCase(), ppid: Number(c[iPai]), pid: Number(c[iPid]) })));
      });
  });
}

// fecha a janela da sessão e o que roda nela
function matarArvore(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }, (erro) => resolve(!erro));
  });
}

const chavePasta = (p) => path.resolve(String(p || '')).toLowerCase();

function criarRegistro({ arquivo, processos = listarProcessos, vivo = pidVivo, matar = matarArvore, agora = () => Date.now() } = {}) {
  let sessoes = [];
  try {
    const lidas = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (Array.isArray(lidas)) sessoes = lidas.filter((s) => s && typeof s.id === 'string' && typeof s.pasta === 'string');
  } catch { /* sem arquivo: nenhuma sessão */ }

  function salvar() {
    if (!arquivo) return;
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const temp = arquivo + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(sessoes, null, 2), 'utf8');
      fs.renameSync(temp, arquivo);
    } catch { /* não é grave: a lista se refaz */ }
  }

  // liga cada sessão nova ao cmd da janela e ao processo da IA
  async function resolverPendentes() {
    const pendentes = sessoes.filter((s) => !s.iaPid && s.via === 'cmd' && Number.isInteger(s.spawnPid));
    if (!pendentes.length) return;
    const lista = await processos();
    if (!lista) return;
    for (const s of pendentes) {
      const janela = lista.find((p) => p.ppid === s.spawnPid && p.nome === 'cmd.exe');
      if (!janela) continue;
      s.janelaPid = janela.pid;
      // o nome real do processo de cada IA vem do ias-dados.json (claude.exe, agy.exe); sessões antigas: {executavel}.exe
      const nomeProcesso = String(s.processo || `${s.executavel}.exe`).toLowerCase();
      const ia = lista.find((p) => p.ppid === janela.pid && p.nome === nomeProcesso);
      if (ia) s.iaPid = ia.pid;
    }
  }

  // as sessões que continuam abertas (as que terminaram saem da lista)
  async function listar() {
    const antes = JSON.stringify(sessoes); // antes de resolver: os PIDs achados também precisam ser salvos
    await resolverPendentes();
    const t = agora();
    sessoes = sessoes.filter((s) => {
      const idade = t - Date.parse(s.inicio);
      if (s.iaPid) return vivo(s.iaPid);
      if (s.via !== 'cmd') return idade < SEM_RASTREIO_ATE;
      return idade < RESOLVER_ATE;
    });
    if (JSON.stringify(sessoes) !== antes) salvar();
    return sessoes.map((s) => ({ ...s }));
  }

  function adicionar(dados) {
    const s = {
      id: crypto.randomUUID().slice(0, 8), inicio: new Date(agora()).toISOString(), janelaPid: null, iaPid: null, ...dados,
    };
    sessoes.push(s);
    salvar();
    return { ...s };
  }

  const obter = (id) => sessoes.find((s) => s.id === id) || null;
  const naPasta = (lista, pasta) => lista.find((s) => chavePasta(s.pasta) === chavePasta(pasta)) || null;

  // fecha a janela (e a IA dentro dela). Só é chamado depois da sua confirmação na tela.
  async function encerrar(id) {
    const s = obter(id);
    if (!s) return { ok: false, erro: 'sessão não encontrada (já foi fechada?)' };
    const pid = s.janelaPid || s.iaPid;
    if (!pid) return { ok: false, erro: 'não sei qual é a janela desta sessão; feche-a pelo X' };
    const fechou = await matar(pid);
    sessoes = sessoes.filter((x) => x.id !== id);
    salvar();
    return { ok: true, fechou };
  }

  return { listar, adicionar, obter, naPasta, encerrar };
}

module.exports = { criarRegistro, pidVivo, listarProcessos, chavePasta };
