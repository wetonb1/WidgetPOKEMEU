// preload.js — única ponte entre a tela e o processo principal (canais nomeados).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  loadConfig: () => ipcRenderer.invoke('config:carregar'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:salvar', cfg),
  getStats: () => ipcRenderer.invoke('stats'),
  mediaInfo: (comCapa) => ipcRenderer.invoke('media-info', comCapa === true),
  mediaCmd: (acao) => ipcRenderer.invoke('media-cmd', acao),
  getVolume: () => ipcRenderer.invoke('volume-get'),
  setVolume: (v) => ipcRenderer.invoke('volume-set', Number(v)),
  setMudo: (mudo) => ipcRenderer.invoke('volume-mudo', mudo === true),
  abrirApp: (indice) => ipcRenderer.invoke('apps:abrir', indice),
  iconeApp: (indice) => ipcRenderer.invoke('apps:icone', indice),
  fechar: () => ipcRenderer.send('janela:fechar'),
  janelaModo: (modo) => ipcRenderer.invoke('janela:modo', String(modo)),
  janelaFixar: (fixar) => ipcRenderer.invoke('janela:fixar', fixar === true),
  setAutostart: (ligar) => ipcRenderer.invoke('autostart', ligar === true),

  // Terminal: só estes canais; a tela nunca recebe o objeto do evento IPC
  termStart: (cols, rows) => ipcRenderer.invoke('term-start', cols, rows),
  termInput: (dados) => ipcRenderer.send('term-input', String(dados)),
  termResize: (cols, rows) => ipcRenderer.send('term-resize', cols, rows),
  onTermData: (cb) => {
    ipcRenderer.removeAllListeners('term-data');
    ipcRenderer.on('term-data', (_e, dados) => cb(dados));
  },
  onTermExit: (cb) => {
    ipcRenderer.removeAllListeners('term-exit');
    ipcRenderer.on('term-exit', (_e, codigo) => cb(codigo));
  },
});
