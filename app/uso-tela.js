// uso-tela.js — lê, do TEXTO da tela do /usage do Claude Code, os medidores (sessão atual, semana...) para o widget desenhar barras fáceis de
// ler. O widget não tem acesso a número nenhum da sua conta: ele só lê o que o próprio Claude mostrou no terminal embutido, e só quando você
// clica em "ver agora". Funciona na tela (script comum, função global) e no node (testes). Só lê texto; nada é executado.
(function (raiz) {
  // nome que o Claude usa -> nome em português
  const NOMES = [
    [/^current session$/i, () => 'Sessão atual'],
    [/^current week \(all models\)$/i, () => 'Semana (todos os modelos)'],
    [/^current week \((.+)\)$/i, (m) => 'Semana (' + m[1].replace(/ only$/i, '').trim() + ')'],
    [/^current week$/i, () => 'Semana'],
  ];
  const traduzir = (nome) => {
    for (const [re, fn] of NOMES) { const m = re.exec(nome); if (m) return fn(m); }
    return nome;
  };
  // a barra desenhada com blocos (█▌ etc.) e os espaços do terminal saem do caminho
  const limpar = (l) => l.replace(/[▀-▟]+/g, ' ').replace(/\s+/g, ' ').trim();

  // texto da tela -> [{ nome, pct, reinicia }] (vazio se não for a tela do /usage)
  function extrairUso(texto) {
    const linhas = String(texto || '').replace(/\r/g, '').split('\n').map(limpar);
    const achados = new Map();
    for (let i = 0; i < linhas.length; i++) {
      const m = /^(\d{1,3})% used\b/i.exec(linhas[i]);
      if (!m) continue;
      const pct = Math.min(100, Number(m[1]));
      let nome = '';
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) { if (linhas[j] && !/% used/i.test(linhas[j])) { nome = linhas[j]; break; } }
      if (!nome) continue;
      let reinicia = '';
      for (let j = i + 1; j <= Math.min(linhas.length - 1, i + 2); j++) {
        const r = /^Resets\s+(.+)$/i.exec(linhas[j]);
        if (r) { reinicia = r[1].replace(/\s*\([^)]*\)\s*$/, '').trim(); break; }
      }
      achados.set(traduzir(nome), { nome: traduzir(nome), pct, reinicia });
    }
    return [...achados.values()].slice(0, 4);
  }

  const api = { extrairUso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.extrairUso = extrairUso;
})(typeof window !== 'undefined' ? window : globalThis);
