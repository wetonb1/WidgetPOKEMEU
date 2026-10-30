// uso.js — ponte entre o widget e o cerebro/tools/uso.py ("Uso e continuidade" da aba Projetos).
// O uso.py só CONTA as sessões que o widget abriu (cerebro/.log/sessoes.jsonl): não é o uso real nem o limite
// da conta. O Claude Code não tem forma oficial de ler isso de fora; quem mostra é o comando /usage, e
// por isso a tela só ensina a abri-lo. Aqui não há regra de negócio; só limpa a entrada e chama o script.
// Sem dependência do Electron (testável com node).
const { executar } = require('./cerebro');

const resumo = (dias = 7) => executar(['resumo', '--json', '--dias', String(Math.max(1, Math.min(Number.isInteger(dias) ? dias : 7, 30)))], undefined, 'uso.py');

module.exports = { resumo };
