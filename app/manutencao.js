// manutencao.js — ponte entre o widget e o cerebro/tools/manutencao.py (botão "Manutenção" da aba Cérebro).
// Sem regra de negócio: diagnóstico, sinônimos, consolidação, proposta de estado, índices e backup são do manutencao.py. Aqui só se limpa o
// que veio da tela e se executa "python manutencao.py <comando> --json". Nada roda sozinho: cada função é um clique.
// consolidar e proporEstado usam o Claude Code (gastam tokens): a tela mostra a estimativa e pede confirmação ANTES de chamá-los.
// Sem dependência do Electron (testável com node).
const { executar } = require('./cerebro');

const PROJETO = /^[a-z0-9][a-z0-9-]{0,40}$/;
const GRUPO = /^[0-9a-f]{10}$/;
const MODELOS = new Set(['haiku', 'sonnet']);
const TIMEOUT_IA = 290000; // até 2 chamadas de 120 s (a segunda é a correção do formato) + folga
const falhou = (erro) => Promise.resolve({ ok: false, tipo: 'erro', erro });
const rodar = (args, entrada, timeout) => executar(args, entrada, 'manutencao.py', timeout);
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const projetoValido = (p) => (typeof p === 'string' && PROJETO.test(p) ? p : null);
const modeloValido = (m) => (MODELOS.has(m) ? m : 'haiku');

const diagnostico = () => rodar(['diagnostico', '--json']);

// só pares aprovados na tela; o manutencao.py valida de verdade (slug, limite, duplicados)
const aprovarSinonimos = (pares) => {
  const o = pares && typeof pares === 'object' ? pares : {};
  const limpos = {};
  for (const [a, p] of Object.entries(o).slice(0, 60)) limpos[texto(a, 60)] = texto(p, 60);
  return rodar(['sinonimos-aprovar', '--json'], JSON.stringify({ pares: limpos }));
};
const removerSinonimo = (apelido) => (texto(apelido, 60) ? rodar(['sinonimos-remover', '--json', '--', texto(apelido, 60)]) : falhou('apelido inválido'));

const estimarConsolidacao = () => rodar(['estimar-consolidar', '--json']);
const consolidar = (id, modelo) => (GRUPO.test(String(id)) ? rodar(['consolidar', String(id), '--json', '--modelo', modeloValido(modelo), '--timeout', '120'], undefined, TIMEOUT_IA) : falhou('grupo inválido'));

const estimarEstado = (projeto) => (projetoValido(projeto) ? rodar(['estimar-estado', projeto, '--json']) : falhou('projeto inválido'));
const proporEstado = (projeto, modelo) => (projetoValido(projeto)
  ? rodar(['propor-estado', projeto, '--json', '--modelo', modeloValido(modelo), '--timeout', '120'], undefined, TIMEOUT_IA)
  : falhou('projeto inválido'));
const aplicarEstado = (projeto, textoEstado) => (projetoValido(projeto) && typeof textoEstado === 'string' && textoEstado.length < 20000
  ? rodar(['aplicar-estado', projeto, '--json'], JSON.stringify({ texto: textoEstado }))
  : falhou('dados inválidos'));

const refazerIndices = () => rodar(['indices', '--json']);
// o destino vem do seletor de pastas do main.js (a tela nunca manda um caminho)
const exportar = (destino) => (typeof destino === 'string' && destino && destino.length < 500 ? rodar(['exportar', '--json', '--destino=' + destino]) : falhou('escolha a pasta de destino'));

module.exports = { diagnostico, aprovarSinonimos, removerSinonimo, estimarConsolidacao, consolidar, estimarEstado, proporEstado, aplicarEstado, refazerIndices, exportar };
