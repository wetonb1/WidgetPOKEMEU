#!/usr/bin/env bash
# Abre o arquivo de configuração do widget
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/meu-widget"
CONFIG_FILE="$CONFIG_DIR/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$CONFIG_DIR"
  echo "{}" > "$CONFIG_FILE"
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$CONFIG_FILE" 2>/dev/null || nano "$CONFIG_FILE"
else
  nano "$CONFIG_FILE"
fi

