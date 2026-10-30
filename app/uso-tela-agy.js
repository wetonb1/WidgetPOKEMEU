// uso-tela-agy.js — lê, do TEXTO da tela do /usage do Antigravity (agy), os medidores de cota para o widget desenhar barras. Irmão do
// uso-tela.js (que lê o /usage do Claude Code), mas com outra tela: o agy mostra o que RESTA (não o que foi usado), em grupos de modelos
// (Gemini; Claude e GPT; Gemini 4 Argon), cada um com "Weekly Limit Remaining" e "Five Hour Limit Remaining", e quando reinicia.
// O widget não tem acesso a número nenhum da sua conta: só lê o que o próprio agy mostrou no terminal embutido, e só quando você clica em
// "ver agora". Funciona na tela (script comum, função global) e no node (testes). Só lê texto; nada é executado.
// Tela confirmada no 10.0 e recapturada no 10.8: tools/fixtures/agy-uso.txt (docs/antigravity.md).
(function (raiz) {
  // nome do grupo na tela do agy -> nome curto em português (grupo que não está aqui entra com o nome em maiúsculas/minúsculas)
  const GRUPOS = [
    [/^GEMINI MODELS$/, 'Gemini'],
    [/^CLAUDE AND GPT MODELS$/, 'Claude e GPT'],
    [/^GEMINI 4 ARGON$/, 'Gemini 4 Argon'],
  ];
  const JANELAS = [
    [/^Weekly Limit Remaining\b/i, 'semana'],
    [/^Five Hour Limit Remaining\b/i, '5 horas'],
  ];
  // a barra desenhada com blocos (█░ etc.) e os espaços do terminal saem do caminho
  const limpar = (l) => l.replace(/[▀-▟]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ehCabecalhoDeGrupo = (l) => /^[A-Z0-9][A-Z0-9 ]{2,}[A-Z0-9]$/.test(l) && /[A-Z]/.test(l);
  const nomeDoGrupo = (l) => {
    for (const [re, nome] of GRUPOS) if (re.test(l)) return nome;
    return l.charAt(0) + l.slice(1).toLowerCase();
  };

  // texto da tela -> [{ nome, grupo, janela, pct, restante: true, reinicia }] (vazio se não for a tela do /usage do agy).
  // pct é o que RESTA (0 a 100); reinicia é o texto "165h 2m" que o agy mostra.
  function extrairUsoAgy(texto) {
    const linhas = String(texto || '').replace(/\r/g, '').split('\n').map(limpar);
    const achados = [];
    let grupo = '';
    let janela = '';
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l) continue;
      if (ehCabecalhoDeGrupo(l)) { grupo = nomeDoGrupo(l); janela = ''; continue; }
      const j = JANELAS.find(([re]) => re.test(l));
      if (j) { janela = j[1]; continue; }
      const m = /^\[\s*\]\s*(\d{1,3}(?:[.,]\d+)?)%/.exec(l);
      if (!m || !grupo || !janela) continue;
      const pct = Math.min(100, Math.round(Number(m[1].replace(',', '.')) * 10) / 10);
      let reinicia = '';
      for (let k = i + 1; k <= Math.min(linhas.length - 1, i + 2); k++) {
        const r = /^Refreshes in\s+(.+)$/i.exec(linhas[k]);
        if (r) { reinicia = r[1].trim(); break; }
      }
      achados.push({ nome: `${grupo} · ${janela}`, grupo, janela, pct, restante: true, reinicia });
      janela = '';
    }
    return achados.slice(0, 6);
  }

  const api = { extrairUsoAgy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.extrairUsoAgy = extrairUsoAgy;
})(typeof window !== 'undefined' ? window : globalThis);
