// main.js — processo principal do Electron: cria a janela e cuida da config.
const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, shell, nativeImage, clipboard, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Se estiver rodando empacotado (.exe no Temp) e existir a pasta com o código do widget ao lado ou na config:
// delega para o app/main.js externo para que o widget rode do código atualizado e permita auto-update via GitHub.
if (app.isPackaged && !process.env._MEU_WIDGET_DELEGADO) {
  try {
    const { pastaRaizWidget } = require('./cerebro');
    const raiz = pastaRaizWidget();
    const mainExterno = path.join(raiz, 'app', 'main.js');
    if (fs.existsSync(mainExterno) && path.resolve(mainExterno) !== path.resolve(__filename)) {
      process.env._MEU_WIDGET_DELEGADO = '1';
      require(mainExterno);
      return;
    }
  } catch (err) {
    console.error('Falha ao delegar para main externo:', err.message);
  }
}

// Tamanho da janela (horizontal). Você redimensiona puxando as bordas, dentro
// de um mínimo e um máximo que não quebram o layout; o tamanho fica salvo.
// Ao trocar de modo, a borda direita e o topo não se mexem (preso ao canto).
//   normal   = Pokémon à esquerda + abas à direita (tamanho livre entre MIN e MAX)
//   mini     = só o Pokémon e a linha de status (tamanho fixo)
const TAMANHO_PADRAO = { largura: 900, altura: 400 };
const MIN = { largura: 720, altura: 320 };
const MAX = { largura: 1400, altura: 900 };
const MINI = { largura: 340, altura: 112 };
const MARGEM = 12; // distância da borda da tela

// A config do usuário fica em %APPDATA%\meu-widget\config.json
// (MEU_WIDGET_PASTA troca a pasta, só para testes: instância e config separadas das suas)
const PASTA_CONFIG = process.env.MEU_WIDGET_PASTA || path.join(app.getPath('appData'), 'meu-widget');
const ARQUIVO_CONFIG = path.join(PASTA_CONFIG, 'config.json');
const ARQUIVO_MODELO = path.join(__dirname, 'config.json');

// Caches do Electron vão para uma subpasta, deixando a pasta da config limpa
app.setPath('userData', path.join(PASTA_CONFIG, 'electron'));
let janela = null;
let janelaTerm = null; // janela destacada só com o terminal/PowerShell (mantém a borda do widget; pode ir para outro monitor)

// Toda mensagem IPC precisa vir da nossa janela principal ou da janela destacada do terminal
const daJanelaTerm = (e) => janelaTerm !== null && !janelaTerm.isDestroyed() && e.sender === janelaTerm.webContents;
const daJanela = (e) => (janela !== null && !janela.isDestroyed() && e.sender === janela.webContents) || daJanelaTerm(e);

// Só uma instância do widget por vez; abrir de novo só traz a janela para a frente
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (janela && !janela.isDestroyed()) {
    janela.show();
    janela.focus();
  }
});

// ---------- Validação da config ----------
// Tudo que é lido ou gravado passa por aqui: só chaves conhecidas, nos tipos
// certos e com tamanho limitado. Assim nem uma config editada à mão nem a tela
// conseguem gravar algo inesperado (ex.: um atalho com protocolo estranho).
const SLUG = /^[a-z0-9-]{1,30}$/;
const ABAS = new Set(['sys', 'music', 'apps', 'poke', 'cerebro', 'projetos', 'skills']);
const PROJETO_CEREBRO = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_CONFIG = 1024 * 1024; // bytes (cabe um ícone próprio em cada app)
const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v, padrao) => (typeof v === 'boolean' ? v : padrao);
const { sanitizarUso, migrarAvisoConta } = require('./conta');
const slug = (v) => typeof v === 'string' && SLUG.test(v);

function urlHttpValida(t) {
  try {
    const u = new URL(t);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

// Tira aspas ("Copiar como caminho") e espaços das pontas
function limparTexto(t) {
  return String(t || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

// AppID do Menu Iniciar / Microsoft Store (ex.: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify").
// Vai como UM argumento para o explorer.exe (sem shell), mas mesmo assim só
// aceita caracteres comuns.
const APP_ID = /^[A-Za-z0-9_.!{}\\ ()\-]{1,300}$/;

// ícone escolhido por você para um app: só PNG em base64, até ~24 KB (a tela reduz para 64 px)
const ICONE_PROPRIO = /^data:image\/png;base64,[A-Za-z0-9+/=]{20,32000}$/;

function sanitizarApp(a) {
  if (!a || typeof a !== 'object') return null;
  const name = texto(a.name, 30).trim();
  const target = limparTexto(texto(a.target, 1024));
  if (!name || !target) return null;
  let app = null;
  if (a.type === 'url') app = urlHttpValida(target) ? { name, type: 'url', target } : null;
  else if (a.type === 'exe') app = { name, type: 'exe', target };
  else if (a.type === 'app') app = APP_ID.test(target) ? { name, type: 'app', target } : null;
  if (app && typeof a.icone === 'string' && ICONE_PROPRIO.test(a.icone)) app.icone = a.icone;
  return app;
}

// ----- Franquias -----
const FONTES = new Set(['pokemon', 'anilist']);
const FONTES_ANIME = new Set(['anilist']);
// imagens de personagem só das CDNs das duas fontes (as mesmas liberadas na CSP)
const HOSTS_IMAGEM = new Set(['s4.anilist.co']);

function sanitizarBusca(b) {
  if (!b || typeof b !== 'object' || !FONTES.has(b.fonte)) return null;
  const termo = texto(b.termo, 60).trim();
  return termo ? { fonte: b.fonte, termo } : null;
}

// { fonte, id, nome, imagem }: id numérico das APIs, imagem só https das CDNs conhecidas
function sanitizarPersonagem(p) {
  if (!p || typeof p !== 'object' || !FONTES_ANIME.has(p.fonte)) return null;
  const id = Number.isInteger(p.id) && p.id > 0 ? p.id : null;
  const nome = texto(p.nome, 60).trim();
  let imagem = '';
  try {
    const u = new URL(texto(p.imagem, 500));
    if (u.protocol === 'https:' && HOSTS_IMAGEM.has(u.hostname)) imagem = u.href;
  } catch { /* sem imagem */ }
  const cor = typeof p.cor === 'string' && /^#[0-9a-f]{6}$/i.test(p.cor) ? p.cor : ''; // tirada da imagem
  return id && nome ? { fonte: p.fonte, id, nome, imagem, cor } : null;
}

// Tamanho da janela salvo: inteiros dentro do mínimo e do máximo
function tamanhoValidoJanela(t) {
  const n = (v, min, max, padrao) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : padrao);
  const o = t && typeof t === 'object' ? t : {};
  return {
    largura: n(o.largura, MIN.largura, MAX.largura, TAMANHO_PADRAO.largura),
    altura: n(o.altura, MIN.altura, MAX.altura, TAMANHO_PADRAO.altura),
  };
}

function sanitizarConfig(cfg, modelo) {
  const bv = cfg.boasVindas && typeof cfg.boasVindas === 'object' ? cfg.boasVindas : {};
  const mbv = modelo.boasVindas;
  return {
    pokemon: slug(cfg.pokemon) ? cfg.pokemon : modelo.pokemon,
    shiny: bool(cfg.shiny, modelo.shiny),
    gifAnimado: bool(cfg.gifAnimado, modelo.gifAnimado),
    aceleracaoGPU: bool(cfg.aceleracaoGPU, modelo.aceleracaoGPU),
    redeEmProcesso: bool(cfg.redeEmProcesso, false), // veja a nota perto do disableHardwareAcceleration
    desempenho: cfg.desempenho === 'economico' ? 'economico' : 'normal',
    economiaAutomatica: bool(cfg.economiaAutomatica, modelo.economiaAutomatica),
    visualizador: bool(cfg.visualizador, modelo.visualizador),
    animacoes: bool(cfg.animacoes, modelo.animacoes),
    favoritos: Array.isArray(cfg.favoritos) ? [...new Set(cfg.favoritos.filter(slug))].slice(0, 50) : [],
    iniciarComWindows: bool(cfg.iniciarComWindows, modelo.iniciarComWindows),
    avisarAtualizacao: bool(cfg.avisarAtualizacao, modelo.avisarAtualizacao !== false), // botão "update" quando sai versão nova no GitHub
    boasVindas: {
      ativo: bool(bv.ativo, mbv.ativo),
      voz: bool(bv.voz, mbv.voz),
      chamar: texto(bv.chamar, 40).trim() || mbv.chamar,
    },
    appsSemeados: bool(cfg.appsSemeados, false),
    setupInicialFeito: bool(cfg.setupInicialFeito, false),
    pastaInstalacao: typeof cfg.pastaInstalacao === 'string' ? cfg.pastaInstalacao : '',
    // false até a primeira escolha de Pokémon: até lá as funções ficam bloqueadas
    pokemonEscolhido: bool(cfg.pokemonEscolhido, false),
    fixado: bool(cfg.fixado, modelo.fixado), // sempre no topo
    aba: ABAS.has(cfg.aba) ? cfg.aba : 'sys', // última aba aberta
    // sessões de IA abertas ao mesmo tempo antes do aviso (paralelas somam no mesmo limite de uso da conta)
    max_sessoes: Number.isInteger(cfg.max_sessoes) && cfg.max_sessoes >= 1 && cfg.max_sessoes <= 10 ? cfg.max_sessoes : 3,
    atalho_projetos: bool(cfg.atalho_projetos, true), // Ctrl+Alt+A abre o seletor rápido de projeto
    skillsGuiaVisto: bool(cfg.skillsGuiaVisto, false), // o quadro "como as skills funcionam" da aba Skills já foi dispensado
    ultimoUso: sanitizarUso(cfg.ultimoUso), // última leitura do /usage de CADA IA (barras da tela "uso e continuidade"); o formato antigo migra para o Claude
    avisoTrocaContaVisto: migrarAvisoConta(cfg.avisoTrocaContaVisto), // aviso de "Trocar conta" já mostrado, por IA (o booleano antigo migra para o Claude)
    cerebroProjeto: typeof cfg.cerebroProjeto === 'string' && PROJETO_CEREBRO.test(cfg.cerebroProjeto) ? cfg.cerebroProjeto : '', // último projeto da aba Cérebro
    janela: tamanhoValidoJanela(cfg.janela), // tamanho escolhido por você
    estilo: cfg.estilo === 'ios' ? 'ios' : 'cmd', // visual: CMD ou iOS (vidro)
    // Franquias: de onde vem o "dono" do widget (Pokémon, ou anime via AniList)
    fonte: FONTES.has(cfg.fonte) ? cfg.fonte : 'pokemon',
    ultimaBusca: sanitizarBusca(cfg.ultimaBusca),
    personagem: sanitizarPersonagem(cfg.personagem), // último personagem de anime escolhido
    favoritosFranquias: Array.isArray(cfg.favoritosFranquias)
      ? cfg.favoritosFranquias.map(sanitizarPersonagem).filter(Boolean).slice(0, 50) : [],
    // cor da pokébola da tela de carregamento (a do último Pokémon; vermelha de início)
    corPokebola: typeof cfg.corPokebola === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.corPokebola) ? cfg.corPokebola : '#e3350d',
    apps: Array.isArray(cfg.apps) ? cfg.apps.map(sanitizarApp).filter(Boolean).slice(0, 64) : [],
  };
}

// Lê o modelo que acompanha o projeto (uma vez só: não muda em tempo de execução)
let modeloCache = null;
let cfgCache = null;
let cfgMtime = 0;
function lerModelo() {
  if (!modeloCache) modeloCache = JSON.parse(fs.readFileSync(ARQUIVO_MODELO, 'utf8'));
  return modeloCache;
}

// Copia o modelo para o %APPDATA%. Lê e grava em vez de copyFileSync porque,
// no .exe, o modelo fica dentro do app.asar (que só dá para ler).
function copiarModelo() {
  fs.writeFileSync(ARQUIVO_CONFIG, fs.readFileSync(ARQUIVO_MODELO, 'utf8'), 'utf8');
  cfgCache = null;
}

// Na primeira execução copia o modelo para o %APPDATA%
function garantirConfig() {
  if (!cfgCache) fs.mkdirSync(PASTA_CONFIG, { recursive: true });
  if (!fs.existsSync(ARQUIVO_CONFIG)) copiarModelo();
}

// Lê a config do usuário (com cache em memória para não reler o disco a cada 3 s);
// se o arquivo mudou no disco, relê; se estiver corrompida, guarda uma cópia e recomeça do modelo
function carregarConfig() {
  garantirConfig();
  try {
    const mtime = fs.statSync(ARQUIVO_CONFIG).mtimeMs;
    if (cfgCache && mtime === cfgMtime) return cfgCache;
    const usuario = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'));
    const modelo = lerModelo();
    // chaves que faltarem (inclusive dentro de boasVindas) vêm do modelo
    const cfg = sanitizarConfig({ ...modelo, ...usuario }, modelo);
    // Uma única vez: se a lista de apps está vazia, entram os atalhos iniciais.
    // Depois disso a lista é do usuário (apagar tudo não traz os padrões de volta).
    if (!usuario.appsSemeados) {
      if (!Array.isArray(usuario.apps) || usuario.apps.length === 0) cfg.apps = modelo.apps;
      cfg.appsSemeados = true;
      salvarConfig(cfg);
      return cfgCache;
    }
    cfgCache = cfg;
    cfgMtime = mtime;
    return cfg;
  } catch (erro) {
    console.error('Config inválida, restaurando o modelo:', erro.message);
    fs.renameSync(ARQUIVO_CONFIG, ARQUIVO_CONFIG + '.corrompido');
    copiarModelo();
    return lerModelo();
  }
}

// Grava a config (escreve num temporário e renomeia, para nunca ficar pela metade)
function salvarConfig(cfg) {
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    throw new Error('Config precisa ser um objeto');
  }
  const limpo = sanitizarConfig(cfg, lerModelo());
  const json = JSON.stringify(limpo, null, 2);
  if (json.length > MAX_CONFIG) throw new Error('Config grande demais');
  garantirConfig();
  const temporario = ARQUIVO_CONFIG + '.tmp';
  fs.writeFileSync(temporario, json, 'utf8');
  fs.renameSync(temporario, ARQUIVO_CONFIG);
  cfgCache = limpo;
  try { cfgMtime = fs.statSync(ARQUIVO_CONFIG).mtimeMs; } catch { cfgMtime = 0; }
  return true;
}

// Sem aceleração de hardware (padrão): medido no cenário B, CPU 15% -> 5% de
// 1 núcleo e -185 MB de memória privada (na época da janela transparente).
// O efeito varia por PC: "aceleracaoGPU": true religa.
// (A config é lida aqui, antes do app ficar pronto, porque depois não dá mais.)
const cfgInicial = carregarConfig();
if (!cfgInicial.aceleracaoGPU) app.disableHardwareAcceleration();
// Opcional (desligado por padrão): o serviço de rede do Chromium roda dentro do processo
// principal em vez de num processo próprio. Medido: -12 MB de RAM privada e um processo
// a menos. Em troca, a rede perde o isolamento (sandbox) do processo separado; por isso
// só liga se você pedir: "redeEmProcesso": true.
if (cfgInicial.redeEmProcesso) app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');

let modoAtual = 'normal';
let tamanhoAntesDoMini = null;
let salvarTamanhoTimer = null;
// Estilo iOS: o cartão é OPACO (nada do que está atrás aparece). A cor dele vem do que está
// AO REDOR do widget: a cada 1,5 s (3 s no modo econômico) o medidor lê faixas finas da tela
// logo fora de cada lado (esquerda, direita, cima, baixo) e devolve a cor média de cada uma
// ("-" quando o lado encosta na borda da tela). A tela monta com elas um degradê suave, como
// um vidro fosco. Só avisa quando alguma cor muda de verdade (limiar de ruído). Sem o medidor
// (PowerShell de reserva), fica a cor padrão.
const LIMIAR_COR = 5; // diferença mínima em algum canal (0-255) para repintar
const COR_OK = /^#[0-9a-f]{6}$/i;
const distanciaCor = (a, b) => Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))));
const mudouLados = (a, b) => a.some((c, i) => (c === '-') !== (b[i] === '-') || (c !== '-' && distanciaCor(c, b[i]) >= LIMIAR_COR));

function acompanharFundo(w) {
  let ultima = null;
  let ocupado = false;
  const passo = async () => {
    if (w.isDestroyed()) return;
    if (!ocupado && w.isVisible() && !w.isMinimized()) {
      ocupado = true;
      try {
        const hwnd = w.getNativeWindowHandle().readBigUInt64LE(0).toString();
        const lados = (await pedirServidorPS('fundo ' + hwnd)).trim().split(' ');
        if (lados.length === 4 && lados.every((c) => c === '-' || COR_OK.test(c)) && lados.some((c) => c !== '-')
          && (!ultima || mudouLados(lados, ultima)) && !w.isDestroyed()) {
          ultima = lados;
          w.webContents.send('tela:fundo', lados.join(' '));
        }
      } catch { /* sem leitura nesta volta */ } finally { ocupado = false; }
    }
    setTimeout(passo, ultimoEconomico ? 3000 : 1500);
  };
  w.webContents.once('did-finish-load', () => setTimeout(passo, 300));
}
let ultimoEconomico = false;

function criarJanela(posicao) {
  // canto superior direito da tela principal (respeita a barra de tarefas)
  const area = screen.getPrimaryDisplay().workArea;
  const cfg = carregarConfig();
  const ios = cfg.estilo === 'ios';
  const width = Math.min(cfg.janela.largura, area.width - 2 * MARGEM);
  const height = Math.min(cfg.janela.altura, area.height - 2 * MARGEM);

  janela = new BrowserWindow({
    // ao trocar de estilo, a janela nova nasce presa ao mesmo canto da antiga
    x: posicao ? Math.max(area.x, Math.min(posicao.direita, area.x + area.width) - width) : area.x + area.width - width - MARGEM,
    y: posicao ? Math.max(area.y, Math.min(posicao.topo, area.y + area.height - height)) : area.y + MARGEM,
    width,
    height,
    minWidth: MIN.largura,
    minHeight: MIN.altura,
    maxWidth: MAX.largura,
    maxHeight: MAX.altura,
    // CMD: opaca (mais leve de desenhar). iOS: janela transparente só para os cantos
    // redondos do CSS saírem lisos; o cartão em si é opaco. Sem frame: a barra é nossa.
    frame: false,
    transparent: ios,
    backgroundColor: ios ? '#00000000' : '#0c0c0c',
    icon: path.join(__dirname, '..', 'assets', 'icone.ico'), // a pokébola cúbica vermelha (tools/gerar-icone.js)
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    // fixado: sempre no topo e fora da barra de tarefas. Solto: vai para trás das
    // outras janelas, então aparece na barra de tarefas (senão não teria como achar)
    alwaysOnTop: cfg.fixado,
    skipTaskbar: cfg.fixado,
    // CMD: aparece na hora (o fundo já é o preto da tela de carregamento, sem piscar branco).
    // iOS e troca de estilo: só aparece já pintada (a antiga fica na tela até lá).
    show: !ios && !posicao,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged, // ferramentas de desenvolvedor só ao rodar com "npm start"
      // necessário: a captura de áudio do visualizador (AudioContext) começa sem clique
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  janela.setMenuBarVisibility(false);
  // caminho absoluto (funciona de qualquer pasta); o estilo vai na URL para a
  // tela já nascer com o visual certo, sem piscar o outro
  const query = { estilo: ios ? 'ios' : 'cmd' };
  if (posicao) query.rapido = '1'; // troca de estilo: sem a tela de carregamento
  janela.loadFile(path.join(__dirname, 'index.html'), { query });
  const esta = janela;
  janela.on('closed', () => {
    if (janela === esta) {
      janela = null;
      if (janelaTerm && !janelaTerm.isDestroyed()) janelaTerm.destroy();
    }
  });
  esta.vidroPronto = Promise.resolve();
  if (ios) {
    // a janela transparente só aparece depois de pintada (senão mostraria o desktop um instante)
    esta.vidroPronto = new Promise((ok) => esta.once('ready-to-show', ok));
    if (!posicao) {
      const mostrar = () => { if (!esta.isDestroyed() && !esta.isVisible()) esta.show(); };
      esta.vidroPronto.then(mostrar);
      setTimeout(mostrar, 6000); // garantia: nunca fica escondida
    }
    acompanharFundo(esta);
  }

  // Guarda o tamanho que você escolheu (só no modo normal; 1 s depois de soltar)
  janela.on('resized', () => {
    if (modoAtual !== 'normal') return;
    clearTimeout(salvarTamanhoTimer);
    salvarTamanhoTimer = setTimeout(() => {
      if (!janela || janela.isDestroyed()) return;
      const [largura, altura] = janela.getSize();
      try {
        const c = carregarConfig();
        c.janela = { largura, altura };
        salvarConfig(c);
      } catch (erro) {
        console.error('Falha ao salvar o tamanho da janela:', erro.message);
      }
    }, 1000);
  });

  // a tela nunca navega nem abre janelas novas
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
  return janela;
}

// ---------- Módulo Sistema ----------
// A lista de processos vem do mesmo PowerShell persistente da música (comando
// "processos"); o antigo si.processes() abria um PowerShell novo a cada chamada.
// Ela é atualizada a cada ~6 s, em segundo plano, e reaproveitada nas
// leituras de 3 s (que não esperam por ela).
const INTERVALO_PROCESSOS = 5500; // ms
const IGNORAR = new Set(['system idle process', 'idle', 'memory compression']); // pseudoprocessos do sistema

let processosCompletos = []; // TODOS os processos, agrupados por nome, com os PIDs (a aba System, como o Gerenciador de Tarefas)
let ultimaLeituraProcessos = 0;
let lendoProcessos = false;
let primeiraLeituraProcessos = true;

function agruparTodos(lista) {
  const grupos = new Map();
  for (const p of lista) {
    if (!p || typeof p.n !== 'string') continue;
    const chave = p.n.toLowerCase();
    if (IGNORAR.has(chave)) continue;
    let g = grupos.get(chave);
    if (!g) { g = { chave, nome: p.n, cpu: 0, ram: 0, pids: [], porPid: new Map() }; grupos.set(chave, g); }
    g.cpu += Number(p.c) || 0;
    g.ram += (Number(p.m) || 0) / 1024; // KB -> MB
    if (Number.isInteger(p.i) && p.i > 4) { g.pids.push(p.i); g.porPid.set(p.i, { cpu: Number(p.c) || 0, ram: (Number(p.m) || 0) / 1024 }); }
  }
  return [...grupos.values()];
}

async function atualizarProcessos() {
  if (lendoProcessos) return; // nunca duas leituras ao mesmo tempo
  lendoProcessos = true;
  ultimaLeituraProcessos = Date.now();
  try {
    // a CPU de cada processo é a diferença entre duas leituras: na primeira
    // vez lê duas vezes seguidas para a lista já nascer com valores reais
    if (primeiraLeituraProcessos) {
      primeiraLeituraProcessos = false;
      await pedirServidorPS('processos');
      await new Promise((r) => setTimeout(r, 1500));
    }
    const lista = JSON.parse(await pedirServidorPS('processos'));
    if (Array.isArray(lista)) { processosCompletos = agruparTodos(lista); }
  } catch (erro) {
    console.error('Falha ao ler processos:', erro.message);
  } finally {
    lendoProcessos = false;
  }
}

// ---------- Perfil de desempenho ----------
// "desempenho": "economico" deixa o widget mais leve o tempo todo. Com
// "economiaAutomatica": true, ele entra sozinho no modo econômico quando a CPU
// do PC passa de 90% (2 das últimas 5 leituras) ou quando um app está em tela
// cheia (jogo, vídeo), e volta ao normal quando isso passa.
const CPU_ECONOMIA = 90; // %
const historicoCpu = [];
let telaCheia = false;
let lendoTelaCheia = false;

async function atualizarTelaCheia() {
  if (lendoTelaCheia) return;
  lendoTelaCheia = true;
  try {
    telaCheia = (await pedirServidorPS('telacheia')) === 'true';
  } finally {
    lendoTelaCheia = false;
  }
}

function modoEconomico(cfg, cpu) {
  historicoCpu.push(cpu);
  if (historicoCpu.length > 5) historicoCpu.shift();
  if (cfg.desempenho === 'economico') return true;
  if (!cfg.economiaAutomatica) return false;
  return telaCheia || historicoCpu.filter((c) => c > CPU_ECONOMIA).length >= 2;
}

// CPU e RAM via os (leitura direta, sem abrir PowerShell e sem biblioteca extra).
// CPU: os.cpus() dá o tempo acumulado de cada núcleo; a carga é a fração que NÃO foi
// ociosa desde a leitura anterior (a mesma conta do Gerenciador de Tarefas).
// os.freemem() no Windows é a memória "disponível".
let cpuAnterior = somaCpu();
function somaCpu() {
  let ocioso = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    ocioso += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { ocioso, total };
}
function cargaCpu() {
  const agora = somaCpu();
  const dTotal = agora.total - cpuAnterior.total;
  const dOcioso = agora.ocioso - cpuAnterior.ocioso;
  cpuAnterior = agora;
  return dTotal > 0 ? Math.min(100, Math.max(0, (1 - dOcioso / dTotal) * 100)) : 0;
}

// RAM do próprio widget: todos os processos do Electron (memória privada) + o medidor.
// O medidor (ou o PowerShell de reserva) responde "mem" a cada ~15 s.
let memServidor = 0;
let memServidorHora = 0;
function ramDoWidget() {
  if (Date.now() - memServidorHora > 15000) {
    memServidorHora = Date.now();
    pedirServidorPS('mem').then((r) => { const n = Number(r); if (Number.isFinite(n) && n > 0) memServidor = n; });
  }
  let kb = 0;
  for (const m of app.getAppMetrics()) kb += (m.memory && (m.memory.privateBytes || m.memory.workingSetSize)) || 0;
  return kb * 1024 + memServidor;
}

let ultimaChecagemTelaCheia = 0;
async function lerStats() {
  const cfg = carregarConfig();
  const carga = { currentLoad: cargaCpu() };
  const economico = modoEconomico(cfg, carga.currentLoad);
  ultimoEconomico = economico;
  // fora da aba sys, só confere tela cheia (1 linha, < 1 ms) para a economia automática; a lista de processos só roda quando a aba sys pede
  if (cfg.economiaAutomatica && Date.now() - ultimaChecagemTelaCheia >= INTERVALO_PROCESSOS * (economico ? 3 : 1)) {
    ultimaChecagemTelaCheia = Date.now();
    atualizarTelaCheia();
  }
  const total = os.totalmem();
  return {
    ok: true,
    cpu: carga.currentLoad,
    ramTotal: total,
    ramUsada: total - os.freemem(), // usada = total - disponível
    ramWidget: ramDoWidget(),
    economico,
  };
}

// ---------- Módulo Música ----------
// Um único PowerShell fica aberto rodando "media.ps1 -Action servidor": ele
// carrega o WinRT uma vez e responde um JSON por linha. Abrir um PowerShell a
// cada consulta custava ~2 s de CPU por consulta (medido em tools/medir.ps1).
const { spawn } = require('child_process');
// No .exe o media.ps1 fica fora do app.asar (asarUnpack), porque o PowerShell
// não enxerga arquivos dentro do .asar.
const SCRIPT_MIDIA = path.join(__dirname, 'media.ps1').replace('app.asar', 'app.asar.unpacked');
const ACOES_MIDIA = new Set(['playpause', 'next', 'prev']);

// ----- auxiliar compilado (no lugar do PowerShell) -----
// O PowerShell sozinho gasta ~55 MB de RAM só por existir. O app/helper.cs faz o mesmo
// trabalho do media.ps1 (mesmo protocolo de linhas) num programinha de ~20 KB que usa
// ~25 MB. Ele é compilado uma vez, com o csc.exe que já vem no Windows, e guardado em
// %APPDATA%\meu-widget\medidor-<hash>.exe (o hash muda se o código mudar). Se o csc não
// existir, a compilação falhar ou o programa não responder, tudo segue pelo media.ps1.
const FONTE_AUXILIAR = path.join(__dirname, 'helper.cs').replace('app.asar', 'app.asar.unpacked');
const CSC = path.join(process.env.windir || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
let auxiliarExe = null;     // caminho do medidor compilado (null = usar o PowerShell)
let usandoAuxiliar = false; // o servidor atual é o medidor?

function prepararAuxiliar() {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(CSC)) return resolve();
      const codigo = fs.readFileSync(FONTE_AUXILIAR);
      const opcoes = ['-nologo', '-target:winexe', '-platform:x64', '-optimize+', '-r:System.Drawing.dll', '-r:System.Runtime.WindowsRuntime.dll']; // winexe: sem janela de console (e sem o conhost.exe dela)
      const hash = require('crypto').createHash('sha1').update(codigo).update(opcoes.join(' ')).digest('hex').slice(0, 10);
      const exe = path.join(PASTA_CONFIG, `medidor-${hash}.exe`);
      if (fs.existsSync(exe)) { auxiliarExe = exe; limparAntigos(exe); return resolve(); }
      // primeira vez (ou código novo): compila num nome temporário e só então renomeia
      fs.mkdirSync(PASTA_CONFIG, { recursive: true });
      const temp = exe + '.tmp';
      require('child_process').execFile(CSC, [...opcoes, '-out:' + temp, FONTE_AUXILIAR], { windowsHide: true, timeout: 60000 }, (erro, saida) => {
        try {
          if (erro) throw new Error((saida || erro.message).toString().slice(0, 300));
          fs.renameSync(temp, exe);
          auxiliarExe = exe;
          limparAntigos(exe);
        } catch (e) {
          console.error('Não deu para compilar o medidor; segue pelo PowerShell:', e.message);
          try { fs.rmSync(temp, { force: true }); } catch { /* nada a limpar */ }
        }
        resolve();
      });
    } catch (e) {
      console.error('Medidor indisponível; segue pelo PowerShell:', e.message);
      resolve();
    }
  });
}
// versões antigas do medidor (de quando o código era outro)
function limparAntigos(atual) {
  try {
    for (const f of fs.readdirSync(PASTA_CONFIG)) {
      if (/^medidor-[0-9a-f]+\.exe(\.tmp)?$/.test(f) && path.join(PASTA_CONFIG, f) !== atual) fs.rmSync(path.join(PASTA_CONFIG, f), { force: true });
    }
  } catch { /* em uso ou sem permissão: fica para a próxima */ }
}
// a compilação roda já na abertura, em paralelo; o primeiro pedido espera por ela
const auxiliarPronto = prepararAuxiliar();

// Só repassa à tela os campos esperados; a capa só como imagem base64
const CAPA_VALIDA = /^data:image\/(png|jpeg|gif|bmp|webp);base64,[A-Za-z0-9+/=]+$/;
function filtrarMidia(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const r = {};
  for (const k of ['title', 'artist', 'album', 'status']) {
    if (typeof obj[k] === 'string') r[k] = obj[k].slice(0, 300);
  }
  if (typeof obj.thumb === 'string' && CAPA_VALIDA.test(obj.thumb)) r.thumb = obj.thumb;
  return r;
}

// ----- servidor PowerShell persistente -----
const LIMITE_RESPOSTA = 20 * 1024 * 1024; // uma capa grande cabe com folga
const TEMPO_LIMITE = 10000;               // ms; se travar, o processo é recriado
let servidorPS = null;
let pendentes = [];   // pedidos em ordem: o servidor responde na mesma ordem
let bufferSaida = '';

// O medidor deu problema (não abre, morreu sem responder...): apaga o arquivo (a próxima
// abertura compila de novo) e passa a usar o PowerShell
function descartarAuxiliar(motivo) {
  if (!auxiliarExe) return;
  console.error('Medidor descartado (' + motivo + '); voltando ao PowerShell.');
  try { fs.rmSync(auxiliarExe, { force: true }); } catch { /* em uso: fica para a próxima */ }
  auxiliarExe = null;
}

function iniciarServidorPS() {
  const opcoes = { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] };
  servidorPS = null;
  usandoAuxiliar = false;
  if (auxiliarExe) {
    try {
      servidorPS = spawn(auxiliarExe, [], opcoes);
      usandoAuxiliar = true;
    } catch (erro) {
      descartarAuxiliar(erro.message); // arquivo inválido: o spawn já falha na hora
    }
  }
  if (!servidorPS) {
    servidorPS = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_MIDIA, '-Action', 'servidor'], opcoes);
  }
  const meu = servidorPS;
  const eraAuxiliar = usandoAuxiliar;
  let respondeu = false;
  const encerrado = (motivo) => {
    if (eraAuxiliar && !respondeu) descartarAuxiliar(motivo);
    if (servidorPS === meu) servidorPS = null;
    bufferSaida = '';
    for (const p of pendentes.splice(0)) { clearTimeout(p.timer); p.resolve(''); }
  };
  meu.stdout.setEncoding('utf8');
  meu.stdout.on('data', (pedaco) => {
    bufferSaida += pedaco;
    if (bufferSaida.length > LIMITE_RESPOSTA) { meu.kill(); return; }
    let fim;
    while ((fim = bufferSaida.indexOf('\n')) >= 0) {
      const linha = bufferSaida.slice(0, fim);
      bufferSaida = bufferSaida.slice(fim + 1);
      const p = pendentes.shift();
      if (p) { clearTimeout(p.timer); p.resolve(linha); }
      respondeu = true;
    }
  });
  meu.stdin.on('error', () => { /* processo morreu; o 'exit' cuida */ });
  meu.on('error', (erro) => encerrado('erro ao abrir: ' + erro.message));
  meu.on('exit', () => encerrado('encerrou sem responder'));
}

// Manda um comando e devolve a linha de resposta ('' se falhar)
async function pedirServidorPS(comando) {
  if (!servidorPS) {
    await auxiliarPronto; // só espera na primeira vez (compilação do medidor)
    if (!servidorPS) iniciarServidorPS();
  }
  return new Promise((resolve) => {
    if (!servidorPS) iniciarServidorPS();
    const meu = servidorPS;
    const timer = setTimeout(() => meu.kill(), TEMPO_LIMITE); // travou: recria no próximo pedido
    pendentes.push({ resolve, timer });
    meu.stdin.write(comando + '\n');
  });
}

function encerrarServidorPS() {
  if (servidorPS) servidorPS.kill();
}

// Pede ao servidor e devolve o JSON filtrado; qualquer erro vira {} em silêncio
async function rodarMidia(comando) {
  try {
    return filtrarMidia(JSON.parse(await pedirServidorPS(comando)));
  } catch {
    return {};
  }
}

// ---------- Módulo Apps ----------
// A tela só manda o NÚMERO do atalho; quem decide o que abrir é o main,
// lendo a config gravada e validando de novo.
const iconesCache = new Map(); // caminho -> dataURL

// O atalho vem da config gravada (já sanitizada); o índice precisa ser inteiro
function lerApp(indice) {
  if (!Number.isInteger(indice) || indice < 0) return null;
  return carregarConfig().apps[indice] || null;
}

// Ícone de um .exe/.lnk (em cache): vira dataURL para a tela
async function iconeDe(caminho) {
  if (iconesCache.has(caminho)) return iconesCache.get(caminho);
  if (/\.url$/i.test(caminho)) {
    // Atalho de internet (.url, como os de jogos do Steam): o Windows mostra um ícone genérico,
    // mas o arquivo diz qual é o ícone de verdade em "IconFile=" (um .ico ou um programa)
    let alvo = null;
    try {
      const m = /^IconFile=(.+)$/mi.exec(fs.readFileSync(caminho, 'latin1'));
      if (m && path.isAbsolute(m[1].trim()) && fs.existsSync(m[1].trim())) alvo = m[1].trim();
    } catch { /* ilegível: ícone genérico */ }
    if (alvo && /\.ico$/i.test(alvo)) {
      const img = nativeImage.createFromPath(alvo);
      if (!img.isEmpty()) { const url = img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL(); iconesCache.set(caminho, url); return url; }
    } else if (alvo && /\.(exe|dll)$/i.test(alvo)) {
      const url = await iconeDe(alvo);
      if (url) { iconesCache.set(caminho, url); return url; }
    }
  }
  if (/\.lnk$/i.test(caminho)) {
    // Atalho com ícone próprio quebrado (arquivo .ico que sumiu): vale o ícone do programa de destino
    let info = null;
    try { info = shell.readShortcutLink(caminho); } catch { /* atalho ilegível: segue o caminho normal */ }
    if (info && info.icon && !/%/.test(info.icon) && !fs.existsSync(info.icon) && info.target && fs.existsSync(info.target) && !/\.lnk$/i.test(info.target)) {
      const url = await iconeDe(info.target);
      iconesCache.set(caminho, url);
      return url;
    }
    if (!/["<>|*?\r\n]/.test(caminho) && caminho.length <= 300) {
      const url = pngParaUrl(await pedirServidorPS('iconearq ' + caminho));
      if (url) { iconesCache.set(caminho, url); return url; }
    }
  }
  try {
    const img = await app.getFileIcon(caminho, { size: 'large' });
    const url = img.isEmpty() ? null : img.toDataURL();
    iconesCache.set(caminho, url);
    return url;
  } catch {
    return null; // a tela mostra a inicial do nome
  }
}

// Ícone de um app do Menu Iniciar / Microsoft Store pelo AppID (em cache). Quem
// desenha é o PowerShell persistente (comando "iconeapp"): o Windows entrega a
// mesma imagem que o Explorer mostra, inclusive para apps sem .exe acessível.
async function iconeDeAppId(id) {
  if (typeof id !== 'string' || !APP_ID.test(id)) return null;
  const chave = 'app:' + id;
  if (iconesCache.has(chave)) return iconesCache.get(chave);
  const url = pngParaUrl(await pedirServidorPS('iconeapp ' + id));
  if (url) iconesCache.set(chave, url); // falha não fica no cache: tenta de novo depois
  return url;
}
const pngParaUrl = (png) => (/^[A-Za-z0-9+/=]{20,}$/.test(png.trim()) ? 'data:image/png;base64,' + png.trim() : null);

// shell.openPath e getFileIcon exigem caminho completo. Um nome solto como
// "notepad.exe" é procurado no System32, no Windows e nas pastas do PATH.
function caminhoCompleto(alvo) {
  if (path.isAbsolute(alvo) || /[\\/]/.test(alvo)) return alvo;
  const raiz = process.env.SystemRoot || 'C:\\Windows';
  const pastas = [path.join(raiz, 'System32'), raiz, ...(process.env.PATH || '').split(';')];
  const sufixos = path.extname(alvo) ? [''] : ['.exe', '.com', '.bat', '.cmd', '.lnk'];
  for (const pasta of pastas) {
    if (!pasta) continue;
    for (const sufixo of sufixos) {
      const candidato = path.join(pasta, alvo + sufixo);
      if (fs.existsSync(candidato)) return candidato;
    }
  }
  return alvo; // não achou: o openPath devolve o erro
}

// Abre só sites http(s) ou caminhos que existem (.exe, .lnk, pasta, arquivo)
ipcMain.handle('apps:abrir', async (e, indice) => {
  if (!daJanela(e)) return 'origem inválida';
  const a = lerApp(indice);
  if (!a) return 'atalho inválido';
  if (a.type === 'url') {
    if (!urlHttpValida(a.target)) return 'só http:// ou https://';
    try {
      await shell.openExternal(a.target);
      return '';
    } catch (erro) {
      return erro.message;
    }
  }
  if (a.type === 'app') {
    // apps da Store / Menu Iniciar: o próprio Windows abre pelo AppID
    if (!APP_ID.test(a.target)) return 'app inválido';
    if (await pedirServidorPS('focar-app ' + a.target) === 'true') return 'focado'; // já estava aberto
    spawn('explorer.exe', ['shell:AppsFolder\\' + a.target], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }
  const caminho = caminhoCompleto(a.target);
  if (!fs.existsSync(caminho)) return 'caminho não existe: ' + caminho;
  const exe = exeDoAtalho(caminho);
  if (exe && await pedirServidorPS('focar-exe ' + exe) === 'true') return 'focado'; // já estava aberto
  return shell.openPath(caminho); // texto vazio = deu certo
});

// O .exe por trás de um app: ele mesmo, ou o destino do atalho .lnk (null se não for programa)
const EXE_VALIDO = /^[A-Za-z]:\\[^"<>|*?\r\n]{1,300}\.exe$/i;
function exeDoAtalho(caminho) {
  let exe = caminho;
  if (/\.lnk$/i.test(caminho)) {
    try { exe = shell.readShortcutLink(caminho).target || ''; } catch { return null; }
  }
  return EXE_VALIDO.test(exe) ? exe : null;
}

ipcMain.handle('apps:icone', async (e, indice) => {
  if (!daJanela(e)) return null;
  const a = lerApp(indice);
  if (!a) return null;
  if (a.type === 'app') return iconeDeAppId(a.target);
  if (a.type !== 'exe') return null;
  const caminho = caminhoCompleto(a.target);
  if (!fs.existsSync(caminho)) return null;
  return iconeDe(caminho);
});

// Ícone de um app do catálogo (ainda não adicionado) pelo AppID
ipcMain.handle('apps:icone-appid', (e, id) => (daJanela(e) ? iconeDeAppId(id) : null));

// Ícone de um programa/atalho pelo caminho (catálogo e arrastar-e-soltar)
ipcMain.handle('apps:icone-arquivo', async (e, caminho) => {
  if (!daJanela(e) || typeof caminho !== 'string' || caminho.length > 400) return null;
  if (!path.isAbsolute(caminho) || !/\.(exe|lnk|url|bat|cmd|msc)$/i.test(caminho) || !fs.existsSync(caminho)) return null;
  return iconeDe(caminho);
});

// ---------- Catálogo: tudo o que dá para adicionar com 1 clique ----------
// "instalados" = apps do Menu Iniciar (inclusive da Store), via Get-StartApps.
// Quando existe um atalho .lnk (ou o AppID aponta para um .exe conhecido),
// o item vira "exe" (tem ícone de verdade); senão, "app" (abre pelo AppID).
// "abertos" = programas com janela aberta agora.
const PASTAS_MENU = [
  path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
];
// pastas "conhecidas" que aparecem no começo de alguns AppIDs
const PASTAS_CONHECIDAS = {
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.SystemRoot || 'C:\\Windows',
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files',
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
};
// documentação e pastas que o Menu Iniciar às vezes lista: não são apps
const NAO_E_APP = /\.(pdf|txt|chm|html?|rtf|url|md|log)$|\\[^\\.]*$/i;
// entradas do Menu Iniciar que não são apps de verdade
const RUIDO_MENU = /desinstal|uninstall|ajuda|help|manual|readme|leia-me|documenta|licen[cç]a|license|website|release notes|notas de vers/i;
const NAO_LISTAR_ABERTOS = /\\(textinputhost|applicationframehost|explorer|systemsettings|shellexperiencehost|searchapp|lockapp|meu widget|electron)\.exe$/i;

let instaladosCache = null;
let instaladosHora = 0;

function atalhosDoMenu() {
  const mapa = new Map(); // nome em minúsculas -> caminho do .lnk
  const visitar = (pasta, profundidade) => {
    let itens = [];
    try { itens = fs.readdirSync(pasta, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(pasta, it.name);
      if (it.isDirectory() && profundidade < 4) visitar(p, profundidade + 1);
      else if (/\.lnk$/i.test(it.name)) {
        const nome = it.name.slice(0, -4).toLowerCase();
        if (!mapa.has(nome)) mapa.set(nome, p);
      }
    }
  };
  PASTAS_MENU.forEach((p) => visitar(p, 0));
  return mapa;
}

// AppID no formato "{pasta conhecida}\caminho": devolve o arquivo real (se existir)
function arquivoDoAppId(id) {
  const m = /^(\{[0-9A-F-]{36}\})\\(.+)$/i.exec(id);
  if (!m) return null;
  const base = PASTAS_CONHECIDAS[m[1].toUpperCase()];
  if (!base) return null;
  const p = path.join(base, m[2]);
  return fs.existsSync(p) ? p : null;
}

// Atalho (.lnk) cujo destino não existe mais (programa desinstalado). Sem destino
// (apps da Store, atalhos especiais) ou com variável de ambiente: assume que vale.
function atalhoMorto(caminho) {
  if (!/\.lnk$/i.test(caminho)) return false;
  try {
    const alvo = shell.readShortcutLink(caminho).target;
    return !!alvo && !/%/.test(alvo) && /^[A-Za-z]:\\/.test(alvo) && !fs.existsSync(alvo);
  } catch {
    return false;
  }
}

// Apps do Menu Iniciar: [{"n":nome,"id":AppID}]. Com o servidor PowerShell, é um comando dele; com
// o medidor, um PowerShell avulso (só quando a loja de apps abre, e o resultado fica 5 min em cache).
const SCRIPT_STARTAPPS = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
  + "$i = @(Get-StartApps | Where-Object { $_.Name -and $_.AppID } | ForEach-Object { [ordered]@{ n = [string]$_.Name; id = [string]$_.AppID } }); "
  + "if ($i.Count -eq 0) { '[]' } else { ConvertTo-Json $i -Compress }";
async function lerStartApps() {
  await auxiliarPronto;
  if (!auxiliarExe) return pedirServidorPS('startapps'); // sem medidor: o servidor PowerShell responde
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT_STARTAPPS],
      { windowsHide: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (erro, saida) => resolve(erro ? '[]' : String(saida).trim()));
  });
}

async function listarInstalados() {
  if (instaladosCache && Date.now() - instaladosHora < 5 * 60000) return instaladosCache;
  let lista = [];
  try { lista = JSON.parse(await lerStartApps()); } catch { lista = []; }
  const atalhos = atalhosDoMenu();
  const vistos = new Set();
  const itens = [];
  for (const a of Array.isArray(lista) ? lista : []) {
    if (!a || typeof a.n !== 'string' || typeof a.id !== 'string' || RUIDO_MENU.test(a.n)) continue;
    const chave = a.n.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const arquivo = arquivoDoAppId(a.id);
    // PDF, pasta e afins: não são apps
    if (!atalhos.has(chave) && /^\{/.test(a.id) && (NAO_E_APP.test(a.id) || (arquivo && fs.statSync(arquivo).isDirectory()))) continue;
    const exe = atalhos.get(chave) || arquivo;
    if (exe && atalhoMorto(exe)) continue; // o programa foi desinstalado: sobrou só o atalho
    if (exe) itens.push({ nome: a.n, type: 'exe', target: exe });
    else if (APP_ID.test(a.id)) itens.push({ nome: a.n, type: 'app', target: a.id });
  }
  itens.sort((x, y) => x.nome.localeCompare(y.nome, 'pt'));
  instaladosCache = itens.slice(0, 500);
  instaladosHora = Date.now();
  return instaladosCache;
}

async function listarAbertos() {
  let lista = [];
  try { lista = JSON.parse(await pedirServidorPS('janelas')); } catch { lista = []; }
  return (Array.isArray(lista) ? lista : [])
    .filter((a) => a && typeof a.n === 'string' && typeof a.p === 'string' && !NAO_LISTAR_ABERTOS.test(a.p))
    .map((a) => ({ nome: a.n.slice(0, 30), type: 'exe', target: a.p }));
}

ipcMain.handle('apps:catalogo', async (e) => {
  if (!daJanela(e)) return null;
  const [instalados, abertos] = await Promise.all([listarInstalados(), listarAbertos()]);
  return { instalados, abertos };
});

// Canais IPC (a tela só chega aqui pelo preload.js)
ipcMain.handle('media-info', (e, comCapa) => {
  if (!daJanela(e)) return {};
  return rodarMidia(comCapa === true ? 'info-capa' : 'info');
});

// Comandos de mídia: só os da lista e um por vez (cliques repetidos não abrem vários PowerShell)
let comandoMidiaRodando = false;
ipcMain.handle('media-cmd', async (e, acao) => {
  if (!daJanela(e) || !ACOES_MIDIA.has(acao) || comandoMidiaRodando) return {};
  comandoMidiaRodando = true;
  try {
    return await rodarMidia(acao);
  } finally {
    comandoMidiaRodando = false;
  }
});

// Volume geral do Windows (pelo PowerShell persistente). A tela manda só um
// inteiro de 0 a 100 (ou um booleano de mudo); qualquer outra coisa é recusada.
// Devolve { v: 0-100, m: mudo } ou null se não houver dispositivo de áudio.
async function rodarVolume(comando) {
  try {
    const o = JSON.parse(await pedirServidorPS(comando));
    if (!Number.isInteger(o.v) || o.v < 0 || o.v > 100) return null;
    return { v: o.v, m: o.m === true };
  } catch {
    return null;
  }
}
ipcMain.handle('volume-get', (e) => (daJanela(e) ? rodarVolume('volume') : null));
ipcMain.handle('volume-set', (e, v) =>
  daJanela(e) && Number.isInteger(v) && v >= 0 && v <= 100 ? rodarVolume('volume-set ' + v) : null);
ipcMain.handle('volume-mudo', (e, mudo) =>
  daJanela(e) && typeof mudo === 'boolean' ? rodarVolume('mudo-set ' + (mudo ? 1 : 0)) : null);

ipcMain.handle('config:carregar', (e) => {
  if (!daJanela(e)) throw new Error('origem inválida');
  return carregarConfig();
});
ipcMain.handle('config:salvar', (e, cfg) => {
  if (!daJanela(e)) throw new Error('origem inválida');
  return salvarConfig(cfg);
});
ipcMain.handle('stats', async (e) => {
  if (!daJanela(e)) return { ok: false };
  try {
    return await lerStats();
  } catch (erro) {
    console.error('Falha ao ler stats:', erro.message);
    return { ok: false }; // a tela mantém o último valor e tenta de novo
  }
});
// ---------- Módulo Cérebro ----------
// A busca e a gravação são do cerebro/tools/cerebro.py (app/cerebro.js só chama e lê o JSON).
// Cada pedido da tela abre um Python curto e ele some ao terminar: nada fica rodando.
const cerebro = require('./cerebro');
const RECUSADO = { ok: false, tipo: 'erro', erro: 'origem inválida' };

ipcMain.handle('cerebro:painel', (e, projeto) => (daJanela(e) ? cerebro.painel(projeto) : RECUSADO));
ipcMain.handle('cerebro:buscar', (e, texto, projeto) => (daJanela(e) ? cerebro.buscar(texto, projeto) : RECUSADO));
ipcMain.handle('cerebro:ler', (e, arquivo) => (daJanela(e) ? cerebro.ler(arquivo) : RECUSADO));
ipcMain.handle('cerebro:grafo', (e) => (daJanela(e) ? cerebro.grafo() : RECUSADO));
ipcMain.handle('cerebro:salvar', (e, campos) => (daJanela(e) && campos && typeof campos === 'object' ? cerebro.salvar(campos) : RECUSADO));
ipcMain.handle('cerebro:validar', (e) => (daJanela(e) ? cerebro.validar() : RECUSADO));
ipcMain.handle('cerebro:indice', (e) => (daJanela(e) ? cerebro.indice() : RECUSADO));

// Cérebro não encontrado: você escolhe a pasta e ela é gravada em ~/.cerebro.json (config --definir)
ipcMain.handle('cerebro:escolher-pasta', async (e) => {
  if (!daJanela(e)) return RECUSADO;
  const r = await dialog.showOpenDialog(janela, { title: 'Escolha a pasta do cérebro', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, tipo: 'cancelado', erro: '' };
  return cerebro.definirPasta(r.filePaths[0]);
});

// colar no terminal embutido: devolve o TEXTO da área de transferência ('' se for imagem ou estiver vazia: aí o Ctrl+V vai para o Claude, que lê a imagem)
ipcMain.handle('term:colar', async (e) => (daJanela(e) ? String((await clipboard.readText()) || '').slice(0, 200000) : ''));
ipcMain.handle('cerebro:copiar', (e, texto) => {
  if (!daJanela(e) || typeof texto !== 'string' || texto.length > 300000) return false;
  clipboard.writeText(texto);
  return true;
});
ipcMain.handle('cerebro:copiar-prompt', (e) => {
  const prompt = daJanela(e) ? cerebro.promptCompactacao() : null;
  if (!prompt) return false;
  clipboard.writeText(prompt);
  return true;
});

// "Abrir no editor" = code <arquivo>. Se o VS Code não responder, abre no programa padrão dos .md.
ipcMain.handle('cerebro:editor', async (e, arquivo) => {
  if (!daJanela(e)) return RECUSADO;
  const caminho = await cerebro.caminhoDoArquivo(arquivo);
  if (!caminho) return { ok: false, erro: 'arquivo não encontrado' };
  const padrao = async () => ({ ok: !(await shell.openPath(caminho)), via: 'padrao' });
  // o caminho vai entre aspas num "cmd /c": se tiver algo que o cmd interpretaria, nem tenta
  if (/["%!^&|<>]/.test(caminho)) return padrao();
  return new Promise((resolve) => {
    const filho = spawn('code "' + caminho + '"', { shell: true, windowsHide: true, stdio: 'ignore' });
    filho.on('error', () => padrao().then(resolve));
    filho.on('exit', (codigo) => (codigo === 0 ? resolve({ ok: true, via: 'code' }) : padrao().then(resolve)));
  });
});

// ---------- Módulo Projetos ----------
// O cadastro (projetos.json) e as regras são do cerebro/tools/projetos.py; app/projetos.js só chama.
const projetos = require('./projetos');
const textoCurto = (v) => typeof v === 'string' && v.length <= 60;
ipcMain.handle('projetos:listar', (e) => (daJanela(e) ? projetos.listar() : RECUSADO));
ipcMain.handle('projetos:adicionar', (e, dados) => (daJanela(e) && dados && typeof dados === 'object' ? projetos.adicionar(dados) : RECUSADO));
ipcMain.handle('projetos:editar', (e, id, dados) => (daJanela(e) && textoCurto(id) && dados && typeof dados === 'object' ? projetos.editar(id, dados) : RECUSADO));
ipcMain.handle('projetos:remover', (e, id) => (daJanela(e) && textoCurto(id) ? projetos.remover(id) : RECUSADO));
ipcMain.handle('projetos:preparar', (e, id, confirmar) => (daJanela(e) && textoCurto(id) ? projetos.preparar(id, confirmar === true) : RECUSADO));
ipcMain.handle('projetos:preencher-estado', (e, id, dados) => (daJanela(e) && textoCurto(id) && dados && typeof dados === 'object' ? projetos.preencherEstado(id, dados) : RECUSADO));
ipcMain.handle('projetos:avaliar-skills', (e, id, online) => (daJanela(e) && textoCurto(id) ? projetos.avaliarSkills(id, online === true) : RECUSADO));
// Abrir a IA do projeto num terminal novo (o widget não espera a sessão terminar). As opções de cada IA
// ficam em app/ias.js; a janela em app/terminal.js; o prompt e o registro no projetos.py.
const ias = require('./ias');
const { abrirIA } = require('./abrir');
// sessões abertas pelo widget (painel "Sessões ativas"); MEU_WIDGET_SESSOES troca o arquivo (testes)
const { criarRegistro } = require('./sessoes');
const sessoesIA = criarRegistro({ arquivo: process.env.MEU_WIDGET_SESSOES || path.join(PASTA_CONFIG, 'sessoes.json') });
ipcMain.handle('ias:resumo', (e) => (daJanela(e) ? ias.resumo() : null));
ipcMain.handle('ias:docs', (e, id) => {
  const ia = daJanela(e) && typeof id === 'string' ? ias.obter(id) : null;
  if (ia) shell.openExternal(ia.docs); // só o link oficial guardado no ias.js, nunca um vindo da tela
  return !!ia;
});
// comandos que a tela pode pedir para o widget digitar: os "comandosUteis" de cada IA (app/ias-dados.json), nunca texto livre
const comandosDa = (idIA) => new Set((ias.obter(idIA) || {}).comandosUteis || []);
const COMANDOS_DE_ALGUMA_IA = new Set(Object.keys(ias.IAS).flatMap((id) => [...comandosDa(id)]));
// Terminal embutido: o Claude roda dentro do widget (app/embutido.js + app/pty.cs). MEU_WIDGET_TERMINAL_EXTERNO=1 desliga (testes).
const { criarGerenciador } = require('./embutido');
const embutidos = criarGerenciador({
  pastaPty: PASTA_CONFIG,
  localizar: (programa, env) => ias.localizar(programa, env),
  enviar: (canal, ...args) => {
    if (janela && !janela.isDestroyed()) janela.webContents.send(canal, ...args);
    if (janelaTerm && !janelaTerm.isDestroyed()) janelaTerm.webContents.send(canal, ...args);
  },
});
const iniciarEmbutido = process.env.MEU_WIDGET_TERMINAL_EXTERNO ? null : (opcoes) => embutidos.iniciar(opcoes);
// "Pausar com segurança" (limite de uso): estado atual e próximos passos do cérebro + anotação da pausa
ipcMain.handle('projetos:pausa-estado', (e, id) => (daJanela(e) && textoCurto(id) ? projetos.estadoDaPausa(id) : RECUSADO));
ipcMain.handle('projetos:pausa-salvar', (e, id, dados) => (daJanela(e) && textoCurto(id) && dados && typeof dados === 'object' ? projetos.salvarEstadoDaPausa(id, dados) : RECUSADO));
ipcMain.handle('projetos:pausa-registrar', (e, id, motivo, ia) => (daJanela(e) && textoCurto(id) ? projetos.registrarPausa(id, motivo === 'manual' ? 'manual' : 'limite', typeof ia === 'string' ? ia.slice(0, 20) : '') : RECUSADO));
// subaba Economia da aba Cérebro: estimativas feitas a partir dos logs locais + o teste A/B manual
const economia = require('./economia');
ipcMain.handle('economia:painel', (e) => (daJanela(e) ? economia.painel(8) : RECUSADO));
ipcMain.handle('economia:ab-registrar', (e, dados) => (daJanela(e) && dados && typeof dados === 'object' ? economia.registrarAB(dados) : RECUSADO));
ipcMain.handle('economia:ab-remover', (e, id) => (daJanela(e) && textoCurto(id) ? economia.removerAB(id) : RECUSADO));
// Manutenção do cérebro (botão "Manutenção" da aba Cérebro). Tudo é por clique; só consolidar e propor-estado usam IA, e a tela
// pede confirmação (com a estimativa de tokens) antes. O texto de uma proposta de estado e a pasta do backup ficam guardados AQUI:
// a tela nunca manda de volta conteúdo para gravar nem um caminho de arquivo.
const manutencao = require('./manutencao');
let propostaEstado = null; // { projeto, texto } da última proposta
let destinoBackup = null;  // pasta escolhida no seletor
const ERRO_SEM_PROPOSTA = { ok: false, tipo: 'erro', erro: 'não há proposta para aplicar: peça a proposta de novo' };
ipcMain.handle('manutencao:diagnostico', (e) => (daJanela(e) ? manutencao.diagnostico() : RECUSADO));
ipcMain.handle('manutencao:sinonimos-aprovar', (e, pares) => (daJanela(e) && pares && typeof pares === 'object' ? manutencao.aprovarSinonimos(pares) : RECUSADO));
ipcMain.handle('manutencao:sinonimos-remover', (e, apelido) => (daJanela(e) && textoCurto(apelido) ? manutencao.removerSinonimo(apelido) : RECUSADO));
ipcMain.handle('manutencao:estimar-consolidacao', (e) => (daJanela(e) ? manutencao.estimarConsolidacao() : RECUSADO));
ipcMain.handle('manutencao:consolidar', (e, id, modelo) => (daJanela(e) && textoCurto(id) ? manutencao.consolidar(id, modelo) : RECUSADO));
ipcMain.handle('manutencao:estimar-estado', (e, projeto) => (daJanela(e) && textoCurto(projeto) ? manutencao.estimarEstado(projeto) : RECUSADO));
ipcMain.handle('manutencao:propor-estado', async (e, projeto, modelo) => {
  if (!daJanela(e) || !textoCurto(projeto)) return RECUSADO;
  const r = await manutencao.proporEstado(projeto, modelo);
  propostaEstado = r.ok ? { projeto, texto: r.dados.proposta } : null;
  return r;
});
ipcMain.handle('manutencao:aplicar-estado', async (e, projeto) => {
  if (!daJanela(e) || !textoCurto(projeto)) return RECUSADO;
  if (!propostaEstado || propostaEstado.projeto !== projeto) return ERRO_SEM_PROPOSTA;
  const r = await manutencao.aplicarEstado(projeto, propostaEstado.texto);
  if (r.ok) propostaEstado = null;
  return r;
});
ipcMain.handle('manutencao:descartar-proposta', (e) => { if (daJanela(e)) propostaEstado = null; return true; });
ipcMain.handle('manutencao:indices', (e) => (daJanela(e) ? manutencao.refazerIndices() : RECUSADO));
ipcMain.handle('manutencao:escolher-destino', async (e) => {
  if (!daJanela(e)) return RECUSADO;
  // MEU_WIDGET_DESTINO_TESTE: só para os testes automáticos (pula o seletor nativo do Windows, que não dá para automatizar)
  if (process.env.MEU_WIDGET_DESTINO_TESTE) { destinoBackup = process.env.MEU_WIDGET_DESTINO_TESTE; return { ok: true, pasta: destinoBackup }; }
  const r = await dialog.showOpenDialog(janela, { title: 'Escolha a pasta onde guardar o backup do cérebro', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, tipo: 'cancelado', erro: '' };
  destinoBackup = r.filePaths[0];
  return { ok: true, pasta: destinoBackup };
});
ipcMain.handle('manutencao:exportar', (e) => (!daJanela(e) ? RECUSADO : destinoBackup ? manutencao.exportar(destinoBackup) : { ok: false, tipo: 'erro', erro: 'escolha primeiro a pasta de destino' }));
// contagem local de sessões (não é o uso real da conta)
const usoLocal = require('./uso');
ipcMain.handle('uso:resumo', (e) => (daJanela(e) ? usoLocal.resumo(7) : RECUSADO));
ipcMain.handle('projetos:abrir-ia', (e, id, opcoes) => {
  if (!daJanela(e) || !textoCurto(id) || !opcoes || typeof opcoes !== 'object') return RECUSADO;
  return abrirIA(id, {
    modo: String(opcoes.modo || 'novo'), modelo: String(opcoes.modelo || ''), tarefa: String(opcoes.tarefa || '').slice(0, 500),
    forcar: opcoes.forcar === true, ignorarLimite: opcoes.ignorarLimite === true, worktree: opcoes.worktree === true,
    retomada: opcoes.retomada === true, semPularPermissoes: opcoes.semPularPermissoes === true,
    // outra IA que não a do projeto ("continuar em outra IA"): o abrir.js só aceita ids que o ias.js conhece
    ia: typeof opcoes.ia === 'string' ? opcoes.ia.slice(0, 40) : '',
    // abrir vazio para ver o uso: só comandos desta lista vão para a área de transferência (nunca texto vindo da tela)
    semPrompt: opcoes.semPrompt === true, comando: opcoes.semPrompt === true && COMANDOS_DE_ALGUMA_IA.has(opcoes.comando) ? opcoes.comando : '', // o abrir.js confere na IA aberta
  }, { copiar: (texto) => clipboard.writeText(texto), registro: sessoesIA, max: carregarConfig().max_sessoes, embutido: iniciarEmbutido });
});
// painel "Sessões ativas": a tela só pede com a aba visível, no máximo a cada 10 s
ipcMain.handle('sessoes:listar', async (e) => (daJanela(e) ? { ok: true, sessoes: await sessoesIA.listar(), max: carregarConfig().max_sessoes } : RECUSADO));
ipcMain.handle('sessoes:focar', async (e, id) => {
  const s = daJanela(e) && typeof id === 'string' ? sessoesIA.obter(id) : null;
  if (!s) return { ok: false, erro: 'sessão não encontrada' };
  if (!s.janelaPid) return { ok: false, erro: 'a janela desta sessão ainda não foi identificada' };
  try {
    // o medidor acha a janela cujo dono é o cmd da sessão e traz para a frente (sem o medidor, não dá)
    return (await pedirServidorPS('focar-pid ' + s.janelaPid)) === 'true' ? { ok: true } : { ok: false, erro: 'não consegui trazer a janela (ela foi fechada?)' };
  } catch {
    return { ok: false, erro: 'focar janelas precisa do medidor (helper.cs)' };
  }
});
ipcMain.handle('sessoes:encerrar', (e, id) => (daJanela(e) && typeof id === 'string' ? sessoesIA.encerrar(id) : RECUSADO));
// terminal embutido: a tela só manda teclas (o que você digita), tamanho e pedidos; o que roda é sempre o que o abrir.js montou
ipcMain.handle('term:anexar', (e, id) => (daJanela(e) && typeof id === 'string' ? embutidos.anexar(id) : null));
ipcMain.on('term:entrada', (e, id, texto) => { if (daJanela(e) && typeof id === 'string') embutidos.entrada(id, texto); });
ipcMain.on('term:tamanho', (e, id, colunas, linhas) => { if (daJanela(e) && typeof id === 'string' && Number.isInteger(colunas) && Number.isInteger(linhas)) embutidos.tamanho(id, colunas, linhas); });
// digitar um comando da lista (hoje só /usage) quando a IA estiver esperando você; nunca texto vindo da tela
// o comando é conferido contra a IA DAQUELA sessão (cada terminal sabe a sua IA)
ipcMain.handle('term:comando', (e, id, comando) => (daJanela(e) && typeof id === 'string' && comandosDa(embutidos.iaDe(id)).has(comando) ? embutidos.comando(id, comando) : false));
ipcMain.handle('term:existe', (e, id) => (daJanela(e) && typeof id === 'string' ? embutidos.existe(id) : false));
ipcMain.handle('term:encerrar', (e, id) => {
  if (!daJanela(e) || typeof id !== 'string') return false;
  embutidos.encerrar(id);
  return true;
});

// Abrir um PowerShell na pasta do projeto (dentro do terminal do widget; não trava a pasta para o Claude/Antigravity)
ipcMain.handle('projetos:abrir-ps', async (e, id) => {
  if (!daJanela(e) || !textoCurto(id)) return RECUSADO;
  const lista = await projetos.listar();
  if (!lista.ok) return lista;
  const p = lista.dados.projetos.find((x) => x.id === id);
  if (!p) return { ok: false, tipo: 'erro', erro: 'projeto não encontrado: ' + id };
  if (!p.pasta_existe) return { ok: false, tipo: 'erro', erro: 'a pasta do projeto não existe: ' + p.pasta };
  const env = ias.ambiente(ias.obter('claude'), process.env, { usarChave: false });
  if (iniciarEmbutido) {
    const r = await iniciarEmbutido({ pasta: p.pasta, programa: 'powershell.exe', args: ['-NoLogo'], env });
    if (r && r.termId) return { ok: true, via: 'widget', termId: r.termId, nome: p.nome, modelo: 'powershell', cor: p.cor, ia: 'powershell', projetoId: p.id };
  }
  spawn('cmd.exe', ['/d', '/s', '/c', `"start "PowerShell - ${p.nome.replace(/"/g, "'")}" /d "${p.pasta}" powershell.exe -NoLogo"`],
    { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env }).unref();
  return { ok: true, via: 'cmd', termId: null, nome: p.nome, modelo: 'powershell', cor: p.cor, ia: 'powershell', projetoId: p.id };
});

// Destacar somente o terminal/PowerShell numa janela própria mantendo a borda característica do widget (para usar em outro monitor)
let ultimoEstadoTerm = { sessoes: [], atual: '' };
function sanitizarEstadoTerm(estado) {
  if (!estado || typeof estado !== 'object') return ultimoEstadoTerm;
  const sessoes = (Array.isArray(estado.sessoes) ? estado.sessoes : [])
    .filter((s) => s && typeof s.termId === 'string' && s.termId.length <= 32)
    .slice(0, 16)
    .map((s) => ({
      termId: texto(s.termId, 32),
      nome: texto(s.nome, 60) || 'Terminal',
      modelo: texto(s.modelo, 40) || 'powershell',
      cor: /^#[0-9a-f]{6}$/i.test(s.cor || '') ? s.cor : '#4f9dff',
      sessaoId: typeof s.sessaoId === 'string' ? texto(s.sessaoId, 32) : '',
      ia: texto(s.ia, 24) || 'powershell',
      projetoId: typeof s.projetoId === 'string' ? texto(s.projetoId, 40) : '',
    }));
  const atual = typeof estado.atual === 'string' ? texto(estado.atual, 32) : (sessoes[0] && sessoes[0].termId) || '';
  ultimoEstadoTerm = { sessoes, atual };
  return ultimoEstadoTerm;
}

function criarJanelaTerm() {
  if (janelaTerm && !janelaTerm.isDestroyed()) {
    janelaTerm.show();
    janelaTerm.focus();
    return janelaTerm;
  }
  const cfg = carregarConfig();
  const ios = cfg.estilo === 'ios';
  const displays = screen.getAllDisplays();
  const dispPrincipal = janela && !janela.isDestroyed() ? screen.getDisplayMatching(janela.getBounds()) : screen.getPrimaryDisplay();
  const outroMonitor = displays.find((d) => d.id !== dispPrincipal.id);
  const area = (outroMonitor || dispPrincipal).workArea;
  const width = Math.min(820, area.width - 2 * MARGEM);
  const height = Math.min(520, area.height - 2 * MARGEM);
  const x = outroMonitor
    ? area.x + Math.round((area.width - width) / 2)
    : Math.max(area.x + MARGEM, (janela && !janela.isDestroyed() ? janela.getBounds().x - 40 : area.x + MARGEM));
  const y = outroMonitor
    ? area.y + Math.round((area.height - height) / 2)
    : Math.min(area.y + area.height - height - MARGEM, (janela && !janela.isDestroyed() ? janela.getBounds().y + 36 : area.y + MARGEM));

  const w = new BrowserWindow({
    x, y, width, height,
    minWidth: 460, minHeight: 240,
    frame: false,
    transparent: ios,
    backgroundColor: ios ? '#00000000' : '#0c0c0c',
    icon: path.join(__dirname, '..', 'assets', 'icone.ico'),
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    alwaysOnTop: cfg.fixado,
    skipTaskbar: false, // aparece na barra de tarefas para facilitar em múltiplos monitores
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'index.html'), { query: { estilo: ios ? 'ios' : 'cmd', rapido: '1', destacado: '1' } });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (ev) => ev.preventDefault());
  w.once('ready-to-show', () => { if (!w.isDestroyed()) { w.show(); w.focus(); } });
  w.webContents.on('did-finish-load', () => {
    if (!w.isDestroyed()) w.webContents.send('term:sincronizar', ultimoEstadoTerm);
  });
  w.on('closed', () => {
    if (janelaTerm === w) {
      janelaTerm = null;
      if (janela && !janela.isDestroyed()) janela.webContents.send('term:acoplado', ultimoEstadoTerm);
    }
  });
  if (ios) acompanharFundo(w);
  janelaTerm = w;
  return w;
}

ipcMain.handle('term:destacar', (e, estado) => {
  if (!daJanela(e)) return false;
  const limpo = sanitizarEstadoTerm(estado);
  const jaExistia = !!(janelaTerm && !janelaTerm.isDestroyed());
  const w = criarJanelaTerm();
  if (jaExistia && !w.webContents.isLoading()) w.webContents.send('term:sincronizar', limpo);
  return true;
});

ipcMain.handle('term:acoplar', (e, estado) => {
  if (!daJanela(e)) return false;
  if (estado) sanitizarEstadoTerm(estado);
  if (janelaTerm && !janelaTerm.isDestroyed()) janelaTerm.close();
  else if (janela && !janela.isDestroyed()) janela.webContents.send('term:acoplado', ultimoEstadoTerm);
  return true;
});
// ---------- Módulo Skills ----------
// Custos e simulação: cerebro/tools/tokens.py. Instalar/remover/ler/importar: skills-biblioteca/skills.py.
// app/skills.js só chama. Importar de fora: a pasta ou o .zip escolhido fica guardado AQUI (a tela nunca manda
// um caminho), é só lido para você revisar, e nada dele é executado.
const skillsLib = require('./skills');
let origemSkill = null;
const nomeSkill = (v) => typeof v === 'string' && v.length <= 64;
// o alvo (a IA) é o último parâmetro e é opcional: sem ele vale o Claude; o app/skills.js só aceita IAs conhecidas (e "ambos" para instalar/remover)
const textoAlvo = (a) => (typeof a === 'string' ? a.slice(0, 20) : '');
ipcMain.handle('skills:painel', (e, escopo, projeto, alvo) => (daJanela(e) ? skillsLib.painel(escopo, projeto, textoAlvo(alvo)) : RECUSADO));
ipcMain.handle('skills:instalar', (e, nome, escopo, projeto, alvo) => (daJanela(e) && nomeSkill(nome) ? skillsLib.instalar(nome, escopo, projeto, textoAlvo(alvo)) : RECUSADO));
ipcMain.handle('skills:remover', (e, nome, escopo, projeto, alvo) => (daJanela(e) && nomeSkill(nome) ? skillsLib.remover(nome, escopo, projeto, textoAlvo(alvo)) : RECUSADO));
ipcMain.handle('skills:ler', (e, nome, alvo) => (daJanela(e) && nomeSkill(nome) ? skillsLib.ler(nome, textoAlvo(alvo)) : RECUSADO));
ipcMain.handle('skills:escolher-origem', async (e, tipo) => {
  if (!daJanela(e)) return RECUSADO;
  const zip = tipo === 'zip';
  const r = await dialog.showOpenDialog(janela, zip
    ? { title: 'Escolha o .zip da skill', properties: ['openFile'], filters: [{ name: 'Skill (.zip)', extensions: ['zip'] }] }
    : { title: 'Escolha a pasta da skill (com um SKILL.md)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, tipo: 'cancelado', erro: '' };
  origemSkill = r.filePaths[0];
  rotuloOrigem = null;
  return { ok: true, nome: path.basename(origemSkill) };
});
ipcMain.handle('skills:importar', async (e, confirmar, categoria) => {
  if (!daJanela(e)) return RECUSADO;
  if (!origemSkill) return { ok: false, tipo: 'erro', erro: 'escolha primeiro a pasta ou o .zip' };
  const r = await skillsLib.importar(origemSkill, confirmar === true, typeof categoria === 'string' ? categoria : '', rotuloOrigem);
  if (confirmar === true && r.ok) { origemSkill = null; rotuloOrigem = null; limparBaixada(); }
  return r;
});
// Catálogo online ([buscar online]): procura skills nos repositórios do GitHub e baixa a PASTA de uma skill para uma pasta temporária; de lá
// segue o mesmo fluxo seguro de importar (revisar tudo antes; nada é executado nem instalado). Só roda por clique, com limites de tamanho.
// MEU_WIDGET_GITHUB_API / MEU_WIDGET_GITHUB_RAW trocam os endereços (só para os testes automáticos, com um GitHub de mentira).
const { criarCatalogo, FONTES: FONTES_SKILLS, ErroCatalogo } = require('./catalogo-skills');
const catalogoSkills = criarCatalogo({
  api: process.env.MEU_WIDGET_GITHUB_API || undefined, raw: process.env.MEU_WIDGET_GITHUB_RAW || undefined,
  arquivoCache: path.join(PASTA_CONFIG, 'skills-catalogo.json'),
});
let pastaBaixada = null;  // pasta temporária da última skill baixada do catálogo
let rotuloOrigem = null;  // "github:dono/repo/caminho": de onde a skill veio, para a biblioteca registrar
function limparBaixada() {
  if (!pastaBaixada) return;
  try { fs.rmSync(pastaBaixada, { recursive: true, force: true }); } catch { /* em uso: o Windows limpa a pasta temporária depois */ }
  pastaBaixada = null;
}
const erroDoCatalogo = (x) => ({ ok: false, tipo: x instanceof ErroCatalogo ? x.tipo : 'erro', erro: x instanceof ErroCatalogo ? x.message : 'algo deu errado: ' + x.message });
ipcMain.handle('skills:catalogo-fontes', (e) => (daJanela(e) ? { ok: true, fontes: FONTES_SKILLS } : RECUSADO));
ipcMain.handle('skills:catalogo-listar', async (e, repo, termo) => {
  if (!daJanela(e)) return RECUSADO;
  try { return { ok: true, ...(await catalogoSkills.listar(repo, typeof termo === 'string' ? termo : '')) }; } catch (x) { return erroDoCatalogo(x); }
});
ipcMain.handle('skills:catalogo-repos', async (e, termo) => {
  if (!daJanela(e)) return RECUSADO;
  try { return { ok: true, ...(await catalogoSkills.repositorios(typeof termo === 'string' ? termo : '')) }; } catch (x) { return erroDoCatalogo(x); }
});
ipcMain.handle('skills:catalogo-baixar', async (e, repo, caminho) => {
  if (!daJanela(e)) return RECUSADO;
  try {
    limparBaixada();
    pastaBaixada = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-widget-skill-'));
    const b = await catalogoSkills.baixar(repo, typeof caminho === 'string' ? caminho : '', pastaBaixada);
    origemSkill = b.pasta; // a revisão (skills:importar) lê daqui
    rotuloOrigem = `github:${repo}${caminho ? '/' + caminho : ''}`.slice(0, 250);
    return { ok: true, nome: b.nome, arquivos: b.arquivos, bytes: b.bytes };
  } catch (x) {
    limparBaixada();
    return erroDoCatalogo(x);
  }
});

// seletor de pasta do "Adicionar"/"Editar": só devolve o caminho escolhido (quem grava é o projetos.py)
ipcMain.handle('projetos:escolher-pasta', async (e, inicial) => {
  if (!daJanela(e)) return RECUSADO;
  const opcoes = { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] };
  if (typeof inicial === 'string' && inicial.length > 0 && inicial.length < 500 && fs.existsSync(inicial)) opcoes.defaultPath = inicial;
  const r = await dialog.showOpenDialog(janela, opcoes);
  return r.canceled || !r.filePaths[0] ? { ok: false, tipo: 'cancelado', erro: '' } : { ok: true, pasta: r.filePaths[0] };
});

ipcMain.on('janela:fechar', (e) => {
  if (daJanelaTerm(e)) { if (janelaTerm && !janelaTerm.isDestroyed()) janelaTerm.close(); return; }
  if (daJanela(e)) app.quit();
});

// ---------- Gerenciador de tarefas (aba System) ----------
// Lista "Apps" (janelas, como o Gerenciador de Tarefas) e "Processes" (todos, agrupados por nome). A tela NUNCA manda PIDs: manda um id
// ("a:nome" ou "p:nome") que é resolvido AQUI contra a última leitura, e o que é do sistema, do shell do Windows ou do próprio widget é recusado.
// Fechar = pedido educado (taskkill sem /F: o programa pode perguntar se quer salvar). Encerrar = força (taskkill /F).
// MEU_WIDGET_SYS_FILTRO (regex): só para os testes automáticos; a lista, o "fechar todos" e o "encerrar" só enxergam o que casar.
const PROTEGIDOS = new Set(['system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'fontdrvhost', 'explorer',
  'sihost', 'taskhostw', 'ctfmon', 'runtimebroker', 'applicationframehost', 'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'searchapp',
  'textinputhost', 'lockapp', 'securityhealthsystray', 'securityhealthservice', 'widgets', 'meu widget', 'meuwidget', 'electron', 'idle']);
const FILTRO_SYS = process.env.MEU_WIDGET_SYS_FILTRO ? new RegExp(process.env.MEU_WIDGET_SYS_FILTRO, 'i') : null;
let mapaGerenciador = { apps: new Map(), procs: new Map() };
let previsaoFechar = new Set();

function pidsDoWidget() {
  const s = new Set([process.pid]);
  try { for (const m of app.getAppMetrics()) s.add(m.pid); } catch { /* ainda subindo */ }
  if (servidorPS && servidorPS.pid) s.add(servidorPS.pid);
  return s;
}
const publicoSys = (x) => ({ id: x.id, nome: x.nome, titulo: x.titulo || '', n: x.pids.length, cpu: Math.round(x.cpu * 10) / 10, ram: Math.round(x.ram), protegido: x.protegido });

async function montarGerenciador() {
  if (Date.now() - ultimaLeituraProcessos > 1800) await atualizarProcessos();
  let janelas = [];
  try { janelas = JSON.parse(await pedirServidorPS('apps')); } catch { /* sem a lista de janelas */ }
  const proprios = pidsDoWidget();
  const grupos = new Map(processosCompletos.map((g) => [g.chave, g]));
  const protegido = (chave, pids) => PROTEGIDOS.has(chave) || pids.some((p) => proprios.has(p));
  // uma linha por processo com janela. CPU e memória: o programa inteiro (todos os processos de mesmo nome, como o Chrome) quando ele tem uma
  // janela só; quando vários processos do mesmo programa têm janela (vários PowerShell, por exemplo), os números de cada um
  const validas = (Array.isArray(janelas) ? janelas : []).filter((j) => j && typeof j.n === 'string' && Number.isInteger(j.i));
  const porNome = new Map();
  for (const j of validas) porNome.set(j.n.toLowerCase(), (porNome.get(j.n.toLowerCase()) || 0) + 1);
  const apps = new Map();
  for (const j of validas) {
    const chave = j.n.toLowerCase();
    if (FILTRO_SYS && !FILTRO_SYS.test(j.n + ' ' + (j.t || ''))) continue;
    const g = grupos.get(chave);
    const so = g && porNome.get(chave) > 1 ? g.porPid.get(j.i) : g;
    const a = { id: 'a:' + j.i, chave, nome: j.d || j.n, titulo: j.t || '', pids: [j.i], cpu: so ? so.cpu : 0, ram: so ? so.ram : 0, protegido: false };
    a.protegido = protegido(chave, a.pids);
    apps.set(a.id, a);
  }
  const procs = new Map();
  for (const g of processosCompletos) {
    if (FILTRO_SYS && !FILTRO_SYS.test(g.nome)) continue;
    procs.set('p:' + g.chave, { id: 'p:' + g.chave, chave: g.chave, nome: g.nome, titulo: '', pids: g.pids, cpu: g.cpu, ram: g.ram, protegido: protegido(g.chave, g.pids) });
  }
  mapaGerenciador = { apps, procs };
  return mapaGerenciador;
}
function taskkill(args) {
  return new Promise((resolve) => require('child_process').execFile('taskkill', args, { windowsHide: true, timeout: 15000 }, (erro) => resolve(!erro)));
}
ipcMain.handle('sys:lista', async (e) => {
  if (!daJanela(e)) return RECUSADO;
  const m = await montarGerenciador();
  return { ok: true, apps: [...m.apps.values()].map(publicoSys), procs: [...m.procs.values()].map(publicoSys) };
});
// fechar com educação: o programa pode perguntar se você quer salvar
ipcMain.handle('sys:fechar-app', async (e, id) => {
  if (!daJanela(e) || typeof id !== 'string') return RECUSADO;
  const a = mapaGerenciador.apps.get(id);
  if (!a) return { ok: false, erro: 'esse programa já fechou' };
  if (a.protegido) return { ok: false, erro: 'este programa é do Windows ou do próprio widget: não dá para fechar daqui' };
  let enviados = 0;
  for (const pid of a.pids) if (await taskkill(['/PID', String(pid)])) enviados++;
  return { ok: true, enviados };
});
// encerrar à força (apps que não respondem, ou qualquer processo da lista Processes)
ipcMain.handle('sys:encerrar', async (e, id) => {
  if (!daJanela(e) || typeof id !== 'string') return RECUSADO;
  const x = mapaGerenciador.apps.get(id) || mapaGerenciador.procs.get(id);
  if (!x) return { ok: false, erro: 'esse processo já acabou' };
  if (x.protegido) return { ok: false, erro: 'este processo é do Windows ou do próprio widget: não dá para encerrar daqui' };
  const pids = x.pids.length ? x.pids : [];
  let mortos = 0;
  for (const pid of pids) if (await taskkill(['/F', '/PID', String(pid)])) mortos++;
  return { ok: true, mortos };
});
// "fechar todos os apps": primeiro MOSTRA o que seria fechado (sem o que é protegido); só fecha o que você confirmou
ipcMain.handle('sys:fechar-todos-prever', async (e) => {
  if (!daJanela(e)) return RECUSADO;
  const m = await montarGerenciador();
  const todos = [...m.apps.values()];
  const fechaveis = todos.filter((a) => !a.protegido);
  previsaoFechar = new Set(fechaveis.map((a) => a.id));
  return { ok: true, apps: fechaveis.map(publicoSys), ignorados: todos.filter((a) => a.protegido).map((a) => a.nome) };
});
ipcMain.handle('sys:fechar-todos', async (e, ids) => {
  if (!daJanela(e) || !Array.isArray(ids)) return RECUSADO;
  const escolhidos = ids.filter((id) => typeof id === 'string' && previsaoFechar.has(id) && mapaGerenciador.apps.has(id) && !mapaGerenciador.apps.get(id).protegido);
  previsaoFechar = new Set();
  for (const id of escolhidos) for (const pid of mapaGerenciador.apps.get(id).pids) await taskkill(['/PID', String(pid)]);
  await new Promise((r) => setTimeout(r, 2500)); // dá tempo de fechar (ou de aparecer o "deseja salvar?")
  const m = await montarGerenciador();
  const restantes = escolhidos.filter((id) => m.apps.has(id)).map((id) => publicoSys(m.apps.get(id)));
  return { ok: true, pedidos: escolhidos.length, fechados: escolhidos.length - restantes.length, restantes };
});

// ---------- Desligar o PC ----------
// Duas confirmações em sequência (a ordem é conferida AQUI, não só na tela) e uma contagem de 20 s que dá para cancelar (shutdown /a).
// MEU_WIDGET_DESLIGAR_TESTE: só para os testes automáticos; em vez de desligar de verdade, anota o comando no arquivo indicado.
const SEGUNDOS_DESLIGAR = 20;
const JANELA_CONFIRMACAO = 60000;
let etapaDesligar = { n: 0, t: 0 };
function comandoDeSistema(args) {
  const teste = process.env.MEU_WIDGET_DESLIGAR_TESTE;
  if (teste) { fs.appendFileSync(teste, 'shutdown ' + args.join(' ') + '\n'); return; }
  require('child_process').execFile('shutdown', args, { windowsHide: true }, () => {});
}
ipcMain.handle('power:etapa', (e, n) => {
  if (!daJanela(e)) return RECUSADO;
  const agora = Date.now();
  if (n === 1) { etapaDesligar = { n: 1, t: agora }; return { ok: true }; }
  if (n === 2 && etapaDesligar.n === 1 && agora - etapaDesligar.t < JANELA_CONFIRMACAO) { etapaDesligar = { n: 2, t: agora }; return { ok: true }; }
  etapaDesligar = { n: 0, t: 0 };
  return { ok: false, erro: 'confirme as duas etapas, na ordem' };
});
ipcMain.handle('power:desligar', (e) => {
  if (!daJanela(e)) return RECUSADO;
  const ok = etapaDesligar.n === 2 && Date.now() - etapaDesligar.t < JANELA_CONFIRMACAO;
  etapaDesligar = { n: 0, t: 0 };
  if (!ok) return { ok: false, erro: 'faltou confirmar as duas etapas' };
  comandoDeSistema(['/s', '/t', String(SEGUNDOS_DESLIGAR), '/c', 'Desligando pelo Meu Widget. Para cancelar: shutdown /a']);
  return { ok: true, segundos: SEGUNDOS_DESLIGAR };
});
ipcMain.handle('power:cancelar', (e) => {
  if (!daJanela(e)) return RECUSADO;
  etapaDesligar = { n: 0, t: 0 };
  comandoDeSistema(['/a']);
  return { ok: true };
});

// ---------- Iniciar com o Windows ----------
// Só no .exe (app.isPackaged). No modo "npm start" quem abre o widget no login
// é o atalho do iniciar-widget.vbs na pasta shell:startup (veja o README).
// No .exe portátil, process.execPath aponta para uma pasta temporária que muda
// a cada abertura; PORTABLE_EXECUTABLE_FILE é o caminho real do .exe.
function applyAutostart(on) {
  if (!app.isPackaged) return false;
  app.setLoginItemSettings({
    openAtLogin: on === true,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  });
  return true;
}

// A tela liga/desliga: salva na config e aplica. Devolve { ligado, aplicado }.
ipcMain.handle('autostart', (e, on) => {
  if (!daJanela(e) || typeof on !== 'boolean') return null;
  const cfg = carregarConfig();
  cfg.iniciarComWindows = on;
  salvarConfig(cfg);
  return { ligado: on, aplicado: applyAutostart(on) };
});

// ---------- Janela: modos (normal / mini) e pin ----------
// Aplica um tamanho mantendo a borda direita e o topo no lugar (o widget fica
// "preso" ao canto) e sem sair da área visível da tela.
function aplicarTamanho(width, height) {
  const b = janela.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  width = Math.min(width, area.width);
  height = Math.min(height, area.height);
  const x = Math.max(area.x, b.x + b.width - width);
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - height));
  janela.setBounds({ x, y, width, height });
}

ipcMain.handle('janela:modo', (e, modo) => {
  if (daJanelaTerm(e)) {
    if (janelaTerm && !janelaTerm.isDestroyed()) janelaTerm.minimize();
    return true;
  }
  if (!daJanela(e) || !['normal', 'mini'].includes(modo)) return false;
  if (modo === modoAtual) return true;
  const [largura, altura] = janela.getSize();

  if (modo === 'mini') {
    tamanhoAntesDoMini = { largura, altura, modo: modoAtual };
    janela.setMinimumSize(MINI.largura, MINI.altura);
    janela.setMaximumSize(MINI.largura, MINI.altura);
    janela.setResizable(false);
    aplicarTamanho(MINI.largura, MINI.altura);
  } else {
    if (modoAtual === 'mini') {
      // volta do mini: limites normais e o tamanho de antes
      janela.setResizable(true);
      janela.setMaximumSize(MAX.largura, MAX.altura);
      janela.setMinimumSize(MIN.largura, MIN.altura);
      const t = tamanhoAntesDoMini || { largura: TAMANHO_PADRAO.largura, altura: TAMANHO_PADRAO.altura, modo: 'normal' };
      aplicarTamanho(t.largura, t.altura);
    }
  }
  modoAtual = modo;
  return true;
});

// Troca de estilo (CMD <-> iOS): a transparência só pode ser escolhida ao criar
// a janela, então nasce uma janela nova no mesmo canto e a antiga é fechada.
// O medidor (música, volume...) continua vivo: ele é do main.js.
ipcMain.handle('janela:estilo', (e, estilo) => {
  if (!daJanela(e) || (estilo !== 'cmd' && estilo !== 'ios')) return false;
  const cfg = carregarConfig();
  if (cfg.estilo === estilo) return true;
  cfg.estilo = estilo;
  salvarConfig(cfg);
  const antiga = janela;
  const b = antiga.getBounds();
  setTimeout(() => { // responde à tela antes de trocar
    modoAtual = 'normal';
    tamanhoAntesDoMini = null;
    // nasce escondida; quando estiver desenhada, aparece e a antiga sai
    const nova = criarJanela({ direita: b.x + b.width, topo: b.y });
    let feito = false;
    const trocar = () => {
      if (feito) return;
      feito = true;
      if (!nova.isDestroyed()) nova.show();
      if (!antiga.isDestroyed()) antiga.destroy();
    };
    Promise.all([new Promise((ok) => nova.once('ready-to-show', ok)), nova.vidroPronto]).then(trocar);
    setTimeout(trocar, 4000); // garantia: nunca ficam as duas
  }, 60);
  return true;
});

// Pin: fixado = sempre no topo e fora da barra de tarefas. Salva na config.
ipcMain.handle('janela:fixar', (e, fixar) => {
  if (!daJanela(e) || typeof fixar !== 'boolean') return null;
  if (daJanelaTerm(e)) {
    if (janelaTerm && !janelaTerm.isDestroyed()) janelaTerm.setAlwaysOnTop(fixar);
    return fixar;
  }
  janela.setAlwaysOnTop(fixar);
  janela.setSkipTaskbar(fixar);
  const cfg = carregarConfig();
  cfg.fixado = fixar;
  salvarConfig(cfg);
  return fixar;
});

// ---------- Atualização pelo GitHub ----------
// O botão "update" do cabeçalho aparece quando a branch deste widget (app/atualizacao.json) ganha um commit novo.
// Rede: UMA chamada leve (o SHA do último commit) uns segundos depois de abrir, e só se "avisar de atualizações" estiver
// ligado nos ajustes; o download só começa quando o dono clica em "atualizar agora". A troca de arquivos e o que nunca
// é tocado (config, Cérebro, projetos, skills do usuário) estão no app/atualizador.js. Só vale rodando do código
// (npm start / iniciar-widget.sh): o .exe/AppImage não troca os próprios arquivos.
const atualizador = require('./atualizador');
let configAtualizacao = null;
try { configAtualizacao = atualizador.lerConfig(__dirname); } catch (erro) { console.error('Atualização desligada:', erro.message); }
let atualizacao = { disponivel: false, remoto: '' };
let atualizando = false;

const podeAtualizar = () => !app.isPackaged || process.env._MEU_WIDGET_DELEGADO === '1' || fs.existsSync(path.join(cerebro.pastaRaizWidget(), 'app', 'main.js'));

async function verificarAtualizacao() {
  if (!configAtualizacao || !podeAtualizar() || atualizando) return atualizacao;
  try {
    const r = await atualizador.verificar({ raiz: cerebro.pastaRaizWidget(), pastaConfig: PASTA_CONFIG, config: configAtualizacao });
    atualizacao = { disponivel: r.disponivel, remoto: r.remoto.slice(0, 7) };
    if (janela && !janela.isDestroyed()) janela.webContents.send('atualizar:aviso', atualizacao);
  } catch (erro) {
    console.error('Não deu para verificar atualização:', erro.message); // sem internet etc.: o botão simplesmente não aparece
  }
  return atualizacao;
}
ipcMain.handle('atualizar:estado', (e) => (daJanela(e) ? atualizacao : RECUSADO));
// o dono ligou "avisar de atualizações" nos ajustes: confere já (é um clique dele)
ipcMain.handle('atualizar:verificar', (e) => (daJanela(e) ? verificarAtualizacao() : RECUSADO));
ipcMain.handle('atualizar:aplicar', async (e) => {
  if (!daJanela(e)) return RECUSADO;
  if (!configAtualizacao || !podeAtualizar()) return { ok: false, erro: 'esta versão isolada não atualiza por aqui: baixe a nova no GitHub' };
  if (atualizando) return { ok: false, erro: 'já estou atualizando' };
  atualizando = true;
  try {
    const r = await atualizador.atualizar({ raiz: cerebro.pastaRaizWidget(), pastaConfig: PASTA_CONFIG, config: configAtualizacao });
    atualizacao = { disponivel: false, remoto: r.sha.slice(0, 7) };
    return { ok: true, atualizados: r.atualizados, novos: r.novos, depsMudaram: r.depsMudaram };
  } catch (erro) {
    return { ok: false, erro: erro.message };
  } finally {
    atualizando = false;
  }
});
// recomeça o widget para carregar o código novo (o will-quit fecha as sessões e o medidor)
ipcMain.handle('atualizar:reiniciar', (e) => {
  if (!daJanela(e)) return RECUSADO;
  app.relaunch();
  app.quit();
  return { ok: true };
});

// O medidor (ou o PowerShell de reserva) morre junto com o app
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  embutidos.encerrarTodos();
  limparBaixada();
  encerrarServidorPS();
});

// Setup inicial na primeira abertura / verificação: descobre a pasta onde o widget está instalado/extraído
// e garante o ~/.cerebro.json apontando para o cerebro/ válido, bem como projetos.json.
function executarSetupInicial() {
  try {
    const cfg = carregarConfig();
    const raiz = cerebro.pastaRaizWidget();
    const pastaCerebro = path.join(raiz, 'cerebro');

    if (fs.existsSync(pastaCerebro)) {
      const arqConfigCerebro = process.env.CEREBRO_CONFIG || path.join(os.homedir(), '.cerebro.json');
      let dados = {};
      let precisaAtualizar = true;
      try {
        if (fs.existsSync(arqConfigCerebro)) {
          dados = JSON.parse(fs.readFileSync(arqConfigCerebro, 'utf8').replace(/^\uFEFF/, ''));
          if (dados && dados.cerebro_dir && fs.existsSync(dados.cerebro_dir) && fs.existsSync(path.join(dados.cerebro_dir, 'tools', 'cerebro.py'))) {
            precisaAtualizar = false;
          }
        }
      } catch { /* sem config previa ou corrompido */ }

      if (precisaAtualizar) {
        dados.cerebro_dir = pastaCerebro;
        fs.writeFileSync(arqConfigCerebro, JSON.stringify(dados, null, 2) + '\n', 'utf8');
      }

      // Garante projetos.json na raiz do widget para não dar erro de leitura
      const arqProj = path.join(raiz, 'projetos.json');
      if (!fs.existsSync(arqProj)) {
        try { fs.writeFileSync(arqProj, '[]\n', 'utf8'); } catch { /* ignora */ }
      }

      if (!cfg.setupInicialFeito || cfg.pastaInstalacao !== raiz) {
        cfg.setupInicialFeito = true;
        cfg.pastaInstalacao = raiz;
        salvarConfig(cfg);
      }
    }
  } catch (erro) {
    console.error('Falha no setup inicial do widget:', erro.message);
  }
}

app.whenReady().then(() => {
  executarSetupInicial();
  const sessao = session.defaultSession;

  // Nenhuma permissão é concedida à tela, exceto a captura de tela/áudio do
  // visualizador (só para a nossa página local). As checagens silenciosas
  // (câmera, microfone, notificações...) são todas negadas.
  sessao.setPermissionRequestHandler((wc, permissao, cb) => {
    cb(permissao === 'display-capture' && wc.getURL().startsWith('file://'));
  });
  sessao.setPermissionCheckHandler(() => false);

  // Visualizador: getDisplayMedia na tela cai aqui. Entregamos a tela
  // principal (o vídeo é descartado na tela) + o áudio do sistema (loopback).
  // thumbnailSize 0x0 evita gerar miniaturas que não usamos.
  sessao.setDisplayMediaRequestHandler((_pedido, callback) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((fontes) => callback({ video: fontes[0], audio: 'loopback' }))
      .catch((erro) => {
        console.error('Falha na captura de áudio:', erro.message);
        callback({}); // recusa: a tela segue sem visualizador
      });
  });

  criarJanela();

  // 2 s depois de abrir (não atrasa a abertura): confere se saiu versão nova, se o dono deixou ligado
  if (carregarConfig().avisarAtualizacao !== false) setTimeout(verificarAtualizacao, 2000);

  // Atalho global Ctrl+Alt+A: mostra o widget na aba Projetos com o seletor rápido (sem dependências:
  // é do próprio Electron). Se outro programa já usa o atalho, o registro falha e nada acontece.
  if (carregarConfig().atalho_projetos) {
    const ok = globalShortcut.register('Control+Alt+A', () => {
      if (!janela || janela.isDestroyed()) return;
      janela.show();
      janela.focus();
      janela.webContents.send('atalho:projetos');
    });
    if (!ok) console.error('Ctrl+Alt+A já está em uso por outro programa; o seletor rápido fica só pela aba Projetos.');
  }

  // Início com o Windows conforme a config (padrão: ligado). Não faz nada no "npm start".
  try {
    applyAutostart(carregarConfig().iniciarComWindows !== false);
  } catch (erro) {
    console.error('Falha ao configurar o início com o Windows:', erro.message);
  }

  // Com WIDGET_DEBUG=1, os console.error da tela aparecem no terminal
  if (process.env.WIDGET_DEBUG) {
    janela.webContents.on('console-message', (e) => console.log('[tela]', e.message));
  }
});

app.on('window-all-closed', () => app.quit());
