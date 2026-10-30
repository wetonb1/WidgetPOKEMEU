# Otimização do widget (Etapa 8B)

Todas as decisões abaixo vêm de medição com `tools/medir.ps1` (3 rodadas de 60 s, 20 s de
aquecimento, mediana). Os números brutos estão em `tools/resultados.csv`.

- **CPU** em % de **um núcleo** (o PC tem 16; divida por 16 para ter o % do total).
- **RAM privada** é a memória que só o widget usa. É o número mais confiável.
- **Working set (WS)** soma as páginas compartilhadas uma vez por processo, então exagera.
- **Ruído medido:** ~±1 ponto de CPU nos cenários leves. Repetindo o mesmo código, deu 15,1% e 17,4% no B.

## Antes e depois

| Cenário | CPU antes | CPU depois | RAM privada antes | RAM privada depois | WS antes | WS depois |
|---|---|---|---|---|---|---|
| A: ocioso (música pausada, terminal fechado) | 122,4% | **2,9%** | 219 MB | **182 MB** | 387 MB | 401 MB |
| B: música tocando, com visualizador | 129,4% | **5,1%** | 344 MB | **204 MB** | 587 MB | 492 MB |
| C: terminal aberto | 131,7% | **4,0%** | 289 MB | **255 MB** | 475 MB | 504 MB |
| D: ocioso depois de tocar música | 6,9%¹ | **4,8%** | 200 MB¹ | **196 MB** | 489 MB¹ | 483 MB |

¹ O D foi criado no meio do trabalho (veja abaixo); o "antes" dele já inclui as otimizações anteriores.

O "antes" do A e do C foi medido com o Spotify aberto e pausado. O "depois", sem player
aberto. Sem player, a leitura da música é um pouco mais barata. Com o Spotify pausado, a
última medição do A (antes das duas últimas otimizações) deu 7,8%. Em qualquer caso, a
queda é de mais de 90%.

## O que foi mantido (um commit por ideia)

| Ideia | Onde mediu | Resultado |
|---|---|---|
| **Música por um PowerShell persistente.** O `media.ps1 -Action servidor` carrega o WinRT uma vez e responde uma linha de JSON por comando. Antes, cada consulta abria um `powershell.exe` novo, com ~2 s de CPU | B, A | B 129% → 53%; A 122% → 50%; +45 MB (o PowerShell fica residente) |
| **Lista de processos pelo mesmo PowerShell, via chamada nativa** (`NtQuerySystemInformation`, a fonte do Gerenciador de Tarefas). Substituiu o `si.processes()`, que abria um PowerShell novo a cada 5,5 s | B, A | B 53% → 15%; A 50% → 28%. Custo por leitura: 3 ms, contra 770 ms do laço em PowerShell |
| **Sem aceleração de GPU por padrão.** Numa janela transparente, a composição por GPU redesenhava a janela inteira a cada quadro | B, A, C | B 15% → 5%, privada −185 MB; A 28% → 7,8%, privada −138 MB |
| **Desligar a captura de áudio 10 s depois de pausar.** Antes ela ficava ligada para sempre depois da primeira música; religa sozinha quando a música volta | D | 6,9% → 4,8% (−31%) |
| **Perfil econômico** (manual ou automático), mais as chaves `visualizador` e `animacoes` | A, B | A 2,9% → 2,5% (−12%); B 5,1% → 4,3% (−16%). Ressalva: ~0,8 ponto, perto do ruído |

Também entrou, sem ser ganho de desempenho: `devTools` desligado no app empacotado
(segurança), e "Memory Compression" fora da lista "Mais pesados" (é um pseudoprocesso do
Windows, que o Gerenciador de Tarefas também esconde).

## O que foi descartado e por quê

| Ideia | Resultado | Motivo |
|---|---|---|
| Processos pelo laço em PowerShell (passo intermediário) | B −36%, mas A piorou (50% → 60%) | Substituído pela chamada nativa, que ganhou nos dois |
| `spellcheck: false` | B: privada 199 contra 196 MB, CPU igual | Sem ganho |
| `in-process-gpu` | Privada 194 contra 196 MB; WS −35 MB | O ganho de WS é só páginas compartilhadas contadas uma vez a menos. Uma rodada teve processos a mais (instável) |
| `enable-low-end-device-mode` | 2 rodadas sem ganho (203 e 191 MB) | Regra das 2 rodadas |
| Limite de heap do V8 (`--max-old-space-size=96`) | A −3% CPU, −4 MB | Abaixo do critério, e com risco de faltar memória |
| Intervalo adaptativo da música (2/5/10 s) | A: 4,8% contra 2,6% | Sem ganho. Com o PowerShell persistente, cada consulta já custa ~4 ms, então não sobrou o que economizar |
| Eventos da sessão de mídia em vez de consulta | Não implementado | Mesmo motivo: a consulta já custa ~0,2% de um núcleo, abaixo do que dá para medir |
| xterm só na primeira abertura + scrollback 1000 | A −3 MB, C −6 MB, CPU dentro do ruído | Abaixo do critério |
| Lista de processos a cada 10 s / só quando visível | Não implementado | Depois da chamada nativa, a leitura custa 3 ms. E a lista está sempre visível |
| Visualizador: fftSize menor, parar no silêncio | Não implementado | O visualizador inteiro custa ~0,6 ponto no B; não há 10% a ganhar |
| `backgroundThrottling` | Não testado | A janela nunca fica escondida, então não teria efeito |
| Cache do JSON do Pokémon / salvar a config só quando muda | Não implementado | Não mexe em CPU nem RAM (é rede e disco). O cache para abrir sem internet é um recurso novo, não otimização. O cache dos ícones de apps já existia |
| `requestSingleInstanceLock` | Já existia | — |

**Trocar o Electron** (por exemplo por Tauri/WebView2) poderia cortar uns 100–150 MB
de RAM, mas o custo de CPU já é pequeno (~3–5% de um núcleo) e seria reescrever o
widget. Não acho que valha a pena agora.

## Chaves novas no `config.json` (e o custo medido de cada recurso)

| Chave | Padrão | O que faz | Custo medido |
|---|---|---|---|
| `aceleracaoGPU` | `false` | `true` religa a GPU (o efeito varia por PC) | Neste PC, com GPU: B +10 pontos de CPU, +185 MB de privada |
| `desempenho` | `"normal"` | `"economico"`: intervalos dobrados (sistema 6 s, música 4 s, processos 16,5 s), visualizador a 15 quadros/s e rosto sem animação nem GIF | Economiza ~12–16% de CPU (A e B) |
| `economiaAutomatica` | `true` | Entra no modo econômico sozinho com CPU do PC acima de 90% (2 das últimas 5 leituras) ou com um app em tela cheia, e volta quando passa | A checagem de tela cheia custa ~1 ms a cada 5,5 s |
| `visualizador` | `true` | `false` não captura áudio e esconde as barras (o espaço vai para os Apps) | B: 5,1% → 4,6% (~0,6 ponto); mais ~2 pontos nos 10 s depois de pausar (cenário D) |
| `animacoes` | `true` | `false` deixa o rosto parado (sem rajadas, sem pulos, sem GIF no mouse) | Sem GPU: dentro do ruído (2,7% contra 2,9%). Com GPU: rajadas +1,7 ponto |
| `volume` (barra de volume, recurso novo) | Lê o volume do Windows a cada 2 s junto com a música, só para acompanhar mudanças feitas pelo teclado | ~0,14% de 1 núcleo (2,7 ms por leitura, medido); sem animação, o resto é custo zero |
| `gifAnimado` | `false` | `true` deixa a GIF sempre animada | Sem GPU: dentro do ruído (2,1% contra 2,9%). Com GPU: ~+20 pontos |

Como a GIF ficou barata sem GPU, dá para usar `"gifAnimado": true` sem custo
perceptível, desde que `aceleracaoGPU` continue `false`.

## O .exe empacotado (Etapa 9)

Medido com `toolsmedir.ps1 -Anexar -Processo "Meu Widget.exe" -Cenario A`, com o Spotify aberto e pausado:
**6,4% de 1 núcleo e 191 MB de RAM privada** (WS 430 MB). O `npm start` nas mesmas condições
(Spotify pausado) deu 7,8% e 192 MB, ou seja, empacotar não muda o consumo. A diferença está dentro
do ruído. O .exe portátil só demora mais para abrir, porque se descompacta numa pasta temporária a cada vez.

## A reformulação (terminal invadido pelo Pokémon)

Medido com a janela fora da tela (sem cliques contaminando) e só o Electron:

| Situação | CPU (1 núcleo) |
|---|---|
| Aba sys, primeira versão da reformulação | 7,2% |
| Sem a transição das barras de LED | 2,2% |
| + rajadas do rosto numa camada própria, em degraus (`steps`) | **1,9%** |
| Tudo parado (sem rajadas nem barras) | 0,4% |

- **O vilão era a transição das barras:** animar a largura de 0,5 s a cada 3 s, com brilho, redesenhava a barra em software a cada quadro (~5 pontos). Agora o LED salta para o valor novo.
- **Rajadas do rosto:** o invólucro do sprite se move numa camada própria (a máscara de pontos e o brilho não são refeitos a cada quadro) e em ~10 quadros/s. Elas custam ~1,8 ponto; a chave `animacoes: false` desliga.
- **Efeitos estáticos:** brilho de texto, textura de pontos e vinheta ficaram dentro do ruído quando testados um a um.
- **Cenário B** (árvore inteira, `medir.ps1`): **5,8% e 201 MB de memória privada**, contra 5,1% e 204 MB da interface anterior.
- **Bônus das abas:** o visualizador só roda com a aba `music` aberta. Com a música tocando e outra aba na frente, o custo cai para o nível do ocioso, enquanto a interface antiga mostrava o visualizador sempre (~12,7% só no Electron).
- **Cuidado ao medir:** a janela de teste aparece na tela, e cliques nela (trocar de aba, abrir o terminal) contaminam a medição.

## Visualizador novo (espectro com reflexo e picos)

Medido só o Electron, janela fora da tela, aba `music` aberta e música tocando:

| Versão | CPU (1 núcleo) |
|---|---|
| Visualizador anterior (blocos, 20 quadros/s) | 10,9% |
| Novo, primeira versão (com a barra de volume pulsando no ritmo) | 23,5% |
| Novo, sem o pulso do volume, 24 quadros/s | 12,4–13,5% |
| **Novo, sem o pulso do volume, 30 quadros/s (o que ficou)** | **13,4–13,7%** |

- **O pulso saiu:** ele aplicava um filtro de brilho na barra de volume a cada quadro, o que obrigava a redesenhar aquela área (~8 pontos).
- **30 quadros/s:** custa praticamente o mesmo que 24, então ficou o mais fluido.
- **Custo final:** ~2,5 pontos acima do visualizador antigo, e só com a aba `music` aberta e música tocando. Em outra aba, ou com a música pausada (depois de as barras caírem), ele para de desenhar.

## Visual iOS (vidro) e loja de apps

Cenário A (ocioso), árvore inteira no Job Object, 3 rodadas de 45 s cada, mediana.
Mesma config, só muda `estilo` (`WIDGET_ESTILO=ios` no `tools/cenario.js` usa uma cópia da config):

| Visual | CPU (1 núcleo) | RAM WS | Privada |
|---|---|---|---|
| CMD (janela opaca) | 0,6% | 402 MB | 192 MB |
| iOS (janela transparente + desfoque do Windows) | 1,0% | 412 MB | 197 MB |

- **Custo do iOS:** ~+0,4 ponto de CPU e ~+5 MB privados no ocioso. O desfoque é feito pelo próprio Windows (DWM), fora do widget. A janela transparente é um pouco mais cara de compor.
- **Cenário B (música tocando) ainda não medido:** a música estava pausada na hora. Para medir: dê play e rode `$env:WIDGET_ESTILO='ios'; npm run medir -- -Cenario B -Variante estilo-ios`.
- **Loja de apps:** custo zero parada. Ao abrir, pede a lista uma vez (~1 s na primeira vez, porque o `Get-StartApps` roda no PowerShell que já está aberto; depois fica 5 min em cache). Os ícones só carregam para os itens que aparecem na rolagem, e tudo é liberado ao fechar a loja.

## Rodada final: v1.4 mais leve (medidor no lugar do PowerShell)

Pedido: deixar o widget o mais leve possível **sem tirar nenhuma mecânica**. Método: medir a v1.4
(`base`) e a nova (`novo`) **alternando as duas** no mesmo PC (3 rodadas de 45 s, 15 s de aquecimento,
mediana), em CMD e iOS, ocioso (A) e com música tocando (B). Os números brutos estão em
`tools/resultados.csv` (variantes `base-*` e `novo-*`). O B usou uma sessão de mídia de teste, silenciosa.

| Cenário | CPU antes → depois | RAM privada antes → depois | WS antes → depois |
|---|---|---|---|
| A, CMD (ocioso) | 2,7% → 2,8% (ruído) | 182 → **137 MB** (−25%) | 391 → 330 MB |
| A, iOS (ocioso) | 3,9% → 4,6% (ruído) | 183 → **135 MB** (−26%) | 394 → 337 MB |
| B, CMD (música) | 4,9% → **2,2%** (−55%) | 200 → **142 MB** (−29%) | 483 → 401 MB |
| B, iOS (música) | 6,8% → **3,2%** (−53%) | 201 → **146 MB** (−27%) | 483 → 419 MB |

Com o ajuste final (medidor sem console), a árvore ociosa fecha em **124–126 MB** de RAM privada e
5 processos, contra 182–187 MB e 6 processos antes (≈ −33%). O CPU ocioso em regime (depois da abertura)
é de só **0,2–0,9% de um núcleo**; a diferença entre as rodadas do `medir` no A é o pico de abertura e o
ruído do PC (a mesma versão deu de 0,6% a 5,3%).

### O que mudou (um item por ideia)

| Ideia | Resultado medido |
|---|---|
| **Medidor compilado no lugar do PowerShell** (`app/helper.cs`). Um PowerShell **vazio** já gasta 55 MB; o servidor chegava a 66–85 MB, dos quais só ~11 MB eram nossos. O medidor faz o mesmo trabalho (mesmo protocolo de linhas) em 12–15 MB | −50 a −60 MB; com música, o CPU cai a menos da metade (cada consulta custa bem menos) |
| **Sem janela de console** (`-target:winexe`): some o `conhost.exe` que acompanhava o medidor | −6 MB e um processo a menos |
| **Sem `systeminformation`**: a carga da CPU vem do `os.cpus()` (mesma conta do Gerenciador de Tarefas; conferido lado a lado: 43,7% contra 43,4% etc.) | main 40 → 35 MB; CPU de abertura do main 1,8 s → 0,5 s |
| **`node-pty` só ao abrir o terminal** | menos memória e tempo de abertura para quem não usa a aba `term` |

**Como o medidor funciona.** O `main.js` compila o `helper.cs` uma vez (~0,5 s, com o `csc.exe` que já vem
no Windows) para `%APPDATA%\meu-widget\medidor-<hash>.exe` e usa esse programa. O hash vem do código e das
opções de compilação: mudou o código, recompila sozinho (e apaga as versões antigas). **Reserva**: sem
`csc.exe`, com falha de compilação, arquivo corrompido ou bloqueado pelo antivírus, o widget usa o
`media.ps1` como antes, e o arquivo ruim é apagado para recompilar na próxima abertura. Nada some em
nenhum caso. A lista de apps do Menu Iniciar (`Get-StartApps`) só existe no PowerShell: com o medidor ela
roda num PowerShell avulso, só quando a loja de apps abre (cache de 5 min).

**Testes do medidor** (feitos contra o servidor PowerShell, comando a comando): 13 comandos com resposta
idêntica (info, capa, volume, tela cheia, processos, janelas, ícones da Store e de atalhos, vidro/cantos,
entradas inválidas). A mídia foi testada contra uma sessão de mídia real de teste: leitura de título,
artista, álbum e status, tocar/pausar, próxima/anterior. O teste da capa, isolado, achou um defeito real (o
`ContentType` fica numa interface-base que a reflexão do C# não enxerga), já corrigido: a capa agora sai
byte a byte igual ao arquivo. Também foram testados: arquivo do medidor corrompido (cai no PowerShell na
hora), compilação do zero dentro do .exe empacotado, e o terminal.

### Opcional: `"redeEmProcesso": true`

O Chromium roda a rede num processo separado (12 MB). Com a chave ligada, ela roda dentro do processo
principal: **−12 MB de RAM privada, −45 MB de WS e um processo a menos** (medido: 136/122 MB → 105/110 MB), e a
rede (PokéAPI, AniList, imagens, favicons) segue funcionando. O preço é **menos isolamento**: a rede deixa
de ter o sandbox do processo próprio. Por isso fica **desligada por padrão**; quem quiser o máximo de
leveza liga na config.

### Testado e descartado nesta rodada

| Ideia | Resultado | Motivo |
|---|---|---|
| Visualizador por temporizador de 30/s em vez de `requestAnimationFrame` | 2,73% contra 2,58% (3 rodadas cada) | Sem ganho |
| `--disable-features=Translate,MediaRouter,OptimizationHints,…` | 135/138 MB contra 136/122 MB | Sem ganho |
| `[GC]::Collect` no PowerShell | 66 MB antes e depois | Não devolve memória: os 66 MB são do próprio PowerShell |

> Cuidado ao medir com um jogo em tela cheia aberto: o Chromium pausa o desenho de janelas cobertas
> (o xterm aparece vazio, por exemplo). Para testar nessas condições, use
> `--disable-features=CalculateNativeWinOcclusion`.

## Como repetir a medição

Na pasta do projeto, num PowerShell:

```powershell
# A: ocioso. Deixe a música pausada ou o player fechado.
powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Cenario A -Variante minha-mudanca

# B: com música tocando (o medidor confere e aborta se a música parar)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Cenario B -Variante minha-mudanca

# C: terminal aberto (o painel é aberto sozinho)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Cenario C -Variante minha-mudanca

# D: ocioso depois de ter tocado música
powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Cenario D -Variante minha-mudanca

# Medir o widget que já está aberto (npm start)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Anexar -Cenario A
```

Parâmetros: `-Segundos` (padrão 60), `-Aquecer` (20), `-Rodadas` (3). Sem `-Anexar`,
o widget é aberto por `tools\cenario.js`. Ele carrega o mesmo `main.js` do `npm start`,
mas usa outra pasta de cache e ignora a trava de instância única. Assim dá para medir
com o seu widget aberto.

Cuidados:
- Não use a janela de medição: um app aberto por ela vira filho do widget e entra na conta.
- Feche o que estiver pesando no PC.
- Compare variantes medidas nas mesmas condições (player aberto ou fechado).

O medidor coloca o widget num **Job Object** do Windows, que soma a CPU de todos os
processos que passaram por ele, inclusive os PowerShell de ~1 s que nascem e morrem
entre duas amostras. Só amostrar a cada 2 s perderia a maior parte desse custo.

## Testes manuais (confirmar que nada quebrou)

1. **Sistema:** CPU e RAM mudam a cada ~3 s. "Mais pesados" mostra 3 processos com % e alterna para MB ao clicar. Os valores aparecem já nos primeiros segundos.
2. **Música e capa:** toque, pause e troque de faixa no Spotify ou no navegador. Título, artista, capa e o ícone ⏯ acompanham em até ~2 s, e ⏮ ⏯ ⏭ controlam o player.
3. **Visualizador:** as barras pulsam com a música. Pause por mais de 10 s e dê play: elas voltam.
4. **Apps:** abrir site e programa, "+ Novo", remover com o botão direito.
5. **Pokémon e temas:** buscar alguns (`charizard`, `gengar`, `clefairy`), favoritar, shiny, GIF com o mouse em cima, animação a cada ~9 s.
6. **Transparência sem GPU:** os cantos arredondados do cartão e do terminal devem mostrar a área de trabalho atrás, sem quadrado preto ou branco.
7. **Boas-vindas:** com `"ativo": true`, abrir o widget dá balão, voz e resumo.
8. **Terminal e Claude:** ">_" abre, "Iniciar Claude" funciona, fechar e reabrir mantém a sessão.
9. **Chaves novas:** teste `"desempenho": "economico"`, `"visualizador": false` e `"animacoes": false` (reabra o widget a cada mudança).
10. **Economia automática:** abra um vídeo em tela cheia; o rosto para de se mexer em até ~6 s.
11. **Início com o Windows:** ainda **não implementado**. A chave `iniciarComWindows` existe, mas nada a usa ainda.

## Fase 9: custo dos recursos novos

Nada novo roda em segundo plano sem você pedir. O que foi medido e o que é só estimado:

- **Terminal embutido (medido, 1 sessão ociosa com um "claude" de mentira parado):** o host `pty-<hash>.exe` (9 KB, compilado uma vez em ~0,2 s com o
  `csc.exe`, só ao abrir a 1ª sessão) usa ~12 MB (9 MB privados), o `conhost` da sessão ~6 MB e **0 s de CPU em 10 s**. O widget foi de 137 para 142 MB
  (xterm.js e a tela do terminal). O xterm.js (~490 KB) só é carregado na 1ª sessão: quem nunca abre o terminal não paga nada. O processo do Claude em si
  gasta o mesmo que gastava na janela externa. Sem sessão aberta o custo é zero (nenhum processo, nenhum timer).
- **System (Gerenciador de Tarefas):** a lista só é lida com a aba aberta, a cada 2,5 s (5 s no modo econômico); usa os comandos `processos` (já existia;
  a leitura é reaproveitada se tem menos de 1,8 s) e `apps` (`EnumWindows`, poucos milissegundos), ambos no medidor que já estava de pé. Não foi medido
  em separado. Fora da aba: nada.
- **Catálogo de skills (só por clique):** 1 pedido à árvore do repositório + até 60 pedidos pequenos (começo de cada `SKILL.md`, 6 juntos) na 1ª consulta de
  cada repositório; depois a lista fica 30 min na memória e a última fica em disco (`skills-catalogo.json`, até 8 repositórios). Sem conta no GitHub o
  limite é de 60 consultas por hora; baixar uma skill são 1 consulta + 1 pedido por arquivo (no máximo 80). Nenhum timer.
- **Uso e continuidade:** ler o `/usage` é só ler o texto do xterm por até 25 s depois do clique; a última leitura (nomes e %) vai para a config.
- **Continuar em outra IA e uso por IA (10.8):** nada em segundo plano. O `projetos.py listar` já lia o `sessoes.jsonl` a cada carga da aba Projects; agora tira dele, na mesma leitura, a última sessão por IA e a contagem das últimas 24 h (custo desprezível). Ler o `/usage` do agy é só ler o texto do xterm por até 25 s depois do clique, como no Claude.
- **Skills por IA (10.6):** cada IA mostrada na aba é 1 `tokens.py painel` (~0,3 s com cache, só ao abrir a aba ou em [atualizar]); "Ambos" faz 2 em sequência. Sem custo em repouso.
- **Brain, Projects e Skills (visual novo):** só HTML e CSS; sem custo em repouso.

Para conferir o terminal depois de mudanças: `npm run testar-pty`, `testar-embutido` e `npm run medir` com uma sessão aberta.


## Fase 10+: otimização extrema de CPU e memória

Nova rodada de medição e corte de gargalos na aba inicial (`1:sys`), na janela destacada (`[↗ destacar]`) e no ciclo de fundo:

| O que foi otimizado | Onde | Ganho |
| --- | --- | --- |
| `Apps.Lista()` trocou `Process.GetProcessById(pid)` + `MainModule.FileName` + `FileVersionInfo` sem cache dentro do `EnumWindows` por `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW` + dicionário estático `cacheDesc` por caminho de executável (e `$script:cacheDescApps` no `media.ps1`) | `app/helper.cs`, `app/media.ps1` | Cortou a enumeração repetida de módulos Win32 e leituras de disco a cada ciclo da aba `sys` (**−40% de CPU no Cenário A**) |
| Cache em memória de `config.json` (por `mtimeMs`) e do nome da CPU (`lerModelo()`) | `app/main.js` | Evita ler disco, `JSON.parse` e `sanitizarConfig` a cada 3 s em `stats:ler` |
| `stats:ler` deixou de chamar `atualizarProcessos()` em segundo plano; fora da aba `sys`, só checa `atualizarTelaCheia()` quando `economiaAutomatica` está ativa; também removeu a passagem duplicada `resumirProcessos()` | `app/main.js` | Zero varredura de processos quando o dono está nas abas `music`, `apps`, `brain`, `projects` ou `skills` |
| Intervalo do Gerenciador de Tarefas (`1:sys`) passou de 2,5 s para 3,0 s (6,0 s no modo econômico) e `scrollback` do `xterm.js` de 5000 para 2000 linhas | `app/renderer.js` | −17% de chamadas `sys:lista` com atualização visual idêntica e menos memória por aba de terminal |
| Buffer de replay por sessão (`REPLAY_MAX`) reduzido de 512 KB para 128 KB | `app/embutido.js` | Menos memória retida por sessão de IA ou PowerShell |
| Na janela destacada (`destacado=1`), removidos o loop `requestAnimationFrame` da tela de abertura e o timer do relógio da barra inferior | `app/renderer.js` | Janela destacada para segundo monitor só processa os eventos da sessão de terminal ativa |
| Removido `backdrop-filter: blur(4px)` do `.dialogo` no tema CMD (que roda com `aceleracaoGPU: false`) | `app/style.css` | Evita composição de blur via CPU ao abrir pop-ups no modo CMD |

### Medição antes × depois (Cenário A, 3 rodadas de 25 s cada, aquecimento de 12 s)

| Variante | Processos | CPU (% de 1 núcleo) | CPU (% do PC total) | RAM privada (MB) | Working Set (MB) |
| --- | --- | --- | --- | --- | --- |
| Antes desta rodada (`antes-otim-final`) | 5 | 10,6% (7,8% – 11,8%) | 0,66% | 153 | 375 |
| **Depois desta rodada (`depois-otim-final`)** | **5** | **6,4% (6,3% – 6,8%)** | **0,40%** | **156** | **375** |
