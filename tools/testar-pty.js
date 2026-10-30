// Teste do terminal embutido (app/pty.js + app/pty.cs) com programas inofensivos (cmd, node, ping). Não abre janela nenhuma e não
// usa o Claude. Compila o pty.cs numa pasta temporária (precisa do csc.exe do Windows). uso: npm run testar-pty
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('../app/pty');

let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok    ' : 'FALHOU ') + msg); if (!cond) falhas++; };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const esperar = async (cond, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await pausa(60); } return cond(); };
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

(async () => {
  // ---- aspas da linha de comando (as regras do CommandLineToArgvW) ----
  ok(pty.aspas('abc') === 'abc' && pty.aspas('a b') === '"a b"' && pty.aspas('') === '""', 'aspas: só quando precisa');
  ok(pty.aspas('a"b') === '"a\\"b"' && pty.aspas('c:\\pasta com espaço\\') === '"c:\\pasta com espaço\\\\"', 'aspas: aspas e barras no fim');
  ok(/^cmd\.exe \/d \/s \/c "/.test(pty.linhaDeComando('C:\\x\\claude.cmd', ['--model', 'a "b" c'])) && !/a "b"/.test(pty.linhaDeComando('C:\\x\\claude.cmd', ['a "b" c'])), '.cmd passa pelo cmd.exe e o argumento é limpo');

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-teste-'));
  const exe = await pty.garantirExe(pasta);
  ok(!!exe && fs.existsSync(exe), 'o pty.cs compila (' + (exe ? path.basename(exe) : 'falhou') + ')');
  if (!exe) { process.exit(1); }
  ok((await pty.garantirExe(pasta)) === exe, 'pedir de novo reaproveita o mesmo exe');

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pasta com açento '));
  const sessao = (programa, args, extra = {}) => {
    const s = { texto: '', bytes: 0, fim: null };
    s.h = pty.criar({ exe, pasta: cwd, programa, args, colunas: 90, linhas: 25, aoDados: (b) => { s.texto += b.toString('utf8'); s.bytes += b.length; }, aoFim: (c, e) => { s.fim = { codigo: c, erro: e }; }, ...extra });
    return s;
  };
  const limpo = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

  // ---- 1. programa de uma linha só ----
  let s = sessao('cmd.exe', ['/d', '/c', 'echo OLA-PTY-123']);
  ok(await esperar(() => s.fim), 'um programa curto termina sozinho');
  ok(/OLA-PTY-123/.test(limpo(s.texto)) && s.fim.codigo === 0, 'o que ele escreveu chega (saída 0)');

  // ---- 2. interativo: teclas entram, saída volta ----
  s = sessao('cmd.exe', ['/d']);
  const pidIA = await s.h.pronto;
  ok(Number.isInteger(pidIA) && vivo(pidIA), 'o host avisa o PID do programa (' + pidIA + ')');
  await esperar(() => /[>]/.test(limpo(s.texto)));
  s.h.escrever('echo TECLADO-OK-456\r');
  ok(await esperar(() => /TECLADO-OK-456/.test(limpo(s.texto).replace(/echo TECLADO-OK-456/, ''))), 'o que você digita chega ao programa e a resposta volta');
  s.h.escrever('cd\r');
  ok(await esperar(() => limpo(s.texto).includes('pasta com açento')), 'a pasta de trabalho (com acento e espaços) é a pedida');
  s.h.escrever('echo çãé-ÁÇ-🙂\r');
  ok(await esperar(() => /çãé-ÁÇ/.test(limpo(s.texto).split('echo çãé').pop())), 'acentos viajam nos dois sentidos');
  // ---- 3. redimensionar ----
  s.h.redimensionar(60, 18);
  await pausa(300);
  s.h.escrever('mode con\r');
  ok(await esperar(() => /Colunas:\s+60|Columns:\s+60/i.test(limpo(s.texto))), 'redimensionar muda o tamanho que o programa enxerga (60 colunas)');
  // ---- 4. sair normalmente ----
  s.h.escrever('exit\r');
  ok(await esperar(() => s.fim), 'quando o programa sai, o fim é avisado');

  // ---- 5. os argumentos chegam como foram escritos (espaços, aspas, barras, acentos) ----
  const bruto = ['a b', 'c"d', 'e\\', 'f\\"g', 'h i\\', 'çã é', 'linha1\nlinha2'];
  s = sessao(process.execPath, ['-e', 'process.stdout.write("ARGS:" + Buffer.from(JSON.stringify(process.argv.slice(1))).toString("base64") + ":FIM")', '--', ...bruto], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  await esperar(() => s.fim);
  const m = /ARGS:([A-Za-z0-9+/=\s\x1b\[\];?]*?):FIM/.exec(limpo(s.texto).replace(/\r?\n/g, ''));
  let recebidos = null;
  try { recebidos = JSON.parse(Buffer.from(m[1].replace(/\s/g, ''), 'base64').toString('utf8')); } catch { /* falhou */ }
  ok(JSON.stringify(recebidos) === JSON.stringify(bruto), 'um .exe recebe cada argumento exatamente como foi escrito' + (recebidos ? '' : ' (nada recebido: ' + limpo(s.texto).slice(0, 120) + ')'));

  // ---- 6. encerrar mata o programa e tudo o que ele abriu ----
  s = sessao('cmd.exe', ['/d', '/c', 'ping -t 127.0.0.1 > nul']);
  const pidCmd = await s.h.pronto;
  await pausa(1200);
  const filhos = require('child_process').execFileSync('wmic', ['process', 'where', `ParentProcessId=${pidCmd}`, 'get', 'ProcessId', '/value'], { encoding: 'utf8', windowsHide: true }).match(/\d+/g) || [];
  ok(vivo(pidCmd), 'o programa roda (cmd ' + pidCmd + (filhos.length ? ', filho ' + filhos.join(',') : '') + ')');
  s.h.encerrar();
  ok(await esperar(() => s.fim, 6000), 'encerrar() acaba com a sessão');
  ok(await esperar(() => !vivo(pidCmd) && filhos.every((p) => !vivo(Number(p))), 6000), 'e com o programa e os filhos dele (nada fica órfão)');

  // ---- 7. se o widget some (o canal fecha), o programa não fica rodando ----
  s = sessao('cmd.exe', ['/d', '/c', 'ping -t 127.0.0.1 > nul']);
  const pid2 = await s.h.pronto;
  s.h.encerrar();
  ok(await esperar(() => !vivo(pid2), 6000), 'canal fechado = programa encerrado');

  // ---- 8. exe que não existe: erro claro, sem travar ----
  s = sessao('C:\\nao\\existe\\xyz.exe', []);
  ok(await esperar(() => s.fim) && s.fim.codigo !== 0 && /CreateProcess/.test(s.fim.erro), 'programa inexistente: o host acaba com um erro legível (' + (s.fim && s.fim.erro) + ')');

  fs.rmSync(pasta, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('ERRO DO TESTE:', e.stack); process.exit(1); });
