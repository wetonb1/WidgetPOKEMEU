// tools/cenario.js — usado só pelo tools/medir.ps1.
// Abre o widget exatamente como o "npm start" (carrega o mesmo app/main.js), mas:
//  - ignora a trava de instância única (dá para medir com o seu widget aberto);
//  - usa outra pasta de cache do Electron (não mexe na sua);
//  - prepara o cenário pedido em WIDGET_CENARIO:
//      A = aba sys (a que abre por padrão), música pausada;
//      B = aba music com música tocando (o visualizador roda);
//      C = aba term aberta (PowerShell real);
//      D = "tocou música e depois pausou": aba music, captura de áudio criada.
// Obs.: o widget precisa ter um Pokémon escolhido ("pokemonEscolhido": true),
// senão ele fica na tela de bloqueio.
const { app } = require('electron');
const path = require('path');

app.requestSingleInstanceLock = () => true;
const setPathOriginal = app.setPath.bind(app);
app.setPath = (nome, valor) =>
  setPathOriginal(nome, nome === 'userData' ? path.join(app.getPath('temp'), 'meu-widget-medicao') : valor);

require('../app/main.js');

const PREPARO = {
  A: "abas.mostrar('sys', { salvar: false }); true",
  B: "abas.mostrar('music', { salvar: false }); true",
  C: "abas.mostrar('term', { salvar: false }); true",
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
