// preload.js — única ponte entre a tela e o processo principal (canais nomeados).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  plataforma: process.platform,
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
  // aba Cérebro (cada uma chama o cerebro.py uma vez, só quando você clica)
  cerebroPainel: (projeto) => ipcRenderer.invoke('cerebro:painel', projeto),
  cerebroBuscar: (texto, projeto) => ipcRenderer.invoke('cerebro:buscar', String(texto), projeto),
  cerebroLer: (arquivo) => ipcRenderer.invoke('cerebro:ler', String(arquivo)),
  cerebroSalvar: (campos) => ipcRenderer.invoke('cerebro:salvar', campos),
  cerebroValidar: () => ipcRenderer.invoke('cerebro:validar'),
  cerebroGrafo: () => ipcRenderer.invoke('cerebro:grafo'),
  // aba System, como o Gerenciador de Tarefas (a tela manda ids; o main resolve os PIDs e recusa o que é protegido)
  sysLista: () => ipcRenderer.invoke('sys:lista'),
  sysFecharApp: (id) => ipcRenderer.invoke('sys:fechar-app', String(id)),
  sysEncerrar: (id) => ipcRenderer.invoke('sys:encerrar', String(id)),
  sysFecharTodosPrever: () => ipcRenderer.invoke('sys:fechar-todos-prever'),
  sysFecharTodos: (ids) => ipcRenderer.invoke('sys:fechar-todos', Array.isArray(ids) ? ids.map(String) : []),
  // desligar o PC (2 confirmações + contagem cancelável)
  desligarEtapa: (n) => ipcRenderer.invoke('power:etapa', Number(n)),
  desligarExecutar: () => ipcRenderer.invoke('power:desligar'),
  desligarCancelar: () => ipcRenderer.invoke('power:cancelar'),
  cerebroIndice: () => ipcRenderer.invoke('cerebro:indice'),
  cerebroEscolherPasta: () => ipcRenderer.invoke('cerebro:escolher-pasta'),
  cerebroCopiar: (texto) => ipcRenderer.invoke('cerebro:copiar', String(texto)),
  cerebroCopiarPrompt: () => ipcRenderer.invoke('cerebro:copiar-prompt'),
  cerebroEditor: (arquivo) => ipcRenderer.invoke('cerebro:editor', String(arquivo)),
  // aba Projetos (cadastro no projetos.json, feito pelo projetos.py)
  projetosListar: () => ipcRenderer.invoke('projetos:listar'),
  projetosAdicionar: (dados) => ipcRenderer.invoke('projetos:adicionar', dados),
  projetosEditar: (id, dados) => ipcRenderer.invoke('projetos:editar', String(id), dados),
  projetosRemover: (id) => ipcRenderer.invoke('projetos:remover', String(id)),
  projetosPreparar: (id, confirmar) => ipcRenderer.invoke('projetos:preparar', String(id), confirmar === true),
  projetosPreencherEstado: (id, dados) => ipcRenderer.invoke('projetos:preencher-estado', String(id), dados),
  projetosEscolherPasta: (inicial) => ipcRenderer.invoke('projetos:escolher-pasta', inicial ? String(inicial) : ''),
  // abrir a IA de um projeto: modo novo | continuar | retomar; ou abrir um PowerShell na pasta do projeto
  projetosAbrirIA: (id, opcoes) => ipcRenderer.invoke('projetos:abrir-ia', String(id), opcoes),
  projetosAbrirPS: (id) => ipcRenderer.invoke('projetos:abrir-ps', String(id)),
  // limite de uso: pausar com segurança, retomar e a contagem local de sessões
  projetosPausaEstado: (id) => ipcRenderer.invoke('projetos:pausa-estado', String(id)),
  projetosPausaSalvar: (id, dados) => ipcRenderer.invoke('projetos:pausa-salvar', String(id), dados),
  projetosPausaRegistrar: (id, motivo, ia) => ipcRenderer.invoke('projetos:pausa-registrar', String(id), String(motivo || 'limite'), ia ? String(ia) : ''),
  // manutenção do cérebro (aba Cérebro): diagnóstico, sinônimos, consolidação (IA), estado (IA), índices e backup
  manutencaoDiagnostico: () => ipcRenderer.invoke('manutencao:diagnostico'),
  manutencaoSinonimosAprovar: (pares) => ipcRenderer.invoke('manutencao:sinonimos-aprovar', pares),
  manutencaoSinonimosRemover: (apelido) => ipcRenderer.invoke('manutencao:sinonimos-remover', String(apelido)),
  manutencaoEstimarConsolidacao: () => ipcRenderer.invoke('manutencao:estimar-consolidacao'),
  manutencaoConsolidar: (id, modelo) => ipcRenderer.invoke('manutencao:consolidar', String(id), String(modelo || 'haiku')),
  manutencaoEstimarEstado: (projeto) => ipcRenderer.invoke('manutencao:estimar-estado', String(projeto)),
  manutencaoProporEstado: (projeto, modelo) => ipcRenderer.invoke('manutencao:propor-estado', String(projeto), String(modelo || 'haiku')),
  manutencaoAplicarEstado: (projeto) => ipcRenderer.invoke('manutencao:aplicar-estado', String(projeto)),
  manutencaoDescartarProposta: () => ipcRenderer.invoke('manutencao:descartar-proposta'),
  manutencaoIndices: () => ipcRenderer.invoke('manutencao:indices'),
  manutencaoEscolherDestino: () => ipcRenderer.invoke('manutencao:escolher-destino'),
  manutencaoExportar: () => ipcRenderer.invoke('manutencao:exportar'),
  // subaba Economia (aba Cérebro)
  economiaPainel: () => ipcRenderer.invoke('economia:painel'),
  economiaABRegistrar: (dados) => ipcRenderer.invoke('economia:ab-registrar', dados),
  economiaABRemover: (id) => ipcRenderer.invoke('economia:ab-remover', String(id)),
  usoResumo: () => ipcRenderer.invoke('uso:resumo'),
  iasResumo: () => ipcRenderer.invoke('ias:resumo'),
  iasDocs: (id) => ipcRenderer.invoke('ias:docs', String(id)),
  // aba Skills (custos: tokens.py; instalar/remover/importar: skills.py)
  skillsPainel: (escopo, projeto, alvo) => ipcRenderer.invoke('skills:painel', String(escopo), projeto ? String(projeto) : '', alvo ? String(alvo) : ''),
  skillsInstalar: (nome, escopo, projeto, alvo) => ipcRenderer.invoke('skills:instalar', String(nome), String(escopo), projeto ? String(projeto) : '', alvo ? String(alvo) : ''),
  skillsRemover: (nome, escopo, projeto, alvo) => ipcRenderer.invoke('skills:remover', String(nome), String(escopo), projeto ? String(projeto) : '', alvo ? String(alvo) : ''),
  skillsLer: (nome, alvo) => ipcRenderer.invoke('skills:ler', String(nome), alvo ? String(alvo) : ''),
  skillsEscolherOrigem: (tipo) => ipcRenderer.invoke('skills:escolher-origem', String(tipo)),
  skillsCatalogoFontes: () => ipcRenderer.invoke('skills:catalogo-fontes'),
  skillsCatalogoListar: (repo, termo) => ipcRenderer.invoke('skills:catalogo-listar', String(repo), String(termo || '')),
  skillsCatalogoRepos: (termo) => ipcRenderer.invoke('skills:catalogo-repos', String(termo || '')),
  skillsCatalogoBaixar: (repo, caminho) => ipcRenderer.invoke('skills:catalogo-baixar', String(repo), String(caminho || '')),
  skillsImportar: (confirmar, categoria) => ipcRenderer.invoke('skills:importar', confirmar === true, categoria ? String(categoria) : ''),
  // sessões abertas pelo widget
  sessoesListar: () => ipcRenderer.invoke('sessoes:listar'),
  sessoesFocar: (id) => ipcRenderer.invoke('sessoes:focar', String(id)),
  sessoesEncerrar: (id) => ipcRenderer.invoke('sessoes:encerrar', String(id)),
  // terminal embutido (as sessões do Claude dentro do widget)
  termColar: () => ipcRenderer.invoke('term:colar'),
  termAnexar: (id) => ipcRenderer.invoke('term:anexar', String(id)),
  termEntrada: (id, texto) => ipcRenderer.send('term:entrada', String(id), String(texto)),
  termTamanho: (id, colunas, linhas) => ipcRenderer.send('term:tamanho', String(id), colunas | 0, linhas | 0),
  termComando: (id, comando) => ipcRenderer.invoke('term:comando', String(id), String(comando)),
  termExiste: (id) => ipcRenderer.invoke('term:existe', String(id)),
  termEncerrar: (id) => ipcRenderer.invoke('term:encerrar', String(id)),
  termDestacar: (estado) => ipcRenderer.invoke('term:destacar', estado),
  termAcoplar: (estado) => ipcRenderer.invoke('term:acoplar', estado),
  onTermDados: (fn) => ipcRenderer.on('term:dados', (_e, id, dados) => fn(id, dados)),
  onTermFim: (fn) => ipcRenderer.on('term:fim', (_e, id, codigo, erro) => fn(id, codigo, erro)),
  onTermAviso: (fn) => ipcRenderer.on('term:aviso', (_e, id, tipo, comando) => fn(id, tipo, comando)),
  onTermSincronizar: (fn) => { ipcRenderer.removeAllListeners('term:sincronizar'); ipcRenderer.on('term:sincronizar', (_e, d) => fn(d)); },
  onTermAcoplado: (fn) => { ipcRenderer.removeAllListeners('term:acoplado'); ipcRenderer.on('term:acoplado', (_e, d) => fn(d)); },
  // atalho global Ctrl+Alt+A (o main.js avisa a tela)
  onAtalhoProjetos: (cb) => {
    ipcRenderer.removeAllListeners('atalho:projetos');
    ipcRenderer.on('atalho:projetos', () => cb());
  },
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
