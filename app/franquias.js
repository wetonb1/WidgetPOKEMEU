// franquias.js — personagens de anime pelo AniList (o Pokémon continua no
// renderer.js, com a PokéAPI). A fonte devolve o mesmo formato que a tela usa
// para qualquer franquia:
//   { nome, imagem, fonte, tema, id }
//   nome: texto (vai sempre por textContent) · imagem: URL https direta (nada é
//   baixado para o projeto) · fonte: 'anilist' · tema: 'fonte:anilist' (paleta
//   reserva em temas.js) · id: número da API (para favoritos e reabrir).
// A cor do tema vem da própria imagem do personagem (corDaImagem); a paleta
// fixa da fonte só vale se a leitura falhar.
// Nada de requisição a cada tecla: quem chama é o Enter ou o clique numa sugestão.
// Para adicionar uma fonte nova, veja o docs/FRANQUIAS.md.

const franquias = (() => {
  const TEMPO_LIMITE = 10000;        // ms por requisição
  const VALIDADE = 24 * 3600 * 1000; // cache por termo: 24 h
  const MAX_RESULTADOS = 5;
  const cache = new Map();           // 'fonte|termo' -> { hora, lista }

  // Erro com um "tipo" que a tela transforma em fala
  function erro(tipo, msg) {
    const e = new Error(msg || tipo);
    e.tipo = tipo; // 'offline' | 'tempo' | 'limite' | 'http'
    return e;
  }

  async function pedir(url, opcoes = {}) {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), TEMPO_LIMITE);
    try {
      const resp = await fetch(url, { ...opcoes, signal: controle.signal });
      if (resp.status === 429) throw erro('limite', 'HTTP 429');
      if (!resp.ok) throw erro('http', 'HTTP ' + resp.status);
      return await resp.json();
    } catch (e) {
      if (e.tipo) throw e;
      throw erro(e.name === 'AbortError' ? 'tempo' : 'offline', e.message);
    } finally {
      clearTimeout(t);
    }
  }

  // Limite de uma fonte: no máximo 1 requisição por intervalo (fila) e, depois de
  // um 429, uma pausa; o aviso vira fala na tela e a requisição é tentada de novo.
  function limitador(intervalo, pausa) {
    let fila = Promise.resolve();
    let ultima = 0;
    return (tarefa, avisar) => {
      const vez = fila.then(async () => {
        const falta = ultima + intervalo - Date.now();
        if (falta > 0) await esperar(falta);
        ultima = Date.now();
        try {
          return await tarefa();
        } catch (e) {
          if (e.tipo !== 'limite') throw e;
          if (avisar) avisar(Math.round(pausa / 1000));
          await esperar(pausa);
          ultima = Date.now();
          return tarefa(); // uma nova tentativa; se falhar de novo, o erro sobe
        }
      });
      fila = vez.catch(() => {}); // um erro não trava a fila
      return vez;
    };
  }

  const montar = (fonte, id, nome, imagem) => ({ nome, imagem: imagem || '', fonte, tema: 'fonte:' + fonte, id });

  // ----- AniList (GraphQL): sem chave para leitura pública -----
  // POST https://graphql.anilist.co  { query, variables }
  //   -> data.Page.characters[].id, .name.full, .image.large
  const anilistFila = limitador(700, 60000); // ~1,4/s; 429 -> 60 s
  const CONSULTA_ANILIST = `query ($busca: String, $qtd: Int) {
    Page(perPage: $qtd) { characters(search: $busca) { id name { full } image { large } } }
  }`;
  const ANILIST = {
    rotulo: 'AniList',
    async buscar(termo, avisar) {
      const r = await anilistFila(() => pedir('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: CONSULTA_ANILIST, variables: { busca: termo, qtd: MAX_RESULTADOS } }),
      }), avisar);
      const lista = r && r.data && r.data.Page && r.data.Page.characters;
      return (Array.isArray(lista) ? lista : [])
        .filter((c) => Number.isInteger(c.id) && c.name && typeof c.name.full === 'string')
        .map((c) => montar('anilist', c.id, c.name.full, c.image && c.image.large));
    },
  };

  const FONTES = { anilist: ANILIST };

  // ----- Cor do personagem -----
  // A CDN do AniList libera a leitura dos pixels (CORS), então a imagem vai para
  // um canvas pequeno (48 px) e a cor mais marcante vira o destaque do widget:
  // os pixels coloridos (saturados, nem muito escuros nem estourados) são
  // agrupados por matiz; ganha o grupo com mais "peso" (quantidade x saturação).
  // Depois a cor é clareada até ficar legível no fundo escuro. Roda uma vez por
  // personagem (o resultado vai para a config junto com ele).
  const LADO = 48;
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  function corDaImagem(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const desistir = setTimeout(() => resolve(null), TEMPO_LIMITE);
      img.onerror = () => { clearTimeout(desistir); resolve(null); };
      img.onload = () => {
        clearTimeout(desistir);
        try {
          const c = document.createElement('canvas');
          c.width = LADO;
          c.height = LADO;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, LADO, LADO);
          const d = ctx.getImageData(0, 0, LADO, LADO).data;
          const grupos = Array.from({ length: 24 }, () => ({ peso: 0, r: 0, g: 0, b: 0 })); // 24 faixas de 15°
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            if (d[i + 3] < 128) continue;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const s = max === 0 ? 0 : (max - min) / max;
            const v = max / 255;
            if (s < 0.3 || v < 0.25 || v > 0.98) continue; // cinza, preto, branco: não contam
            let h;
            if (max === r) h = ((g - b) / (max - min) + 6) % 6;
            else if (max === g) h = (b - r) / (max - min) + 2;
            else h = (r - g) / (max - min) + 4;
            const gr = grupos[Math.floor(h * 4) % 24];
            // tom de pele (laranja pouco saturado) quase não conta: senão o rosto
            // ganharia da roupa/cabelo, que é o que identifica o personagem
            const pele = h >= 0.1 && h <= 0.75 && s < 0.62 && v > 0.45; // matiz 6°–45°
            const peso = s * s * v * (pele ? 0.15 : 1);
            gr.peso += peso;
            gr.r += r * peso; gr.g += g * peso; gr.b += b * peso;
          }
          const melhor = grupos.reduce((a, b) => (b.peso > a.peso ? b : a));
          if (melhor.peso < 1) { resolve(null); return; } // imagem quase sem cor
          let [r, g, b] = [melhor.r / melhor.peso, melhor.g / melhor.peso, melhor.b / melhor.peso];
          // legível no fundo escuro: clareia até uma luminância mínima
          for (let k = 0; k < 10 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 140; k++) {
            r += (255 - r) * 0.15; g += (255 - g) * 0.15; b += (255 - b) * 0.15;
          }
          resolve(hex(r, g, b));
        } catch (e) {
          console.error('Não deu para ler a cor da imagem:', e);
          resolve(null);
        }
      };
      img.src = url;
    });
  }

  return {
    // devolve até 5 personagens (vazio = nada encontrado); erros têm .tipo
    async buscar(fonte, termo, avisar) {
      const f = FONTES[fonte];
      const t = String(termo || '').trim().slice(0, 60);
      if (!f || !t) return [];
      const chave = fonte + '|' + t.toLowerCase();
      const guardado = cache.get(chave);
      if (guardado && Date.now() - guardado.hora < VALIDADE) return guardado.lista;
      const lista = await f.buscar(t, avisar);
      cache.set(chave, { hora: Date.now(), lista });
      return lista;
    },
    corDaImagem,
    rotulo: (fonte) => (FONTES[fonte] ? FONTES[fonte].rotulo : 'Pokémon'),
    existe: (fonte) => fonte === 'pokemon' || !!FONTES[fonte],
  };
})();
