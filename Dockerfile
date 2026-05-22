FROM node:20-bookworm-slim

LABEL org.opencontainers.image.title="x265 Converter" \
    org.opencontainers.image.description="Web-based HEVC/x265 video converter" \
    org.opencontainers.image.source="https://github.com/Maniek-o/x265-converter" \
    org.opencontainers.image.vendor="Maniek-o"

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    PUBLIC_URL=http://localhost:3001 \
    AUTO_OPEN_BROWSER=0 \
    FILE_OPEN_ENABLED=0 \
    APP_TMP_DIR=/tmp/x265-converter \
    LIBVA_DRIVER_NAME=iHD \
    LIBVA_DRIVERS_PATH=/usr/lib/x86_64-linux-gnu/dri

WORKDIR /app

# Zainstaluj ffmpeg oraz runtime dla Intel Quick Sync (QSV) / VAAPI
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
    intel-media-va-driver \
    i965-va-driver \
    va-driver-all \
    libva2 \
    libva-drm2 \
    libva-x11-2 \
    libmfx1 \
    vainfo \
       ca-certificates \
       curl \
       tini \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .

RUN mkdir -p /tmp/x265-converter \
    && chown -R node:node /app /tmp/x265-converter

USER node

EXPOSE 3001

# Używaj tini do poprawnego handleowania sygnałów
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]