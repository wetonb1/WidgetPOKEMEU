# Franquias (Pokémon e anime)

O "dono" do widget pode vir de duas fontes, escolhidas na aba `poke` (ou na tela da primeira escolha):

| Fonte | Onde está o código | Chave |
|---|---|---|
| Pokémon (PokéAPI) | `app/renderer.js`, função `loadPokemon` | não |
| Anime, AniList (GraphQL) | `app/franquias.js`, bloco `ANILIST` | não |

O Jikan (MyAnimeList, não oficial) chegou a ser implementado na Etapa 6C e foi **retirado** a pedido.
Uma config antiga com `"fonte": "jikan"` abre no Pokémon, e os favoritos do Jikan são descartados.

## Contrato comum

A fonte de anime devolve uma lista (até 5) neste formato:

```js
{ nome, imagem, fonte, tema, id }
// nome:   texto do personagem (a tela usa sempre textContent)
// imagem: URL https direta da imagem (nada é baixado para o projeto)
// fonte:  'anilist'
// tema:   'fonte:anilist' (paleta de reserva em app/temas.js, FONTE_TEMA)
// id:     número do personagem na API (favoritos e reabrir o widget)
```

O Pokémon segue o fluxo dele (tipo → tema em `TYPE_THEME`, sprite recortado, grito, brilho).
Na tela, os dois usam o mesmo rosto, o mesmo nome, a mesma ☆ e as mesmas falas. O ✦ (brilho)
fica desligado fora do Pokémon.

## Cor do personagem

No anime, o destaque do widget (botões, nome, prompt, barras, visualizador) usa **a cor do próprio personagem**,
tirada da imagem dele (`franquias.corDaImagem`):

- A CDN do AniList (`s4.anilist.co`) responde com `Access-Control-Allow-Origin: null`, que é a origem de uma
  página aberta do disco, como o widget. Então a imagem pode ser lida num canvas com `crossOrigin = 'anonymous'`.
  A premissa original da etapa ("o canvas bloqueia") não vale para essa CDN.
- A imagem é reduzida para 48×48. Pixels cinzentos, pretos ou estourados são ignorados, e tons de pele contam
  pouco (senão o rosto ganharia da roupa e do cabelo). Os demais são agrupados em 24 faixas de matiz, e ganha a
  faixa com mais peso (quantidade × saturação). A cor é clareada até ficar legível no fundo escuro.
- Exemplos medidos: Goku `#de7b56` (laranja), Naruto `#d3d500` (amarelo), Gojo `#3da0cd` (azul),
  Luffy `#e08179` (vermelho), Rem `#8eaae0` (azul-lilás). Imagens quase sem cor (Mikasa: tons de marrom)
  ficam com a cor dominante real, mesmo discreta.
- A conta é feita uma vez por personagem. A cor vai para a config junto com ele (`personagem.cor`) e para a
  pokébola da tela de carregamento (`corPokebola`). Se a leitura falhar, vale a paleta de reserva (turquesa).

## Endpoint e campos confirmados (AniList, testado ao vivo em 26/10/2026)

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
- Limite: os cabeçalhos mostraram `X-RateLimit-Limit: 30` por minuto (o normal da AniList é 90; 30 é o modo
  "degradado" deles). O widget espaça as requisições em 0,7 s e trata o 429 com uma pausa de 60 s.

## Requisições, cache e erros

- Só busca com Enter ou com clique numa sugestão: nada a cada tecla.
- Cache em memória por termo (sem diferenciar maiúsculas), válido por 24 horas.
- Num 429, a fala avisa, o widget espera 60 s e tenta mais uma vez; se falhar de novo, avisa na fala.
- Tempo limite de 10 s por requisição.
- Erros viram fala, e o widget continua normal:
  - sem internet: "Não consegui falar com o AniList…";
  - demora: "… não respondeu a tempo (pode estar fora do ar)";
  - limite: "… pediu calma";
  - nada encontrado: "Não achei ninguém chamado …".
- Escolher outro resultado da lista, ou um favorito, não faz requisição.

## Config (`%APPDATA%\meu-widget\config.json`)

| Chave | Exemplo | Para quê |
|---|---|---|
| `fonte` | `"pokemon"` (padrão) ou `"anilist"` | De onde é o dono atual; o widget reabre nela |
| `ultimaBusca` | `{ "fonte": "anilist", "termo": "goku" }` | A última busca feita |
| `personagem` | `{ "fonte", "id", "nome", "imagem", "cor" }` | O último personagem de anime: reabre **sem requisição** e já na cor dele |
| `favoritosFranquias` | `[{ "fonte", "id", "nome", "imagem", "cor" }]` | Favoritos de anime (até 50). Os de Pokémon seguem em `favoritos` |

O `main.js` valida tudo: fonte conhecida, `id` inteiro positivo, nome com até 60 caracteres, imagem só
`https` de `s4.anilist.co` e cor no formato `#rrggbb`.

## Segurança

- CSP (`app/index.html`): `connect-src https://pokeapi.co https://graphql.anilist.co`; o `img-src`
  libera `https://s4.anilist.co` nominalmente (ele nunca liberou `https:` em geral).
- Texto da API só por `textContent`, nunca `innerHTML`.
- Imagens usadas pela URL direta: nada é baixado para o projeto. O canvas da cor é temporário (48×48) e descartado.

## Como adicionar uma fonte nova

1. Em `app/franquias.js`, crie um bloco como o do AniList e registre-o em `FONTES`:

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
   const FONTES = { anilist: ANILIST, minha: MINHA };
   ```

2. Em `app/temas.js`, adicione a paleta de reserva em `FONTE_TEMA`:
   `minha: { accent: '#ff9f43', anim: 'bounce', bordao: 'Opa!', rotulo: 'Minha Fonte' }`.
3. Em `app/renderer.js` (módulo `pokemon`), adicione o nome do botão em `NOMES_FONTE` e as sugestões em `SUGESTOES`.
4. Em `app/main.js`, acrescente a chave em `FONTES` e `FONTES_ANIME`, e o host das imagens em `HOSTS_IMAGEM`.
5. Em `app/index.html`, acrescente a API em `connect-src` e a CDN das imagens em `img-src`.
6. A cor do personagem só funciona se a CDN das imagens liberar CORS. Confira com
   `curl -D - -o NUL -H "Origin: null" <url da imagem>` (precisa de `Access-Control-Allow-Origin`). Sem isso,
   vale a paleta de reserva.
7. Rode `node --check` nos `.js` alterados e faça os testes manuais abaixo.

## Testes manuais

1. **Pokémon continua igual:** aba `poke`, fonte **Pokémon**, digite `charizard` + Enter. Devem aparecer sprite,
   tipos, grito, ☆ e ✦ funcionando, e as cores do tipo.
2. **AniList com a cor do personagem:** fonte **Anime · AniList**, busque `goku` (o widget fica laranja) e depois
   `gojo` (fica azul). Clique em outro resultado para trocar, sem nova requisição.
3. **Sem resultado:** `zzqxwvnadaexiste` + Enter. A fala deve dizer "Não achei ninguém chamado…".
4. **Offline:** desligue a internet e busque um nome novo. A fala deve dizer "Não consegui falar com o AniList…",
   e o widget segue funcionando.
5. **Reabrir:** escolha um personagem do AniList, feche e abra o widget. Ele deve voltar com o mesmo personagem,
   já na cor dele, e a pokébola da abertura também.
