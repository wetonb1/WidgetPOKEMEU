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
    degradeReflexo.addColorStop(0, misturarCor(accent, '#0c0c0c', 0.55));
    degradeReflexo.addColorStop(1, '#0c0c0c');
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
    dizer(mudo ? 'Mudo! Agora é só a gente e o silêncio.' : 'Som de volta!');
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
          dizer(`♪ Agora toca "${info.title}"${info.artist ? ', de ' + info.artist : ''}. Gostei!`);
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
    dizer('Voltando uma faixa...');
    comando('prev');
  });
  document.getElementById('mus-next').addEventListener('click', () => {
    if (!atual) { dizer('Não tem nada tocando para pular.'); return; }
    dizer('Próxima!');
    comando('next');
  });
  document.getElementById('mus-play').addEventListener('click', () => {
    if (!atual) { dizer('Abre o Spotify (ou um vídeo) que eu controlo daqui.'); return; }
    const estavaPausado = !el.icoPlay.classList.contains('oculto');
    desenharPlayPause(estavaPausado);
    dizer(estavaPausado ? 'Solta o som!' : 'Pausei pra você.');
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
  const el = {
    cpuValor: document.getElementById('cpu-valor'),
    ramValor: document.getElementById('ram-valor'),
    cpuBarra: document.getElementById('cpu-barra'),
    ramBarra: document.getElementById('ram-barra'),
    ramTexto: document.getElementById('ram-texto'),
    procColunas: [...document.querySelectorAll('.proc-col')],
    procConta: document.getElementById('proc-conta'),
    procLista: document.getElementById('proc-lista'),
    stCpu: document.getElementById('st-cpu'),
    stRam: document.getElementById('st-ram'),
    stModo: document.getElementById('st-modo'),
  };
  let ordenarPor = 'cpu'; // 'cpu' ou 'ram'
  let visivel = false;
  let economicoAntes = false;

  // Barra sólida (0–100%); vermelha acima de 85%
  function desenharBarra(barra, valor, pct) {
    const p = Math.max(0, Math.min(100, pct));
    barra.style.width = p + '%';
    barra.classList.toggle('alta', p > 85);
    valor.textContent = Math.round(p) + '%';
  }

  // Uma linha da tabela: nome | CPU | memória (a coluna da ordenação fica em destaque)
  function linhaProcesso(p) {
    const li = document.createElement('li');
    const nome = document.createElement('span');
    nome.className = 'proc-nome';
    nome.textContent = p.nome;
    nome.title = p.nome;
    const cpu = document.createElement('span');
    cpu.className = 'proc-num' + (ordenarPor === 'cpu' ? ' forte' : '') + (p.cpu >= 10 ? ' alto' : '');
    cpu.textContent = p.cpu >= 0.1 ? um(p.cpu) + '%' : '-';
    const ram = document.createElement('span');
    ram.className = 'proc-num' + (ordenarPor === 'ram' ? ' forte' : '') + (p.ram >= 2048 ? ' alto' : '');
    ram.textContent = p.ram >= 1024 ? um(p.ram / 1024) + ' GB' : p.ram + ' MB';
    li.append(nome, cpu, ram);
    return li;
  }

  // Detalhes da aba sys (só quando ela está aberta)
  function desenharAba(s) {
    const pctRam = (s.ramUsada / s.ramTotal) * 100;
    desenharBarra(el.cpuBarra, el.cpuValor, s.cpu);
    desenharBarra(el.ramBarra, el.ramValor, pctRam);
    el.ramTexto.textContent = `${um(s.ramUsada / GB)} / ${um(s.ramTotal / GB)} GB em uso`;

    el.procColunas.forEach((b) => b.classList.toggle('ativa', b.dataset.ordem === ordenarPor));
    const lista = [...(s.processos || [])].sort((a, b) =>
      ordenarPor === 'cpu' ? b.cpu - a.cpu || b.ram - a.ram : b.ram - a.ram || b.cpu - a.cpu);
    el.procConta.textContent = lista.length ? `(${lista.length} usando o PC)` : '';
    if (lista.length === 0) {
      // primeira leitura ainda em andamento
      const li = document.createElement('li');
      li.textContent = 'coletando…';
      el.procLista.replaceChildren(li);
      return;
    }
    el.procLista.replaceChildren(...lista.map(linhaProcesso));
  }

  // Linha de status (sempre) + aba (se aberta) + reação do Pokémon
  function desenhar(s) {
    el.stCpu.textContent = `cpu ${Math.round(s.cpu)}%`;
    el.stCpu.classList.toggle('alta', s.cpu > 85);
    el.stRam.textContent = `ram ${um(s.ramUsada / GB)}G`;
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

  // Clicar numa coluna ordena por ela (usa o último dado, sem nova leitura)
  el.procColunas.forEach((b) => b.addEventListener('click', () => {
    if (ordenarPor === b.dataset.ordem) return;
    ordenarPor = b.dataset.ordem;
    dizer(ordenarPor === 'cpu' ? 'Ordenando por quem come mais CPU.' : 'Agora por quem come mais memória.');
    if (ultimoStats) desenharAba(ultimoStats);
  }));

  // setTimeout recursivo: nada se acumula se o PC estiver lento; erro não derruba o loop
  async function ciclo() {
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
      setTimeout(ciclo, INTERVALO_STATS * (economico ? 2 : 1));
    }
  }

  return {
    iniciar: ciclo,
    visivel(v) {
      visivel = v;
      if (v && ultimoStats) desenharAba(ultimoStats);
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
  };
  const API = 'https://pokeapi.co/api/v2/pokemon/';
  const CPU_ALTA = 85; // % a partir do qual o Pokémon "sua"

  let atual = null;      // { id, slug, nome, tipos, sprites, grito }
  let escolhido = false; // já escolheu um Pokémon alguma vez?
  let usarShiny = false;
  let gifSempre = false; // config.gifAnimado
  let favoritos = [];    // slugs (ex.: "pikachu")
  let cpuAlta = false;
  let pedido = 0;        // descarta respostas antigas se buscar de novo
  let ultimaCocega = 0;

  const capitalizar = (s) => s.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  const bordao = () => (atual ? (TYPE_THEME[atual.tipos[0]] || TYPE_THEME.normal).bordao : '');

  // "Mr. Mime" -> "mr-mime"; "Flabébé" -> "flabebe"; "25" -> "25". null se inválido.
  function normalizar(texto) {
    const s = String(texto || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['.’]/g, '')
      .replace(/\s+/g, '-');
    return /^[a-z0-9-]{1,30}$/.test(s) ? s : null;
  }

  // Grava só as chaves do Pokémon (relê a config para não pisar nas outras)
  function salvar() {
    mudarConfig((cfg) => {
      if (atual) cfg.pokemon = atual.slug;
      cfg.pokemonEscolhido = escolhido;
      cfg.shiny = usarShiny;
      cfg.favoritos = favoritos;
      if (atual) cfg.corPokebola = (TYPE_THEME[atual.tipos[0]] || TYPE_THEME.normal).accent; // a tela de carregamento abre nesta cor
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
    const escolha = atual && escolherImagem(atual.sprites, animando);
    el.vazio.classList.toggle('oculto', !!escolha);
    const meu = ++pedidoImagem;
    if (!escolha) {
      tamanhoSprite = null;
      el.img.classList.add('oculto');
      el.img.removeAttribute('src');
      if (atual && avisar) dizer(`Eita, não tenho foto${usarShiny ? ' brilhante' : ''}. Vou ficar invisível mesmo.`);
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
    const favorito = atual && favoritos.includes(atual.slug);
    el.fav.textContent = favorito ? '★' : '☆';
    el.fav.classList.toggle('ativo', !!favorito);
    el.fav.title = favorito ? 'Remover dos favoritos' : 'Favoritar';
    el.shiny.classList.toggle('ativo', usarShiny);
  }

  function desenharFavoritos() {
    if (favoritos.length === 0) {
      const vazio = document.createElement('span');
      vazio.className = 'sub';
      vazio.textContent = '(nenhum ainda: use a ☆)';
      el.favs.replaceChildren(vazio);
      return;
    }
    el.favs.replaceChildren(...favoritos.map((slug) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fav-btn' + (atual && atual.slug === slug ? ' atual' : '');
      b.textContent = slug;
      b.title = 'Clique para trocar • botão direito remove';
      b.addEventListener('click', () => loadPokemon(slug, { usuario: true }));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        favoritos = favoritos.filter((f) => f !== slug);
        dizer(`Tirei ${capitalizar(slug)} dos favoritos.`);
        desenharBotoes();
        desenharFavoritos();
        salvar();
      });
      return b;
    }));
  }

  function desenhar() {
    if (!atual) return;
    // o tipo PRINCIPAL (primeiro) vira o esquema de cores do terminal inteiro
    aplicarTema(atual.tipos[0]);
    atualizarAccent();
    el.nome.textContent = atual.nome;
    el.num.textContent = '#' + String(atual.id).padStart(3, '0');
    el.tipos.replaceChildren(...atual.tipos.map((t) => {
      const chip = document.createElement('span');
      chip.className = 'tipo-chip';
      chip.textContent = '[' + (TIPO_PT[t] || t).toUpperCase() + ']';
      chip.style.color = (TYPE_THEME[t] || TYPE_THEME.normal).accent;
      return chip;
    }));
    narrador.falante(atual.slug);
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
        id: d.id,
        slug: d.name,
        nome: capitalizar(d.name),
        tipos: d.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
        sprites: d.sprites,
        grito: d.cries?.latest || d.cries?.legacy || null,
      };
      desenhar();
      if (primeiraVez) {
        escolhido = true;
        dizer(`${bordao()} ${atual.nome} invadiu o terminal!`);
        dizer('A partir de agora quem manda aqui sou eu. Mas pode me pedir as coisas pelas abas.');
        tocarGrito(0.4);
        abas.desbloquear();
      } else if (usuario && anterior && anterior.slug !== atual.slug) {
        dizer(`${bordao()} ${anterior.nome} saiu de fininho. Agora o terminal é do ${atual.nome}!`);
        tocarGrito(0.35);
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

  function tocarGrito(vol) {
    if (!atual || !atual.grito) return;
    const audio = new Audio(atual.grito);
    audio.volume = vol;
    audio.play().catch((erro) => console.error('Grito não tocou:', erro));
  }

  // ----- eventos -----
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = el.busca.value;
    if (!texto.trim()) return;
    el.busca.value = '';
    loadPokemon(texto, { usuario: true });
  });

  // primeira vez: busca ou sugestões
  el.bloqForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = el.bloqBusca.value;
    if (!texto.trim()) return;
    el.bloqBusca.value = '';
    loadPokemon(texto, { usuario: true, primeiraVez: true });
  });
  el.sugestoes.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-poke]');
    if (b) loadPokemon(b.dataset.poke, { usuario: true, primeiraVez: true });
  });

  el.fav.addEventListener('click', () => {
    if (!atual) return;
    const ja = favoritos.includes(atual.slug);
    favoritos = ja ? favoritos.filter((f) => f !== atual.slug) : [...favoritos, atual.slug];
    dizer(ja ? 'Saí dos favoritos? Tudo bem... 😢' : 'Me favoritou? Que honra!');
    desenharBotoes();
    desenharFavoritos();
    salvar();
  });

  el.shiny.addEventListener('click', () => {
    if (!atual) return;
    usarShiny = !usarShiny;
    dizer(usarShiny ? 'Olha esse brilho! ✦' : 'Voltei às cores de sempre.');
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
      dizer(`${bordao()} Ei, isso faz cócegas!`);
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
    dizer(`${sauda}, ${chamar}! ${atual.nome} está pronto para ajudar.`);
    // Passo 2: grito a 50%
    if (bv.grito !== false) tocarGrito(0.5);
    // Passo 3: voz, 1,2 s depois
    if (bv.voz !== false && 'speechSynthesis' in window) {
      setTimeout(() => {
        try { falarEmVoz(`Olá, ${chamar}! ${sauda}.`); } catch (erro) { console.error('Voz falhou:', erro); }
      }, 1200);
    }
    // Passo 4: resumo do PC, 6,5 s depois
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
      else dizer(`${bordao()} De volta ao comando!`);
    },
    // chamado a cada leitura de CPU; só fala quando o estado muda
    cpu(pct) {
      const alta = pct > CPU_ALTA;
      if (alta === cpuAlta) return;
      cpuAlta = alta;
      if (!atual) return;
      dizer(alta ? `${bordao()} Tô suando! CPU em ${Math.round(pct)}%.` : 'Ufa, a CPU acalmou.');
    },
    escolhido: () => escolhido,
    nome: () => (atual ? atual.nome : null),
    redesenhar() { if (atual) desenharImagem(false); },
  };
})();

// ---------- Apps ----------
const apps = (() => {
  const grade = document.getElementById('apps-grade');
  const dialogo = document.getElementById('dialogo');
  const form = document.getElementById('dialogo-form');
  const confirma = document.getElementById('dialogo-confirma');
  const campo = {
    nome: document.getElementById('f-nome'),
    tipo: document.getElementById('f-tipo'),
    alvo: document.getElementById('f-alvo'),
    rotulo: document.getElementById('f-alvo-rotulo'),
    erro: document.getElementById('f-erro'),
  };
  let lista = [];
  let indiceParaRemover = -1;
  let desenhado = false; // a grade só é montada na primeira vez que a aba abre

  // Tira aspas ("Copiar como caminho") e espaços das pontas
  const limpar = (t) => String(t || '').trim().replace(/^["']+|["']+$/g, '').trim();

  // Garante http(s):// no começo; devolve null se não for um endereço válido
  function normalizarUrl(texto) {
    let u = limpar(texto);
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      const x = new URL(u);
      return (x.protocol === 'http:' || x.protocol === 'https:') && x.hostname ? u : null;
    } catch {
      return null;
    }
  }

  async function gravar(novaLista) {
    await mudarConfig((cfg) => { cfg.apps = novaLista; });
    lista = novaLista;
    desenhar();
  }

  // Ícone: favicon para sites, ícone do arquivo (via main) para programas.
  // Se não carregar, vira a inicial do nome.
  function criarIcone(a, i) {
    const img = document.createElement('img');
    img.className = 'app-icone';
    img.alt = '';
    img.draggable = false;
    const inicial = () => {
      const d = document.createElement('div');
      d.className = 'app-icone';
      d.textContent = (a.name || '?').charAt(0).toUpperCase();
      img.replaceWith(d);
    };
    img.addEventListener('error', inicial);
    if (a.type === 'url') {
      try {
        const dominio = new URL(a.target).hostname;
        img.src = 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(dominio);
      } catch { inicial(); }
    } else {
      window.widget.iconeApp(i).then((url) => (url ? (img.src = url) : inicial())).catch(inicial);
    }
    return img;
  }

  function desenhar() {
    desenhado = true;
    grade.replaceChildren(...lista.map((a, i) => {
      const b = document.createElement('button');
      b.className = 'app';
      b.type = 'button';
      b.title = a.name + ' — ' + a.target;
      const nome = document.createElement('span');
      nome.className = 'app-nome';
      nome.textContent = a.name;
      b.append(criarIcone(a, i), nome);
      b.addEventListener('click', () => {
        dizer(`Abrindo ${a.name}! Vai lá.`);
        window.widget.abrirApp(i)
          .then((erro) => { if (erro) { dizer(`Não consegui abrir ${a.name}: ${erro}`); console.error('Não abriu', a.name + ':', erro); } })
          .catch((erro) => console.error('Erro ao abrir', a.name + ':', erro));
      });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); pedirRemocao(i); });
      return b;
    }));
  }

  // ----- diálogo: novo atalho -----
  function atualizarRotulo() {
    campo.rotulo.textContent = campo.tipo.value === 'url' ? 'endereço' : 'caminho do programa';
    campo.alvo.placeholder = campo.tipo.value === 'url' ? 'youtube.com' : 'C:\\...\\programa.exe';
  }
  function abrirDialogo() {
    form.classList.remove('oculto');
    confirma.classList.add('oculto');
    dialogo.classList.remove('oculto');
  }
  function fecharDialogo() {
    dialogo.classList.add('oculto');
    indiceParaRemover = -1;
  }

  document.getElementById('apps-novo').addEventListener('click', () => {
    form.reset();
    campo.erro.textContent = '';
    atualizarRotulo();
    abrirDialogo();
    campo.nome.focus();
    dizer('Qual atalho eu guardo?');
  });
  campo.tipo.addEventListener('change', atualizarRotulo);
  document.getElementById('f-cancelar').addEventListener('click', fecharDialogo);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = campo.tipo.value;
    let alvo = limpar(campo.alvo.value);
    if (tipo === 'url') alvo = normalizarUrl(alvo);
    if (!alvo) {
      campo.erro.textContent = tipo === 'url' ? 'endereço inválido.' : 'informe o caminho.';
      return;
    }
    let nome = limpar(campo.nome.value);
    if (!nome) {
      // sem nome: usa o site (sem www.) ou o nome do arquivo
      nome = tipo === 'url'
        ? new URL(alvo).hostname.replace(/^www\./, '')
        : alvo.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    }
    try {
      await gravar([...lista, { name: nome, type: tipo, target: alvo }]);
      fecharDialogo();
      dizer(`Anotado: ${nome} agora está nos apps.`);
    } catch (erro) {
      campo.erro.textContent = 'não foi possível salvar.';
      console.error('Erro ao salvar atalho:', erro);
    }
  });

  // ----- diálogo: confirmar remoção (botão direito) -----
  function pedirRemocao(i) {
    indiceParaRemover = i;
    document.getElementById('c-texto').textContent = `$ apps rm "${lista[i].name}"?`;
    form.classList.add('oculto');
    confirma.classList.remove('oculto');
    dialogo.classList.remove('oculto');
  }
  document.getElementById('c-nao').addEventListener('click', fecharDialogo);
  document.getElementById('c-sim').addEventListener('click', async () => {
    const i = indiceParaRemover;
    fecharDialogo();
    if (i < 0) return;
    const nome = lista[i].name;
    try {
      await gravar(lista.filter((_, j) => j !== i));
      dizer(`${nome} saiu da lista.`);
    } catch (erro) {
      console.error('Erro ao remover atalho:', erro);
    }
  });
  // Esc fecha o diálogo
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialogo.classList.contains('oculto')) fecharDialogo();
  });

  return {
    iniciar(cfg) { lista = Array.isArray(cfg.apps) ? cfg.apps : []; },
    visivel(v) { if (v && !desenhado) desenhar(); }, // ícones só carregam quando você abre a aba
  };
})();

// ---------- Terminal embutido ----------
// xterm.js desenha; o PowerShell roda no main.js (node-pty). Trocar de aba NÃO
// encerra a sessão: o Claude pode continuar trabalhando escondido.
const terminal = (() => {
  const area = document.getElementById('term-area');
  let term = null, fit = null;
  let visivel = false, shellVivo = false, limparAoReiniciar = false, primeiraVez = true;
  let recebeuDados = false; // o shell já mandou alguma coisa?

  function ajustar() {
    try { fit.fit(); } catch { /* aba ainda sem tamanho */ } // o onResize avisa o main
  }

  function criar() {
    term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: false, // cursor piscando redesenha a janela transparente sem parar
      scrollback: 5000,
      theme: { background: '#0b0b0b', cursor: accent },
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(area);

    term.onData((d) => { if (shellVivo) window.widget.termInput(d); });
    term.onResize(({ cols, rows }) => { if (shellVivo) window.widget.termResize(cols, rows); });

    // Ctrl+V cola e Ctrl+C (com texto selecionado) copia, pelo próprio navegador;
    // sem seleção, Ctrl+C segue para o shell (interrompe o comando)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'v') return false;
      if (k === 'c' && term.hasSelection()) return false;
      return true;
    });

    window.widget.onTermData((d) => { recebeuDados = true; term.write(d); });
    window.widget.onTermExit((codigo) => {
      shellVivo = false;
      limparAoReiniciar = true;
      term.write(`\r\n\x1b[33m[O PowerShell terminou (código ${codigo}). Saia e volte para a aba term para reiniciar.]\x1b[0m\r\n`);
      dizer('O PowerShell fechou. Quando você voltar nessa aba, eu abro outro.');
    });

    // reajusta colunas/linhas sempre que a área muda de tamanho
    new ResizeObserver(() => { if (visivel) ajustar(); }).observe(area);
  }

  async function abrir() {
    if (!term) criar();
    term.options.theme = { background: '#0c0c0c', cursor: accent };
    ajustar();
    if (!shellVivo) {
      if (limparAoReiniciar) { term.reset(); limparAoReiniciar = false; }
      let r;
      try {
        r = await window.widget.termStart(term.cols, term.rows);
      } catch (erro) {
        r = 'erro: ' + erro.message.replace(/^Error invoking remote method '[^']+': /, '');
      }
      shellVivo = r === 'novo' || r === 'existente';
      if (!shellVivo) {
        // mostra o motivo na tela (antes ia só para o console, e parecia "não funciona")
        term.write(`\x1b[31m[Não foi possível abrir o PowerShell: ${r}]\x1b[0m\r\n`);
        dizer('Não consegui abrir o PowerShell. O motivo está escrito no terminal.');
      } else if (r === 'novo') {
        dizer(primeiraVez ? 'Abri o PowerShell. Cuidado com o que digita, hein!' : 'PowerShell novinho, pronto!');
        primeiraVez = false;
        // se o shell abriu mas não mandou nada em 8 s, avisa (em vez de uma tela vazia)
        recebeuDados = false;
        setTimeout(() => {
          if (shellVivo && !recebeuDados) {
            term.write('\x1b[33m[O PowerShell abriu, mas não respondeu. Tente Enter, ou saia e volte nesta aba.]\x1b[0m\r\n');
            dizer('O PowerShell está mudo... Aperta Enter ali pra mim?');
          }
        }, 8000);
      }
    }
    term.focus();
  }

  // "Iniciar Claude": digita claude + Enter no shell
  document.getElementById('term-claude').addEventListener('click', () => {
    if (!shellVivo) return;
    window.widget.termInput('claude\r');
    dizer('Chamei o Claude. Ele é esperto, mas quem manda aqui sou eu.');
    term.focus();
  });

  return {
    visivel(v) {
      visivel = v;
      if (v) abrir().catch((erro) => console.error('Erro ao abrir o terminal:', erro));
    },
  };
})();

// ---------- Abas e janela ----------
// Uma aba por vez (nada de tudo na tela). O Pokémon "digita" o comando de cada
// aba no prompt. A aba term estica a janela para baixo; mini encolhe tudo.
const abas = (() => {
  const cartao = document.getElementById('cartao');
  const botoes = [...document.querySelectorAll('.aba')];
  const paineis = [...document.querySelectorAll('.painel')];
  const ps1 = document.getElementById('ps1');
  const comando = document.getElementById('comando');
  const titulo = document.getElementById('titulo');
  const btnPin = document.getElementById('btn-pin');
  const btnMini = document.getElementById('btn-mini');

  // o "comando" que o Pokémon digita ao abrir cada aba
  const COMANDOS = {
    bloqueio: 'whoami', sys: 'tasklist /relevantes', music: 'now-playing', apps: 'dir apps', term: 'powershell', poke: 'pokedex /config',
  };
  const MODULOS = {
    sys: sistema, music: musica, apps, term: terminal,
  };

  let atual = null;
  let bloqueado = true;
  let mini = false;
  let fixado = true;
  let dono = '';
  let digitacao = 0;
  let salvarTimer = null;

  // título da janela, como o de um console: "C:\WINDOWS\system32\cmd.exe - gengar"
  function desenharTitulo() {
    titulo.textContent = 'C:\\WINDOWS\\system32\\cmd.exe' + (dono ? ' - ' + dono : '');
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
    atual = aba;
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

    // a aba term pede uma janela mais alta; as outras voltam ao normal
    if (!mini && (aba === 'term' || anterior === 'term')) {
      window.widget.janelaModo(aba === 'term' ? 'terminal' : 'normal')
        .catch((erro) => console.error('Erro ao mudar a janela:', erro));
    }

    if (salvar && aba !== 'bloqueio') {
      clearTimeout(salvarTimer); // grava a aba só depois de você parar de trocar
      salvarTimer = setTimeout(() => {
        mudarConfig((cfg) => { cfg.aba = aba; }).catch((erro) => console.error('Erro ao salvar a aba:', erro));
      }, 1500);
    }
  }

  botoes.forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.aba)));
  // Alt+1..5 troca de aba
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey) return;
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
      await window.widget.janelaModo(mini ? 'mini' : (atual === 'term' ? 'terminal' : 'normal'));
    } catch (erro) {
      console.error('Erro ao mudar a janela:', erro);
    }
    if (!mini) dizer('Voltei! Sentiu minha falta?');
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

// ---------- Ajustes (aba poke) ----------
// Cada caixa salva na config na hora; o Pokémon comenta.
const ajustes = (() => {
  const caixa = {
    autostart: document.getElementById('cfg-autostart'),
    economico: document.getElementById('cfg-economico'),
    visualizador: document.getElementById('cfg-visualizador'),
    animacoes: document.getElementById('cfg-animacoes'),
  };

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

  return {
    iniciar(cfg) {
      caixa.autostart.checked = cfg.iniciarComWindows !== false;
      caixa.economico.checked = cfg.desempenho === 'economico';
      caixa.visualizador.checked = cfg.visualizador !== false;
      caixa.animacoes.checked = cfg.animacoes !== false;
    },
  };
})();

// ---------- Relógio da linha de status ----------
// Atualiza uma vez por minuto, alinhado à virada do minuto.
(function relogio() {
  const hora = document.getElementById('st-hora');
  const agora = new Date();
  hora.textContent = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  setTimeout(relogio, 60000 - (agora.getSeconds() * 1000 + agora.getMilliseconds()) + 50);
})();

// ---------- Início ----------
window.widget.loadConfig().then((cfg) => {
  // vermelha antes da primeira escolha; depois, a cor do Pokémon
  carregamento.cor(cfg.pokemonEscolhido && cfg.corPokebola ? cfg.corPokebola : VERMELHO_POKEBOLA);
  carregamento.etapa(30, 'C:\\> lendo a config...');
  preferencias.visualizador = cfg.visualizador !== false;
  preferencias.animacoes = cfg.animacoes !== false;
  visualizador.ligado(preferencias.visualizador);
  ajustes.iniciar(cfg);
  apps.iniciar(cfg);
  abas.iniciar(cfg);
  // volta na última aba (menos a term: não vale abrir um PowerShell no boot)
  if (cfg.pokemonEscolhido) abas.desbloquear(cfg.aba && cfg.aba !== 'term' ? cfg.aba : 'sys');
  return pokemon.iniciar(cfg);
}).catch((erro) => {
  console.error('Erro ao iniciar:', erro);
  carregamento.terminar(); // nunca deixa a tela de carregamento presa
});

sistema.iniciar();
musica.iniciar();
