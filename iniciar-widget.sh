#!/usr/bin/env bash
# Inicia o Meu Widget no Ubuntu / Linux
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

# Verifica se o Node e o Python estão instalados
command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado. Instale com: sudo apt install nodejs npm"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3 não encontrado. Instale com: sudo apt install python3"; exit 1; }

# Executa o widget
npm start

