// conta.js — o que a config guarda POR IA sobre o uso e a troca de conta (fase 10.8). Sem Electron: testável com node.
//   avisoTrocaContaVisto: { claude: bool, antigravity: bool }  o aviso "alternar só para contornar limites pode violar os termos e
//     bloquear a conta" aparece UMA vez por IA. O valor antigo era um booleano só (do Claude): migra para o Claude, sem perder o que já foi visto.
//   ultimoUso: { claude: { quando, medidores }, antigravity: { quando, medidores } }  a última leitura do /usage de cada IA. O formato antigo
//     ({ quando, medidores }, só do Claude) migra para o Claude.
// Nada aqui lê, guarda ou troca login, HOME, chaveiro ou credencial nenhuma: só o que a tela já mostrou e se um aviso foi visto.
const ias = require('./ias');

const IDS = () => Object.keys(ias.IAS);
const texto = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

function migrarAvisoConta(v) {
  const saida = Object.fromEntries(IDS().map((id) => [id, false]));
  if (v === true) saida.claude = true; // o booleano antigo era do Claude
  else if (v && typeof v === 'object' && !Array.isArray(v)) for (const id of IDS()) if (v[id] === true) saida[id] = true;
  return saida;
}

// uma leitura: { quando, medidores: [{ nome, pct, reinicia, restante? }] } ou null. O Claude mostra % USADO (inteiro); o agy mostra o que RESTA (1 casa).
function sanitizarLeitura(u) {
  if (!u || typeof u !== 'object' || !Array.isArray(u.medidores)) return null;
  const quando = typeof u.quando === 'string' && !Number.isNaN(Date.parse(u.quando)) ? new Date(u.quando).toISOString() : null;
  const medidores = u.medidores
    .map((m) => {
      if (!m || typeof m !== 'object' || !Number.isFinite(m.pct)) return null;
      const restante = m.restante === true;
      const pct = Math.max(0, Math.min(100, restante ? Math.round(m.pct * 10) / 10 : Math.round(m.pct)));
      return { nome: texto(m.nome, 60), pct, reinicia: texto(m.reinicia, 60), ...(restante ? { restante: true } : {}) };
    })
    .filter((m) => m && m.nome)
    .slice(0, 6);
  return quando && medidores.length ? { quando, medidores } : null;
}

function sanitizarUso(u) {
  const saida = {};
  if (!u || typeof u !== 'object') return saida;
  if (Array.isArray(u.medidores)) { // formato antigo: uma leitura só, do Claude
    const l = sanitizarLeitura(u);
    if (l) saida.claude = l;
    return saida;
  }
  for (const id of IDS()) {
    const l = sanitizarLeitura(u[id]);
    if (l) saida[id] = l;
  }
  return saida;
}

module.exports = { migrarAvisoConta, sanitizarUso, sanitizarLeitura };
