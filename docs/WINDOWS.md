# Meu Widget — Versão para Windows 10 / 11

Guia completo, tutorial passo a passo e arquitetura técnica do **Meu Widget** no Windows.

O **Meu Widget** é uma aplicação desktop pessoal em Electron desenvolvida para rodar no canto da tela do Windows 10 e Windows 11 (sempre no topo, sem borda e sem consumir CPU ociosa). Ele combina monitoramento de hardware, controle de multimídia, lançador de apps, memória persistente em Markdown (Cérebro), terminal de IA embutido (Claude Code e Antigravity) e gerenciamento de tokens.

---

## 🚀 Como Executar no Windows

### 1. Pré-requisitos
- **Sistema Operacional**: Windows 10 (versão 1809 ou superior) ou Windows 11 (64-bit).
- **Node.js**: versão 20.x ou superior (baixar em [nodejs.org](https://nodejs.org/)).
- **Python**: versão 3.10 ou superior (marcar a opção *"Add Python to PATH"* durante a instalação).
- **Compilador C# (`csc.exe`)**: já vem integrado nativamente em qualquer Windows 10/11 dentro de `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.

---

### 2. Rodar pelo Código-fonte (Modo Desenvolvedor)

Abra o terminal (PowerShell ou Prompt de Comando) na pasta do projeto:

```powershell
# 1. Instalar as dependências do Node (apenas na 1ª vez)
npm install

# 2. Iniciar o widget
npm start
```

> **Dica**: Você também pode dar dois cliques no arquivo [`iniciar-widget.vbs`](file:///D:/PROJETOS/widget-user/WidgetPOKEMEU/iniciar-widget.vbs) para abrir o widget silenciosamente em segundo plano, sem manter uma janela preta de terminal aberta.

---

### 3. Gerar e Usar o Executável Portátil (`.exe`)

O projeto inclui um script que compila o widget em um único arquivo `.exe` totalmente portátil (não precisa instalar e não polui o registro):

```powershell
# Gerar o executável (feche o widget antes de rodar)
npm run dist
```

- O executável **`MeuWidget.exe`** será gerado diretamente na raiz do projeto.
- Ele pode ser movido para qualquer pasta do seu computador ou pendrive.
- Para rodar, basta dar dois cliques no `MeuWidget.exe`.

---

### 4. Iniciar Automaticamente com o Windows

- **Usando o `.exe`**: Abra a engrenagem (⚙ ou `Alt+0`) → **Settings** → marque a opção **"Iniciar com o Windows"**.
- **Usando o modo `npm start`**:
  1. Pressione `Win + R`, digite `shell:startup` e pressione Enter.
  2. Crie um atalho para o arquivo `iniciar-widget.vbs` dentro desta pasta.

---

## 🛠️ Arquitetura Técnica no Windows

| Módulo / Recurso | Implementação no Windows | Benefício & Eficiência |
|---|---|---|
| **Medidor & Multimídia** | [`app/helper.cs`](file:///D:/PROJETOS/widget-user/WidgetPOKEMEU/app/helper.cs) (C# WinRT nativo compilado 1x com `csc.exe`) | Usa ~25 MB de RAM (substitui o PowerShell avulso que gastava ~55 MB e picos de CPU). |
| **Reserva de Mídia** | [`app/media.ps1`](file:///D:/PROJETOS/widget-user/WidgetPOKEMEU/app/media.ps1) | Fallback automático caso o `csc.exe` não esteja disponível. |
| **Terminal Embutido (PTY)** | [`app/pty.cs`](file:///D:/PROJETOS/widget-user/WidgetPOKEMEU/app/pty.cs) (Windows ConPTY nativo) + [`app/embutido.js`](file:///D:/PROJETOS/widget-user/WidgetPOKEMEU/app/embutido.js) + xterm.js | Emula um console VT100 real dentro da janela sem travar a pasta nem o processo. |
| **Terminal Externo** | [`app/terminal.js`](file:///D:/PROJETOS/widget-user/WidgetPOKEMEU/app/terminal.js) (Windows Terminal `wt.exe` ou `cmd.exe`) | Lança sessões desanexadas (`detached + unref`) sem prender o widget. |
| **Catálogo de Apps** | `Get-StartApps` + atalhos `.lnk` e `shell:AppsFolder` | Descobre apps da Microsoft Store e executáveis com cache em memória de 5 minutos. |
| **Foco e Janelas** | Win32 API (`User32.dll` via `helper.cs`) | Foca qualquer janela por PID ou executável sem APIs externas. |
| **Desligar PC com Segurança** | `shutdown /s /t 20` com cancelamento via `shutdown /a` | Duas etapas de confirmação conferidas no backend com contagem de 20s. |
| **Configuração** | `%APPDATA%\meu-widget\config.json` | Persistência isolada do usuário em JSON puro. |

---

## 🧩 Todas as Abas e Recursos

### 1. System (`sys` ou `Alt+1`)
- **Monitor de Recursos**: Gráficos de uso em tempo real de CPU e memória RAM física do computador.
- **Memória do Widget**: Exibe a soma exata de memória privada de todos os processos do próprio widget (Electron + renderizadores + helper).
- **Gerenciador de Tarefas**:
  - Lista de **Apps** (janelas visíveis) e lista de **Processes** (todos os processos em execução).
  - Fechamento educado de programas (solicita salvar alterações) ou encerramento forçado via PID.
  - Proteção automática contra finalização de processos críticos do Windows e do próprio widget.

### 2. Music (`music` ou `Alt+2`)
- **Controle de Reprodução**: Play, Pause, Próxima e Faixa Anterior compatíveis com Spotify, navegadores (YouTube/SoundCloud) e reprodutores locais.
- **Capa e Metadados**: Nome da música, artista, álbum e capa em alta resolução (via WinRT).
- **Controle de Volume do Windows**: Slider de volume de 0 a 100% e botão de Mudo diretamente pela API de áudio do sistema.

### 3. Apps (`apps` ou `Alt+3`)
- **Atalhos Rápidos**: Lançador de aplicativos e sites favoritos.
- **Catálogo do Menu Iniciar**: Pesquisa rápida em todos os programas instalados e apps da Microsoft Store.
- **Arrastar e Soltar**: Arraste arquivos, pastas ou atalhos da área de trabalho diretamente para o widget para adicionar.

### 4. Brain (`cerebro` ou `Alt+4`)
- **Memória Persistente**: Histórico de decisões e conversas em formato Markdown (`cerebro/conversas/` e `cerebro/estado/`).
- **Busca Eficiente em 3 Níveis**:
  1. *Nível 1 (Títulos)*: Lê apenas nomes de arquivos em milissegundos.
  2. *Nível 2 (Cabeçalhos)*: Lê apenas as 2 primeiras linhas de metadados.
  3. *Nível 3 (Conteúdo)*: Abre o arquivo completo somente se necessário (máx. 3).
- **Grafo 3D Interativo**: Visualização estilo Obsidian feita em Canvas puro (HTML5), com simulação física que congela quando em repouso (zero uso de CPU).

### 5. Projects (`projetos` ou `Alt+5`)
- **Sessões de IA Integradas**: Lança sessões locais do **Claude Code** (`claude`) e **Google Antigravity** (`agy`).
- **Terminal Embutido**: Roda a linha de comando dentro do próprio widget via xterm.js e ConPTY.
- **Destacar Janela (`[↗ destacar]`)**: Permite desacoplar apenas a janela do terminal para arrastar para um segundo monitor, mantendo o widget compacto na tela principal.
- **Atalho PowerShell Rápido**: Abre uma janela do PowerShell diretamente na pasta do projeto ativo.
- **Worktrees e Gestão de Limites**: Prevenção de perda de contexto e monitoramento do limite de uso.

### 6. Skills (`skills` ou `Alt+6`)
- **Orçamento de Tokens**: Acompanhamento de custos de tokens para IAs.
- **Biblioteca Modular**: Instale e remova skills para Claude e Antigravity globalmente ou por projeto.
- **Indicador de Economia**: Medição em tempo real de tokens poupados através do uso do Cérebro.

### 7. Configurações & Pokédex (⚙ ou `Alt+0`)
- **Pokédex Completa**: Escolha qualquer Pokémon das gerações 1 a 9 com sprites oficiais em pixel art da PokéAPI.
- **Temas Visuais**:
  - **CMD**: Estilo retrô de terminal hacker (fundo preto, texto cinza e realce na cor do Pokémon).
  - **iOS**: Vidro fosco dinâmico com desfoque de fundo e bordas translúcidas que acompanham as cores da sua tela.
- **Modo Mini**: Alterna para uma barra compacta de cabeçalho com um único clique ou atalho.

---

## ⌨️ Atalhos de Teclado Globais e Locais

| Atalho | Ação |
|---|---|
| `Alt + 1` | Alterna para a aba **System** |
| `Alt + 2` | Alterna para a aba **Music** |
| `Alt + 3` | Alterna para a aba **Apps** |
| `Alt + 4` | Alterna para a aba **Brain (Cérebro)** |
| `Alt + 5` | Alterna para a aba **Projects (Projetos)** |
| `Alt + 6` | Alterna para a aba **Skills** |
| `Alt + 0` | Abre / fecha as **Configurações & Pokédex** |
| `Ctrl + Alt + A` | **Atalho Global do Windows**: Traz o widget para frente e foca a sessão do projeto ativo |
| `Esc` | Fecha janelas de diálogo, formulários e o menu Settings |

---

## 🧪 Como Rodar os Testes Automatizados

Para verificar a integridade de todas as pontes e scripts no Windows:

```powershell
# Testar ponte do Cérebro
npm run testar-cerebro

# Testar biblioteca e cálculo de Skills
npm run testar-skills

# Testar medição de consumo de CPU e RAM
npm run medir
```
