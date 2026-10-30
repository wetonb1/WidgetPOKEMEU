// terminal.js — abre uma janela de terminal nova numa pasta, rodando um programa, sem esperar ela
// fechar (processo solto: o widget segue livre). Prefere o Windows Terminal (wt.exe); sem ele, usa
// "cmd /c start". Nos dois casos a janela fica aberta depois (cmd /k).
// O widget não tem mais terminal embutido (saiu na v1.6), então não há essa opção.
const { spawn } = require('child_process');
const fs = require('fs');
const { localizar } = require('./ias');

// Um texto vira UM argumento seguro para a linha de comando do cmd (e do wt):
//  - uma linha só (o cmd não aceita quebra de linha num argumento);
//  - aspas duplas viram simples (não há como escapar aspas dentro de aspas no cmd);
//  - % sai (o cmd expandiria %VARIAVEL% mesmo entre aspas); ; vira , (o wt separa comandos com ;);
//  - sem barra invertida no fim (ela "escaparia" a aspa que fecha o argumento).
function argumentoSeguro(texto, max = 3000) {
  return String(texto ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/"/g, "'")
    .replace(/%/g, ' por cento ')
    .replace(/;/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[\s\\]+$/, ''); // espaços e barras invertidas do fim, juntos
}

// "programa arg1 "arg com espaço"" para o cmd /k (os argumentos já passaram pelo argumentoSeguro)
function linhaDeComando(programa, args) {
  return [programa, ...args].map((a) => (/[\s&|<>^(),]/.test(a) || a === '' ? `"${a}"` : a)).join(' ');
}

// Monta o que seria executado, sem executar (o widget usa; os testes conferem).
//   { pasta, titulo, programa, args } -> { via: 'wt'|'cmd', exe, argv, verbatim }
function planejar({ pasta, titulo, programa, args = [] }, temWt = !!localizar('wt')) {
  if (typeof pasta !== 'string' || !pasta || !fs.existsSync(pasta)) throw new Error('a pasta do projeto não existe');
  // % e aspas no caminho quebrariam a linha do cmd; caminhos do Windows quase nunca têm isso
  if (/["%]/.test(pasta)) throw new Error('o caminho da pasta tem % ou aspas; renomeie a pasta para abrir daqui');
  const seguros = args.map((a) => argumentoSeguro(a));
  const nome = argumentoSeguro(titulo || programa, 80).replace(/[&|<>^]/g, ' ');
  if (temWt) {
    // wt -d <pasta> --title <nome> cmd /k <programa> <args...>
    return { via: 'wt', exe: 'wt.exe', argv: ['-d', pasta, '--title', nome, 'cmd', '/k', programa, ...seguros], verbatim: false };
  }
  // cmd /d /s /c "start "nome" /d "pasta" cmd /k programa args": o /s tira só as aspas de fora
  const linha = `"start "${nome}" /d "${pasta}" cmd /k ${linhaDeComando(programa, seguros)}"`;
  return { via: 'cmd', exe: 'cmd.exe', argv: ['/d', '/s', '/c', linha], verbatim: true };
}

// Abre de verdade. Não espera: o processo nasce solto (detached + unref).
function abrir(opcoes) {
  const plano = planejar(opcoes);
  const filho = spawn(plano.exe, plano.argv, {
    cwd: opcoes.pasta, env: opcoes.env || process.env, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: plano.verbatim,
  });
  filho.on('error', () => { /* o widget não fica preso por isso; o pedido já respondeu */ });
  filho.unref();
  return { ...plano, pid: filho.pid }; // o pid é do processo que abre a janela (o cmd dela é filho dele)
}

module.exports = { argumentoSeguro, linhaDeComando, planejar, abrir };
