// temas.js — o "esquema de cores" do CMD que o Pokémon invadiu.
// Visual de CMD de verdade: fundo #0c0c0c, texto cinza #cccccc, Consolas, cantos
// retos. O tipo do Pokémon muda só a cor de destaque (como o comando "color" do
// CMD), a animação do rosto e o bordão que ele solta na narração.

const CMD = { bg: '#0c0c0c', text: '#cccccc', fonte: 'Consolas, "Cascadia Mono", "Lucida Console", monospace' };

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
function aplicarTema(tipo) {
  const t = tipo === null ? TEMA_INICIAL : (TYPE_THEME[tipo] || TYPE_THEME.normal);
  const raiz = document.documentElement;
  raiz.style.setProperty('--accent', t.accent);
  raiz.style.setProperty('--bg', CMD.bg);
  raiz.style.setProperty('--text', CMD.text);
  raiz.style.setProperty('--font', CMD.fonte);
  raiz.dataset.anim = t.anim; // o CSS escolhe a animação do rosto por este atributo
  return t;
}
