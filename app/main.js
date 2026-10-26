// main.js — processo principal do Electron: cria a janela e cuida da config.
const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const si = require('systeminformation');

// Tamanho da janela (horizontal). Você redimensiona puxando as bordas, dentro
// de um mínimo e um máximo que não quebram o layout; o tamanho fica salvo.
// Ao trocar de modo, a borda direita e o topo não se mexem (preso ao canto).
//   normal   = Pokémon à esquerda + abas à direita (tamanho livre entre MIN e MAX)
//   terminal = aba "term": garante pelo menos ALTURA_TERMINAL de altura
//   mini     = só o Pokémon e a linha de status (tamanho fixo)
const TAMANHO_PADRAO = { largura: 900, altura: 400 };
const MIN = { largura: 720, altura: 320 };
const MAX = { largura: 1400, altura: 900 };
const ALTURA_TERMINAL = 600;
const MINI = { largura: 340, altura: 112 };
const MARGEM = 12; // distância da borda da tela

// A config do usuário fica em %APPDATA%\meu-widget\config.json
const PASTA_CONFIG = path.join(app.getPath('appData'), 'meu-widget');
const ARQUIVO_CONFIG = path.join(PASTA_CONFIG, 'config.json');
const ARQUIVO_MODELO = path.join(__dirname, 'config.json');

// Caches do Electron vão para uma subpasta, deixando a pasta da config limpa
app.setPath('userData', path.join(PASTA_CONFIG, 'electron'));
let janela = null;

// Toda mensagem IPC precisa vir da nossa janela (nunca de outra página)
const daJanela = (e) => janela !== null && !janela.isDestroyed() && e.sender === janela.webContents;

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
const ABAS = new Set(['sys', 'music', 'apps', 'term', 'poke']);
const MAX_CONFIG = 256 * 1024; // bytes
const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v, padrao) => (typeof v === 'boolean' ? v : padrao);
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

function sanitizarApp(a) {
  if (!a || typeof a !== 'object') return null;
  const name = texto(a.name, 30).trim();
  const target = limparTexto(texto(a.target, 1024));
  if (!name || !target) return null;
  if (a.type === 'url') return urlHttpValida(target) ? { name, type: 'url', target } : null;
  if (a.type === 'exe') return { name, type: 'exe', target };
  return null;
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
    desempenho: cfg.desempenho === 'economico' ? 'economico' : 'normal',
    economiaAutomatica: bool(cfg.economiaAutomatica, modelo.economiaAutomatica),
    visualizador: bool(cfg.visualizador, modelo.visualizador),
    animacoes: bool(cfg.animacoes, modelo.animacoes),
    favoritos: Array.isArray(cfg.favoritos) ? [...new Set(cfg.favoritos.filter(slug))].slice(0, 50) : [],
    iniciarComWindows: bool(cfg.iniciarComWindows, modelo.iniciarComWindows),
    boasVindas: {
      ativo: bool(bv.ativo, mbv.ativo),
      voz: bool(bv.voz, mbv.voz),
      grito: bool(bv.grito, mbv.grito),
      chamar: texto(bv.chamar, 40).trim() || mbv.chamar,
    },
    appsSemeados: bool(cfg.appsSemeados, false),
    // false até a primeira escolha de Pokémon: até lá as funções ficam bloqueadas
    pokemonEscolhido: bool(cfg.pokemonEscolhido, false),
    fixado: bool(cfg.fixado, modelo.fixado), // sempre no topo
    aba: ABAS.has(cfg.aba) ? cfg.aba : 'sys', // última aba aberta
    janela: tamanhoValidoJanela(cfg.janela), // tamanho escolhido por você
    // cor da pokébola da tela de carregamento (a do último Pokémon; vermelha de início)
    corPokebola: typeof cfg.corPokebola === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.corPokebola) ? cfg.corPokebola : '#e3350d',
    apps: Array.isArray(cfg.apps) ? cfg.apps.map(sanitizarApp).filter(Boolean).slice(0, 64) : [],
  };
}

// Lê o modelo que acompanha o projeto
function lerModelo() {
  return JSON.parse(fs.readFileSync(ARQUIVO_MODELO, 'utf8'));
}

// Copia o modelo para o %APPDATA%. Lê e grava em vez de copyFileSync porque,
// no .exe, o modelo fica dentro do app.asar (que só dá para ler).
function copiarModelo() {
  fs.writeFileSync(ARQUIVO_CONFIG, fs.readFileSync(ARQUIVO_MODELO, 'utf8'), 'utf8');
}

// Na primeira execução copia o modelo para o %APPDATA%
function garantirConfig() {
  fs.mkdirSync(PASTA_CONFIG, { recursive: true });
  if (!fs.existsSync(ARQUIVO_CONFIG)) copiarModelo();
}

// Lê a config do usuário; se estiver corrompida, guarda uma cópia e recomeça do modelo
function carregarConfig() {
  garantirConfig();
  try {
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
    }
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
  const json = JSON.stringify(sanitizarConfig(cfg, lerModelo()), null, 2);
  if (json.length > MAX_CONFIG) throw new Error('Config grande demais');
  garantirConfig();
  const temporario = ARQUIVO_CONFIG + '.tmp';
  fs.writeFileSync(temporario, json, 'utf8');
  fs.renameSync(temporario, ARQUIVO_CONFIG);
  return true;
}

// Sem aceleração de hardware (padrão): medido no cenário B, CPU 15% -> 5% de
// 1 núcleo e -185 MB de memória privada (na época da janela transparente).
// O efeito varia por PC: "aceleracaoGPU": true religa.
// (A config é lida aqui, antes do app ficar pronto, porque depois não dá mais.)
if (!carregarConfig().aceleracaoGPU) app.disableHardwareAcceleration();

let modoAtual = 'normal';
let alturaAntesDoTerminal = null; // a aba term estica; ao sair, volta a esta altura
let tamanhoAntesDoMini = null;
let salvarTamanhoTimer = null;

function criarJanela() {
  // canto superior direito da tela principal (respeita a barra de tarefas)
  const area = screen.getPrimaryDisplay().workArea;
  const cfg = carregarConfig();
  const width = Math.min(cfg.janela.largura, area.width - 2 * MARGEM);
  const height = Math.min(cfg.janela.altura, area.height - 2 * MARGEM);

  janela = new BrowserWindow({
    x: area.x + area.width - width - MARGEM,
    y: area.y + MARGEM,
    width,
    height,
    minWidth: MIN.largura,
    minHeight: MIN.altura,
    maxWidth: MAX.largura,
    maxHeight: MAX.altura,
    // Opaca, como um CMD: sem frame do Windows (a barra de título é nossa), mas
    // com as bordas de redimensionar. Janela opaca também é mais leve de desenhar.
    frame: false,
    backgroundColor: '#0c0c0c',
    icon: path.join(__dirname, '..', 'assets', 'icone.ico'), // a pokébola cúbica vermelha (tools/gerar-icone.js)
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    // fixado: sempre no topo e fora da barra de tarefas. Solto: vai para trás das
    // outras janelas, então aparece na barra de tarefas (senão não teria como achar)
    alwaysOnTop: cfg.fixado,
    skipTaskbar: cfg.fixado,
    // aparece na hora: o fundo já é o preto da tela de carregamento (sem piscar branco)
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged, // ferramentas de desenvolvedor só ao rodar com "npm start"
      // necessário: o grito e a voz das boas-vindas tocam ao abrir, sem clique
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  janela.setMenuBarVisibility(false);
  janela.loadFile(path.join(__dirname, 'index.html')); // caminho absoluto: funciona de qualquer pasta
  janela.on('closed', () => { janela = null; });

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
}

// ---------- Módulo Sistema ----------
// A lista de processos vem do mesmo PowerShell persistente da música (comando
// "processos"); o si.processes() abria um PowerShell novo a cada chamada.
// Ela é atualizada a cada ~6 s, em segundo plano, e reaproveitada nas
// leituras de 3 s (que não esperam por ela).
const INTERVALO_PROCESSOS = 5500; // ms
const IGNORAR = new Set(['system idle process', 'idle', 'memory compression']); // pseudoprocessos do sistema

// "Relevante" = gasta algo perceptível: pelo menos CPU_MIN % da CPU do PC
// (0,3% de 16 núcleos ≈ 5% de um núcleo) ou RAM_MIN MB de memória.
const CPU_MIN = 0.3;   // % do total
const RAM_MIN = 200;   // MB
const MAX_PROCESSOS = 25;

let processosCache = [];
let ultimaLeituraProcessos = 0;
let lendoProcessos = false;
let primeiraLeituraProcessos = true;

// Soma processos de mesmo nome (vários chrome viram um só) e guarda só os relevantes.
// Cada item vem do media.ps1 como { n: nome, c: % do total da CPU, m: RAM em KB }.
function resumirProcessos(lista) {
  const grupos = new Map();
  for (const p of lista) {
    if (!p || typeof p.n !== 'string') continue;
    const chave = p.n.toLowerCase();
    if (IGNORAR.has(chave)) continue;
    let g = grupos.get(chave);
    if (!g) {
      g = { nome: p.n, cpu: 0, ram: 0 };
      grupos.set(chave, g);
    }
    g.cpu += Number(p.c) || 0;
    g.ram += (Number(p.m) || 0) / 1024; // KB -> MB
  }
  return [...grupos.values()]
    .filter((g) => g.cpu >= CPU_MIN || g.ram >= RAM_MIN)
    .sort((a, b) => b.cpu - a.cpu || b.ram - a.ram)
    .slice(0, MAX_PROCESSOS)
    .map((g) => ({ nome: g.nome, cpu: Math.round(g.cpu * 10) / 10, ram: Math.round(g.ram) }));
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
    if (Array.isArray(lista)) processosCache = resumirProcessos(lista);
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

// RAM via os (leitura direta, sem abrir PowerShell). os.freemem() no Windows
// é a memória "disponível", a mesma que o si.mem() chama de available.
async function lerStats() {
  const cfg = carregarConfig();
  const carga = await si.currentLoad();
  const economico = modoEconomico(cfg, carga.currentLoad);
  // no modo econômico a lista de processos é lida 3x menos
  if (Date.now() - ultimaLeituraProcessos >= INTERVALO_PROCESSOS * (economico ? 3 : 1)) {
    atualizarProcessos(); // sem await: não atrasa a resposta
    if (cfg.economiaAutomatica) atualizarTelaCheia();
  }
  const total = os.totalmem();
  return {
    ok: true,
    cpu: carga.currentLoad,
    ramTotal: total,
    ramUsada: total - os.freemem(), // usada = total - disponível
    processos: processosCache,
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

function iniciarServidorPS() {
  servidorPS = spawn('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_MIDIA, '-Action', 'servidor'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const meu = servidorPS;
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
    }
  });
  meu.stdin.on('error', () => { /* processo morreu; o 'exit' cuida */ });
  meu.on('exit', () => {
    if (servidorPS === meu) servidorPS = null;
    bufferSaida = '';
    for (const p of pendentes.splice(0)) { clearTimeout(p.timer); p.resolve(''); }
  });
}

// Manda um comando e devolve a linha de resposta ('' se falhar)
function pedirServidorPS(comando) {
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
  const caminho = caminhoCompleto(a.target);
  if (!fs.existsSync(caminho)) return 'caminho não existe: ' + caminho;
  return shell.openPath(caminho); // texto vazio = deu certo
});

ipcMain.handle('apps:icone', async (e, indice) => {
  if (!daJanela(e)) return null;
  const a = lerApp(indice);
  if (!a || a.type !== 'exe') return null;
  const caminho = caminhoCompleto(a.target);
  if (!fs.existsSync(caminho)) return null;
  if (iconesCache.has(caminho)) return iconesCache.get(caminho);
  try {
    const img = await app.getFileIcon(caminho, { size: 'large' });
    const url = img.isEmpty() ? null : img.toDataURL();
    iconesCache.set(caminho, url);
    return url;
  } catch {
    return null; // a tela mostra a inicial do nome
  }
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
ipcMain.on('janela:fechar', (e) => { if (daJanela(e)) app.quit(); });

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

// ---------- Terminal embutido ----------
// PowerShell real via ConPTY (@lydell/node-pty). Tudo local: a saída do shell
// vai por IPC direto para a janela; não há servidor nem porta aberta.
const pty = require('@lydell/node-pty');

let shellPty = null;     // só um shell por vez

// Tamanho do terminal: inteiros positivos dentro de um limite; senão, recusa
function tamanhoValido(cols, rows) {
  const ok = (n, max) => Number.isInteger(n) && n > 0 && n <= max;
  return ok(cols, 500) && ok(rows, 300) ? { cols, rows } : null;
}

function enviarParaTela(canal, ...args) {
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, ...args);
}

function encerrarShell() {
  if (!shellPty) return;
  try { shellPty.kill(); } catch { /* já tinha saído */ }
  shellPty = null;
}

// Abre o shell (se ainda não existe) no tamanho do terminal da tela
ipcMain.handle('term-start', (e, cols, rows) => {
  const t = tamanhoValido(cols, rows);
  if (!daJanela(e) || !t) return false;
  ({ cols, rows } = t);
  if (shellPty) {
    shellPty.resize(cols, rows);
    return 'existente'; // a sessão continua de onde estava
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // não vazar variáveis do Electron para o shell
  try {
    shellPty = pty.spawn('powershell.exe', ['-NoLogo'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env,
    });
  } catch (erro) {
    console.error('Falha ao abrir o PowerShell:', erro.message);
    return 'erro: ' + erro.message; // a tela mostra o motivo
  }
  const meu = shellPty;
  meu.onData((dados) => enviarParaTela('term-data', dados));
  meu.onExit(({ exitCode }) => {
    if (shellPty === meu) shellPty = null;
    enviarParaTela('term-exit', exitCode);
  });
  return 'novo';
});

ipcMain.on('term-input', (e, dados) => {
  if (!daJanela(e) || !shellPty || typeof dados !== 'string' || dados.length > 1e6) return;
  shellPty.write(dados);
});

ipcMain.on('term-resize', (e, cols, rows) => {
  const t = tamanhoValido(cols, rows);
  if (!daJanela(e) || !shellPty || !t) return;
  shellPty.resize(t.cols, t.rows);
});

// ---------- Janela: modos (normal / terminal / mini) e pin ----------
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
  if (!daJanela(e) || !['normal', 'terminal', 'mini'].includes(modo)) return false;
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
    const [l, a] = janela.getSize();
    if (modo === 'terminal' && a < ALTURA_TERMINAL) {
      // a aba term pede altura para o Claude Code; guarda a de antes
      alturaAntesDoTerminal = a;
      aplicarTamanho(l, ALTURA_TERMINAL);
    } else if (modo === 'normal' && alturaAntesDoTerminal !== null) {
      aplicarTamanho(l, alturaAntesDoTerminal);
      alturaAntesDoTerminal = null;
    }
  }
  modoAtual = modo;
  return true;
});

// Pin: fixado = sempre no topo e fora da barra de tarefas. Salva na config.
ipcMain.handle('janela:fixar', (e, fixar) => {
  if (!daJanela(e) || typeof fixar !== 'boolean') return null;
  janela.setAlwaysOnTop(fixar);
  janela.setSkipTaskbar(fixar);
  const cfg = carregarConfig();
  cfg.fixado = fixar;
  salvarConfig(cfg);
  return fixar;
});

// O shell e o servidor PowerShell morrem junto com o app
app.on('will-quit', () => {
  encerrarShell();
  encerrarServidorPS();
});

app.whenReady().then(() => {
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
