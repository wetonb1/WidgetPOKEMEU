// main.js — processo principal do Electron: cria a janela e cuida da config.
const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
const ABAS = new Set(['sys', 'music', 'apps', 'poke']);
const MAX_CONFIG = 1024 * 1024; // bytes (cabe um ícone próprio em cada app)
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
    boasVindas: {
      ativo: bool(bv.ativo, mbv.ativo),
      voz: bool(bv.voz, mbv.voz),
      chamar: texto(bv.chamar, 40).trim() || mbv.chamar,
    },
    appsSemeados: bool(cfg.appsSemeados, false),
    // false até a primeira escolha de Pokémon: até lá as funções ficam bloqueadas
    pokemonEscolhido: bool(cfg.pokemonEscolhido, false),
    fixado: bool(cfg.fixado, modelo.fixado), // sempre no topo
    aba: ABAS.has(cfg.aba) ? cfg.aba : 'sys', // última aba aberta
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
  janela.on('closed', () => { if (janela === esta) janela = null; });
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

async function lerStats() {
  const cfg = carregarConfig();
  const carga = { currentLoad: cargaCpu() };
  const economico = modoEconomico(cfg, carga.currentLoad);
  ultimoEconomico = economico;
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
    ramWidget: ramDoWidget(),
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
  janela.setAlwaysOnTop(fixar);
  janela.setSkipTaskbar(fixar);
  const cfg = carregarConfig();
  cfg.fixado = fixar;
  salvarConfig(cfg);
  return fixar;
});

// O medidor (ou o PowerShell de reserva) morre junto com o app
app.on('will-quit', () => {
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
