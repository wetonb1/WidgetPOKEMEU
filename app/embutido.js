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

  // ia: a IA desta sessão (as telas dela decidem quando digitar). Sem ia: o Claude (como sempre foi).
  async function iniciar({ pasta, programa, args = [], env = process.env, colunas = 110, linhas = 30, comandoInicial = '', ia = 'claude' }) {
    const exe = await pty.garantirExe(pastaPty);
    if (!exe) return null;
    const id = crypto.randomUUID().slice(0, 8);
    const t = {
      id, h: null, anexado: false, replay: [], replayBytes: 0, lote: [], timerLote: null, cauda: '', decoder: new StringDecoder('utf8'),
      pendente: null, timerCmd: null, ultimoDado: agora(), acabou: false,
      ia: ias.obter(ia) ? ia : 'claude', telas: (ias.obter(ia) || ias.obter('claude')).telas,
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
    if (t.timerLote) { clearTimeout(t.timerLote); t.timerLote = null; }
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
    return Buffer.concat(t.replay);
  }
  const entrada = (id, texto) => { const t = terminais.get(id); if (t && !t.acabou && typeof texto === 'string') t.h.escrever(texto.slice(0, 200000)); };
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
  }

  function encerrar(id) { const t = terminais.get(id); if (t && !t.acabou) t.h.encerrar(); }
  function encerrarTodos() { for (const t of terminais.values()) if (!t.acabou) t.h.encerrar(); }
  const existe = (id) => { const t = terminais.get(id); return !!t && !t.acabou; };
  const iaDe = (id) => { const t = terminais.get(id); return t ? t.ia : null; };
  const ativos = () => [...terminais.values()].filter((t) => !t.acabou).map((t) => t.id);

  return { iniciar, anexar, entrada, tamanho, comando, encerrar, encerrarTodos, existe, ativos, iaDe };
}

module.exports = { criarGerenciador, promptPronto, semAnsi, TELAS_CLAUDE };
