# Franquias (Pokémon e anime)

O "dono" do widget pode vir de três fontes, escolhidas na aba `poke` (ou na tela da primeira escolha):

| Fonte | Onde está o código | Chave |
|---|---|---|
| Pokémon (PokéAPI) | `app/renderer.js`, função `loadPokemon` (não mudou) | não |
| Anime, Jikan (MyAnimeList, não oficial) | `app/franquias.js`, bloco `JIKAN` | não |
| Anime, AniList (GraphQL) | `app/franquias.js`, bloco `ANILIST` | não |

## Contrato comum

Toda fonte de anime devolve uma lista (até 5) no mesmo formato:

```js
{ nome, imagem, fonte, tema, id }
// nome:   texto do personagem (a tela usa sempre textContent)
// imagem: URL https direta da imagem (nada é baixado para o projeto)
// fonte:  'jikan' | 'anilist'
// tema:   'fonte:jikan' | 'fonte:anilist' (paleta fixa em app/temas.js, FONTE_TEMA)
// id:     número do personagem na API (favoritos e reabrir o widget)
```

O Pokémon segue o fluxo dele (tipo → tema em `TYPE_THEME`, sprite recortado, grito, brilho).
Na tela, os dois usam o mesmo rosto, o mesmo nome, a mesma ☆ e as mesmas falas. O ✦ (brilho)
fica desligado fora do Pokémon.

A cor do tema de anime é **fixa por fonte**: não dá para tirar a cor da imagem, porque ela vem de
outro domínio e o canvas bloqueia a leitura dos pixels.

## Endpoints e campos confirmados

### AniList (testado ao vivo em 26/10/2026)

- `POST https://graphql.anilist.co`, com `Content-Type: application/json` e corpo `{ "query", "variables" }`.
- Consulta usada:

  ```graphql
  query ($busca: String, $qtd: Int) {
    Page(perPage: $qtd) { characters(search: $busca) { id name { full } image { large } } }
  }
  ```

- Resposta real (busca "goku"):

  ```json
  { "data": { "Page": { "characters": [
    { "id": 246, "name": { "full": "Gokuu Son" },
      "image": { "large": "https://s4.anilist.co/file/anilistcdn/character/large/246-wsRRr6z1kii8.png" } }
  ] } } }
  ```

- Campos: `data.Page.characters[].id`, `.name.full`, `.image.large`. Nada encontrado: `"characters": []`.
- Imagens em `https://s4.anilist.co`. A resposta tem `Access-Control-Allow-Origin: *`.
- Limite: os cabeçalhos mostraram `X-RateLimit-Limit: 30` por minuto (o normal da AniList é 90; 30 é o modo
  "degradado" deles). O widget espaça as requisições em 0,7 s e trata o 429 como o Jikan.

### Jikan v4 (pela documentação oficial: o servidor estava fora do ar no teste)

Em 26/10/2026, `api.jikan.moe` recusava conexões (testado daqui e de um servidor externo).
Os campos foram confirmados na especificação OpenAPI oficial
(`jikan-me/jikan-rest`, `storage/api-docs/api-docs.json`):

- Busca: `GET https://api.jikan.moe/v4/characters?q=TERMO&limit=5`. O widget acrescenta
  `&order_by=favorites&sort=desc`, para o personagem mais popular vir primeiro ("naruto" → Naruto Uzumaki).
- Detalhe: `GET https://api.jikan.moe/v4/characters/{id}` (e `/full`). Não é usado: a busca já traz
  nome e imagem, e os favoritos guardam o personagem inteiro.
- Resposta: `{ "data": [ character ], "pagination": { last_visible_page, has_next_page, current_page, items: { count, total, per_page } } }`.
- `character`: `mal_id`, `url`, `images`, `name`, `name_kanji`, `nicknames[]`, `favorites`, `about`.
- `images`: `jpg.image_url`, `jpg.small_image_url`, `webp.image_url`, `webp.small_image_url`.
  **O que o pedido supunha estava certo**: nome em `data[].name` e imagem em `data[].images.jpg.image_url`.
- Imagens em `https://cdn.myanimelist.net`.
- Limites oficiais: 60 por minuto e 3 por segundo, com erro 429 ao estourar.

## Requisições, cache e erros

- Só busca com Enter ou com clique numa sugestão: nada a cada tecla.
- Cache em memória por fonte + termo (sem diferenciar maiúsculas), válido por 24 horas.
- Jikan: fila de no máximo 1 requisição por segundo. Num 429, a fala avisa, o widget espera 60 s e tenta
  mais uma vez; se falhar de novo, avisa na fala.
- Tempo limite de 10 s por requisição.
- Erros viram fala, e o widget continua normal:
  - sem internet: "Não consegui falar com o …";
  - demora: "… não respondeu a tempo (pode estar fora do ar)";
  - limite: "… pediu calma";
  - nada encontrado: "Não achei ninguém chamado …".
- Escolher outro resultado da lista, ou um favorito, não faz requisição.

## Config (`%APPDATA%\meu-widget\config.json`)

| Chave | Exemplo | Para quê |
|---|---|---|
| `fonte` | `"pokemon"` (padrão), `"jikan"`, `"anilist"` | De onde é o dono atual; o widget reabre nela |
| `ultimaBusca` | `{ "fonte": "anilist", "termo": "goku" }` | A última busca feita |
| `personagem` | `{ "fonte", "id", "nome", "imagem" }` | O último personagem de anime escolhido: reabre **sem requisição** |
| `favoritosFranquias` | `[{ "fonte", "id", "nome", "imagem" }]` | Favoritos de anime (até 50). Os de Pokémon seguem em `favoritos` |

O `main.js` valida tudo: fonte conhecida, `id` inteiro positivo, nome com até 60 caracteres e imagem só
`https` de `cdn.myanimelist.net` ou `s4.anilist.co`.

## Segurança

- CSP (`app/index.html`):
  - `connect-src https://pokeapi.co https://api.jikan.moe https://graphql.anilist.co`;
  - `img-src` ganhou `https://cdn.myanimelist.net` e `https://s4.anilist.co`. **Correção ao pedido**:
    o `img-src` não liberava `https:` em geral, só origens específicas. Por isso as duas CDNs entraram nominalmente.
- Texto das APIs só por `textContent`, nunca `innerHTML`.
- Imagens usadas pela URL direta: nada é baixado para o projeto.

## Como adicionar uma fonte nova

1. Em `app/franquias.js`, crie um bloco como os outros e registre-o em `FONTES`:

   ```js
   const minhaFila = limitador(1000, 60000); // intervalo mínimo entre requisições; pausa após 429
   const MINHA = {
     rotulo: 'Minha Fonte',
     async buscar(termo, avisar) {
       const r = await minhaFila(() => pedir('https://api.exemplo.com/personagens?q=' + encodeURIComponent(termo)), avisar);
       return (Array.isArray(r && r.itens) ? r.itens : [])
         .filter((c) => Number.isInteger(c.id) && typeof c.nome === 'string')
         .map((c) => montar('minha', c.id, c.nome, c.foto));
     },
   };
   const FONTES = { jikan: JIKAN, anilist: ANILIST, minha: MINHA };
   ```

2. Em `app/temas.js`, adicione a paleta em `FONTE_TEMA`:
   `minha: { accent: '#ff9f43', anim: 'bounce', bordao: 'Opa!', rotulo: 'Minha Fonte' }`.
3. Em `app/renderer.js` (módulo `pokemon`), adicione o nome do botão em `NOMES_FONTE` e as sugestões em `SUGESTOES`.
4. Em `app/main.js`, acrescente a chave em `FONTES` e `FONTES_ANIME`, e o host das imagens em `HOSTS_IMAGEM`.
5. Em `app/index.html`, acrescente a API em `connect-src` e a CDN das imagens em `img-src`.
6. Rode `node --check` nos `.js` alterados e faça os testes manuais abaixo.

## Testes manuais

1. **Pokémon continua igual:** aba `poke`, fonte **Pokémon**, digite `charizard` + Enter. Devem aparecer sprite,
   tipos, grito, ☆ e ✦ funcionando.
2. **Jikan, Naruto e Goku:** fonte **Anime · Jikan**, `naruto` + Enter e depois `goku` + Enter. Devem aparecer
   foto, nome, `[JIKAN]` em azul, ✦ apagado e a lista de resultados.
3. **AniList:** fonte **Anime · AniList**, `goku` + Enter. Devem aparecer "Gokuu Son", `[ANILIST]` em turquesa
   e mais 4 resultados; clique em outro para trocar (sem nova requisição).
4. **Sem resultado:** `zzqxwvnadaexiste` + Enter. A fala deve dizer "Não achei ninguém chamado…".
5. **Offline:** desligue a internet e busque um nome novo. A fala deve dizer "Não consegui falar com o…",
   e o widget segue funcionando.
6. **Trocar de fonte e reabrir:** escolha um personagem do AniList, feche e abra o widget. Ele deve voltar
   com o mesmo personagem (mesmo sem internet para a busca) e o seletor deve estar em AniList.
