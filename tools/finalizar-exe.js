// tools/finalizar-exe.js — roda sozinho no fim do "npm run dist".
// Move o "Meu Widget.exe" para a raiz do projeto e apaga a pasta dist inteira
// (win-unpacked, builder-debug.yml etc.), para sobrar só o executável.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const dist = path.join(raiz, 'dist');
const origem = path.join(dist, 'Meu Widget.exe');
const destino = path.join(raiz, 'Meu Widget.exe');

if (!fs.existsSync(origem)) {
  console.error('Não achei dist\\Meu Widget.exe: o build falhou?');
  process.exit(1);
}

try {
  fs.rmSync(destino, { force: true });   // tira o .exe da versão anterior
  fs.renameSync(origem, destino);
} catch (erro) {
  console.error('Não consegui colocar o .exe na raiz: ' + erro.message);
  console.error('Se o widget estiver aberto, feche-o (✕) e rode "npm run dist" de novo.');
  process.exit(1);
}

try {
  fs.rmSync(dist, { recursive: true, force: true });
} catch (erro) {
  console.error('O .exe está pronto, mas não deu para apagar a pasta dist: ' + erro.message);
}

console.log('Pronto: ' + destino + ' (' + Math.round(fs.statSync(destino).size / 1024 / 1024) + ' MB)');
