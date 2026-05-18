#!/bin/bash

# x265-Converter Unraid Start Script
# Umieść ten skrypt w: /mnt/user/x265-converter/ lub /boot/custom/

set -e

PROJECT_DIR="/mnt/user/x265-converter"
APPDATA_DIR="/mnt/user/appdata/x265-converter"
UNRAID_IP=$(hostname -I | awk '{print $1}')

echo "================================"
echo "🎬 x265-Converter - Unraid Start"
echo "================================"
echo "IP Unraid: $UNRAID_IP"
echo "Project: $PROJECT_DIR"
echo ""

# Sprawdź czy projekt istnieje
if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ Projekt nie znaleziony w $PROJECT_DIR"
    exit 1
fi

cd "$PROJECT_DIR"

# Utwórz foldery appdata
mkdir -p "$APPDATA_DIR/tmp"
chmod 777 "$APPDATA_DIR/tmp"
echo "✓ Foldery przygotowane"

# Sprawdź czy obraz istnieje
if ! docker image inspect x265-converter:latest &> /dev/null; then
    echo "📦 Budowanie obrazu Docker..."
    docker build -t x265-converter:latest .
    echo "✓ Obraz zbudowany"
fi

# Zatrzymaj stary kontener jeśli istnieje
if docker ps -a --format '{{.Names}}' | grep -q "^x265-converter$"; then
    echo "🛑 Zatrzymywanie starego kontenera..."
    docker stop x265-converter 2>/dev/null || true
    docker rm x265-converter 2>/dev/null || true
fi

# Uruchom nowy kontener
echo "🚀 Uruchamianie kontenera..."
docker run -d \
    --name x265-converter \
    --hostname x265-converter \
    -p 3001:3001 \
    --restart unless-stopped \
    -e NODE_ENV=production \
    -e HOST=0.0.0.0 \
    -e PORT=3001 \
    -e PUBLIC_URL="http://$UNRAID_IP:3001" \
    -e AUTO_OPEN_BROWSER=0 \
    -e FILE_OPEN_ENABLED=0 \
    -e APP_TMP_DIR=/tmp/x265-converter \
    -e FFMPEG_PATH=/usr/bin/ffmpeg \
    -e FFPROBE_PATH=/usr/bin/ffprobe \
    -v /mnt/user/media:/data \
    -v "$APPDATA_DIR/tmp:/tmp/x265-converter" \
    x265-converter:latest

echo "✓ Kontener uruchomiony"
echo ""
echo "================================"
echo "✨ x265-Converter gotów!"
echo "================================"
echo "Adres: http://$UNRAID_IP:3001"
echo ""
echo "Logi: docker logs -f x265-converter"
echo "Status: docker ps"
echo ""
