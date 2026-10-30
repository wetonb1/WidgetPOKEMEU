// estilo.js — roda no <head>, antes de qualquer desenho: marca o visual escolhido
// ("cmd" ou "ios", vindo do main.js pela URL) para o CSS já nascer certo, sem piscar.
const _q = new URLSearchParams(location.search);
document.documentElement.dataset.estilo = _q.get('estilo') === 'ios' ? 'ios' : 'cmd';
if (_q.get('destacado') === '1') document.documentElement.dataset.destacado = '1';
