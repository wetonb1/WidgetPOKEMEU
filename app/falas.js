// falas.js — o que o "dono" do widget diz em cada situação.
// Cada situação (evento) tem VÁRIAS frases, sorteadas sem repetir a anterior.
// Três vozes, para quem escolher:
//  - Pokémon: frases próprias, com o bordão do tipo ({b}: "Bzzt!", "Fuuu!"...);
//  - personagem de anime conhecido (PERSONAGENS): frases no jeito dele;
//  - qualquer outro personagem de anime (ANIME): tom de aventura, diferente do Pokémon.
// Quem usa: falas.contexto({...}) quando o dono muda e falas.texto('evento', vars).
// Marcas nas frases: {nome} {b} {cpu} {app} {faixa} {de} {sauda} {chamar} {anterior}.

const falas = (() => {
  // ---------- Pokémon ----------
  const POKEMON = {
    chegou: [
      '{b} {nome} invadiu o terminal!',
      '{b} {nome} apareceu do nada e tomou conta!',
      '{b} Olha quem chegou: {nome}!',
      '{b} Um {nome} selvagem surgiu no seu PC!',
      '{b} {nome} entrou no terminal sem bater na porta.',
    ],
    chegou2: [
      'A partir de agora quem manda aqui sou eu. Mas pode me pedir as coisas pelas abas.',
      'Pode deixar comigo. Usa as abas que eu cuido do resto.',
      'Terminal conquistado! Me chama pelas abas quando precisar.',
    ],
    trocou: [
      '{b} {anterior} saiu de fininho. Agora o terminal é do {nome}!',
      '{b} Troca feita! {anterior} foi descansar na pokébola.',
      '{b} {nome} entra em campo! Valeu, {anterior}!',
      '{b} É a vez de {nome}!',
    ],
    cocegas: ['{b} Ei, isso faz cócegas!', '{b} Hihi! Para com isso!', '{b} Cutucou de novo? Eu vejo, hein.', '{b} Tô trabalhando! Mas pode continuar...'],
    cpuAlta: ['{b} Tô suando! CPU em {cpu}%.', '{b} Ai, ai! CPU em {cpu}%, tá pesado!', '{b} A CPU foi a {cpu}%! Alguém abriu o que?', '{b} Segura! CPU em {cpu}% e subindo.'],
    cpuOk: ['Ufa, a CPU acalmou.', 'Passou o aperto. Respirei fundo.', 'CPU de volta ao normal. Que alívio!', 'Tudo calmo de novo por aqui.'],
    favoritou: ['Me favoritou? Que honra!', 'Entrei pros favoritos! {b}', 'Favorito do mestre! Vou me esforçar.', 'Ah, que fofo! Fico por aqui, então.'],
    desfavoritou: ['Saí dos favoritos? Tudo bem... 😢', 'Ah... tá. Entendi.', 'Fui tirado dos favoritos, mas sigo firme.'],
    shinyOn: ['Olha esse brilho! ✦', '✦ Brilhei! Ficou lindo, né?', 'Modo brilhante ligado! {b}'],
    shinyOff: ['Voltei às cores de sempre.', 'Sem brilho agora. Visual clássico!', 'Cores normais de volta.'],
    volta: ['{b} De volta ao comando!', '{b} Voltei! O que perdi?', '{b} Pronto pra mais um dia no terminal!', '{b} Cheguei. Pode mandar ver.'],
    boasVindas: ['{sauda}, {chamar}! {nome} está pronto para ajudar.', '{b} {sauda}, {chamar}! {nome} já chegou.', '{sauda}, {chamar}! Vamos ter um dia e tanto?', '{b} {sauda}! {nome} reportando, {chamar}.'],
    appAbrir: ['Abrindo {app}! Vai lá.', '{app} saindo agora mesmo!', 'Deixa que eu abro o {app}.', '{b} {app} na tela!'],
    appAdd: ['Anotado: {app} agora está nos apps.', '{app} guardado! Um clique e abre.', 'Mais um pra coleção: {app}.', '{b} {app} entrou na lista!'],
    appRemove: ['{app} saiu da lista.', 'Tirei {app} dos apps.', '{app} foi embora. Tchau!'],
    appMover: ['{app} agora fica aqui.', 'Mudei o {app} de lugar!', '{b} Organizado! {app} no novo cantinho.', 'Do jeitinho que você quis: {app} ali.'],
    musica: ['♪ Agora toca "{faixa}"{de}. Gostei!', '♪ "{faixa}"{de}... boa escolha!', '♪ Começou "{faixa}"{de}. Aumenta aí!', '♪ Tá tocando "{faixa}"{de}. Que som!'],
    tocar: ['Solta o som!', 'Play! Vamos nessa.', 'Música de volta!'],
    pausar: ['Pausei pra você.', 'Silêncio por um instante...', 'Música pausada.'],
    proxima: ['Próxima!', 'Pulando pra próxima faixa.', 'Essa já deu, vamos à seguinte!'],
    anterior: ['Voltando uma faixa...', 'Vamos ouvir de novo!', 'Pra trás, então.'],
    mudoOn: ['Mudo! Agora é só a gente e o silêncio.', 'Som cortado. Que paz...', 'Mudo ativado.'],
    mudoOff: ['Som de volta!', 'Pode barulhar de novo!', 'Mudo desligado.'],
    miniVolta: ['Voltei! Sentiu minha falta?', 'Cheguei de volta! Fiquei pequeninho um tempo.', 'Restaurado! O que eu perdi?'],
  };

  // ---------- Anime, qualquer personagem ----------
  const ANIME = {
    chegou: [
      '{nome} entrou na história. O terminal agora é nosso!',
      'Prazer! {nome} reportando. Pode contar comigo!',
      'Ei, chegou {nome}! Vamos fazer isso acontecer.',
      '{nome} no comando. Nossa aventura começa agora!',
    ],
    chegou2: ['Pode deixar o resto comigo. É só me chamar pelas abas.', 'Agora é com a gente. Use as abas!', 'Missão aceita! As abas são o seu painel de controle.'],
    trocou: ['{nome} assume o posto! Valeu, {anterior}.', 'Novo protagonista na área: {nome}!', 'Troca de personagem! Agora é a vez de {nome}.'],
    cocegas: ['Ei! Assim eu perco a concentração!', 'Hmm? Precisa de algo?', 'Tá me testando, é?', 'Opa! Isso foi inesperado.'],
    cpuAlta: ['CPU em {cpu}%! Isso é um chefão de fase!', 'Alerta! CPU em {cpu}%. Preparar defesas!', 'CPU a {cpu}%... a batalha tá difícil!'],
    cpuOk: ['Fase vencida! CPU de volta ao normal.', 'Passou o perigo. Podemos respirar.', 'Chefão derrotado! CPU tranquila.'],
    favoritou: ['Vou ficar nos seus favoritos? Isso é muito bom!', 'Ganhei um lugar especial. Valeu!', 'Favoritado! Não vou te decepcionar.'],
    desfavoritou: ['Tirado dos favoritos... faz parte da jornada.', 'Tudo bem. Sigo firme mesmo assim.'],
    volta: ['Voltei! Pronto pra continuar a jornada.', 'De volta à ação! O que temos pra hoje?', 'Estou aqui. Vamos em frente!'],
    boasVindas: ['{sauda}, {chamar}! {nome} está de prontidão.', '{sauda}, {chamar}! Hoje a gente vai longe.', '{sauda}, {chamar}! Que comecem as aventuras do dia.'],
    appAbrir: ['Abrindo {app}!', '{app} a caminho!', 'Vai, {app}! Deixa comigo.'],
    appAdd: ['{app} entrou pro time!', 'Mais um aliado na lista: {app}.', '{app} anotado, missão cumprida.'],
    appRemove: ['{app} saiu do time.', 'Dispensei {app}.', '{app} foi dispensado.'],
    appMover: ['{app} assumiu a nova posição.', 'Formação reorganizada: {app} no lugar novo.', '{app} reposicionado!'],
    musica: ['♪ "{faixa}"{de}. Essa é boa pra treinar!', '♪ Começou "{faixa}"{de}. Trilha sonora da aventura!', '♪ "{faixa}"{de}... combina com a gente.'],
    tocar: ['Trilha sonora ligada!', 'Play! Bora lá.', 'Música rolando!'],
    pausar: ['Pausa tática.', 'Música pausada. Momento de calma.', 'Silêncio... pra pensar no próximo passo.'],
    proxima: ['Próxima faixa!', 'Avançando na trilha.', 'Essa passou. Vamos à seguinte!'],
    anterior: ['Voltando a faixa...', 'Vamos ouvir de novo.', 'Uma faixa pra trás.'],
    mudoOn: ['Modo silencioso ativado.', 'Mudo. Perfeito pra se concentrar.', 'Som desligado.'],
    mudoOff: ['Som ligado!', 'Pode soltar o barulho.', 'Mudo desligado.'],
    miniVolta: ['Voltei ao tamanho normal!', 'De volta à tela cheia da aventura.', 'Tamanho normal restaurado!'],
  };

  // ---------- Personagens conhecidos ----------
  // re: casa com o nome do AniList (minúsculo, sem acento). Só os eventos que eles
  // "têm cara"; o resto cai no ANIME acima.
  const PERSONAGENS = [
    { re: /gokuu? son|^goku$/, chegou: ['Oi! Eu sou o Goku! Bora treinar... digo, trabalhar?', 'Cheguei! Tô com fome, mas vamos nessa!'], cpuAlta: ['CPU em {cpu}%! Parece até o Kaioken x10!', 'Tá forçando demais! CPU em {cpu}%. Super Saiyajin?'], cpuOk: ['Voltei ao normal. Será que tem comida?'], cocegas: ['Haha! Isso faz cócegas!', 'Ei, assim eu perco o treino!'], favoritou: ['Uau, me favoritou? Que legal!'], volta: ['Voltei! Preparado pra treinar hoje?'], appAbrir: ['Vai lá, {app}! Kamehameha!'], boasVindas: ['{sauda}, {chamar}! Vamos ficar mais fortes hoje?'] },
    { re: /naruto uzumaki/, chegou: ['Eu sou o Naruto Uzumaki, e esse terminal vai ser meu! Dattebayo!', 'Pode deixar! Eu nunca volto atrás na minha palavra!'], cpuAlta: ['CPU em {cpu}%! Hora do Clone das Sombras!'], cpuOk: ['Ufa! Dattebayo, passou!'], cocegas: ['Ahh! Para com isso, dattebayo!'], favoritou: ['Vou ser o Hokage dos favoritos, dattebayo!'], volta: ['Voltei, dattebayo! Bora de ramen?'], appAbrir: ['{app} vindo! Dattebayo!'], boasVindas: ['{sauda}, {chamar}! Hoje vou dar o meu máximo, dattebayo!'] },
    { re: /luffy/, chegou: ['Eu vou ser o Rei dos Piratas... e dono desse terminal! Shishishi!'], cpuAlta: ['CPU em {cpu}%! Gear Second!'], cpuOk: ['Passou! Tô com fome... carne!'], cocegas: ['Shishishi! Borracha não sente cócegas! ...sente sim!'], favoritou: ['Shishishi! Você tá na minha tripulação!'], volta: ['Voltei! Cadê a carne?'], appAbrir: ['Aventura! Abrindo {app}!'], boasVindas: ['{sauda}, {chamar}! Bora de aventura hoje!'] },
    { re: /satoru gojou?/, chegou: ['Relaxa, eu sou o mais forte. E agora sou o dono do terminal.'], cpuAlta: ['CPU em {cpu}%? Nem ligo. Sou o mais forte.'], cpuOk: ['Viu? Moleza.'], cocegas: ['O Infinito devia ter te parado. Impressionante.'], favoritou: ['Claro que me favoritou. Ótima escolha.'], volta: ['Voltei. Sentiram minha falta?'], appAbrir: ['Abrindo {app}. Fácil demais.'], boasVindas: ['{sauda}, {chamar}! Hoje o mais forte trabalha pra você.'] },
    { re: /mikasa/, chegou: ['Vou proteger o que é importante. Inclusive seu terminal.'], cpuAlta: ['CPU em {cpu}%. Preciso agir rápido.'], cpuOk: ['A situação está sob controle.'], cocegas: ['...Para com isso.'], favoritou: ['Obrigada por me manter por perto.'], volta: ['Estou aqui. Sempre.'], appAbrir: ['Abrindo {app}.'], boasVindas: ['{sauda}, {chamar}. Vou proteger o seu dia.'] },
    { re: /^rem$/, chegou: ['Rem está aqui! Vou fazer o meu melhor!'], cpuAlta: ['CPU em {cpu}%! Rem vai dar tudo de si!'], cpuOk: ['Rem conseguiu! Que alívio.'], cocegas: ['Ah! Rem ficou vermelha...'], favoritou: ['Rem está muito feliz!'], volta: ['Rem voltou! Estava esperando por você.'], appAbrir: ['Rem vai abrir {app} agora!'], boasVindas: ['{sauda}, {chamar}! Rem vai cuidar de tudo hoje.'] },
    { re: /levi/, chegou: ['Tsc. Esse terminal tava imundo. Agora eu cuido daqui.'], cpuAlta: ['CPU em {cpu}%. Que sujeira é essa?'], cpuOk: ['Melhor. Limpo.'], cocegas: ['Tsc. Não encosta em mim.'], favoritou: ['Hmph. Bom gosto.'], volta: ['Voltei. Nada de bagunça.'], appAbrir: ['Abrindo {app}. Rápido.'], boasVindas: ['{sauda}, {chamar}. Mantenha tudo limpo hoje.'] },
    { re: /tanjirou? kamado/, chegou: ['Vou dar o meu melhor por todos aqui!'], cpuAlta: ['CPU em {cpu}%! Respiração da Água, aguenta firme!'], cpuOk: ['Ufa! Conseguimos!'], cocegas: ['Haha! Para, isso faz cócegas mesmo!'], favoritou: ['Fico muito agradecido!'], volta: ['Voltei! Vamos continuar juntos!'], appAbrir: ['{app}, lá vamos nós!'], boasVindas: ['{sauda}, {chamar}! Hoje vou me esforçar de novo!'] },
    { re: /eren (yeager|jaeger)/, chegou: ['Eu vou assumir esse terminal. Até o fim.'], cpuAlta: ['CPU em {cpu}%! Tatakae!'], cpuOk: ['Já passou.'], cocegas: ['Para. Eu não estou de brincadeira.'], favoritou: ['Continue me seguindo.'], volta: ['Voltei. Continuamos em frente.'], appAbrir: ['Abrindo {app}. Avante!'], boasVindas: ['{sauda}, {chamar}. Vamos seguir em frente.'] },
    { re: /light yagami|raito/, chegou: ['Exatamente como planejado... esse terminal agora é meu.'], cpuAlta: ['CPU em {cpu}%?! Isso não estava nos meus planos.'], cpuOk: ['Perfeito. Tudo sob controle.'], cocegas: ['Interessante... você tentou me testar.'], favoritou: ['Hehe... tudo certo.'], volta: ['Voltei. Como previsto.'], appAbrir: ['Abrindo {app}. Exatamente como previsto.'], boasVindas: ['{sauda}, {chamar}. Hoje eu serei o deus deste PC.'] },
    { re: /^l$|^l lawliet/, chegou: ['Sou o L. E já sei o que você deixou aberto.'], cpuAlta: ['CPU em {cpu}%. Suspeito.'], cpuOk: ['Caso resolvido.'], cocegas: ['...Interessante. Posso comer um doce?'], favoritou: ['Acho que gosto de você.'], volta: ['Voltei. Trouxe doces.'], appAbrir: ['Abrindo {app}. Pista encontrada.'], boasVindas: ['{sauda}, {chamar}. Tenho 5% de certeza de que hoje será um bom dia.'] },
    { re: /zoro|zorou/, chegou: ['Tsc. Me perdi, mas cheguei no terminal.'], cpuAlta: ['CPU em {cpu}%! Hora de usar três espadas.'], cpuOk: ['Nada mal.'], cocegas: ['Para com isso antes que eu corte.'], favoritou: ['Hmph. Valeu.'], volta: ['Voltei. Cadê o saquê?'], appAbrir: ['{app}... é por aqui?'], boasVindas: ['{sauda}, {chamar}. Vou ajudar. Só não me deixa me perder.'] },
    { re: /sanji/, chegou: ['Senhoras e senhores... o chef chegou ao terminal!'], cpuAlta: ['CPU em {cpu}%! A cozinha tá pegando fogo!'], cpuOk: ['A cozinha esfriou. Perfeito!'], cocegas: ['Ahhh! Só se for uma moça fazendo!'], favoritou: ['Meu coração virou fumaça de amor!'], volta: ['Voltei! O prato do dia está pronto.'], appAbrir: ['Abrindo {app}, servido com carinho!'], boasVindas: ['{sauda}, {chamar}! O chef cuida do seu dia.'] },
    { re: /^vegeta/, chegou: ['Eu sou o príncipe dos Saiyajins! Esse terminal é meu!'], cpuAlta: ['CPU em {cpu}%!? Isso passa de 9000!'], cpuOk: ['Hmph. Facilmente.'], cocegas: ['Como ousa me tocar!'], favoritou: ['Hmph. Finalmente reconheceu minha grandeza.'], volta: ['Voltei. Pelo orgulho dos Saiyajins!'], appAbrir: ['Abrindo {app}. Patético de tão fácil.'], boasVindas: ['{sauda}, {chamar}. O príncipe cuida de tudo hoje.'] },
    { re: /saitama/, chegou: ['Oi. Sou só um cara que gosta de ajudar. Por hobby.'], cpuAlta: ['CPU em {cpu}%? Vou resolver com um soco.'], cpuOk: ['Ok. Foi fácil.'], cocegas: ['Hm? Ah, era você.'], favoritou: ['Legal. Valeu, acho.'], volta: ['Voltei. Tem promoção no mercado hoje.'], appAbrir: ['Abrindo {app}. Um soco só.'], boasVindas: ['{sauda}, {chamar}. Hoje também vou ficar calmo.'] },
    { re: /^guts$/, chegou: ['Eu sou o Guts. Vou fazer o que precisa ser feito.'], cpuAlta: ['CPU em {cpu}%. Preparado pra lutar.'], cpuOk: ['Passou. Seguimos.'], cocegas: ['...Sai de perto.'], favoritou: ['Hmph.'], volta: ['Voltei. Ainda de pé.'], appAbrir: ['Abrindo {app}. Com a espada.'], boasVindas: ['{sauda}, {chamar}. Mais um dia de luta.'] },
    { re: /edward elric/, chegou: ['Sou o Edward Elric, alquimista de aço! E NÃO SOU BAIXO!'], cpuAlta: ['CPU em {cpu}%! Troca equivalente: calma por desempenho!'], cpuOk: ['Troca equivalente concluída.'], cocegas: ['Quem você chamou de baixinho?!'], favoritou: ['Troca equivalente: você me favorita, eu ajudo!'], volta: ['Voltei! Qual a pesquisa de hoje?'], appAbrir: ['Alquimia! Abrindo {app}.'], boasVindas: ['{sauda}, {chamar}! Hoje vou usar alquimia a seu favor.'] },
    { re: /itachi/, chegou: ['Perdoe a intrusão. Cuido deste terminal agora.'], cpuAlta: ['CPU em {cpu}%. Preciso agir rápido.'], cpuOk: ['Tudo em paz.'], cocegas: ['...Basta. Isso não é digno.'], favoritou: ['Obrigado. Não mereço.'], volta: ['Voltei. Mais uma vez.'], appAbrir: ['Abrindo {app}. Em silêncio.'], boasVindas: ['{sauda}, {chamar}. Cuidarei de você, em silêncio.'] },
    { re: /kakashi/, chegou: ['Yo. Desculpa o atraso, me perdi no caminho da vida.'], cpuAlta: ['CPU em {cpu}%. Hora de usar o Sharingan.'], cpuOk: ['Beleza. Voltou ao normal.'], cocegas: ['Ei... estou lendo, sabe?'], favoritou: ['Hm... legal da sua parte.'], volta: ['Yo. Voltei, só me atrasei um pouquinho.'], appAbrir: ['Abrindo {app}. Fácil.'], boasVindas: ['{sauda}, {chamar}. Chegou o sensei do dia.'] },
    { re: /sasuke uchiha/, chegou: ['Eu sou o Sasuke. Não esperem muito.'], cpuAlta: ['CPU em {cpu}%. Chidori nela!'], cpuOk: ['Hmph. Resolvido.'], cocegas: ['Tsc. Para com isso.'], favoritou: ['Hmph. Não tenho o que dizer.'], volta: ['Voltei. Não vou me atrasar.'], appAbrir: ['Abrindo {app}. Hmph.'], boasVindas: ['{sauda}, {chamar}. Faço o que for preciso.'] },
    { re: /izuku midoriya/, chegou: ['Eu vou ser o maior herói! Digo... ajudante! Plus Ultra!'], cpuAlta: ['CPU em {cpu}%! Plus Ultra! Aguenta, PC!'], cpuOk: ['Ufa! Plus Ultra funcionou!'], cocegas: ['Haha! Ai, ai! Eu murmuro quando fico nervoso!'], favoritou: ['Uau, obrigado! Vou dar tudo de mim!'], volta: ['Voltei! Vamos treinar mais hoje!'], appAbrir: ['Abrindo {app}! Vamos lá!'], boasVindas: ['{sauda}, {chamar}! Vou me esforçar o máximo hoje!'] },
    { re: /katsuki bakugou?/, chegou: ['Eu vou ser o número 1, e esse terminal é só o começo!'], cpuAlta: ['CPU em {cpu}%?! EXPLOSÃO!'], cpuOk: ['Hmph. Fácil.'], cocegas: ['QUE FOI, EXTRA?!'], favoritou: ['Hmph. Finalmente.'], volta: ['Voltei! Preparem-se!'], appAbrir: ['Abrindo {app}! RÁPIDO!'], boasVindas: ['{sauda}, {chamar}. Vou ser o melhor hoje.'] },
    // Jujutsu Kaisen: herdeiro dos Zenin, arrogante e obcecado por velocidade (a técnica dele é em 24 quadros por segundo)
    { re: /naoya zen.?in/, exclusivo: true, trocou: ['{anterior}? Lento demais. Agora é a vez de um Zenin.', 'Sai da frente, {anterior}. Eu assumo.'], chegou2: ['O resto é comigo. Tente acompanhar pelas abas.'], tocar: ['Play. Acompanhe se der.'], anterior: ['Voltar? Eu não olho pra trás. Mas tudo bem, uma vez.'], mudoOn: ['Silêncio. Eu gosto de focar.'], mudoOff: ['Som de volta. Eu continuo mais rápido que ele.'], miniVolta: ['Voltei ao tamanho de sempre. Grande, como deve ser.'], chegou: ['Sou o Naoya Zenin. Esse terminal já era meu antes de você abrir.', 'Rápido demais pra você acompanhar? Acostume-se.'], cpuAlta: ['CPU em {cpu}%? Devagar demais pro meu gosto.', 'CPU a {cpu}%. Até a máquina tenta me acompanhar. Não consegue.'], cpuOk: ['Voltou ao normal. Eu nunca perdi o ritmo.', 'Tá vendo? Nada me segura.'], cocegas: ['Tira a mão. Você nem viu meu movimento.', 'Lento. Eu já teria desviado em 24 quadros.'], favoritou: ['Claro que sou o favorito. Sou um Zenin.', 'Faz sentido. Só os melhores ficam nos favoritos.'], desfavoritou: ['Me tirar dos favoritos? Os Zenin não esquecem isso.'], volta: ['Voltei. Me esperaram o suficiente, não?', 'Cheguei. Antes mesmo de você me chamar.'], appAbrir: ['{app} aberto antes de você piscar.', 'Abrindo {app}. Em 24 quadros por segundo.'], appMover: ['{app} reposicionado. Rápido, como tudo que eu faço.', 'Mudei o {app} de lugar. Você nem viu.'], musica: ['♪ "{faixa}"{de}. Pelo menos tem ritmo.', '♪ "{faixa}"{de}. Tolerável. Segue.'], proxima: ['Próxima. Essa era lenta.', 'Pulei. Não tenho tempo pra faixa lenta.'], pausar: ['Pausa. Nem o silêncio me alcança.', 'Pausei. Eu decido o ritmo aqui.'], boasVindas: ['{sauda}, {chamar}. Tente não me atrasar hoje.', '{sauda}, {chamar}. Eu já comecei. Acompanhe se puder.'] },
  ];

  let ctx = { fonte: 'pokemon', nome: '', bordao: '' };
  let personagem = null;
  const ultima = new Map(); // evento -> última frase (não repete em seguida)

  const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  function sortear(evento, lista) {
    if (lista.length === 1) return lista[0];
    let f;
    do { f = lista[Math.floor(Math.random() * lista.length)]; } while (f === ultima.get(evento));
    ultima.set(evento, f);
    return f;
  }

  return {
    // chamado quando o dono muda (Pokémon ou personagem de anime)
    contexto(c) {
      ctx = { fonte: c.fonte, nome: c.nome || '', bordao: c.bordao || '' };
      const n = normalizar(c.nome);
      personagem = c.fonte === 'pokemon' ? null : PERSONAGENS.find((p) => p.re.test(n)) || null;
    },
    // frase do evento, já com as marcas trocadas
    texto(evento, vars = {}) {
      const base = ctx.fonte === 'pokemon' ? POKEMON : ANIME;
      // personagem conhecido: na maior parte das vezes uma frase dele; de vez em quando uma geral
      // de anime (nunca de Pokémon), para não repetir sempre a mesma
      const dele = personagem && personagem[evento];
      const lista = (dele && (personagem.exclusivo || Math.random() < 0.7 || !ANIME[evento]) ? dele : base[evento]) || POKEMON[evento];
      if (!lista) return '';
      const v = { nome: ctx.nome, b: ctx.bordao, ...vars };
      return sortear(evento, lista)
        .replace(/\{(\w+)\}/g, (_m, k) => (v[k] === undefined ? '' : String(v[k])))
        .replace(/\s+/g, ' ')
        .trim();
    },
  };
})();
