// estilo.js — roda no <head>, antes de qualquer desenho: marca o visual escolhido
// ("cmd" ou "ios", vindo do main.js pela URL) para o CSS já nascer certo, sem piscar.
document.documentElement.dataset.estilo =
  new URLSearchParams(location.search).get('estilo') === 'ios' ? 'ios' : 'cmd';
