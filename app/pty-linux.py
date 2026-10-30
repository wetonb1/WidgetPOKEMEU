#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pty-linux.py — terminal embutido para Linux usando o módulo nativo pty (POSIX).
# Substitui o pty.cs / ConPTY do Windows.
# Comunica-se com o app/pty.js via stdin/stdout usando o mesmo protocolo binário:
#   Quadro tipo 0: dados de entrada do usuário (stdin)
#   Quadro tipo 1: redimensionamento de terminal (cols, rows em uint16 LE)

import fcntl
import os
import pty
import select
import shlex
import signal
import struct
import subprocess
import sys
import termios
import threading

def redimensionar(fd_master, cols, rows):
    try:
        cols = max(2, min(500, cols))
        rows = max(2, min(200, rows))
        ws = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd_master, termios.TIOCSWINSZ, ws)
    except Exception:
        pass

def main():
    cols = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    rows = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    linha = os.environ.get("WIDGET_PTY_LINHA") or os.environ.get("SHELL") or "/bin/bash"
    pasta = os.environ.get("WIDGET_PTY_PASTA") or os.getcwd()

    if not os.path.isdir(pasta):
        pasta = os.path.expanduser("~")

    # Divide a linha de comando em argumentos para o processo
    if isinstance(linha, str):
        try:
            cmd_args = shlex.split(linha)
        except Exception:
            cmd_args = [linha]
    else:
        cmd_args = [linha]

    if not cmd_args:
        cmd_args = ["/bin/bash"]

    master, slave = pty.openpty()
    redimensionar(master, cols, rows)

    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    try:
        proc = subprocess.Popen(
            cmd_args,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=pasta,
            env=env,
            preexec_fn=os.setsid,
            close_fds=True,
        )
    except Exception as e:
        sys.stderr.write(f"ERRO {str(e)}\n")
        sys.stderr.flush()
        os.close(master)
        os.close(slave)
        sys.exit(1)

    os.close(slave)

    # Avisa o PID do processo filho ao pty.js
    sys.stderr.write(f"PID {proc.pid}\n")
    sys.stderr.flush()

    encerrado = threading.Event()

    # Thread para ler do master e repassar para stdout
    def leitor_saida():
        while not encerrado.is_set():
            try:
                r, _, _ = select.select([master], [], [], 0.1)
                if master in r:
                    dados = os.read(master, 4096)
                    if not dados:
                        break
                    sys.stdout.buffer.write(dados)
                    sys.stdout.buffer.flush()
            except (OSError, ValueError):
                break
        encerrado.set()

    t_saida = threading.Thread(target=leitor_saida, daemon=True)
    t_saida.start()

    # Loop principal: lê quadros binários do stdin
    # Cabeçalho de 5 bytes: [tipo: 1 byte] [comprimento: 4 bytes uint32 LE]
    stdin_buf = sys.stdin.buffer
    try:
        while not encerrado.is_set():
            cab = stdin_buf.read(5)
            if not cab or len(cab) < 5:
                break
            tipo = cab[0]
            comprimento = struct.unpack("<I", cab[1:5])[0]
            dados = b""
            while len(dados) < comprimento:
                pedaco = stdin_buf.read(comprimento - len(dados))
                if not pedaco:
                    break
                dados += pedaco

            if len(dados) < comprimento:
                break

            if tipo == 0:  # escrita
                try:
                    os.write(master, dados)
                except OSError:
                    break
            elif tipo == 1:  # redimensionamento: 2 bytes cols + 2 bytes rows
                if len(dados) >= 4:
                    c, r = struct.unpack("<HH", dados[:4])
                    redimensionar(master, c, r)
    except Exception:
        pass
    finally:
        encerrado.set()
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
        try:
            proc.wait(timeout=1.5)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                pass
        try:
            os.close(master)
        except Exception:
            pass

    sys.exit(proc.returncode if proc.returncode is not None else 0)

if __name__ == "__main__":
    main()

