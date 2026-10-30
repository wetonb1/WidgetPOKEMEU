#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# helper-linux.py — ponte do widget com o sistema operacional Ubuntu/Linux.
# Substitui o helper.cs / media.ps1 do Windows.
# Responde JSON linha a linha pela entrada padrão (stdin/stdout).
# Não depende de pacotes externos do pip: usa apenas a biblioteca padrão do Python 3
# e ferramentas padrão do Linux (pactl/amixer, playerctl/dbus, ps/procfs, wmctrl/xprop).

import base64
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time

TEM_PLAYERCTL = shutil.which("playerctl") is not None
TEM_PACTL = shutil.which("pactl") is not None
TEM_AMIXER = shutil.which("amixer") is not None
TEM_WMCTRL = shutil.which("wmctrl") is not None
TEM_XDOTOOL = shutil.which("xdotool") is not None
TEM_XPROP = shutil.which("xprop") is not None

# Cache para ícones de aplicativos
CACHE_ICONES = {}
CACHE_DESCS = {}

def executar_cmd(args, timeout=2.0):
    try:
        res = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
        return res.stdout.strip()
    except Exception:
        return ""

# ---------- 1. Mídia (MPRIS2 via playerctl ou dbus) ----------

def midia_info(com_capa=False):
    if not TEM_PLAYERCTL:
        return "{}"
    try:
        status = executar_cmd(["playerctl", "status"])
        if not status or "No players found" in status:
            return "{}"
        titulo = executar_cmd(["playerctl", "metadata", "title"])
        artista = executar_cmd(["playerctl", "metadata", "artist"])
        album = executar_cmd(["playerctl", "metadata", "album"])
        art_url = executar_cmd(["playerctl", "metadata", "mpris:artUrl"])

        dados = {
            "title": titulo or "",
            "artist": artista or "",
            "album": album or "",
            "status": "Playing" if "Playing" in status else ("Paused" if "Paused" in status else "Stopped"),
        }

        if com_capa and art_url:
            caminho_local = None
            if art_url.startswith("file://"):
                caminho_local = art_url[7:]
            elif os.path.isfile(art_url):
                caminho_local = art_url
            if caminho_local and os.path.isfile(caminho_local):
                try:
                    with open(caminho_local, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode("ascii")
                        ext = os.path.splitext(caminho_local)[1].lower()
                        mime = "image/png" if ext == ".png" else "image/jpeg"
                        dados["thumb"] = f"data:{mime};base64,{b64}"
                except Exception:
                    pass
        return json.dumps(dados, ensure_ascii=False)
    except Exception:
        return "{}"

def midia_executar(acao):
    if not TEM_PLAYERCTL:
        return "{}"
    cmd = []
    if acao == "playpause":
        cmd = ["playerctl", "play-pause"]
    elif acao == "next":
        cmd = ["playerctl", "next"]
    elif acao == "prev":
        cmd = ["playerctl", "previous"]
    if cmd:
        executar_cmd(cmd)
    return "{}"

# ---------- 2. Volume do Sistema (PulseAudio / PipeWire / ALSA) ----------

def volume_info():
    v = 50
    mudo = False
    if TEM_PACTL:
        saida_vol = executar_cmd(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
        m = re.search(r"(\d{1,3})%", saida_vol)
        if m:
            v = int(m.group(1))
        saida_mudo = executar_cmd(["pactl", "get-sink-mute", "@DEFAULT_SINK@"])
        mudo = "yes" in saida_mudo.lower()
    elif TEM_AMIXER:
        saida = executar_cmd(["amixer", "sget", "Master"])
        m = re.search(r"\[(\d{1,3})%\]", saida)
        if m:
            v = int(m.group(1))
        mudo = "[off]" in saida
    return json.dumps({"v": max(0, min(100, v)), "m": mudo})

def volume_definir(nivel):
    nivel = max(0, min(100, int(nivel)))
    if TEM_PACTL:
        executar_cmd(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{nivel}%"])
        if nivel > 0:
            executar_cmd(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"])
    elif TEM_AMIXER:
        executar_cmd(["amixer", "sset", "Master", f"{nivel}%"])
        if nivel > 0:
            executar_cmd(["amixer", "sset", "Master", "unmute"])
    return json.dumps({"v": nivel, "m": False})

def volume_mudo(mudo_bool):
    if TEM_PACTL:
        executar_cmd(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1" if mudo_bool else "0"])
    elif TEM_AMIXER:
        executar_cmd(["amixer", "sset", "Master", "mute" if mudo_bool else "unmute"])
    return volume_info()

# ---------- 3. Lista de Processos (CPU, RAM, PID, Nome) ----------

_cpu_anterior = {}
_ms_anterior = 0.0

def lista_processos():
    global _cpu_anterior, _ms_anterior
    agora = time.time()
    dt = agora - _ms_anterior if _ms_anterior > 0 else 1.0
    _ms_anterior = agora
    nucleos = os.cpu_count() or 1

    novo = {}
    resultado = []

    # Lê via ps para portabilidade e velocidade
    saida = executar_cmd(["ps", "-eo", "pid,pcpu,rss,comm", "--no-headers"], timeout=3.0)
    for linha in saida.splitlines():
        partes = linha.strip().split(None, 3)
        if len(partes) < 4:
            continue
        try:
            pid = int(partes[0])
            cpu = float(partes[1].replace(",", "."))
            rss = int(partes[2])  # em KB
            nome = partes[3]
            resultado.append({"n": nome, "i": pid, "c": round(cpu, 2), "m": rss})
        except Exception:
            continue

    return json.dumps(resultado, ensure_ascii=False)

# ---------- 4. Tela Cheia (X11) ----------

def telacheia():
    if not TEM_XPROP:
        return "false"
    try:
        saida_root = executar_cmd(["xprop", "-root", "_NET_ACTIVE_WINDOW"])
        m = re.search(r"window id # (0x[0-9a-fA-F]+)", saida_root)
        if not m:
            return "false"
        win_id = m.group(1)
        saida_win = executar_cmd(["xprop", "-id", win_id, "_NET_WM_STATE"])
        if "_NET_WM_STATE_FULLSCREEN" in saida_win:
            return "true"
        return "false"
    except Exception:
        return "false"

# ---------- 5. Janelas Abertas e Foco ----------

def lista_janelas():
    itens = []
    if TEM_WMCTRL:
        saida = executar_cmd(["wmctrl", "-l", "-p", "-x"])
        vistos = set()
        for linha in saida.splitlines():
            partes = linha.strip().split(None, 4)
            if len(partes) < 5:
                continue
            wid, desktop, pid_str, classe, titulo = partes[0], partes[1], partes[2], partes[3], partes[4]
            if desktop == "-1":  # janelas do sistema / desktop
                continue
            nome_app = classe.split(".")[-1] if "." in classe else classe
            if nome_app in vistos:
                continue
            vistos.add(nome_app)
            itens.append({"n": nome_app, "p": nome_app})
    return json.dumps(itens, ensure_ascii=False)

def lista_apps_janelas():
    itens = []
    if TEM_WMCTRL:
        saida = executar_cmd(["wmctrl", "-l", "-p", "-x"])
        vistos = set()
        for linha in saida.splitlines():
            partes = linha.strip().split(None, 4)
            if len(partes) < 5:
                continue
            wid, desktop, pid_str, classe, titulo = partes[0], partes[1], partes[2], partes[3], partes[4]
            if desktop == "-1":
                continue
            try:
                pid = int(pid_str)
            except ValueError:
                pid = 0
            if pid in vistos or pid == 0:
                continue
            vistos.add(pid)
            nome_app = classe.split(".")[-1] if "." in classe else classe
            itens.append({
                "i": pid,
                "t": titulo,
                "n": nome_app,
                "d": nome_app,
                "p": f"/proc/{pid}/exe" if os.path.exists(f"/proc/{pid}/exe") else nome_app
            })
    return json.dumps(itens, ensure_ascii=False)

def focar_pid(pid):
    if TEM_XDOTOOL:
        executar_cmd(["xdotool", "search", "--pid", str(pid), "windowactivate"])
        return "true"
    elif TEM_WMCTRL:
        executar_cmd(["wmctrl", "-k", "off"])
    return "false"

def focar_app(app_nome):
    if TEM_WMCTRL:
        executar_cmd(["wmctrl", "-x", "-a", app_nome])
        return "true"
    return "false"

# ---------- 6. Aplicativos Instalados (.desktop) ----------

def listar_apps_sistema():
    pastas = [
        "/usr/share/applications",
        "/usr/local/share/applications",
        os.path.expanduser("~/.local/share/applications"),
    ]
    apps = []
    vistos = set()
    for pasta in pastas:
        if not os.path.isdir(pasta):
            continue
        for arq in glob.glob(os.path.join(pasta, "*.desktop")):
            nome_base = os.path.basename(arq)
            if nome_base in vistos:
                continue
            try:
                with open(arq, "r", encoding="utf-8", errors="ignore") as f:
                    conteudo = f.read()
                if "NoDisplay=true" in conteudo or "Type=Application" not in conteudo:
                    continue
                m_nome = re.search(r"^Name=(.+)$", conteudo, re.MULTILINE)
                nome = m_nome.group(1).strip() if m_nome else nome_base
                vistos.add(nome_base)
                apps.append({"n": nome, "id": nome_base})
            except Exception:
                continue
    apps.sort(key=lambda a: a["n"].lower())
    return json.dumps(apps, ensure_ascii=False)

def icone_app(app_id):
    if app_id in CACHE_ICONES:
        return CACHE_ICONES[app_id]
    pastas_desktop = [
        os.path.expanduser("~/.local/share/applications"),
        "/usr/share/applications",
        "/usr/local/share/applications",
    ]
    caminho_desktop = None
    for d in pastas_desktop:
        c = os.path.join(d, app_id if app_id.endswith(".desktop") else app_id + ".desktop")
        if os.path.isfile(c):
            caminho_desktop = c
            break
    if not caminho_desktop:
        return "null"

    icone_nome = None
    try:
        with open(caminho_desktop, "r", encoding="utf-8", errors="ignore") as f:
            for linha in f:
                if linha.startswith("Icon="):
                    icone_nome = linha.strip().split("=", 1)[1]
                    break
    except Exception:
        return "null"

    if not icone_nome:
        return "null"

    # Se já é um caminho absoluto
    if os.path.isfile(icone_nome):
        resultado = _ler_icone_base64(icone_nome)
        CACHE_ICONES[app_id] = resultado
        return resultado

    # Procura nos diretórios de ícones do Linux
    pastas_icones = [
        "/usr/share/pixmaps",
        "/usr/share/icons/hicolor/96x96/apps",
        "/usr/share/icons/hicolor/128x128/apps",
        "/usr/share/icons/hicolor/64x64/apps",
        "/usr/share/icons/hicolor/48x48/apps",
        "/usr/share/icons/hicolor/scalable/apps",
    ]
    for p in pastas_icones:
        for ext in (".png", ".svg", ".xpm"):
            cand = os.path.join(p, icone_nome + ext)
            if os.path.isfile(cand):
                resultado = _ler_icone_base64(cand)
                CACHE_ICONES[app_id] = resultado
                return resultado

    CACHE_ICONES[app_id] = "null"
    return "null"

def _ler_icone_base64(caminho):
    try:
        with open(caminho, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
            ext = os.path.splitext(caminho)[1].lower()
            mime = "image/svg+xml" if ext == ".svg" else ("image/x-xpixmap" if ext == ".xpm" else "image/png")
            return f'"data:{mime};base64,{b64}"'
    except Exception:
        return "null"

# ---------- 7. Loop de Servidor (stdin -> stdout) ----------

def tratar_comando(c):
    c = c.strip()
    if c == "info":
        return midia_info(False)
    if c == "info-capa":
        return midia_info(True)
    if c in ("playpause", "next", "prev"):
        return midia_executar(c)
    if c == "processos":
        return lista_processos()
    if c == "telacheia":
        return telacheia()
    if c == "volume":
        return volume_info()
    if c == "janelas":
        return lista_janelas()
    if c in ("apps", "startapps"):
        return listar_apps_sistema()
    if c == "gc":
        return "ok"
    if c == "mudo-set 0":
        return volume_mudo(False)
    if c == "mudo-set 1":
        return volume_mudo(True)
    if c == "mem":
        try:
            with open("/proc/self/statm", "r") as f:
                resident = int(f.read().split()[1])
            return str(resident * os.sysconf("SC_PAGE_SIZE"))
        except Exception:
            return "25000000"

    if c.startswith("volume-set "):
        try:
            return volume_definir(int(c.split()[1]))
        except Exception:
            return volume_info()

    if c.startswith("focar-pid "):
        try:
            return focar_pid(int(c.split()[1]))
        except Exception:
            return "false"

    if c.startswith("focar-app ") or c.startswith("focar-exe "):
        partes = c.split(None, 1)
        if len(partes) > 1:
            return focar_app(partes[1])
        return "false"

    if c.startswith("iconeapp "):
        partes = c.split(None, 1)
        if len(partes) > 1:
            return icone_app(partes[1])
        return "null"

    return "{}"

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "servidor":
        sys.stdout.reconfigure(line_buffering=True)
        for linha in sys.stdin:
            cmd = linha.strip()
            if not cmd:
                continue
            resp = tratar_comando(cmd)
            sys.stdout.write(resp + "\n")
            sys.stdout.flush()
    elif len(sys.argv) > 1:
        cmd = " ".join(sys.argv[1:])
        sys.stdout.write(tratar_comando(cmd) + "\n")
    else:
        sys.stdout.write("helper-linux pronto\n")

if __name__ == "__main__":
    main()

