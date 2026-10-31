// cerebro.js — ponte entre o widget e o cerebro/tools/cerebro.py (a aba "Cérebro").
// Aqui não tem lógica de busca: cada função só monta os argumentos e executa
// "python cerebro.py <comando> --json", devolvendo o JSON. Tudo acontece quando você clica
// (um processo Python curto, ~0,3 s e ~15 MB que some ao terminar); nada fica rodando.
// Não depende do Electron, então dá para testar com "node tools/testar-cerebro.js".
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const os = require('os');

// Onde está o cerebro/tools: ao lado do widget (npm start) ou, no .exe (que não leva o cérebro
// junto), na pasta do cérebro escolhida (CEREBRO_DIR ou "cerebro_dir" do ~/.cerebro.json).
// Onde o widget está instalado/extraído (raiz do projeto ou pasta do .exe portátil)
function pastaRaizWidget() {
  const dirPai = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(dirPai, 'cerebro', 'tools', 'cerebro.py'))) {
    return dirPai;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR && fs.existsSync(process.env.PORTABLE_EXECUTABLE_DIR)) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.env.PORTABLE_EXECUTABLE_FILE && fs.existsSync(process.env.PORTABLE_EXECUTABLE_FILE)) {
    return path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  }
  if (process.execPath && !process.execPath.includes('node_modules') && !process.execPath.endsWith('node.exe') && !process.execPath.endsWith('electron.exe')) {
    const dirExe = path.dirname(process.execPath);
    if (fs.existsSync(path.join(dirExe, 'cerebro'))) return dirExe;
  }
  // Se estiver rodando empacotado (.exe no Temp) e não achou cerebro ao lado:
  // consulta pastaInstalacao salva na config do widget ou ~/.cerebro.json
  try {
    const pastaCfg = process.env.APPDATA ? path.join(process.env.APPDATA, 'meu-widget') : path.join(os.homedir(), '.config', 'meu-widget');
    const arqCfg = path.join(pastaCfg, 'config.json');
    if (fs.existsSync(arqCfg)) {
      const c = JSON.parse(fs.readFileSync(arqCfg, 'utf8').replace(/^\uFEFF/, ''));
      if (c && c.pastaInstalacao && fs.existsSync(path.join(c.pastaInstalacao, 'cerebro', 'tools', 'cerebro.py'))) {
        return c.pastaInstalacao;
      }
    }
  } catch { /* ignora */ }
  try {
    const arqCerebro = process.env.CEREBRO_CONFIG || path.join(os.homedir(), '.cerebro.json');
    if (fs.existsSync(arqCerebro)) {
      const c = JSON.parse(fs.readFileSync(arqCerebro, 'utf8').replace(/^\uFEFF/, ''));
      if (c && c.cerebro_dir) {
        const pai = path.dirname(c.cerebro_dir);
        if (fs.existsSync(path.join(c.cerebro_dir, 'tools', 'cerebro.py'))) return pai;
      }
    }
  } catch { /* ignora */ }
  return path.resolve(__dirname, '..');
}

function pastaTools() {
  const raiz = pastaRaizWidget();
  const candidatos = [
    path.join(raiz, 'cerebro', 'tools'),
    path.join(__dirname, '..', 'cerebro', 'tools'),
  ];
  const achado = candidatos.find((p) => fs.existsSync(path.join(p, 'cerebro.py')));
  if (achado) return achado;

  const pastas = [process.env.CEREBRO_DIR];
  try {
    const arquivo = process.env.CEREBRO_CONFIG || path.join(os.homedir(), '.cerebro.json');
    if (fs.existsSync(arquivo)) {
      const conteudo = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''));
      if (conteudo && conteudo.cerebro_dir) {
        pastas.push(conteudo.cerebro_dir);
        pastas.push(path.join(conteudo.cerebro_dir, 'tools'));
      }
    }
  } catch { /* sem config ou corrompido */ }
  try {
    const pastaCfg = process.env.APPDATA ? path.join(process.env.APPDATA, 'meu-widget') : path.join(os.homedir(), '.config', 'meu-widget');
    const arqCfg = path.join(pastaCfg, 'config.json');
    if (fs.existsSync(arqCfg)) {
      const c = JSON.parse(fs.readFileSync(arqCfg, 'utf8').replace(/^\uFEFF/, ''));
      if (c && c.pastaInstalacao) pastas.push(path.join(c.pastaInstalacao, 'cerebro', 'tools'));
    }
  } catch { /* ignora */ }
  for (const p of pastas) {
    if (typeof p === 'string' && p) {
      if (fs.existsSync(path.join(p, 'cerebro.py'))) return p;
      if (fs.existsSync(path.join(p, 'tools', 'cerebro.py'))) return path.join(p, 'tools');
    }
  }
  return candidatos[0];
}
const caminhoScript = (nome = 'cerebro.py') => path.join(pastaTools(), nome);
// Se "python" não existir (ou for o atalho da Microsoft Store), tenta o "py -3" do Windows
const PYTHONS = process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];
const TIMEOUT = 20000;
const LIMITE_RESULTADOS = 12;
const MAX_RESUMO = 20000; // caracteres do corpo de um resumo
const NOME_ARQUIVO = /^(?:estado\/)?[\p{L}\p{N}._ -]{1,120}\.md$/u;
const PROJETO = /^[a-z0-9][a-z0-9-]{0,40}$/;

let pythonAtual = 0; // o que funcionou da última vez

// Executa o cerebro.py (ou outro script da mesma pasta, como o projetos.py; timeout em ms, 20 s por padrão). Sempre resolve (nunca rejeita) com um destes formatos:
//   { ok: true, dados, codigo }       saída JSON lida (codigo 1 = "validar" achou problemas)
//   { ok: false, tipo, erro }         tipo: semPython | semScript | semCerebro | demorou | erro
function executar(argumentos, entrada, nomeScript = 'cerebro.py', timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const script = path.isAbsolute(nomeScript) ? nomeScript : caminhoScript(nomeScript); // caminho completo ou script da pasta tools
    if (!fs.existsSync(script)) {
      resolve({ ok: false, tipo: 'semScript', erro: nomeScript + ' não encontrado (esperado em ' + script + ')' });
      return;
    }
    const tentar = (i) => {
      if (i >= PYTHONS.length) {
        resolve({ ok: false, tipo: 'semPython', erro: 'Python 3 não encontrado. Instale em python.org e marque "Add python.exe to PATH".' });
        return;
      }
      const [comando, ...antes] = PYTHONS[i];
      const filho = execFile(comando, [...antes, script, ...argumentos], {
        encoding: 'utf8',
        windowsHide: true,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      }, (erro, saida, saidaErro) => {
        // não achou esse Python (ou é o atalho da Store): tenta o próximo
        if (erro && (erro.code === 'ENOENT' || erro.code === 9009 || /Microsoft Store/i.test(saidaErro || ''))) {
          tentar(i + 1);
          return;
        }
        if (erro && erro.killed) {
          resolve({ ok: false, tipo: 'demorou', erro: 'o cérebro demorou mais de ' + timeout / 1000 + ' s e foi interrompido' });
          return;
        }
        pythonAtual = i;
        let dados = null;
        try { dados = JSON.parse(saida); } catch { /* sem JSON: é erro */ }
        if (dados !== null) {
          resolve({ ok: true, dados, codigo: erro ? erro.code : 0 });
          return;
        }
        const mensagem = (saidaErro || '').trim().split('\n').pop().replace(/^erro:\s*/, '') || (erro && erro.message) || 'sem resposta';
        resolve({ ok: false, tipo: erro && erro.code === 3 ? 'semCerebro' : 'erro', erro: mensagem });
      });
      filho.stdin.on('error', () => { /* o processo nem abriu: o callback acima já trata */ });
      filho.stdin.end(entrada === undefined ? undefined : String(entrada), 'utf8');
    };
    tentar(pythonAtual);
  });
}

const falhou = (erro) => Promise.resolve({ ok: false, tipo: 'erro', erro });
// texto da tela vira argumento: sem caracteres de controle e com tamanho limitado
const limpar = (t, max) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const projetoValido = (p) => (typeof p === 'string' && PROJETO.test(p) ? p : null);

// projetos, estatísticas e o resumo do estado do projeto (tudo que a aba mostra ao abrir)
function painel(projeto) {
  const p = projetoValido(projeto);
  return executar(['painel', '--json', ...(p ? ['--projeto=' + p] : [])]);
}

// Busca em 3 níveis do próprio cerebro.py (comando "buscar"); a tela só mostra o resultado
function buscar(texto, projeto) {
  const termos = limpar(texto, 200).split(' ').filter(Boolean).slice(0, 8).map((t) => t.slice(0, 40));
  if (!termos.length) return falhou('digite o que procurar');
  const p = projetoValido(projeto);
  // "--" antes dos termos: um termo começando com "-" não vira opção
  return executar(['buscar', '--json', '--com-palavras', '--limite=' + LIMITE_RESULTADOS, ...(p ? ['--projeto=' + p] : []), '--', ...termos]);
}

// Conteúdo completo de um arquivo do cérebro ("nome.md" ou "estado/nome.md")
function ler(arquivo) {
  if (typeof arquivo !== 'string' || !NOME_ARQUIVO.test(arquivo) || arquivo.includes('..')) return falhou('nome de arquivo inválido');
  return executar(['ler', '--json', '--', arquivo]);
}

// Grava um resumo colado pela tela (comando "salvar", que valida o formato e recusa o que estiver fora)
function salvar({ titulo, palavras, origem, projeto, corpo } = {}) {
  const resumo = String(corpo ?? '').slice(0, MAX_RESUMO);
  return executar([
    'salvar', '--json',
    '--titulo=' + limpar(titulo, 120),
    '--palavras=' + limpar(palavras, 300),
    '--origem=' + limpar(origem, 30),
    '--projeto=' + limpar(projeto, 60),
  ], resumo);
}

const validar = () => executar(['validar', '--json']);
const indice = () => executar(['indice', '--json']);
const config = () => executar(['config', '--json']);

// Define a pasta do cérebro (grava em ~/.cerebro.json, como "cerebro.py config --definir")
function definirPasta(caminho) {
  if (typeof caminho !== 'string' || !caminho || caminho.length > 500) return falhou('pasta inválida');
  let ok = false;
  try { ok = fs.statSync(caminho).isDirectory(); } catch { /* não existe */ }
  if (!ok) return falhou('essa pasta não existe');
  if (!fs.existsSync(path.join(caminho, 'conversas')) && !fs.existsSync(path.join(caminho, 'estado'))) {
    return falhou('essa pasta não parece um cérebro (faltam as pastas conversas e estado)');
  }
  return executar(['config', '--json', '--definir=' + caminho]);
}

// Caminho completo de um arquivo do cérebro, para abrir no editor (null se não existir)
async function caminhoDoArquivo(arquivo) {
  if (typeof arquivo !== 'string' || !NOME_ARQUIVO.test(arquivo) || arquivo.includes('..')) return null;
  const c = await config();
  if (!c.ok) return null;
  const [pasta, nome] = arquivo.includes('/') ? arquivo.split('/') : ['conversas', arquivo];
  const completo = path.join(c.dados.dir, pasta, nome);
  return fs.existsSync(completo) ? completo : null;
}

// Prompt para colar no fim de um chat de site (arquivo editável: cerebro/tools/prompt_compactacao.txt)
function promptCompactacao() {
  try { return fs.readFileSync(path.join(pastaTools(), 'prompt_compactacao.txt'), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}

// Nós e ligações do grafo 3D (grafo.py: só lê os cabeçalhos; ~1 s com 4.000 arquivos)
const grafo = () => executar(['--json'], undefined, 'grafo.py');

module.exports = { pastaTools, pastaRaizWidget, executar, painel, buscar, ler, salvar, validar, indice, config, definirPasta, caminhoDoArquivo, promptCompactacao, caminhoScript, grafo };
