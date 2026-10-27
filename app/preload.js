// preload.js — única ponte entre a tela e o processo principal (canais nomeados).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  catalogoApps: () => ipcRenderer.invoke('apps:catalogo'),
  iconeAppId: (id) => ipcRenderer.invoke('apps:icone-appid', String(id)),
  iconeArquivo: (caminho) => ipcRenderer.invoke('apps:icone-arquivo', String(caminho)),
  // caminho de um arquivo solto na janela (arrastar-e-soltar); '' se não for arquivo do disco
  caminhoArquivo: (arquivo) => { try { return webUtils.getPathForFile(arquivo) || ''; } catch { return ''; } },
  janelaEstilo: (estilo) => ipcRenderer.invoke('janela:estilo', String(estilo)),
  // estilo iOS: cor do que está atrás do widget ("#rrggbb"), quando muda
  onFundo: (cb) => {
    ipcRenderer.removeAllListeners('tela:fundo');
    ipcRenderer.on('tela:fundo', (_e, cor) => cb(String(cor)));
  },
  fechar: () => ipcRenderer.send('janela:fechar'),
  janelaModo: (modo) => ipcRenderer.invoke('janela:modo', String(modo)),
  janelaFixar: (fixar) => ipcRenderer.invoke('janela:fixar', fixar === true),
  setAutostart: (ligar) => ipcRenderer.invoke('autostart', ligar === true),
});
