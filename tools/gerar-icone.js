// tools/gerar-icone.js — gera assets/icone.ico (a pokébola cúbica vermelha).
// Uso: npm run icone
// Desenha a mesma pokébola da tela de carregamento (o CSS do app/style.css), parada
// no ângulo de "vitrine", numa janela invisível com fundo transparente, e monta
// um .ico com os tamanhos que o Windows usa (16 a 256 px, em PNG dentro do .ico).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const TAMANHOS = [256, 128, 64, 48, 32, 24, 16];

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="stylesheet" href="${path.join(RAIZ, 'app', 'style.css').replace(/\\/g, '/')}">
<style>
  html, body { background: transparent !important; margin: 0; }
  /* só a pokébola: sem fundo, sem barra, sem texto e parada (sem girar) */
  .carregando { --cor: #e3350d; background: transparent; gap: 0; }
  .carregando-barra, .carregando-texto, .cubo-sombra { display: none; }
  .cubo { animation: none; transform: rotateX(-22deg) rotateY(-35deg); }
  .cubo-cena { transform: scale(3.3); }
</style></head><body>
<div class="carregando">
  <div class="cubo-cena"><div class="cubo">
    <div class="miolo"><div class="face frente"></div><div class="face tras"></div><div class="face direita"></div><div class="face esquerda"></div><div class="face topo"></div><div class="face base"></div></div>
    <div class="face frente"><i class="botao"></i></div><div class="face tras"><i class="botao"></i></div>
    <div class="face direita"></div><div class="face esquerda"></div><div class="face topo"></div><div class="face base"></div>
  </div></div>
</div></body></html>`;

// .ico com PNGs dentro: cabeçalho (6 bytes) + 16 bytes por imagem + os PNGs
function montarIco(pngs) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);           // reservado
  cabecalho.writeUInt16LE(1, 2);           // 1 = ícone
  cabecalho.writeUInt16LE(pngs.length, 4); // quantas imagens
  const entradas = [];
  let deslocamento = 6 + 16 * pngs.length;
  for (const { tamanho, dados } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 0); // largura (0 = 256)
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 1); // altura
    e.writeUInt8(0, 2);                            // paleta (nenhuma)
    e.writeUInt8(0, 3);                            // reservado
    e.writeUInt16LE(1, 4);                         // planos
    e.writeUInt16LE(32, 6);                        // bits por pixel
    e.writeUInt32LE(dados.length, 8);              // tamanho do PNG
    e.writeUInt32LE(deslocamento, 12);             // onde o PNG começa
    deslocamento += dados.length;
    entradas.push(e);
  }
  return Buffer.concat([cabecalho, ...entradas, ...pngs.map((p) => p.dados)]);
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    // desenha em 512 e reduz para 256: as bordas ficam suaves (sem serrilhado)
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  let ultima = null;
  w.webContents.on('paint', (_e, _area, imagem) => { ultima = imagem; });
  const arquivo = path.join(app.getPath('temp'), 'icone-pokebola.html');
  fs.writeFileSync(arquivo, html);
  await w.loadFile(arquivo);
  await new Promise((r) => setTimeout(r, 1500)); // deixa pintar algumas vezes
  if (!ultima || ultima.isEmpty()) throw new Error('não pintou nada');

  const base = ultima.resize({ width: 256, height: 256, quality: 'best' });
  const pngs = TAMANHOS.map((tamanho) => ({
    tamanho,
    dados: (tamanho === 256 ? base : base.resize({ width: tamanho, height: tamanho, quality: 'best' })).toPNG(),
  }));
  fs.writeFileSync(path.join(RAIZ, 'assets', 'icone.ico'), montarIco(pngs));
  fs.writeFileSync(path.join(RAIZ, 'assets', 'icone.png'), pngs[0].dados);
  console.log('assets/icone.ico e assets/icone.png gerados:', TAMANHOS.join(', '), 'px');
  app.quit();
});
