// app/mente.js — a inteligência do grafo do cérebro: tudo calculado aqui, só com os nós e as ligações (sem IA, sem rede, só ao abrir a aba).
// Temas (comunidades), relevância (PageRank), pontes entre projetos, ideias parecidas, caminho entre duas ideias e conexões a explorar.
// Nós: {t: 'p' projeto | 'e' estado | 'c' conversa | 'k' conceito, n, p, d, k}. Ligações: [a, b, peso, tipo].
(function (raiz) {
  const PALAVRAS_VAZIAS = new Set(['app', 'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'os', 'as', 'em', 'no', 'na', 'para', 'por', 'com', 'um', 'uma', 'the', 'and', 'of', 'to']);

  function vizinhos(n, ligs) {
    const viz = Array.from({ length: n }, () => []);
    for (const [a, b] of ligs) { viz[a].push(b); viz[b].push(a); }
    return viz;
  }

  // PageRank curto: quem é citado por quem também é citado sobe. Devolve 0..1 (1 = o arquivo mais central; projetos ficam com 1).
  function relevancia(nos, viz) {
    const n = nos.length;
    if (!n) return [];
    let r = new Array(n).fill(1 / n);
    for (let volta = 0; volta < 24; volta++) {
      const novo = new Array(n).fill(0.15 / n);
      for (let i = 0; i < n; i++) {
        if (!viz[i].length) { novo[i] += 0.85 * r[i]; continue; }
        const parte = 0.85 * r[i] / viz[i].length;
        for (const j of viz[i]) novo[j] += parte;
      }
      r = novo;
    }
    const arquivos = r.filter((_, i) => nos[i].t !== 'p');
    const max = Math.max(...arquivos, 1e-9);
    return r.map((v, i) => (nos[i].t === 'p' ? 1 : Math.min(1, v / max)));
  }

  // Propagação de rótulos: cada nó adota o tema mais forte em volta. Determinístico (mesma entrada, mesmos temas).
  function comunidades(nos, ligs) {
    const n = nos.length;
    const pesos = Array.from({ length: n }, () => []);
    for (const [a, b, peso, tipo] of ligs) {
      const p = tipo === 'p' ? 1.5 : Math.min(peso || 1, 4);
      pesos[a].push([b, p]);
      pesos[b].push([a, p]);
    }
    const rotulo = nos.map((_, i) => i);
    for (let volta = 0; volta < 14; volta++) {
      let mudou = false;
      for (let i = 0; i < n; i++) {
        if (!pesos[i].length) continue;
        const soma = new Map();
        for (const [j, p] of pesos[i]) soma.set(rotulo[j], (soma.get(rotulo[j]) || 0) + p);
        let melhor = rotulo[i];
        let nota = -1;
        for (const [r, p] of soma) if (p > nota || (p === nota && r < melhor)) { melhor = r; nota = p; }
        if (melhor !== rotulo[i]) { rotulo[i] = melhor; mudou = true; }
      }
      if (!mudou) break;
    }
    const ordem = [...new Set(rotulo)];
    return rotulo.map((r) => ordem.indexOf(r));
  }

  const ehArquivo = (N) => N.t === 'c' || N.t === 'e';
  const palavrasDe = (N) => (Array.isArray(N.k) ? N.k : []).filter((k) => k && k !== N.p);

  // Conceitos: palavras-chave com o arquivo onde aparecem. Quanto mais rara, mais a coincidência diz (idf).
  function conceitos(nos) {
    const mapa = new Map();
    nos.forEach((N, i) => {
      if (!ehArquivo(N)) return;
      for (const k of new Set(palavrasDe(N))) {
        if (!mapa.has(k)) mapa.set(k, { termo: k, arquivos: [], projetos: new Set() });
        const c = mapa.get(k);
        c.arquivos.push(i);
        c.projetos.add(N.p);
      }
    });
    return mapa;
  }

  function parecidas(nos, mapa, i, quantas = 4) {
    const total = Math.max(2, nos.filter(ehArquivo).length);
    const notas = new Map();
    for (const k of new Set(palavrasDe(nos[i]))) {
      const c = mapa.get(k);
      if (!c) continue;
      const idf = Math.log(1 + total / c.arquivos.length);
      for (const j of c.arquivos) {
        if (j === i) continue;
        const atual = notas.get(j) || { j, nota: 0, comum: [] };
        atual.nota += idf;
        atual.comum.push(k);
        notas.set(j, atual);
      }
    }
    return [...notas.values()].sort((a, b) => b.nota - a.nota || a.j - b.j).slice(0, quantas);
  }

  // Dijkstra: o caminho de ideias mais curto, preferindo palavras em comum a passar pelo projeto.
  function caminho(n, ligs, de, para) {
    if (de === para) return [de];
    const arestas = Array.from({ length: n }, () => []);
    for (const [a, b, peso, tipo] of ligs) {
      const custo = tipo === 'p' ? 1.6 : 1 / Math.min(peso || 1, 3);
      arestas[a].push([b, custo]);
      arestas[b].push([a, custo]);
    }
    const dist = new Array(n).fill(Infinity);
    const veio = new Array(n).fill(-1);
    const fila = [[0, de]];
    dist[de] = 0;
    while (fila.length) {
      let menor = 0;
      for (let k = 1; k < fila.length; k++) if (fila[k][0] < fila[menor][0]) menor = k;
      const [d, i] = fila.splice(menor, 1)[0];
      if (d > dist[i]) continue;
      if (i === para) break;
      for (const [j, custo] of arestas[i]) {
        if (d + custo < dist[j]) { dist[j] = d + custo; veio[j] = i; fila.push([dist[j], j]); }
      }
    }
    if (dist[para] === Infinity) return [];
    const rota = [para];
    while (rota[0] !== de) rota.unshift(veio[rota[0]]);
    return rota;
  }

  // A onda que corre pelas ligações ao clicar: em quantos saltos cada nó é alcançado e por qual ligação.
  function onda(n, viz, origem, maxSaltos = 3, maxArestas = 160) {
    const saltos = new Array(n).fill(-1);
    const arestas = [];
    saltos[origem] = 0;
    let camada = [origem];
    for (let s = 0; s < maxSaltos && camada.length && arestas.length < maxArestas; s++) {
      const proxima = [];
      for (const i of camada) for (const j of viz[i]) {
        if (saltos[j] >= 0) continue;
        saltos[j] = s + 1;
        proxima.push(j);
        if (arestas.length < maxArestas) arestas.push([i, j, s]);
      }
      camada = proxima;
    }
    return { saltos, arestas, maxSalto: arestas.reduce((m, a) => Math.max(m, a[2]), 0) };
  }

  function tokens(N) {
    const fonte = [...palavrasDe(N), ...String(N.n || '').split(/\s+/)];
    const saida = new Set();
    for (const f of fonte) for (const t of String(f).toLowerCase().split(/[^a-z0-9à-ÿ]+/)) if (t.length > 2 && !PALAVRAS_VAZIAS.has(t)) saida.add(t);
    return saida;
  }

  // Conexões a explorar: arquivos de projetos diferentes, ainda sem ligação, que falam de algo parecido.
  function aExplorar(nos, ligs, rel, quantas = 5) {
    const ligados = new Set();
    for (const [a, b] of ligs) { ligados.add(a + '_' + b); ligados.add(b + '_' + a); }
    const candidatos = nos.map((_, i) => i).filter((i) => ehArquivo(nos[i])).sort((a, b) => rel[b] - rel[a]).slice(0, 300);
    const toks = new Map(candidatos.map((i) => [i, tokens(nos[i])]));
    const pares = [];
    for (let x = 0; x < candidatos.length; x++) for (let y = x + 1; y < candidatos.length; y++) {
      const a = candidatos[x];
      const b = candidatos[y];
      if (nos[a].p === nos[b].p || ligados.has(a + '_' + b)) continue;
      const comum = [...toks.get(a)].filter((t) => toks.get(b).has(t));
      if (comum.length) pares.push({ a, b, comum, nota: comum.length + rel[a] + rel[b] });
    }
    const usados = new Set();
    return pares.sort((p, q) => q.nota - p.nota).filter((p) => {
      if (usados.has(p.a) || usados.has(p.b)) return false;
      usados.add(p.a);
      usados.add(p.b);
      return true;
    }).slice(0, quantas);
  }

  function nomeDoTema(membros, nos) {
    const conta = new Map();
    for (const i of membros) for (const k of new Set(palavrasDe(nos[i]))) conta.set(k, (conta.get(k) || 0) + 1);
    const ordem = [...conta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ordem.length) return ordem.slice(0, 2).map(([k]) => k).join(' · ');
    const hub = membros.find((i) => nos[i].t === 'p');
    return nos[hub === undefined ? membros[0] : hub].n;
  }

  // Tudo o que a tela precisa, de uma vez (~1 ms com 60 nós; só roda ao montar o grafo).
  function analisar(nos, ligs) {
    const viz = vizinhos(nos.length, ligs);
    const rel = relevancia(nos, viz);
    const com = comunidades(nos, ligs);
    const mapa = conceitos(nos);

    const porTema = new Map();
    com.forEach((c, i) => { if (!porTema.has(c)) porTema.set(c, []); porTema.get(c).push(i); });
    const temas = [...porTema.entries()].map(([id, membros]) => ({ id, membros, arquivos: membros.filter((i) => ehArquivo(nos[i])).length, nome: nomeDoTema(membros, nos) }))
      .filter((t) => t.arquivos).sort((a, b) => b.arquivos - a.arquivos);

    const conceitosLista = [...mapa.values()].filter((c) => c.arquivos.length > 1)
      .sort((a, b) => b.projetos.size - a.projetos.size || b.arquivos.length - a.arquivos.length || a.termo.localeCompare(b.termo));

    // pontes: pares de projetos unidos por palavras em comum, e os arquivos que mais cruzam fronteiras
    const pares = new Map();
    const cruzamentos = new Map();
    for (const [a, b, , tipo] of ligs) {
      if (tipo === 'p' || !nos[a].p || !nos[b].p || nos[a].p === nos[b].p) continue;
      const chave = [nos[a].p, nos[b].p].sort().join('|');
      if (!pares.has(chave)) pares.set(chave, { projetos: chave.split('|'), a, b, peso: 0, via: new Set() });
      const par = pares.get(chave);
      par.peso++;
      const kb = new Set(palavrasDe(nos[b]));
      for (const k of palavrasDe(nos[a])) if (kb.has(k)) par.via.add(k);
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!cruzamentos.has(x)) cruzamentos.set(x, new Set());
        cruzamentos.get(x).add(nos[y].p);
      }
    }
    const pontes = [...pares.values()].sort((a, b) => b.peso - a.peso).slice(0, 6).map((p) => ({ ...p, via: [...p.via].slice(0, 4) }));
    const conectores = [...cruzamentos.entries()].map(([i, ps]) => ({ i, projetos: ps.size })).sort((a, b) => b.projetos - a.projetos || rel[b.i] - rel[a.i]).slice(0, 5);

    const arquivos = nos.map((_, i) => i).filter((i) => ehArquivo(nos[i]));
    const centrais = [...arquivos].sort((a, b) => rel[b] - rel[a]).slice(0, 5);

    // adormecidas: entre o terço mais antigo, as mais ligadas (vale a pena revisitar)
    const datadas = arquivos.filter((i) => nos[i].d).sort((a, b) => String(nos[a].d).localeCompare(String(nos[b].d)));
    const adormecidas = datadas.slice(0, Math.ceil(datadas.length / 3)).sort((a, b) => rel[b] - rel[a]).slice(0, 4);

    // solitárias: só ligadas ao próprio projeto. Ilhas: projetos sem nenhuma ponte com os outros.
    const comLigacao = new Set();
    for (const [a, b, , tipo] of ligs) if (tipo !== 'p') { comLigacao.add(a); comLigacao.add(b); }
    const solitarias = arquivos.filter((i) => !comLigacao.has(i));
    const comPonte = new Set(pontes.flatMap((p) => p.projetos));
    for (const par of pares.values()) par.projetos.forEach((p) => comPonte.add(p));
    const comArquivos = new Set(arquivos.map((i) => nos[i].p));
    const ilhas = nos.map((_, i) => i).filter((i) => nos[i].t === 'p' && comArquivos.has(nos[i].p) && !comPonte.has(nos[i].p));

    const explorar = aExplorar(nos, ligs, rel);

    const datas = datadas.map((i) => nos[i].d);
    const dias = [...new Set(datas)];
    const sintese = [];
    const projetos = nos.filter((N) => N.t === 'p').length;
    sintese.push(`${arquivos.length} ${arquivos.length === 1 ? 'memória' : 'memórias'} em ${projetos} ${projetos === 1 ? 'projeto' : 'projetos'}, organizadas sozinhas em ${temas.length} ${temas.length === 1 ? 'tema' : 'temas'}.`);
    if (temas[0]) sintese.push(`O maior tema é “${temas[0].nome}”, com ${temas[0].arquivos} ${temas[0].arquivos === 1 ? 'memória' : 'memórias'}.`);
    if (centrais[0] !== undefined) sintese.push(`A ideia mais central é “${nos[centrais[0]].n}”: é por onde mais caminhos passam.`);
    if (pontes[0]) {
      const nome = (p) => (nos.find((N) => N.t === 'p' && N.p === p) || {}).n || p;
      sintese.push(`A ponte mais forte liga ${nome(pontes[0].projetos[0])} e ${nome(pontes[0].projetos[1])}${pontes[0].via.length ? ` (via ${pontes[0].via.slice(0, 2).join(', ')})` : ''}.`);
    } else if (arquivos.length) sintese.push('Nenhum projeto se conecta a outro ainda: cada um é uma ilha.');
    if (solitarias.length) sintese.push(`${solitarias.length} ${solitarias.length === 1 ? 'memória ainda não conversa' : 'memórias ainda não conversam'} com as outras.`);

    return { viz, rel, com, temas, conceitos: conceitosLista, pontes, conectores, centrais, adormecidas, solitarias, ilhas, explorar, sintese, dias, mapa };
  }

  // Modo "conceitos": as palavras-chave viram nós próprios, ligados aos arquivos onde aparecem (só as que se repetem).
  function comConceitos(dados) {
    const nos = [...dados.nos];
    const ligacoes = [...dados.ligacoes];
    const mapa = conceitos(nos);
    for (const c of mapa.values()) {
      if (c.arquivos.length < 2) continue;
      const i = nos.length;
      nos.push({ id: 'k:' + c.termo, t: 'k', n: c.termo, p: '', k: [] });
      for (const j of c.arquivos) ligacoes.push([j, i, 1, 'k']);
    }
    return { ...dados, nos, ligacoes };
  }

  const api = { analisar, comConceitos, parecidas, caminho, onda, relevancia, comunidades, vizinhos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.mente = api;
})(typeof window !== 'undefined' ? window : globalThis);
