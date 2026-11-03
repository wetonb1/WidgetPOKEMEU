// estilo.js — roda no <head>, antes de qualquer desenho: marca o visual escolhido
// ("cmd" ou "ios", vindo do main.js pela URL) para o CSS já nascer certo, sem piscar.
const _q = new URLSearchParams(location.search);
document.documentElement.dataset.estilo = _q.get('estilo') === 'ios' ? 'ios' : 'cmd';
// no Linux o botão de shell abre o SEU shell ($SHELL), não um PowerShell
window.SHELL_NOME = /Windows/i.test(navigator.userAgent) ? 'PowerShell' : 'Terminal';
document.documentElement.dataset.so = /Windows/i.test(navigator.userAgent) ? 'win' : 'linux';
if (_q.get('destacado') === '1') document.documentElement.dataset.destacado = '1';
