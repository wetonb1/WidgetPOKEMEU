// economia.js — ponte entre o widget e o cerebro/tools/economia.py (subaba "Economia" da aba Cérebro).
// Sem regra de negócio: as contas (consultas por semana, proporção por nível, tokens evitados, comparação A/B) são do economia.py,
// e tudo é ESTIMATIVA feita a partir dos logs locais. Aqui só se limpa o que veio da tela e se executa "python economia.py <comando> --json".
// Sem dependência do Electron (testável com node).
const { executar } = require('./cerebro');

const ID = /^\d{14}-[0-9a-f]{4}$/;
const falhou = (erro) => Promise.resolve({ ok: false, tipo: 'erro', erro });
const rodar = (args, entrada) => executar(args, entrada, 'economia.py');
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const painel = (semanas) => rodar(['painel', '--json', '--semanas', String(Number.isInteger(semanas) ? Math.max(2, Math.min(semanas, 26)) : 8)]);

// os números do teste A/B manual (você digita o que o /usage mostrou); o economia.py valida de verdade
const registrarAB = (d) => {
  const o = d && typeof d === 'object' ? d : {};
  return rodar(['ab-registrar', '--json'], JSON.stringify({
    tarefa: texto(o.tarefa, 120), variante: o.variante === 'sem' ? 'sem' : 'com', entrada: texto(o.entrada, 20), saida: texto(o.saida, 20),
    custo_usd: texto(o.custo_usd, 20), notas: texto(o.notas, 300),
  }));
};
const removerAB = (id) => (ID.test(String(id)) ? rodar(['ab-remover', String(id), '--json']) : falhou('id inválido'));

module.exports = { painel, registrarAB, removerAB };
