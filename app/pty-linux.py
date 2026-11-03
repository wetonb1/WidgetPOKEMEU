#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pty-linux.py — terminal embutido para Linux usando o módulo nativo pty (POSIX).
# Substitui o pty.cs / ConPTY do Windows.
# Comunica-se com o app/pty.js via stdin/stdout usando o mesmo protocolo binário:
#   Quadro tipo 0: dados de entrada do usuário (stdin)
#   Quadro tipo 1: redimensionamento de terminal (cols, rows em uint16 LE)

import fcntl
import json
import os
import pty
import select
import shlex
import signal
import struct
import subprocess
import sys
import termios

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

    cmd_args = None
    args_json = os.environ.get("WIDGET_PTY_ARGS_JSON")
    if args_json:
        try:
            parsed = json.loads(args_json)
            if isinstance(parsed, list) and parsed:
                cmd_args = [str(x) for x in parsed]
        except Exception:
            cmd_args = None

    # Divide a linha de comando em argumentos para o processo (fallback)
    if not cmd_args:
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

    def configurar_filho():
        os.setsid()
        try:
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        except Exception:
            pass

    try:
        proc = subprocess.Popen(
            cmd_args,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=pasta,
            env=env,
            preexec_fn=configurar_filho,
            close_fds=True,
        )
    except Exception as e:
        sys.stderr.write(f"ERRO falha ao iniciar: {str(e)}\n")
        sys.stderr.flush()
        os.close(master)
        os.close(slave)
        sys.exit(1)

    os.close(slave)

    def ao_sinal(_sig, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, ao_sinal)
    signal.signal(signal.SIGHUP, ao_sinal)
    signal.signal(signal.SIGINT, ao_sinal)

    # Avisa o PID do processo filho ao pty.js
    sys.stderr.write(f"PID {proc.pid}\n")
    sys.stderr.flush()

    fd_stdin = sys.stdin.fileno()
    buf_entrada = bytearray()
    stdin_aberto = True

    # Loop principal: multiplexa leitura do master (saída do programa) e do stdin (quadros do pty.js)
    # Cabeçalho de 5 bytes no stdin: [tipo: 1 byte] [comprimento: 4 bytes uint32 LE]
    try:
        while True:
            fds = [master] + ([fd_stdin] if stdin_aberto else [])
            try:
                r, _, _ = select.select(fds, [], [], 0.1)
            except (OSError, ValueError):
                break

            if master in r:
                try:
                    dados = os.read(master, 4096)
                    if not dados:
                        break
                    sys.stdout.buffer.write(dados)
                    sys.stdout.buffer.flush()
                except (OSError, ValueError):
                    break

            if fd_stdin in r:
                try:
                    pedaco = os.read(fd_stdin, 4096)
                except OSError:
                    pedaco = b""
                if not pedaco:
                    stdin_aberto = False
                    break
                buf_entrada.extend(pedaco)
                while len(buf_entrada) >= 5:
                    tipo = buf_entrada[0]
                    comprimento = struct.unpack("<I", buf_entrada[1:5])[0]
                    if len(buf_entrada) < 5 + comprimento:
                        break
                    payload = bytes(buf_entrada[5:5 + comprimento])
                    del buf_entrada[:5 + comprimento]
                    if tipo == 0:  # escrita
                        try:
                            os.write(master, payload)
                        except OSError:
                            break
                    elif tipo == 1 and len(payload) >= 4:  # redimensionamento
                        c, l = struct.unpack("<HH", payload[:4])
                        redimensionar(master, c, l)

            if not r and proc.poll() is not None:
                break
    except BaseException:
        pass
    finally:
        try:
            os.close(master)
        except Exception:
            pass
        if proc.poll() is None:
            try:
                pgid = os.getpgid(proc.pid)
                os.killpg(pgid, signal.SIGHUP)
                os.killpg(pgid, signal.SIGTERM)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
            try:
                proc.wait(timeout=0.6)
            except Exception:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                try:
                    proc.wait(timeout=0.4)
                except Exception:
                    pass

    sys.exit(proc.returncode if proc.returncode is not None and proc.returncode >= 0 else 0)

if __name__ == "__main__":
    main()

