# Meu Widget — Versão para Ubuntu / Linux

Esta versão traz 100% de paridade de recursos com a versão Windows, reimplementada de forma nativa e leve para Linux (focada em Ubuntu 20.04/22.04/24.04 e distribuições baseadas em Debian/GNOME/X11/Wayland).

---

## 🚀 Como Executar

### 1. Pré-requisitos
Instale o Node.js, Python 3 e os utilitários de sistema:
```bash
chmod +x instalar-dependencias-ubuntu.sh
./instalar-dependencias-ubuntu.sh
```
Ou manualmente via `apt`:
```bash
sudo apt update
sudo apt install -y nodejs npm python3 playerctl pulseaudio-utils wmctrl x11-utils libnotify-bin
```

### 2. Instalar dependências e rodar
```bash
npm install
npm start
```
Ou utilizando o script facilitador:
```bash
chmod +x iniciar-widget.sh
./iniciar-widget.sh
```

---

## 🛠️ Arquitetura Linux

| Recurso | Implementação no Windows | Implementação no Linux (Ubuntu) |
|---|---|---|
| **Ponte do Sistema / Mídia** | `app/helper.cs` / `media.ps1` | `app/helper-linux.py` (D-Bus MPRIS2 via `playerctl`, `pactl`/`amixer`, `/proc`) |
| **Terminal Embutido (PTY)** | `app/pty.cs` (Windows ConPTY) | `app/pty-linux.py` (POSIX `pty.openpty()` com protocolo binário idêntico) |
| **Terminal Externo** | `wt.exe` / `cmd.exe` | Detecção dinâmica: `gnome-terminal`, `x-terminal-emulator`, `konsole`, etc. |
| **Gerenciador de Janelas / Foco** | Win32 API (`User32.dll`) | `xprop`, `wmctrl`, `/proc` e D-Bus |
| **Catálogo de Aplicativos** | `Get-StartApps` e atalhos `.lnk` | FreeDesktop `.desktop` (`/usr/share/applications`, `~/.local/share/applications`) |
| **Atalho de Shell do Projeto** | `PowerShell` | `bash` (`$SHELL`) |
| **Desligar PC com confirmação** | `shutdown /s /t 20` | `shutdown +1` e cancelamento com `shutdown -c` |
| **Configurações e Logs** | `%APPDATA%\meu-widget` | `~/.config/meu-widget` (XDG Base Directory) |

---

## 📦 Gerar AppImage para Linux

Para empacotar o widget em um executável portátil (`.AppImage`):
```bash
npm run dist:linux
```
O pacote será gerado na pasta `dist/MeuWidget.AppImage`.

---

## 🧩 Todas as Abas Suportadas
- **System (`sys`)**: Uso de CPU, memória RAM, lista de processos e finalização educada/forçada de tarefas via sinais POSIX (`SIGTERM` e `SIGKILL`).
- **Music (`music`)**: Controles de multimídia (Play/Pause, Próxima, Anterior, Volume e Mudo) compatíveis com Spotify, navegadores (Chrome/Firefox), VLC e reprodutores que suportam o padrão MPRIS2.
- **Apps (`apps`)**: Lista de programas instalados no sistema via especificações FreeDesktop `.desktop`, com busca e lançamento imediato.
- **Cérebro (`cerebro`)**: Memória persistente, busca rápida de notas, histórico de conversas e Grafo 3D em Canvas.
- **Projetos (`projetos`)**: Gerenciamento de projetos com IA (Claude Code e Antigravity `agy`), terminal embutido com xterm.js via POSIX PTY e suporte a abas de terminal destacadas.
- **Skills (`skills`)**: Orçamento de tokens, simulação de economia e gerenciamento modular de skills para IAs.
- **Configurações & Pokédex**: Personalização visual (tema escuro, iOS blur, modo mini), Pokédex interativa e atalhos rápidos.


---

## 🔄 Atualização Automática / Botão Update

O widget no Ubuntu conta com o mesmo sistema de atualização rápida que a versão Windows:
- **Monitoramento da Branch**: Configurado em pp/atualizacao.json para a branch devs(ubunto).
- **Verificação Leve**: ~20 segundos após a inicialização, o Electron faz uma requisição leve de ~40 bytes à API do GitHub (nd.github.sha).
- **Botão no Cabeçalho**: Caso haja novo commit na branch devs(ubunto), o botão update surge no topo e o Pokémon avisa.
- **Segurança de Dados**: Todo o conteúdo do usuário (~/.config/meu-widget, cerebro/conversas/, cerebro/estado/, projetos.json, skills importadas) permanece 100% intacto. Apenas arquivos de código do widget são atualizados com backup e reversão automática em caso de erro.
