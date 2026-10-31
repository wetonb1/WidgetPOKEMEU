// renderer.js — lógica da tela (sem acesso direto ao Node; usa window.widget do preload).
// O widget é um terminal que o Pokémon "invadiu": ele manda nas abas e narra tudo.
const INTERVALO_STATS = 3000; // ms entre uma leitura e a próxima (o dobro no modo econômico)

// ---------- Desempenho ----------
// "economico" vem do main.js a cada leitura (config "desempenho" ou economia
// automática). As preferências vêm da config ao abrir (e da aba poke).
let economico = false;
const preferencias = { visualizador: true, animacoes: true };

let ultimoStats = null;
const GB = 1024 ** 3;
const um = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Tela de carregamento ----------
// A pokébola cúbica gira enquanto a barra enche pelas etapas reais da abertura
// (config, Pokémon, imagem). Fica no mínimo MINIMO ms (para a animação ser
// vista) e no máximo MAXIMO ms (sem internet, não trava). Depois sai da página.
const VERMELHO_POKEBOLA = '#e3350d';
const carregamento = (() => {
  const raiz = document.getElementById('carregando');
  const barra = document.getElementById('carregando-progresso');
  const texto = document.getElementById('carregando-texto');
  const MINIMO = 1800, MAXIMO = 12000;
  let inicio = null; // marcado no primeiro quadro: a janela nasce escondida e não anima antes disso
  let feito = false;
  let alvo = 0;       // quanto já carregou de verdade (%)
  let mostrado = 0;   // quanto a barra mostra (%)
  let aoEncher = null;
  const teto = setTimeout(() => terminar(), MAXIMO);
  // troca de visual (CMD <-> iOS) ou janela destacada do terminal: já entra pronta, sem esta tela
  const paramsUrl = new URLSearchParams(location.search);
  if (paramsUrl.has('rapido') || paramsUrl.has('destacado')) { feito = true; clearTimeout(teto); raiz.remove(); }

  // A barra corre suave atrás do progresso real, mas nunca mais rápido que o
  // tempo mínimo: assim ela sempre "enche" de forma visível, mesmo com tudo em cache.
  // (Só roda enquanto a tela existe, ~2 s.)
  (function quadro() {
    if (!raiz.isConnected) return;
    if (inicio === null) inicio = performance.now();
    const peloTempo = ((performance.now() - inicio) / MINIMO) * 100;
    mostrado += (Math.min(alvo, peloTempo) - mostrado) * 0.12;
    if (alvo >= 100 && mostrado > 99.4) mostrado = 100;
    barra.style.width = mostrado.toFixed(2) + '%';
    if (mostrado === 100 && aoEncher) { aoEncher(); aoEncher = null; }
    requestAnimationFrame(quadro);
  })();

  function etapa(pct, msg) {
    if (feito) return;
    alvo = Math.max(alvo, pct);
    if (msg) texto.textContent = msg;
  }

  async function terminar() {
    if (feito) return;
    feito = true;
    clearTimeout(teto);
    alvo = 100;
    await new Promise((ok) => { aoEncher = ok; });  // espera a barra chegar ao fim
    texto.textContent = 'C:\\> pronto!';
    raiz.classList.add('pronto');   // o botão acende e a pokébola dá um pulinho
    await esperar(450);
    raiz.classList.add('saindo');   // some devagar
    await esperar(380);
    raiz.remove();                  // fora da página: as animações param de vez
  }

  return {
    cor(c) { raiz.style.setProperty('--cor', c); },
    etapa,
    terminar,
  };
})();

// Lê a config do disco, aplica uma mudança e grava (não pisa nas outras chaves)
async function mudarConfig(mudanca) {
  const cfg = await window.widget.loadConfig();
  mudanca(cfg);
  await window.widget.saveConfig(cfg);
}

// ---------- Cor de destaque atual ----------
// Lida do CSS (--accent). Quando o tema mudar, chame atualizarAccent().
let accent = '#3ddc84';
function atualizarAccent() {
  accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || accent;
}
atualizarAccent();

// Ajusta o <canvas> à escala da tela (nítido em 125%, 150%…). Devolve o contexto e o tamanho em px CSS.
function prepararCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---------- Narrador ----------
// O Pokémon conversa com você: cada fala aparece letra por letra, como se ele
// estivesse digitando. Com muitas falas na fila (ou no modo econômico), escreve
// de uma vez. Guarda só as últimas linhas.
const narrador = (() => {
  const caixa = document.getElementById('narracao');
  const MAX_LINHAS = 8;
  const fila = [];
  let digitando = false;
  let quem = 'sistema';
  let ultima = '';

  async function escrever(texto) {
    const linha = document.createElement('div');
    linha.className = 'fala-linha';
    const nome = document.createElement('span');
    nome.className = 'quem';
    nome.textContent = quem + '> ';
    const corpo = document.createElement('span');
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    cursor.textContent = '_';
    linha.append(nome, corpo, cursor);
    caixa.append(linha);
    while (caixa.children.length > MAX_LINHAS) caixa.firstElementChild.remove();

    if (fila.length > 1 || economico) {
      corpo.textContent = texto;
    } else {
      // 2 letras a cada 22 ms: uma frase de 60 letras leva ~0,7 s
      for (let i = 2; i <= texto.length + 1; i += 2) {
        corpo.textContent = texto.slice(0, i);
        await esperar(22);
      }
    }
    cursor.remove();
  }

  async function proxima() {
    digitando = true;
    try {
      while (fila.length) await escrever(fila.shift());
    } finally {
      digitando = false;
    }
  }

  return {
    dizer(texto) {
      if (!texto || texto === ultima) return; // não repete a mesma fala seguida
      ultima = texto;
      fila.push(texto);
      if (!digitando) proxima();
    },
    // quem fala (o nome do Pokémon em minúsculas, ou "sistema" antes da escolha)
    falante(nome) { quem = nome; },
  };
})();
const dizer = (texto) => narrador.dizer(texto);
// fala por situação, no jeito de quem é o dono (falas.js): várias frases por evento
const falar = (evento, vars) => dizer(falas.texto(evento, vars));

// ---------- Cores ----------
// Mistura duas cores "#rrggbb" (t = 0 fica a primeira, t = 1 a segunda)
function misturarCor(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ---------- Visualizador de áudio ----------
// Captura o áudio do sistema (loopback) e desenha um espectro bonito:
//  - barras finas e arredondadas, em escala logarítmica (graves à esquerda);
//  - degradê na cor do Pokémon (mais clara no alto), com reflexo esmaecido embaixo;
//  - sobe rápido e desce suave; os picos flutuam e caem com gravidade;
//  - quando o grave "bate", as barras dão um pulinho e a base brilha;
//  - ao pausar, as barras caem devagar em vez de sumir.
// Só roda com a aba music aberta E música tocando (ou enquanto as barras caem).
// Depois de 10 s parado, a captura de áudio é desligada. 30 quadros/s (15 no econômico).
const visualizador = (() => {
  const LARGURA_BARRA = 5, VAO = 3;                   // px
  const QUADRO_MS = 1000 / 30, QUADRO_MS_ECONOMICO = 1000 / 15;
  const SUBIDA = 0.6, DESCIDA = 0.16, GRAVIDADE = 0.0028;
  const canvas = document.getElementById('visualizador');
  const DESLIGAR_APOS = 10000; // ms sem música (ou com a aba fechada) até desligar a captura

  let ctx = null, largura = 0, altura = 0, barras = 0, base = 0, alturaMax = 0;
  let audioCtx = null, analisador = null, dados = null, stream = null;
  let iniciando = false, falhou = false;
  let musicaTocando = false, abaVisivel = false, deveRodar = false;
  let rodando = false, caindo = false, ultimoQuadro = 0, desligarTimer = null;
  let niveis = [], picos = [], quedas = [];
  let mediaGrave = 0, batida = 0;
  let pinturaCor = null, degradeBarra = null, degradeReflexo = null, corPico = '#ffffff';

  function medir() {
    ({ ctx, w: largura, h: altura } = prepararCanvas(canvas));
    barras = Math.max(8, Math.floor((largura + VAO) / (LARGURA_BARRA + VAO)));
    alturaMax = Math.round(altura * 0.74);  // o resto é o reflexo
    base = alturaMax + 1;
    niveis = new Array(barras).fill(0);
    ganhos = new Array(barras).fill(0);
    picos = new Array(barras).fill(0);
    quedas = new Array(barras).fill(0);
    pinturaCor = null; // refaz os degradês
  }

  // degradês feitos uma vez por cor (não a cada quadro)
  function prepararCores() {
    if (pinturaCor === accent) return;
    pinturaCor = accent;
    const clara = misturarCor(accent, '#ffffff', 0.45);
    const escura = misturarCor(accent, '#000000', 0.45);
    degradeBarra = ctx.createLinearGradient(0, base - alturaMax, 0, base);
    degradeBarra.addColorStop(0, clara);
    degradeBarra.addColorStop(0.45, accent);
    degradeBarra.addColorStop(1, escura);
    degradeReflexo = ctx.createLinearGradient(0, base, 0, altura);
    // some para o transparente: fica certo no fundo preto (CMD) e no vidro (iOS)
    degradeReflexo.addColorStop(0, accent + '70');
    degradeReflexo.addColorStop(1, accent + '00');
    corPico = misturarCor(accent, '#ffffff', 0.7);
  }

  // valor de uma barra: escala logarítmica (graves à esquerda), com interpolação
  // entre as faixas. Mistura o valor "natural" com um ganho automático por barra
  // (cada uma se compara com o próprio máximo recente): o espectro todo dança
  // em qualquer música, sem perder o formato (graves mais fortes).
  let ganhos = [];
  function valorDaBarra(i) {
    const t = i / (barras - 1);
    const min = 2, max = dados.length * 0.5;          // ~190 Hz até ~12 kHz
    const pos = min * Math.pow(max / min, t);
    const a = Math.floor(pos), f = pos - a;
    const v = (dados[a] * (1 - f) + (dados[a + 1] || 0) * f) / 255;
    const natural = v * (0.85 + t * 0.9);              // agudos são mais fracos: compensa
    ganhos[i] = Math.max(v, (ganhos[i] || 0) * 0.994); // máximo recente (cai devagar)
    const relativo = v / Math.max(ganhos[i], 0.18);
    return Math.min(1, Math.pow(natural * 0.55 + relativo * 0.45, 1.25));
  }

  function desenhar() {
    prepararCores();
    ctx.clearRect(0, 0, largura, altura);
    const salto = 1 + batida * 0.1;
    for (let i = 0; i < barras; i++) {
      const x = i * (LARGURA_BARRA + VAO);
      const h = Math.max(2, niveis[i] * alturaMax * salto);
      // barra
      ctx.fillStyle = degradeBarra;
      ctx.beginPath();
      ctx.roundRect(x, base - h, LARGURA_BARRA, h, [3, 3, 1, 1]);
      ctx.fill();
      // reflexo (mais curto e esmaecido)
      const hr = Math.min(altura - base - 1, h * 0.45);
      if (hr > 1) {
        ctx.fillStyle = degradeReflexo;
        ctx.fillRect(x, base + 2, LARGURA_BARRA, hr);
      }
      // pico flutuante
      if (picos[i] > niveis[i] + 0.02) {
        const yp = base - picos[i] * alturaMax * salto - 4;
        ctx.globalAlpha = Math.min(1, picos[i] * 1.6);
        ctx.fillStyle = corPico;
        ctx.beginPath();
        ctx.roundRect(x, yp, LARGURA_BARRA, 2, 1);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // linha de base que acende na batida
    if (batida > 0.04) {
      ctx.globalAlpha = batida * 0.7;
      ctx.fillStyle = corPico;
      ctx.fillRect(0, base, largura, 1);
      ctx.globalAlpha = 1;
    }
  }

  // parado: uma fileira de "grãos" apagados, sem animação
  function desenharApagado() {
    if (!ctx) return;
    ctx.clearRect(0, 0, largura, altura);
    ctx.fillStyle = '#262626';
    for (let i = 0; i < barras; i++) {
      ctx.beginPath();
      ctx.roundRect(i * (LARGURA_BARRA + VAO), base - 2, LARGURA_BARRA, 2, 1);
      ctx.fill();
    }
  }

  // Libera a captura e o AudioContext (a próxima música pede de novo)
  function desligarCaptura() {
    desligarTimer = null;
    if (deveRodar || !audioCtx) return;
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close().catch((erro) => console.error('AudioContext:', erro));
    audioCtx = analisador = dados = stream = null;
  }

  async function iniciarCaptura() {
    if (audioCtx || iniciando || falhou) return;
    iniciando = true;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop()); // só queremos o áudio
      if (stream.getAudioTracks().length === 0) throw new Error('captura sem trilha de áudio');
      // sem dispositivo de saída: não toca nada e evita erro/custo do driver
      audioCtx = new AudioContext({ sinkId: { type: 'none' } });
      const fonte = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      analisador = audioCtx.createAnalyser();
      analisador.fftSize = 512;               // 256 faixas: detalhe para a escala logarítmica
      analisador.smoothingTimeConstant = 0.5; // a suavização "bonita" é feita aqui no desenho
      analisador.minDecibels = -82;
      analisador.maxDecibels = -18; // folga em cima: as barras não ficam "batendo no teto"
      fonte.connect(analisador); // NÃO conecta ao destination: nada de eco
      dados = new Uint8Array(analisador.frequencyBinCount);
    } catch (erro) {
      falhou = true; // o widget segue normal, só sem visualizador
      console.error('Visualizador indisponível:', erro);
    } finally {
      iniciando = false;
      atualizarLoop();
    }
  }

  function quadro(agora) {
    if (!rodando) return;
    requestAnimationFrame(quadro);
    if (agora - ultimoQuadro < (economico ? QUADRO_MS_ECONOMICO : QUADRO_MS)) return;
    ultimoQuadro = agora;

    const comSom = deveRodar && analisador;
    if (comSom) analisador.getByteFrequencyData(dados);
    let ativo = false;
    for (let i = 0; i < barras; i++) {
      const alvo = comSom ? valorDaBarra(i) : 0;
      // sobe rápido (ataque) e desce suave (decaimento)
      niveis[i] += (alvo - niveis[i]) * (alvo > niveis[i] ? SUBIDA : DESCIDA);
      // o pico sobe junto e depois cai com gravidade (acelerando)
      if (niveis[i] >= picos[i]) { picos[i] = niveis[i]; quedas[i] = 0; }
      else { quedas[i] += GRAVIDADE; picos[i] = Math.max(niveis[i], picos[i] - quedas[i]); }
      if (niveis[i] > 0.01 || picos[i] > 0.01) ativo = true;
    }
    // batida: o grave passou bem da média recente
    if (comSom) {
      const grave = (niveis[0] + niveis[1] + niveis[2] + niveis[3]) / 4;
      if (grave > mediaGrave * 1.35 && grave > 0.3 && batida < 0.3) batida = 1;
      mediaGrave = mediaGrave * 0.92 + grave * 0.08;
    }
    batida *= 0.86;
    desenhar();

    // pausou: deixa as barras caírem e só então para de desenhar
    if (!comSom && !ativo) {
      rodando = caindo = false;
      desenharApagado();
      if (audioCtx && !deveRodar) audioCtx.suspend().catch((erro) => console.error('AudioContext:', erro));
    }
  }

  // Liga o desenho só quando faz sentido; desliga a captura depois de um tempo parado
  function atualizarLoop() {
    deveRodar = musicaTocando && abaVisivel && preferencias.visualizador;
    if (deveRodar) {
      clearTimeout(desligarTimer);
      desligarTimer = null;
      if (!audioCtx) { iniciarCaptura(); return; }
    } else if (audioCtx && !desligarTimer) {
      desligarTimer = setTimeout(desligarCaptura, DESLIGAR_APOS);
    }
    if (deveRodar && analisador && !rodando) {
      rodando = true;
      caindo = false;
      audioCtx.resume().catch((erro) => console.error('AudioContext:', erro));
      requestAnimationFrame(quadro);
    } else if (!deveRodar && rodando && !caindo) {
      // continua mais um pouco só para as barras caírem (o quadro para sozinho)
      caindo = abaVisivel;
      if (!caindo) { rodando = false; desenharApagado(); }
    }
  }

  // a área cresce com a janela: remede quando o canvas muda de tamanho
  new ResizeObserver(() => {
    if (!abaVisivel || canvas.clientWidth === 0) return;
    medir();
    if (!rodando) desenharApagado();
  }).observe(canvas);

  return {
    tocando(t) { musicaTocando = t; atualizarLoop(); },
    visivel(v) {
      abaVisivel = v;
      if (v) { medir(); if (!rodando) desenharApagado(); }
      atualizarLoop();
    },
    // "visualizador": false some com o canvas (fica só o volume)
    ligado(sim) { canvas.classList.toggle('oculto', !sim); atualizarLoop(); },
  };
})();

// ---------- Volume do Windows ----------
// Barra vertical: arraste (ou clique), rodinha do mouse, setas do teclado. O ícone
// liga/desliga o mudo. A barra acompanha na hora (sem esperar o Windows) e os
// pedidos são agrupados: se você arrasta rápido, só o último valor é enviado.
const volume = (() => {
  const raiz = document.getElementById('vol');
  const trilho = document.getElementById('vol-trilho');
  const icone = document.getElementById('vol-icone');
  const bolha = document.getElementById('vol-bolha');
  const svgAlto = document.getElementById('vol-alto');
  const svgMudo = document.getElementById('vol-mudo');

  let valor = 0;          // 0 a 100
  let mudo = false;
  let arrastando = false;
  let ultimoToque = 0;    // quando você mexeu pela última vez (ms)
  let enviando = false;
  let pendente = null;    // último valor ainda não enviado
  let timerBolha = null;
  let timerFala = null;

  function desenhar() {
    raiz.style.setProperty('--v', valor / 100);
    raiz.classList.toggle('mudo', mudo);
    bolha.textContent = mudo ? 'mudo' : valor + '%';
    trilho.setAttribute('aria-valuenow', valor);
    const semSom = mudo || valor === 0;
    svgAlto.classList.toggle('oculto', semSom);
    svgMudo.classList.toggle('oculto', !semSom);
    icone.title = mudo ? 'Tirar do mudo' : 'Mudo';
  }

  // mostra o balão por um instante (rodinha, teclado, soltar o mouse)
  function mostrarBolha(ms = 900) {
    raiz.classList.add('ativo');
    clearTimeout(timerBolha);
    timerBolha = setTimeout(() => { if (!arrastando) raiz.classList.remove('ativo'); }, ms);
  }

  // o Pokémon comenta o volume quando você para de mexer
  function narrarDepois() {
    clearTimeout(timerFala);
    timerFala = setTimeout(() => {
      if (valor === 0) dizer('Volume no zero. Silêncio total por aqui.');
      else if (valor >= 90) dizer(`Volume em ${valor}%! Meus ouvidos...`);
      else dizer(`Volume em ${valor}%.`);
    }, 1200);
  }

  // Envia só o valor mais recente, um pedido por vez
  async function enviar() {
    if (enviando) return;
    enviando = true;
    try {
      while (pendente !== null) {
        const v = pendente;
        pendente = null;
        const r = await window.widget.setVolume(v);
        if (r && pendente === null && !arrastando) { valor = r.v; mudo = r.m; desenhar(); }
      }
    } catch (erro) {
      console.error('Erro ao ajustar o volume:', erro);
    } finally {
      enviando = false;
    }
  }

  function definir(v) {
    valor = Math.max(0, Math.min(100, Math.round(v)));
    if (valor > 0) mudo = false; // como no Windows, subir o volume tira do mudo
    ultimoToque = Date.now();
    desenhar();
    pendente = valor;
    enviar();
    narrarDepois();
  }

  const valorDoPonteiro = (e) => {
    const r = trilho.getBoundingClientRect();
    return (1 - (e.clientY - r.top) / r.height) * 100;
  };

  trilho.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    trilho.setPointerCapture(e.pointerId);
    arrastando = true;
    trilho.classList.add('arrastando');
    raiz.classList.add('ativo');
    trilho.focus({ preventScroll: true });
    definir(valorDoPonteiro(e));
  });
  trilho.addEventListener('pointermove', (e) => { if (arrastando) definir(valorDoPonteiro(e)); });
  const soltar = () => {
    if (!arrastando) return;
    arrastando = false;
    ultimoToque = Date.now();
    trilho.classList.remove('arrastando');
    mostrarBolha(700);
  };
  trilho.addEventListener('pointerup', soltar);
  trilho.addEventListener('pointercancel', soltar);

  // rodinha: 2% por clique (1% com Shift). Vale sobre o ícone e a barra.
  raiz.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    definir(valor + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 2));
    mostrarBolha();
  }, { passive: false });

  // teclado: setas 2%, PageUp/PageDown 10%, Home/End 0 e 100
  trilho.addEventListener('keydown', (e) => {
    const passos = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 10, PageDown: -10 };
    if (e.key in passos) definir(valor + passos[e.key]);
    else if (e.key === 'Home') definir(0);
    else if (e.key === 'End') definir(100);
    else return;
    e.preventDefault();
    mostrarBolha();
  });

  icone.addEventListener('click', async () => {
    mudo = !mudo;
    ultimoToque = Date.now();
    desenhar();
    mostrarBolha();
    falar(mudo ? 'mudoOn' : 'mudoOff');
    try {
      const r = await window.widget.setMudo(mudo);
      if (r) { valor = r.v; mudo = r.m; desenhar(); }
    } catch (erro) {
      console.error('Erro ao mudar o mudo:', erro);
    }
  });

  return {
    // Lê o volume do Windows (mudou pelo teclado ou por outro app?). Não mexe
    // enquanto você está usando a barra, para ela não "pular".
    async sincronizar() {
      if (arrastando || enviando || pendente !== null || Date.now() - ultimoToque < 1500) return;
      const r = await window.widget.getVolume();
      if (!r || arrastando || enviando || pendente !== null) return;
      if (r.v !== valor || r.m !== mudo) { valor = r.v; mudo = r.m; desenhar(); }
    },
  };
})();

// ---------- Música ----------
const INTERVALO_MUSICA = 2000; // ms

const musica = (() => {
  const el = {
    capa: document.getElementById('mus-capa'),
    titulo: document.getElementById('mus-titulo'),
    artista: document.getElementById('mus-artista'),
    icoPlay: document.getElementById('ico-play'),
    icoPause: document.getElementById('ico-pause'),
    status: document.getElementById('st-musica'),
  };
  let atual = '';       // "título|artista" da última faixa desenhada
  let primeira = true;  // a primeira faixa detectada não é narrada como "troca"
  let visivel = false;

  function desenharPlayPause(tocando) {
    visualizador.tocando(tocando);
    el.icoPlay.classList.toggle('oculto', tocando);
    el.icoPause.classList.toggle('oculto', !tocando);
  }

  function desenhar(info) {
    if (!info.title) {
      // nada tocando (ou erro do PowerShell, que chega como {})
      el.titulo.textContent = 'nada tocando';
      el.titulo.removeAttribute('title');
      el.artista.textContent = '';
      el.capa.classList.add('oculto');
      el.capa.removeAttribute('src');
      el.status.textContent = '♪ --';
      desenharPlayPause(false);
      atual = '';
      return;
    }
    el.titulo.textContent = info.title;
    el.titulo.title = info.title; // tooltip com o nome inteiro
    el.artista.textContent = info.artist || '';
    el.status.textContent = (info.status === 'Playing' ? '♪ ' : '❚❚ ') + info.title + (info.artist ? ' — ' + info.artist : '');
    desenharPlayPause(info.status === 'Playing');
  }

  // setTimeout recursivo: o próximo ciclo só é agendado depois que o atual termina
  async function ciclo() {
    try {
      let info = await window.widget.mediaInfo(false);
      const chave = info.title ? info.title + '|' + info.artist : '';
      if (chave && chave !== atual) {
        // faixa nova: pede de novo, agora com a capa (só nessa hora)
        const comCapa = await window.widget.mediaInfo(true);
        if (comCapa.title) info = comCapa;
        if (info.thumb) {
          el.capa.src = info.thumb;
          el.capa.classList.remove('oculto');
        } else {
          el.capa.classList.add('oculto');
        }
        if (!primeira && info.status === 'Playing') {
          falar('musica', { faixa: info.title, de: info.artist ? ', de ' + info.artist : '' });
        }
        primeira = false;
        atual = chave;
      }
      desenhar(info);
      if (visivel) await volume.sincronizar(); // o volume só importa com a aba aberta
    } catch (erro) {
      console.error('Erro ao ler música:', erro);
    } finally {
      setTimeout(ciclo, INTERVALO_MUSICA * (economico ? 2 : 1));
    }
  }

  // Botões: o ícone de play/pause troca na hora (o próximo ciclo confirma)
  const comando = (acao) => window.widget.mediaCmd(acao).catch((erro) => console.error('Comando de mídia:', erro));
  document.getElementById('mus-prev').addEventListener('click', () => {
    if (!atual) { dizer('Não tem nada tocando para voltar.'); return; }
    falar('anterior');
    comando('prev');
  });
  document.getElementById('mus-next').addEventListener('click', () => {
    if (!atual) { dizer('Não tem nada tocando para pular.'); return; }
    falar('proxima');
    comando('next');
  });
  document.getElementById('mus-play').addEventListener('click', () => {
    if (!atual) { dizer('Abre o Spotify (ou um vídeo) que eu controlo daqui.'); return; }
    const estavaPausado = !el.icoPlay.classList.contains('oculto');
    desenharPlayPause(estavaPausado);
    falar(estavaPausado ? 'tocar' : 'pausar');
    comando('playpause');
  });

  return {
    iniciar: ciclo,
    visivel(v) {
      visivel = v;
      visualizador.visivel(v);
      if (v) volume.sincronizar().catch((erro) => console.error('Volume:', erro));
    },
  };
})();

// ---------- Sistema ----------
const sistema = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    cpuValor: $('cpu-valor'), ramValor: $('ram-valor'), cpuBarra: $('cpu-barra'), ramBarra: $('ram-barra'), ramTexto: $('ram-texto'),
    stCpu: $('st-cpu'), stRam: $('st-ram'), stWidget: $('st-widget'), stModo: $('st-modo'),
    lista: $('tm-lista'), busca: $('tm-busca'), aviso: $('tm-aviso'), colunas: [...document.querySelectorAll('.tm-col')],
    vistas: [...document.querySelectorAll('.tm-vista')], nApps: $('tm-n-apps'), nProcs: $('tm-n-procs'),
  };
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const INTERVALO_TM = 3000; // a lista do Gerenciador só é lida com a aba aberta (6 s no modo econômico)
  let vista = 'apps'; // apps | procs
  let ordem = { apps: 'cpu', procs: 'cpu' };
  let dados = { apps: [], procs: [] };
  let visivel = false;
  let economicoAntes = false;
  let timerTM = null;
  let lendo = false;
  let confirmando = null; // id do processo esperando o 2º clique em [encerrar]
  let pendentes = new Map(); // id -> momento em que pedi para fechar (se continuar aberto, oferece forçar)

  // Barra sólida (0–100%); vermelha acima de 85%
  function desenharBarra(barra, valor, pct) {
    const p = Math.max(0, Math.min(100, pct));
    barra.style.width = p + '%';
    barra.classList.toggle('alta', p > 85);
    valor.textContent = Math.round(p) + '%';
  }
  const mem = (mb) => (mb >= 1024 ? um(mb / 1024) + ' GB' : mb + ' MB');
  const botaoTM = (rotulo, aoClicar, titulo, classe) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'botao-cmd' + (classe ? ' ' + classe : '');
    b.textContent = IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo;
    if (titulo) b.title = titulo;
    b.addEventListener('click', aoClicar);
    return b;
  };
  const aviso = (t) => { el.aviso.textContent = t || ''; };

  // ----- a lista -----
  function filtrada() {
    const f = el.busca.value.trim().toLowerCase();
    const o = ordem[vista];
    const cmp = { cpu: (a, b) => b.cpu - a.cpu || b.ram - a.ram, ram: (a, b) => b.ram - a.ram || b.cpu - a.cpu, nome: (a, b) => a.nome.localeCompare(b.nome) }[o];
    return dados[vista].filter((x) => !f || x.nome.toLowerCase().includes(f) || x.titulo.toLowerCase().includes(f)).sort(cmp);
  }
  function linha(x) {
    const li = document.createElement('li');
    li.dataset.id = x.id;
    const nome = document.createElement('span');
    nome.className = 'tm-nome';
    nome.textContent = x.nome;
    nome.title = x.nome + (x.titulo ? ' · ' + x.titulo : '');
    if (vista === 'apps' && x.titulo && x.titulo !== x.nome) { const t = document.createElement('span'); t.className = 'tm-titulo'; t.textContent = x.titulo; nome.append(t); }
    if (vista === 'procs' && x.n > 1) { const q = document.createElement('span'); q.className = 'tm-qtd'; q.textContent = '(' + x.n + ')'; nome.append(q); }
    const cpu = document.createElement('span');
    cpu.className = 'tm-num' + (ordem[vista] === 'cpu' ? ' forte' : '') + (x.cpu >= 10 ? ' alto' : '');
    cpu.textContent = x.cpu >= 0.1 ? um(x.cpu) + '%' : '-';
    const ram = document.createElement('span');
    ram.className = 'tm-num' + (ordem[vista] === 'ram' ? ' forte' : '') + (x.ram >= 2048 ? ' alto' : '');
    ram.textContent = mem(x.ram);
    const acao = document.createElement('span');
    acao.className = 'tm-acao';
    if (x.protegido) {
      const p = document.createElement('span');
      p.className = 'tm-protegido';
      p.textContent = 'sistema';
      p.title = 'É do Windows ou do próprio widget: não dá para fechar daqui';
      acao.append(p);
    } else if (vista === 'apps') {
      const pediu = pendentes.has(x.id) && Date.now() - pendentes.get(x.id) > 3500;
      acao.append(pediu ? botaoTM('[forçar]', () => encerrar(x), 'Não fechou? Encerra à força (o que não foi salvo se perde)', 'perigo')
        : botaoTM('[fechar]', () => fechar(x), 'Pede para o programa fechar (ele pode perguntar se você quer salvar)'));
    } else {
      acao.append(confirmando === x.id ? botaoTM('[certeza?]', () => encerrar(x), 'Clique de novo para encerrar à força', 'perigo')
        : botaoTM('[encerrar]', () => { confirmando = x.id; desenharLista(); setTimeout(() => { if (confirmando === x.id) { confirmando = null; desenharLista(); } }, 3500); },
          'Encerra à força (pede uma confirmação)'));
    }
    li.append(nome, cpu, ram, acao);
    return li;
  }
  function desenharLista() {
    el.vistas.forEach((b) => b.classList.toggle('ativa', b.dataset.vista === vista));
    el.colunas.forEach((b) => b.classList.toggle('ativa', b.dataset.ordem === ordem[vista]));
    el.nApps.textContent = dados.apps.length ? '(' + dados.apps.length + ')' : '';
    el.nProcs.textContent = dados.procs.length ? '(' + dados.procs.length + ')' : '';
    const itens = filtrada();
    if (!itens.length) {
      const li = document.createElement('li');
      li.className = 'tm-vazio';
      li.textContent = dados.apps.length + dados.procs.length ? 'nada encontrado' : 'coletando…';
      el.lista.replaceChildren(li);
      return;
    }
    const rolagem = el.lista.scrollTop;
    el.lista.replaceChildren(...itens.map(linha));
    el.lista.scrollTop = rolagem;
  }
  async function ler() {
    if (lendo) return;
    lendo = true;
    try {
      const r = await window.widget.sysLista();
      if (r && r.ok) {
        dados = { apps: r.apps, procs: r.procs };
        for (const id of [...pendentes.keys()]) if (!r.apps.some((a) => a.id === id)) pendentes.delete(id);
        desenharLista();
      }
    } catch (erro) { console.error('Erro ao ler a lista de tarefas:', erro); } finally { lendo = false; }
  }
  function ciclo() {
    clearTimeout(timerTM);
    timerTM = null;
    if (!visivel) return;
    ler().finally(() => { if (visivel) timerTM = setTimeout(ciclo, INTERVALO_TM * (economico ? 2 : 1)); });
  }

  // ----- ações -----
  async function fechar(x) {
    pendentes.set(x.id, Date.now());
    aviso(`Pedi para "${x.nome}" fechar. Se ele perguntar se quer salvar, a pergunta aparece na janela dele.`);
    const r = await window.widget.sysFecharApp(x.id);
    if (!r.ok) { aviso(r.erro); pendentes.delete(x.id); return; }
    setTimeout(() => { if (visivel) ler(); }, 1200);
    setTimeout(() => { if (visivel) desenharLista(); }, 3700); // passou o prazo: se ainda está aberto, aparece [forçar]
  }
  async function encerrar(x) {
    confirmando = null;
    const r = await window.widget.sysEncerrar(x.id);
    aviso(r.ok ? `"${x.nome}" encerrado.` : r.erro);
    setTimeout(() => { if (visivel) ler(); }, 700);
  }

  // ----- fechar todos os apps -----
  const dlg = { raiz: $('tm-dialogo'), titulo: $('tm-titulo'), texto: $('tm-texto'), itens: $('tm-itens'), erro: $('tm-dlg-erro'), botoes: $('tm-botoes') };
  const fecharDlg = () => dlg.raiz.classList.add('oculto');
  const btnDlg = (rotulo, acao, principal) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = rotulo;
    if (principal) b.className = 'principal';
    b.addEventListener('click', acao);
    return b;
  };
  function mostrarDlg(titulo, texto, itens, botoes) {
    dlg.titulo.textContent = titulo;
    dlg.texto.textContent = texto;
    dlg.erro.textContent = '';
    dlg.itens.classList.toggle('oculto', !itens.length);
    dlg.itens.replaceChildren(...itens);
    dlg.botoes.replaceChildren(...botoes);
    dlg.raiz.classList.remove('oculto');
    const p = dlg.botoes.querySelector('.principal');
    if (p) p.focus();
  }
  async function fecharTodos() {
    const r = await window.widget.sysFecharTodosPrever();
    if (!r.ok) { aviso(r.erro || 'não consegui listar'); return; }
    if (!r.apps.length) {
      mostrarDlg('Nenhum app para fechar', 'Não há programas abertos que dê para fechar daqui.', [], [btnDlg('ok', fecharDlg, true)]);
      return;
    }
    const caixas = r.apps.map((a) => {
      const l = document.createElement('label');
      l.className = 'caixa';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = true;
      c.value = a.id;
      const t = document.createElement('span');
      t.textContent = a.nome;
      const sub = document.createElement('span');
      sub.className = 'tm-titulo';
      sub.textContent = a.titulo && a.titulo !== a.nome ? a.titulo.slice(0, 48) : '';
      l.append(c, t, sub);
      return l;
    });
    const nota = r.ignorados.length ? ` Ficam de fora (do Windows ou deste widget): ${[...new Set(r.ignorados)].join(', ')}.` : '';
    const confirmarBtn = btnDlg('', async () => {
      const ids = caixas.map((l) => l.querySelector('input')).filter((c) => c.checked).map((c) => c.value);
      if (!ids.length) { dlg.erro.textContent = 'marque pelo menos um app'; return; }
      dlg.botoes.replaceChildren(document.createElement('span'));
      dlg.botoes.firstChild.className = 'sub';
      dlg.botoes.firstChild.textContent = 'Pedindo para fechar...';
      const res = await window.widget.sysFecharTodos(ids);
      if (!res.ok) { mostrarDlg('Não deu', res.erro || 'tente de novo', [], [btnDlg('ok', fecharDlg, true)]); return; }
      const sobraram = res.restantes.map((a) => (a.titulo && a.titulo !== a.nome ? `${a.nome} (${a.titulo.slice(0, 40)})` : a.nome));
      for (const a of res.restantes) pendentes.set(a.id, Date.now() - 4000); // já pedi faz tempo: se continua aberto, oferece [forçar]
      mostrarDlg(sobraram.length ? 'Quase tudo fechado' : 'Tudo fechado', `${res.fechados} de ${res.pedidos} apps fecharam.`
        + (sobraram.length ? ` Ainda abertos: ${sobraram.join(', ')}. Eles podem estar perguntando se você quer salvar: olhe as janelas deles. Para forçar, use [forçar] na lista.` : ''),
        [], [btnDlg('ok', () => { fecharDlg(); ler(); }, true)]);
      dizer(sobraram.length ? 'Fechei o que dava. Alguns apps estão pedindo para salvar!' : 'Pronto, tudo fechado!');
    }, true);
    const atualizarRotulo = () => { const n = caixas.filter((l) => l.querySelector('input').checked).length; confirmarBtn.textContent = `fechar ${n} app${n === 1 ? '' : 's'}`; };
    caixas.forEach((l) => l.querySelector('input').addEventListener('change', atualizarRotulo));
    atualizarRotulo();
    mostrarDlg('Fechar todos os apps?', 'Cada app recebe um pedido para fechar e pode perguntar se você quer salvar o que está aberto. Desmarque o que quiser manter.' + nota, caixas,
      [btnDlg('cancelar', fecharDlg), confirmarBtn]);
  }

  // ----- ligações da tela -----
  el.vistas.forEach((b) => b.addEventListener('click', () => { vista = b.dataset.vista; confirmando = null; desenharLista(); }));
  el.colunas.forEach((b) => b.addEventListener('click', () => { ordem[vista] = b.dataset.ordem; desenharLista(); }));
  el.busca.addEventListener('input', desenharLista);
  $('tm-fechar-todos').addEventListener('click', fecharTodos);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && visivel && !dlg.raiz.classList.contains('oculto')) fecharDlg(); });

  // Detalhes da aba (medidores) + linha de status (sempre) + reação do Pokémon
  function desenharAba(s) {
    const pctRam = (s.ramUsada / s.ramTotal) * 100;
    desenharBarra(el.cpuBarra, el.cpuValor, s.cpu);
    desenharBarra(el.ramBarra, el.ramValor, pctRam);
    el.ramTexto.textContent = `${um(s.ramUsada / GB)} / ${um(s.ramTotal / GB)} GB de memória em uso`;
  }
  function desenhar(s) {
    el.stCpu.textContent = `cpu ${Math.round(s.cpu)}%`;
    el.stCpu.classList.toggle('alta', s.cpu > 85);
    el.stRam.textContent = `ram ${um(s.ramUsada / GB)}G`;
    if (s.ramWidget > 0) el.stWidget.textContent = `widget ${Math.round(s.ramWidget / 1048576)} MB`;
    el.stModo.classList.toggle('oculto', !economico);
    if (economico !== economicoAntes) {
      dizer(economico
        ? 'Seu PC está pesado (ou tem algo em tela cheia). Vou economizar energia.'
        : 'Tudo tranquilo de novo. Voltei ao normal!');
      economicoAntes = economico;
    }
    pokemon.cpu(s.cpu);
    if (visivel) desenharAba(s);
  }

  // setTimeout recursivo: nada se acumula se o PC estiver lento; erro não derruba o loop
  async function cicloStats() {
    try {
      const s = await window.widget.getStats();
      if (s && s.ok) {
        ultimoStats = s;
        economico = s.economico === true;
        desenhar(s);
      }
    } catch (erro) {
      console.error('Erro ao atualizar stats:', erro);
    } finally {
      setTimeout(cicloStats, INTERVALO_STATS * (economico ? 2 : 1));
    }
  }

  return {
    iniciar: cicloStats,
    visivel(v) {
      visivel = v;
      if (!v) { clearTimeout(timerTM); timerTM = null; fecharDlg(); return; } // fora da aba, a lista não é lida
      if (ultimoStats) desenharAba(ultimoStats);
      desenharLista();
      ciclo();
    },
  };
})();

// ---------- Pokémon ----------
// Busca na PokéAPI (fetch na própria tela), aplica o tema do tipo principal,
// mostra o rosto em dot matrix e o nome em LED. Nenhuma imagem é salva.
// Na primeira vez (pokemonEscolhido: false) o widget fica bloqueado até a escolha.
const pokemon = (() => {
  const el = {
    tela: document.getElementById('poke-tela'),
    img: document.getElementById('poke-img'),
    anim: document.getElementById('poke-anim'), // invólucro que se move nas animações
    vazio: document.getElementById('poke-vazio'),
    nome: document.getElementById('poke-nome'),
    num: document.getElementById('poke-num'),
    tipos: document.getElementById('poke-tipos'),
    form: document.getElementById('poke-form'),
    busca: document.getElementById('poke-busca'),
    fav: document.getElementById('poke-fav'),
    shiny: document.getElementById('poke-shiny'),
    favs: document.getElementById('poke-favs'),
    bloqForm: document.getElementById('bloq-form'),
    bloqBusca: document.getElementById('bloq-busca'),
    sugestoes: document.getElementById('bloq-sugestoes'),
    resultados: document.getElementById('poke-resultados'),
    bloqResultados: document.getElementById('bloq-resultados'),
  };
  const API = 'https://pokeapi.co/api/v2/pokemon/';
  const CPU_ALTA = 85; // % a partir do qual o Pokémon "sua"

  // atual: Pokémon { fonte: 'pokemon', id, slug, nome, tipos, sprites }
  //        anime   { fonte: 'anilist', id, slug, nome, tipos: [], sprites: null, imagem, cor }
  let atual = null;
  let escolhido = false; // já escolheu um Pokémon alguma vez?
  let usarShiny = false;
  let gifSempre = false; // config.gifAnimado
  let favoritos = [];    // slugs (ex.: "pikachu")
  let cpuAlta = false;
  let pedido = 0;        // descarta respostas antigas se buscar de novo
  let ultimaCocega = 0;
  let fonteBusca = 'pokemon'; // onde o Enter procura (seletor de fonte)
  let favFranquias = [];      // [{ fonte, id, nome, imagem }]

  const ehAnime = () => !!atual && atual.fonte !== 'pokemon';
  const temaDaFonte = () => FONTE_TEMA[atual.fonte] || FONTE_TEMA.anilist;
  // destaque do personagem: a cor tirada da imagem dele (ou a paleta da fonte, de reserva)
  const corDoPersonagem = () => atual.cor || temaDaFonte().accent;
  const coresPorPersonagem = new Map(); // 'fonte|id' -> '#rrggbb' (não refaz ao trocar de resultado)
  const mesmoPersonagem = (a, b) => a.fonte === b.fonte && a.id === b.id;
  // nome de anime -> "usuário" do prompt e da narração ("Naruto Uzumaki" -> "naruto")
  const slugDe = (nome) => normalizar(String(nome).split(/[\s,]+/)[0]) || 'anime';

  const capitalizar = (s) => s.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  const bordao = () => {
    if (!atual) return '';
    return ehAnime() ? temaDaFonte().bordao : (TYPE_THEME[atual.tipos[0]] || TYPE_THEME.normal).bordao;
  };

  // "Mr. Mime" -> "mr-mime"; "Flabébé" -> "flabebe"; "25" -> "25". null se inválido.
  function normalizar(texto) {
    const s = String(texto || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['.’]/g, '')
      .replace(/\s+/g, '-');
    return /^[a-z0-9-]{1,30}$/.test(s) ? s : null;
  }

  // Grava só as chaves do Pokémon (relê a config para não pisar nas outras)
  // (o personagem de anime vai inteiro em "personagem": reabrir não precisa de internet)
  function salvar() {
    mudarConfig((cfg) => {
      if (atual && !ehAnime()) cfg.pokemon = atual.slug;
      if (atual && ehAnime()) cfg.personagem = { fonte: atual.fonte, id: atual.id, nome: atual.nome, imagem: atual.imagem, cor: atual.cor || '' };
      if (atual) cfg.fonte = atual.fonte; // o widget reabre com a última escolha
      cfg.pokemonEscolhido = escolhido;
      cfg.shiny = usarShiny;
      cfg.favoritos = favoritos;
      cfg.favoritosFranquias = favFranquias;
      // a tela de carregamento abre nesta cor
      if (atual) cfg.corPokebola = ehAnime() ? corDoPersonagem() : (TYPE_THEME[atual.tipos[0]] || TYPE_THEME.normal).accent;
    }).catch((erro) => console.error('Erro ao salvar Pokémon:', erro));
  }

  // ----- imagem -----
  // Padrão: o sprite (pixel art) > arte oficial > GIF. Com "gifAnimado": true,
  // a GIF animada vem primeiro.
  function escolherImagem(s, animando) {
    const brilho = usarShiny;
    const animado = s.versions?.['generation-v']?.['black-white']?.animated;
    const gif = animado && (brilho ? animado.front_shiny : animado.front_default);
    const frontal = brilho ? s.front_shiny : s.front_default;
    const arte = s.other?.['official-artwork'];
    const urlArte = arte && (brilho ? arte.front_shiny : arte.front_default);
    const opcoes = animando
      ? [gif && { url: gif, sprite: false, pixel: true }, frontal && { url: frontal, sprite: true, pixel: true }, urlArte && { url: urlArte, sprite: false, pixel: false }]
      : [frontal && { url: frontal, sprite: true, pixel: true }, urlArte && { url: urlArte, sprite: false, pixel: false }, gif && { url: gif, sprite: false, pixel: true }];
    return opcoes.filter(Boolean)[0] || null;
  }

  // O sprite vem com muita margem transparente (o Pokémon ocupa ~metade de 96x96).
  // Aqui ele é recortado só na margem (nunca no corpo) para ocupar a moldura toda.
  // Feito uma vez por imagem, num <canvas> fora da tela; o resultado fica em cache.
  const recortes = new Map(); // url -> { src, w, h } (ou null se não deu)
  function recortarSprite(url) {
    if (recortes.has(url)) return Promise.resolve(recortes.get(url));
    return new Promise((resolve) => {
      const imagem = new Image();
      imagem.crossOrigin = 'anonymous'; // o GitHub libera (CORS) a leitura dos pixels
      imagem.onload = () => {
        let r = null;
        try {
          const c = document.createElement('canvas');
          c.width = imagem.naturalWidth;
          c.height = imagem.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(imagem, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              if (d[(y * c.width + x) * 4 + 3] > 8) { // pixel visível
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
          }
          if (x1 >= 0) {
            const w = x1 - x0 + 1, h = y1 - y0 + 1;
            const saida = document.createElement('canvas');
            saida.width = w;
            saida.height = h;
            saida.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
            r = { src: saida.toDataURL('image/png'), w, h };
          }
        } catch (erro) {
          console.error('Não deu para recortar o sprite:', erro); // fica o original, inteiro
        }
        recortes.set(url, r);
        resolve(r);
      };
      imagem.onerror = () => resolve(null);
      imagem.src = url;
    });
  }

  // Escala do sprite: múltiplos inteiros (2x, 3x, 4x...) deixam os pixels nítidos e
  // iguais. Só usa o inteiro se ele perder no máximo 15% do tamanho possível;
  // senão, encaixa o maior possível (contain), para o Pokémon não ficar pequeno.
  let tamanhoSprite = null; // { w, h } do recorte atual (null = arte ou GIF)
  function ajustarEscala() {
    el.img.style.width = '';
    el.img.style.height = '';
    if (!tamanhoSprite) return;
    const t = el.tela.getBoundingClientRect();
    const maximo = Math.min(t.width / tamanhoSprite.w, t.height / tamanhoSprite.h);
    const inteiro = Math.floor(maximo);
    if (inteiro >= 2 && inteiro / maximo >= 0.85) {
      el.img.style.width = tamanhoSprite.w * inteiro + 'px';
      el.img.style.height = tamanhoSprite.h * inteiro + 'px';
    }
  }
  new ResizeObserver(ajustarEscala).observe(el.tela); // só dispara quando a moldura muda

  let pedidoImagem = 0;
  let ultimaImagem = Promise.resolve();

  // espera a imagem do rosto terminar de carregar (no máximo 3 s)
  async function esperarImagem() {
    await ultimaImagem;
    if (el.img.classList.contains('oculto') || el.img.complete) return;
    await new Promise((ok) => {
      el.img.addEventListener('load', ok, { once: true });
      el.img.addEventListener('error', ok, { once: true });
      setTimeout(ok, 3000);
    });
  }
  async function desenharImagem(avisar) {
    const animando = gifSempre && !economico && preferencias.animacoes;
    const escolha = !atual ? null
      : atual.sprites ? escolherImagem(atual.sprites, animando)
        : atual.imagem ? { url: atual.imagem, sprite: false, pixel: false } : null;
    el.vazio.classList.toggle('oculto', !!escolha);
    const meu = ++pedidoImagem;
    if (!escolha) {
      tamanhoSprite = null;
      el.img.classList.add('oculto');
      el.img.removeAttribute('src');
      if (atual && avisar) dizer(`Eita, não tenho foto${usarShiny && !ehAnime() ? ' brilhante' : ''}. Vou ficar invisível mesmo.`);
      return;
    }
    el.img.classList.toggle('pixel', escolha.pixel);
    el.img.classList.remove('oculto');
    const recorte = escolha.sprite ? await recortarSprite(escolha.url) : null;
    if (meu !== pedidoImagem) return; // trocou de imagem enquanto recortava
    tamanhoSprite = recorte ? { w: recorte.w, h: recorte.h } : null;
    const src = recorte ? recorte.src : escolha.url;
    if (el.img.src !== src) el.img.src = src;
    ajustarEscala();
  }

  // Os LEDs do rosto acendem de cima para baixo (só ao trocar de Pokémon)
  function varredura() {
    el.tela.classList.remove('entrada');
    void el.tela.offsetWidth; // reinicia a animação
    el.tela.classList.add('entrada');
  }

  function desenharBotoes() {
    const favorito = atual && (ehAnime() ? favFranquias.some((f) => mesmoPersonagem(f, atual)) : favoritos.includes(atual.slug));
    el.fav.textContent = favorito ? '★' : '☆';
    el.fav.classList.toggle('ativo', !!favorito);
    el.fav.title = favorito ? 'Remover dos favoritos' : 'Favoritar';
    el.shiny.classList.toggle('ativo', usarShiny && !ehAnime());
    el.shiny.disabled = ehAnime();
    el.shiny.title = ehAnime() ? 'Brilho (shiny) só existe para Pokémon' : 'Alternar brilhante (shiny)';
  }

  function desenharFavoritos() {
    if (favoritos.length === 0 && favFranquias.length === 0) {
      const vazio = document.createElement('span');
      vazio.className = 'sub';
      vazio.textContent = '(nenhum ainda: use a ☆)';
      el.favs.replaceChildren(vazio);
      return;
    }
    const deAnime = favFranquias.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fav-btn' + (atual && mesmoPersonagem(p, atual) ? ' atual' : '');
      b.textContent = p.nome;
      b.title = FONTE_TEMA[p.fonte].rotulo + ' • clique troca • botão direito remove';
      b.addEventListener('click', () => escolherPersonagem(p, { usuario: true }));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        favFranquias = favFranquias.filter((f) => !mesmoPersonagem(f, p));
        falar('desfavoritou');
        desenharBotoes();
        desenharFavoritos();
        salvar();
      });
      return b;
    });
    el.favs.replaceChildren(...deAnime, ...favoritos.map((slug) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fav-btn' + (atual && atual.slug === slug ? ' atual' : '');
      b.textContent = slug;
      b.title = 'Clique para trocar • botão direito remove';
      b.addEventListener('click', () => loadPokemon(slug, { usuario: true }));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        favoritos = favoritos.filter((f) => f !== slug);
        falar('desfavoritou');
        desenharBotoes();
        desenharFavoritos();
        salvar();
      });
      return b;
    }));
  }

  function desenhar() {
    if (!atual) return;
    // Pokémon: o tipo PRINCIPAL (primeiro) vira o esquema de cores do terminal inteiro.
    // Anime: a paleta fixa da fonte (temas.js).
    aplicarTema(ehAnime() ? 'fonte:' + atual.fonte : atual.tipos[0]);
    if (ehAnime()) document.documentElement.style.setProperty('--accent', corDoPersonagem());
    atualizarAccent();
    el.nome.textContent = atual.nome;
    el.num.textContent = ehAnime() ? '' : '#' + String(atual.id).padStart(3, '0');
    if (ehAnime()) {
      const chip = document.createElement('span');
      chip.className = 'tipo-chip';
      chip.textContent = temaDaFonte().rotulo.toUpperCase();
      chip.style.color = corDoPersonagem();
      el.tipos.replaceChildren(chip);
    } else el.tipos.replaceChildren(...atual.tipos.map((t) => {
      const chip = document.createElement('span');
      chip.className = 'tipo-chip';
      chip.textContent = (TIPO_PT[t] || t).toUpperCase(); // os [colchetes] do CMD vêm do CSS
      chip.style.color = (TYPE_THEME[t] || TYPE_THEME.normal).accent;
      return chip;
    }));
    narrador.falante(atual.slug);
    falas.contexto({ fonte: atual.fonte, nome: atual.nome, bordao: bordao() });
    abas.dono(atual.slug);
    ultimaImagem = desenharImagem(true);
    varredura();
    animar();
    desenharBotoes();
    desenharFavoritos();
  }

  // ----- busca -----
  // Devolve true se carregou, false se deu erro (ou foi atropelada por outra busca).
  // usuario: a troca veio de você (narra); primeiraVez: é a escolha que desbloqueia tudo.
  async function loadPokemon(texto, { usuario = false, primeiraVez = false } = {}) {
    const slug = normalizar(texto);
    if (!slug) { dizer('Hm? Esse nome não existe. Usa letras, números ou hífen.'); return false; }
    const anterior = atual;
    const meu = ++pedido;
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), 8000);
    if (usuario) dizer(`Procurando ${slug} na Pokédex...`);
    try {
      const resp = await fetch(API + slug, { signal: controle.signal });
      if (meu !== pedido) return false; // chegou outra busca depois desta
      if (resp.status === 404) { dizer(`Não achei "${texto.trim()}". Confere o nome ou o número?`); return false; }
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const d = await resp.json();
      if (meu !== pedido) return false;
      atual = {
        fonte: 'pokemon',
        id: d.id,
        slug: d.name,
        nome: capitalizar(d.name),
        tipos: d.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
        sprites: d.sprites,
      };
      desenhar();
      if (primeiraVez) {
        escolhido = true;
        falar('chegou');
        falar('chegou2');
        abas.desbloquear();
      } else if (usuario && anterior && anterior.slug !== atual.slug) {
        falar('trocou', { anterior: anterior.nome });
      }
      salvar();
      return true;
    } catch (erro) {
      if (meu !== pedido) return false;
      console.error('Erro na PokéAPI:', erro);
      dizer(erro.name === 'AbortError'
        ? 'A Pokédex demorou demais para responder. Tenta de novo?'
        : 'Não consegui falar com a Pokédex. Estamos sem internet?');
      return false;
    } finally {
      clearTimeout(limite);
    }
  }

  // Personagem de anime escolhido (de uma busca, de um favorito ou da config).
  // Não faz requisição: o personagem já traz nome e imagem.
  function escolherPersonagem(p, { usuario = false, primeiraVez = false } = {}) {
    pedido++; // uma busca de Pokémon em andamento não pisa nesta escolha
    const anterior = atual;
    const chave = p.fonte + '|' + p.id;
    const cor = p.cor || coresPorPersonagem.get(chave) || '';
    atual = { fonte: p.fonte, id: p.id, slug: slugDe(p.nome), nome: p.nome, tipos: [], sprites: null, imagem: p.imagem || '', cor };
    desenhar();
    if (!cor && atual.imagem) {
      const este = atual;
      franquias.corDaImagem(atual.imagem).then((c) => {
        if (!c) return; // sem cor legível: fica a paleta da fonte
        coresPorPersonagem.set(chave, c);
        if (atual !== este) return; // trocou de personagem enquanto lia a imagem
        atual.cor = c;
        document.documentElement.style.setProperty('--accent', c);
        atualizarAccent();
        el.tipos.firstElementChild && (el.tipos.firstElementChild.style.color = c);
        salvar();
      });
    }
    marcarResultados();
    if (primeiraVez) {
      escolhido = true;
      falar('chegou');
      falar('chegou2');
      abas.desbloquear();
    } else if (usuario && !(anterior && anterior.fonte === atual.fonte && anterior.id === atual.id)) {
      falar('trocou', { anterior: anterior ? anterior.nome : '' });
    }
    salvar();
  }

  // Resultados da busca de anime: até 5 botões; clicar escolhe (sem nova requisição)
  let ultimosResultados = [];
  function mostrarResultados(caixa, lista, primeiraVez) {
    ultimosResultados = lista;
    for (const c of [el.resultados, el.bloqResultados]) { c.classList.add('oculto'); c.replaceChildren(); }
    if (lista.length < 2) return; // um só: já foi escolhido, não precisa de lista
    caixa.replaceChildren(...lista.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.nome; // texto das APIs: sempre textContent
      b.addEventListener('click', () => escolherPersonagem(p, { usuario: true, primeiraVez: primeiraVez && !escolhido }));
      b.dataId = p.fonte + '|' + p.id;
      return b;
    }));
    caixa.classList.remove('oculto');
    marcarResultados();
  }
  function marcarResultados() {
    const chave = atual ? atual.fonte + '|' + atual.id : '';
    for (const c of [el.resultados, el.bloqResultados]) {
      for (const b of c.children) b.classList.toggle('atual', b.dataId === chave);
    }
  }

  // Busca de anime (Enter ou clique numa sugestão). Escolhe o primeiro resultado e
  // mostra os outros para trocar com um clique. Erros viram fala.
  async function buscarAnime(texto, { primeiraVez = false, caixa = el.resultados } = {}) {
    const termo = String(texto || '').trim().slice(0, 60);
    if (!termo) return false;
    const fonte = fonteBusca;
    const rotulo = FONTE_TEMA[fonte].rotulo;
    const meu = ++pedido;
    dizer(`Procurando "${termo}" no ${rotulo}...`);
    mudarConfig((cfg) => { cfg.ultimaBusca = { fonte, termo }; }).catch((erro) => console.error('Erro ao salvar a busca:', erro));
    let lista;
    try {
      lista = await franquias.buscar(fonte, termo, (s) => {
        if (meu === pedido) dizer(`O ${rotulo} pediu calma (limite de requisições). Espero ${s} s e tento de novo...`);
      });
    } catch (erro) {
      if (meu !== pedido) return false;
      console.error('Erro no ' + rotulo + ':', erro);
      dizer(erro.tipo === 'offline' ? `Não consegui falar com o ${rotulo}. Estamos sem internet (ou ele está fora do ar)?`
        : erro.tipo === 'tempo' ? `O ${rotulo} não respondeu a tempo (pode estar fora do ar). Tenta de novo daqui a pouco?`
          : erro.tipo === 'limite' ? `O ${rotulo} continua no limite de requisições. Espera um minutinho e tenta de novo.`
            : `O ${rotulo} respondeu com erro (${erro.message}). Tenta de novo daqui a pouco.`);
      return false;
    }
    if (meu !== pedido) return false; // chegou outra busca depois desta
    if (lista.length === 0) {
      dizer(`Não achei ninguém chamado "${termo}" no ${rotulo}.`);
      mostrarResultados(caixa, [], primeiraVez);
      return false;
    }
    mostrarResultados(caixa, lista, primeiraVez);
    escolherPersonagem(lista[0], { usuario: true, primeiraVez: primeiraVez && !escolhido });
    return true;
  }

  // ----- seletor de fonte (aba poke e tela da primeira escolha) -----
  const SUGESTOES = {
    pokemon: ['pikachu', 'charmander', 'bulbasaur', 'squirtle', 'eevee', 'gengar'],
    anilist: ['Naruto', 'Goku', 'Luffy', 'Gojo', 'Mikasa', 'Tanjiro'],
  };
  const NOMES_FONTE = { pokemon: 'Pokémon', anilist: 'Anime · AniList' };
  const seletores = [...document.querySelectorAll('[data-fontes]')];
  function desenharFonte() {
    for (const s of seletores) {
      for (const b of s.children) {
        b.classList.toggle('ativo', b.dataset.fonte === fonteBusca);
        b.setAttribute('aria-checked', b.dataset.fonte === fonteBusca);
      }
    }
    const dica = fonteBusca === 'pokemon' ? 'nome ou número + Enter' : 'personagem de anime + Enter';
    el.busca.placeholder = dica;
    el.bloqBusca.placeholder = dica;
    el.sugestoes.replaceChildren(...SUGESTOES[fonteBusca].map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.poke = n;
      b.textContent = n;
      return b;
    }));
  }
  for (const s of seletores) {
    s.replaceChildren(...Object.keys(NOMES_FONTE).map((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fonte-op';
      b.dataset.fonte = f;
      b.setAttribute('role', 'radio');
      b.textContent = NOMES_FONTE[f];
      b.addEventListener('click', () => {
        if (fonteBusca === f) return;
        fonteBusca = f;
        desenharFonte();
        for (const c of [el.resultados, el.bloqResultados]) { c.classList.add('oculto'); c.replaceChildren(); }
        dizer(f === 'pokemon' ? 'Voltando para a Pokédex. Quem eu chamo?' : `Agora eu procuro no ${FONTE_TEMA[f].rotulo}. Digite um personagem e dê Enter.`);
      });
      return b;
    }));
  }

  // ----- eventos -----
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = el.busca.value;
    if (!texto.trim()) return;
    el.busca.value = '';
    if (fonteBusca === 'pokemon') loadPokemon(texto, { usuario: true });
    else buscarAnime(texto, { caixa: el.resultados });
  });

  // primeira vez: busca ou sugestões
  el.bloqForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = el.bloqBusca.value;
    if (!texto.trim()) return;
    el.bloqBusca.value = '';
    if (fonteBusca === 'pokemon') loadPokemon(texto, { usuario: true, primeiraVez: true });
    else buscarAnime(texto, { primeiraVez: true, caixa: el.bloqResultados });
  });
  el.sugestoes.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-poke]');
    if (!b) return;
    if (fonteBusca === 'pokemon') loadPokemon(b.dataset.poke, { usuario: true, primeiraVez: true });
    else buscarAnime(b.dataset.poke, { primeiraVez: true, caixa: el.bloqResultados });
  });

  el.fav.addEventListener('click', () => {
    if (!atual) return;
    if (ehAnime()) {
      const jaAnime = favFranquias.some((f) => mesmoPersonagem(f, atual));
      favFranquias = jaAnime ? favFranquias.filter((f) => !mesmoPersonagem(f, atual))
        : [...favFranquias, { fonte: atual.fonte, id: atual.id, nome: atual.nome, imagem: atual.imagem, cor: atual.cor || '' }];
      falar(jaAnime ? 'desfavoritou' : 'favoritou');
      desenharBotoes();
      desenharFavoritos();
      salvar();
      return;
    }
    const ja = favoritos.includes(atual.slug);
    favoritos = ja ? favoritos.filter((f) => f !== atual.slug) : [...favoritos, atual.slug];
    falar(ja ? 'desfavoritou' : 'favoritou');
    desenharBotoes();
    desenharFavoritos();
    salvar();
  });

  el.shiny.addEventListener('click', () => {
    if (!atual || ehAnime()) return; // brilho só existe para Pokémon
    usarShiny = !usarShiny;
    falar(usarShiny ? 'shinyOn' : 'shinyOff');
    desenharBotoes();
    desenharImagem(true); // usa os dados já baixados: sem nova consulta
    varredura();
    salvar();
  });

  // Animação do tema em rajadas: a cada 9 s, ao trocar de Pokémon e com o mouse em cima
  function animar() {
    if (economico || !preferencias.animacoes) return; // rosto parado
    if (el.anim.classList.contains('anima') || el.anim.classList.contains('hello') || el.img.classList.contains('oculto')) return;
    el.anim.classList.add('anima');
  }
  el.anim.addEventListener('animationend', () => el.anim.classList.remove('anima', 'hello'));
  (function repetirAnimacao() {
    setTimeout(() => { animar(); repetirAnimacao(); }, 9000);
  })();

  // Mouse no rosto: ele se mexe e, de vez em quando, comenta
  el.tela.addEventListener('pointerenter', () => {
    animar();
    if (atual && Date.now() - ultimaCocega > 30000) {
      ultimaCocega = Date.now();
      falar('cocegas');
    }
  });
  // clique no rosto abre a Pokédex
  el.tela.addEventListener('click', () => { if (escolhido) abas.mostrar('poke'); });

  // ----- boas-vindas ("Olá, meu mestre!") -----
  function saudacao(hora) {
    if (hora < 5) return 'Boa madrugada';
    if (hora < 12) return 'Bom dia';
    if (hora < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Fala em voz alta (vozes SAPI do Windows); prefere uma voz pt-BR instalada
  function falarEmVoz(texto) {
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR';
    const voz = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (voz) fala.voice = voz;
    else console.error('Nenhuma voz pt-BR instalada; usando a voz padrão do Windows.');
    speechSynthesis.speak(fala);
  }

  function boasVindas(bv) {
    const chamar = bv.chamar || 'meu mestre';
    const sauda = saudacao(new Date().getHours());

    // Passo 1: rosto pula 3 vezes + saudação na narração
    el.anim.classList.remove('anima');
    if (preferencias.animacoes) el.anim.classList.add('hello');
    falar('boasVindas', { sauda, chamar });
    // Passo 2: voz, 1,2 s depois
    if (bv.voz !== false && 'speechSynthesis' in window) {
      setTimeout(() => {
        try { falarEmVoz(`Olá, ${chamar}! ${sauda}.`); } catch (erro) { console.error('Voz falhou:', erro); }
      }, 1200);
    }
    // Passo 3: resumo do PC, 6,5 s depois
    setTimeout(() => {
      if (!ultimoStats) return;
      dizer(`Seu PC está com ${Math.round(ultimoStats.cpu)}% de CPU e ${um(ultimoStats.ramUsada / GB)} GB de RAM em uso.`);
    }, 6500);
  }

  const TENTATIVAS_EXTRAS = 6;   // no boot do Windows a internet pode demorar
  const ESPERA_TENTATIVA = 5000; // ms

  return {
    async iniciar(cfg) {
      usarShiny = cfg.shiny === true;
      gifSempre = cfg.gifAnimado === true;
      favoritos = Array.isArray(cfg.favoritos) ? cfg.favoritos.filter((f) => typeof f === 'string') : [];
      escolhido = cfg.pokemonEscolhido === true;
      favFranquias = Array.isArray(cfg.favoritosFranquias) ? cfg.favoritosFranquias.filter((p) => p && FONTE_TEMA[p.fonte]) : [];
      fonteBusca = franquias.existe(cfg.fonte) ? cfg.fonte : 'pokemon';
      desenharFonte();
      desenharBotoes();
      desenharFavoritos();

      if (!escolhido) {
        // primeira vez: terminal "de fábrica", tudo bloqueado até a escolha
        aplicarTema(null);
        atualizarAccent();
        el.nome.textContent = '???';
        abas.bloquear();
        dizer('Terminal iniciado. Nenhum Pokémon no comando... ainda.');
        dizer('Escolha quem vai mandar aqui para liberar tudo.');
        carregamento.terminar();
        el.bloqBusca.focus();
        return;
      }

      // última escolha foi um personagem de anime: volta direto, sem requisição
      if (fonteBusca !== 'pokemon' && cfg.personagem && cfg.personagem.fonte === fonteBusca) {
        carregamento.etapa(55, `C:\\> chamando ${cfg.personagem.nome}...`);
        escolherPersonagem(cfg.personagem);
        carregamento.etapa(85, `C:\\> ${cfg.personagem.nome} chegou!`);
        await esperarImagem();
        carregamento.terminar();
        const bvA = cfg.boasVindas || {};
        if (bvA.ativo !== false) setTimeout(() => boasVindas(bvA), 1500);
        else falar('volta');
        return;
      }

      // já escolheu antes: sempre volta o mesmo, até você trocar
      el.nome.textContent = 'carregando...';
      const nome = String(cfg.pokemon || 'pikachu');
      carregamento.etapa(55, `C:\\> chamando ${nome}...`);
      let ok = await loadPokemon(nome);
      if (ok) {
        carregamento.etapa(85, `C:\\> ${nome} chegou!`);
        await esperarImagem();
      }
      carregamento.terminar(); // sem internet: não segura a tela; as novas tentativas seguem na narração
      for (let i = 1; !ok && i <= TENTATIVAS_EXTRAS; i++) {
        dizer(`Sem internet ainda... tento de novo em 5 s (${i}/${TENTATIVAS_EXTRAS}).`);
        await esperar(ESPERA_TENTATIVA);
        if (atual) return; // você já trocou de Pokémon nesse meio-tempo
        ok = await loadPokemon(nome);
      }
      if (!ok) { dizer('Sem conexão com a Pokédex. Fico por aqui mesmo, sem rosto.'); return; }

      const bv = cfg.boasVindas || {};
      if (bv.ativo !== false) setTimeout(() => boasVindas(bv), 1500);
      else falar('volta');
    },
    // chamado a cada leitura de CPU; só fala quando o estado muda
    cpu(pct) {
      const alta = pct > CPU_ALTA;
      if (alta === cpuAlta) return;
      cpuAlta = alta;
      if (!atual) return;
      falar(alta ? 'cpuAlta' : 'cpuOk', { cpu: Math.round(pct) });
    },
    escolhido: () => escolhido,
    nome: () => (atual ? atual.nome : null),
    redesenhar() { if (atual) desenharImagem(false); },
  };
})();

// ---------- Apps ----------
// Adicionar é 1 clique. O "[+ adicionar]" abre uma lista com os programas
// abertos agora, sites populares e tudo o que está no Menu Iniciar (inclusive
// apps da Microsoft Store): clique adiciona, clique de novo tira. Também dá para
// colar um link/caminho no campo e dar Enter, colar (Ctrl+V) direto na aba ou
// arrastar um programa, atalho ou link para cá.
// Para reorganizar: segure um app por ~0,6 s, ele "levanta" e é só arrastar para
// onde quiser (os outros abrem espaço); soltar grava a nova ordem. Esc cancela.
// Custo: a lista só é pedida ao abrir a loja; ícones só dos itens que aparecem.
const apps = (() => {
  const aba = document.getElementById('aba-apps');
  const grade = document.getElementById('apps-grade');
  const loja = document.getElementById('apps-loja');
  const lojaLista = document.getElementById('loja-lista');
  const lojaDica = document.getElementById('loja-dica');
  const form = document.getElementById('apps-form');
  const campo = document.getElementById('apps-campo');
  const soltar = document.getElementById('apps-soltar');
  const dialogo = document.getElementById('dialogo');
  const DICA = '1 clique adiciona · clique de novo tira';
  const LIMITE = 64; // o mesmo do main.js

  // sites mais usados: aparecem prontos, com o favicon
  const SITES = [
    ['YouTube', 'https://www.youtube.com'], ['Google', 'https://www.google.com'],
    ['Gmail', 'https://mail.google.com'], ['WhatsApp Web', 'https://web.whatsapp.com'],
    ['ChatGPT', 'https://chatgpt.com'], ['Claude', 'https://claude.ai'],
    ['Netflix', 'https://www.netflix.com'], ['Twitch', 'https://www.twitch.tv'],
    ['Instagram', 'https://www.instagram.com'], ['X', 'https://x.com'],
    ['Reddit', 'https://www.reddit.com'], ['GitHub', 'https://github.com'],
    ['Google Drive', 'https://drive.google.com'], ['Spotify Web', 'https://open.spotify.com'],
    ['Amazon', 'https://www.amazon.com.br'], ['Mercado Livre', 'https://www.mercadolivre.com.br'],
  ].map(([name, target]) => ({ name, type: 'url', target }));

  let lista = [];
  let indiceParaRemover = -1;
  let desenhado = false;   // a grade só é montada na primeira vez que a aba abre
  let visivel = false;
  let lojaAberta = false;
  let itensLoja = [];      // [{ el, item, busca }]
  let pedido = 0;          // descarta respostas de catálogo antigas

  // Tira aspas ("Copiar como caminho") e espaços das pontas
  const limpar = (t) => String(t || '').trim().replace(/^["']+|["']+$/g, '').trim();
  // para buscar sem ligar para acentos e maiúsculas
  const simples = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const chave = (a) => a.type + '|' + a.target.toLowerCase();
  const posicao = (a) => lista.findIndex((b) => chave(b) === chave(a));

  // Garante http(s):// no começo; devolve null se não for um endereço válido
  function normalizarUrl(texto) {
    let u = limpar(texto);
    if (!u || /\s/.test(u)) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      const x = new URL(u);
      return (x.protocol === 'http:' || x.protocol === 'https:') && x.hostname.includes('.') ? u : null;
    } catch {
      return null;
    }
  }

  // Texto colado/digitado -> atalho (caminho do disco ou site); null se não for nenhum
  function interpretar(texto) {
    const t = limpar(texto);
    if (/^[a-z]:\\|^\\\\/i.test(t)) {
      return { name: t.split('\\').filter(Boolean).pop().replace(/\.[^.]+$/, '').slice(0, 30), type: 'exe', target: t };
    }
    const url = normalizarUrl(t);
    return url ? { name: new URL(url).hostname.replace(/^www\./, '').slice(0, 30), type: 'url', target: url } : null;
  }

  async function gravar(novaLista) {
    await mudarConfig((cfg) => { cfg.apps = novaLista; });
    lista = novaLista;
    desenhar();
    marcarLoja();
  }

  async function adicionar(item) {
    if (posicao(item) >= 0) { dizer(item.name + ' já está nos apps.'); return; } // (aviso, não reação)
    if (lista.length >= LIMITE) { dizer('Não cabe mais nada! Tire algum app antes.'); return; }
    try {
      await gravar([...lista, { name: item.name.slice(0, 30), type: item.type, target: item.target }]);
      falar('appAdd', { app: item.name });
    } catch (erro) {
      dizer('Não consegui salvar ' + item.name + '.');
      console.error('Erro ao salvar atalho:', erro);
    }
  }

  async function remover(i) {
    const nome = lista[i].name;
    try {
      await gravar(lista.filter((_, j) => j !== i));
      falar('appRemove', { app: nome });
    } catch (erro) {
      console.error('Erro ao remover atalho:', erro);
    }
  }

  // Ícone: favicon para sites; para programas, o ícone do arquivo (via main).
  // Apps da Store (e qualquer falha) viram a inicial do nome.
  function criarIcone(a, buscar) {
    const img = document.createElement('img');
    img.className = 'app-icone';
    img.alt = '';
    img.draggable = false;
    const inicial = () => {
      const d = document.createElement('div');
      d.className = 'app-icone inicial';
      d.textContent = (a.name || '?').charAt(0).toUpperCase();
      if (img.parentNode) img.replaceWith(d);
      return d;
    };
    img.addEventListener('error', inicial);
    if (a.icone) {
      img.src = a.icone; // ícone escolhido por você
    } else if (a.type === 'url') {
      try {
        img.src = 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(new URL(a.target).hostname);
      } catch { return inicial(); }
    } else if (!buscar) {
      return inicial();
    } else {
      img.carregar = () => buscar().then((url) => (url ? (img.src = url) : inicial())).catch(inicial);
    }
    return img;
  }

  // ----- grade: os seus apps -----
  function desenhar() {
    desenhado = true;
    if (lista.length === 0) {
      const vazio = document.createElement('div');
      vazio.className = 'apps-vazio';
      vazio.textContent = 'nenhum app ainda: clique em [+ adicionar] ou arraste um programa para cá';
      grade.replaceChildren(vazio);
      return;
    }
    grade.replaceChildren(...lista.map((a, i) => {
      const b = document.createElement('button');
      b.className = 'app';
      b.type = 'button';
      b.title = a.name + ' (segure para mover · botão direito edita)';
      b.dataset.i = i; // posição na lista (a ordem na tela muda enquanto você arrasta)
      const nome = document.createElement('span');
      nome.className = 'app-nome';
      nome.textContent = a.name;
      const icone = criarIcone(a, () => window.widget.iconeApp(i));
      b.append(icone, nome);
      if (icone.carregar) icone.carregar();
      b.addEventListener('click', () => {
        if (ignorarClique) { ignorarClique = false; return; } // o clique que termina um arrastar não abre o app
        // se já estiver aberto, o main traz a janela para a frente em vez de abrir outra
        window.widget.abrirApp(i)
          .then((r) => {
            if (r === 'focado') falar('appFocar', { app: a.name });
            else if (r) { dizer('Não consegui abrir ' + a.name + ': ' + r); console.error('Não abriu', a.name + ':', r); }
            else falar('appAbrir', { app: a.name });
          })
          .catch((erro) => console.error('Erro ao abrir', a.name + ':', erro));
      });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirEdicao(i); });
      return b;
    }));
  }

  // ----- mover: segurar e arrastar -----
  const SEGURAR_MS = 600;   // quanto tempo segurar até o app "levantar"
  const TOLERANCIA = 8;     // px que o mouse pode tremer enquanto segura
  let seguro = null;        // esperando completar o "segurar": { b, x, y, timer }
  let movendo = null;       // app levantado: { b, fantasma, ox, oy, id, y, nome }
  let ignorarClique = false;
  let rolagem = 0;          // px por quadro (auto-rolagem perto da borda)

  // anima a troca de lugar dos vizinhos (FLIP: mede antes, muda, desliza do lugar antigo)
  function deslizar(mudar) {
    const itens = [...grade.children];
    const antes = new Map(itens.map((x) => [x, x.getBoundingClientRect()]));
    mudar();
    if (economico) return;
    for (const x of itens) {
      const a = antes.get(x), d = x.getBoundingClientRect();
      const dx = a.left - d.left, dy = a.top - d.top;
      if (dx || dy) x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 170, easing: 'ease-out' });
    }
  }

  function levantar() {
    if (!seguro) return;
    const { b, x, y, id } = seguro;
    seguro = null;
    if (!b.isConnected) return;
    const r = b.getBoundingClientRect();
    const fantasma = b.cloneNode(true);
    fantasma.removeAttribute('title');
    fantasma.classList.add('app-fantasma');
    fantasma.style.width = r.width + 'px';
    fantasma.style.height = r.height + 'px';
    document.body.append(fantasma);
    movendo = { b, fantasma, ox: x - r.left, oy: y - r.top, id, y, nome: lista[Number(b.dataset.i)].name };
    try { b.setPointerCapture(id); } catch { /* sem captura: os eventos seguem pelo document */ }
    b.classList.add('pegado');
    grade.classList.add('pegando');
    ignorarClique = true;
    acompanhar(x, y);
    (function rolar() { // auto-rolagem enquanto o app está perto da borda de cima/baixo
      if (!movendo) return;
      if (rolagem) grade.scrollTop += rolagem;
      requestAnimationFrame(rolar);
    })();
  }

  // o app levantado segue o mouse; os outros abrem espaço
  function acompanhar(x, y) {
    const { b, fantasma, ox, oy } = movendo;
    movendo.y = y;
    fantasma.style.left = x - ox + 'px';
    fantasma.style.top = y - oy + 'px';
    const g = grade.getBoundingClientRect();
    rolagem = y < g.top + 28 ? -10 : y > g.bottom - 28 ? 10 : 0;
    const sob = document.elementFromPoint(x, y); // o fantasma não recebe o mouse (pointer-events: none)
    const alvo = sob && sob.closest('.app');
    if (alvo && alvo !== b && alvo.parentNode === grade) {
      const a = alvo.getBoundingClientRect();
      const ref = x < a.left + a.width / 2 ? alvo : alvo.nextSibling; // metade esquerda: antes; direita: depois
      if (ref !== b && b.nextSibling !== ref) deslizar(() => grade.insertBefore(b, ref));
    } else if (sob === grade) {
      const ultimo = grade.lastElementChild;
      if (ultimo !== b && y > ultimo.getBoundingClientRect().bottom) deslizar(() => grade.append(b)); // abaixo de tudo: vai para o fim
    }
  }

  function largar(confirmar) {
    const { b, fantasma, nome, id } = movendo;
    movendo = null;
    rolagem = 0;
    fantasma.remove();
    b.classList.remove('pegado');
    grade.classList.remove('pegando');
    try { b.releasePointerCapture(id); } catch { /* já solto */ }
    setTimeout(() => { ignorarClique = false; }, 150); // se nenhum clique vier, não fica "ligado"
    const ordem = [...grade.querySelectorAll('.app')].map((x) => Number(x.dataset.i));
    const mudou = ordem.some((v, k) => v !== k);
    if (confirmar && mudou) {
      gravar(ordem.map((i) => lista[i]))
        .then(() => falar('appMover', { app: nome }))
        .catch((erro) => { console.error('Erro ao salvar a ordem:', erro); desenhar(); });
    } else if (mudou) {
      desenhar(); // cancelou (Esc): volta como estava
    }
  }

  grade.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || movendo) return;
    const b = e.target.closest('.app');
    if (!b) return;
    clearTimeout(seguro && seguro.timer);
    seguro = { b, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(levantar, SEGURAR_MS) };
  });
  document.addEventListener('pointermove', (e) => {
    if (seguro && Math.hypot(e.clientX - seguro.x, e.clientY - seguro.y) > TOLERANCIA) {
      clearTimeout(seguro.timer); // mexeu antes da hora: era só um arrastar/rolar, não um "segurar"
      seguro = null;
    }
    if (movendo) acompanhar(e.clientX, e.clientY);
  });
  const terminarGesto = (confirmar) => (e) => {
    if (seguro) { clearTimeout(seguro.timer); seguro = null; }
    if (movendo) { e.preventDefault(); largar(confirmar); }
  };
  document.addEventListener('pointerup', terminarGesto(true));
  document.addEventListener('pointercancel', terminarGesto(false));

  // ----- loja: tudo o que dá para adicionar -----
  // ícones da loja só carregam quando o item aparece na rolagem
  const aoAparecer = new IntersectionObserver((entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      aoAparecer.unobserve(en.target);
      if (en.target.carregar) en.target.carregar();
    }
  }, { root: lojaLista, rootMargin: '120px' });

  function itemDaLoja(item) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'loja-item';
    b.title = item.type === 'url' ? item.target : item.name;
    const icone = criarIcone(item, () => (item.type === 'app' ? window.widget.iconeAppId(item.target) : window.widget.iconeArquivo(item.target)));
    const nome = document.createElement('span');
    nome.className = 'loja-nome';
    nome.textContent = item.name;
    const marca = document.createElement('span');
    marca.className = 'loja-marca';
    b.append(icone, nome, marca);
    if (icone.carregar) aoAparecer.observe(icone);
    b.addEventListener('click', () => {
      const i = posicao(item);
      if (i >= 0) remover(i); else adicionar(item);
    });
    itensLoja.push({ el: b, item, busca: simples(item.name) });
    return b;
  }

  function secao(titulo, itens) {
    const s = document.createElement('div');
    s.className = 'loja-secao';
    const h = document.createElement('div');
    h.className = 'loja-titulo';
    h.textContent = titulo;
    const g = document.createElement('div');
    g.className = 'loja-grade';
    g.append(...itens.map(itemDaLoja));
    s.append(h, g);
    return s;
  }

  function montarLoja(catalogo) {
    itensLoja = [];
    aoAparecer.disconnect();
    const secoes = [];
    if (catalogo && catalogo.abertos.length) secoes.push(secao('abertos agora', catalogo.abertos.map((a) => ({ name: a.nome, type: a.type, target: a.target }))));
    secoes.push(secao('sites', SITES));
    if (catalogo) {
      secoes.push(secao('instalados', catalogo.instalados.map((a) => ({ name: a.nome, type: a.type, target: a.target }))));
    } else {
      const c = document.createElement('div');
      c.className = 'sub loja-carregando';
      c.textContent = 'procurando os apps instalados...';
      secoes.push(c);
    }
    lojaLista.replaceChildren(...secoes);
    marcarLoja();
    filtrar();
  }

  // ✓ nos que você já tem
  function marcarLoja() {
    for (const { el, item } of itensLoja) {
      const tem = posicao(item) >= 0;
      el.classList.toggle('tem', tem);
      el.lastElementChild.textContent = tem ? '✓' : '+';
    }
  }

  // filtra pelo que está no campo; esconde as seções que ficaram vazias
  function filtrar() {
    const q = simples(limpar(campo.value));
    for (const { el, busca } of itensLoja) el.classList.toggle('oculto', q !== '' && !busca.includes(q));
    for (const s of lojaLista.querySelectorAll('.loja-secao')) {
      s.classList.toggle('oculto', !s.querySelector('.loja-item:not(.oculto)'));
    }
    const direto = interpretar(campo.value);
    lojaDica.textContent = direto ? 'Enter adiciona: ' + direto.target : DICA;
  }

  async function abrirLoja() {
    if (lojaAberta) return;
    lojaAberta = true;
    loja.classList.remove('oculto');
    grade.classList.add('oculto');
    dizer('O que eu coloco aqui? Um clique e pronto.');
    montarLoja(null); // sites na hora; os instalados chegam em seguida
    const meu = ++pedido;
    try {
      const catalogo = await window.widget.catalogoApps();
      if (meu === pedido && lojaAberta && catalogo) montarLoja(catalogo);
    } catch (erro) {
      console.error('Erro ao listar os apps:', erro);
    }
  }

  function fecharLoja() {
    if (!lojaAberta) return;
    lojaAberta = false;
    pedido++;
    loja.classList.add('oculto');
    grade.classList.remove('oculto');
    lojaLista.replaceChildren(); // libera os ícones da memória
    itensLoja = [];
    aoAparecer.disconnect();
    campo.value = '';
  }

  document.getElementById('apps-loja-btn').addEventListener('click', () => {
    if (lojaAberta) fecharLoja(); else { abrirLoja(); campo.focus(); }
  });
  document.getElementById('loja-fechar').addEventListener('click', fecharLoja);
  campo.addEventListener('input', () => {
    if (!lojaAberta && campo.value.trim()) abrirLoja();
    filtrar();
  });
  // Enter: link/caminho vira atalho; senão, adiciona o primeiro da busca
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const direto = interpretar(campo.value);
    if (direto) {
      adicionar(direto);
      campo.value = '';
      filtrar();
      return;
    }
    const primeiro = itensLoja.find(({ el }) => !el.classList.contains('oculto'));
    if (campo.value.trim() && primeiro && posicao(primeiro.item) < 0) adicionar(primeiro.item);
  });

  // ----- colar (Ctrl+V) direto na aba -----
  document.addEventListener('paste', (e) => {
    if (!visivel || e.target instanceof HTMLInputElement) return;
    const item = interpretar(e.clipboardData.getData('text'));
    if (item) { e.preventDefault(); adicionar(item); }
  });

  // ----- arrastar e soltar (programas, atalhos, pastas, links) -----
  // Em qualquer lugar da janela, soltar não pode "abrir" o arquivo na tela
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  let arrastando = 0;
  aba.addEventListener('dragenter', () => { arrastando++; soltar.classList.remove('oculto'); });
  aba.addEventListener('dragleave', () => { if (--arrastando <= 0) { arrastando = 0; soltar.classList.add('oculto'); } });
  aba.addEventListener('drop', (e) => {
    arrastando = 0;
    soltar.classList.add('oculto');
    const itens = [];
    for (const f of e.dataTransfer.files) {
      const caminho = window.widget.caminhoArquivo(f);
      if (caminho) itens.push(interpretar(caminho));
    }
    if (itens.length === 0) itens.push(interpretar(e.dataTransfer.getData('text/uri-list').split('\n')[0] || e.dataTransfer.getData('text')));
    (async () => { for (const item of itens.filter(Boolean)) await adicionar(item); })();
  });

  // ----- editar (botão direito): nome, ícone e remover -----
  const caixaEditar = document.getElementById('dialogo-editar');
  const caixaConfirma = document.getElementById('dialogo-confirma');
  const eNome = document.getElementById('e-nome');
  const eIcone = document.getElementById('e-icone');
  const eArquivo = document.getElementById('e-arquivo');
  let indiceEditando = -1;
  let iconeNovo; // undefined = não mexeu · null = voltar ao original · "data:..." = imagem escolhida

  function mostrarIconeEdicao() {
    const a = lista[indiceEditando];
    const previa = { ...a };
    if (iconeNovo === null) delete previa.icone; else if (iconeNovo) previa.icone = iconeNovo;
    previa.name = eNome.value.trim() || a.name;
    const i = criarIcone(previa, () => window.widget.iconeApp(indiceEditando));
    eIcone.replaceChildren(i);
    if (i.carregar) i.carregar();
  }

  function abrirEdicao(i) {
    indiceEditando = i;
    iconeNovo = undefined;
    eNome.value = lista[i].name;
    caixaConfirma.classList.add('oculto');
    caixaEditar.classList.remove('oculto');
    dialogo.classList.remove('oculto');
    mostrarIconeEdicao();
    eNome.focus();
    eNome.select();
  }

  // imagem escolhida -> PNG 64x64 (centralizada, sem distorcer): pequena para caber na config
  function reduzirImagem(arquivo) {
    return new Promise((ok, falha) => {
      const leitor = new FileReader();
      leitor.onerror = () => falha(new Error('não deu para ler o arquivo'));
      leitor.onload = () => {
        const img = new Image();
        img.onerror = () => falha(new Error('não é uma imagem'));
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 64;
          const escala = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight);
          const w = Math.max(1, Math.round(img.naturalWidth * escala)), h = Math.max(1, Math.round(img.naturalHeight * escala));
          const ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
          ok(c.toDataURL('image/png'));
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  }

  const escolherIcone = () => eArquivo.click();
  eIcone.addEventListener('click', escolherIcone);
  document.getElementById('e-trocar').addEventListener('click', escolherIcone);
  document.getElementById('e-original').addEventListener('click', () => { iconeNovo = null; mostrarIconeEdicao(); });
  eNome.addEventListener('input', () => { if (!eIcone.querySelector('img')) mostrarIconeEdicao(); }); // a inicial acompanha o nome
  eArquivo.addEventListener('change', async () => {
    const arquivo = eArquivo.files[0];
    eArquivo.value = '';
    if (!arquivo) return;
    try {
      iconeNovo = await reduzirImagem(arquivo);
      mostrarIconeEdicao();
    } catch (erro) {
      dizer('Não consegui usar essa imagem: ' + erro.message);
    }
  });
  eNome.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvarEdicao(); } });

  async function salvarEdicao() {
    const i = indiceEditando;
    if (i < 0) return;
    const a = { ...lista[i], name: eNome.value.trim().slice(0, 30) || lista[i].name };
    if (iconeNovo === null) delete a.icone;
    else if (iconeNovo) a.icone = iconeNovo;
    fecharDialogo();
    try {
      await gravar(lista.map((x, j) => (j === i ? a : x)));
      falar('appEditar', { app: a.name });
    } catch (erro) {
      console.error('Erro ao salvar o app:', erro);
    }
  }
  document.getElementById('e-salvar').addEventListener('click', salvarEdicao);
  document.getElementById('e-cancelar').addEventListener('click', () => fecharDialogo());
  document.getElementById('e-remover').addEventListener('click', () => pedirRemocao(indiceEditando));

  // ----- confirmar remoção -----
  function pedirRemocao(i) {
    indiceParaRemover = i;
    document.getElementById('c-texto').textContent = '$ apps rm "' + lista[i].name + '"?';
    caixaEditar.classList.add('oculto');
    caixaConfirma.classList.remove('oculto');
    dialogo.classList.remove('oculto');
  }
  function fecharDialogo() {
    dialogo.classList.add('oculto');
    indiceParaRemover = -1;
    indiceEditando = -1;
  }
  document.getElementById('c-nao').addEventListener('click', fecharDialogo);
  document.getElementById('c-sim').addEventListener('click', () => {
    const i = indiceParaRemover;
    fecharDialogo();
    if (i >= 0) remover(i);
  });
  // Esc fecha o diálogo ou a loja
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (movendo) { largar(false); return; }
    if (!dialogo.classList.contains('oculto')) fecharDialogo();
    else if (lojaAberta) fecharLoja();
  });

  return {
    iniciar(cfg) { lista = Array.isArray(cfg.apps) ? cfg.apps : []; },
    visivel(v) {
      visivel = v;
      if (v && !desenhado) desenhar(); // ícones só carregam quando você abre a aba
      if (!v) { fecharLoja(); if (movendo) largar(false); }
    },
  };
})();

// ---------- Cérebro (aba cerebro) ----------
// Memória em Markdown. A busca, a leitura e a gravação são do cerebro/tools/cerebro.py (o
// app/cerebro.js só chama e devolve o JSON; aqui não tem lógica de busca). Nada roda sozinho:
// cada clique abre um Python curto que some ao terminar. Ao abrir a aba, uma chamada só traz
// projetos, estatísticas e o estado do projeto (no máximo a cada 10 s).
// ---------- Economia (subaba da aba Cérebro) ----------
// O cérebro está compensando? Os números vêm do cerebro/tools/economia.py (via app/economia.js), calculados dos logs locais
// (consultas.jsonl, sessoes.jsonl) e SÃO ESTIMATIVAS. O teste A/B é o único dado real: você digita o que o /usage mostrou.
// Nada roda sozinho: o Python só é chamado ao abrir a subaba, em [atualizar] e ao registrar/remover um resultado do A/B.
// Gráficos em <canvas> puro (a mesma técnica do comparar da aba Skills).
const economiaCer = (() => {
  const $ = (id) => document.getElementById(id);
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const aba = $('aba-cerebro');
  const NIVEIS = [['titulos', 'nível 1: título', '--eco-titulos', '#4f9dff'], ['cabecalho', 'nível 2: cabeçalho', '--eco-cabecalho', '#c792ea'],
    ['ler', 'nível 3: ler', '--eco-ler', '#ffc857'], ['buscar', 'busca combinada', '--eco-buscar', '#5ce1e6']];
  const INTERVALO = 10000; // reabrir em menos de 10 s não recalcula

  let dados = null;
  let aberto = false;
  let emTela = false;
  let ultimaCarga = 0;
  let carregando = false;
  let enviando = false;
  let larguraDesenhada = 0;
  let removendo = null; // id do registro do A/B esperando o segundo clique

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };
  const botao = (rotulo, aoClicar, titulo) => {
    const b = el('button', 'botao-cmd', IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo);
    b.type = 'button';
    if (titulo) b.title = titulo;
    b.addEventListener('click', aoClicar);
    return b;
  };
  const chamar = async (fn) => {
    try { return await fn(); } catch (erro) { return { ok: false, tipo: 'erro', erro: 'falha interna: ' + erro.message }; }
  };
  const num = (v) => Number(v).toLocaleString('pt-BR');
  const compacto = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M';
    if (a >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(Math.round(v));
  };
  const dataCurta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const quando = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + ' ' + iso.slice(11, 16) : '');
  const cssVar = (nome, padrao) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || padrao;
  const sinal = (v) => (v > 0 ? '+' : '') + num(v);

  // ----- blocos de texto -----
  function desenharCartoes() {
    const t = dados.totais;
    const cartao = (rotulo, valor, classe, dica) => {
      const c = el('div', 'eco-cartao');
      c.title = dica;
      c.append(el('span', 'eco-num' + (classe ? ' ' + classe : ''), valor), el('span', 'eco-rot', rotulo));
      return c;
    };
    $('eco-cartoes').replaceChildren(
      cartao('consultas (' + dados.semanas.length + ' semanas)', num(t.consultas), '', 'Quantas vezes o cérebro foi consultado (titulos, cabecalho, ler e buscar)'),
      cartao('tokens devolvidos (est.)', num(t.tokens), '', 'O que as consultas devolveram, em tokens estimados (caracteres/4, x1,1 com acentos)'),
      cartao('buscas nos níveis 1–2', t.pct_nivel12 === null ? '—' : t.pct_nivel12 + '%',
        '', 'Quanto maior, melhor: a busca foi resolvida sem abrir arquivos (' + t.buscas_nivel12 + ' de ' + t.buscas + ' buscas)'),
      cartao('tokens evitados (est.)', t.consultas || dados.evitados.sessoes_contadas ? sinal(dados.evitados.total) : '—', dados.evitados.total < 0 ? 'neg' : '',
        'ESTIMATIVA: o que custaria reexplicar os projetos menos o que o cérebro gastou, nas ' + dados.evitados.sessoes_contadas + ' sessões novas com consultas'));
  }
  function desenharLegenda() {
    const itens = NIVEIS.map(([, nome, v, padrao]) => [nome, cssVar(v, padrao)]).concat([['tokens evitados (est.)', cssVar('--eco-linha', '#3ddc84')]]);
    $('eco-legenda').replaceChildren(...itens.map(([nome, cor]) => {
      const i = el('i', 'pu-cor');
      i.style.background = cor;
      const item = el('span', 'pu-leg');
      item.append(i, document.createTextNode(nome));
      return item;
    }));
  }
  function desenharProporcao() {
    const t = dados.totais;
    const n = t.por_nivel;
    const linhas = [];
    if (!t.buscas) linhas.push('Nenhuma consulta ao cérebro nestas semanas.');
    else {
      linhas.push(`Buscas (consultas seguidas, até 10 min entre si): ${t.buscas}. Resolvidas nos níveis 1 e 2 (sem abrir arquivo): ${t.buscas_nivel12} (${t.pct_nivel12}%). Chegaram ao nível 3 (ler): ${t.buscas_nivel3}.`);
      linhas.push(`Uso por nível: título ${n.titulos}, cabeçalho ${n.cabecalho}, ler ${n.ler}, busca combinada ${n.buscar}. Quanto maior a parte dos níveis 1–2, mais barato o cérebro.`);
    }
    $('eco-prop').replaceChildren(...linhas.map((l) => el('div', null, l)));
  }
  function desenharSessoes() {
    $('eco-nota').textContent = dados.nota;
    const e = dados.evitados;
    const cab = el('div', 'eco-linha cab');
    cab.append(el('span', null, 'sessão'), el('span', null, 'projeto'), el('span', 'dir', 'com cérebro'), el('span', 'dir', 'sem cérebro'), el('span', 'dir', 'evitados (est.)'));
    const linhas = dados.sessoes.map((s) => {
      const l = el('div', 'eco-linha');
      l.title = s.motivo || `${s.consultas} consultas devolveram ${num(s.caracteres_lidos)} caracteres; o estado do projeto tem ~${num(s.estado_tokens)} tokens`;
      const valor = s.evitados === null ? '—' : sinal(s.evitados);
      l.append(el('span', null, quando(s.data)), el('span', null, s.projeto),
        el('span', 'dir' + (s.com_cerebro === null ? ' apagado' : ''), s.com_cerebro === null ? '—' : num(s.com_cerebro)),
        el('span', 'dir' + (s.sem_cerebro === null ? ' apagado' : ''), s.sem_cerebro === null ? '—' : num(s.sem_cerebro)),
        el('span', 'dir ' + (s.evitados === null ? 'apagado' : s.evitados < 0 ? 'neg' : s.evitados > 0 ? 'pos' : 'apagado'), valor));
      return l;
    });
    const resumo = el('div', 'cer-nota', dados.sessoes.length
      ? `Contaram ${e.sessoes_contadas} de ${e.sessoes_novas} sessões novas (as que tiveram consultas); ${e.sessoes_negativas} custaram mais do que reexplicar. Passe o mouse numa linha para ver o motivo ou o detalhe.`
      : 'Nenhuma sessão aberta pelo widget nestas semanas.');
    $('eco-sessoes').replaceChildren(...(dados.sessoes.length ? [cab, ...linhas] : []), resumo);
  }
  function desenharAB() {
    const ab = dados.ab;
    $('eco-tarefas').replaceChildren(...[...new Set(ab.registros.map((r) => r.tarefa))].map((t) => new Option(t)));
    $('eco-ab-resumo').textContent = ab.media_reducao_pct === null
      ? (ab.registros.length ? 'Falta a outra variante: registre a mesma tarefa com e sem cérebro para ver a comparação.' : 'Nenhum resultado registrado ainda.')
      : `Redução média nos tokens com o cérebro: ${String(ab.media_reducao_pct).replace('.', ',')}% (${ab.comparacoes.filter((c) => c.reducao_pct !== null).length} tarefa(s) com as duas variantes). Negativo = o cérebro gastou mais.`;
    const lista = ab.registros.map((r) => {
      const l = el('div', 'eco-linha eco-ab-linha');
      l.title = r.notas || '';
      const rm = botao(removendo === r.id ? '[confirmar remoção]' : '[remover]', () => remover(r), 'Tira só este registro (pergunta antes, com um segundo clique)');
      l.append(el('span', null, quando(r.data)), el('span', null, r.tarefa), el('span', 'dir', r.variante === 'com' ? 'com cérebro' : 'sem cérebro'),
        el('span', 'dir', num(r.total) + (r.custo_usd !== null ? ` · US$ ${String(r.custo_usd).replace('.', ',')}` : '')), rm);
      return l;
    });
    $('eco-ab-lista').replaceChildren(...lista);
  }

  // ----- gráfico 1: barras semanais de consultas por nível + linha de tokens evitados (canvas puro) -----
  function desenharSemanal() {
    const c = $('eco-semanal');
    c.style.height = '132px';
    const { ctx, w, h } = prepararCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const sem = dados.semanas;
    const cTexto = cssVar('--text', '#cccccc');
    const cApagado = cssVar('--apagado', '#6e6e6e');
    const cLinha = cssVar('--eco-linha', '#3ddc84');
    const esq = 28;
    const dir = 48;
    const topo = 14;
    const base = h - 16;
    const areaW = Math.max(40, w - esq - dir);
    const areaH = base - topo;
    const slot = areaW / sem.length;
    const barW = Math.min(36, slot * 0.55);
    const maxC = Math.max(1, ...sem.map((s) => s.consultas));
    ctx.font = '10px Consolas, monospace';
    ctx.textBaseline = 'middle';
    // guias e eixo esquerdo (consultas)
    ctx.strokeStyle = cApagado;
    ctx.globalAlpha = 0.25;
    [0, 0.5, 1].forEach((f) => { const y = Math.round(base - areaH * f) + 0.5; ctx.beginPath(); ctx.moveTo(esq, y); ctx.lineTo(esq + areaW, y); ctx.stroke(); });
    ctx.globalAlpha = 1;
    ctx.fillStyle = cApagado;
    ctx.textAlign = 'right';
    ctx.fillText('0', esq - 4, base);
    ctx.fillText(String(maxC), esq - 4, topo);
    const retangulo = (x, y, larg, alt, cor) => {
      ctx.fillStyle = cor;
      if (IOS && ctx.roundRect && alt > 4) { ctx.beginPath(); ctx.roundRect(x, y, larg, alt, 3); ctx.fill(); } else ctx.fillRect(x, y, larg, alt);
    };
    const cores = NIVEIS.map(([, , v, p]) => cssVar(v, p));
    sem.forEach((s, i) => {
      const x = esq + i * slot + (slot - barW) / 2;
      let y = base;
      NIVEIS.forEach(([k], j) => {
        const alt = (s.por_nivel[k] / maxC) * areaH;
        if (alt > 0) { retangulo(x, y - alt, barW, alt, cores[j]); y -= alt; }
      });
      const outros = (s.outros / maxC) * areaH;
      if (outros > 0) { retangulo(x, y - outros, barW, outros, cssVar('--eco-outros', '#6e6e6e')); y -= outros; }
      ctx.fillStyle = cTexto;
      ctx.textAlign = 'center';
      if (s.consultas) ctx.fillText(String(s.consultas), x + barW / 2, y - 6);
      ctx.fillStyle = cApagado;
      ctx.fillText(dataCurta(s.inicio), x + barW / 2, h - 5);
    });
    // linha de tokens evitados (eixo direito, pode ter valores negativos)
    const valores = sem.map((s) => s.evitados);
    if (valores.some((v) => v !== 0)) {
      const min = Math.min(0, ...valores);
      let max = Math.max(0, ...valores);
      if (max === min) max = min + 1;
      const yv = (v) => base - ((v - min) / (max - min)) * areaH;
      const pontos = valores.map((v, i) => [esq + i * slot + slot / 2, yv(v)]);
      if (min < 0) { ctx.strokeStyle = cLinha; ctx.globalAlpha = 0.35; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(esq, yv(0)); ctx.lineTo(esq + areaW, yv(0)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      ctx.strokeStyle = cLinha;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pontos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = cLinha;
      pontos.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
      ctx.textAlign = 'left';
      ctx.fillText(compacto(max), esq + areaW + 6, topo);
      if (min < 0) ctx.fillText(compacto(min), esq + areaW + 6, base);
      else ctx.fillText('0', esq + areaW + 6, base);
    } else {
      ctx.fillStyle = cApagado;
      ctx.textAlign = 'right';
      ctx.fillText('sem tokens evitados', w - 2, topo - 4);
    }
    c.setAttribute('aria-label', 'Consultas por semana e por nível, e tokens evitados (estimado): ' + sem.map((s) => `${dataCurta(s.inicio)}: ${s.consultas} consultas, ${s.evitados} evitados`).join('; '));
  }

  // ----- gráfico 2: teste A/B (por tarefa, com cérebro x sem cérebro) -----
  function desenharComparacaoAB() {
    const c = $('eco-ab');
    const itens = dados.ab.comparacoes.slice(0, 8);
    const linha = 34;
    c.style.height = itens.length ? (itens.length * linha + 20) + 'px' : '0px';
    c.classList.toggle('oculto', !itens.length);
    if (!itens.length) return;
    const { ctx, w, h } = prepararCanvas(c);
    ctx.clearRect(0, 0, w, h);
    const cTexto = cssVar('--text', '#cccccc');
    const cApagado = cssVar('--apagado', '#6e6e6e');
    const cCom = cssVar('--eco-com', '#3ddc84');
    const cSem = cssVar('--eco-sem', '#ff6b6b');
    const rotuloW = Math.min(150, Math.max(80, Math.floor(w * 0.28)));
    const direita = 54;
    const area = Math.max(20, w - rotuloW - direita - 52);
    const maximo = Math.max(1, ...itens.flatMap((i) => [i.com.total || 0, i.sem.total || 0]));
    ctx.font = '11px Consolas, monospace';
    ctx.textBaseline = 'middle';
    const barra = (x, y, larg, alt, cor) => {
      ctx.fillStyle = cor;
      if (IOS && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, Math.max(larg, 0), alt, 3); ctx.fill(); } else ctx.fillRect(x, y, Math.max(larg, 0), alt);
    };
    itens.forEach((it, i) => {
      const y = i * linha + 4;
      let nome = it.tarefa;
      while (nome.length > 3 && ctx.measureText(nome).width > rotuloW - 8) nome = nome.slice(0, -2) + '…';
      ctx.fillStyle = cTexto;
      ctx.textAlign = 'left';
      ctx.fillText(nome, 2, y + linha / 2 - 3);
      [['com', it.com, cCom, 4], ['sem', it.sem, cSem, 18]].forEach(([, v, cor, dy]) => {
        const larg = v.total ? Math.max(2, (v.total / maximo) * area) : 0;
        barra(rotuloW, y + dy - 3, larg, 11, cor);
        ctx.fillStyle = v.total ? cTexto : cApagado;
        ctx.textAlign = 'left';
        ctx.fillText(v.total ? compacto(v.total) + (v.n > 1 ? ` (média de ${v.n})` : '') : 'sem registro', rotuloW + larg + 5, y + dy + 2.5);
      });
      if (it.reducao_pct !== null) {
        ctx.fillStyle = it.reducao_pct >= 0 ? cCom : cSem;
        ctx.textAlign = 'right';
        ctx.fillText((it.reducao_pct > 0 ? '−' : it.reducao_pct < 0 ? '+' : '') + Math.abs(it.reducao_pct).toString().replace('.', ',') + '%', w - 2, y + linha / 2 - 3);
      }
    });
    ctx.fillStyle = cApagado;
    ctx.textAlign = 'left';
    ctx.fillText('verde = com cérebro · vermelho = sem · % = tokens a menos', 2, h - 6);
    c.setAttribute('aria-label', 'Tokens por tarefa, com e sem cérebro: ' + itens.map((i) => `${i.tarefa}: com ${i.com.total ?? 'sem registro'}, sem ${i.sem.total ?? 'sem registro'}`).join('; '));
  }
  function desenharGraficos() {
    if (!dados || !aberto || !emTela || !$('eco-semanal').clientWidth) return;
    larguraDesenhada = $('eco-semanal').clientWidth;
    desenharSemanal();
    desenharComparacaoAB();
  }
  function desenhar() {
    desenharCartoes();
    desenharLegenda();
    desenharProporcao();
    desenharSessoes();
    desenharAB();
    desenharGraficos();
  }

  // ----- dados -----
  async function carregar(forcar) {
    if (carregando || (!forcar && dados && Date.now() - ultimaCarga < INTERVALO)) { desenharGraficos(); return; }
    carregando = true;
    $('eco-erro').textContent = '';
    if (!dados) $('eco-prop').textContent = 'Calculando (um Python curto lê os logs)...';
    const r = await chamar(() => window.widget.economiaPainel());
    carregando = false;
    if (!r.ok) {
      $('eco-erro').textContent = r.tipo === 'semPython' ? 'O painel precisa do Python 3. ' + (r.erro || '') : r.erro || 'não consegui calcular';
      return;
    }
    dados = r.dados;
    ultimaCarga = Date.now();
    desenhar();
  }
  function abrir() {
    aberto = true;
    aba.classList.add('economia');
    carregar(false);
  }
  function fechar() {
    aberto = false;
    aba.classList.remove('economia');
  }

  // ----- teste A/B: registrar e remover -----
  $('eco-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (enviando) return;
    enviando = true;
    $('eco-registrar').disabled = true;
    $('eco-form-erro').textContent = '';
    const r = await chamar(() => window.widget.economiaABRegistrar({
      tarefa: $('eco-tarefa').value, variante: $('eco-variante').value, entrada: $('eco-entrada').value, saida: $('eco-saida').value,
      custo_usd: $('eco-custo').value, notas: $('eco-notas').value,
    }));
    enviando = false;
    $('eco-registrar').disabled = false;
    if (!r.ok) { $('eco-form-erro').textContent = r.erro; return; } // a validação do economia.py, numa linha
    const variante = $('eco-variante').value;
    for (const id of ['eco-entrada', 'eco-saida', 'eco-custo', 'eco-notas']) $(id).value = '';
    $('eco-variante').value = variante === 'com' ? 'sem' : 'com'; // a próxima costuma ser a outra variante da mesma tarefa
    dizer('Resultado do teste A/B guardado!');
    await carregar(true);
  });
  async function remover(r) {
    if (removendo !== r.id) { // primeiro clique: só pede a confirmação
      removendo = r.id;
      desenharAB();
      setTimeout(() => { if (removendo === r.id) { removendo = null; if (dados) desenharAB(); } }, 4000);
      return;
    }
    removendo = null;
    const x = await chamar(() => window.widget.economiaABRemover(r.id));
    if (!x.ok) { $('eco-form-erro').textContent = x.erro; return; }
    await carregar(true);
  }

  $('cer-economia').addEventListener('click', abrir);
  $('eco-voltar').addEventListener('click', fechar);
  $('eco-atualizar').addEventListener('click', () => carregar(true));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && emTela && aberto && $('cer-dialogo').classList.contains('oculto')) fechar(); });
  // a janela mudou de largura: redesenha só os gráficos (os números não mudam)
  new ResizeObserver(() => { if (aberto && emTela && $('eco-semanal').clientWidth !== larguraDesenhada) requestAnimationFrame(desenharGraficos); }).observe($('cer-eco'));

  return {
    visivel(v) {
      emTela = v;
      if (v && aberto) carregar(false); // voltou para a aba com a subaba aberta: refaz se passou de 10 s, senão só redesenha
    },
  };
})();

// ---------- Grafo 3D do cérebro (tela 2 da aba Cérebro) ----------
// Cada projeto é o centro de uma "estrela" (com a cor dele); cada conversa e cada estado é uma bolinha ligada ao seu projeto;
// conversas com 2+ palavras-chave em comum se ligam (dados: cerebro/tools/grafo.py, só leitura). 3D feito à mão num <canvas>
// 2D (perspectiva, névoa pela profundidade), sem biblioteca. LEVEZA: a simulação que organiza as bolinhas roda alguns segundos e
// PARA; depois disso só se desenha quando você mexe (nenhum laço parado). Fora da tela, nada roda.
// Mouse: arrastar o fundo = girar · roda = ampliar (na direção do cursor) · botão direito ou Shift+arrastar = mover a vista ·
// arrastar uma bolinha = mover o arquivo (os vizinhos acompanham; ela fica onde você soltou) · clique = detalhes · duplo clique = abrir.
// Dados meramente ilustrativos para o modo visual "cheio" (zero escrita em disco, zero tokens gastos)
const DADOS_ILUSTRATIVOS_CEREBRO = (() => {
  const hubs = [
    { id: 'projeto:Rede Neural & IA', t: 'p', n: 'Rede Neural & IA', p: 'Rede Neural & IA', cor: '#8b5cf6', ilustrativo: true },
    { id: 'projeto:Banco de Memória', t: 'p', n: 'Banco de Memória', p: 'Banco de Memória', cor: '#06b6d4', ilustrativo: true },
    { id: 'projeto:Agentes Autônomos', t: 'p', n: 'Agentes Autônomos', p: 'Agentes Autônomos', cor: '#10b981', ilustrativo: true },
    { id: 'projeto:Visão Computacional', t: 'p', n: 'Visão Computacional', p: 'Visão Computacional', cor: '#f59e0b', ilustrativo: true },
    { id: 'projeto:Síntese e Voz', t: 'p', n: 'Síntese e Voz', p: 'Síntese e Voz', cor: '#ec4899', ilustrativo: true },
  ];

  const itens = [
    // Rede Neural & IA
    { p: 'Rede Neural & IA', t: 'e', a: 'estado/rede-neural-ia.md', n: 'estado: Rede Neural & IA', d: '2026-10-29', k: ['ia', 'rede', 'modelo'] },
    { p: 'Rede Neural & IA', t: 'c', a: 'conversas/2026-10-15_arquitetura-transformer-atencao.md', n: 'Arquitetura Transformer e Mecanismos de Atenção', d: '2026-10-15', k: ['transformer', 'atencao', 'pesos', 'qkv', 'camadas'] },
    { p: 'Rede Neural & IA', t: 'c', a: 'conversas/2026-10-18_fine-tuning-lora-adaptadores.md', n: 'Fine-Tuning com LoRA e Adaptadores', d: '2026-10-18', k: ['lora', 'fine-tuning', 'treinamento', 'pesos', 'memoria'] },
    { p: 'Rede Neural & IA', t: 'c', a: 'conversas/2026-10-22_quantizacao-modelos-gguf-awq.md', n: 'Quantização de Modelos GGUF e AWQ 4-bit', d: '2026-10-22', k: ['quantizacao', 'gguf', 'awq', 'vram', 'inferencia'] },
    { p: 'Rede Neural & IA', t: 'c', a: 'conversas/2026-10-25_inferencia-especulativa-tokens.md', n: 'Inferência Especulativa e Geração Rápida', d: '2026-10-25', k: ['inferencia', 'latencia', 'tokens', 'gpu'] },
    { p: 'Rede Neural & IA', t: 'c', a: 'conversas/2026-10-08_otimizacao-compilador-torch.md', n: 'Otimização com Compilador TorchDynamo', d: '2026-10-08', k: ['compilador', 'torch', 'kernel', 'gpu', 'latencia'] },
    { p: 'Rede Neural & IA', t: 'c', a: 'conversas/2026-10-09_alinhamento-dpo-preferencias.md', n: 'Alinhamento Direto por Preferência (DPO)', d: '2026-10-09', k: ['dpo', 'alinhamento', 'recompensa', 'feedback'] },

    // Banco de Memória
    { p: 'Banco de Memória', t: 'e', a: 'estado/banco-de-memoria.md', n: 'estado: Banco de Memória', d: '2026-10-29', k: ['memoria', 'dados', 'vetores'] },
    { p: 'Banco de Memória', t: 'c', a: 'conversas/2026-10-12_pesquisa-embeddings-vetoriais.md', n: 'Embeddings Vetoriais e Busca Cosseno', d: '2026-10-12', k: ['embeddings', 'vetores', 'similaridade', 'cosseno'] },
    { p: 'Banco de Memória', t: 'c', a: 'conversas/2026-10-16_pipeline-rag-busca-hibrida.md', n: 'Pipeline RAG e Busca Híbrida BM25', d: '2026-10-16', k: ['rag', 'bm25', 'busca-hibrida', 'contexto', 'recuperacao'] },
    { p: 'Banco de Memória', t: 'c', a: 'conversas/2026-10-20_cache-semantico-latencia.md', n: 'Cache Semântico e Redução de Latência', d: '2026-10-20', k: ['cache', 'semantico', 'latencia', 'redis', 'tokens'] },
    { p: 'Banco de Memória', t: 'c', a: 'conversas/2026-10-27_grafo-conhecimento-entidades.md', n: 'Grafo de Conhecimento e Extração de Entidades', d: '2026-10-27', k: ['grafo', 'entidades', 'triplas', 'nos', 'relacoes'] },
    { p: 'Banco de Memória', t: 'c', a: 'conversas/2026-10-07_indices-hnsw-escalabilidade.md', n: 'Índices HNSW e Grafo de Proximidade', d: '2026-10-07', k: ['hnsw', 'vetores', 'grafo', 'busca-hibrida'] },
    { p: 'Banco de Memória', t: 'c', a: 'conversas/2026-10-10_compressao-vetorial-pq.md', n: 'Compressão Vetorial e Product Quantization', d: '2026-10-10', k: ['quantizacao', 'compressao', 'memoria', 'vetores'] },

    // Agentes Autônomos
    { p: 'Agentes Autônomos', t: 'e', a: 'estado/agentes-autonomos.md', n: 'estado: Agentes Autônomos', d: '2026-10-29', k: ['agentes', 'autonomia', 'ferramentas'] },
    { p: 'Agentes Autônomos', t: 'c', a: 'conversas/2026-10-14_agente-coordenador-enxame.md', n: 'Coordenação de Enxame de Agentes', d: '2026-10-14', k: ['enxame', 'coordenador', 'subagentes', 'mensagens'] },
    { p: 'Agentes Autônomos', t: 'c', a: 'conversas/2026-10-19_planejamento-mcts-raciocinio.md', n: 'Planejamento MCTS para Decisão de Código', d: '2026-10-19', k: ['mcts', 'planejamento', 'arvore', 'decisao', 'codigo'] },
    { p: 'Agentes Autônomos', t: 'c', a: 'conversas/2026-10-24_execucao-sandbox-ferramentas.md', n: 'Sandbox e Isolamento de Processos PTY', d: '2026-10-24', k: ['sandbox', 'seguranca', 'pty', 'processos', 'bash'] },
    { p: 'Agentes Autônomos', t: 'c', a: 'conversas/2026-10-28_auto-correcao-loops-reflexao.md', n: 'Loops de Auto-Correção e Reflexão Crítica', d: '2026-10-28', k: ['reflexao', 'auto-correcao', 'feedback', 'testes'] },
    { p: 'Agentes Autônomos', t: 'c', a: 'conversas/2026-10-05_protocolo-mcp-servidores.md', n: 'Protocolo de Contexto de Modelo (MCP)', d: '2026-10-05', k: ['mcp', 'protocolo', 'ferramentas', 'sandbox'] },
    { p: 'Agentes Autônomos', t: 'c', a: 'conversas/2026-10-06_gestao-contexto-janela-deslizante.md', n: 'Janela Deslizante e Compressão de Histórico', d: '2026-10-06', k: ['contexto', 'historico', 'tokens', 'cache'] },

    // Visão Computacional
    { p: 'Visão Computacional', t: 'e', a: 'estado/visao-computacional.md', n: 'estado: Visão Computacional', d: '2026-10-29', k: ['visao', 'imagem', 'camera'] },
    { p: 'Visão Computacional', t: 'c', a: 'conversas/2026-10-13_reconhecimento-espacial-3d.md', n: 'Reconhecimento Espacial e Detecção 3D', d: '2026-10-13', k: ['espacial', '3d', 'projecao', 'camera', 'sensores'] },
    { p: 'Visão Computacional', t: 'c', a: 'conversas/2026-10-17_segmentacao-mascaras-zero-shot.md', n: 'Segmentação Semântica Zero-Shot com SAM', d: '2026-10-17', k: ['segmentacao', 'sam', 'mascaras', 'visao', 'zero-shot'] },
    { p: 'Visão Computacional', t: 'c', a: 'conversas/2026-10-21_ocr-multimodal-estruturado.md', n: 'OCR Multimodal e Extração de Documentos', d: '2026-10-21', k: ['ocr', 'documentos', 'tabelas', 'visao', 'multimodal'] },
    { p: 'Visão Computacional', t: 'c', a: 'conversas/2026-10-26_rastreamento-video-tempo-real.md', n: 'Rastreamento de Objetos em Tempo Real', d: '2026-10-26', k: ['video', 'rastreamento', 'fps', 'yolo', 'tempo-real'] },
    { p: 'Visão Computacional', t: 'c', a: 'conversas/2026-10-03_reconstrucao-radiance-fields-nerf.md', n: 'Campos de Radiância Neural (NeRF 3D)', d: '2026-10-03', k: ['nerf', '3d', 'projecao', 'camera'] },

    // Síntese e Voz
    { p: 'Síntese e Voz', t: 'e', a: 'estado/sintese-e-voz.md', n: 'estado: Síntese e Voz', d: '2026-10-29', k: ['audio', 'voz', 'fala'] },
    { p: 'Síntese e Voz', t: 'c', a: 'conversas/2026-10-11_sintese-neural-prosodia.md', n: 'Síntese Neural de Fala com Prosódia', d: '2026-10-11', k: ['tts', 'prosodia', 'fonemas', 'audio', 'sintese'] },
    { p: 'Síntese e Voz', t: 'c', a: 'conversas/2026-10-23_transcricao-whisper-streaming.md', n: 'Transcrição Streaming Whisper Baixa Latência', d: '2026-10-23', k: ['whisper', 'transcricao', 'streaming', 'audio', 'microfone'] },
    { p: 'Síntese e Voz', t: 'c', a: 'conversas/2026-10-29_clonagem-vocal-poucas-amostras.md', n: 'Clonagem Vocal Poucas Amostras', d: '2026-10-29', k: ['clonagem', 'voz', 'amostras', 'latente'] },
    { p: 'Síntese e Voz', t: 'c', a: 'conversas/2026-10-04_cancelamento-ruido-neural.md', n: 'Cancelamento Ativo de Ruído Neural', d: '2026-10-04', k: ['audio', 'ruido', 'filtros', 'latencia'] },
  ];

  const nos = [...hubs, ...itens.map((it) => ({ id: it.a, ...it, ilustrativo: true }))];
  const hubIdx = new Map(hubs.map((h, i) => [h.p, i]));
  const ligacoes = [];
  const mapa = new Map(itens.map((it) => [it.a, it]));

  itens.forEach((it, idx) => {
    const noIdx = hubs.length + idx;
    const hIdx = hubIdx.get(it.p);
    if (hIdx !== undefined) ligacoes.push([noIdx, hIdx, 1, 'p']);
  });

  for (let i = 0; i < itens.length; i++) {
    for (let j = i + 1; j < itens.length; j++) {
      const ki = new Set(itens[i].k || []);
      const comuns = (itens[j].k || []).filter((k) => ki.has(k));
      if (comuns.length > 0) ligacoes.push([hubs.length + i, hubs.length + j, Math.min(comuns.length, 3), 'k']);
    }
  }

  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      ligacoes.push([i, j, 1, 'p']);
    }
  }

  return { nos, ligacoes, itens, hubs, mapa };
})();

function fundirComDemoCerebro(dadosReais) {
  if (!dadosReais || !dadosReais.nos) return DADOS_ILUSTRATIVOS_CEREBRO;
  const offset = dadosReais.nos.length;
  const nosFundidos = [...dadosReais.nos, ...DADOS_ILUSTRATIVOS_CEREBRO.nos];
  const ligsFundidas = [
    ...(dadosReais.ligacoes || []),
    ...DADOS_ILUSTRATIVOS_CEREBRO.ligacoes.map(([a, b, w, t]) => [a + offset, b + offset, w, t]),
  ];
  return { nos: nosFundidos, ligacoes: ligsFundidas };
}

function gerarTextoIlustrativo(arquivo) {
  const meta = DADOS_ILUSTRATIVOS_CEREBRO.mapa.get(arquivo);
  const titulo = meta ? meta.n : arquivo;
  const proj = meta ? meta.p : 'Demonstração';
  const data = meta ? meta.d : '2026-10-29';
  const chaves = meta && meta.k ? meta.k.join(', ') : 'ilustrativo, demo, visual';
  return `# ✦ [MODO ILUSTRATIVO] ${titulo}\n\n`
    + `> [!NOTE]\n`
    + `> Este arquivo é meramente ilustrativo para demonstração visual do cérebro.\n`
    + `> Ele existe somente na memória de exibição: zero espaço no disco e zero tokens gastos.\n\n`
    + `palavras-chave: ${chaves}\n`
    + `data: ${data} | origem: antigravity | projeto: ${proj}\n\n`
    + `- Tópico demonstrativo estruturado para simulação de grafo de conhecimento.\n`
    + `- Arquitetura de nós interconectados por afinidade conceitual e termos em comum.\n`
    + `- Representação tridimensional de memórias ativas com cálculo de dispersão por molas.\n`
    + `- Integração harmoniosa com o ecossistema do widget sem alterar o cérebro real.\n`
    + `- Para desativar estas memórias visuais, clique no botão [✦ cheio] no topo.`;
}

const grafoCer = (() => {
  const $ = (id) => document.getElementById(id);
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const aba = $('aba-cerebro');
  const canvas = $('graf-canvas');
  const area = $('graf-area');
  const INTERVALO = 15000; // reabrir em menos de 15 s não recarrega os dados
  const RAIO = { p: 7.5, e: 4.8, c: 3.6 };
  let passoMs = 0;
  let ultimoMovido = -1; // a última bolinha que você arrastou (diagnóstico)
  let passosFeitos = 0;
  let quadros = 0; // quantos quadros o grafo desenhou (diagnóstico: parado, não deve subir)
  const CELULA = 55; // grade da repulsão (só bolinhas próximas se empurram)

  let aberto = false;
  let emTela = false;
  let carregando = false;
  let ultimaCarga = 0;
  let modoDemo = false;
  let dadosReais = null;
  let nos = []; // {id,t,n,a,p,d,k,cor,x,y,z,vx,vy,vz,grau,preso}
  let ligs = []; // [a, b, peso, tipo]
  let viz = []; // vizinhos de cada nó
  let hubs = []; // índices dos projetos
  let proj = []; // projeção da última imagem: {x, y, z, s, r, vis}
  let ordem = [];
  const cam = { yaw: 0.7, pitch: -0.32, dist: 900, panX: 0, panY: 0 };
  let foco = 500;
  let camAnim = null; // {de, para, t0, dur}
  let alpha = 0;
  let simulando = false;
  let quadro = 0;
  let mexeuNaCamera = false;
  let enquadrarAoParar = false; // só depois de carregar, de [reorganizar] ou do R: nunca depois de você mexer
  let hover = -1;
  let selecionado = -1;
  let filtroTexto = '';
  let casam = null; // Set de índices que combinam com o filtro
  let arraste = null;
  let W = 0;
  let H = 0;
  let ctx = null;
  let ultimoMs = 0;

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };
  const botao = (rotulo, aoClicar) => {
    const b = el('button', 'botao-cmd', IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    return b;
  };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const corDe = (n) => (n.cor && /^#[0-9a-f]{6}$/i.test(n.cor) ? n.cor : '#9aa4b2');
  const claras = new Map();
  const clara = (hex) => { // a cor do projeto 25% mais perto do branco: os arquivos brilham como no Obsidian
    if (!claras.has(hex)) claras.set(hex, 'rgb(' + rgb(hex).map((v) => Math.round(v + (255 - v) * 0.25)).join(',') + ')');
    return claras.get(hex);
  };

  // ----- dados -----
  async function carregar(forcar) {
    if (carregando || (!forcar && nos.length && Date.now() - ultimaCarga < INTERVALO)) { pedir(); return; }
    carregando = true;
    status('carregando o cérebro...');
    let r;
    try { r = await window.widget.cerebroGrafo(); } catch (erro) { r = { ok: false, erro: erro.message }; }
    carregando = false;
    if (!r.ok) { status(r.tipo === 'semPython' ? 'o grafo precisa do Python 3' : 'não consegui ler o cérebro: ' + (r.erro || '')); return; }
    ultimaCarga = Date.now();
    dadosReais = r.dados;
    montar(modoDemo ? fundirComDemoCerebro(dadosReais) : dadosReais);
  }
  function montar(d) {
    const antigos = new Map(nos.map((n) => [n.id, n]));
    const corProjeto = new Map(d.nos.filter((n) => n.t === 'p').map((n) => [n.p, n.cor]));
    nos = d.nos.map((n) => ({ ...n, cor: n.cor || corProjeto.get(n.p), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grau: 0, preso: false }));
    ligs = d.ligacoes;
    viz = nos.map(() => []);
    for (const [a, b] of ligs) { viz[a].push(b); viz[b].push(a); nos[a].grau++; nos[b].grau++; }
    hubs = nos.map((n, i) => (n.t === 'p' ? i : -1)).filter((i) => i >= 0);
    // posições: o que já existia fica onde estava; projetos novos numa esfera; arquivos novos perto do seu projeto
    const rh = 70 + 45 * Math.sqrt(hubs.length);
    hubs.forEach((i, k) => {
      const v = antigos.get(nos[i].id);
      if (v) { Object.assign(nos[i], { x: v.x, y: v.y, z: v.z, preso: v.preso }); return; }
      const fi = Math.acos(1 - 2 * (k + 0.5) / hubs.length);
      const th = Math.PI * (1 + Math.sqrt(5)) * k;
      Object.assign(nos[i], { x: rh * Math.cos(th) * Math.sin(fi), y: rh * Math.cos(fi), z: rh * Math.sin(th) * Math.sin(fi) });
    });
    const hubDe = new Map(hubs.map((i) => [nos[i].p, i]));
    let novos = 0;
    nos.forEach((n) => {
      if (n.t === 'p') return;
      const v = antigos.get(n.id);
      if (v) { Object.assign(n, { x: v.x, y: v.y, z: v.z, preso: v.preso }); return; }
      novos++;
      const h = nos[hubDe.get(n.p)] || { x: 0, y: 0, z: 0 };
      const r = 25 + Math.random() * 45;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      Object.assign(n, { x: h.x + r * Math.sin(b) * Math.cos(a), y: h.y + r * Math.cos(b), z: h.z + r * Math.sin(b) * Math.sin(a) });
    });
    proj = nos.map(() => ({ x: 0, y: 0, z: 0, s: 1, r: 1, vis: false }));
    ordem = nos.map((_, i) => i);
    if (selecionado >= nos.length) selecionado = -1;
    hover = -1;
    aplicarFiltro();
    if (novos || !antigos.size) { enquadrarAoParar = true; reaquecer(1); }
    else pedir();
    if (!mexeuNaCamera) enquadrar(false);
  }

  // ----- simulação de forças (curta: esfria e para) -----
  function reaquecer(a) {
    alpha = Math.max(alpha, a);
    simulando = nos.length > 0;
    pedir();
  }
  function passo() {
    const n = nos.length;
    // molas: arquivo -> projeto (curtas) e palavras-chave (mais longas e fracas)
    for (const [a, b, peso, tipo] of ligs) {
      const A = nos[a];
      const B = nos[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const dz = B.z - A.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const alvo = tipo === 'p' ? 32 + 5 * Math.sqrt(B.grau) : 75;
      const k = (tipo === 'p' ? 0.09 : 0.025 * Math.min(peso, 4)) * alpha;
      const f = ((d - alvo) / d) * k;
      const wa = B.grau / (A.grau + B.grau);
      const wb = 1 - wa;
      if (!A.preso) { A.vx += dx * f * wa; A.vy += dy * f * wa; A.vz += dz * f * wa; }
      if (!B.preso) { B.vx -= dx * f * wb; B.vy -= dy * f * wb; B.vz -= dz * f * wb; }
    }
    // repulsão entre vizinhos próximos (grade 3D: cada bolinha só olha as 27 células em volta)
    const grade = new Map();
    const chave = (cx, cy, cz) => ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);
    for (let i = 0; i < n; i++) {
      const N = nos[i];
      const c = chave(Math.floor(N.x / CELULA), Math.floor(N.y / CELULA), Math.floor(N.z / CELULA));
      const lista = grade.get(c);
      if (lista) lista.push(i); else grade.set(c, [i]);
    }
    const forca = 260 * alpha;
    const lim2 = CELULA * CELULA;
    for (let i = 0; i < n; i++) {
      const A = nos[i];
      const cx = Math.floor(A.x / CELULA);
      const cy = Math.floor(A.y / CELULA);
      const cz = Math.floor(A.z / CELULA);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const lista = grade.get(chave(cx + ox, cy + oy, cz + oz));
        if (!lista) continue;
        for (const j of lista) {
          if (j <= i) continue;
          const B = nos[j];
          let dx = A.x - B.x;
          let dy = A.y - B.y;
          let dz = A.z - B.z;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > lim2) continue;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = 0.5; }
          const d = Math.sqrt(d2);
          const f = forca / (d2 + 4) / d;
          if (!A.preso) { A.vx += dx * f; A.vy += dy * f; A.vz += dz * f; }
          if (!B.preso) { B.vx -= dx * f; B.vy -= dy * f; B.vz -= dz * f; }
        }
      }
    }
    // projetos se afastam entre si de longe (separa as estrelas)
    for (let x = 0; x < hubs.length; x++) for (let y = x + 1; y < hubs.length; y++) {
      const A = nos[hubs[x]];
      const B = nos[hubs[y]];
      const dx = A.x - B.x;
      const dy = A.y - B.y;
      const dz = A.z - B.z;
      const d2 = dx * dx + dy * dy + dz * dz + 100;
      const f = (14000 + 300 * (A.grau + B.grau)) * alpha / d2 / Math.sqrt(d2);
      if (!A.preso) { A.vx += dx * f; A.vy += dy * f; A.vz += dz * f; }
      if (!B.preso) { B.vx -= dx * f; B.vy -= dy * f; B.vz -= dz * f; }
    }
    // gravidade leve para o centro, atrito e movimento
    const g = 0.004 * alpha;
    for (const N of nos) {
      if (N.preso) { N.vx = N.vy = N.vz = 0; continue; }
      N.vx = (N.vx - N.x * g) * 0.58;
      N.vy = (N.vy - N.y * g) * 0.58;
      N.vz = (N.vz - N.z * g) * 0.58;
      N.x += N.vx;
      N.y += N.vy;
      N.z += N.vz;
    }
  }

  // ----- laço: só existe enquanto há simulação ou animação de câmera -----
  function pedir() {
    if (!quadro && emTela && aberto) quadro = requestAnimationFrame(animar);
  }
  function animar(agora) {
    quadro = 0;
    quadros++;
    if (simulando) {
      const passos = nos.length > 2500 ? 1 : nos.length > 800 ? 2 : 3;
      const tp = performance.now();
      const esfria = nos.length > 1500 ? 0.968 : 0.978; // grafo grande: esfria mais rápido (menos passos)
      for (let i = 0; i < passos; i++) { passo(); alpha *= esfria; }
      passoMs = (performance.now() - tp) / passos;
      passosFeitos += passos;
      if (alpha < 0.012) { simulando = false; alpha = 0; if (enquadrarAoParar && !mexeuNaCamera) enquadrar(true); enquadrarAoParar = false; }
    }
    if (camAnim) {
      const t = limitar((agora - camAnim.t0) / camAnim.dur, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      for (const k of Object.keys(camAnim.para)) cam[k] = camAnim.de[k] + (camAnim.para[k] - camAnim.de[k]) * e;
      if (t >= 1) camAnim = null;
    }
    desenhar();
    if (simulando || camAnim) pedir();
  }

  // ----- câmera -----
  function medir() {
    ({ ctx, w: W, h: H } = prepararCanvas(canvas));
    foco = Math.max(200, Math.min(W, H) * 1.15);
  }
  function enquadrar(animado) {
    if (!nos.length) return;
    let cx = 0; let cy = 0; let cz = 0;
    for (const N of nos) { cx += N.x; cy += N.y; cz += N.z; }
    cx /= nos.length; cy /= nos.length; cz /= nos.length;
    const ds = nos.map((N) => Math.hypot(N.x - cx, N.y - cy, N.z - cz)).sort((a, b) => a - b);
    const raio = Math.max(60, ds[Math.floor(ds.length * 0.96)] || 60);
    if (W) medir();
    const dist = (raio * foco) / (0.6 * Math.max(120, Math.min(W, H))) + raio;
    irPara({ dist, panX: 0, panY: 0 }, animado ? 600 : 0);
  }
  function irPara(para, dur) {
    if (!dur) { Object.assign(cam, para); camAnim = null; pedir(); return; }
    camAnim = { de: { ...cam }, para, t0: performance.now(), dur };
    pedir();
  }
  function girarPonto(N) {
    const cyw = Math.cos(cam.yaw); const syw = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
    const x1 = N.x * cyw + N.z * syw;
    const z1 = -N.x * syw + N.z * cyw;
    return { x: x1, y: N.y * cp - z1 * sp, z: N.y * sp + z1 * cp };
  }
  function centrarEm(i) {
    const p = girarPonto(nos[i]);
    const dist = limitar(cam.dist * 0.55, 120, cam.dist);
    const s = foco / (p.z + dist);
    irPara({ dist, panX: -p.x * s, panY: -p.y * s }, 650);
  }

  // ----- desenho -----
  function projetar() {
    const cyw = Math.cos(cam.yaw); const syw = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
    const ox = W / 2 + cam.panX;
    const oy = H / 2 + cam.panY;
    for (let i = 0; i < nos.length; i++) {
      const N = nos[i];
      const x1 = N.x * cyw + N.z * syw;
      const z1 = -N.x * syw + N.z * cyw;
      const y2 = N.y * cp - z1 * sp;
      const z2 = N.y * sp + z1 * cp + cam.dist;
      const P = proj[i];
      P.vis = z2 > 8;
      P.z = z2;
      P.s = foco / Math.max(z2, 8);
      P.x = ox + x1 * P.s;
      P.y = oy + y2 * P.s;
      const base = N.t === 'p' ? RAIO.p + 1.3 * Math.sqrt(N.grau) : RAIO[N.t];
      P.r = Math.max(N.t === 'p' ? 3 : 1.7, base * P.s * 0.55);
    }
  }
  function desenhar() {
    const t0 = performance.now();
    if (!ctx || canvas.clientWidth !== W || canvas.clientHeight !== H) medir();
    ctx.clearRect(0, 0, W, H);
    if (!nos.length) { status(carregando ? 'carregando...' : 'o cérebro está vazio'); return; }
    projetar();
    let zmin = Infinity; let zmax = -Infinity;
    for (const P of proj) if (P.vis) { if (P.z < zmin) zmin = P.z; if (P.z > zmax) zmax = P.z; }
    const faixa = Math.max(1, zmax - zmin);
    const nevoa = (z) => limitar(1.08 - ((z - zmin) / faixa) * 0.6, 0.45, 1);
    const foco_ = selecionado >= 0 ? selecionado : hover;
    const vizFoco = foco_ >= 0 ? new Set([foco_, ...viz[foco_]]) : null;
    // selecionar (ou filtrar) apaga o resto; só passar o mouse apenas destaca, sem escurecer o grafo
    const vizSel = selecionado >= 0 ? vizFoco : null;
    const apagado = (i) => (casam && !casam.has(i)) || (vizSel && !vizSel.has(i));
    // ligações (as de fora do foco ficam bem fracas)
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(150, 165, 190, 0.16)';
    ctx.beginPath();
    for (const [a, b] of ligs) {
      const A = proj[a]; const B = proj[b];
      if (!A.vis || !B.vis || apagado(a) || apagado(b)) continue;
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
    }
    ctx.stroke();
    if (vizSel || casam) {
      ctx.strokeStyle = 'rgba(150, 165, 190, 0.05)';
      ctx.beginPath();
      for (const [a, b] of ligs) {
        const A = proj[a]; const B = proj[b];
        if (!A.vis || !B.vis || !(apagado(a) || apagado(b))) continue;
        ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
    }
    if (foco_ >= 0) {
      ctx.strokeStyle = corDe(nos[foco_]);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const j of viz[foco_]) { ctx.moveTo(proj[foco_].x, proj[foco_].y); ctx.lineTo(proj[j].x, proj[j].y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // bolinhas, do fundo para a frente
    ordem.sort((a, b) => proj[b].z - proj[a].z);
    for (const i of ordem) {
      const P = proj[i];
      if (!P.vis || P.x < -50 || P.y < -50 || P.x > W + 50 || P.y > H + 50) continue;
      const N = nos[i];
      const cor = corDe(N);
      const a = apagado(i) ? 0.12 : nevoa(P.z);
      if (N.t === 'p' && a > 0.2) { // brilho do centro de cada estrela
        const [r, g, b] = rgb(cor);
        const gr = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, P.r * 4);
        gr.addColorStop(0, `rgba(${r},${g},${b},${0.45 * a})`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(P.x, P.y, P.r * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = N.t === 'e' ? '#ffffff' : N.t === 'c' ? clara(cor) : cor;
      ctx.beginPath(); ctx.arc(P.x, P.y, P.r, 0, Math.PI * 2); ctx.fill();
      if (N.t === 'e') { ctx.strokeStyle = cor; ctx.lineWidth = Math.max(1, P.r * 0.45); ctx.stroke(); }
      if (N.preso) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 2, 0, Math.PI * 2); ctx.stroke(); }
      if (i === selecionado) { ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 3.5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    rotulos(vizFoco, apagado);
    if (hover >= 0 && hover !== selecionado) dica(hover);
    const ms = performance.now() - t0;
    ultimoMs = ms;
    status(`${nos.length - hubs.length} arquivos · ${hubs.length} projetos · ${ligs.length} ligações` + (simulando ? ' · organizando...' : '')
      + (casam ? ` · ${casam.size} combinam` : ''));
    canvas.dataset.estado = JSON.stringify({ yaw: +cam.yaw.toFixed(3), pitch: +cam.pitch.toFixed(3), dist: Math.round(cam.dist), panX: Math.round(cam.panX),
      panY: Math.round(cam.panY), simulando, quadros, passoMs: Math.round(passoMs * 10) / 10, passos: passosFeitos, nos: nos.length, sel: selecionado >= 0 ? nos[selecionado].id : null, ms: Math.round(ms * 10) / 10 });
    // onde estão os centros (e os vizinhos do selecionado) na tela: leitura para os testes automáticos e acessibilidade
    const ponto = (i) => [nos[i].id, Math.round(proj[i].x), Math.round(proj[i].y), Math.round(proj[i].r)];
    if (ultimoMovido >= 0 && nos[ultimoMovido]) { const M = nos[ultimoMovido]; canvas.dataset.movidoAgora = JSON.stringify({ id: M.id, x: Math.round(M.x), y: Math.round(M.y), z: Math.round(M.z), preso: M.preso }); }
    canvas.dataset.pontos = JSON.stringify({ hubs: hubs.filter((i) => proj[i].vis).map(ponto),
      vizinhos: selecionado >= 0 ? viz[selecionado].filter((i) => proj[i].vis).slice(0, 12).map(ponto) : [] });
  }
  function rotulos(vizFoco, apagado) {
    ctx.font = (IOS ? '11px -apple-system, "Segoe UI", sans-serif' : '11px Consolas, monospace');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const escrever = (i, forte) => {
      const P = proj[i];
      const N = nos[i];
      let txt = N.n;
      if (txt.length > 34) txt = txt.slice(0, 32) + '…';
      ctx.globalAlpha = forte ? 1 : Math.min(0.85, Math.max(0.35, P.r / 6));
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const w = ctx.measureText(txt).width;
      ctx.fillRect(P.x - w / 2 - 2, P.y + P.r + 2, w + 4, 13);
      ctx.fillStyle = N.t === 'p' ? corDe(N) : '#e6e6e6';
      ctx.fillText(txt, P.x, P.y + P.r + 3);
      ctx.globalAlpha = 1;
    };
    const ja = new Set();
    for (const i of hubs) if (proj[i].vis && !apagado(i)) { escrever(i, true); ja.add(i); }
    if (vizFoco) for (const i of vizFoco) if (!ja.has(i) && proj[i].vis && vizFoco.size <= 40) { escrever(i, i === hover || i === selecionado); ja.add(i); }
    // ampliado: os nomes das bolinhas grandes o bastante (no máximo 45, as mais próximas primeiro)
    let n = 0;
    for (let k = ordem.length - 1; k >= 0 && n < 45; k--) {
      const i = ordem[k];
      if (ja.has(i) || !proj[i].vis || proj[i].r < 4.5 || apagado(i)) continue;
      escrever(i, false);
      n++;
    }
  }
  function dica(i) {
    const P = proj[i];
    const N = nos[i];
    const linhas = [N.n, N.t === 'p' ? `projeto · ${viz[i].length} arquivo(s)` : `${N.t === 'e' ? 'estado' : 'conversa'} · ${N.p}${N.d ? ' · ' + N.d : ''}`];
    ctx.font = (IOS ? '11px -apple-system, "Segoe UI", sans-serif' : '11px Consolas, monospace');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const w = Math.max(...linhas.map((l) => ctx.measureText(l).width)) + 12;
    let x = P.x + P.r + 8;
    let y = P.y - 10;
    if (x + w > W - 4) x = P.x - P.r - 8 - w;
    if (y + 34 > H) y = H - 36;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, 32);
    ctx.fillStyle = corDe(N);
    ctx.fillRect(x, y, 2, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(linhas[0], x + 7, y + 3);
    ctx.fillStyle = '#9aa0a6';
    ctx.fillText(linhas[1], x + 7, y + 17);
  }
  function status(t) { $('graf-status').textContent = t; }

  // ----- escolher, filtrar, detalhes -----
  function acharNo(mx, my) {
    // a bolinha cujo centro está mais perto do cursor em proporção ao tamanho dela (clicar no meio de um projeto pega o
    // projeto, mesmo com um arquivo pequeno passando na frente); empate: a mais da frente
    let melhor = -1;
    let nota = Infinity;
    for (let i = 0; i < nos.length; i++) {
      const P = proj[i];
      if (!P.vis) continue;
      const dx = P.x - mx; const dy = P.y - my;
      const rr = (P.r + 4) * (P.r + 4);
      const d2 = dx * dx + dy * dy;
      if (d2 > rr) continue;
      const n = d2 / rr + P.z * 1e-6;
      if (n < nota) { nota = n; melhor = i; }
    }
    return melhor;
  }
  function aplicarFiltro() {
    const f = norm(filtroTexto.trim());
    if (!f) { casam = null; return; }
    casam = new Set();
    nos.forEach((N, i) => {
      if (norm(N.n).includes(f) || norm(N.p).includes(f) || (N.k || []).some((k) => norm(k).includes(f)) || norm(N.a).includes(f)) casam.add(i);
    });
  }
  function selecionar(i) {
    selecionado = i;
    const info = $('graf-info');
    if (i < 0) { info.classList.add('oculto'); pedir(); return; }
    const N = nos[i];
    info.style.setProperty('--cor', corDe(N));
    const tipo = { p: 'projeto', c: 'conversa', e: 'estado do projeto' }[N.t];
    const meta = N.t === 'p' ? `${tipo} · ${viz[i].length} arquivo(s) ligado(s)` : `${tipo} · ${N.p}${N.d ? ' · ' + N.d : ''} · ${viz[i].length} ligação(ões)`;
    const acoes = el('div', 'graf-acoes');
    if (N.a) acoes.append(botao('[abrir]', () => abrirArquivo(N.a)));
    acoes.append(botao('[centralizar aqui]', () => centrarEm(i)));
    if (N.preso) acoes.append(botao('[soltar]', () => { N.preso = false; reaquecer(0.25); selecionar(i); }));
    acoes.append(botao('[x]', () => selecionar(-1)));
    const baixo = area.clientHeight < 260; // janela pequena: o cartão fica numa linha só, para não cobrir o grafo
    info.classList.toggle('compacto', baixo);
    info.replaceChildren(el('div', 'graf-nome', N.n), ...(baixo ? [] : [el('div', 'graf-meta', meta)]),
      ...(N.k && N.k.length && !baixo ? [el('div', 'graf-meta', N.k.join(', '))] : []), acoes);
    info.classList.remove('oculto');
    pedir();
  }
  function abrirArquivo(arquivo) {
    fechar();
    cerebro.abrirArquivo(arquivo);
  }

  // ----- mouse -----
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!nos.length) return;
    canvas.focus({ preventScroll: true });
    const [x, y] = pos(e);
    const i = e.button === 0 && !e.shiftKey ? acharNo(x, y) : -1;
    const tipo = i >= 0 ? 'no' : (e.button === 2 || e.button === 1 || e.shiftKey ? 'mover' : 'girar');
    arraste = { tipo, i, x, y, x0: x, y0: y, moveu: false, presoAntes: i >= 0 ? nos[i].preso : false };
    if (i >= 0) nos[i].preso = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('arrastando');
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (!arraste) {
      const i = acharNo(x, y);
      if (i !== hover) { hover = i; canvas.classList.toggle('sobre', i >= 0); pedir(); }
      return;
    }
    const dx = x - arraste.x;
    const dy = y - arraste.y;
    arraste.x = x; arraste.y = y;
    if (Math.abs(x - arraste.x0) + Math.abs(y - arraste.y0) > 3) arraste.moveu = true;
    if (!arraste.moveu) return;
    camAnim = null;
    if (arraste.tipo === 'girar') {
      cam.yaw += dx * 0.0065;
      cam.pitch = limitar(cam.pitch + dy * 0.0065, -1.45, 1.45);
      mexeuNaCamera = true;
    } else if (arraste.tipo === 'mover') {
      cam.panX += dx; cam.panY += dy;
      mexeuNaCamera = true;
    } else {
      // move a bolinha no plano da tela, na profundidade dela (o inverso da rotação da câmera)
      const N = nos[arraste.i];
      const s = proj[arraste.i].s || 1;
      const vx = dx / s; const vy = dy / s;
      const cyw = Math.cos(cam.yaw); const syw = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
      const z1 = -vy * sp;
      N.x += vx * cyw - z1 * syw;
      N.y += vy * cp;
      N.z += vx * syw + z1 * cyw;
      N.vx = N.vy = N.vz = 0;
      enquadrarAoParar = false;
      reaquecer(0.18); // os vizinhos acompanham
    }
    pedir();
  });
  const soltar = (e) => {
    if (!arraste) return;
    const a = arraste;
    arraste = null;
    canvas.classList.remove('arrastando');
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    if (a.tipo === 'no') {
      const N = nos[a.i];
      if (!a.moveu) { N.preso = a.presoAntes; selecionar(a.i); return; }
      N.preso = true; // fica onde você soltou (o [soltar] ou o [reorganizar] devolvem à simulação)
      ultimoMovido = a.i;
      canvas.dataset.movido = JSON.stringify({ id: N.id, x: Math.round(N.x), y: Math.round(N.y), z: Math.round(N.z) });
      if (selecionado === a.i) selecionar(a.i);
    } else if (!a.moveu) {
      selecionar(-1);
    }
    pedir();
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('pointerleave', () => { if (!arraste && hover >= 0) { hover = -1; canvas.classList.remove('sobre'); pedir(); } });
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = pos(e);
    const i = acharNo(x, y);
    if (i >= 0 && nos[i].a) abrirArquivo(nos[i].a);
    else if (i >= 0) centrarEm(i);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!nos.length) return;
    const [mx, my] = pos(e);
    const antes = cam.dist;
    const depois = limitar(antes * Math.exp(e.deltaY * 0.0012), 40, 40000);
    const razao = antes / depois; // mais perto = tudo maior
    // amplia na direção do cursor: o ponto embaixo do mouse fica (quase) no lugar
    cam.panX = (mx - W / 2) - (mx - W / 2 - cam.panX) * razao;
    cam.panY = (my - H / 2) - (my - H / 2 - cam.panY) * razao;
    cam.dist = depois;
    camAnim = null;
    mexeuNaCamera = true;
    pedir();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') { mexeuNaCamera = false; enquadrar(true); }
    else if (e.key === 'Escape') { if (selecionado >= 0) selecionar(-1); else if (filtroTexto) { $('graf-filtro').value = ''; filtroTexto = ''; aplicarFiltro(); pedir(); } }
  });

  // ----- barra de cima -----
  $('graf-filtro').addEventListener('input', () => { filtroTexto = $('graf-filtro').value; aplicarFiltro(); pedir(); });
  $('graf-filtro').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && casam && casam.size) {
      e.preventDefault();
      // vai até o mais "importante" que combina: projeto primeiro, depois o mais ligado
      const alvo = [...casam].sort((a, b) => (nos[a].t === 'p' ? -1 : 0) - (nos[b].t === 'p' ? -1 : 0) || viz[b].length - viz[a].length)[0];
      selecionar(alvo);
      centrarEm(alvo);
    } else if (e.key === 'Escape') { $('graf-filtro').value = ''; filtroTexto = ''; aplicarFiltro(); pedir(); }
  });
  $('graf-centro').addEventListener('click', () => { mexeuNaCamera = false; enquadrar(true); });
  const bgDemo = $('graf-demo');
  if (bgDemo) bgDemo.addEventListener('click', alternarDemo);
  new ResizeObserver(() => { if (aberto && emTela) { medir(); pedir(); } }).observe(area);

  function atualizarBotoesDemo(ativo) {
    const rotulo = ativo ? (IOS ? '✦ cheio: on' : '[✦ cheio: on]') : (IOS ? '✦ cheio' : '[✦ cheio]');
    const bg = $('graf-demo');
    const bc = $('cer-demo');
    if (bg) { bg.textContent = rotulo; bg.classList.toggle('ativa', ativo); }
    if (bc) { bc.textContent = rotulo; bc.classList.toggle('ativa', ativo); }
  }

  function alternarDemo() {
    modoDemo = !modoDemo;
    atualizarBotoesDemo(modoDemo);
    if (!dadosReais) {
      carregar(true);
      return;
    }
    montar(modoDemo ? fundirComDemoCerebro(dadosReais) : dadosReais);
    enquadrarAoParar = true;
    reaquecer(modoDemo ? 1 : 0.6);
    if (modoDemo) {
      dizer('Cérebro cheio no modo visual! Ficou parecendo uma constelação!');
    } else {
      dizer('Voltei para o cérebro real com as suas memórias.');
    }
    if (typeof cerebro !== 'undefined' && cerebro.aoMudarDemo) {
      cerebro.aoMudarDemo(modoDemo);
    }
  }

  // troca Graph | Search (existe uma nas duas telas); a aba sempre começa no grafo
  const trocas = [...document.querySelectorAll('.cer-troca-btn')];
  const marcarTroca = () => trocas.forEach((b) => b.classList.toggle('ativa', (b.dataset.tela === 'grafo') === aberto));
  trocas.forEach((b) => b.addEventListener('click', () => (b.dataset.tela === 'grafo' ? abrir() : fechar())));
  function abrir() {
    aberto = true;
    aba.classList.add('grafo');
    marcarTroca();
    if (emTela) { medir(); carregar(false); }
  }
  function fechar() {
    aberto = false;
    aba.classList.remove('grafo');
    marcarTroca();
    if (quadro) { cancelAnimationFrame(quadro); quadro = 0; }
  }

  return {
    abrir,
    alternarDemo,
    modoAtivo() { return modoDemo; },
    iniciar() { aberto = true; aba.classList.add('grafo'); marcarTroca(); atualizarBotoesDemo(modoDemo); },
    visivel(v) {
      emTela = v;
      if (!v) { if (quadro) { cancelAnimationFrame(quadro); quadro = 0; } return; } // fora da tela: nada roda (a simulação pausa)
      if (aberto) { medir(); carregar(false); }
    },
  };
})();

// ---------- Manutenção (subaba da aba Cérebro) ----------
// Diagnóstico (sem IA), sinônimos, consolidação, proposta de estado (essas duas usam o Claude Code), índices por projeto e backup.
// Os números e as regras vêm do cerebro/tools/manutencao.py (ponte app/manutencao.js). Nada roda sozinho: o Python só é chamado ao abrir
// a subaba, em [rodar diagnóstico] e a cada clique de ação. Antes de qualquer chamada de IA a tela mostra a estimativa de tokens e pergunta.
const manutencaoCer = (() => {
  const $ = (id) => document.getElementById(id);
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const aba = $('aba-cerebro');
  const MAX_VISTOS = 12; // itens mostrados por lista (o resto vira "+N")

  let dados = null;
  let aberto = false;
  let emTela = false;
  let carregando = false;
  let ocupado = false; // uma ação de cada vez (as de IA demoram)
  let parar = false; // "parar" no meio de "consolidar todos"
  const feitos = []; // o que esta sessão da subaba já fez (linhas verdes no topo)

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };
  const botao = (rotulo, aoClicar, titulo) => {
    const b = el('button', 'botao-cmd', IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo);
    b.type = 'button';
    if (titulo) b.title = titulo;
    b.addEventListener('click', aoClicar);
    return b;
  };
  const chamar = async (fn) => {
    try { return await fn(); } catch (erro) { return { ok: false, tipo: 'erro', erro: 'falha interna: ' + erro.message }; }
  };
  const num = (v) => Number(v).toLocaleString('pt-BR');
  const tamanho = (bytes) => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');
  const dataBr = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  const maisN = (lista, total) => (total > lista ? el('div', 'dica', `+ ${num(total - lista)} (mostro só os ${lista} primeiros)`) : null);
  const NOME_REGRA = { plural: 'plural/singular', hifen: 'hífen', digitacao: 'digitação', abreviacao: 'abreviação' };

  // ----- diagnóstico -----
  function cartoes() {
    const d = dados;
    const cartao = (rotulo, valor, dica, alerta) => {
      const c = el('div', 'eco-cartao');
      c.title = dica;
      c.append(el('span', 'eco-num' + (alerta ? ' neg' : ''), valor), el('span', 'eco-rot', rotulo));
      return c;
    };
    $('man-cartoes').replaceChildren(
      cartao('tamanho do cérebro', tamanho(d.tamanho.bytes), `${num(d.tamanho.arquivos)} arquivos de memória; inclui arquivo-morto, índices e logs (sem a pasta tools)`, false),
      cartao('nunca consultados (6+ meses)', num(d.nunca_consultados.total), 'Conversas com mais de 6 meses que nenhuma consulta abriu nem devolveu', d.nunca_consultados.total > 0 && d.nunca_consultados.confiavel),
      cartao('palavras-chave quase iguais', num(d.palavras_quase_iguais.length), 'Grupos como agente/agentes ou bd/banco-de-dados', d.palavras_quase_iguais.length > 0),
      cartao('arquivos parecidos', num(d.similares.total_grupos) + ' grupos', `Conversas do mesmo projeto com ${Math.round(d.similares.limite * 100)}% ou mais das palavras-chave iguais`, d.similares.total_grupos > 0),
      cartao('estados com 30+ dias', num(d.estados_velhos.total), 'Estados de projeto que não são atualizados há mais de 30 dias', d.estados_velhos.total > 0));
  }
  function detalhes() {
    const d = dados;
    const blocos = [];
    const secao = (titulo, itens, total, vazio) => {
      const b = el('div');
      b.append(el('div', 'man-sub', titulo));
      if (!itens.length) b.append(el('div', 'dica man-item', vazio));
      itens.slice(0, MAX_VISTOS).forEach((t) => b.append(el('div', 'man-item', t)));
      const mais = maisN(Math.min(itens.length, MAX_VISTOS), total);
      if (mais) b.append(mais);
      blocos.push(b);
    };
    const n = d.nunca_consultados;
    secao(`conversas com mais de ${n.dias_limite} dias que ninguém consultou (${num(n.total)})`,
      n.lista.map((e) => `${dataBr(e.data)} · ${e.projeto} · ${e.arquivo} (${num(e.dias)} dias)`), n.total, 'Nenhuma.');
    if (n.aviso) { const a = el('div', 'dica man-item', n.aviso); blocos[0].append(a); }
    const ev = d.estados_velhos;
    secao(`estados de projeto parados há mais de ${ev.dias_limite} dias (${num(ev.total)})`, ev.lista.map((e) => `${e.projeto}: atualizado em ${dataBr(e.atualizado)} (${num(e.dias)} dias)`), ev.total, 'Todos em dia.');
    secao(`palavras-chave quase iguais (${num(d.palavras_quase_iguais.length)} grupos)`,
      d.palavras_quase_iguais.map((g) => `${g.termos.map((t) => `${t.palavra} (${t.arquivos})`).join(' ~ ')}  →  ${g.sugerido}  [${g.regras.map((r) => NOME_REGRA[r] || r).join(', ')}]`),
      d.palavras_quase_iguais.length, 'Nenhuma.');
    $('man-detalhes').replaceChildren(...blocos);
  }

  // ----- sinônimos -----
  const marcados = new Set(); // apelido das sugestões marcadas
  function sinonimos() {
    const d = dados;
    const sug = $('man-sugestoes');
    const itens = d.sinonimos_sugeridos;
    if (!itens.length) sug.replaceChildren(el('div', 'dica', 'Nenhuma sugestão nova a partir do diagnóstico.'));
    else {
      const linhas = itens.map((s) => {
        const l = el('label', 'man-linha');
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = marcados.has(s.apelido);
        c.addEventListener('change', () => { if (c.checked) marcados.add(s.apelido); else marcados.delete(s.apelido); });
        l.append(c, el('span', 'man-nome', `${s.apelido}  →  ${s.padrao}`), el('span', 'dica', `${s.regras.map((r) => NOME_REGRA[r] || r).join(', ')} · ${num(s.arquivos)} arquivo(s)`));
        l.dataset.apelido = s.apelido;
        return l;
      });
      const acoes = el('div', 'man-linha');
      acoes.append(botao('[aprovar os marcados]', () => aprovar(itens), 'Grava só os marcados em cerebro/sinonimos.json'),
        botao('[marcar todos]', () => { itens.forEach((s) => marcados.add(s.apelido)); sinonimos(); }));
      sug.replaceChildren(el('div', 'man-sub dica', 'sugestões (ainda NÃO aprovadas):'), ...linhas, acoes);
    }
    const atuais = Object.entries(d.sinonimos);
    $('man-sinonimos').replaceChildren(el('div', 'man-sub dica', atuais.length ? `em uso (${atuais.length}):` : 'nenhum sinônimo em uso ainda.'), ...atuais.map(([a, p]) => {
      const l = el('div', 'man-linha');
      l.append(el('span', 'man-nome', `${a}  →  ${p}`), botao('[remover]', () => removerSinonimo(a), 'Tira só este sinônimo do sinonimos.json'));
      return l;
    }));
  }
  async function aprovar(itens) {
    const pares = {};
    itens.filter((s) => marcados.has(s.apelido)).forEach((s) => { pares[s.apelido] = s.padrao; });
    if (!Object.keys(pares).length) { $('man-erro').textContent = 'marque pelo menos uma sugestão'; return; }
    await gravarSinonimos(pares);
  }
  async function gravarSinonimos(pares) {
    $('man-erro').textContent = '';
    const r = await chamar(() => window.widget.manutencaoSinonimosAprovar(pares));
    if (!r.ok) { $('man-erro').textContent = r.erro; return false; }
    Object.keys(pares).forEach((a) => marcados.delete(a));
    registrar(`sinônimos aprovados: ${r.dados.adicionados.join(', ') || 'nenhum'}` + (r.dados.ignorados.length ? ` (ignorados: ${r.dados.ignorados.join('; ')})` : ''));
    await carregar(true);
    return true;
  }
  async function removerSinonimo(apelido) {
    const r = await chamar(() => window.widget.manutencaoSinonimosRemover(apelido));
    if (!r.ok) { $('man-erro').textContent = r.erro; return; }
    registrar(`sinônimo removido: ${apelido}`);
    await carregar(true);
  }
  $('man-sin-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const a = $('man-sin-apelido').value.trim();
    const p = $('man-sin-padrao').value.trim();
    if (!a || !p) { $('man-erro').textContent = 'preencha o apelido e o termo padrão'; return; }
    if (await gravarSinonimos({ [a]: p })) { $('man-sin-apelido').value = ''; $('man-sin-padrao').value = ''; }
  });

  // ----- caixa de confirmação / proposta -----
  function dialogo({ titulo, texto, pre = '', diff = false, modelo = false, botoes }) {
    $('man-titulo').textContent = titulo;
    $('man-texto').textContent = texto;
    const bloco = $('man-pre');
    bloco.classList.toggle('oculto', !pre);
    bloco.replaceChildren(...(pre ? pre.split('\n').map((l) => el('span', diff && l.startsWith('+') && !l.startsWith('+++') ? 'diff-mais' : diff && l.startsWith('-') && !l.startsWith('---') ? 'diff-menos' : null, l + '\n')) : []));
    $('man-modelo-linha').classList.toggle('oculto', !modelo);
    $('man-dlg-erro').textContent = '';
    $('man-botoes').replaceChildren(...botoes.filter(Boolean).map((b) => {
      const x = el('button', b.principal ? 'principal' : null, b.rotulo);
      x.type = 'button';
      if (b.id) x.id = b.id;
      x.addEventListener('click', b.acao);
      return x;
    }));
    $('man-dialogo').classList.remove('oculto');
    const p = $('man-botoes').querySelector('.principal');
    if (p) p.focus();
  }
  const fecharDialogo = () => { $('man-dialogo').classList.add('oculto'); $('man-botoes').replaceChildren(); parar = false; };
  const dialogoAberto = () => !$('man-dialogo').classList.contains('oculto');
  const erroDaIA = (msg) => {
    const m = /^\[(limite|login|sem_claude)\]/.exec(msg || '');
    if (!m) return msg;
    return msg + (m[1] === 'limite' ? ' O que já foi feito está salvo; rode de novo quando o uso voltar. Não tentei de novo.' : '');
  };
  function registrar(linha) {
    feitos.push(linha);
    $('man-feitos').replaceChildren(...feitos.slice(-6).map((t) => el('div', null, '✓ ' + t)));
  }

  // ----- consolidação -----
  function grupos() {
    const g = dados.similares;
    const lista = $('man-grupos');
    if (!g.grupos.length) { lista.replaceChildren(el('div', 'dica', 'Nenhum grupo de arquivos parecidos (80% ou mais das palavras-chave no mesmo projeto).')); return; }
    const topo = el('div', 'man-linha');
    topo.append(el('span', 'man-nome', `${num(g.total_grupos)} grupos (${num(g.total_arquivos)} arquivos) · ~${num(g.tokens_entrada)} tokens de entrada e ~${num(g.tokens_saida)} de saída no total`),
      botao('[consolidar todos]', () => confirmarTodos(g), 'Pede confirmação com a estimativa antes de chamar a IA'));
    const linhas = g.grupos.slice(0, MAX_VISTOS).map((x) => {
      const l = el('div', 'man-linha');
      l.dataset.grupo = x.id;
      l.title = x.arquivos.map((a) => `${a.arquivo} (${Math.round(a.similaridade * 100)}%)`).join('\n');
      l.append(el('span', 'man-nome', `${x.projeto}: ${x.arquivos.length} arquivos (${dataBr(x.arquivos[0].data)} a ${dataBr(x.arquivos[x.arquivos.length - 1].data)})`),
        el('span', 'dica', `~${num(x.tokens_entrada)} tokens`), botao('[consolidar]', () => confirmarUm(x), 'Pede confirmação com a estimativa antes de chamar a IA'));
      return l;
    });
    const mais = maisN(Math.min(g.grupos.length, MAX_VISTOS), g.total_grupos);
    lista.replaceChildren(topo, ...linhas, ...(mais ? [mais] : []));
  }
  function confirmarUm(g) {
    if (ocupado) return;
    dialogo({
      titulo: `consolidar ${g.arquivos.length} resumos de "${g.projeto}"?`, modelo: true,
      texto: `Vou enviar o texto destes ${g.arquivos.length} arquivos ao Claude Code e gerar 1 resumo consolidado no formato oficial. Os originais vão para cerebro/arquivo-morto/ (não são apagados). Estimativa: ~${num(g.tokens_entrada)} tokens de entrada e ~${num(g.tokens_saida)} de saída (1 chamada).`,
      pre: g.arquivos.map((a) => `${a.data}  ${a.arquivo}`).join('\n'),
      botoes: [{ rotulo: 'cancelar', acao: fecharDialogo }, { rotulo: 'consolidar (gasta tokens)', principal: true, id: 'man-confirmar', acao: () => executarUm(g) }],
    });
  }
  async function consolidarChamada(g) {
    return chamar(() => window.widget.manutencaoConsolidar(g.id, $('man-modelo').value));
  }
  async function executarUm(g) {
    if (ocupado) return;
    ocupado = true;
    $('man-botoes').replaceChildren(el('span', 'dica', 'Chamando o Claude Code (pode levar até 2 minutos)...'));
    const r = await consolidarChamada(g);
    ocupado = false;
    if (!r.ok) {
      dialogo({ titulo: 'não consolidou', texto: erroDaIA(r.erro), botoes: [{ rotulo: 'ok', principal: true, acao: fecharDialogo }] });
      return;
    }
    fecharDialogo();
    registrar(`consolidado: ${r.dados.consolidado} (${r.dados.originais.length} originais em arquivo-morto/; ~${num(r.dados.tokens.entrada + r.dados.tokens.saida)} tokens)`);
    dizer('Consolidei! Os originais estão em arquivo-morto/.');
    await carregar(true);
  }
  function confirmarTodos(g) {
    if (ocupado) return;
    dialogo({
      titulo: `consolidar ${num(g.total_grupos)} grupos?`, modelo: true,
      texto: `Vou chamar o Claude Code ${num(g.chamadas)} vez(es), uma por grupo, e gerar ${num(g.total_grupos)} resumos consolidados. Os originais (${num(g.total_arquivos)} arquivos) vão para cerebro/arquivo-morto/ (não são apagados). Estimativa total: ~${num(g.tokens_entrada)} tokens de entrada e ~${num(g.tokens_saida)} de saída. Você pode parar no meio.`,
      botoes: [{ rotulo: 'cancelar', acao: fecharDialogo }, { rotulo: 'consolidar todos (gasta tokens)', principal: true, id: 'man-confirmar', acao: () => executarTodos(g) }],
    });
  }
  async function executarTodos(g) {
    if (ocupado) return;
    ocupado = true;
    parar = false;
    let feitosAgora = 0;
    let motivo = '';
    const lista = g.grupos.slice(); // só os que a tela mostrou no diagnóstico (até 50)
    for (let i = 0; i < lista.length && !parar; i++) {
      const parar_ = botao('[parar depois deste]', () => { parar = true; });
      $('man-botoes').replaceChildren(el('span', 'dica', `Consolidando ${i + 1} de ${lista.length} (${lista[i].projeto})...`), parar_);
      const r = await consolidarChamada(lista[i]);
      if (r.ok) { feitosAgora++; registrar(`consolidado: ${r.dados.consolidado} (${r.dados.originais.length} originais em arquivo-morto/)`); continue; }
      if (/grupo não encontrado/.test(r.erro || '')) continue; // um grupo anterior mexeu neste: o próximo diagnóstico mostra de novo
      motivo = erroDaIA(r.erro);
      break;
    }
    ocupado = false;
    const parouPorMim = parar;
    parar = false;
    dialogo({
      titulo: motivo ? 'parei' : 'pronto',
      texto: `${feitosAgora} consolidação(ões) feita(s).` + (motivo ? ' ' + motivo : parouPorMim ? ' Parei a seu pedido.' : ''),
      botoes: [{ rotulo: 'ok', principal: true, acao: fecharDialogo }],
    });
    await carregar(true);
  }

  // ----- estado do projeto (proposta com IA, aplicada só se você aprovar) -----
  function estados() {
    const lista = $('man-estados');
    const itens = dados.estados_com_conversas_antigas;
    if (!itens.length) { lista.replaceChildren(el('div', 'dica', 'Nenhum projeto com estado e conversas antigas (mais de 90 dias) para propor atualização.')); return; }
    lista.replaceChildren(el('div', 'man-sub dica', 'projetos com conversas antigas (90+ dias):'), ...itens.map((x) => {
      const l = el('div', 'man-linha');
      l.dataset.projeto = x.projeto;
      l.append(el('span', 'man-nome', `${x.projeto}: ${num(x.conversas_antigas)} conversa(s) antiga(s)`), botao('[propor estado]', () => confirmarEstado(x), 'Mostra a estimativa e pede confirmação; só PROPÕE, quem grava é você'));
      return l;
    }));
  }
  async function confirmarEstado(x) {
    if (ocupado) return;
    const e = await chamar(() => window.widget.manutencaoEstimarEstado(x.projeto));
    if (!e.ok) { $('man-erro').textContent = e.erro; return; }
    dialogo({
      titulo: `propor atualização do estado de "${x.projeto}"?`, modelo: true,
      texto: `Vou enviar o estado atual e ${num(e.dados.conversas_antigas)} conversa(s) com mais de ${e.dados.dias} dias ao Claude Code e pedir um estado atualizado. NADA é gravado: você vê as diferenças e decide. Estimativa: ~${num(e.dados.tokens_entrada)} tokens de entrada e ~${num(e.dados.tokens_saida)} de saída (1 chamada).`,
      botoes: [{ rotulo: 'cancelar', acao: fecharDialogo }, { rotulo: 'propor (gasta tokens)', principal: true, id: 'man-confirmar', acao: () => executarEstado(x) }],
    });
  }
  async function executarEstado(x) {
    if (ocupado) return;
    ocupado = true;
    $('man-botoes').replaceChildren(el('span', 'dica', 'Chamando o Claude Code (pode levar até 2 minutos)...'));
    const r = await chamar(() => window.widget.manutencaoProporEstado(x.projeto, $('man-modelo').value));
    ocupado = false;
    if (!r.ok) { dialogo({ titulo: 'sem proposta', texto: erroDaIA(r.erro), botoes: [{ rotulo: 'ok', principal: true, acao: fecharDialogo }] }); return; }
    if (r.dados.igual) {
      dialogo({ titulo: 'nenhuma mudança', texto: `Com base nas conversas antigas, o estado de ${x.projeto} já está certo. Nada foi gravado.`, botoes: [{ rotulo: 'ok', principal: true, acao: fecharDialogo }] });
      window.widget.manutencaoDescartarProposta();
      return;
    }
    dialogo({
      titulo: `estado proposto para "${x.projeto}"`, diff: true, pre: r.dados.diff,
      texto: `Linhas com + entram, linhas com - saem. Se aplicar, a versão atual fica guardada em estado/.anteriores/. Usei ${r.dados.conversas_usadas.length} conversa(s) antiga(s).`,
      botoes: [{ rotulo: 'descartar', acao: () => { window.widget.manutencaoDescartarProposta(); fecharDialogo(); } },
        { rotulo: 'aplicar este estado', principal: true, id: 'man-confirmar', acao: () => aplicarEstado(x) }],
    });
  }
  async function aplicarEstado(x) {
    const r = await chamar(() => window.widget.manutencaoAplicarEstado(x.projeto));
    if (!r.ok) { $('man-dlg-erro').textContent = r.erro; return; }
    fecharDialogo();
    registrar(`estado de ${x.projeto} atualizado (a versão anterior ficou em estado/.anteriores/)`);
    dizer('Estado atualizado! A versão anterior está guardada.');
    await carregar(true);
  }

  // ----- índice por tema -----
  function indices() {
    const i = dados.indices;
    $('man-indices').textContent = i.devem_existir
      ? `O cérebro tem ${num(i.arquivos)} arquivos (mais de ${i.limite}): o cerebro.py gera cerebro/indices/{projeto}.md a cada salvamento e o comando "titulos --projeto" consulta o índice do projeto primeiro. Índices existentes: ${i.existentes.length ? i.existentes.join(', ') : 'nenhum ainda'}.`
      : `O cérebro tem ${num(i.arquivos)} arquivos. Os índices por projeto só passam a ser gerados com mais de ${i.limite} (hoje basta o INDICE.md).`;
  }
  $('man-indices-gerar').addEventListener('click', async () => {
    if (ocupado) return;
    $('man-erro').textContent = '';
    const r = await chamar(() => window.widget.manutencaoIndices());
    if (!r.ok) { $('man-erro').textContent = r.erro; return; }
    registrar('índices refeitos: ' + r.dados.mensagem);
    await carregar(true);
  });

  // ----- backup -----
  $('man-exportar').addEventListener('click', async () => {
    if (ocupado) return;
    const d = await chamar(() => window.widget.manutencaoEscolherDestino());
    if (!d.ok) { if (d.tipo !== 'cancelado') $('man-erro').textContent = d.erro; return; }
    dialogo({
      titulo: 'exportar o cérebro?',
      texto: `Vou gerar cerebro-AAAA-MM-DD.zip em: ${d.pasta}. Vai o conteúdo do cérebro (conversas, estados, arquivo-morto, índices e sinônimos); não vão as suas buscas (.log) nem o código. ATENÇÃO: o cérebro pode conter dados pessoais. Não envie o .zip para um repositório público.`,
      botoes: [{ rotulo: 'cancelar', acao: fecharDialogo }, { rotulo: 'exportar', principal: true, id: 'man-confirmar', acao: () => exportar() }],
    });
  });
  async function exportar() {
    if (ocupado) return;
    ocupado = true;
    const r = await chamar(() => window.widget.manutencaoExportar());
    ocupado = false;
    if (!r.ok) { $('man-dlg-erro').textContent = r.erro; return; }
    fecharDialogo();
    const z = r.dados;
    const linhas = [el('div', null, `Backup gerado: ${z.zip} (${num(z.arquivos)} arquivos, ${tamanho(z.bytes)}).`), el('div', 'cc-erro', z.aviso)];
    if (z.dentro_de_git) linhas.push(el('div', 'cc-erro', 'ATENÇÃO: esta pasta está dentro de um repositório git. Não faça commit nem push deste .zip.'));
    $('man-backup').replaceChildren(...linhas);
    registrar('backup gerado: ' + z.zip);
    dizer('Backup pronto! Lembre: ele pode ter dados pessoais, não suba para repositório público.');
  }

  // ----- ciclo -----
  function desenhar() {
    cartoes();
    detalhes();
    sinonimos();
    grupos();
    estados();
    indices();
  }
  async function carregar(forcar) {
    if (carregando) return;
    if (!forcar && dados) { desenhar(); return; }
    carregando = true;
    $('man-erro').textContent = '';
    if (!dados) $('man-cartoes').replaceChildren(el('div', 'dica', 'Rodando o diagnóstico (um Python curto, sem IA)...'));
    const r = await chamar(() => window.widget.manutencaoDiagnostico());
    carregando = false;
    if (!r.ok) {
      $('man-erro').textContent = r.tipo === 'semPython' ? 'A manutenção precisa do Python 3. ' + (r.erro || '') : r.erro || 'não consegui rodar o diagnóstico';
      return;
    }
    dados = r.dados;
    desenhar();
  }
  function abrir() { aberto = true; aba.classList.add('manutencao'); carregar(true); }
  function fechar() { aberto = false; fecharDialogo(); aba.classList.remove('manutencao'); }
  $('cer-manutencao').addEventListener('click', abrir);
  $('man-voltar').addEventListener('click', () => { if (!ocupado) fechar(); });
  $('man-atualizar').addEventListener('click', () => { if (!ocupado) carregar(true); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !emTela || !aberto || ocupado) return;
    if (dialogoAberto()) fecharDialogo(); else fechar();
  });

  return {
    visivel(v) {
      emTela = v;
      if (!v) fecharDialogo();
    },
  };
})();

const cerebro = (() => {
  const $ = (id) => document.getElementById(id);
  const campo = $('cer-busca');
  const seletor = $('cer-projeto');
  const linhaEstado = $('cer-estado');
  const lista = $('cer-lista');
  const leitor = $('cer-leitor');
  const leitorNome = $('cer-leitor-nome');
  const texto = $('cer-texto');
  const stats = $('cer-stats');
  const dialogo = $('cer-dialogo');
  const cc = {
    form: $('cc-form'), titulo: $('cc-titulo'), palavras: $('cc-palavras'), projeto: $('cc-projeto'),
    origem: $('cc-origem'), resumo: $('cc-resumo'), erro: $('cc-erro'), salvar: $('cc-salvar'), projetos: $('cc-projetos'),
  };
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const INTERVALO = 10000; // não refaz o painel se você voltar à aba em menos de 10 s
  // a mesma convenção do cerebro.py: claude-code e antigravity (as IAs do widget, gravadas pelas skills) e claude, chatgpt, gemini (chats de sites e apps).
  // claude-code vem antes de claude: o mapeamento abaixo usa startsWith
  const ORIGENS = ['claude-code', 'claude', 'chatgpt', 'gemini', 'antigravity', 'outro'];

  let projeto = '';
  let projetos = [];
  let aberto = ''; // arquivo na área de leitura
  let doGrafo = false; // o arquivo foi aberto a partir do grafo: [< voltar] volta para ele
  let ultimaCarga = 0;
  let pedido = 0; // só a resposta do último pedido pinta a tela
  let salvando = false;
  let emTela = false;

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };
  // botões criados depois do início não passam pela troca de [colchetes] do visual iOS
  const botao = (rotulo, aoClicar) => {
    const b = el('button', 'botao-cmd', IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    return b;
  };
  const fmtData = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');
  // o preload/IPC pode falhar (ex.: janela fechando): vira o mesmo formato de erro da ponte
  const chamar = async (fn) => {
    try { return await fn(); } catch (erro) { return { ok: false, tipo: 'erro', erro: 'falha interna: ' + erro.message }; }
  };

  function vista(qual) {
    lista.classList.toggle('oculto', qual !== 'lista');
    leitor.classList.toggle('oculto', qual !== 'leitor');
    // lendo: a busca e os botões somem para o texto ter espaço (janela pequena); [< voltar] traz de volta
    $('aba-cerebro').classList.toggle('lendo', qual === 'leitor');
  }
  function aviso(mensagem, botoes = []) {
    const caixa = el('div', 'cer-aviso');
    caixa.append(el('div', null, mensagem), ...botoes.map(([rotulo, fn]) => botao(rotulo, fn)));
    vista('lista');
    lista.replaceChildren(caixa);
  }
  // erro amigável; se o cérebro não existe, oferece escolher a pasta (grava com config --definir)
  function erro(r) {
    const caixa = el('div', 'cer-aviso');
    if (r.tipo === 'semCerebro') {
      caixa.append(el('div', 'cer-erro-texto', 'Não encontrei a pasta do cérebro.'), el('div', 'cer-nota', r.erro),
        botao('[escolher a pasta do cérebro]', escolherPasta));
    } else if (r.tipo === 'semPython') {
      caixa.append(el('div', 'cer-erro-texto', 'O cérebro precisa do Python 3.'), el('div', 'cer-nota', r.erro));
    } else {
      caixa.append(el('div', 'cer-erro-texto', r.erro || 'algo deu errado'));
    }
    vista('lista');
    lista.replaceChildren(caixa);
  }

  async function escolherPasta() {
    const r = await chamar(() => window.widget.cerebroEscolherPasta());
    if (!r.ok) { if (r.tipo !== 'cancelado') erro(r); return; }
    dizer('Pasta do cérebro guardada!');
    aviso('Pasta do cérebro definida.');
    carregar(true);
  }

  // ----- painel: projetos, estado e estatísticas -----
  function desenharProjetos(nomes) {
    projetos = nomes;
    if (projeto && !nomes.includes(projeto)) projeto = ''; // o projeto sumiu do cérebro
    seletor.replaceChildren(new Option('todos', ''), ...nomes.map((n) => new Option(n, n)));
    seletor.value = projeto;
    cc.projetos.replaceChildren(...nomes.map((n) => new Option(n)));
  }
  function desenharEstado(e) {
    linhaEstado.title = '';
    if (!projeto) { linhaEstado.replaceChildren(el('span', null, 'estado: escolha um projeto para ver onde parou')); return; }
    if (!e) { linhaEstado.replaceChildren(el('span', null, 'estado: nenhum salvo para ' + projeto)); return; }
    const ver = botao('[ver]', () => abrir(e.arquivo));
    linhaEstado.title = e.objetivo || '';
    linhaEstado.replaceChildren(
      el('span', null, 'estado ' + projeto + ' · atualizado em ' + (fmtData(e.atualizado) || '?')),
      el('span', 'cer-estado-obj', e.objetivo ? '· ' + e.objetivo : ''),
      ver,
    );
  }
  function desenharStats(s) {
    const kb = s.kb.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const extraDemo = grafoCer.modoAtivo && grafoCer.modoAtivo() ? ' · [✦ cheio: +36 ilustrativos]' : '';
    stats.textContent = `${s.arquivos} arq · ${kb} KB · última compactação ${fmtData(s.ultima_compactacao) || 'nunca'}${extraDemo}`;
    stats.title = `${s.conversas} conversas e ${s.estados} estados; última compactação = a conversa mais recente salva`;
  }
  async function carregar(forcar) {
    if (!forcar && Date.now() - ultimaCarga < INTERVALO) return;
    ultimaCarga = Date.now();
    stats.textContent = 'lendo o cérebro…';
    const meu = ++pedido;
    const r = await chamar(() => window.widget.cerebroPainel(projeto));
    if (meu !== pedido) return;
    if (!r.ok) { ultimaCarga = 0; stats.textContent = '--'; erro(r); return; }
    desenharProjetos(r.dados.projetos);
    desenharEstado(r.dados.estado);
    desenharStats(r.dados.estatisticas);
  }

  // ----- busca e leitura -----
  async function buscar() {
    const termos = campo.value.trim() || projeto; // sem texto, procura pelo próprio projeto
    if (!termos) { aviso('Digite o que procurar (ou escolha um projeto).'); campo.focus(); return; }
    const meu = ++pedido;
    aviso('buscando…');
    const r = await chamar(() => window.widget.cerebroBuscar(termos, projeto));
    if (meu !== pedido) return;
    if (!r.ok) { erro(r); return; }
    let achados = r.dados.candidatos || [];
    if (grafoCer.modoAtivo && grafoCer.modoAtivo()) {
      const tNorm = termos.toLowerCase();
      const demoAchados = DADOS_ILUSTRATIVOS_CEREBRO.itens
        .filter((it) => (!projeto || it.p === projeto) && (it.n.toLowerCase().includes(tNorm) || (it.k || []).some((k) => k.toLowerCase().includes(tNorm))))
        .map((it) => ({ arquivo: it.a, pontos: 99, palavras_chave: it.k || [], ilustrativo: true }));
      achados = [...achados, ...demoAchados];
    }
    if (!achados.length) {
      aviso(`Nenhum resultado para "${termos}"${projeto ? ' (projeto ' + projeto + ')' : ''}. Tente outras palavras.`);
      dizer('Procurei na memória e não achei nada disso.');
      return;
    }
    const sugeridos = new Set(r.dados.abrir || []);
    lista.replaceChildren(...achados.map((x) => {
      const item = el('button', 'cer-item' + (sugeridos.has(x.arquivo) ? ' sugerido' : '') + (x.ilustrativo ? ' demo' : ''));
      item.type = 'button';
      item.title = x.arquivo + ' · ' + x.pontos + ' pontos' + (x.ilustrativo ? ' (ilustrativo)' : '');
      item.append(el('span', 'cer-pontos', x.ilustrativo ? '✦' : String(x.pontos)),
        el('span', 'cer-nome', (x.ilustrativo ? '✦ ' : '') + x.arquivo),
        el('span', 'cer-chaves', (x.palavras_chave || []).join(', ')));
      item.addEventListener('click', () => abrir(x.arquivo));
      return item;
    }));
    vista('lista');
    lista.scrollTop = 0;
    dizer(`Achei ${achados.length} lembrança${achados.length > 1 ? 's' : ''} sobre "${termos}".`);
  }

  async function abrir(arquivo) {
    doGrafo = false;
    aberto = arquivo;
    if (DADOS_ILUSTRATIVOS_CEREBRO.mapa.has(arquivo)) {
      leitorNome.textContent = '✦ ' + arquivo + ' (Modo Ilustrativo)';
      leitorNome.title = arquivo + ' · arquivo visual de demonstração';
      texto.textContent = gerarTextoIlustrativo(arquivo);
      texto.scrollTop = 0;
      vista('leitor');
      return;
    }
    leitorNome.textContent = arquivo;
    leitorNome.title = arquivo;
    texto.textContent = 'lendo…';
    vista('leitor');
    const meu = ++pedido;
    const r = await chamar(() => window.widget.cerebroLer(arquivo));
    if (meu !== pedido) return;
    const a = r.ok && r.dados.arquivos[0];
    if (!a) { texto.textContent = r.ok ? 'arquivo não encontrado: ' + arquivo : r.erro; return; }
    texto.textContent = a.conteudo;
    texto.scrollTop = 0;
    leitorNome.title = arquivo + ' · atualizado em ' + fmtData(a.atualizado);
  }
  const voltar = () => {
    pedido++;
    vista('lista');
    if (doGrafo) { doGrafo = false; grafoCer.abrir(); } // quem abriu pelo grafo volta para o grafo
  };

  async function copiarTexto() {
    if (!aberto) return;
    const ok = await chamar(() => window.widget.cerebroCopiar(texto.textContent));
    dizer(ok === true ? 'Copiei o conteúdo para a área de transferência!' : 'Não consegui copiar.');
  }
  async function abrirNoEditor() {
    if (!aberto) return;
    if (DADOS_ILUSTRATIVOS_CEREBRO.mapa.has(aberto)) {
      dizer('Arquivo do modo ilustrativo: ele existe apenas na visualização do cérebro.');
      return;
    }
    const r = await chamar(() => window.widget.cerebroEditor(aberto));
    if (!r.ok) dizer('Não consegui abrir o arquivo no editor.');
    else dizer(r.via === 'code' ? 'Abri no VS Code.' : 'O VS Code não respondeu; abri no programa padrão.');
  }
  async function copiarPrompt() {
    const ok = await chamar(() => window.widget.cerebroCopiarPrompt());
    dizer(ok === true
      ? 'Prompt copiado! Cole no fim de um chat; depois traga o resumo em "compactar conversa".'
      : 'Não achei o texto do prompt (cerebro/tools/prompt_compactacao.txt).');
  }

  // ----- rodapé: validar e reindexar -----
  async function validar() {
    aviso('validando…');
    const meu = ++pedido;
    const r = await chamar(() => window.widget.cerebroValidar());
    if (meu !== pedido) return;
    if (!r.ok) { erro(r); return; }
    const problemas = r.dados.problemas;
    if (!problemas.length) { aviso('validar: tudo certo, nenhum problema.'); dizer('Memória em ordem, nenhum problema!'); return; }
    lista.replaceChildren(
      el('div', 'cer-aviso-titulo', `validar: ${problemas.length} problema${problemas.length > 1 ? 's' : ''}`),
      ...problemas.map((p) => {
        const linha = el('button', 'cer-problema');
        linha.type = 'button';
        linha.title = 'Clique para abrir o arquivo';
        linha.append(el('span', 'cer-problema-arq', p.arquivo), el('span', null, ' ' + p.problema));
        linha.addEventListener('click', () => abrir(p.arquivo.replace(/^conversas\//, '')));
        return linha;
      }),
    );
    vista('lista');
    lista.scrollTop = 0;
    dizer(`Achei ${problemas.length} coisa${problemas.length > 1 ? 's' : ''} fora do padrão.`);
  }
  async function reindexar() {
    aviso('refazendo o índice…');
    const meu = ++pedido;
    const r = await chamar(() => window.widget.cerebroIndice());
    if (meu !== pedido) return;
    if (!r.ok) { erro(r); return; }
    aviso(`INDICE.md refeito: ${r.dados.arquivos} arquivos, ${r.dados.linhas} linhas.`);
    dizer('Índice refeito!');
  }

  // ----- compactar conversa (resumo colado de um chat de site ou app) -----
  // Se o resumo colado vier com o cabeçalho do prompt ("título:", "palavras-chave:", "data: ... |
  // origem: ... | projeto: ..."), preenche os campos e deixa só o corpo na caixa.
  function separarResumo(bruto) {
    const linhas = bruto.replace(/\r\n?/g, '\n').replace(/^\s*```[a-z]*\n/, '').replace(/\n```\s*$/, '').split('\n');
    const campos = {};
    let i = 0;
    for (; i < linhas.length; i++) {
      const l = linhas[i].trim();
      if (!l) { if (Object.keys(campos).length) { i++; break; } continue; }
      const m = /^(t[ií]tulo|palavras[- ]chave|data)\s*:\s*(.*)$/i.exec(l);
      if (!m) break;
      const chave = m[1].toLowerCase();
      if (chave === 'data') {
        campos.origem = (/origem\s*:\s*([^|]*)/i.exec(m[2]) || [])[1];
        campos.projeto = (/projeto\s*:\s*([^|]*)/i.exec(m[2]) || [])[1];
        campos.data = true;
      } else {
        campos[chave.startsWith('t') ? 'titulo' : 'palavras'] = m[2];
      }
    }
    if (!campos.palavras && !campos.data) return null; // não é um resumo com cabeçalho
    return { ...campos, corpo: linhas.slice(i).join('\n').trim() };
  }
  const util = (v) => (typeof v === 'string' && v.trim() && !/^[<[]/.test(v.trim()) ? v.trim() : '');
  cc.resumo.addEventListener('paste', () => setTimeout(() => {
    const s = separarResumo(cc.resumo.value);
    if (!s) return;
    if (util(s.titulo)) cc.titulo.value = util(s.titulo);
    if (util(s.palavras)) cc.palavras.value = util(s.palavras);
    if (util(s.projeto)) cc.projeto.value = util(s.projeto);
    const o = util(s.origem).toLowerCase();
    if (o) cc.origem.value = ORIGENS.find((x) => o.startsWith(x)) || (o.includes('gpt') ? 'chatgpt' : 'outro');
    cc.resumo.value = s.corpo;
  }, 0));

  function abrirDialogo() {
    cc.titulo.value = '';
    cc.palavras.value = '';
    cc.projeto.value = projeto;
    cc.origem.value = 'claude';
    cc.resumo.value = '';
    cc.erro.textContent = '';
    dialogo.classList.remove('oculto');
    cc.resumo.focus(); // normalmente você começa colando o resumo
  }
  const fecharDialogo = () => dialogo.classList.add('oculto');
  cc.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (salvando) return;
    salvando = true;
    cc.salvar.disabled = true;
    cc.erro.textContent = '';
    const r = await chamar(() => window.widget.cerebroSalvar({
      titulo: cc.titulo.value, palavras: cc.palavras.value, origem: cc.origem.value,
      projeto: cc.projeto.value, corpo: cc.resumo.value,
    }));
    salvando = false;
    cc.salvar.disabled = false;
    if (!r.ok) { cc.erro.textContent = r.erro; return; } // a validação do cerebro.py, numa linha
    fecharDialogo();
    const nome = r.dados.arquivo;
    aviso('Guardado no cérebro: ' + nome, [['[abrir]', () => abrir(nome)]]);
    dizer('Guardei na memória: ' + nome);
    carregar(true);
  });

  function aoMudarDemo(ativo) {
    if (stats.textContent && stats.textContent !== '--') {
      const limpo = stats.textContent.replace(/ · \[✦ cheio: \+\d+ ilustrativos\]/g, '');
      stats.textContent = limpo + (ativo ? ' · [✦ cheio: +36 ilustrativos]' : '');
    }
  }

  // ----- ligações -----
  $('cer-form').addEventListener('submit', (ev) => { ev.preventDefault(); buscar(); });
  const btnDemoCer = $('cer-demo');
  if (btnDemoCer) btnDemoCer.addEventListener('click', () => grafoCer.alternarDemo());
  seletor.addEventListener('change', () => {
    projeto = seletor.value;
    mudarConfig((cfg) => { cfg.cerebroProjeto = projeto; }).catch((e) => console.error('Erro ao salvar o projeto:', e));
    carregar(true);
  });
  $('cer-compactar').addEventListener('click', abrirDialogo);
  $('cer-prompt').addEventListener('click', copiarPrompt);
  $('cer-voltar').addEventListener('click', voltar);
  $('cer-copiar').addEventListener('click', copiarTexto);
  $('cer-editor').addEventListener('click', abrirNoEditor);
  $('cer-validar').addEventListener('click', validar);
  $('cer-reindexar').addEventListener('click', reindexar);
  $('cc-cancelar').addEventListener('click', fecharDialogo);
  // menu "mais": as ações menos usadas ficam recolhidas; escolher uma (ou clicar fora) fecha o menu
  const menu = $('cer-menu');
  const botaoMais = $('cer-mais');
  const fecharMenu = () => { menu.classList.add('oculto'); botaoMais.setAttribute('aria-expanded', 'false'); };
  botaoMais.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrirAgora = menu.classList.contains('oculto');
    menu.classList.toggle('oculto', !abrirAgora);
    botaoMais.setAttribute('aria-expanded', String(abrirAgora));
  });
  menu.addEventListener('click', fecharMenu);
  document.addEventListener('click', (e) => { if (!e.target.closest('.cer-mais')) fecharMenu(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !emTela) return;
    if (!menu.classList.contains('oculto')) fecharMenu();
    else if (!dialogo.classList.contains('oculto')) fecharDialogo();
    else if (!leitor.classList.contains('oculto')) voltar();
  });

  aviso('Digite palavras (ex.: login erro) e tecle Enter, ou escolha um projeto. Compactar conversa, economia e manutenção ficam em "mais".');

  return {
    iniciar(cfg) { projeto = typeof cfg.cerebroProjeto === 'string' ? cfg.cerebroProjeto : ''; grafoCer.iniciar(); },
    aoMudarDemo,
    visivel(v) {
      emTela = v;
      economiaCer.visivel(v);
      manutencaoCer.visivel(v);
      grafoCer.visivel(v);
      if (!v) { fecharDialogo(); fecharMenu(); return; }
      carregar(false);
    },
    // a tela do grafo pede para ler um arquivo: volta para a lista e abre o leitor
    abrirArquivo(arquivo) { abrir(arquivo); doGrafo = true; },
    // "Pausar com segurança" sem uso sobrando: abre a janela de escrever o resumo à mão, já no projeto
    compactarPara(id) {
      abrirDialogo();
      if (typeof id === 'string') cc.projeto.value = id;
    },
  };
})();

// ---------- Terminal embutido (aba Projetos) ----------
// As sessões do Claude rodam DENTRO do widget: o app/pty.cs (pseudo-console do Windows) roda o programa, o processo principal entrega a saída
// (app/embutido.js) e aqui o xterm.js a desenha com o mesmo visual do resto. A tela só manda o que você digita, o tamanho e o pedido de
// encerrar; quem monta o comando é sempre o processo principal. Uma aba por sessão; [< projetos] volta à lista sem encerrar nada.
const terminalEmb = (() => {
  const $ = (id) => document.getElementById(id);
  const aba = $('aba-projetos');
  const cartao = $('cartao');
  const corpo = $('et-corpo');
  const barraAbas = $('et-abas');
  const aviso = $('et-aviso');
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const DESTACADO = document.documentElement.dataset.destacado === '1';
  // o xterm.js (~490 KB) só é carregado quando você abre a primeira sessão: quem nunca usa o terminal não paga nada
  let carregandoXterm = null;
  function garantirXterm() {
    if (typeof Terminal === 'function' && typeof FitAddon !== 'undefined') return Promise.resolve(true);
    if (carregandoXterm) return carregandoXterm;
    const carregar = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('não carregou ' + src));
      document.head.append(s);
    });
    carregandoXterm = carregar('vendor/xterm/xterm.js').then(() => carregar('vendor/xterm/addon-fit.js')).then(() => true)
      .catch((e) => { console.error(e); carregandoXterm = null; return false; });
    return carregandoXterm;
  }
  const estilo = getComputedStyle(document.documentElement);
  const cor = (nome, padrao) => estilo.getPropertyValue(nome).trim() || padrao;

  // o terminal precisa de fonte monoespaçada (o visual iOS usa uma fonte comum nos textos, que deixaria as letras separadas)
  const FONTE = 'Consolas, "Cascadia Mono", "Lucida Console", monospace';
  const sessoes = new Map(); // termId -> { termId, nome, modelo, cor, sessaoId, term, fit, host, vivo, confirmando, ia, projetoId }
  let atual = '';
  let ampliado = null; // null = automático (em janela estreita o Pokémon se esconde sozinho); true/false = escolha do botão [ampliar]
  let destacado = false; // na janela principal: se o terminal está aberto na janela destacada (outro monitor)
  let emTela = false;
  let timerAviso = null;
  let aoMudar = () => {};
  let aoUso = () => {};
  let aoAbrirPS = () => {};

  const estadoAtual = () => ({
    sessoes: [...sessoes.values()].map((s) => ({
      termId: s.termId, nome: s.nome, modelo: s.modelo, cor: s.cor,
      sessaoId: s.sessaoId || '', ia: s.ia || 'powershell', projetoId: s.projetoId || '',
    })),
    atual,
  });

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };

  function dizerNoTerminal(texto, atencao = false, ms = 9000) {
    clearTimeout(timerAviso);
    aviso.textContent = texto;
    aviso.classList.toggle('atencao', atencao);
    aviso.classList.toggle('oculto', !texto);
    if (texto && ms) timerAviso = setTimeout(() => aviso.classList.add('oculto'), ms);
  }

  function ajustar(s) {
    if (!s) return;
    try {
      s.fit.fit();
      if (s.vivo) window.widget.termTamanho(s.termId, s.term.cols, s.term.rows); // o processo precisa saber o tamanho de verdade
    } catch { /* ainda sem tamanho (aba escondida) */ }
  }

  // o texto que o xterm tem na tela (e na rolagem) agora
  function textoDaTela(s) {
    const b = s.term.buffer.active;
    const linhas = [];
    for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) linhas.push(l.translateToString(true)); }
    return linhas.join('\n');
  }
  // depois de digitar o /usage, lê os números da tela do Claude (sessão atual, semana) e entrega à tela "uso e continuidade"
  const lendoUso = new Set();
  function acompanharUso(s) {
    if (lendoUso.has(s.termId)) return;
    lendoUso.add(s.termId);
    const t0 = Date.now();
    let ultimo = '';
    let parado = 0;
    const volta = () => {
      if (!sessoes.has(s.termId) || Date.now() - t0 > 25000) { lendoUso.delete(s.termId); return; }
      const lidos = (s.ia === 'antigravity' ? extrairUsoAgy : extrairUso)(textoDaTela(s)); // cada IA mostra o /usage do seu jeito
      const chave = JSON.stringify(lidos);
      if (lidos.length) {
        if (chave !== ultimo) { ultimo = chave; parado = 0; aoUso(lidos, s.ia || 'claude'); } else if (++parado >= 3) { lendoUso.delete(s.termId); return; }
      }
      setTimeout(volta, 700);
    };
    setTimeout(volta, 1200);
  }

  function criar(info) {
    const host = el('div', 'et-term');
    corpo.append(host);
    const term = new Terminal({
      fontFamily: FONTE, fontSize: 13, cursorBlink: true, scrollback: 2000, allowTransparency: true,
      theme: { background: 'rgba(0, 0, 0, 0)', foreground: cor('--text', '#cccccc'), cursor: cor('--accent', '#ffffff'), selectionBackground: 'rgba(255, 255, 255, 0.28)' },
    });
    const fit = new (typeof FitAddon === 'function' ? FitAddon : FitAddon.FitAddon)();
    term.loadAddon(fit);
    term.open(host);
    // Ctrl+C com texto selecionado copia (sem selecionar nada, é o Ctrl+C do programa: interromper).
    // Ctrl+V, Ctrl+Shift+V e Shift+Insert colam: o xterm.js trataria o Ctrl+V como tecla comum (^V) e cancelaria o "colar" do navegador.
    const colar = async () => {
      const texto = await window.widget.termColar();
      if (texto) term.paste(texto); // com "bracketed paste" quando o programa pede (o Claude pede)
      else window.widget.termEntrada(info.termId, '\x16'); // sem texto (imagem?): o Ctrl+V vai para o Claude, que lê a área de transferência
    };
    const copiarSelecao = () => { window.widget.cerebroCopiar(term.getSelection()); term.clearSelection(); };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const tecla = String(e.key).toLowerCase();
      if (e.ctrlKey && !e.altKey && tecla === 'c' && term.hasSelection()) { e.preventDefault(); copiarSelecao(); return false; }
      if ((e.ctrlKey && !e.altKey && tecla === 'v') || (e.shiftKey && !e.ctrlKey && e.key === 'Insert')) { e.preventDefault(); colar(); return false; }
      return true;
    });
    // botão direito: com texto selecionado copia, sem seleção cola (como no Windows Terminal)
    host.addEventListener('contextmenu', (e) => { e.preventDefault(); if (term.hasSelection()) copiarSelecao(); else colar(); });
    term.onData((dados) => window.widget.termEntrada(info.termId, dados));
    const s = { ...info, term, fit, host, vivo: true, confirmando: false };
    sessoes.set(info.termId, s);
    return s;
  }

  function desenharAbas() {
    barraAbas.replaceChildren(...[...sessoes.values()].map((s) => {
      const b = el('div', 'et-aba' + (s.termId === atual ? ' ativa' : '') + (s.vivo ? '' : ' fim'));
      b.setAttribute('role', 'tab');
      b.tabIndex = 0;
      b.style.setProperty('--cor', /^#[0-9a-f]{6}$/i.test(s.cor || '') ? s.cor : '#6e6e6e');
      b.title = s.vivo ? `${s.nome} · ${s.modelo}` : `${s.nome} · encerrada`;
      b.append(el('span', 'et-bolinha'), el('span', null, `${s.nome} · ${s.modelo}`));
      const x = el('button', 'et-x' + (s.confirmando ? ' certeza' : ''), s.confirmando ? 'encerrar?' : '✕');
      x.type = 'button';
      x.title = s.vivo ? 'Encerrar esta sessão (clique de novo para confirmar)' : 'Fechar esta aba';
      x.addEventListener('click', (e) => { e.stopPropagation(); fechar(s); });
      b.append(x);
      b.addEventListener('click', () => mostrar(s.termId));
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mostrar(s.termId); } });
      return b;
    }));
  }

  function aplicarVista() {
    const aberta = aba.classList.contains('terminal');
    const sem = ampliado === null ? window.innerWidth < 1000 : ampliado; // sem o Pokémon?
    cartao.classList.toggle('term-largo', aberta && sem && emTela);
    $('et-ampliar').textContent = IOS ? (sem ? 'reduzir' : 'ampliar') : (sem ? '[reduzir]' : '[ampliar]');
  }

  function mostrar(id) {
    const s = sessoes.get(id);
    if (!s) return;
    atual = id;
    for (const x of sessoes.values()) x.host.classList.toggle('ativo', x.termId === id);
    aba.classList.add('terminal');
    if (DESTACADO) {
      const tit = $('titulo');
      if (tit) tit.textContent = `C:\\WINDOWS\\system32\\WindowsPowerShell\\v1.0\\powershell.exe — ${s.nome} (${s.modelo})`;
    }
    desenharAbas();
    aplicarVista();
    requestAnimationFrame(() => { ajustar(s); s.term.focus(); });
  }

  // abre (ou volta para) a sessão: cria o xterm, pega o que o processo já escreveu e liga a saída ao vivo
  async function abrirSessao(info) {
    if (!info || typeof info.termId !== 'string') return false;
    if (!(await garantirXterm())) { dizer('O terminal embutido não carregou (xterm.js).'); return false; }
    let s = sessoes.get(info.termId);
    if (!s) {
      s = criar(info);
      const antes = await window.widget.termAnexar(info.termId);
      if (antes && antes.length) s.term.write(antes);
    } else {
      Object.assign(s, info);
    }
    if (!DESTACADO && destacado && window.widget.termDestacar) {
      atual = info.termId;
      desenharAbas();
      window.widget.termDestacar(estadoAtual());
      return true;
    }
    mostrar(info.termId);
    return true;
  }

  function voltar() {
    aba.classList.remove('terminal');
    aplicarVista();
  }

  async function fechar(s) {
    if (s.vivo) {
      // encerrar de verdade pede um segundo clique (como nas outras partes do widget)
      if (!s.confirmando) {
        s.confirmando = true;
        desenharAbas();
        setTimeout(() => { if (s.confirmando) { s.confirmando = false; desenharAbas(); } }, 3500);
        return;
      }
      s.confirmando = false;
      if (s.sessaoId) await window.widget.sessoesEncerrar(s.sessaoId);
      else if (window.widget.termEncerrar) await window.widget.termEncerrar(s.termId);
      desenharAbas();
      return;
    }
    s.term.dispose();
    s.host.remove();
    sessoes.delete(s.termId);
    if (atual === s.termId) {
      const resto = [...sessoes.keys()];
      atual = '';
      if (resto.length) mostrar(resto[resto.length - 1]);
      else if (DESTACADO && window.widget.termAcoplar) window.widget.termAcoplar({ sessoes: [], atual: '' });
      else voltar();
    }
    desenharAbas();
    aoMudar();
  }

  // ----- eventos do processo principal -----
  if (window.widget.onTermDados) {
    window.widget.onTermDados((id, dados) => { const s = sessoes.get(id); if (s) s.term.write(dados); });
    window.widget.onTermFim((id, codigo) => {
      const s = sessoes.get(id);
      if (!s) return;
      s.vivo = false;
      s.confirmando = false;
      s.term.write('\r\n\x1b[2m[sessão encerrada' + (codigo ? ' · código ' + codigo : '') + ']\x1b[0m\r\n');
      desenharAbas();
      aoMudar();
    });
    window.widget.onTermAviso((id, tipo, comando) => {
      if (id !== atual && !sessoes.has(id)) return;
      if (tipo === 'digitado') {
        dizerNoTerminal(`Digitei ${comando} para você. Esc fecha a tela de uso.`);
        if (comando === '/usage' && sessoes.has(id)) acompanharUso(sessoes.get(id));
      }
      else if (tipo === 'confirmacao') dizerNoTerminal(`A IA está pedindo uma confirmação. Responda você no terminal: depois eu digito ${comando}.`, true, 0);
      else if (tipo === 'nao-digitei') dizerNoTerminal(`Não consegui digitar ${comando} sozinho: digite você mesmo no terminal.`, true);
    });
  }

  $('et-voltar').addEventListener('click', voltar);
  window.addEventListener('resize', () => { if (ampliado === null) aplicarVista(); });
  $('et-ampliar').addEventListener('click', () => { ampliado = !(ampliado === null ? window.innerWidth < 1000 : ampliado); aplicarVista(); const s = sessoes.get(atual); if (s) requestAnimationFrame(() => { ajustar(s); s.term.focus(); }); });
  if ($('et-ps')) {
    $('et-ps').textContent = IOS ? '+ ps' : '[+ ps]';
    $('et-ps').addEventListener('click', () => {
      const s = sessoes.get(atual);
      aoAbrirPS(s && s.projetoId ? s.projetoId : '');
    });
  }
  if ($('et-destacar')) {
    if (DESTACADO) {
      $('et-destacar').textContent = IOS ? '↙ acoplar' : '[↙ acoplar]';
      $('et-destacar').title = 'Volta o terminal para dentro do widget principal';
      $('et-destacar').addEventListener('click', () => {
        if (window.widget.termAcoplar) window.widget.termAcoplar(estadoAtual());
      });
    } else {
      $('et-destacar').textContent = IOS ? '↗ destacar' : '[↗ destacar]';
      $('et-destacar').addEventListener('click', () => {
        if (!sessoes.size || !window.widget.termDestacar) return;
        destacado = true;
        window.widget.termDestacar(estadoAtual());
        voltar();
        dizer('Destaquei o terminal numa janela própria com a borda do widget! Arraste para o outro monitor.');
      });
    }
  }
  if (DESTACADO && window.widget.onTermSincronizar) {
    window.widget.onTermSincronizar(async (d) => {
      if (!d || !Array.isArray(d.sessoes)) return;
      for (const info of d.sessoes) await abrirSessao(info);
      if (d.atual && sessoes.has(d.atual)) mostrar(d.atual);
    });
  }
  if (!DESTACADO && window.widget.onTermAcoplado) {
    window.widget.onTermAcoplado((d) => {
      destacado = false;
      if (!sessoes.size) return;
      const id = d && d.atual && sessoes.has(d.atual) ? d.atual : [...sessoes.keys()].pop();
      if (id) mostrar(id);
    });
  }
  // a janela mudou de tamanho: o terminal acompanha (só o que está na tela)
  new ResizeObserver(() => { const s = sessoes.get(atual); if (s && emTela && aba.classList.contains('terminal')) requestAnimationFrame(() => ajustar(s)); }).observe(corpo);

  return {
    abrir: abrirSessao,
    tem: (id) => sessoes.has(id),
    aoMudar(fn) { aoMudar = fn; },
    aoUso(fn) { aoUso = fn; },
    aoPedirPS(fn) { aoAbrirPS = fn; },
    // a aba Projetos entrou ou saiu da tela: o Pokémon só some enquanto você está no terminal
    visivel(v) {
      emTela = v;
      aplicarVista();
      const s = sessoes.get(atual);
      if (v && s && aba.classList.contains('terminal')) requestAnimationFrame(() => { ajustar(s); s.term.focus(); });
    },
  };
})();

// ---------- Projetos (aba projetos) ----------
// Cadastro dos projetos (projetos.json). As regras (id único, pasta existe, escrita atômica, estado
// no cérebro, CLAUDE.md do projeto) são do cerebro/tools/projetos.py; o app/projetos.js só chama.
// Nada roda sozinho: cada clique abre um Python curto. Remover só tira do cadastro.
const projetos = (() => {
  const $ = (id) => document.getElementById(id);
  const lista = $('proj-lista');
  const conta = $('proj-conta');
  const dialogo = $('proj-dialogo');
  const caixas = {
    form: $('pj-form'), estado: $('pe-form'), confirma: $('pc-caixa'), abrir: $('pa-form'), instalar: $('pi-caixa'),
    escolha: $('px-caixa'), rapido: $('pq-caixa'), pausa: $('pz-caixa'), trocar: $('pt-caixa'),
    skills: $('pks-caixa'),
  };
  const f = {
    titulo: $('pj-titulo'), pasta: $('pj-pasta'), nome: $('pj-nome'), id: $('pj-id'), descricao: $('pj-descricao'),
    modelo: $('pj-modelo'), cor: $('pj-cor'), tags: $('pj-tags'), erro: $('pj-erro'), salvar: $('pj-salvar'),
    ia: $('pj-ia'), reserva: $('pj-ia-reserva'),
  };
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const INTERVALO = 10000;

  let modalProjetoSkills = null; // o projeto atualmente inspecionado no modal de skills
  let avaliacaoSkillsAtual = null; // dados avaliados das skills do projeto
  let filtroSkills = 'todos'; // 'todos' | 'essencial' | 'util' | 'instaladas'
  let termoFiltro = ''; // filtro de texto da lista de projetos

  let cadastro = [];
  let infoIAs = null; // { claude: { nome, modelos: {sonnet: 'dia a dia', ...}, instalada, instalar, docs } }
  let abrindo = null; // { projeto, modelo, ia } da janelinha "abrir"
  let instalando = 'claude'; // a IA do modal "não encontrada" (o link da documentação é o dela)
  let sessoesAtivas = []; // sessões abertas pelo widget (painel "Sessões ativas")
  let maxSessoes = 3;
  let timerSessoes = null;
  const INTERVALO_SESSOES = 10000; // só com a aba visível
  let editando = null; // id do projeto em edição (null = adicionando)
  let nomeEditado = false; // se você mexeu no nome, a pasta escolhida não o sobrescreve
  let acaoConfirma = null;
  let emTela = false;
  let ultimaCarga = 0;
  let ocupado = false;
  let pausa = null; // assistente "pausar com segurança": { projeto, passo, aMao }
  let avisoTrocaVisto = {}; // "não mostrar novamente" do aviso de trocar de conta, por IA: { claude: bool, antigravity: bool }

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };
  const botao = (rotulo, aoClicar, titulo) => {
    const b = el('button', 'botao-cmd', IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo);
    b.type = 'button';
    if (titulo) b.title = titulo;
    b.addEventListener('click', aoClicar);
    return b;
  };
  const chamar = async (fn) => {
    try { return await fn(); } catch (erro) { return { ok: false, tipo: 'erro', erro: 'falha interna: ' + erro.message }; }
  };
  const quando = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  };
  const nomeDaPasta = (caminho) => caminho.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

  function aviso(mensagem, erro) {
    conta.textContent = '';
    lista.replaceChildren(el('div', erro ? 'cer-erro-texto' : 'cer-aviso', mensagem));
  }

  // ----- as IAs (vindas do ias:resumo; todas têm os mesmos campos) -----
  const iaInfo = (id) => (infoIAs && infoIAs[id] && typeof infoIAs[id] === 'object' && infoIAs[id].modelos ? infoIAs[id] : null);
  const idsIA = () => Object.keys(infoIAs || {}).filter((id) => iaInfo(id));
  const iaCurta = (id) => (iaInfo(id) ? iaInfo(id).executavel : id || 'claude'); // "claude", "agy"
  const nomeIA = (id) => (iaInfo(id) ? iaInfo(id).nome : id || 'IA');
  const nomeCurto = (id) => nomeIA(id).split(' ')[0]; // "Claude", "Antigravity"
  // o modelo inicial numa IA: o padrão do projeto (se for a IA dele), o de modelos_por_ia, o padrão da IA
  function modeloInicial(p, id) {
    const ia = iaInfo(id);
    if (!ia) return '';
    return [id === p.ia ? p.modelo_padrao : undefined, p.modelos_por_ia && p.modelos_por_ia[id], ia.modeloPadrao]
      .find((m) => m && Object.prototype.hasOwnProperty.call(ia.modelos, m)) || Object.keys(ia.modelos)[0];
  }

  // ----- continuar em outra IA -----
  // A "outra IA" de um projeto: a ia_reserva (se estiver instalada) ou, sem ela, qualquer outra IA instalada. Depois de uma pausa por LIMITE,
  // a sugestão é a IA com MENOS sessões abertas pelo widget nas últimas 24 h: é CONTAGEM LOCAL, não a cota real de ninguém.
  const instalada = (id) => !!iaInfo(id) && iaInfo(id).instalada !== false;
  function sugerirIA(p, deIA) {
    const rec = p.recentes_por_ia || {};
    const cand = idsIA().filter((id) => id !== deIA && instalada(id));
    if (!cand.length) return null;
    cand.sort((a, b) => (rec[a] || 0) - (rec[b] || 0) || (a === p.ia_reserva ? -1 : b === p.ia_reserva ? 1 : 0));
    return { ia: cand[0], nela: rec[cand[0]] || 0, naqui: rec[deIA] || 0 };
  }
  function outraIA(p, deIA, porLimite = false) {
    if (porLimite) { const s = sugerirIA(p, deIA); return s ? s.ia : ''; }
    if (p.ia_reserva && p.ia_reserva !== deIA && instalada(p.ia_reserva)) return p.ia_reserva;
    return idsIA().find((id) => id !== deIA && instalada(id)) || '';
  }
  const textoDaSugestao = (p, deIA, s) => `Sugestão: ${nomeCurto(s.ia)} (${s.nela} ${s.nela === 1 ? 'sessão' : 'sessões'} nas últimas 24 h contra ${s.naqui} no ${nomeCurto(deIA)}). `
    + 'É contagem local das sessões que o widget abriu, não a cota real: confira o /usage.';
  // quando foi a última sessão deste projeto naquela IA (vem do cerebro/.log/sessoes.jsonl)
  function ultimaNaIA(p, ia) {
    const u = p.ultima_sessao_por_ia && p.ultima_sessao_por_ia[ia];
    return u ? `última sessão no ${nomeCurto(ia)}: ${quando(u.data)}${u.modelo ? ' (' + u.modelo + ')' : ''}` : `nunca abriu no ${nomeCurto(ia)} por aqui`;
  }
  // sessão NOVA na outra IA, lendo o estado do cérebro (a mesma retomada de depois da pausa). Pular permissões nunca é herdado.
  function continuarEmOutraIA(p, outra) {
    return abrirSessao(p, modeloInicial(p, outra), 'novo', '', { retomada: true, ia: outra, semPularPermissoes: true });
  }

  // ----- abrir PowerShell na pasta do projeto -----
  async function abrirPS(p) {
    if (ocupado) return;
    ocupado = true;
    const r = await chamar(() => window.widget.projetosAbrirPS(p.id));
    ocupado = false;
    if (!r.ok) { dizer('Não consegui abrir o PowerShell: ' + r.erro); return; }
    if (r.via === 'widget' && r.termId) {
      await terminalEmb.abrir({ termId: r.termId, nome: p.nome, modelo: 'powershell', cor: p.cor, ia: 'powershell', projetoId: p.id });
      dizer('Abri o PowerShell em ' + p.nome + '. Use [↗ destacar] para levar só o terminal para outro monitor.');
    } else {
      dizer('Abri o PowerShell em ' + p.nome + ' numa janela externa.');
    }
  }
  terminalEmb.aoPedirPS((projId) => {
    const p = cadastro.find((x) => x.id === projId) || cadastro[0];
    if (p) abrirPS(p);
  });

  // ----- cartões -----
  function cartao(p) {
    const c = el('div', 'proj-cartao');
    c.style.setProperty('--cor', /^#[0-9a-f]{6}$/i.test(p.cor) ? p.cor : '#4f9dff');
    const aberto = quando(p.ultima_abertura);
    const meta = el('div', 'proj-meta');
    meta.append(el('span', 'proj-chip-padrao', iaCurta(p.ia) + ' · ' + p.modelo_padrao));
    if (!p.pasta_existe) meta.append(el('span', 'proj-alerta', 'pasta não encontrada'));
    if (p.pular_permissoes) meta.append(el('span', 'proj-alerta', 'abre sem pedir permissões'));
    if (p.usar_api_key) meta.append(el('span', 'proj-alerta', 'cobra pela chave de API'));
    if (p.pausa) meta.append(el('span', 'proj-alerta', (p.pausa.motivo === 'limite' ? 'pausado (limite)' : 'pausado') + ' em ' + quando(p.pausa.data)));
    const cab = el('div', 'proj-cab');
    cab.append(
      el('span', 'proj-nome', p.nome),
      el('span', 'proj-id', p.id),
      el('span', 'proj-quando', aberto ? 'aberto em ' + aberto : 'nunca aberto'),
    );
    // o botão principal e a escolha do modelo ficam à vista; o resto (anterior, editar, preparar, pausar, remover) fica em "mais"
    const estado = { ia: p.ia, modelo: '', retomar: null }; // a IA e o modelo desta abertura (começam no padrão do projeto)
    const extra = el('div', 'proj-extra oculto');
    const mais = botao('[mais ▾]', () => {
      const abertoExtra = extra.classList.toggle('oculto') === false;
      const rotulo = abertoExtra ? '[menos ▴]' : '[mais ▾]';
      mais.textContent = IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo;
    }, 'Escolher sessão anterior, editar, preparar o projeto, pausar com segurança e remover');
    extra.append(
      (estado.retomar = botao('[escolher sessão anterior]', () => abrirSessao(p, estado.modelo, 'retomar', '', { ia: estado.ia }), '')),
      botao('[⭐ avaliar skills]', () => abrirSkillsModal(p), 'Diagnóstico de skills e otimização de tokens para este projeto'),
      botao('[editar]', () => abrirForm(p), 'Editar nome, pasta, modelo, cor...'),
      botao('[preparar projeto]', () => preparar(p), 'Cria (ou acrescenta ao) CLAUDE.md da pasta do projeto, com as regras do cérebro'),
      botao('[pausar com segurança]', () => iniciarPausa(p), 'Chegou no limite de uso? Guia: compactar, atualizar o estado do projeto e anotar a pausa'),
      botao('[remover]', () => pedirRemocao(p), 'Tira do cadastro (a pasta do projeto não é apagada)'),
    );
    c.title = p.pasta + (p.tags.length ? '\ntags: ' + p.tags.join(', ') : '');
    c.append(cab, el('div', 'proj-desc', p.descricao || 'sem descrição'), meta, linhaIA(p, estado, mais), extra);
    return c;
  }
  // a IA (pílulas), o modelo (lista suspensa como no Antigravity) e os botões de abrir. O principal é o [▶ abrir <IA>].
  // Trocar de IA troca a lista de modelos, o rótulo do botão e desabilita o que a IA não suporta (com a dica).
  function linhaIA(p, estado, mais) {
    const linha = el('div', 'proj-ia');
    if (!iaInfo(p.ia)) return linha;
    const quadro = (modo) => botao(modo === 'continuar' ? '[continuar última]' : '[escolher sessão anterior]', () => abrirSessao(p, estado.modelo, modo, '', { ia: estado.ia }), '');
    const iaPilulas = el('div', 'proj-modelos proj-ias');
    iaPilulas.title = 'IA desta abertura (a padrão do projeto já vem marcada)';
    const zonaModelo = el('span', 'proj-modelo-zona');
    const abrirIA = botao('[▶ abrir]', () => abrirSessao(p, estado.modelo, 'novo', '', { semPrompt: true, ia: estado.ia }), '');
    abrirIA.classList.add('proj-abrir');
    const continuar = quadro('continuar');
    const psBtn = botao('[powershell]', () => abrirPS(p), 'Abre um PowerShell na pasta deste projeto (dá para destacar só ele para outro monitor)');
    psBtn.classList.add('proj-ps');
    const btnSkills = botao('[⭐ skills]', () => abrirSkillsModal(p), 'Ver e instalar as skills recomendadas para este projeto');
    btnSkills.classList.add('proj-btn-skills');
    const escolherModelo = (modelo) => { estado.modelo = modelo; };
    function desenharModelo() {
      const ia = iaInfo(estado.ia);
      const modelos = Object.keys(ia.modelos);
      const s = el('select', 'cer-select proj-select');
      s.title = 'Clique para escolher o modelo e depois clique em abrir';
      for (const m of modelos) {
        const desc = ia.modelos[m];
        s.append(new Option(desc ? `${m} · ${desc}` : m, m));
      }
      s.value = estado.modelo;
      s.addEventListener('change', () => escolherModelo(s.value));
      zonaModelo.replaceChildren(s);
      escolherModelo(estado.modelo);
    }
    // o que a IA suporta: o botão fica desabilitado, com a dica do porquê
    const suporte = (botaoEl, ia, modo) => {
      const ok = !(ia.suporta && ia.suporta[modo] === false);
      botaoEl.disabled = !ok;
      botaoEl.title = ok ? (ia.titulos && ia.titulos[modo]) || '' : (ia.dicas && ia.dicas[modo]) || `${ia.nome} não tem esta opção`;
    };
    function aplicarIA() {
      const ia = iaInfo(estado.ia);
      estado.modelo = modeloInicial(p, estado.ia);
      for (const b of iaPilulas.children) b.classList.toggle('ativa', b.dataset.ia === estado.ia);
      desenharModelo();
      abrirIA.textContent = IOS ? '▶ abrir ' + ia.executavel : '[▶ abrir ' + ia.executavel + ']';
      abrirIA.title = `Abre o ${ia.nome} aqui ao lado, na pasta do projeto, pronto para você digitar` + (ia.instalada ? '' : ' (não está instalado: mostro como instalar)');
      suporte(continuar, ia, 'continuar');
      suporte(estado.retomar, ia, 'retomar');
      atualizarOutra();
    }
    // "continuar no {outra IA}": sessão nova lendo o estado do cérebro, com a data da última sessão naquela IA à vista
    const porLimite = () => !!(p.pausa && p.pausa.motivo === 'limite');
    const outraBtn = botao('', () => { const o = outraIA(p, estado.ia, porLimite()); if (o) continuarEmOutraIA(p, o); }, '');
    outraBtn.classList.add('proj-continuar-outra');
    const ultimaEl = el('span', 'proj-dica', '');
    function atualizarOutra() {
      const o = outraIA(p, estado.ia, porLimite());
      outraBtn.classList.toggle('oculto', !o);
      ultimaEl.classList.toggle('oculto', !o);
      if (!o) return;
      const rotulo = `[continuar no ${nomeCurto(o)}]`;
      outraBtn.textContent = IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo;
      const sug = porLimite() ? sugerirIA(p, estado.ia) : null;
      outraBtn.title = `Sessão NOVA no ${nomeIA(o)} que lê o estado do cérebro e continua de onde parou, sem explicar de novo. ${ultimaNaIA(p, o)}. `
        + 'Pular permissões nunca é herdado.' + (sug ? ' ' + textoDaSugestao(p, estado.ia, sug) : '') + (p.estado_existe ? '' : ' Atenção: este projeto ainda não tem estado no cérebro.');
      ultimaEl.textContent = ultimaNaIA(p, o);
    }
    for (const id of idsIA()) {
      const ia = iaInfo(id);
      const b = el('button', 'proj-pill', nomeCurto(id));
      b.type = 'button';
      b.dataset.ia = id;
      b.title = ia.nome + (id === p.ia ? ' · IA padrão do projeto' : id === p.ia_reserva ? ' · IA reserva do projeto' : '') + (ia.instalada ? '' : ' · não instalado');
      b.addEventListener('click', () => { if (estado.ia !== id) { estado.ia = id; aplicarIA(); } });
      iaPilulas.append(b);
    }
    aplicarIA();
    const topoIA = el('div', 'proj-ia-topo');
    topoIA.append(iaPilulas, zonaModelo, abrirIA);
    const acoesIA = el('div', 'proj-ia-acoes');
    acoesIA.append(...[
      continuar,
      psBtn,
      btnSkills,
      p.pausa && botao('[continuar da pausa]', () => abrirSessao(p, estado.modelo, 'novo', '', { retomada: true, ia: estado.ia }),
        'Sessão nova que já começa lendo o estado do projeto no cérebro: você não precisa explicar de novo'),
      outraBtn,
      ultimaEl,
      mais,
    ].filter(Boolean));
    linha.append(topoIA, acoesIA);
    return linha;
  }

  let ultimaAssinaturaCadastro = '';
  function desenhar() {
    let listaFiltrada = cadastro;
    if (termoFiltro) {
      listaFiltrada = cadastro.filter((p) =>
        (p.nome && p.nome.toLowerCase().includes(termoFiltro)) ||
        (p.id && p.id.toLowerCase().includes(termoFiltro)) ||
        (p.descricao && p.descricao.toLowerCase().includes(termoFiltro)) ||
        (p.tags && p.tags.some((t) => t.toLowerCase().includes(termoFiltro)))
      );
    }
    conta.textContent = cadastro.length ? (termoFiltro ? `${listaFiltrada.length}/${cadastro.length} projetos` : cadastro.length + (cadastro.length > 1 ? ' projetos' : ' projeto')) : '';
    if (!cadastro.length) {
      ultimaAssinaturaCadastro = '';
      lista.replaceChildren(el('div', 'cer-aviso', 'Nenhum projeto ainda. Clique em [+ novo projeto] e escolha a pasta.'));
      return;
    }
    if (!listaFiltrada.length) {
      lista.replaceChildren(el('div', 'cer-aviso', `Nenhum projeto combina com "${termoFiltro}".`));
      return;
    }
    const assinatura = JSON.stringify(listaFiltrada);
    if (assinatura === ultimaAssinaturaCadastro && lista.children.length === listaFiltrada.length) return;
    ultimaAssinaturaCadastro = assinatura;
    lista.replaceChildren(...listaFiltrada.map(cartao));
  }
  async function carregar(forcar) {
    if (!forcar && Date.now() - ultimaCarga < INTERVALO) return;
    ultimaCarga = Date.now();
    if (!infoIAs) infoIAs = await chamar(() => window.widget.iasResumo());
    const r = await chamar(() => window.widget.projetosListar());
    if (!r.ok) { ultimaCarga = 0; aviso(r.erro || 'não consegui ler o cadastro', true); return; }
    cadastro = r.dados.projetos;
    desenhar();
  }

  // ----- Modal de avaliação de skills do projeto -----
  async function abrirSkillsModal(p, buscarOnline = false) {
    if (!p) return;
    modalProjetoSkills = p;
    filtroSkills = buscarOnline ? 'online' : 'todos';
    $('pks-titulo').textContent = `skills para ${p.nome}`;
    $('pks-stack').textContent = buscarOnline
      ? 'Consultando repositórios online (GitHub, Anthropic, OpenAI)...'
      : 'Analisando cérebro e stack em 0 tokens...';
    $('pks-lista').replaceChildren(el('div', 'cer-aviso', buscarOnline
      ? 'Buscando skills online relevantes ao stack nos repositórios oficiais e da comunidade...'
      : 'Calculando aderência das skills com base no cérebro...'));
    document.querySelectorAll('.pks-filtro-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.filtro === filtroSkills));
    mostrarCaixa('skills');

    try {
      const res = await chamar(() => window.widget.projetosAvaliarSkills(p.id, buscarOnline));
      if (!res.ok) {
        $('pks-lista').replaceChildren(el('div', 'cer-erro-texto', res.erro || 'Não consegui avaliar as skills deste projeto.'));
        return;
      }
      const dados = res.dados || res;
      avaliacaoSkillsAtual = dados;
      $('pks-stack').textContent = `Stack: ${dados.projeto.stack || 'Geral'}${dados.projeto.online ? ' · com busca online' : ''}`;
      desenharSkillsModal();
      if (buscarOnline && dados.resumo && dados.resumo.online) {
        dizer(`Encontrei ${dados.resumo.online} skill(s) online relevante(s) para este projeto!`);
      }
    } catch (e) {
      $('pks-lista').replaceChildren(el('div', 'cer-erro-texto', 'Erro ao carregar skills: ' + e.message));
    }
  }

  function desenharSkillsModal() {
    if (!avaliacaoSkillsAtual || !avaliacaoSkillsAtual.skills) return;
    const { resumo, skills: lista } = avaliacaoSkillsAtual;

    $('pks-cnt-todos').textContent = resumo.total || 0;
    $('pks-cnt-essenciais').textContent = resumo.essenciais || 0;
    $('pks-cnt-uteis').textContent = resumo.uteis || 0;
    $('pks-cnt-instaladas').textContent = resumo.instaladas_projeto || 0;
    const cntOnline = $('pks-cnt-online');
    if (cntOnline) cntOnline.textContent = resumo.online || 0;

    const filtradas = lista.filter((s) => {
      if (filtroSkills === 'essencial') return s.nivel === 'essencial';
      if (filtroSkills === 'util') return s.nivel === 'util';
      if (filtroSkills === 'instaladas') return s.instalada_projeto;
      if (filtroSkills === 'online') return s.origem === 'online';
      return true;
    });

    if (!filtradas.length) {
      const aviso = filtroSkills === 'online'
        ? 'Nenhuma skill online na lista ainda. Clique em "[🌐 buscar online]" acima para consultar os repositórios.'
        : 'Nenhuma skill encontrada neste filtro.';
      $('pks-lista').replaceChildren(el('div', 'cer-aviso', aviso));
      return;
    }

    const items = filtradas.map((s) => {
      const item = el('div', `pks-item ${s.nivel}${s.origem === 'online' ? ' pks-item-online' : ''}`);
      const cab = el('div', 'pks-item-cab');

      const badgeFonte = s.origem === 'online'
        ? el('span', 'pks-badge-fonte', s.fonte || 'Online')
        : el('span', 'pks-item-cat', s.categoria || 'local');

      cab.append(
        el('span', 'pks-item-nome', s.nome),
        badgeFonte,
        el('span', `pks-item-badge pks-badge-${s.nivel}`, s.nivel_rotulo)
      );

      const razao = el('div', 'pks-item-razao', s.razao);
      let descRepo = null;
      if (s.origem === 'online' && s.repo) {
        descRepo = el('div', 'pj-nota pks-item-sub', `${s.repo}${s.caminho ? ' · ' + s.caminho : ''}${s.descricao ? ' — ' + s.descricao : ''}`);
      }

      const rodape = el('div', 'pks-item-rodape');
      const eco = el('span', 'pks-item-eco', `🌱 ${s.economia_estimada}`);
      const acoes = el('div', 'pks-item-acoes');

      if (s.instalada_projeto) {
        acoes.append(el('span', 'pks-badge-instalada', '✓ instalada no projeto'));
        const btnRemover = botao('[remover]', async () => {
          btnRemover.disabled = true;
          btnRemover.textContent = 'removendo...';
          try {
            await window.widget.skillsRemover(s.nome, 'projeto', modalProjetoSkills.id, 'ambos');
            dizer(`Skill ${s.nome} removida do projeto ${modalProjetoSkills.nome}.`);
            await abrirSkillsModal(modalProjetoSkills, !!avaliacaoSkillsAtual.projeto.online);
          } catch (e) {
            console.error('Erro ao remover skill:', e);
            btnRemover.disabled = false;
            btnRemover.textContent = '[remover]';
          }
        }, 'Remover esta skill do projeto');
        acoes.append(btnRemover);
      } else if (s.origem === 'online') {
        const btnBaixar = el('button', 'botao-cmd pks-btn-instalar pks-btn-baixar', '+ baixar e instalar');
        btnBaixar.type = 'button';
        btnBaixar.title = `Baixar ${s.nome} do repositório ${s.repo} e instalar no projeto`;
        btnBaixar.addEventListener('click', async () => {
          btnBaixar.disabled = true;
          btnBaixar.textContent = 'baixando do GitHub...';
          try {
            const bx = await window.widget.skillsCatalogoBaixar(s.repo, s.caminho || '');
            if (!bx || !bx.ok) throw new Error(bx && bx.erro ? bx.erro : 'falha ao baixar');
            btnBaixar.textContent = 'importando...';
            const imp = await window.widget.skillsImportar(true, 'ferramentas');
            if (!imp || !imp.ok) throw new Error(imp && imp.erro ? imp.erro : 'falha ao importar');
            btnBaixar.textContent = 'instalando no projeto...';
            await window.widget.skillsInstalar(s.nome, 'projeto', modalProjetoSkills.id, 'ambos');
            dizer(`Skill online ${s.nome} baixada e instalada no projeto ${modalProjetoSkills.nome}!`);
            await abrirSkillsModal(modalProjetoSkills, true);
          } catch (e) {
            console.error('Erro ao baixar e instalar skill online:', e);
            btnBaixar.disabled = false;
            btnBaixar.textContent = '+ baixar e instalar';
            dizer('Não consegui baixar a skill online: ' + e.message);
          }
        });
        acoes.append(btnBaixar);
      } else {
        const btnInstalar = el('button', 'botao-cmd pks-btn-instalar', '+ instalar no projeto');
        btnInstalar.type = 'button';
        btnInstalar.addEventListener('click', async () => {
          btnInstalar.disabled = true;
          btnInstalar.textContent = 'instalando...';
          try {
            await window.widget.skillsInstalar(s.nome, 'projeto', modalProjetoSkills.id, 'ambos');
            dizer(`Skill ${s.nome} instalada no projeto ${modalProjetoSkills.nome}!`);
            await abrirSkillsModal(modalProjetoSkills, !!avaliacaoSkillsAtual.projeto.online);
          } catch (e) {
            console.error('Erro ao instalar skill:', e);
            btnInstalar.disabled = false;
            btnInstalar.textContent = '+ instalar no projeto';
          }
        });
        acoes.append(btnInstalar);
      }

      rodape.append(eco, acoes);
      if (descRepo) item.append(cab, descRepo, razao, rodape);
      else item.append(cab, razao, rodape);
      return item;
    });

    $('pks-lista').replaceChildren(...items);
  }

  // ----- janelinhas (uma por vez dentro de #proj-dialogo) -----
  function mostrarCaixa(qual) {
    for (const [nome, caixa] of Object.entries(caixas)) caixa.classList.toggle('oculto', nome !== qual);
    dialogo.classList.remove('oculto');
  }
  const fechar = () => { dialogo.classList.add('oculto'); acaoConfirma = null; };

  // adicionar / editar
  function abrirForm(p, pasta) {
    editando = p ? p.id : null;
    nomeEditado = !!p;
    f.titulo.textContent = p ? 'editar projeto' : 'adicionar projeto';
    f.pasta.value = p ? p.pasta : pasta || '';
    f.nome.value = p ? p.nome : nomeDaPasta(f.pasta.value);
    f.id.value = p ? p.id : '';
    f.id.readOnly = !!p; // o id liga o projeto ao cérebro: não muda
    f.descricao.value = p ? p.descricao : '';
    preencherIAs(p ? p.ia : idsIA()[0], p ? p.modelo_padrao : '', p ? p.ia_reserva : '');
    f.cor.value = p ? p.cor : CORES_PROJETO[cadastro.length % CORES_PROJETO.length];
    f.tags.value = p ? p.tags.join(', ') : '';
    $('pj-pular').checked = !!(p && p.pular_permissoes);
    $('pj-perigo').classList.toggle('oculto', !$('pj-pular').checked);
    $('pj-chave').checked = !!(p && p.usar_api_key);
    notaDaChave();
    f.erro.textContent = '';
    mostrarCaixa('form');
    (p ? f.nome : f.descricao).focus();
  }
  // IA, modelo (a lista é da IA escolhida) e IA reserva do formulário; os textos de permissões e chave seguem a IA
  function preencherIAs(idIA, modelo, reserva) {
    const ids = idsIA();
    f.ia.replaceChildren(...ids.map((id) => new Option(nomeIA(id), id)));
    f.ia.value = ids.includes(idIA) ? idIA : ids[0];
    atualizarCamposIA(modelo, reserva);
  }
  function atualizarCamposIA(modelo, reserva) {
    const ia = iaInfo(f.ia.value);
    if (!ia) return;
    f.modelo.replaceChildren(...Object.keys(ia.modelos).map((m) => new Option(m + (m === ia.modeloPadrao ? ' (recomendado)' : ''), m)));
    f.modelo.value = Object.prototype.hasOwnProperty.call(ia.modelos, modelo) ? modelo : ia.modeloPadrao;
    const outras = idsIA().filter((id) => id !== f.ia.value);
    f.reserva.replaceChildren(new Option('nenhuma', ''), ...outras.map((id) => new Option(nomeIA(id), id)));
    f.reserva.value = outras.includes(reserva) ? reserva : (reserva === undefined ? f.reserva.value : '');
    const pode = !(ia.suporta && ia.suporta.pularPermissoes === false);
    $('pj-pular').disabled = !pode;
    if (!pode) { $('pj-pular').checked = false; $('pj-perigo').classList.add('oculto'); }
    $('pj-chave-rotulo').textContent = `usar chave de API (variável ${ia.variavelChave || 'da IA'} do Windows)`;
    $('pj-chave').disabled = !ia.variavelChave;
    notaDaChave();
  }
  f.ia.addEventListener('change', () => atualizarCamposIA('', f.reserva.value));
  // só diz se a variável existe (sim/não); o valor da chave nunca chega à tela
  function notaDaChave() {
    const ia = iaInfo(f.ia.value);
    if (!ia) { $('pj-chave-nota').textContent = ''; return; }
    const existe = !!ia.chaveNoAmbiente;
    const v = ia.variavelChave || 'da IA';
    $('pj-chave-nota').textContent = $('pj-chave').checked
      ? (existe ? `Atenção: este projeto vai cobrar pela API (por uso), não pela assinatura. A variável ${v} existe no Windows.`
        : `Atenção: a variável ${v} não existe no Windows. Crie-a nas variáveis de ambiente do usuário e reabra o widget; até lá o projeto não abre.`)
      : `Desligado: as sessões deste projeto usam o login da conta do ${ia.nome} (a chave de API é retirada do ambiente delas).`;
  }
  const CORES_PROJETO = ['#4f9dff', '#3ddc84', '#ff6b6b', '#ffc857', '#c792ea', '#5ce1e6'];

  async function escolherPasta(inicial) {
    const r = await chamar(() => window.widget.projetosEscolherPasta(inicial));
    return r.ok ? r.pasta : null;
  }
  // clique: escolhe a pasta e abre o formulário. Shift+clique: abre o formulário vazio (para colar o caminho)
  async function adicionar(ev) {
    if (ev && ev.shiftKey) { abrirForm(null, ''); f.pasta.focus(); return; }
    const pasta = await escolherPasta('');
    if (pasta) abrirForm(null, pasta);
  }
  $('pj-escolher').addEventListener('click', async () => {
    const pasta = await escolherPasta(f.pasta.value.trim());
    if (!pasta) return;
    f.pasta.value = pasta;
    if (!nomeEditado) f.nome.value = nomeDaPasta(pasta);
  });
  f.nome.addEventListener('input', () => { nomeEditado = true; });

  caixas.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ocupado) return;
    ocupado = true;
    f.salvar.disabled = true;
    f.erro.textContent = '';
    const dados = {
      pasta: f.pasta.value.trim(), nome: f.nome.value.trim(), descricao: f.descricao.value.trim(),
      ia: f.ia.value, modelo_padrao: f.modelo.value, ia_reserva: f.reserva.value || null, cor: f.cor.value, tags: f.tags.value,
      pular_permissoes: $('pj-pular').checked, // desligado por padrão; o aviso aparece ao ligar
      usar_api_key: $('pj-chave').checked, // desligado por padrão: a sessão usa o login da assinatura
    };
    if (!editando && f.id.value.trim()) dados.id = f.id.value.trim();
    const r = await chamar(() => (editando
      ? window.widget.projetosEditar(editando, dados)
      : window.widget.projetosAdicionar(dados)));
    ocupado = false;
    f.salvar.disabled = false;
    if (!r.ok) { f.erro.textContent = r.erro; return; } // a validação do projetos.py, numa linha
    fechar();
    await carregar(true);
    if (editando) { dizer('Projeto atualizado!'); return; }
    const p = r.dados.projeto;
    dizer(`Projeto "${p.nome}" cadastrado!`);
    // estado novo no cérebro: pergunta se quer preencher agora (o agente pode preencher depois)
    if (r.dados.estado && r.dados.estado.criado) perguntarEstado(p, r.dados.estado.arquivo);
  });
  $('pj-cancelar').addEventListener('click', fechar);

  // preencher o estado recém-criado
  function perguntarEstado(p, arquivo) {
    $('pe-titulo').textContent = 'estado criado: ' + arquivo;
    $('pe-objetivo').value = '';
    $('pe-stack').value = '';
    $('pe-erro').textContent = '';
    caixas.estado.dataset.id = p.id;
    mostrarCaixa('estado');
    $('pe-objetivo').focus();
  }
  caixas.estado.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const objetivo = $('pe-objetivo').value.trim();
    const stack = $('pe-stack').value.trim();
    if (!objetivo && !stack) { $('pe-erro').textContent = 'escreva o objetivo ou a stack (ou deixe para o agente)'; return; }
    const r = await chamar(() => window.widget.projetosPreencherEstado(caixas.estado.dataset.id, { objetivo, stack }));
    if (!r.ok) { $('pe-erro').textContent = r.erro; return; }
    fechar();
    dizer('Estado preenchido! O resto o agente completa lendo a pasta.');
  });
  $('pe-depois').addEventListener('click', () => { fechar(); dizer('Deixei o estado para o agente preencher depois.'); });

  // confirmação (remover / preparar), com o diff quando houver
  function confirmar({ titulo, texto, diff, rotulo, acao }) {
    $('pc-titulo').textContent = titulo;
    $('pc-texto').textContent = texto;
    $('pc-erro').textContent = '';
    $('pc-sim').textContent = rotulo;
    const bloco = $('pc-diff');
    bloco.classList.toggle('oculto', !diff);
    bloco.replaceChildren(...(diff ? diff.split('\n').map((l) => {
      const linha = el('span', l.startsWith('+') && !l.startsWith('+++') ? 'diff-mais' : l.startsWith('-') && !l.startsWith('---') ? 'diff-menos' : null, l + '\n');
      return linha;
    }) : []));
    acaoConfirma = acao;
    mostrarCaixa('confirma');
    $('pc-sim').focus();
  }
  $('pc-nao').addEventListener('click', fechar);
  $('pc-sim').addEventListener('click', async () => {
    if (!acaoConfirma || ocupado) return;
    ocupado = true;
    const erro = await acaoConfirma();
    ocupado = false;
    if (erro) $('pc-erro').textContent = erro; else fechar();
  });

  function pedirRemocao(p) {
    confirmar({
      titulo: 'remover "' + p.nome + '"?',
      texto: 'Só o cadastro é removido. A pasta do projeto, o CLAUDE.md dela e o estado no cérebro continuam onde estão.',
      rotulo: 'remover',
      acao: async () => {
        const r = await chamar(() => window.widget.projetosRemover(p.id));
        if (!r.ok) return r.erro;
        dizer(`Tirei "${p.nome}" do cadastro. A pasta ficou intacta.`);
        await carregar(true);
        return '';
      },
    });
  }

  // preparar: primeiro só mostra o que mudaria; grava só depois do seu "confirmar"
  async function preparar(p) {
    const r = await chamar(() => window.widget.projetosPreparar(p.id, false));
    if (!r.ok) { dizer('Não consegui preparar: ' + r.erro); aviso(r.erro, true); return; }
    const d = r.dados;
    if (d.acao === 'ja-preparado') { dizer(`"${p.nome}" já tem a seção Cérebro nas instruções da IA. Nada a fazer!`); return; }
    confirmar({
      titulo: 'preparar "' + p.nome + '"',
      texto: d.acao === 'criar'
        ? 'Vou criar o arquivo de instruções (CLAUDE.md ou AGENTS.md, conforme a IA) em ' + d.arquivo + ':'
        : 'Os arquivos que já existem não serão sobrescritos. Vou só criar o que falta e acrescentar a seção "## Cérebro" no final dos outros:',
      diff: d.diff,
      rotulo: 'confirmar',
      acao: async () => {
        const g = await chamar(() => window.widget.projetosPreparar(p.id, true));
        if (!g.ok) return g.erro;
        dizer(g.dados.acao === 'criar' ? 'Instruções da IA criadas na pasta do projeto!' : 'Seção Cérebro acrescentada às instruções da IA!');
        return '';
      },
    });
  }

  // ----- abrir a IA do projeto -----
  function pedirTarefa(p, modelo, idIA = p.ia) {
    const ia = iaInfo(idIA);
    abrindo = { projeto: p, modelo, ia: idIA };
    $('pa-titulo').textContent = 'abrir ' + ia.nome + ' em "' + p.nome + '"';
    $('pa-info').textContent = 'modelo: ' + modelo + ' (' + ia.modelos[modelo] + ') · pasta: ' + p.pasta;
    $('pa-tarefa').value = '';
    // pular permissões só vale na IA padrão do projeto (e se a IA tiver essa opção)
    $('pa-perigo').classList.toggle('oculto', !(p.pular_permissoes && idIA === p.ia && ia.suporta && ia.suporta.pularPermissoes));
    $('pa-erro').textContent = '';
    mostrarCaixa('abrir');
    $('pa-tarefa').focus();
  }
  function mostrarInstalar(r) {
    instalando = r.ia || (abrindo && abrindo.ia) || 'claude'; // a documentação e o comando são da IA que foi aberta
    $('pi-titulo').textContent = r.erro || nomeIA(instalando) + ' não encontrado';
    $('pi-comando').textContent = r.instalar || '';
    $('pi-alternativa').textContent = r.instalarAlternativa ? 'ou: ' + r.instalarAlternativa : '';
    mostrarCaixa('instalar');
  }
  const FALAS_ABRIR = {
    novo: (p, m, ia) => 'Abri o ' + ia + ' (' + m + ') em ' + p.nome + '. Primeiro ele consulta o cérebro.',
    continuar: (p, m) => 'Continuando a última sessão de ' + p.nome + ' (' + m + ').',
    retomar: (p) => 'Escolha a sessão de ' + p.nome + ' na lista do terminal.',
  };
  // devolve '' se abriu (ou se trocou para outra janelinha), ou a mensagem de erro
  // extra: { forcar, ignorarLimite, worktree } vindos das escolhas abaixo
  async function abrirSessao(p, modelo, modo, tarefa = '', extra = {}) {
    if (ocupado) return 'aguarde...';
    ocupado = true;
    const r = await chamar(() => window.widget.projetosAbrirIA(p.id, { modo, modelo, tarefa, ...extra }));
    ocupado = false;
    const deNovo = (mais) => () => abrirSessao(p, modelo, modo, tarefa, { ...extra, ...mais });
    if (!r.ok) {
      if (r.tipo === 'semIA') { mostrarInstalar(r); return ''; }
      if (r.tipo === 'semSuporte') {
        escolher({ titulo: 'não dá nesta IA', texto: r.erro + (r.dica ? ' ' + r.dica + '.' : ''), opcoes: [{ rotulo: 'ok', principal: true }] });
        return '';
      }
      if (r.tipo === 'semChave') {
        escolher({
          titulo: 'chave de API não encontrada',
          texto: `${p.nome} está marcado para usar a chave de API, mas a variável ${r.variavel} não existe no Windows (ou o widget foi aberto antes de ela ser criada). Crie-a nas variáveis de ambiente do usuário e reabra o widget, ou volte este projeto para a assinatura.`,
          opcoes: [
            { rotulo: 'voltar para a assinatura', principal: true, acao: async () => { await chamar(() => window.widget.projetosEditar(p.id, { usar_api_key: false })); await carregar(true); dizer('Pronto: ' + p.nome + ' volta a usar o login da assinatura.'); } },
            { rotulo: 'cancelar' },
          ],
        });
        return '';
      }
      if (r.tipo === 'pastaOcupada') {
        const s = r.sessao;
        escolher({
          titulo: 'já existe uma sessão neste projeto',
          texto: `${s.nome} (${iaCurta(s.ia)}): ${s.modelo}, aberta ${idade(s.inicio)}${s.tarefa ? ' ("' + s.tarefa + '")' : ''}. Duas sessões na mesma pasta podem mexer nos mesmos arquivos ao mesmo tempo.`,
          opcoes: [
            { rotulo: 'focar a existente', principal: !r.podeWorktree, acao: () => focar(s) },
            r.podeWorktree && { rotulo: 'abrir num worktree', principal: true, acao: deNovo({ worktree: true }) },
            { rotulo: 'abrir mesmo assim (desaconselhado)', acao: deNovo({ forcar: true }) },
            { rotulo: 'cancelar' },
          ],
        });
        return '';
      }
      if (r.tipo === 'limite') {
        escolher({
          titulo: `já são ${r.ativas} sessões (limite: ${r.max})`,
          texto: 'Sessões paralelas gastam tokens ao mesmo tempo e somam no mesmo limite de uso da sua conta. Feche uma antes, ou abra mesmo assim. (O limite é "max_sessoes" na config.)',
          opcoes: [{ rotulo: 'abrir mesmo assim', acao: deNovo({ ignorarLimite: true }) }, { rotulo: 'cancelar', principal: true }],
        });
        return '';
      }
      dizer('Não consegui abrir: ' + r.erro);
      return r.erro;
    }
    if (extra.retomada) dizer('Retomando ' + p.nome + ' (' + r.modelo + '): ele lê o estado no cérebro e continua de onde parou.');
    else if (extra.semPrompt) dizer('Abri o ' + nomeCurto(r.ia) + ' em ' + p.nome + (r.aviso ? '. ' + r.aviso : ': é só digitar') + '.');
    else dizer(FALAS_ABRIR[modo](p, r.modelo, nomeCurto(r.ia)) + (r.aviso ? ' ' + r.aviso + '.' : ''));
    if (r.worktree) {
      const w = r.worktree;
      escolher({
        titulo: 'sessão aberta num worktree',
        texto: `Pasta ${w.pasta}, branch ${w.branch}${w.reaproveitado ? ' (já existia)' : ''}. Só o que estava commitado foi junto. Quando terminar, para juntar o trabalho:`,
        pre: w.comandos.join('\n'),
        opcoes: [
          { rotulo: 'copiar comandos', manter: true, acao: async () => dizer((await chamar(() => window.widget.cerebroCopiar(w.comandos.join('\r\n')))) === true ? 'Comandos copiados!' : 'Não consegui copiar.') },
          { rotulo: 'ok', principal: true },
        ],
      });
    }
    // a sessão rodou dentro do widget: mostra o terminal dela (senão abriu numa janela do Windows)
    if (r.via === 'widget' && r.termId) terminalEmb.abrir({ termId: r.termId, nome: p.nome, modelo: r.modelo, cor: p.cor, sessaoId: r.sessao && r.sessao.id, ia: r.ia, projetoId: p.id });
    carregar(true); // atualiza a "última abertura"
    atualizarSessoes();
    return '';
  }

  // ----- janelinha de escolha com vários botões -----
  // opcoes: [{ rotulo, principal, manter, acao }] (itens falsos são ignorados)
  function escolher({ titulo, texto, pre = '', opcoes }) {
    $('px-titulo').textContent = titulo;
    $('px-texto').textContent = texto;
    $('px-pre').textContent = pre;
    $('px-pre').classList.toggle('oculto', !pre);
    $('px-botoes').replaceChildren(...opcoes.filter(Boolean).map((op) => {
      const b = el('button', op.principal ? 'principal' : null, op.rotulo);
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (!op.manter) fechar();
        if (op.acao) await op.acao();
      });
      return b;
    }));
    mostrarCaixa('escolha');
    const principal = $('px-botoes').querySelector('.principal');
    if (principal) principal.focus();
  }

  // ----- sessões ativas -----
  function idade(iso) {
    const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    if (min < 1) return 'agora há pouco';
    if (min < 60) return `há ${min} min`;
    return `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }
  let ultimasSessoesAssinatura = '';
  function desenharSessoes() {
    $('ps-conta').textContent = `sessões ${sessoesAtivas.length}/${maxSessoes}`;
    $('proj-sessoes').classList.toggle('oculto', !sessoesAtivas.length);
    if (!sessoesAtivas.length) {
      if (ultimasSessoesAssinatura !== '') {
        ultimasSessoesAssinatura = '';
        $('ps-lista').replaceChildren();
      }
      return;
    }
    const ass = JSON.stringify(sessoesAtivas.map((s) => [s.id, s.iaPid, s.modo, s.modelo]));
    if (ass === ultimasSessoesAssinatura && $('ps-lista').children.length === sessoesAtivas.length) return;
    ultimasSessoesAssinatura = ass;
    $('ps-lista').replaceChildren(...sessoesAtivas.map((s) => {
      const projeto = cadastro.find((p) => p.id === s.projeto);
      const linha = el('div', 'ps-linha');
      linha.style.setProperty('--cor', projeto && /^#[0-9a-f]{6}$/i.test(projeto.cor) ? projeto.cor : '#6e6e6e');
      const desc = el('span', 'ps-desc', [
        s.nome + (s.worktree ? ' (worktree)' : ''), s.modelo,
        s.tarefa ? '"' + s.tarefa + '"' : { continuar: 'continuação', retomar: 'sessão anterior' }[s.modo] || 'sem tarefa',
        idade(s.inicio),
      ].join(' · '));
      desc.title = s.pasta + (s.iaPid ? ` · PID ${s.iaPid}` : ' · procurando o processo...');
      const selo = el('span', 'ps-ia' + (s.ia && s.ia !== 'claude' ? ' agy' : ''), iaCurta(s.ia)); // "claude" ou "agy"
      selo.title = nomeIA(s.ia || 'claude');
      linha.append(el('span', 'ps-bolinha'), selo, desc,
        s.via === 'widget'
          ? botao('[abrir]', () => focar(s), 'Mostra o terminal desta sessão aqui no widget')
          : botao('[focar janela]', () => focar(s), 'Traz a janela desta sessão para a frente'),
        botao('[encerrar]', () => pedirEncerrar(s), 'Fecha a sessão (pergunta antes)'));
      return linha;
    }));
  }
  async function atualizarSessoes() {
    const r = await chamar(() => window.widget.sessoesListar());
    if (!r.ok) return;
    sessoesAtivas = r.sessoes;
    maxSessoes = r.max;
    desenharSessoes();
  }
  // a cada 10 s, só enquanto a aba está na tela (checar se o processo vive não abre processo nenhum)
  function acompanhar(ligar) {
    clearTimeout(timerSessoes);
    timerSessoes = null;
    if (!ligar) return;
    const volta = async () => {
      await atualizarSessoes();
      if (emTela) timerSessoes = setTimeout(volta, INTERVALO_SESSOES);
    };
    volta();
  }
  async function focar(s) {
    if (s.via === 'widget') { // sessão embutida: o "focar" é mostrar o terminal dela
      const projeto = cadastro.find((p) => p.id === s.projeto);
      await terminalEmb.abrir({ termId: s.termId, nome: s.nome, modelo: s.modelo, cor: projeto && projeto.cor, sessaoId: s.id, ia: s.ia, projetoId: s.projeto });
      return;
    }
    const r = await chamar(() => window.widget.sessoesFocar(s.id));
    if (!r.ok) dizer('Não consegui focar: ' + r.erro);
  }
  function pedirEncerrar(s) {
    escolher({
      titulo: `encerrar a sessão de ${s.nome}?`,
      texto: 'Compactar a sessão antes? O resumo vai para o cérebro e a próxima sessão começa sabendo onde parou.',
      opcoes: [
        { rotulo: 'sim, compactar antes', principal: true, acao: () => instrucaoCompactar(s) },
        { rotulo: 'não, encerrar agora', acao: () => encerrar(s) },
        { rotulo: 'cancelar' },
      ],
    });
  }
  function instrucaoCompactar(s) {
    focar(s);
    const nome = nomeCurto(s.ia || 'claude');
    escolher({
      titulo: 'compacte antes de fechar',
      texto: `Na janela do ${nome}, digite /cerebro-compactar (a skill do cérebro) e espere ele responder com o nome do arquivo salvo. Depois clique em "encerrar" de novo (ou feche a janela). Nada foi fechado.`,
      opcoes: [{ rotulo: 'focar a janela', manter: true, acao: () => focar(s) }, { rotulo: 'ok', principal: true }],
    });
    dizer(`Digite /cerebro-compactar na janela do ${nome} antes de fechar!`);
  }
  async function encerrar(s) {
    const r = await chamar(() => window.widget.sessoesEncerrar(s.id));
    dizer(r.ok ? `Sessão de ${s.nome} encerrada.` : 'Não consegui encerrar: ' + r.erro);
    atualizarSessoes();
  }

  // ----- pausar com segurança (chegou no limite de uso) -----
  // 1. compactar a sessão (com uso: /cerebro-compactar na IA da sessão; sem uso: resumo escrito à mão na aba Cérebro)
  // 2. atualizar só "Estado atual" e "Próximos passos" do estado do projeto  3. anotar a pausa (e a IA pausada) no sessoes.jsonl
  // No fim, "continuar no {outra IA}" abre uma sessão nova nela lendo esse estado.
  const PASSOS_PAUSA = ['compactar a sessão', 'atualizar o estado', 'registrar a pausa'];
  // a IA que está sendo pausada: a da sessão aberta no projeto ou, sem sessão, a da última sessão registrada (senão, a padrão dele)
  function iaDaPausa(p) {
    const ativa = sessoesAtivas.find((s) => s.projeto === p.id);
    if (ativa) return ativa.ia || 'claude';
    const ultimas = Object.entries(p.ultima_sessao_por_ia || {}).filter(([id]) => iaInfo(id)).sort((a, b) => String(b[1].data).localeCompare(String(a[1].data)));
    return ultimas.length ? ultimas[0][0] : p.ia;
  }
  function iniciarPausa(p) {
    pausa = { projeto: p, passo: 0, aMao: false, ia: iaDaPausa(p) };
    irParaPasso(0);
  }
  async function irParaPasso(passo) {
    pausa.passo = passo;
    pausa.aMao = false;
    const p = pausa.projeto;
    const corpo = $('pz-corpo');
    const botoes = $('pz-botoes');
    const nomeDaIA = nomeCurto(pausa.ia);
    $('pz-titulo').textContent = 'pausar "' + p.nome + '"';
    $('pz-erro').textContent = '';
    $('pz-passos').replaceChildren(...PASSOS_PAUSA.map((t, i) => el('span', 'pz-passo' + (i === passo ? ' atual' : i < passo ? ' feito' : ''), (i < passo ? '✓ ' : (i + 1) + '. ') + t)));
    const btn = (rotulo, acao, principal) => {
      const b = el('button', principal ? 'principal' : null, rotulo);
      b.type = 'button';
      b.addEventListener('click', acao);
      return b;
    };
    mostrarCaixa('pausa');
    if (passo === 0) {
      const ativa = sessoesAtivas.find((s) => s.projeto === p.id);
      corpo.replaceChildren(
        el('div', 'pj-nota', `Ainda tem uso sobrando? Na janela do ${nomeDaIA}, digite /cerebro-compactar e espere ele dizer o arquivo salvo: o resumo vai para o cérebro.`),
        el('div', 'pj-nota', 'O uso acabou de vez? Então escreva 3 a 5 linhas à mão, na janela “compactar conversa” da aba Cérebro (não gasta nada do limite).'));
      botoes.replaceChildren(
        ativa ? btn('focar a janela do ' + nomeCurto(ativa.ia || 'claude'), () => focar(ativa)) : el('span'),
        btn('sem uso: escrever à mão', escreverAMao),
        btn('já compactei: próximo', () => irParaPasso(1), true));
    } else if (passo === 1) {
      corpo.replaceChildren(el('div', 'pj-nota', 'Carregando o estado do projeto...'));
      botoes.replaceChildren(btn('voltar', () => irParaPasso(0)));
      const r = await chamar(() => window.widget.projetosPausaEstado(p.id));
      if (!pausa || pausa.passo !== 1) return;
      if (!r.ok) { corpo.replaceChildren(); $('pz-erro').textContent = r.erro; return; }
      const area = (id, rotulo, valor, dica) => {
        const a = el('textarea', 'cc-resumo pz-area');
        a.id = id;
        a.value = valor;
        a.maxLength = 1500;
        a.spellcheck = false;
        a.placeholder = dica;
        a.setAttribute('aria-label', rotulo);
        return [el('div', 'pz-rotulo', rotulo), a];
      };
      corpo.replaceChildren(
        el('div', 'pj-nota', 'Só estas duas seções de ' + r.dados.arquivo + ' mudam (o resto fica como está e guardo uma cópia antes):'),
        ...area('pz-estado', 'Estado atual', r.dados.estado_atual, 'o que já funciona e onde parou'),
        ...area('pz-proximos', 'Próximos passos', r.dados.proximos, 'o que fazer quando voltar'));
      botoes.replaceChildren(btn('voltar', () => irParaPasso(0)), btn('salvar no cérebro e continuar', salvarEstadoPausa, true));
      $('pz-estado').focus();
    } else if (passo === 2) {
      corpo.replaceChildren(el('div', 'pj-nota', `Último passo: anotar em cerebro/.log/sessoes.jsonl que você pausou o ${nomeDaIA} por limite de uso, com a hora. Não abre nem gasta nada.`));
      botoes.replaceChildren(btn('voltar', () => irParaPasso(1)), btn('registrar a pausa', registrarPausa, true));
    } else {
      const hora = quando(pausa.registro && pausa.registro.data);
      const outra = outraIA(p, pausa.ia, true);
      const sug = outra ? sugerirIA(p, pausa.ia) : null;
      corpo.replaceChildren(
        el('div', 'pj-nota', `Pausa registrada (limite, ${nomeDaIA})` + (hora ? ' em ' + hora : '') + '. O estado de ' + p.nome + ' está salvo no cérebro.'),
        el('div', 'pj-nota', `Quando o uso voltar, clique em [continuar da pausa] no cartão do projeto: a IA abre lendo o estado do cérebro e continua de onde parou, sem você explicar de novo.`),
        ...(outra ? [
          el('div', 'pj-nota', `Sem esperar? Abra uma sessão nova no ${nomeCurto(outra)}: ela lê o mesmo estado. ${ultimaNaIA(p, outra)}.`),
          el('div', 'pj-nota', sug ? textoDaSugestao(p, pausa.ia, sug) : ''),
        ] : [el('div', 'pj-nota', 'Não há outra IA instalada para continuar agora.')]));
      botoes.replaceChildren(btn('ok', () => { pausa = null; fechar(); carregar(true); }, true),
        outra ? btn(`continuar no ${nomeCurto(outra)}`, () => { const alvo = outra; pausa = null; fechar(); continuarEmOutraIA(p, alvo); }) : el('span'));
    }
  }
  // sem uso: vai para a aba Cérebro (janela de compactar) e, ao voltar para esta aba, retoma no passo 2
  function escreverAMao() {
    pausa.passo = 1;
    pausa.aMao = true;
    const id = pausa.projeto.id;
    fechar();
    abas.mostrar('cerebro');
    cerebro.compactarPara(id);
    dizer('Escreva 3 a 5 linhas e guarde. Depois volte à aba Projects (Alt+5) para seguir a pausa.');
  }
  async function salvarEstadoPausa() {
    if (ocupado) return;
    ocupado = true;
    const r = await chamar(() => window.widget.projetosPausaSalvar(pausa.projeto.id, { estado_atual: $('pz-estado').value, proximos: $('pz-proximos').value }));
    ocupado = false;
    if (!r.ok) { $('pz-erro').textContent = r.erro; return; }
    irParaPasso(2);
  }
  async function registrarPausa() {
    if (ocupado) return;
    ocupado = true;
    const r = await chamar(() => window.widget.projetosPausaRegistrar(pausa.projeto.id, 'limite', pausa.ia));
    ocupado = false;
    if (!r.ok) { $('pz-erro').textContent = r.erro; return; }
    pausa.registro = r.dados.pausa;
    irParaPasso(3);
    dizer('Pausa registrada! Quando o uso voltar, é só continuar da pausa (ou já continuar em outra IA).');
  }
  function encerrarPausa() { pausa = null; fechar(); }
  $('pz-fechar').addEventListener('click', encerrarPausa);

  // ----- trocar conta, por IA: só passos escritos (o widget não executa nada) -----
  // Regras que não mudam: nenhuma rotação automática de contas, nada de ferramenta de terceiros que troque login, HOME ou chaveiro, nem copiar
  // credencial. Quem troca é você, à mão, dentro da própria IA. Os passos de cada IA são só os que foram CONFERIDOS (docs/claude-code.md e docs/antigravity.md).
  const PASSOS_CONTA = {
    claude: {
      passos: [
        'Na janela do Claude, termine o que estava fazendo (se quiser, digite **/cerebro-compactar** antes) e digite **/logout**.',
        'Saia da sessão com **/exit** e feche a janela.',
        'Abra o Claude de novo (botão [abrir claude] do projeto), digite **/login** e entre com a outra conta.',
        'Digite **/status** para conferir qual conta está ativa.',
      ],
      nota: 'Comandos conferidos na documentação da versão 2.1.292. Se algo não responder, veja /help na sua versão.',
    },
    antigravity: {
      passos: [
        'Na janela do Antigravity, termine o que estava fazendo (se quiser, digite **/cerebro-compactar** antes) e digite **/logout**.',
        'Feche a janela da sessão (não há um comando de sair conferido nesta versão).',
        'Abra o Antigravity de novo (botão [▶ abrir agy] do projeto). Sem conta, ele mostra a tela de entrada: siga o que ela pedir e entre com a outra conta.',
        'Confira a conta no cabeçalho da sessão (e-mail e plano) ou digitando **/usage** (linha "Account").',
      ],
      nota: 'Conferido na versão 1.4.9: o agy tem /logout, mas não tem /login nem /status; a tela de entrada ainda não foi capturada (o teste não deslogou ninguém). Se algo não responder, digite / para ver a lista da sua versão.',
    },
  };
  const comNegrito = (texto) => {
    const f = document.createDocumentFragment();
    texto.split(/\*\*(.+?)\*\*/).forEach((parte, i) => f.append(i % 2 ? el('b', null, parte) : document.createTextNode(parte)));
    return f;
  };
  let contaIA = 'claude';
  function desenharTrocarConta() {
    const info = PASSOS_CONTA[contaIA];
    $('pt-ias').replaceChildren(...Object.keys(PASSOS_CONTA).map((id) => {
      const b = el('button', 'estilo-op' + (id === contaIA ? ' ativo' : ''), nomeCurto(id));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === contaIA));
      b.addEventListener('click', () => { contaIA = id; desenharTrocarConta(); });
      return b;
    }));
    $('pt-passos').replaceChildren(...info.passos.map((t) => { const li = el('li'); li.append(comNegrito(t)); return li; }));
    $('pt-nota').textContent = info.nota;
    // o aviso dos termos aparece UMA vez por IA
    const visto = avisoTrocaVisto[contaIA] === true;
    $('pt-aviso').classList.toggle('oculto', visto);
    $('pt-lembrar').classList.toggle('oculto', visto);
    $('pt-nao-mostrar').checked = false;
  }
  function abrirTrocarConta() {
    const sel = $('pu-ia').value;
    contaIA = PASSOS_CONTA[sel] ? sel : 'claude';
    desenharTrocarConta();
    mostrarCaixa('trocar');
    $('pt-ok').focus();
  }
  async function fecharTrocarConta() {
    if (avisoTrocaVisto[contaIA] !== true && $('pt-nao-mostrar').checked) {
      avisoTrocaVisto = { ...avisoTrocaVisto, [contaIA]: true };
      const vistos = avisoTrocaVisto;
      await mudarConfig((cfg) => { cfg.avisoTrocaContaVisto = { ...(cfg.avisoTrocaContaVisto && typeof cfg.avisoTrocaContaVisto === 'object' ? cfg.avisoTrocaContaVisto : {}), ...vistos }; })
        .catch((e) => console.error('Erro ao salvar o aviso:', e));
    }
    fechar();
  }
  $('pt-ok').addEventListener('click', fecharTrocarConta);

  // ----- uso e continuidade -----
  // 1. "seu uso agora": [ver agora] abre o Claude AQUI no widget e digita /usage; os números (sessão atual, semana) são lidos da tela dele
  //    (app/uso-tela.js) e viram barras. 2. estimativa local: sessões que o widget abriu, por dia. Nada roda sozinho.
  // O /usage de cada IA é lido da tela dela (app/uso-tela.js para o Claude, app/uso-tela-agy.js para o Antigravity). O gráfico dos 7 dias é
  // CONTAGEM LOCAL das sessões que o widget abriu, agrupada por IA e depois por modelo (cada IA conta os seus): não é o uso real nem a cota.
  const MODELOS_CLAUDE = [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku'], ['outro', 'outro']];
  const painelProj = $('aba-projetos');
  const projetoDoUso = () => cadastro.find((p) => p.id === $('pu-projeto').value) || cadastro[0] || null;
  let ultimoUso = {}; // { claude: { quando, medidores: [{ nome, pct, reinicia, restante? }] }, antigravity: {...} }: a última leitura do /usage de cada IA

  const nivelDoUso = (pct) => (pct >= 85 ? 'alto' : pct >= 60 ? 'medio' : 'ok');
  const nivelDoRestante = (pct) => (pct <= 15 ? 'alto' : pct <= 40 ? 'medio' : 'ok'); // o agy mostra o que RESTA: pouco restante é o alerta
  const haQuanto = (iso) => {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 1) return 'agora há pouco';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.floor(min / 60)} h`;
    return quando(iso);
  };
  function desenharMedidores() {
    const caixa = $('pu-medidores');
    const dica = $('pu-dica');
    dica.classList.remove('alerta');
    const ias = idsIA().filter((id) => ultimoUso[id] && ultimoUso[id].medidores && ultimoUso[id].medidores.length);
    if (!ias.length) {
      caixa.replaceChildren(el('div', 'pj-nota', 'Escolha a IA e clique em "ver agora": ela abre aqui, mostra o seu uso e eu desenho as barras.'));
      dica.textContent = '';
      return;
    }
    const linhas = [];
    let pior = 0; // o maior uso (em % USADO) entre as IAs lidas
    for (const id of ias) {
      const leitura = ultimoUso[id];
      linhas.push(el('div', 'pu-ia-titulo', nomeIA(id)));
      for (const m of leitura.medidores) {
        const restante = m.restante === true;
        const linha = el('div', 'pu-medidor');
        const trilho = el('div', 'pu-trilho');
        const enche = el('div', 'pu-enche pu-' + (restante ? nivelDoRestante(m.pct) : nivelDoUso(m.pct)));
        enche.style.width = m.pct + '%';
        trilho.append(enche);
        linha.append(el('span', 'pu-med-nome', m.nome), trilho, el('span', 'pu-med-pct', Math.round(m.pct) + '%'),
          el('span', 'pu-med-reinicia', m.reinicia ? (restante ? 'reinicia em ' : 'reinicia ') + m.reinicia : ''));
        linha.title = restante ? `${m.nome}: resta ${m.pct}%${m.reinicia ? ', reinicia em ' + m.reinicia : ''}` : `${m.nome}: ${m.pct}% usado${m.reinicia ? ', reinicia ' + m.reinicia : ''}`;
        linhas.push(linha);
        pior = Math.max(pior, restante ? 100 - m.pct : m.pct);
      }
      linhas.push(el('div', 'pu-lido', 'lido ' + haQuanto(leitura.quando) + ' · os números vêm do /usage do ' + nomeCurto(id)
        + (id === 'claude' ? ' (mostra o que você JÁ USOU)' : ' (mostra o que RESTA)')));
    }
    caixa.replaceChildren(...linhas);
    dica.classList.toggle('alerta', pior >= 85);
    dica.textContent = pior >= 85 ? 'Perto do limite. Quando acabar, use "pausar com segurança" para continuar de onde parou depois (aqui mesmo ou em outra IA).'
      : pior >= 60 ? 'Uso médio: prefira os modelos mais baratos nas tarefas simples.' : 'Uso tranquilo.';
  }
  // chegou uma leitura nova da tela do /usage (do terminal embutido) de uma IA
  function usoRecebido(medidores, ia = 'claude') {
    if (!medidores || !medidores.length || !iaInfo(ia)) return;
    ultimoUso = { ...ultimoUso, [ia]: { quando: new Date().toISOString(), medidores } };
    desenharMedidores();
    const guardar = ultimoUso;
    mudarConfig((cfg) => { cfg.ultimoUso = { ...(cfg.ultimoUso && typeof cfg.ultimoUso === 'object' && !Array.isArray(cfg.ultimoUso.medidores) ? cfg.ultimoUso : {}), ...guardar }; })
      .catch((e) => console.error('Erro ao guardar a leitura do uso:', e));
  }
  terminalEmb.aoUso(usoRecebido);

  // rótulos e classes de cor do gráfico: o Claude usa as cores de sempre; as outras IAs, os tons de azul (um por modelo, na ordem do ias-dados.json)
  const rotuloModelo = (ia, m) => {
    if (m === 'outro') return 'outro';
    if (ia === 'claude') { const c = MODELOS_CLAUDE.find(([x]) => x === m); return c ? c[1] : m; }
    return m.replace(/^gemini-/, '').replace(/^claude-/, 'claude ').replace(/^gpt-oss-/, 'gpt ').replace(/-/g, ' ');
  };
  // [{ ia, modelo, rotulo, n, classe }] de um grupo por IA (um dia, ou o total dos 7 dias): primeiro as IAs, dentro de cada uma os modelos dela
  function segmentos(porIA) {
    const saida = [];
    for (const ia of idsIA()) {
      const grupo = porIA && porIA[ia];
      if (!grupo) continue;
      const modelos = Object.keys(iaInfo(ia).modelos || {});
      for (const [m, n] of Object.entries(grupo.por_modelo || {})) {
        if (!n) continue;
        const i = modelos.indexOf(m);
        saida.push({ ia, modelo: m, rotulo: nomeCurto(ia) + ' · ' + rotuloModelo(ia, m), n, classe: ia === 'claude' ? 'pu-' + m : 'pu-agy-' + (i >= 0 ? i % 4 : 'outro') });
      }
    }
    return saida;
  }
  function desenharGrafico(d) {
    const maximo = Math.max(1, ...d.dias.map((x) => x.total));
    const hoje = d.dias[d.dias.length - 1];
    const totais = segmentos(d.por_ia);
    const dominante = totais.slice().sort((a, b) => b.n - a.n)[0];
    const porIA = idsIA().filter((id) => d.por_ia && d.por_ia[id] && d.por_ia[id].total).map((id) => `${nomeCurto(id)} ${d.por_ia[id].total}`);
    $('pu-resumo').textContent = d.total
      ? `Hoje: ${hoje.total} ${hoje.total === 1 ? 'sessão' : 'sessões'} · nos 7 dias: ${d.total}${porIA.length ? ' (' + porIA.join(' · ') + ')' : ''}${dominante ? ' · mais usado: ' + dominante.rotulo : ''}`
      : 'Nenhuma sessão aberta pelo widget nos últimos 7 dias.';
    $('pu-grafico').replaceChildren(...d.dias.map((dia, i) => {
      const data = new Date(dia.data + 'T12:00:00');
      const col = el('div', 'pu-col' + (i === d.dias.length - 1 ? ' hoje' : ''));
      const segs = segmentos(dia.por_ia);
      const detalhe = segs.map((s) => s.rotulo + ' ' + s.n).join(', ');
      col.title = data.toLocaleDateString('pt-BR') + ': ' + dia.total + (dia.total === 1 ? ' sessão' : ' sessões') + (detalhe ? ' (' + detalhe + ')' : '') + ' · contagem local';
      const area = el('div', 'pu-area');
      const barra = el('div', 'pu-barra');
      barra.style.height = (dia.total / maximo * 100) + '%';
      for (const s of segs) {
        const seg = el('div', 'pu-seg ' + s.classe);
        seg.style.flexGrow = s.n;
        seg.title = `${s.rotulo}: ${s.n}`;
        barra.append(seg);
      }
      area.append(barra);
      // o rótulo da IA em cada barra: a inicial e quantas sessões (C2 A1 = 2 no Claude, 1 no Antigravity)
      const ias = idsIA().filter((id) => dia.por_ia && dia.por_ia[id] && dia.por_ia[id].total);
      const rotIA = el('div', 'pu-ias', ias.map((id) => nomeCurto(id)[0].toUpperCase() + dia.por_ia[id].total).join(' '));
      rotIA.title = ias.map((id) => nomeCurto(id) + ' ' + dia.por_ia[id].total).join(' · ');
      col.append(el('div', 'pu-num', String(dia.total)), area, rotIA,
        el('div', 'pu-dia', i === d.dias.length - 1 ? 'hoje' : data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') + ' ' + data.getDate()));
      return col;
    }));
    // legenda agrupada por IA: "Claude: ■ Sonnet 3 ■ Opus 1   Antigravity: ■ 3.8 flash low 2"
    const legenda = [];
    for (const ia of idsIA()) {
      const doIA = totais.filter((s) => s.ia === ia);
      if (!doIA.length) continue;
      legenda.push(el('span', 'pu-leg pu-leg-ia', nomeCurto(ia) + ':'));
      for (const s of doIA) {
        const item = el('span', 'pu-leg');
        item.append(el('i', 'pu-cor ' + s.classe), document.createTextNode(rotuloModelo(ia, s.modelo) + ' ' + s.n));
        legenda.push(item);
      }
    }
    $('pu-legenda').replaceChildren(...legenda);
    const avisos = d.avisos.map((a) => el('div', 'proj-alerta', '⚠ ' + a));
    if (d.pausas.length) {
      const u = d.pausas.at(-1);
      avisos.push(el('div', 'cer-nota', 'Pausas por limite: ' + d.pausas.length + ' (última: ' + u.projeto + ', ' + quando(u.data) + (u.ia ? ', no ' + nomeCurto(u.ia) : '') + ').'));
    }
    $('pu-avisos').replaceChildren(...avisos);
  }
  async function carregarUso() {
    const r = await chamar(() => window.widget.usoResumo());
    if (!r.ok) { $('pu-grafico').replaceChildren(el('div', 'cer-erro-texto', r.erro || 'não consegui contar as sessões')); return; }
    desenharGrafico(r.dados);
  }
  function notaDaIADoUso() {
    const ia = $('pu-ia').value;
    $('pu-ia-nota').textContent = (ia === 'antigravity'
      ? 'No Antigravity o /usage mostra o que RESTA da cota (semanal e de 5 horas), em grupos de modelos (Gemini; Claude e GPT). As barras daqui mostram o que resta. '
      : 'No Claude o /usage mostra o que você JÁ USOU (sessão atual e semana). ')
      + 'O widget só lê a tela da sessão aberta aqui dentro, e só quando você clica; sem o terminal embutido, veja o /usage direto na janela da IA.';
    $('pu-abrir-usage').title = `Abre o ${nomeCurto(ia)} aqui no widget e digita /usage sozinho`;
  }
  function preencherUso() {
    const sel = $('pu-projeto');
    const atual = sel.value;
    sel.replaceChildren(...cadastro.map((p) => new Option(p.nome, p.id)));
    if (cadastro.some((p) => p.id === atual)) sel.value = atual;
    const iaSel = $('pu-ia');
    const iaAtual = iaSel.value;
    iaSel.replaceChildren(...idsIA().map((id) => new Option(nomeCurto(id) + (instalada(id) ? '' : ' (não instalado)'), id)));
    const p = projetoDoUso();
    iaSel.value = idsIA().includes(iaAtual) ? iaAtual : (p && idsIA().includes(p.ia) ? p.ia : idsIA()[0]);
    notaDaIADoUso();
    for (const id of ['pu-abrir-usage', 'pu-pausar']) $(id).disabled = !cadastro.length;
  }
  async function abrirUso() {
    painelProj.classList.add('usando');
    await carregar(false);
    preencherUso();
    desenharMedidores();
    carregarUso(); // só ao entrar: nada roda sozinho
  }
  const fecharUso = () => painelProj.classList.remove('usando');
  // [ver agora]: se o projeto já tem uma sessão DESTA IA aberta AQUI, digita o /usage nela; senão abre uma (e o widget digita sozinho)
  async function verUso() {
    const p = projetoDoUso();
    if (!p) return;
    const ia = $('pu-ia').value || p.ia;
    const viva = sessoesAtivas.find((s) => s.projeto === p.id && (s.ia || 'claude') === ia && s.via === 'widget' && s.termId && terminalEmb.tem(s.termId));
    if (viva) {
      await focar(viva);
      const ok = await chamar(() => window.widget.termComando(viva.termId, '/usage'));
      if (ok !== true) dizer('Não consegui pedir o /usage: digite você mesmo no terminal.');
      return;
    }
    abrirSessao(p, modeloInicial(p, ia), 'novo', '', { semPrompt: true, comando: '/usage', ia });
  }
  $('pu-ia').addEventListener('change', notaDaIADoUso);
  $('proj-uso-abrir').addEventListener('click', abrirUso);
  $('pu-voltar').addEventListener('click', fecharUso);
  $('pu-abrir-usage').addEventListener('click', verUso);
  $('pu-pausar').addEventListener('click', () => { const p = projetoDoUso(); if (p) iniciarPausa(p); });
  $('pu-trocar').addEventListener('click', abrirTrocarConta);
  $('pj-chave').addEventListener('change', notaDaChave);

  // ----- seletor rápido (Ctrl+Alt+A) -----
  let rapidoItens = [];
  let rapidoSel = 0;
  function desenharRapido() {
    const filtro = $('pq-filtro').value.trim().toLowerCase();
    rapidoItens = cadastro.filter((p) => !filtro || p.nome.toLowerCase().includes(filtro) || p.id.includes(filtro));
    rapidoSel = Math.min(rapidoSel, Math.max(0, rapidoItens.length - 1));
    $('pq-lista').replaceChildren(...(rapidoItens.length ? rapidoItens.map((p, i) => {
      const b = el('button', 'pq-item' + (i === rapidoSel ? ' atual' : ''));
      b.type = 'button';
      b.style.setProperty('--cor', /^#[0-9a-f]{6}$/i.test(p.cor) ? p.cor : '#4f9dff');
      b.append(el('span', 'ps-bolinha'), el('span', 'pq-nome', p.nome), el('span', 'proj-dica', iaCurta(p.ia) + ' · ' + p.modelo_padrao));
      b.addEventListener('click', () => abrirRapido(p));
      return b;
    }) : [el('div', 'cer-aviso', cadastro.length ? 'nenhum projeto com esse nome' : 'nenhum projeto cadastrado')]));
  }
  function abrirRapido(p) {
    fechar();
    abrirSessao(p, p.modelo_padrao, 'novo', '');
  }
  async function seletorRapido() {
    await carregar(!cadastro.length);
    $('pq-filtro').value = '';
    rapidoSel = 0;
    desenharRapido();
    mostrarCaixa('rapido');
    $('pq-filtro').focus();
  }
  $('pq-filtro').addEventListener('input', () => { rapidoSel = 0; desenharRapido(); });
  $('pq-filtro').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rapidoSel = (rapidoSel + (e.key === 'ArrowDown' ? 1 : -1) + rapidoItens.length) % Math.max(1, rapidoItens.length);
      desenharRapido();
    } else if (e.key === 'Enter' && rapidoItens[rapidoSel]) {
      e.preventDefault();
      abrirRapido(rapidoItens[rapidoSel]);
    }
  });
  caixas.abrir.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!abrindo) return;
    const erro = await abrirSessao(abrindo.projeto, abrindo.modelo, 'novo', $('pa-tarefa').value.trim(), { ia: abrindo.ia });
    if (erro) { $('pa-erro').textContent = erro; return; }
    if (caixas.abrir.classList.contains('oculto')) return; // trocou para outra janelinha (instalar, pasta ocupada...)
    fechar();
  });
  $('pa-tarefa').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); caixas.abrir.requestSubmit(); } });
  $('pa-cancelar').addEventListener('click', fechar);
  $('pi-fechar').addEventListener('click', fechar);
  $('pi-copiar').addEventListener('click', async () => {
    const ok = await chamar(() => window.widget.cerebroCopiar($('pi-comando').textContent));
    dizer(ok === true ? 'Comando copiado! Cole no PowerShell.' : 'Não consegui copiar.');
  });
  $('pi-docs').addEventListener('click', () => chamar(() => window.widget.iasDocs(instalando)));
  $('pj-pular').addEventListener('change', () => {
    $('pj-perigo').classList.toggle('oculto', !$('pj-pular').checked);
    if ($('pj-pular').checked) dizer('Cuidado! Com isso a IA faz tudo sem perguntar. Só ligue se tiver certeza.');
  });

  $('proj-adicionar').addEventListener('click', adicionar);

  // Busca rápida de projetos
  const campoFiltro = $('proj-filtro');
  if (campoFiltro) {
    campoFiltro.addEventListener('input', (e) => {
      termoFiltro = e.target.value.toLowerCase().trim();
      desenhar();
    });
  }

  // Atalho de skills no diálogo de estado criado
  const btnPeSkills = $('pe-skills');
  if (btnPeSkills) {
    btnPeSkills.addEventListener('click', () => {
      fechar();
      const id = caixas.estado.dataset.id;
      const p = cadastro.find((item) => item.id === id);
      if (p) abrirSkillsModal(p);
    });
  }

  // Ações do modal de skills do projeto
  $('pks-fechar').addEventListener('click', fechar);
  const btnPksOnline = $('pks-btn-online');
  if (btnPksOnline) {
    btnPksOnline.addEventListener('click', async () => {
      if (!modalProjetoSkills || btnPksOnline.disabled) return;
      btnPksOnline.disabled = true;
      btnPksOnline.textContent = '[🌐 consultando GitHub...]';
      dizer('Consultando repositórios online (GitHub, Anthropic, OpenAI)...');
      try {
        await abrirSkillsModal(modalProjetoSkills, true);
      } finally {
        btnPksOnline.disabled = false;
        btnPksOnline.textContent = '[🌐 buscar online]';
      }
    });
  }
  $('pks-copiar-cmd').addEventListener('click', async () => {
    if (modalProjetoSkills) {
      await chamar(() => window.widget.cerebroCopiar(`/avaliar ${modalProjetoSkills.id} online`));
      $('pks-copiar-cmd').textContent = 'copiado!';
      dizer(`Comando "/avaliar ${modalProjetoSkills.id} online" copiado! Cole na sua sessão.`);
      setTimeout(() => { $('pks-copiar-cmd').textContent = '[copiar /avaliar]'; }, 2000);
    }
  });

  document.querySelectorAll('.pks-filtro-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pks-filtro-btn').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      filtroSkills = btn.dataset.filtro;
      desenharSkillsModal();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !emTela || dialogo.classList.contains('oculto')) return;
    if (!caixas.trocar.classList.contains('oculto')) fecharTrocarConta();
    else if (!caixas.pausa.classList.contains('oculto')) encerrarPausa();
    else fechar();
  });

  return {
    iniciar(cfg) { // por IA: o formato antigo (um booleano; uma leitura só) já chega migrado para o Claude pelo main.js
      avisoTrocaVisto = cfg.avisoTrocaContaVisto && typeof cfg.avisoTrocaContaVisto === 'object' ? { ...cfg.avisoTrocaContaVisto } : { claude: cfg.avisoTrocaContaVisto === true };
      ultimoUso = cfg.ultimoUso && typeof cfg.ultimoUso === 'object' && !Array.isArray(cfg.ultimoUso.medidores) ? { ...cfg.ultimoUso } : {};
    },
    visivel(v) {
      emTela = v;
      acompanhar(v);
      terminalEmb.visivel(v);
      if (!v) {
        if (pausa && !pausa.aMao) pausa = null; // a pausa só sobrevive à troca de aba quando você foi escrever o resumo à mão
        fechar();
        return;
      }
      carregar(false);
      if (pausa) irParaPasso(pausa.passo); // voltou da aba Cérebro: segue do passo 2 (atualizar o estado)
    },
    seletorRapido,
    // uma sessão embutida acabou ou foi fechada: a lista de sessões ativas se atualiza na hora
    sessoesMudaram: () => atualizarSessoes(),
  };
})();
terminalEmb.aoMudar(() => projetos.sessoesMudaram());

// ---------- Skills (aba skills) ----------
// Custo de cada skill em tokens e o "imposto fixo" de toda conversa. Os números (e a simulação de instalar
// ou remover) vêm do cerebro/tools/tokens.py; instalar, remover, ler e importar, do skills-biblioteca/skills.py
// (app/skills.js só chama). Nada roda sozinho: o painel é calculado ao abrir a aba e em [atualizar], e o
// tokens.py guarda cache por arquivo (só relê o que mudou). Fixo = nome+descrição, em TODA conversa em que a
// skill está instalada; ao usar = o corpo do SKILL.md, a cada ativação.
const skillsAba = (() => {
  const $ = (id) => document.getElementById(id);
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const INTERVALO = 10000; // reabrir a aba em menos de 10 s não recalcula
  const caixas = { conf: $('sk-conf'), info: $('sk-info'), imp: $('sk-imp') };
  const painelEl = $('aba-skills');

  let dados = null; // último painel do tokens.py
  let projeto = '';
  let projetoInicial = '';
  let escopo = 'projeto';
  let carregando = false;
  let ultimaCarga = 0;
  let emTela = false;
  let vista = 'lista'; // lista | comp | leitor | cat
  let guiaVisto = false; // o quadro "como as skills funcionam" já foi dispensado
  let guiaAberto = false; // [como funciona] mostra o quadro de novo
  let confirmacao = null; // { executar() } da janelinha de confirmar
  let revisao = null; // skill de fora em revisão
  let alvo = 'claude'; // claude | antigravity | ambos: de qual IA é o que a tela mostra
  let dadosPor = {}; // o painel de cada IA carregada (custo, imposto, onde está instalada): { claude, antigravity }

  const el = (tag, classe, conteudo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (conteudo !== undefined) e.textContent = conteudo;
    return e;
  };
  const botao = (rotulo, aoClicar, titulo) => {
    const b = el('button', 'botao-cmd', IOS ? rotulo.replace(/^\[|\]$/g, '') : rotulo);
    b.type = 'button';
    if (titulo) b.title = titulo;
    b.addEventListener('click', aoClicar);
    return b;
  };
  const num = (v) => Number(v).toLocaleString('pt-BR');
  const chamar = async (fn) => {
    try { return await fn(); } catch (erro) { return { ok: false, tipo: 'erro', erro: 'falha interna: ' + erro.message }; }
  };
  const nomeDoProjeto = () => (dados && dados.projetos.find((p) => p.id === projeto) || {}).nome || projeto;
  // ----- IA (alvo): cada uma tem o próprio painel vindo do tokens.py; "ambos" mostra as duas -----
  const NOME_IA = { claude: 'Claude', antigravity: 'Antigravity' };
  const TODAS = ['claude', 'antigravity'];
  const alvosAtivos = () => (alvo === 'ambos' ? TODAS : [alvo]);
  const cartaoDe = (nome, a) => (dadosPor[a] && dadosPor[a].skills.find((s) => s.nome === nome)) || null;
  const compativelCom = (c, a) => !Array.isArray(c.compativel) || c.compativel.includes(a); // só as testadas na IA entram no manifesto
  const ondeTexto = () => (escopo === 'projeto' ? 'no projeto ' + nomeDoProjeto() : 'globalmente');

  // ----- vistas: lista, comparação e leitura (as duas últimas escondem os controles para dar espaço) -----
  function mostrar(qual) {
    vista = qual;
    $('sk-lista').classList.toggle('oculto', qual !== 'lista');
    $('sk-comp').classList.toggle('oculto', qual !== 'comp');
    $('sk-cat').classList.toggle('oculto', qual !== 'cat');
    $('sk-leitor').classList.toggle('oculto', qual !== 'leitor');
    painelEl.classList.toggle('sub', qual !== 'lista');
    if (qual === 'comp') { desenharComparacao(); window.addEventListener('resize', desenharComparacao); }
    else window.removeEventListener('resize', desenharComparacao);
  }

  // ----- imposto fixo: número grande + barra de 0 a 8.000 (verde até 4.000 na faixa econômica, amarela até 8.000, vermelha acima), um bloco por IA -----
  const IMP = ['', '-2'].map((s, n) => ({ bloco: $('sk-imposto-' + (n + 1)), total: $('sk-total' + s), sub: $('sk-sub' + s), cheia: $('sk-barra-cheia' + s), barra: $('sk-barra' + s),
    detalhe: $('sk-detalhe' + s), rot: $('sk-rot' + s), sim: el('div', 'sk-barra-sim') }));
  IMP.forEach((b) => b.barra.append(b.sim));
  function detalheNormal(a) {
    const i = dadosPor[a].imposto;
    const regras = a === 'claude' ? ` + CLAUDE.md ${num(i.claude_md_global)}` + (i.projeto ? ` + ${num(i.claude_md_projeto)} do projeto` : '')
      : (i.projeto ? ` + ${num(i.claude_md_projeto)} de AGENTS.md e regras` : '') + (i.nao_confirmado ? ` (GEMINI.md global: +${num(i.nao_confirmado)}, não confirmado, fora da conta)` : '');
    const statusEco = i.total <= i.faixa_verde
      ? ' · economizando (< busca normal)'
      : (i.total > i.limite ? ` · ACIMA de ${num(i.limite)}` : ' · moderado');
    return `${i.skills} skills (${num(i.skills_tokens)})` + (i.plugins ? ` + ${i.plugins} de plugins (${num(i.plugins_tokens)})` : '') + regras
      + ` · ${i.contexto}` + statusEco;
  }
  function desenharImposto() {
    const ativos = alvosAtivos();
    IMP.forEach((b, n) => {
      const a = ativos[n];
      b.bloco.classList.toggle('oculto', !a);
      if (!a) return;
      const i = dadosPor[a].imposto;
      b.rot.textContent = NOME_IA[a] + (a === 'claude' ? '' : ' (estimado)');
      b.total.textContent = num(i.total);
      b.total.className = i.cor;
      if (b.sub) {
        b.sub.textContent = i.cor === 'verde'
          ? 'tokens fixos · economizando'
          : (i.cor === 'amarela' ? 'tokens fixos por conversa' : 'tokens fixos · acima da média');
      }
      b.cheia.className = 'sk-barra-cheia ' + i.cor;
      b.cheia.style.width = Math.min(100, (i.total / i.limite) * 100) + '%';
      b.barra.setAttribute('aria-valuenow', String(i.total));
      b.detalhe.className = 'sk-detalhe';
      b.detalhe.textContent = detalheNormal(a);
      b.detalhe.title = detalheNormal(a);
      b.sim.classList.remove('ativa');
    });
  }
  // passar o mouse em [instalar]/[remover]: "o imposto fixo passará de N para M tokens", em cada IA mostrada
  function mostrarSim(c, acao) {
    alvosAtivos().forEach((a, n) => {
      const cA = cartaoDe(c.nome, a);
      const s = cA && cA.sim;
      if (!s || s.depois === null || s.acao !== acao || (acao === 'instalar' && !compativelCom(c, a))) return;
      const b = IMP[n];
      const d = s.depois - s.antes;
      b.detalhe.className = 'sk-detalhe sim';
      b.barra.parentElement.classList.add('simulando');
      b.detalhe.textContent = `o imposto fixo passará de ${num(s.antes)} para ${num(s.depois)} tokens (${d >= 0 ? '+' : '−'}${num(Math.abs(d))}) se ${s.acao} ${c.titulo || c.nome}`;
      b.detalhe.title = b.detalhe.textContent;
      b.sim.style.width = Math.min(100, (s.depois / dadosPor[a].imposto.limite) * 100) + '%';
      b.sim.classList.add('ativa');
    });
  }
  function limparSim() {
    if (!dados) return;
    alvosAtivos().forEach((a, n) => {
      const b = IMP[n];
      b.detalhe.className = 'sk-detalhe';
      b.detalhe.textContent = detalheNormal(a);
      b.barra.parentElement.classList.remove('simulando');
      b.sim.classList.remove('ativa');
    });
  }

  // ----- cartões -----
  function linhaBarra(rotulo, valor, classe) {
    const l = el('div', 'sk-linha');
    const trilho = el('span', 'sk-trilho');
    const b = el('i', 'sk-barra-valor ' + classe);
    b.style.width = valor ? Math.max(3, Math.round((valor / dados.escala) * 100)) + '%' : '0';
    trilho.append(b);
    l.append(el('span', 'sk-rot', rotulo), trilho, el('span', 'sk-valor', num(valor)));
    return l;
  }
  function selo(texto, lugar, versaoBiblioteca) {
    const alheio = lugar.estado === 'outro-meio';
    const s = el('span', 'sk-selo' + (alheio ? ' alheio' : ''), alheio ? texto + ' (outro meio)' : texto);
    if (lugar.estado === 'desatualizada') {
      s.classList.add('velho');
      s.title = `instalada v${lugar.versao}; a biblioteca tem v${versaoBiblioteca}`;
    }
    return s;
  }
  function cartao(c) {
    const k = el('div', 'sk-cartao' + (c.problemas.length ? ' invalido' : ''));
    const cab = el('div', 'sk-cab');
    cab.append(el('span', 'sk-titulo', c.titulo || c.nome), el('span', 'sk-versao', 'v' + c.versao));
    const selos = el('div', 'sk-selos');
    const vers = (l) => (l.versao ? ' v' + l.versao : '');
    alvosAtivos().forEach((a) => { // um selo por IA e por lugar: "Claude: projeto v1.0.0", "Antigravity: global v1.0.0"
      const cA = cartaoDe(c.nome, a) || c;
      if (cA.instalada.projeto) selos.append(selo(`${NOME_IA[a]}: projeto${vers(cA.instalada.projeto)}`, cA.instalada.projeto, c.versao));
      if (cA.instalada.global) selos.append(selo(`${NOME_IA[a]}: global${vers(cA.instalada.global)}`, cA.instalada.global, c.versao));
    });
    c.alertas.forEach((a) => { const s = el('span', 'sk-selo alerta', '⚠ ' + a.split(':')[0]); s.title = a; selos.append(s); });
    const desc = el('div', 'sk-desc', c.descricao_curta || '');
    desc.title = c.descricao_curta || '';
    const ex = el('div', 'sk-ex');
    ex.append(el('i', null, '“' + (c.exemplo_de_uso || '') + '”'));
    ex.title = 'Exemplo de pedido que aciona a skill: ' + (c.exemplo_de_uso || '');
    k.append(cab, selos, desc, ex);
    if (c.alternativa_a && c.alternativa_a.length) {
      const dup = c.alternativa_instalada || [];
      k.append(el('div', 'sk-aviso', `substitui ${c.alternativa_a.join(', ')}: instale uma ou outra`
        + (dup.length ? ` (já instalada${dup.length > 1 ? 's' : ''}: ${dup.join(', ')}; instalar esta paga o custo fixo das duas)` : '')));
    }
    if (c.problemas.length) {
      k.append(el('div', 'sk-problema', 'manifesto com problema: ' + c.problemas.join('; ')));
      return k;
    }
    const corpo = el('div', 'sk-corpo');
    const barras = el('div', 'sk-barras');
    barras.title = `fixo ${num(c.custo.fixo)} · ao usar ${num(c.custo.ao_usar)}` + (c.custo.extras ? ` · extras ${num(c.custo.extras)}` : '')
      + (c.custo.saida_ferramenta ? ` · saída da ferramenta ~${num(c.custo.saida_ferramenta)}` : '') + ` · por uso ~${num(c.custo.total_estimado_por_uso)} tokens (estimativa)`;
    barras.append(linhaBarra('fixo', c.custo.fixo, 'fixo'), linhaBarra('ao usar', c.custo.ao_usar, 'uso'));
    if (alvo === 'ambos') { // as barras são do Claude; o número do Antigravity (estimado) vai na dica
      const g = cartaoDe(c.nome, 'antigravity');
      if (g && g.custo) barras.title += ` · Antigravity (estimado): fixo ${num(g.custo.fixo)} · ao usar ${num(g.custo.ao_usar)}`;
    }
    const acoes = el('div', 'sk-acoes');
    const cartoesIA = alvosAtivos().map((a) => ({ a, c: cartaoDe(c.nome, a) })).filter((x) => x.c);
    const onde = escopo === 'projeto' ? 'no projeto' : 'global';
    for (const acao of ['instalar', 'remover']) { // o botão abre a janela que pergunta em qual IA (Claude, Antigravity ou Ambos)
      if (!cartoesIA.some((x) => x.c.sim && x.c.sim.acao === acao && (acao === 'remover' || compativelCom(c, x.a)))) continue;
      const b = botao(`[${acao} ${onde}]`, () => confirmar(c, acao), `Pergunta em qual IA e mostra o que muda no imposto fixo antes de ${acao}`);
      ['mouseenter', 'focus'].forEach((ev) => b.addEventListener(ev, () => mostrarSim(c, acao)));
      ['mouseleave', 'blur'].forEach((ev) => b.addEventListener(ev, limparSim));
      acoes.append(b);
    }
    const semTeste = alvosAtivos().filter((a) => !compativelCom(c, a));
    if (semTeste.length) acoes.append(el('span', 'sk-nota', 'sem teste no ' + semTeste.map((a) => NOME_IA[a]).join(' e no ')));
    if (cartoesIA.some((x) => x.c.instalada[escopo] && !x.c.sim)) acoes.append(el('span', 'sk-nota', 'instalada por outro meio: não mexo'));
    acoes.append(botao('[ver conteúdo]', () => ver(c), 'Abre o SKILL.md em modo de leitura'));
    corpo.append(barras, acoes);
    k.append(corpo);
    return k;
  }
  function desenharLista() {
    const cat = $('sk-categoria').value;
    const q = $('sk-busca').value.trim().toLowerCase();
    const itens = dados.skills.filter((c) => (!cat || c.categoria === cat)
      && (!q || [c.nome, c.titulo, c.descricao_curta, c.exemplo_de_uso].some((x) => String(x || '').toLowerCase().includes(q))));
    $('sk-lista').replaceChildren(...(!guiaVisto || guiaAberto ? [quadroGuia()] : []), ...(itens.length ? itens.map(cartao)
      : [el('div', 'cer-aviso', dados.skills.length ? 'Nenhuma skill combina com o filtro.' : 'A biblioteca está vazia: use [buscar online] ou [importar].')]));
  }
  // "como as skills funcionam" em 3 passos (aparece na primeira vez e em [como funciona])
  function quadroGuia() {
    const q = el('div', 'sk-guia');
    const topo = el('div', 'sk-guia-topo');
    topo.append(el('b', null, 'como as skills funcionam'), botao('[entendi]', () => {
      guiaVisto = true;
      guiaAberto = false;
      mudarConfig((cfg) => { cfg.skillsGuiaVisto = true; }).catch((e) => console.error('Erro ao salvar o guia:', e));
      desenharLista();
    }, 'Esconde este quadro (o botão [como funciona] o traz de volta)'));
    const passos = el('div', 'sk-passos');
    for (const [n, titulo, texto] of [
      ['1', 'Biblioteca', 'Todas as suas skills ficam guardadas aqui, num lugar só. Traga novas em [buscar online] (GitHub) ou [importar].'],
      ['2', 'Instalar', 'Para a IA usar uma skill, instale: no projeto (vale só nele) ou global (todas as conversas). Remover é só tirar de lá.'],
      ['3', 'A IA usa', 'Cada skill instalada custa um pouco em TODA conversa (nome e descrição) e o texto inteiro só quando ela é usada. Instale só o que precisa.'],
    ]) {
      const p = el('div', 'sk-passo');
      p.append(el('i', null, n), el('b', null, titulo), el('span', null, texto));
      passos.append(p);
    }
    const acoes = el('div', 'sk-guia-acoes');
    acoes.append(botao('[buscar skills online]', abrirCatalogo), botao('[como o custo é calculado]', mostrarCusto));
    q.append(topo, passos, acoes);
    return q;
  }
  function desenhar() {
    const sel = $('sk-projeto');
    sel.replaceChildren(new Option('(nenhum: só global)', ''), ...dados.projetos.map((p) => new Option(p.nome, p.id)));
    sel.value = projeto;
    const temProjeto = !!projeto;
    painelEl.querySelectorAll('[data-escopo]').forEach((b) => {
      b.classList.toggle('ativo', b.dataset.escopo === escopo);
      b.setAttribute('aria-checked', String(b.dataset.escopo === escopo));
      if (b.dataset.escopo === 'projeto') b.disabled = !temProjeto;
    });
    painelEl.querySelectorAll('[data-alvo]').forEach((b) => {
      b.classList.toggle('ativo', b.dataset.alvo === alvo);
      b.setAttribute('aria-checked', String(b.dataset.alvo === alvo));
    });
    const cats = $('sk-categoria');
    const atual = cats.value;
    cats.replaceChildren(new Option('todas', ''), ...dados.categorias
      .filter((c) => dados.skills.some((s) => s.categoria === c)).map((c) => new Option(c + ' (' + dados.skills.filter((s) => s.categoria === c).length + ')', c)));
    cats.value = [...cats.options].some((o) => o.value === atual) ? atual : '';
    desenharImposto();
    desenharLista();
    if (vista === 'comp') desenharComparacao();
  }

  // ----- carregar (só ao abrir a aba ou em [atualizar]; o tokens.py só relê o que mudou) -----
  function erroTela(r) {
    $('sk-lista').replaceChildren(el('div', 'cer-erro-texto', r.erro || 'não consegui calcular os custos'));
    mostrar('lista');
  }
  async function carregar(forcar) {
    if (carregando) return;
    if (!forcar && dados && Date.now() - ultimaCarga < INTERVALO) return;
    carregando = true;
    IMP[0].detalhe.textContent = 'calculando…';
    const ativos = alvosAtivos();
    const buscar = async () => { // uma IA de cada vez: o tokens.py grava o cache em um arquivo só
      const novos = {};
      for (const a of ativos) {
        const r = await chamar(() => window.widget.skillsPainel(escopo, projeto, a));
        if (!r.ok) return { erro: r };
        novos[a] = r.dados;
      }
      return { novos };
    };
    let res = await buscar();
    if (!res.erro && !dados && !projeto && res.novos[ativos[0]].projetos.length) { // primeira vez: escolhe o projeto e mede a conversa dele
      const lista = res.novos[ativos[0]].projetos;
      projeto = lista.some((p) => p.id === projetoInicial) ? projetoInicial : lista[0].id;
      escopo = 'projeto';
      res = await buscar();
    }
    carregando = false;
    if (res.erro) { IMP[0].detalhe.textContent = '--'; erroTela(res.erro); return; }
    dadosPor = res.novos;
    dados = dadosPor[ativos[0]];
    escopo = dados.escopo;
    ultimaCarga = Date.now();
    desenhar();
  }

  // ----- janelinhas -----
  const dialogo = $('sk-dialogo');
  function abrirCaixa(qual) {
    for (const [nome, c] of Object.entries(caixas)) c.classList.toggle('oculto', nome !== qual);
    dialogo.classList.remove('oculto');
  }
  const fechar = () => { dialogo.classList.add('oculto'); confirmacao = null; revisao = null; };

  // instalar / remover, sempre com a simulação antes e perguntando em qual IA (Claude, Antigravity ou Ambos)
  async function confirmar(c, acao) {
    const instalar = acao === 'instalar';
    for (const a of TODAS) { // a janela precisa do painel das duas IAs; a que falta é buscada agora, por clique seu
      if (!dadosPor[a]) {
        const r = await chamar(() => window.widget.skillsPainel(escopo, projeto, a));
        if (r.ok) dadosPor[a] = r.dados;
      }
    }
    const valida = (a) => {
      const cA = cartaoDe(c.nome, a);
      return !!cA && !!cA.sim && cA.sim.depois !== null && cA.sim.acao === acao && (!instalar || compativelCom(c, a));
    };
    const validas = TODAS.filter(valida);
    if (!validas.length) return;
    let escolha = alvo === 'ambos' ? (validas.length === TODAS.length ? 'ambos' : validas[0]) : (valida(alvo) ? alvo : validas[0]);
    const opcoes = [...TODAS.map((a) => [a, NOME_IA[a], valida(a)]), ['ambos', 'Ambos', validas.length === TODAS.length]];
    const alvosDe = (e) => (e === 'ambos' ? TODAS : [e]);
    function texto() {
      const ias = alvosDe(escolha);
      const partes = ias.map((a) => {
        const s = cartaoDe(c.nome, a).sim;
        const d = s.depois - s.antes;
        return `${NOME_IA[a]} ${num(s.antes)} → ${num(s.depois)} (${d >= 0 ? '+' : '−'}${num(Math.abs(d))})`;
      });
      const custo = cartaoDe(c.nome, ias[0]).custo;
      $('sk-conf-titulo').textContent = `${acao} "${c.titulo || c.nome}" ${ondeTexto()}`;
      $('sk-conf-texto').textContent = `O imposto fixo por conversa passará de: ${partes.join(' · ')} tokens.`
        + ` Fixo da skill: ${num(custo.fixo)}; cada uso acrescenta ~${num(custo.total_estimado_por_uso)} (estimativa; no Antigravity cada modelo conta de um jeito).`;
      const avisos = [];
      for (const a of ias) {
        const cA = cartaoDe(c.nome, a);
        if (cA.sim.depois > dadosPor[a].imposto.limite) avisos.push(`Isso deixa o imposto do ${NOME_IA[a]} acima de ${num(dadosPor[a].imposto.limite)} tokens.`);
        if (instalar && cA.alternativa_instalada && cA.alternativa_instalada.length) {
          avisos.push(`${NOME_IA[a]}: substitui ${cA.alternativa_a.join(', ')}; já instalada(s): ${cA.alternativa_instalada.join(', ')}. Você pagaria o custo fixo das duas: instale uma ou outra.`);
        }
      }
      $('sk-conf-aviso').textContent = avisos.join(' ');
      $('sk-conf-aviso').classList.toggle('oculto', !avisos.length);
    }
    function desenharEscolha() {
      $('sk-conf-ia').replaceChildren(...opcoes.map(([id, rotulo, ok]) => {
        const b = el('button', 'estilo-op' + (id === escolha ? ' ativo' : ''), rotulo);
        b.type = 'button';
        b.disabled = !ok;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(id === escolha));
        b.addEventListener('click', () => { escolha = id; desenharEscolha(); texto(); });
        return b;
      }));
    }
    desenharEscolha();
    texto();
    $('sk-conf-erro').textContent = '';
    $('sk-conf-sim').textContent = acao;
    confirmacao = async () => {
      const r = await chamar(() => (instalar ? window.widget.skillsInstalar(c.nome, escopo, projeto, escolha) : window.widget.skillsRemover(c.nome, escopo, projeto, escolha)));
      const resultados = r.dados && r.dados.resultados; // "ambos": um resultado por IA; falhar numa não desfaz a outra
      if (!r.ok && !resultados) return r.erro;
      const feitos = resultados ? resultados.filter((x) => x.ok).map((x) => x.alvo) : alvosDe(escolha);
      const falhas = resultados ? resultados.filter((x) => !x.ok) : [];
      if (!feitos.length) return falhas.map((x) => `${NOME_IA[x.alvo] || x.alvo}: ${x.erro}`).join(' · ');
      const depois = feitos.map((a) => `${NOME_IA[a]} ${num(cartaoDe(c.nome, a).sim.depois)}`).join(' · ');
      dizer(`${instalar ? 'Instalei' : 'Removi'} "${c.titulo || c.nome}" ${ondeTexto()} (${feitos.map((a) => NOME_IA[a]).join(' e ')}). Imposto: ${depois} tokens.`
        + (falhas.length ? ` Não deu certo no ${falhas.map((x) => `${NOME_IA[x.alvo] || x.alvo} (${x.erro})`).join('; ')}.` : ''));
      ultimaCarga = 0;
      await carregar(true);
      return '';
    };
    abrirCaixa('conf');
    $('sk-conf-sim').focus();
  }
  $('sk-conf-nao').addEventListener('click', fechar);
  $('sk-conf-sim').addEventListener('click', async () => {
    if (!confirmacao) return;
    const rodar = confirmacao;
    $('sk-conf-sim').disabled = true;
    const erro = await rodar();
    $('sk-conf-sim').disabled = false;
    if (erro) $('sk-conf-erro').textContent = erro; else fechar();
  });

  // ver conteúdo (somente leitura)
  async function ver(c) {
    $('sk-leitor-nome').textContent = c.nome + '/SKILL.md';
    $('sk-texto').textContent = 'lendo…';
    mostrar('leitor');
    const r = await chamar(() => window.widget.skillsLer(c.nome, dados.alvo));
    $('sk-texto').textContent = r.ok ? r.dados.conteudo : r.erro;
    $('sk-texto').scrollTop = 0;
  }
  $('sk-leitor-voltar').addEventListener('click', () => mostrar('lista'));

  // ----- gráfico geral: todas as skills, fixo e ao usar lado a lado, da mais cara para a mais barata (canvas puro) -----
  function desenharComparacao() {
    if (!dados || vista !== 'comp') return;
    const itens = dados.skills.filter((c) => c.custo).sort((a, b) => (b.custo.fixo + b.custo.ao_usar) - (a.custo.fixo + a.custo.ao_usar));
    const canvas = $('sk-canvas');
    const linha = 34;
    const topo = 4;
    canvas.style.height = (topo + itens.length * linha + 18) + 'px';
    const { ctx, w, h } = prepararCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const cor = (v, padrao) => css.getPropertyValue(v).trim() || padrao;
    const cFixo = cor('--sk-fixo', '#4f9dff');
    const cUso = cor('--sk-uso', '#c792ea');
    const cTexto = cor('--text', '#cccccc');
    const cApagado = cor('--apagado', '#6e6e6e');
    const rotuloW = Math.min(150, Math.max(90, Math.floor(w * 0.3)));
    const valorW = 40;
    const area = Math.max(20, w - rotuloW - valorW - 8);
    ctx.font = '11px Consolas, monospace';
    ctx.textBaseline = 'middle';
    // linhas-guia (0, 50% e 100% da escala)
    ctx.strokeStyle = cApagado;
    ctx.globalAlpha = 0.25;
    [0, 0.5, 1].forEach((f) => { const x = Math.round(rotuloW + area * f) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke(); });
    ctx.globalAlpha = 1;
    const barra = (x, y, larg, altura, cr) => {
      ctx.fillStyle = cr;
      if (IOS && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, Math.max(larg, 0), altura, 3); ctx.fill(); } else ctx.fillRect(x, y, Math.max(larg, 0), altura);
    };
    itens.forEach((c, i) => {
      const y = topo + i * linha;
      let nome = c.titulo || c.nome;
      while (nome.length > 3 && ctx.measureText(nome).width > rotuloW - 8) nome = nome.slice(0, -2) + '…';
      ctx.fillStyle = cTexto;
      ctx.textAlign = 'left';
      ctx.fillText(nome, 2, y + linha / 2 - 1);
      [['fixo', c.custo.fixo, cFixo, 4], ['uso', c.custo.ao_usar, cUso, 18]].forEach(([, v, cr, dy]) => {
        const l = v ? Math.max(2, (v / dados.escala) * area) : 0;
        barra(rotuloW, y + dy - 2, l, 11, cr);
        ctx.fillStyle = cTexto;
        ctx.fillText(num(v), rotuloW + l + 5, y + dy + 3.5);
      });
    });
    ctx.fillStyle = cApagado;
    ctx.textAlign = 'left';
    ctx.fillText('0', rotuloW, h - 6);
    ctx.textAlign = 'center';
    ctx.fillText(num(Math.round(dados.escala / 2)), rotuloW + area / 2, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText(num(dados.escala) + ' tokens', rotuloW + area, h - 6);
    canvas.setAttribute('aria-label', 'Custo fixo e ao usar de cada skill, da mais cara para a mais barata');
  }
  $('sk-comparar').addEventListener('click', () => { if (dados) mostrar('comp'); });
  $('sk-comp-voltar').addEventListener('click', () => mostrar('lista'));

  // ----- como o custo é calculado -----
  $('sk-ajuda').addEventListener('click', () => {
    guiaAberto = true;
    if (vista !== 'lista') mostrar('lista');
    if (dados) { desenharLista(); $('sk-lista').scrollTop = 0; }
  });
  function mostrarCusto() {
    const f = dados ? dados.estimativa : { fator: 1.1, origem: 'padrão' };
    const lim = dados && dados.imposto ? dados.imposto.limite : 8000;
    const verde = dados && dados.imposto ? dados.imposto.faixa_verde : 4000;
    $('sk-info-texto').textContent = (dados ? dados.conceito : '')
      + ` A barra fica verde até ${num(verde)} tokens (faixa de economia: bem menor que uma busca normal sem skills), amarela até ${num(lim)} e vermelha acima. O imposto fixo soma as skills instaladas`
      + ' (globais e do projeto) e as instruções da IA (Claude: CLAUDE.md global e do projeto; Antigravity: AGENTS.md e regras always_on do projeto; o GEMINI.md global ainda não foi confirmado e fica fora da conta): tudo isso entra em toda conversa. '
      + `Estimativa: caracteres/4 para cima, com fator ${String(f.fator).replace('.', ',')} (${f.origem}).`
      + ' Cada modelo conta tokens de um jeito: no Antigravity o número é só estimado (sem calibração) e nenhuma API é chamada para contar.';
    abrirCaixa('info');
  }
  $('sk-info-ok').addEventListener('click', fechar);

  // ----- importar skill de fora (fluxo seguro: ler tudo e ver os alertas antes de adicionar; nada é executado) -----
  function abrirImportar() {
    revisao = null;
    $('sk-imp-titulo').textContent = 'importar skill';
    $('sk-imp-escolha').classList.remove('oculto');
    $('sk-imp-revisao').classList.add('oculto');
    $('sk-imp-ok').classList.add('oculto');
    $('sk-imp-categoria').classList.add('oculto');
    $('sk-imp-erro').textContent = '';
    abrirCaixa('imp');
  }
  async function escolherOrigem(tipo) {
    $('sk-imp-erro').textContent = '';
    const o = await chamar(() => window.widget.skillsEscolherOrigem(tipo));
    if (!o.ok) { if (o.tipo !== 'cancelado') $('sk-imp-erro').textContent = o.erro; return; }
    const r = await chamar(() => window.widget.skillsImportar(false, ''));
    if (!r.ok) { $('sk-imp-erro').textContent = r.erro; return; }
    revisar(r.dados);
  }
  function revisar(d) {
    revisao = d;
    const scripts = d.arquivos.filter((a) => a.script).map((a) => a.arquivo);
    $('sk-imp-titulo').textContent = d.nome; // curto: o título divide a linha com a categoria e os botões
    $('sk-imp-resumo').textContent = `${d.arquivos.length} arquivo(s)` + (scripts.length ? `; SCRIPTS: ${scripts.join(', ')}` : '; nenhum script');
    $('sk-imp-resumo').title = 'Origem: ' + d.origem;
    const alertas = d.alertas.length
      ? d.alertas.map((a) => {
        const l = el('div', 'sk-alerta');
        l.append(el('b', null, `⚠ ${a.arquivo}${a.linha ? ':' + a.linha : ''} `), document.createTextNode(a.motivo + (a.trecho ? ' | ' : '')));
        if (a.trecho) l.append(el('code', null, a.trecho));
        return l;
      })
      : [el('div', 'sk-alerta ok', 'nenhum trecho perigoso encontrado (isso não garante nada: leia o conteúdo)')];
    d.avisos.forEach((a) => alertas.push(el('div', 'sk-alerta ok', 'aviso de formato: ' + a)));
    $('sk-imp-alertas').replaceChildren(...alertas);
    $('sk-imp-alertas').classList.toggle('perigo', d.alertas.length > 0);
    const cat = $('sk-imp-categoria');
    cat.replaceChildren(...(dados ? dados.categorias : ['outros']).map((c) => new Option(c, c)));
    cat.value = 'outros';
    cat.classList.remove('oculto');
    $('sk-imp-conteudo').textContent = d.skill_md;
    $('sk-imp-conteudo').scrollTop = 0;
    $('sk-imp-escolha').classList.add('oculto');
    $('sk-imp-revisao').classList.remove('oculto');
    $('sk-imp-ok').classList.remove('oculto');
  }
  // depois de baixar do catálogo: abre a mesma janela de revisão de uma skill de fora (SKILL.md inteiro, scripts e alertas)
  async function revisarBaixada() {
    abrirImportar();
    const r = await chamar(() => window.widget.skillsImportar(false, ''));
    if (!r.ok) { $('sk-imp-erro').textContent = r.erro; return; }
    revisar(r.dados);
  }
  $('sk-importar').addEventListener('click', abrirImportar);
  $('sk-imp-pasta').addEventListener('click', () => escolherOrigem('pasta'));
  $('sk-imp-zip').addEventListener('click', () => escolherOrigem('zip'));
  $('sk-imp-cancelar').addEventListener('click', fechar);
  $('sk-imp-ok').addEventListener('click', async () => {
    if (!revisao) return;
    const nome = revisao.nome;
    $('sk-imp-ok').disabled = true;
    const r = await chamar(() => window.widget.skillsImportar(true, $('sk-imp-categoria').value));
    $('sk-imp-ok').disabled = false;
    if (!r.ok) { $('sk-imp-erro').textContent = r.erro; return; }
    fechar();
    dizer(`Adicionei "${nome}" à biblioteca. Ela ainda não está instalada em lugar nenhum.`);
    ultimaCarga = 0;
    await carregar(true);
    if (vista === 'cat') desenharCatalogo();
  });

  // ----- catálogo online (GitHub) -----
  // Fontes: Anthropic (Claude), OpenAI (Codex), repositórios da comunidade (busca) e um repositório digitado. Só roda por clique.
  const cat = { fontes: [], itens: [], repos: [], repoAberto: '', tipo: 'itens', ocupado: false };
  const slugSkill = (n) => String(n).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  const naBiblioteca = (nome) => !!dados && dados.skills.some((s) => s.nome === slugSkill(nome));
  function statusCat(texto, erro = false) { const s = $('sk-cat-status'); s.textContent = texto; s.classList.toggle('erro', erro); }
  function dataCurta(ms) { return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }

  async function abrirCatalogo() {
    mostrar('cat');
    if (!cat.fontes.length) {
      const r = await chamar(() => window.widget.skillsCatalogoFontes());
      if (!r.ok) { statusCat(r.erro || 'não consegui abrir o catálogo', true); return; }
      cat.fontes = r.fontes;
      $('sk-cat-fonte').replaceChildren(...cat.fontes.map((f) => { const o = new Option(f.rotulo, f.id); o.title = f.descricao; return o; }));
    }
    ajustarCampoCat();
    if (!cat.itens.length && !cat.repos.length) buscarCatalogo();
  }
  const fonteAtual = () => cat.fontes.find((f) => f.id === $('sk-cat-fonte').value) || cat.fontes[0];
  function ajustarCampoCat() {
    const f = fonteAtual();
    const campo = $('sk-cat-busca');
    campo.placeholder = f && f.outro ? 'dono/repositório (ex.: addyosmani/agent-skills)' : f && f.busca ? 'buscar repositórios (ex.: pdf, design)' : 'filtrar (ex.: pdf, excel, design)';
    $('sk-cat-voltar').title = cat.repoAberto ? 'Volta para os repositórios' : 'Volta para a biblioteca';
  }
  async function buscarCatalogo() {
    if (cat.ocupado) return;
    const f = fonteAtual();
    if (!f) return;
    const termo = $('sk-cat-busca').value.trim();
    cat.ocupado = true;
    statusCat('buscando no GitHub…');
    $('sk-cat-lista').replaceChildren();
    cat.itens = [];
    cat.repos = [];
    try {
      if (f.busca && !cat.repoAberto) {
        const r = await chamar(() => window.widget.skillsCatalogoRepos(termo));
        if (!r.ok) { statusCat(r.erro, true); return; }
        cat.tipo = 'repos';
        cat.repos = r.repos;
        statusCat(r.repos.length ? `${r.repos.length} repositório(s) da comunidade, os mais estrelados primeiro. Abra um para ver as skills dele.` : 'Nenhum repositório encontrado.');
      } else {
        const repo = f.outro ? termo : f.busca ? cat.repoAberto : f.id;
        if (!repo) { statusCat('Digite dono/repositório (ex.: addyosmani/agent-skills).', true); return; }
        const r = await chamar(() => window.widget.skillsCatalogoListar(repo, f.outro ? '' : termo));
        if (!r.ok) { statusCat(r.erro, true); return; }
        cat.tipo = 'itens';
        cat.itens = r.itens;
        const aviso = r.offline ? `Sem conexão com o GitHub agora: mostrando a lista guardada de ${dataCurta(r.quando)}. ` : '';
        statusCat(aviso + (r.itens.length ? `${r.itens.length} skill(s) em ${repo}` + (r.total > r.itens.length ? ` (de ${r.total})` : '') + (r.mais ? '. Use o filtro para achar as outras.' : '') : `Nenhuma skill encontrada em ${repo}${termo && !f.outro ? ' para "' + termo + '"' : ''}.`), r.offline);
      }
    } finally {
      cat.ocupado = false;
      desenharCatalogo();
    }
  }
  function desenharCatalogo() {
    const lista = $('sk-cat-lista');
    if (cat.tipo === 'repos') {
      lista.replaceChildren(...cat.repos.map((r) => {
        const item = el('div', 'sk-cat-item');
        const nome = el('div', 'sk-cat-nome', r.repo);
        nome.append(el('small', null, `★ ${num(r.estrelas)}${r.atualizado ? ' · ' + r.atualizado : ''}`));
        item.append(nome, el('div', 'sk-cat-desc', r.descricao || 'sem descrição'),
          botao('[ver skills]', () => { cat.repoAberto = r.repo; $('sk-cat-busca').value = ''; ajustarCampoCat(); buscarCatalogo(); }, 'Lista as skills deste repositório'));
        return item;
      }));
      return;
    }
    lista.replaceChildren(...cat.itens.map((i) => {
      const jaTem = naBiblioteca(i.nome);
      const item = el('div', 'sk-cat-item' + (jaTem ? ' pronto' : ''));
      const nome = el('div', 'sk-cat-nome', i.nome);
      nome.append(el('small', null, `${i.repo} · ${i.arquivos} arquivo${i.arquivos > 1 ? 's' : ''}`));
      item.append(nome, el('div', 'sk-cat-desc', i.descricao || 'sem descrição (abra para ver o que ela faz)'),
        jaTem ? el('span', 'sub', 'já na biblioteca') : botao('[baixar]', (e) => baixarItem(i, e.currentTarget), 'Baixa a pasta da skill e mostra tudo para você revisar antes de adicionar'));
      return item;
    }));
  }
  async function baixarItem(i, botaoEl) {
    if (cat.ocupado) return;
    cat.ocupado = true;
    botaoEl.disabled = true;
    statusCat(`baixando ${i.nome}…`);
    const r = await chamar(() => window.widget.skillsCatalogoBaixar(i.repo, i.caminho));
    cat.ocupado = false;
    botaoEl.disabled = false;
    if (!r.ok) { statusCat(r.erro, true); return; }
    statusCat(`${r.nome} baixada (${r.arquivos} arquivo${r.arquivos > 1 ? 's' : ''}). Revise e confirme para adicionar à biblioteca.`);
    revisarBaixada();
  }
  $('sk-online').addEventListener('click', abrirCatalogo);
  $('sk-cat-voltar').addEventListener('click', () => {
    if (cat.repoAberto) { cat.repoAberto = ''; ajustarCampoCat(); buscarCatalogo(); return; }
    mostrar('lista');
  });
  $('sk-cat-fonte').addEventListener('change', () => { cat.repoAberto = ''; cat.itens = []; cat.repos = []; $('sk-cat-busca').value = ''; ajustarCampoCat(); buscarCatalogo(); });
  $('sk-cat-buscar').addEventListener('click', buscarCatalogo);
  $('sk-cat-busca').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarCatalogo(); } });

  // ----- ligações -----
  $('sk-projeto').addEventListener('change', () => {
    projeto = $('sk-projeto').value;
    if (!projeto) escopo = 'global';
    carregar(true);
  });
  painelEl.querySelectorAll('[data-escopo]').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled || escopo === b.dataset.escopo) return;
    escopo = b.dataset.escopo;
    carregar(true);
  }));
  painelEl.querySelectorAll('[data-alvo]').forEach((b) => b.addEventListener('click', () => {
    if (alvo === b.dataset.alvo) return;
    alvo = b.dataset.alvo;
    carregar(true);
  }));
  $('sk-atualizar').addEventListener('click', () => carregar(true));
  $('sk-categoria').addEventListener('change', () => { if (dados) desenharLista(); });
  $('sk-busca').addEventListener('input', () => { if (dados) desenharLista(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !emTela) return;
    if (!dialogo.classList.contains('oculto')) fechar();
    else if (vista !== 'lista') mostrar('lista');
  });

  return {
    iniciar(cfg) { projetoInicial = typeof cfg.cerebroProjeto === 'string' ? cfg.cerebroProjeto : ''; guiaVisto = cfg.skillsGuiaVisto === true; },
    visivel(v) {
      emTela = v;
      if (!v) { fechar(); window.removeEventListener('resize', desenharComparacao); return; }
      if (vista === 'comp') window.addEventListener('resize', desenharComparacao);
      carregar(false);
    },
  };
})();

// ---------- Abas e janela ----------
// Uma aba por vez (nada de tudo na tela). O Pokémon "digita" o comando de cada
// aba no prompt. O modo mini encolhe tudo.
const abas = (() => {
  const cartao = document.getElementById('cartao');
  const botoes = [...document.querySelectorAll('.aba')];
  const paineis = [...document.querySelectorAll('.painel')];
  const ps1 = document.getElementById('ps1');
  const comando = document.getElementById('comando');
  const titulo = document.getElementById('titulo');
  const btnPin = document.getElementById('btn-pin');
  const btnMini = document.getElementById('btn-mini');
  const btnConfig = document.getElementById('btn-config');
  let abaAnterior = 'sys'; // a aba de onde você abriu o Settings (a engrenagem e o [< back] voltam para ela)

  // o "comando" que o Pokémon digita ao abrir cada aba
  const COMANDOS = {
    bloqueio: 'whoami', sys: 'taskmgr', music: 'now-playing', apps: 'dir apps', poke: 'settings', cerebro: 'brain open', projetos: 'projects list', skills: 'skills cost',
  };
  const MODULOS = {
    sys: sistema, music: musica, apps, cerebro, projetos, skills: skillsAba,
  };

  let atual = null;
  let bloqueado = true;
  let mini = false;
  let fixado = true;
  let dono = '';
  let digitacao = 0;
  let salvarTimer = null;

  // Visual iOS: abas com nomes por extenso e título com o nome do Pokémon
  const IOS = document.documentElement.dataset.estilo === 'ios';
  const ROTULOS_IOS = { sys: 'System', music: 'Music', apps: 'Apps', cerebro: 'Brain', projetos: 'Projects', skills: 'Skills' };
  // Fundo opaco que responde ao que está AO REDOR do widget (nada do que está atrás aparece).
  // O main.js manda, a cada 1,5 s, a cor de cada lado ("esquerda direita cima baixo", "-" quando
  // o lado encosta na borda da tela). Cada cor é escurecida até um brilho em que o texto branco
  // continua legível e vira uma mancha difusa no seu lado do cartão (CSS); a troca é suave.
  if (IOS) {
    const LADOS = ['--c-esq', '--c-dir', '--c-topo', '--c-baixo'];
    const BRILHO_MAX = 0.2; // 0 = preto, 1 = branco
    const escurecer = ([r, g, b]) => {
      const brilho = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const k = brilho > BRILHO_MAX ? BRILHO_MAX / brilho : 1;
      // 80% a própria cor (mais escura), 20% o grafite padrão: nunca fica preto chapado
      return [r, g, b].map((v, i) => Math.round(v * k * 0.8 + [20, 20, 28][i] * 0.2));
    };
    window.widget.onFundo((texto) => {
      const lados = String(texto).split(' ');
      if (lados.length !== 4) return;
      const rgb = lados.map((c) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)) : null));
      const lidos = rgb.filter(Boolean);
      if (!lidos.length) return;
      const media = [0, 1, 2].map((i) => Math.round(lidos.reduce((s, c) => s + c[i], 0) / lidos.length));
      const raiz = document.documentElement.style;
      rgb.forEach((c, i) => raiz.setProperty(LADOS[i], 'rgb(' + escurecer(c || media).join(', ') + ')'));
      raiz.setProperty('--c-media', 'rgb(' + escurecer(media).join(', ') + ')');
    });
  }
  if (IOS) {
    botoes.forEach((b) => { b.textContent = ROTULOS_IOS[b.dataset.aba]; });
    // botões de texto sem os [colchetes] do console
    document.querySelectorAll('.botao-cmd').forEach((b) => { b.textContent = b.textContent.replace(/^\[|\]$/g, ''); });
  }

  // título da janela, como o de um console: "C:\WINDOWS\system32\cmd.exe - gengar"
  function desenharTitulo() {
    if (IOS) titulo.textContent = dono ? dono.charAt(0).toUpperCase() + dono.slice(1) : 'Meu Widget';
    else titulo.textContent = 'C:\\WINDOWS\\system32\\cmd.exe' + (dono ? ' - ' + dono : '');
  }

  // digita o comando no prompt (rápido: ~25 ms por letra)
  async function digitarComando(texto) {
    const meu = ++digitacao;
    comando.textContent = '';
    for (let i = 1; i <= texto.length; i++) {
      if (meu !== digitacao) return; // trocou de aba no meio
      comando.textContent = texto.slice(0, i);
      await esperar(economico ? 0 : 25);
    }
  }

  function mostrar(aba, { salvar = true } = {}) {
    if (bloqueado && aba !== 'bloqueio') {
      dizer('Calma! Primeiro escolha quem vai mandar aqui.');
      return;
    }
    if (aba === atual && !mini) return;
    const anterior = atual;
    if (aba === 'poke' && atual && atual !== 'poke' && atual !== 'bloqueio') abaAnterior = atual;
    atual = aba;
    btnConfig.classList.toggle('ativa', aba === 'poke');
    btnConfig.setAttribute('aria-pressed', aba === 'poke');
    botoes.forEach((b) => {
      const ativa = b.dataset.aba === aba;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', ativa);
    });
    paineis.forEach((p) => p.classList.toggle('ativo', p.dataset.painel === aba));
    desenharTitulo();
    digitarComando(COMANDOS[aba] || aba);

    // avisa os módulos (só o visível trabalha de verdade)
    for (const [nome, modulo] of Object.entries(MODULOS)) modulo.visivel(nome === aba && !mini);

    if (salvar && aba !== 'bloqueio' && aba !== 'poke') {
      clearTimeout(salvarTimer); // grava a aba só depois de você parar de trocar
      salvarTimer = setTimeout(() => {
        mudarConfig((cfg) => { cfg.aba = aba; }).catch((erro) => console.error('Erro ao salvar a aba:', erro));
      }, 1500);
    }
  }

  botoes.forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.aba)));
  // Alt+1..6 troca de aba; Alt+0 abre/fecha o Settings
  const alternarConfig = () => mostrar(atual === 'poke' ? abaAnterior : 'poke');
  btnConfig.addEventListener('click', alternarConfig);
  document.getElementById('cfg-voltar').addEventListener('click', () => mostrar(abaAnterior));
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey) return;
    if (e.key === '0') { e.preventDefault(); alternarConfig(); return; }
    const i = Number(e.key) - 1;
    if (i >= 0 && i < botoes.length) { e.preventDefault(); mostrar(botoes[i].dataset.aba); }
  });

  // ----- mini (minimizar) -----
  async function alternarMini() {
    mini = !mini;
    cartao.classList.toggle('mini', mini);
    document.getElementById('ico-mini').classList.toggle('oculto', mini);
    document.getElementById('ico-restaurar').classList.toggle('oculto', !mini);
    btnMini.title = mini ? 'Restaurar' : 'Minimizar';
    for (const [nome, modulo] of Object.entries(MODULOS)) modulo.visivel(!mini && nome === atual);
    try {
      await window.widget.janelaModo(mini ? 'mini' : 'normal');
    } catch (erro) {
      console.error('Erro ao mudar a janela:', erro);
    }
    if (!mini) falar('miniVolta');
    else pokemon.redesenhar();
  }
  btnMini.addEventListener('click', alternarMini);

  // ----- pin (sempre no topo) -----
  function desenharPin() {
    btnPin.classList.toggle('solto', !fixado);
    btnPin.title = fixado ? 'Fixado no topo (clique para soltar)' : 'Solto (clique para fixar no topo)';
  }
  btnPin.addEventListener('click', async () => {
    try {
      const r = await window.widget.janelaFixar(!fixado);
      if (r === null) return;
      fixado = r;
      desenharPin();
      dizer(fixado ? 'Fixado no topo. Daqui ninguém me tira!' : 'Ok, fico atrás das outras janelas. Me acha na barra de tarefas.');
    } catch (erro) {
      console.error('Erro ao fixar:', erro);
    }
  });

  document.getElementById('btn-fechar').addEventListener('click', () => window.widget.fechar());

  // ----- desligar o PC: confirmação 1, confirmação 2 e uma contagem de 20 s que dá para cancelar -----
  const pw = { dlg: document.getElementById('power-dialogo'), titulo: document.getElementById('power-titulo'), texto: document.getElementById('power-texto'),
    contagem: document.getElementById('power-contagem'), erro: document.getElementById('power-erro'), botoes: document.getElementById('power-botoes') };
  let relogio = null;
  const pwBotao = (rotulo, aoClicar, principal) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = rotulo;
    if (principal) b.className = 'principal';
    b.addEventListener('click', aoClicar);
    return b;
  };
  function pwFechar() {
    clearInterval(relogio);
    relogio = null;
    pw.dlg.classList.add('oculto');
    pw.contagem.classList.add('oculto');
  }
  function pwEtapa(n) {
    pw.erro.textContent = '';
    pw.contagem.classList.add('oculto');
    pw.dlg.classList.remove('oculto');
    if (n === 1) {
      pw.titulo.textContent = 'Desligar o PC?';
      pw.texto.textContent = 'Tudo o que está aberto será fechado. Você ainda vai precisar confirmar mais uma vez.';
      pw.botoes.replaceChildren(pwBotao('cancelar', pwFechar), pwBotao('continuar', async () => {
        const r = await window.widget.desligarEtapa(1);
        if (r && r.ok) pwEtapa(2); else pw.erro.textContent = (r && r.erro) || 'não deu';
      }, true));
    } else {
      pw.titulo.textContent = 'Tem certeza? Segunda confirmação';
      pw.texto.textContent = 'O que não estiver salvo em qualquer programa será perdido. Depois de confirmar, o PC desliga em 20 segundos e você ainda pode cancelar durante a contagem.';
      pw.botoes.replaceChildren(pwBotao('cancelar', pwFechar), pwBotao('sim, desligar', async () => {
        const r = await window.widget.desligarEtapa(2);
        if (!r || !r.ok) { pw.erro.textContent = (r && r.erro) || 'não deu'; return; }
        const d = await window.widget.desligarExecutar();
        if (!d || !d.ok) { pw.erro.textContent = (d && d.erro) || 'não deu'; return; }
        pwContagem(d.segundos);
      }, true));
      pw.botoes.lastChild.focus();
    }
  }
  function pwContagem(segundos) {
    let resta = segundos;
    const desenhar = () => { pw.contagem.textContent = String(resta); };
    pw.titulo.textContent = 'Desligando...';
    pw.texto.textContent = 'O PC desliga quando a contagem chegar a zero.';
    pw.contagem.classList.remove('oculto');
    desenhar();
    pw.botoes.replaceChildren(pwBotao('cancelar o desligamento', async () => {
      await window.widget.desligarCancelar();
      pwFechar();
      dizer('Desligamento cancelado. Ufa!');
    }, true));
    pw.botoes.lastChild.focus();
    clearInterval(relogio);
    relogio = setInterval(() => { resta = Math.max(0, resta - 1); desenhar(); if (!resta) { clearInterval(relogio); relogio = null; } }, 1000);
  }
  document.getElementById('btn-power').addEventListener('click', () => pwEtapa(1));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pw.dlg.classList.contains('oculto') && !relogio) pwFechar(); });

  return {
    mostrar,
    iniciar(cfg) {
      fixado = cfg.fixado !== false;
      desenharPin();
    },
    bloquear() {
      bloqueado = true;
      botoes.forEach((b) => b.classList.add('bloqueada'));
      mostrar('bloqueio', { salvar: false });
    },
    desbloquear(abaInicial = 'sys') {
      bloqueado = false;
      botoes.forEach((b) => b.classList.remove('bloqueada'));
      mostrar(abaInicial, { salvar: false });
    },
    // o nome do Pokémon vira o "usuário" do prompt e do título
    dono(nome) {
      dono = nome;
      ps1.textContent = `C:\\${nome.toUpperCase()}>`;
      desenharTitulo();
    },
  };
})();

// ---------- Atualização (botão "update" do cabeçalho) ----------
// O main.js avisa quando a branch do widget ganhou commit novo. Aqui só: mostrar o botão, confirmar, mostrar o resultado e reiniciar.
// Quem baixa e troca os arquivos é o main.js (app/atualizador.js), que não mexe nos dados do usuário.
const atualizacao = (() => {
  const btn = document.getElementById('btn-update');
  const dlg = { raiz: document.getElementById('update-dialogo'), titulo: document.getElementById('update-titulo'), texto: document.getElementById('update-texto'),
    erro: document.getElementById('update-erro'), botoes: document.getElementById('update-botoes') };
  let estado = { disponivel: false, remoto: '' };
  let avisado = false;
  let ocupado = false;
  const botao = (rotulo, aoClicar, principal) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = rotulo;
    if (principal) b.className = 'principal';
    b.addEventListener('click', aoClicar);
    return b;
  };
  const fechar = () => { if (!ocupado) dlg.raiz.classList.add('oculto'); };

  function mostrar(novo) {
    estado = novo && typeof novo === 'object' ? novo : { disponivel: false, remoto: '' };
    btn.classList.toggle('oculto', !estado.disponivel);
    if (estado.disponivel && !avisado) {
      avisado = true;
      dizer('Saiu uma atualização nova! Clique no botão de download (update) no topo. Seus dados ficam como estão.');
    }
  }

  function perguntar() {
    dlg.erro.textContent = '';
    dlg.titulo.textContent = 'Atualizar o widget?';
    dlg.texto.textContent = `Versão nova no GitHub (${estado.remoto}). Troco só os arquivos do programa. Suas configurações, o Cérebro, os projetos e as skills que você importou NÃO são mexidos. O widget reinicia no final e as sessões de terminal abertas são fechadas.`;
    dlg.botoes.replaceChildren(botao('depois', fechar), botao('atualizar agora', instalar, true));
    dlg.raiz.classList.remove('oculto');
    dlg.botoes.lastChild.focus();
  }

  async function instalar() {
    ocupado = true;
    dlg.erro.textContent = '';
    dlg.titulo.textContent = 'Atualizando...';
    dlg.texto.textContent = 'Baixando a versão nova e trocando os arquivos. Pode levar alguns segundos; não feche o widget.';
    dlg.botoes.replaceChildren();
    let r;
    try { r = await window.widget.atualizacaoAplicar(); } catch (erro) { r = { ok: false, erro: erro.message }; }
    ocupado = false;
    if (!r || !r.ok) {
      dlg.titulo.textContent = 'Não consegui atualizar';
      dlg.texto.textContent = 'Nada foi mudado: se algo tinha sido trocado, já foi desfeito. Seus dados estão intactos.';
      dlg.erro.textContent = (r && r.erro) || 'erro desconhecido';
      dlg.botoes.replaceChildren(botao('fechar', fechar), botao('tentar de novo', instalar, true));
      return;
    }
    mostrar({ disponivel: false, remoto: '' });
    dlg.titulo.textContent = 'Atualizado!';
    const quantos = `${r.atualizados} arquivo(s) trocado(s) e ${r.novos} novo(s).`;
    if (r.depsMudaram) {
      dlg.texto.textContent = `${quantos} Esta versão mudou as dependências: feche o widget, rode "npm install" na pasta dele e abra de novo.`;
      dlg.botoes.replaceChildren(botao('fechar', fechar, true));
      return;
    }
    dlg.texto.textContent = `${quantos} Reiniciando o widget...`;
    dlg.botoes.replaceChildren();
    await esperar(1500);
    window.widget.atualizacaoReiniciar().catch((erro) => console.error('Erro ao reiniciar:', erro));
  }

  btn.addEventListener('click', perguntar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.raiz.classList.contains('oculto')) fechar(); });

  return {
    mostrar,
    // o aviso pode ter chegado antes de a tela estar pronta: pergunta o que o main já sabe, e escuta os próximos
    iniciar() {
      window.widget.onAtualizacao(mostrar);
      window.widget.atualizacaoEstado().then(mostrar).catch((erro) => console.error('Erro ao ler a atualização:', erro));
    },
  };
})();

// ---------- Ajustes (aba poke) ----------
// Cada caixa salva na config na hora; o Pokémon comenta.
const ajustes = (() => {
  const caixa = {
    autostart: document.getElementById('cfg-autostart'),
    economico: document.getElementById('cfg-economico'),
    visualizador: document.getElementById('cfg-visualizador'),
    animacoes: document.getElementById('cfg-animacoes'),
    atualizacao: document.getElementById('cfg-atualizacao'),
  };

  // avisar de atualizações: ligar confere já (é um clique seu); desligar esconde o botão
  caixa.atualizacao.addEventListener('change', () => {
    const ligar = caixa.atualizacao.checked;
    mudarConfig((cfg) => { cfg.avisarAtualizacao = ligar; })
      .then(() => {
        if (!ligar) { atualizacao.mostrar(null); dizer('Tudo bem, não vou mais avisar de atualização.'); return null; }
        dizer('Vou olhar se tem versão nova...');
        return window.widget.atualizacaoVerificar().then((est) => {
          atualizacao.mostrar(est);
          if (!est || !est.disponivel) dizer('Você já está na versão mais nova (ou não consegui consultar o GitHub agora).');
        });
      })
      .catch((erro) => console.error('Erro ao salvar:', erro));
  });

  caixa.autostart.addEventListener('change', async () => {
    const ligar = caixa.autostart.checked;
    try {
      const r = await window.widget.setAutostart(ligar);
      if (!r) throw new Error('recusado');
      dizer(ligar
        ? (r.aplicado ? 'Combinado: eu apareço sempre que o Windows ligar.' : 'Salvo! No modo "npm start", use o atalho do iniciar-widget.vbs (veja o README).')
        : 'Tudo bem, só apareço quando você me chamar.');
    } catch (erro) {
      caixa.autostart.checked = !ligar; // volta como estava
      console.error('Erro ao mudar o início com o Windows:', erro);
    }
  });

  caixa.economico.addEventListener('change', () => {
    const ligar = caixa.economico.checked;
    mudarConfig((cfg) => { cfg.desempenho = ligar ? 'economico' : 'normal'; })
      .then(() => dizer(ligar ? 'Modo econômico ligado. Vou me mexer menos.' : 'Modo normal! Energia total.'))
      .catch((erro) => console.error('Erro ao salvar:', erro));
  });

  caixa.visualizador.addEventListener('change', () => {
    preferencias.visualizador = caixa.visualizador.checked;
    visualizador.ligado(preferencias.visualizador);
    mudarConfig((cfg) => { cfg.visualizador = preferencias.visualizador; })
      .then(() => dizer(preferencias.visualizador ? 'Visualizador ligado. Bota um som!' : 'Visualizador desligado. Menos luzinhas.'))
      .catch((erro) => console.error('Erro ao salvar:', erro));
  });

  caixa.animacoes.addEventListener('change', () => {
    preferencias.animacoes = caixa.animacoes.checked;
    pokemon.redesenhar();
    mudarConfig((cfg) => { cfg.animacoes = preferencias.animacoes; })
      .then(() => dizer(preferencias.animacoes ? 'Posso me mexer de novo? Oba!' : 'Vou ficar paradinho, prometo.'))
      .catch((erro) => console.error('Erro ao salvar:', erro));
  });

  // Visual: CMD ou iOS. A janela é recriada (a transparência só vale ao nascer)
  const opcoesEstilo = [...document.querySelectorAll('.estilo-op')];
  const estiloAtual = document.documentElement.dataset.estilo;
  opcoesEstilo.forEach((b) => {
    const atual = b.dataset.estilo === estiloAtual;
    b.classList.toggle('ativo', atual);
    b.setAttribute('aria-checked', atual);
    b.addEventListener('click', async () => {
      if (atual) return;
      dizer(b.dataset.estilo === 'ios' ? 'Visual novo chegando... vidro e cantinhos redondos!' : 'De volta ao CMD raiz!');
      await esperar(500); // dá tempo de ler a fala
      window.widget.janelaEstilo(b.dataset.estilo).catch((erro) => console.error('Erro ao trocar o visual:', erro));
    });
  });

  return {
    iniciar(cfg) {
      caixa.autostart.checked = cfg.iniciarComWindows !== false;
      caixa.economico.checked = cfg.desempenho === 'economico';
      caixa.visualizador.checked = cfg.visualizador !== false;
      caixa.animacoes.checked = cfg.animacoes !== false;
      caixa.atualizacao.checked = cfg.avisarAtualizacao !== false;
    },
  };
})();

// ---------- Relógio da linha de status ----------
// Atualiza uma vez por minuto, alinhado à virada do minuto (não roda na janela destacada, onde a barra de status fica oculta).
if (document.documentElement.dataset.destacado !== '1') {
  (function relogio() {
    const hora = document.getElementById('st-hora');
    const agora = new Date();
    hora.textContent = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setTimeout(relogio, 60000 - (agora.getSeconds() * 1000 + agora.getMilliseconds()) + 50);
  })();
}

// ---------- Início ----------
if (document.documentElement.dataset.destacado === '1') {
  window.widget.loadConfig().then((cfg) => {
    if (cfg.corPokebola) {
      document.documentElement.style.setProperty('--accent', cfg.corPokebola);
      atualizarAccent();
    }
    abas.iniciar(cfg);
    document.querySelectorAll('.painel').forEach((p) => p.classList.remove('ativo'));
    const pProj = document.getElementById('aba-projetos');
    if (pProj) pProj.classList.add('ativo', 'terminal');
    terminalEmb.visivel(true);
  }).catch((erro) => console.error('Erro ao iniciar janela destacada:', erro));
} else {
  window.widget.loadConfig().then((cfg) => {
    // vermelha antes da primeira escolha; depois, a cor do Pokémon
    carregamento.cor(cfg.pokemonEscolhido && cfg.corPokebola ? cfg.corPokebola : VERMELHO_POKEBOLA);
    carregamento.etapa(30, 'C:\\> lendo a config...');
    preferencias.visualizador = cfg.visualizador !== false;
    preferencias.animacoes = cfg.animacoes !== false;
    visualizador.ligado(preferencias.visualizador);
    ajustes.iniciar(cfg);
    apps.iniciar(cfg);
    cerebro.iniciar(cfg);
    projetos.iniciar(cfg);
    skillsAba.iniciar(cfg);
    abas.iniciar(cfg);
    // volta na última aba
    if (cfg.pokemonEscolhido) abas.desbloquear(cfg.aba || 'sys');
    return pokemon.iniciar(cfg);
  }).catch((erro) => {
    console.error('Erro ao iniciar:', erro);
    carregamento.terminar(); // nunca deixa a tela de carregamento presa
  });

  sistema.iniciar();
  musica.iniciar();
  atualizacao.iniciar();

  // Ctrl+Alt+A (atalho global do main.js): aba Projetos + seletor rápido. Nada antes de escolher o Pokémon.
  window.widget.onAtalhoProjetos(() => {
    if (document.querySelector('.aba.bloqueada')) return;
    if (document.getElementById('cartao').classList.contains('mini')) document.getElementById('btn-mini').click();
    abas.mostrar('projetos');
    projetos.seletorRapido();
  });
}
