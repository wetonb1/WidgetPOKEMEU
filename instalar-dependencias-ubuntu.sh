#!/usr/bin/env bash
# Instala os pacotes recomendados no Ubuntu para suporte total a recursos de mídia, áudio e janelas
echo "Instalando dependências para o Meu Widget no Ubuntu..."
sudo apt update
sudo apt install -y nodejs npm python3 playerctl pulseaudio-utils wmctrl x11-utils libnotify-bin
echo "Instalação concluída! Agora você pode rodar ./iniciar-widget.sh ou npm start"

