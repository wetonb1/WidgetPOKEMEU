// abrir.js — abre a IA de um projeto num terminal (aba Projetos: "Abrir Claude", "Continuar última
// sessão", "Escolher sessão anterior" e o atalho Ctrl+Alt+A). Junta as peças: o cadastro, o prompt e
// o worktree vêm do projetos.py, os argumentos de cada IA do ias.js, a janela do terminal.js e o
// controle das sessões abertas do sessoes.js. Não depende do Electron: a área de transferência entra
// como função (copiar), e "simular" monta tudo sem abrir nem registrar nada (testes).
const ias = require('./ias');
const terminal = require('./terminal');
const projetos = require('./projetos');
const { chavePasta } = require('./sessoes');

const MODOS = new Set(['novo', 'continuar', 'retomar']);
const NOMES_MODO = { continuar: 'continuar a última sessão', retomar: 'escolher uma sessão anterior' };

// opcoes: { ia, modo, modelo, tarefa, forcar, ignorarLimite, worktree, retomada, semPularPermissoes, semPrompt, comando }
//   ia: abrir OUTRA IA que não a do projeto (ex.: "continuar no Antigravity"); só ids que o ias.js conhece. Sem ia: a do projeto.
//   forcar: abre mesmo com outra sessão na mesma pasta (desaconselhado)
//   ignorarLimite: abre mesmo passando de max_sessoes
//   worktree: abre num git worktree separado ({pasta}-sessao2, branch nova)
//   retomada: sessão nova que continua de onde o projeto parou, lendo o estado do cérebro (depois de uma pausa)
//   semPularPermissoes: true = nunca pular permissões nesta abertura, mesmo na IA padrão que tem a opção ligada ("continuar em outra IA")
//   semPrompt + comando: abre a IA vazia e põe o comando (ex.: /usage) na área de transferência para você colar
//     (no terminal embutido o widget digita o comando sozinho quando a IA estiver esperando você)
// terceiro argumento: embutido(opcoesJanela) -> { termId, pid, iaPid, comandoAceito } | { erro } | null. Se existir, a sessão abre
// DENTRO do widget (app/embutido.js); null = não deu (sem csc, Windows antigo...) e abre no terminal externo de sempre.
async function abrirIA(id, opcoes = {}, { copiar = null, simular = false, registro = null, max = 3, embutido = null } = {}) {
  const { modo = 'novo', modelo, tarefa = '', forcar = false, ignorarLimite = false, worktree = false, retomada = false, semPrompt = false, comando = '', semPularPermissoes = false } = opcoes;
  if (!MODOS.has(modo)) return { ok: false, tipo: 'erro', erro: 'modo inválido' };
  const lista = await projetos.listar();
  if (!lista.ok) return lista;
  const projeto = lista.dados.projetos.find((p) => p.id === id);
  if (!projeto) return { ok: false, tipo: 'erro', erro: 'projeto não encontrado: ' + id };
  // a IA aberta: a pedida (só se for uma conhecida) ou a do projeto
  const pedida = opcoes.ia === undefined || opcoes.ia === null || opcoes.ia === '' ? projeto.ia : opcoes.ia;
  const idIA = typeof pedida === 'string' ? pedida : '';
  const ia = ias.obter(idIA);
  if (!ia) return { ok: false, tipo: 'erro', erro: 'IA desconhecida: ' + String(pedida).slice(0, 40) };
  const ehPadrao = idIA === projeto.ia; // a IA padrão do projeto (só ela herda o "pular permissões")

  // 0. o modo existe nesta IA? (ex.: o Antigravity não tem "escolher sessão anterior" na linha de comando)
  if (modo !== 'novo' && ia.suporta && ia.suporta[modo] === false) {
    return { ok: false, tipo: 'semSuporte', ia: idIA, modo, erro: `${ia.nome} não tem "${NOMES_MODO[modo]}".`, dica: (ia.dicas && ia.dicas[modo]) || '' };
  }

  // 1. a IA está instalada? (não instala sozinho: só explica como)
  if (!ias.localizar(ia.executavel)) {
    return {
      ok: false, tipo: 'semIA', ia: idIA, erro: `${ia.nome} não encontrado no PATH.`,
      instalar: ia.instalar, instalarAlternativa: ia.instalarAlternativa, docs: ia.docs,
    };
  }
  if (!projeto.pasta_existe) return { ok: false, tipo: 'erro', erro: 'a pasta do projeto não existe: ' + projeto.pasta };
  // chave de API: só se o projeto pediu E a variável DESTA IA existe no Windows (a sessão não cai sozinha numa cobrança por API)
  const usarChave = projeto.usar_api_key === true;
  if (usarChave && !ias.temChave(ia)) {
    return { ok: false, tipo: 'semChave', ia: idIA, erro: `Este projeto está marcado para usar a chave de API, mas a variável ${ia.variavelChave} não existe no Windows (${ia.nome}).`, variavel: ia.variavelChave };
  }
  // modelo: o pedido, se existe nesta IA; senão o padrão do projeto (se for a IA dele), o de modelos_por_ia e o padrão da IA
  const temModelo = (m) => typeof m === 'string' && Object.prototype.hasOwnProperty.call(ia.modelos, m);
  const porIA = projeto.modelos_por_ia && typeof projeto.modelos_por_ia === 'object' ? projeto.modelos_por_ia[idIA] : undefined;
  const escolhido = [modelo, ehPadrao ? projeto.modelo_padrao : undefined, porIA, ia.modeloPadrao].find(temModelo) || Object.keys(ia.modelos)[0];
  // pular permissões: só na IA padrão do projeto (nunca herdado ao abrir a outra) e só se ela tiver a opção
  const pularPermissoes = semPularPermissoes !== true && ehPadrao && projeto.pular_permissoes === true && !!(ia.suporta && ia.suporta.pularPermissoes);
  // comando que a tela pode pedir (hoje /usage): só os desta IA
  const comandoValido = semPrompt === true && typeof comando === 'string' && (ia.comandosUteis || []).includes(comando) ? comando : '';

  // 2. onde abrir: a pasta do projeto ou um worktree separado
  let pasta = projeto.pasta;
  let infoWorktree = null;
  if (worktree === true && !simular) {
    const w = await projetos.criarWorktree(id);
    if (!w.ok) return w;
    infoWorktree = w.dados;
    pasta = w.dados.pasta;
  }

  // 3. trava por pasta (vale entre IAs: Claude e Antigravity na mesma pasta também conflitam) e limite de sessões
  if (registro) {
    const ativas = await registro.listar();
    const naMesma = ativas.find((s) => chavePasta(s.pasta) === chavePasta(pasta));
    if (naMesma && forcar !== true) return { ok: false, tipo: 'pastaOcupada', sessao: naMesma, podeWorktree: !infoWorktree };
    if (ativas.length >= max && ignorarLimite !== true) return { ok: false, tipo: 'limite', max, ativas: ativas.length };
  }

  // 4. prompt inicial (só numa sessão nova): prompt_inicial.txt + tema tirado da tarefa. Ele é a garantia de que o cérebro é consultado.
  let prompt = '';
  if (modo === 'novo' && semPrompt !== true) {
    const r = await projetos.montarPrompt(id, retomada === true ? '' : tarefa, retomada === true);
    if (!r.ok) return r;
    prompt = r.dados.prompt;
  }
  // sem prompt por argumento: no terminal embutido o widget digita quando a IA estiver esperando; senão vai para a área de transferência
  const digitarPrompt = !!prompt && !ia.promptPorArgumento;

  // 5. a janela
  const args = ia.argumentos({ modo, modelo: escolhido, prompt: ia.promptPorArgumento ? prompt : '', pularPermissoes });
  if (!args) return { ok: false, tipo: 'semSuporte', ia: idIA, modo, erro: `${ia.nome} não tem "${NOMES_MODO[modo] || modo}".`, dica: (ia.dicas && ia.dicas[modo]) || '' };
  const sufixo = infoWorktree ? ' (worktree)' : '';
  const opcoesJanela = { pasta, titulo: `${ia.nome} - ${projeto.nome}${sufixo}`, programa: ia.executavel, args, env: ias.ambiente(ia, process.env, { usarChave }) };
  const paraDigitar = comandoValido || (digitarPrompt ? prompt : '');
  let plano = null;
  let digitado = false; // o embutido aceitou digitar o comando/prompt (a IA tem telas confirmadas)
  if (embutido && !simular) {
    const r = await embutido({ ...opcoesJanela, comandoInicial: paraDigitar, ia: idIA });
    if (r && r.erro) return { ok: false, tipo: 'erro', erro: r.erro };
    if (r) {
      plano = { via: 'widget', pid: r.pid, iaPid: r.iaPid, termId: r.termId };
      digitado = !!paraDigitar && r.comandoAceito !== false;
    }
  }
  if (!plano) {
    try {
      plano = simular ? terminal.planejar(opcoesJanela) : terminal.abrir(opcoesJanela);
    } catch (erro) {
      return { ok: false, tipo: 'erro', erro: erro.message };
    }
  }
  // o que não foi digitado pelo widget vai para a área de transferência, com o aviso
  let aviso = '';
  if (digitarPrompt) {
    if (digitado) aviso = `Vou digitar o prompt inicial quando o ${ia.nome} estiver pronto`;
    else if (copiar) { copiar(prompt); aviso = 'Cole o prompt inicial (Ctrl+V)'; }
  }
  if (comandoValido) {
    if (digitado) aviso = `Vou digitar ${comandoValido} quando o ${ia.nome} estiver pronto`;
    else if (copiar) { copiar(comandoValido); aviso = `Cole ${comandoValido} (Ctrl+V) e dê Enter`; }
  }

  // 6. registro: última abertura + cerebro/.log/sessoes.jsonl + lista de sessões ativas (com a IA que abriu de verdade)
  let sessao = null;
  if (!simular) {
    // motivo: "uso" = só abriu para ver o /usage (não conta como trabalho na estimativa), "retomada" = voltou de uma pausa
    const motivo = semPrompt === true && comandoValido ? 'uso' : retomada === true ? 'retomada' : '';
    await projetos.registrarSessao(id, { ia: idIA, modelo: escolhido, tarefa, modo, motivo });
    if (registro) {
      sessao = registro.adicionar({
        projeto: id, nome: projeto.nome, pasta, ia: idIA, executavel: ia.executavel, processo: ia.processo, modelo: escolhido,
        tarefa, modo, via: plano.via, spawnPid: plano.pid, worktree: infoWorktree ? infoWorktree.branch : null,
        // sessão embutida: o PID do programa já é conhecido (não precisa procurar a janela) e o terminal tem id próprio
        ...(plano.via === 'widget' ? { iaPid: plano.iaPid, janelaPid: plano.pid, termId: plano.termId } : {}),
      });
    }
  }
  return { ok: true, via: plano.via, termId: plano.termId || null, ia: idIA, modelo: escolhido, modo, aviso, pularPermissoes, usarChave, plano, worktree: infoWorktree, sessao };
}

module.exports = { abrirIA };
