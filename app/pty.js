// pty.js — terminal embutido: roda um programa (o Claude Code) dentro de um pseudo-console do Windows (ConPTY) e entrega o
// que ele desenha ao widget (xterm.js). O trabalho pesado é do app/pty.cs, compilado UMA vez (só ao abrir a primeira sessão)
// com o csc.exe que já vem no Windows e guardado em %APPDATA%\meu-widget\pty-<hash>.exe. Sem dependência nenhuma (nada de
// node-pty). Sem csc, sem Windows 10 1809+ ou com erro de compilação: garantirExe() devolve null e o abrir.js cai no terminal
// externo de sempre. Não depende do Electron (dá para testar com node).
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { argumentoSeguro } = require('./terminal');

const CSC = path.join(process.env.windir || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const FONTE = path.join(__dirname, 'pty.cs').replace('app.asar', 'app.asar.unpacked');
const OPCOES_CSC = ['-nologo', '-target:winexe', '-platform:x64', '-optimize+'];
const ESPERA_PID = 8000; // quanto esperar o host dizer "PID n" depois de iniciado

let compilando = null; // Promise do exe (uma compilação só, mesmo com vários pedidos ao mesmo tempo)

// Devolve o caminho do pty-<hash>.exe (compilando se preciso) ou null se não der.
function garantirExe(pasta) {
  if (compilando) return compilando;
  compilando = new Promise((resolve) => {
    try {
      if (process.platform !== 'win32' || !fs.existsSync(CSC)) return resolve(null);
      const codigo = fs.readFileSync(FONTE);
      const hash = crypto.createHash('sha1').update(codigo).update(OPCOES_CSC.join(' ')).digest('hex').slice(0, 10);
      const exe = path.join(pasta, `pty-${hash}.exe`);
      if (fs.existsSync(exe)) { limparAntigos(pasta, exe); return resolve(exe); }
      fs.mkdirSync(pasta, { recursive: true });
      const temp = exe + '.tmp';
      execFile(CSC, [...OPCOES_CSC, '-out:' + temp, FONTE], { windowsHide: true, timeout: 60000 }, (erro, saida) => {
        try {
          if (erro) throw new Error((saida || erro.message).toString().slice(0, 300));
          fs.renameSync(temp, exe);
          limparAntigos(pasta, exe);
          resolve(exe);
        } catch (e) {
          console.error('Não deu para compilar o terminal embutido; abre no terminal externo:', e.message);
          try { fs.rmSync(temp, { force: true }); } catch { /* nada a limpar */ }
          resolve(null);
        }
      });
    } catch (e) {
      console.error('Terminal embutido indisponível; abre no terminal externo:', e.message);
      resolve(null);
    }
  });
  // se falhou, o próximo pedido tenta de novo (ex.: o antivírus segurou o arquivo)
  compilando.then((exe) => { if (!exe) compilando = null; });
  return compilando;
}
function limparAntigos(pasta, atual) {
  try {
    for (const f of fs.readdirSync(pasta)) {
      if (/^pty-[0-9a-f]+\.exe(\.tmp)?$/.test(f) && path.join(pasta, f) !== atual) fs.rmSync(path.join(pasta, f), { force: true });
    }
  } catch { /* em uso: fica para a próxima */ }
}

// Um argumento vira UM argumento da linha de comando do Windows (regras do CommandLineToArgvW), com aspas só quando precisa.
function aspas(a) {
  a = String(a);
  if (a !== '' && !/[\s"]/.test(a)) return a;
  let s = '"';
  let barras = 0;
  for (const ch of a) {
    if (ch === '\\') barras++;
    else if (ch === '"') { s += '\\'.repeat(barras * 2 + 1) + '"'; barras = 0; }
    else { s += '\\'.repeat(barras) + ch; barras = 0; }
  }
  return s + '\\'.repeat(barras * 2) + '"';
}
// .exe roda direto (o prompt vai inteiro, com quebras de linha); .cmd/.bat passam pelo cmd.exe, que não aceita quebra de
// linha nem aspas num argumento: ali os argumentos passam pelo mesmo filtro do terminal externo (terminal.argumentoSeguro).
function linhaDeComando(programa, args = []) {
  if (/\.(cmd|bat)$/i.test(programa)) {
    const seguros = args.map((a) => argumentoSeguro(a));
    return `cmd.exe /d /s /c "${[aspas(programa), ...seguros.map(aspas)].join(' ')}"`;
  }
  return [programa, ...args].map(aspas).join(' ');
}

// Inicia o programa. Devolve { pid (do host), pronto: Promise<pid do programa | null>, escrever, redimensionar, encerrar }.
//   aoDados(Buffer)         o que o programa desenhou
//   aoFim(codigo, erro)     o programa terminou (erro = texto do host, se ele reclamou de algo)
function criar({ exe, pasta, programa, args = [], env = process.env, colunas = 100, linhas = 30, aoDados = () => {}, aoFim = () => {} }) {
  const linha = linhaDeComando(programa, args);
  const filho = spawn(exe, [String(Math.max(2, colunas | 0)), String(Math.max(2, linhas | 0))], {
    env: { COLORTERM: 'truecolor', ...env, WIDGET_PTY_LINHA: linha, WIDGET_PTY_PASTA: pasta || '' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let pidPrograma = null;
  let erroHost = '';
  let acabou = false;
  let aviso = () => {};
  const pronto = new Promise((resolve) => {
    const limite = setTimeout(() => resolve(pidPrograma), ESPERA_PID);
    aviso = () => { clearTimeout(limite); resolve(pidPrograma); };
  });
  let sobra = '';
  filho.stderr.setEncoding('utf8');
  filho.stderr.on('data', (t) => {
    sobra += t;
    let i;
    while ((i = sobra.indexOf('\n')) >= 0) {
      const l = sobra.slice(0, i).replace(/\r$/, '');
      sobra = sobra.slice(i + 1);
      const m = /^PID (\d+)$/.exec(l);
      if (m) { pidPrograma = Number(m[1]); aviso(); } else if (l.startsWith('ERRO ')) erroHost = l.slice(5);
    }
  });
  filho.stdout.on('data', (b) => aoDados(b));
  filho.on('error', (e) => { erroHost = erroHost || e.message; });
  filho.on('exit', (codigo) => { acabou = true; aviso(); aoFim(codigo, erroHost); });
  filho.stdin.on('error', () => { /* o host já acabou */ });

  const quadro = (tipo, dados) => {
    if (acabou || !filho.stdin.writable) return;
    const cab = Buffer.alloc(5);
    cab[0] = tipo;
    cab.writeInt32LE(dados.length, 1);
    filho.stdin.write(Buffer.concat([cab, dados]));
  };
  return {
    pid: filho.pid,
    pronto,
    escrever(texto) { quadro(0, Buffer.from(String(texto), 'utf8')); },
    redimensionar(c, l) {
      const d = Buffer.alloc(4);
      d.writeUInt16LE(Math.min(500, Math.max(2, c | 0)), 0);
      d.writeUInt16LE(Math.min(200, Math.max(2, l | 0)), 2);
      quadro(1, d);
    },
    // fecha o canal: o host encerra o programa e tudo o que ele abriu. Se ele não sair em 2 s, o taskkill acaba com a árvore.
    encerrar() {
      if (acabou) return;
      try { filho.stdin.end(); } catch { /* já fechado */ }
      const t = setTimeout(() => {
        if (!acabou) execFile('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true }, () => {});
      }, 2000);
      t.unref();
    },
    vivo: () => !acabou,
  };
}

module.exports = { garantirExe, criar, linhaDeComando, aspas };
