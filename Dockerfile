FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    PUBLIC_URL=http://localhost:3001 \
    AUTO_OPEN_BROWSER=0 \
    FILE_OPEN_ENABLED=0 \
    APP_TMP_DIR=/tmp/x265-converter

WORKDIR /app

# Zainstaluj ffmpeg, ffprobe i niezbędne biblioteki
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
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