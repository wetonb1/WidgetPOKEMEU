// temas.js — o "esquema de cores" do CMD que o Pokémon invadiu.
// Visual de CMD de verdade: fundo #0c0c0c, texto cinza #cccccc, Consolas, cantos
// retos. O tipo do Pokémon muda só a cor de destaque (como o comando "color" do
// CMD), a animação do rosto e o bordão que ele solta na narração.

const CMD = { bg: '#0c0c0c', text: '#cccccc', fonte: 'Consolas, "Cascadia Mono", "Lucida Console", monospace' };
// Visual iOS: mesmo destaque por tipo, mas texto claro e fonte do sistema.
// (--bg aqui é só a cor "escura" usada em contrastes; o fundo de verdade é o vidro.)
const IOS = { bg: '#15151d', text: '#f2f2f7', fonte: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' };

const TYPE_THEME = {
  normal:   { accent: '#d6cdb2', anim: 'float',  bordao: 'Hm!' },
  fire:     { accent: '#ff8a3d', anim: 'pulse',  bordao: 'Fuuu!' },
  water:    { accent: '#4aa8ff', anim: 'float',  bordao: 'Splash!' },
  grass:    { accent: '#6fd45a', anim: 'wiggle', bordao: 'Fwip!' },
  electric: { accent: '#ffd93b', anim: 'bounce', bordao: 'Bzzt!' },
  ice:      { accent: '#7fe3f0', anim: 'float',  bordao: 'Brrr!' },
  fighting: { accent: '#f4655a', anim: 'bounce', bordao: 'Hah!' },
  poison:   { accent: '#c680ff', anim: 'wiggle', bordao: 'Hehe~' },
  ground:   { accent: '#d9a441', anim: 'bounce', bordao: 'Rumble!' },
  flying:   { accent: '#9db8ff', anim: 'float',  bordao: 'Fwoosh!' },
  psychic:  { accent: '#ff7fbf', anim: 'pulse',  bordao: 'Hmmm...' },
  bug:      { accent: '#b4d63a', anim: 'wiggle', bordao: 'Bzz!' },
  rock:     { accent: '#c9b26b', anim: 'bounce', bordao: 'Clunk!' },
  ghost:    { accent: '#ab94ff', anim: 'float',  bordao: 'Buuu~' },
  dragon:   { accent: '#8f7bff', anim: 'pulse',  bordao: 'Grrr!' },
  dark:     { accent: '#c8b5a0', anim: 'pulse',  bordao: 'Heh.' },
  steel:    { accent: '#aebccb', anim: 'bounce', bordao: 'Clank!' },
  fairy:    { accent: '#ff9fd8', anim: 'wiggle', bordao: 'Tee-hee!' },
};

// Franquias de anime: paleta de RESERVA por fonte. Normalmente o destaque vem da
// própria imagem do personagem (franquias.corDaImagem); esta só vale se a leitura falhar.
const FONTE_TEMA = {
  anilist: { accent: '#3dd6c3', anim: 'pulse', bordao: 'Hey!', rotulo: 'AniList' }, // turquesa
};

// Antes de qualquer Pokémon invadir: o CMD "de fábrica" (cinza, sem destaque colorido)
const TEMA_INICIAL = { accent: '#f2f2f2', anim: 'float', bordao: '' };

// Nome do tipo em português (para as etiquetas)
const TIPO_PT = {
  normal: 'Normal', fire: 'Fogo', water: 'Água', grass: 'Planta', electric: 'Elétrico',
  ice: 'Gelo', fighting: 'Lutador', poison: 'Veneno', ground: 'Terra', flying: 'Voador',
  psychic: 'Psíquico', bug: 'Inseto', rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão',
  dark: 'Sombrio', steel: 'Aço', fairy: 'Fada',
};

// Aplica o tema de um tipo em todo o widget. Tipo desconhecido usa "normal";
// null usa o CMD inicial (antes de escolher um Pokémon).
// "fonte:anilist" usa a paleta da franquia.
function aplicarTema(tipo) {
  const fonte = typeof tipo === 'string' && tipo.startsWith('fonte:') ? FONTE_TEMA[tipo.slice(6)] : null;
  const t = fonte || (tipo === null ? TEMA_INICIAL : (TYPE_THEME[tipo] || TYPE_THEME.normal));
  const raiz = document.documentElement;
  const base = raiz.dataset.estilo === 'ios' ? IOS : CMD;
  raiz.style.setProperty('--accent', t.accent);
  raiz.style.setProperty('--bg', base.bg);
  raiz.style.setProperty('--text', base.text);
  raiz.style.setProperty('--font', base.fonte);
  raiz.dataset.anim = t.anim; // o CSS escolhe a animação do rosto por este atributo
  return t;
}
