#!/usr/bin/env bash
# Inicia o Meu Widget no Linux
set -e
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

# Verifica se o Node e o Python estão instalados
command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3 não encontrado."; exit 1; }

# Executa o widget
exec ./node_modules/electron/dist/electron . --ozone-platform=x11 "$@"

