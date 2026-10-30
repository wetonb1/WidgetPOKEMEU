// tools/cenario.js — usado só pelo tools/medir.ps1.
// Abre o widget exatamente como o "npm start" (carrega o mesmo app/main.js), mas:
//  - ignora a trava de instância única (dá para medir com o seu widget aberto);
//  - usa outra pasta de cache do Electron (não mexe na sua);
//  - prepara o cenário pedido em WIDGET_CENARIO:
//      A = aba sys (a que abre por padrão), música pausada;
//      B = aba music com música tocando (o visualizador roda);
//      D = "tocou música e depois pausou": aba music, captura de áudio criada.
// Obs.: o widget precisa ter um Pokémon escolhido ("pokemonEscolhido": true),
// senão ele fica na tela de bloqueio.
// WIDGET_ESTILO=ios (ou cmd) mede com aquele visual: usa uma CÓPIA da sua config
// numa pasta temporária (a sua não muda).
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.requestSingleInstanceLock = () => true;
if (process.env.WIDGET_ESTILO) {
  const pasta = path.join(app.getPath('temp'), 'meu-widget-medicao-appdata');
  const original = path.join(app.getPath('appData'), 'meu-widget', 'config.json');
  const cfg = fs.existsSync(original) ? JSON.parse(fs.readFileSync(original, 'utf8')) : {};
  cfg.estilo = process.env.WIDGET_ESTILO;
  fs.mkdirSync(path.join(pasta, 'meu-widget'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'meu-widget', 'config.json'), JSON.stringify(cfg, null, 2));
  const getPathOriginal = app.getPath.bind(app);
  app.getPath = (nome) => (nome === 'appData' ? pasta : getPathOriginal(nome));
}
const setPathOriginal = app.setPath.bind(app);
app.setPath = (nome, valor) =>
  setPathOriginal(nome, nome === 'userData' ? path.join(app.getPath('temp'), 'meu-widget-medicao') : valor);

require('../app/main.js');

const PREPARO = {
  A: "abas.mostrar('sys', { salvar: false }); true",
  B: "abas.mostrar('music', { salvar: false }); true",
  D: "abas.mostrar('music', { salvar: false }); visualizador.tocando(true); true", // o ciclo da música pausa logo depois
};
const preparo = PREPARO[process.env.WIDGET_CENARIO];
if (preparo) {
  app.on('browser-window-created', (_e, janela) => {
    janela.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        janela.webContents.executeJavaScript(preparo)
          .catch((erro) => console.error('preparo do cenário:', erro.message));
      }, 3000); // espera a tela montar
    });
  });
}
