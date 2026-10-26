// franquias.js — fontes de personagens de anime (o Pokémon continua no renderer.js,
// com a PokéAPI). Cada fonte devolve o MESMO formato, para a tela não precisar
// saber de onde veio o dado:
//   { nome, imagem, fonte, tema, id }
//   nome: texto (vai sempre por textContent) · imagem: URL https direta (nada é
//   baixado para o projeto) · fonte: 'jikan' | 'anilist' · tema: 'fonte:<fonte>'
//   (paleta fixa em temas.js) · id: número da API (para favoritos e reabrir).
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

  // ----- Jikan (MyAnimeList, não oficial): sem chave, 60/min e 3/s -----
  // Busca: GET /v4/characters?q=TERMO&limit=5  ->  data[].mal_id, data[].name,
  //        data[].images.jpg.image_url (também há .webp)
  const jikanFila = limitador(1000, 60000); // 1 por segundo; 429 -> 60 s
  const JIKAN = {
    rotulo: 'Jikan',
    async buscar(termo, avisar) {
      const url = 'https://api.jikan.moe/v4/characters?limit=' + MAX_RESULTADOS +
        '&order_by=favorites&sort=desc&q=' + encodeURIComponent(termo);
      const r = await jikanFila(() => pedir(url), avisar);
      return (Array.isArray(r && r.data) ? r.data : [])
        .filter((c) => Number.isInteger(c.mal_id) && typeof c.name === 'string')
        .map((c) => montar('jikan', c.mal_id, c.name, c.images && c.images.jpg && c.images.jpg.image_url));
    },
  };

  // ----- AniList (GraphQL): sem chave para leitura pública -----
  // POST https://graphql.anilist.co  { query, variables }
  //   -> data.Page.characters[].id, .name.full, .image.large
  const anilistFila = limitador(700, 60000);
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

  const FONTES = { jikan: JIKAN, anilist: ANILIST };

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
    rotulo: (fonte) => (FONTES[fonte] ? FONTES[fonte].rotulo : 'Pokémon'),
    existe: (fonte) => fonte === 'pokemon' || !!FONTES[fonte],
  };
})();
