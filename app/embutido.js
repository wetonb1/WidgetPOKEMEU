// embutido.js — as sessões de IA que rodam DENTRO do widget (terminal embutido). Junta o app/pty.js (o pseudo-console) com o que o
// widget precisa: entregar a saída à tela em lotes, guardar o começo da saída até a tela se ligar (xterm.js), e digitar um comando
// (/usage) sozinho, mas só quando a IA estiver mesmo esperando você (as telas de cada IA ficam no app/ias.js). Não depende do Electron: a tela entra como função (enviar).
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const pty = require('./pty');
const ias = require('./ias');

const REPLAY_MAX = 128 * 1024; // histórico recente guardado por sessão (permite destacar/acoplar entre janelas sem gastar RAM à toa)
const LOTE_MS = 12;            // a saída vai à tela em lotes (o Claude redesenha muito)
const SILENCIO_MS = 700;       // só digita depois de a saída ficar quieta por este tempo
const ESPERA_COMANDO_MS = 120000;

const semAnsi = (t) => String(t)
  .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
  .replace(/\x1b[()][0-9A-B]/g, '');

// As telas de cada IA (bloqueios, pronto, caixa de entrada e o tempo entre o texto e o Enter) ficam no app/ias.js. Sem telas
// confirmadas, o widget NUNCA digita sozinho naquela IA. Padrão (chamadas antigas): as do Claude.
const TELAS_CLAUDE = ias.obter('claude').telas;

const TELAS_POWERSHELL = {
  bloqueios: /\[Y\] Yes|\[A\] Yes to All|\[N\] No|\[L\] No to All|\[S\] Suspend/i,
  pronto: /(?:PS\s+[A-Za-z]:\\[^>]*>|PS\s*>)\s*$/m,
  caixa: /(?:PS\s+[A-Za-z]:\\[^>]*>|PS\s*>)\s*$/m,
  entreTextoEEnter: 100,
};

function limparBufferEntrada(buf) {
  let res = '';
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === '\x7f' || ch === '\x08') res = res.slice(0, -1);
    else if (ch >= ' ') res += ch;
  }
  return res.trim();
}

// O texto (o final da saída) mostra a IA esperando você digitar? Os bloqueios só valem se forem a ÚLTIMA coisa na tela: depois que você
// responde, aparece a caixa de entrada de novo e volta a valer.
function promptPronto(texto, telas = TELAS_CLAUDE) {
  if (!telas) return { pronto: false, bloqueado: false };
  const t = semAnsi(texto);
  let bloqueio = -1;
  for (const m of t.matchAll(new RegExp(telas.bloqueios.source, 'gi'))) bloqueio = m.index;
  let pronto = -1;
  for (const m of t.matchAll(new RegExp(telas.pronto.source, 'gi'))) pronto = m.index;
  if (pronto < 0 || !telas.caixa.test(t)) return { pronto: false, bloqueado: bloqueio >= 0 };
  return { pronto: pronto > bloqueio, bloqueado: bloqueio > pronto };
}

function criarGerenciador({ pastaPty, enviar = () => {}, localizar = (p) => p, agora = () => Date.now() }) {
  const terminais = new Map();

  function iniciarQuest(t, texto = '') {
    if (!t || t.acabou) return;
    const agoraMs = agora();
    t.quest = {
      estado: 'executando',
      inicio: agoraMs,
      fim: null,
      duracaoMs: 0,
      texto: String(texto || '').trim().slice(0, 100),
    };
    enviar('term:quest', t.id, { ...t.quest });
  }

  function concluirQuest(t) {
    if (!t || !t.quest || t.quest.estado !== 'executando') return;
    const agoraMs = agora();
    const fim = Math.max(t.quest.inicio, agoraMs - Math.min(SILENCIO_MS, 600));
    t.quest.estado = 'concluido';
    t.quest.fim = fim;
    t.quest.duracaoMs = Math.max(100, fim - t.quest.inicio);
    enviar('term:quest', t.id, { ...t.quest });
  }

  function checarFimQuest(t) {
    if (!t || !t.quest || t.quest.estado !== 'executando') return;
    const decorrido = agora() - t.quest.inicio;
    if (decorrido < 600) return;
    if (t.ultimoDado > t.quest.inicio && agora() - t.ultimoDado < SILENCIO_MS) return;
    const estado = promptPronto(t.cauda, t.telas);
    if (estado.pronto && !estado.bloqueado) {
      concluirQuest(t);
    }
  }

  // ia: a IA desta sessão (as telas dela decidem quando digitar). Sem ia: o Claude (como sempre foi).
  async function iniciar({ pasta, programa, args = [], env = process.env, colunas = 110, linhas = 30, comandoInicial = '', ia = 'claude' }) {
    const exe = await pty.garantirExe(pastaPty);
    if (!exe) return null;
    const id = crypto.randomUUID().slice(0, 8);
    const iaValida = ias.obter(ia) ? ia : (ia === 'powershell' ? 'powershell' : 'claude');
    const telasValidas = (ias.obter(iaValida) || (iaValida === 'powershell' ? { telas: TELAS_POWERSHELL } : ias.obter('claude'))).telas;
    const t = {
      id, h: null, anexado: false, replay: [], replayBytes: 0, lote: [], timerLote: null, cauda: '', decoder: new StringDecoder('utf8'),
      pendente: null, timerCmd: null, ultimoDado: agora(), acabou: false,
      ia: iaValida, telas: telasValidas,
      entradaBuffer: '', timerSilencioQuest: null,
      quest: { estado: 'ocioso', inicio: null, fim: null, duracaoMs: 0, texto: '' },
    };
    terminais.set(id, t);
    t.h = pty.criar({
      exe, pasta, programa: localizar(programa, env) || programa, args, env, colunas, linhas,
      aoDados: (b) => dados(t, b),
      aoFim: (codigo, erro) => fim(t, codigo, erro),
    });
    const iaPid = await t.h.pronto;
    if (!iaPid) { // o host não conseguiu criar o programa (erro lido do stderr no aoFim)
      if (!t.acabou) { t.h.encerrar(); }
      await new Promise((r) => setTimeout(r, 150));
      terminais.delete(id);
      return { erro: t.erro || 'não consegui iniciar o programa dentro do widget' };
    }
    // se iniciado com prompt passado em argumento da CLI, já inicia cronometrando a quest
    if (args && (args.includes('-i') || args.some((a) => typeof a === 'string' && !a.startsWith('-')))) {
      iniciarQuest(t, 'início');
    }
    // comandoAceito: false = esta IA não tem telas confirmadas e o widget não vai digitar (quem chamou põe na área de transferência)
    const comandoAceito = comandoInicial ? comando(id, comandoInicial) : false;
    return { termId: id, pid: t.h.pid, iaPid, comandoAceito };
  }

  function dados(t, b) {
    t.ultimoDado = agora();
    t.cauda = (t.cauda + t.decoder.write(b)).slice(-12000);
    t.replay.push(b);
    t.replayBytes += b.length;
    while (t.replayBytes > REPLAY_MAX && t.replay.length > 1) t.replayBytes -= t.replay.shift().length;
    if (t.anexado) {
      t.lote.push(b);
      if (!t.timerLote) t.timerLote = setTimeout(() => { t.timerLote = null; descarregar(t); }, LOTE_MS);
    }
    if (t.quest && t.quest.estado === 'executando') {
      if (t.timerSilencioQuest) clearTimeout(t.timerSilencioQuest);
      t.timerSilencioQuest = setTimeout(() => {
        t.timerSilencioQuest = null;
        checarFimQuest(t);
      }, SILENCIO_MS + 50);
    }
  }
  function descarregar(t) {
    if (!t.lote.length) return;
    const junto = Buffer.concat(t.lote);
    t.lote = [];
    enviar('term:dados', t.id, junto);
  }
  function fim(t, codigo, erro) {
    t.acabou = true;
    t.erro = erro;
    clearInterval(t.timerCmd);
    if (t.timerSilencioQuest) { clearTimeout(t.timerSilencioQuest); t.timerSilencioQuest = null; }
    if (t.timerLote) { clearTimeout(t.timerLote); t.timerLote = null; }
    if (t.quest && t.quest.estado === 'executando') concluirQuest(t);
    descarregar(t);
    enviar('term:fim', t.id, codigo, erro || '');
    // fica um pouco guardado: a tela pode estar se ligando agora e ainda precisa ler o que ele escreveu
    setTimeout(() => terminais.delete(t.id), 60000).unref();
  }

  // a tela criou o xterm (ou destacou numa 2ª janela): entrega o histórico e, daí em diante, a saída vai ao vivo
  function anexar(id) {
    const t = terminais.get(id);
    if (!t) return null;
    if (t.timerLote) { clearTimeout(t.timerLote); t.timerLote = null; t.lote = []; }
    t.anexado = true;
    if (t.quest) enviar('term:quest', t.id, { ...t.quest });
    return Buffer.concat(t.replay);
  }
  const entrada = (id, texto) => {
    const t = terminais.get(id);
    if (!t || t.acabou || typeof texto !== 'string') return;
    t.h.escrever(texto.slice(0, 200000));

    // Ctrl+C (ASCII 3) interrompe a execução e conclui/cancela a quest
    if (texto.includes('\x03')) {
      t.entradaBuffer = '';
      if (t.quest && t.quest.estado === 'executando') {
        concluirQuest(t);
      }
      return;
    }

    t.entradaBuffer = (t.entradaBuffer + texto).slice(-2000);

    // Enter envia comando/prompt
    if (texto.includes('\r') || texto.includes('\n')) {
      const comandoTexto = limparBufferEntrada(t.entradaBuffer);
      t.entradaBuffer = '';
      const prontoAgora = promptPronto(t.cauda, t.telas);
      if (comandoTexto || !prontoAgora.pronto) {
        iniciarQuest(t, comandoTexto);
      }
    }
  };
  const tamanho = (id, c, l) => { const t = terminais.get(id); if (t && !t.acabou) t.h.redimensionar(c, l); };

  // digita o comando quando o Claude estiver esperando você (nunca numa tela de confirmação). Devolve false se não há como.
  function comando(id, texto) {
    const t = terminais.get(id);
    if (!t || t.acabou || typeof texto !== 'string' || !texto) return false;
    if (!t.telas) return false; // IA sem telas confirmadas: o widget não sabe quando ela espera você, então não digita
    clearInterval(t.timerCmd);
    t.pendente = { texto, ate: agora() + ESPERA_COMANDO_MS, avisouBloqueio: false };
    t.timerCmd = setInterval(() => verificar(t), 500);
    t.timerCmd.unref();
    return true;
  }
  function verificar(t) {
    const p = t.pendente;
    if (!p || t.acabou) { clearInterval(t.timerCmd); return; }
    if (agora() > p.ate) {
      clearInterval(t.timerCmd);
      t.pendente = null;
      enviar('term:aviso', t.id, 'nao-digitei', p.texto);
      return;
    }
    if (agora() - t.ultimoDado < SILENCIO_MS) return; // ainda desenhando
    const estado = promptPronto(t.cauda, t.telas);
    if (estado.bloqueado) {
      if (!p.avisouBloqueio) { p.avisouBloqueio = true; enviar('term:aviso', t.id, 'confirmacao', p.texto); }
      return;
    }
    if (!estado.pronto) return;
    clearInterval(t.timerCmd);
    t.pendente = null;
    t.h.escrever(p.texto);
    setTimeout(() => { if (!t.acabou) t.h.escrever('\r'); }, t.telas.entreTextoEEnter);
    enviar('term:aviso', t.id, 'digitado', p.texto);
    if (p.texto !== '/usage') {
      iniciarQuest(t, p.texto);
    }
  }

  function encerrar(id) { const t = terminais.get(id); if (t && !t.acabou) t.h.encerrar(); }
  function encerrarTodos() { for (const t of terminais.values()) if (!t.acabou) t.h.encerrar(); }
  const existe = (id) => { const t = terminais.get(id); return !!t && !t.acabou; };
  const iaDe = (id) => { const t = terminais.get(id); return t ? t.ia : null; };
  const ativos = () => [...terminais.values()].filter((t) => !t.acabou).map((t) => t.id);

  const obterQuest = (id) => {
    const t = terminais.get(id);
    return t && t.quest ? { ...t.quest } : null;
  };
  const obterQuests = () => {
    const mapa = {};
    for (const [id, t] of terminais.entries()) {
      if (t.quest) mapa[id] = { ...t.quest };
    }
    return mapa;
  };

  return { iniciar, anexar, entrada, tamanho, comando, encerrar, encerrarTodos, existe, ativos, iaDe, obterQuest, obterQuests, iniciarQuest, concluirQuest };
}

module.exports = { criarGerenciador, promptPronto, semAnsi, TELAS_CLAUDE };
