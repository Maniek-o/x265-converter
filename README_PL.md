# 🎬 x265-Converter - Konwerter video do HEVC/x265

Webowy interfejs do konwersji video do formatu HEVC (x265) z obsługą:
- ✅ **Kolejka pracy** - przetwarzaj wiele plików
- ✅ **Podgląd na żywo** - zobacz wynik podczas konwersji
- ✅ **Porównanie video** - split-screen między oryginałem a wynikiem
- ✅ **Tryb turbo** - szybsza konwersja z gorszą jakością
- ✅ **CPU/GPU** - wybór silnika kodowania
- ✅ **Docker/Unraid** - łatwe uruchomienie na serwerze

---

## 🚀 Quick Start - Unraid

### Opcja 1: Najprostsza (Community Applications)
1. W Unraid WebUI: **Apps** → Search `x265-converter`
2. Kliknij **Install**
3. Skonfiguruj porty i foldery
4. Kliknij **Apply**
5. Otwórz: `http://IP_UNRAID:3001`

### Opcja 2: Terminal Unraid
```bash
cd /mnt/user
git clone https://github.com/yourusername/x265-converter.git
cd x265-converter
chmod +x start-on-unraid.sh
./start-on-unraid.sh
```

### Opcja 3: Docker Compose
```bash
cd /mnt/user/x265-converter
# Edytuj docker-compose.yml (jeśli potrzeba)
docker-compose up -d
```

---

## 📖 Instrukcje szczegółowe

📖 **[UNRAID_DEPLOYMENT.md](./UNRAID_DEPLOYMENT.md)** ← Instrukcja krok po kroku

Zawiera:
- 3 metody wdrożenia (Community Apps, CLI, Docker Hub)
- Konfiguracja portów i folderów
- Troubleshooting
- Zaawansowana konfiguracja

---

## 📋 Wymagania

### Dla Windows/Mac/Linux
- Node.js 18+
- FFmpeg 4.4+
- npm lub yarn

### Dla Unraid
- Docker (wbudowany)
- ~2GB wolnego miejsca
- Folder na dysku array (np. `/mnt/user/media`)

---

## 🏗️ Instalacja lokalna

### 1. Klonuj repozytorium
```bash
git clone https://github.com/yourusername/x265-converter.git
cd x265-converter
```

### 2. Zainstaluj zależności
```bash
npm install
```

### 3. Uruchom serwer
```bash
npm start
# Serwer nasłuchuje na http://localhost:3001
```

### 4. Uruchom w trybie Electron (desktop app)
```bash
npm run electron
```

---

## 🐳 Docker

### Budowanie
```bash
docker build -t x265-converter:latest .
```

### Uruchomienie
```bash
docker run -d \
  --name x265-converter \
  -p 3001:3001 \
  -v /mnt/user/media:/data \
  -v /mnt/user/appdata/x265-converter/tmp:/tmp/x265-converter \
  x265-converter:latest
```

---

## 📊 Architektura

```
┌─────────────────────────────────────┐
│         WebUI (localhost:3001)      │
│    HTML/CSS/JavaScript (vanilla)    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│     Node.js Backend (Express.js)    │
│  - Kolejka pracy                    │
│  - API endpoints                    │
│  - Streaming video                  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│     FFmpeg (libx265 / hevc_nvenc)   │
│  - Encoding                         │
│  - Video probing                    │
└──────────────────────────────────────┘
```

---

## 🔧 Konfiguracja

### Zmienne środowiska

```bash
PORT=3001                          # Port serwera
HOST=0.0.0.0                       # Nasłuchiwanie (0.0.0.0 = sieć)
PUBLIC_URL=http://localhost:3001   # URL do przeglądarki
AUTO_OPEN_BROWSER=0                # Otwieranie przeglądarki
FILE_OPEN_ENABLED=0                # Otwieranie plików
APP_TMP_DIR=./tmp                  # Folder tymczasowy
FFMPEG_PATH=/usr/bin/ffmpeg        # Ścieżka do ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe      # Ścieżka do ffprobe
```

### Pliki konfiguracyjne
- `.env` - zmienne środowiska
- `.env.example` - szablon
- `docker-compose.yml` - konfiguracja Docker
- `Dockerfile` - obraz Docker
- `x265-converter-unraid.xml` - template Unraid

---

## 💾 Struktura plików

```
x265-converter/
├── public/                    # Interfejs webowy
│   ├── index.html            # Główna strona
│   ├── preview.html          # Okno podglądu
│   ├── app.js                # Logika UI
│   ├── preview.js            # Logika podglądu
│   ├── style.css             # Style CSS
│   └── ...
├── server.js                 # Serwer Node.js/API
├── electron-main.js          # Main proces Electrona
├── preload.js                # Preload script Electrona
├── Dockerfile                # Obraz Docker
├── docker-compose.yml        # Konfiguracja Docker Compose
├── x265-converter-unraid.xml # Template dla Unraid
├── package.json              # Zależności npm
├── UNRAID_DEPLOYMENT.md      # Instrukcja Unraid
├── start-on-unraid.sh        # Skrypt startowy
└── tmp/                       # Pliki tymczasowe
```

---

## 🎮 Użycie

### WebUI (http://localhost:3001)

1. **Wybór folderu** → Skanuj pliki video
2. **Zaznacz pliki** → Dodaj do kolejki
3. **Ustaw parametry**:
   - Jakość (20%-80%)
   - CPU vs GPU
   - Profil kodowania
4. **Konwertuj** → Uruchom kolejkę
5. **Podgląd** → Porównaj oryginał z wynikiem (live preview)

### API

```bash
# Skanuj folder
curl -X POST http://localhost:3001/api/scan \
  -H "Content-Type: application/json" \
  -d '{"sourcePath":"/data/videos"}'

# Dodaj do kolejki
curl -X POST http://localhost:3001/api/queue/add \
  -H "Content-Type: application/json" \
  -d '{...job config...}'

# Start konwersji
curl -X POST http://localhost:3001/api/queue/start

# Status
curl http://localhost:3001/api/health
curl http://localhost:3001/api/queue/status
```

---

## 📈 Parametry konwersji

### Jakość (20%-80%)
- **20%**: Mała jakość, mały rozmiar (testowanie)
- **30%-50%**: Średnia jakość, średni rozmiar
- **70%-80%**: Wysoka jakość, duży rozmiar

### Silnik kodowania
- **CPU (libx265)**: Uniwersalny, wszędzie działa
- **GPU (hevc_nvenc)**: Szybki, wymaga NVIDIA

### Profile
- **Slow/P5**: Najlepsza kompresja (najwolniej)
- **Medium/P4**: Balans jakości i prędkości
- **Fast/P2**: Szybka konwersja (gorsza jakość)

---

## 🐛 Troubleshooting

### Konwersja nie startuje
```bash
# Sprawdź status
curl http://localhost:3001/api/health

# Logi serwera
npm start  # lub docker logs x265-converter
```

### Brak dostępu z innej maszyny
```bash
# Sprawdź czy HOST=0.0.0.0
env | grep HOST

# Sprawdź port
netstat -tulpn | grep 3001  # Linux
netstat -ano | findstr 3001  # Windows
```

### FFmpeg nie znaleziony
```bash
# Sprawdź instalację
ffmpeg -version
ffprobe -version

# Ustaw ścieżkę
export FFMPEG_PATH=/usr/bin/ffmpeg
export FFPROBE_PATH=/usr/bin/ffprobe
```

---

## 📝 Logs

### Serwer Node.js
```bash
# Live logs
npm start

# Lub z docker
docker logs -f x265-converter

# Plik logu (jeśli konfigurowany)
tail -f /tmp/x265-converter/x265-converter.log
```

---

## 🔒 Bezpieczeństwo

⚠️ **Ważne**: Aplikacja powinna być dostępna tylko z zaufanej sieci!

Rekomendacje:
1. Wdrażaj tylko w sieci lokalnej
2. Nie udostępniaj publicznie bez VPN/proxy
3. Regularnie aktualizuj dependencje: `npm audit`
4. Sprawdzaj logi pod kątem podejrzanych aktywności

---

## 📦 Publikacja na Docker Hub

```bash
# Login
docker login -u yourname

# Tag
docker tag x265-converter:latest yourname/x265-converter:latest

# Push
docker push yourname/x265-converter:latest

# Użycie na innym serwerze
docker pull yourname/x265-converter:latest
docker run -d -p 3001:3001 yourname/x265-converter:latest
```

---

## 🤝 Wkład

Jeśli znalazłeś błąd lub masz sugestię:
1. Fork repozytorium
2. Stwórz branch: `git checkout -b feature/nazwa`
3. Commit: `git commit -am 'Add feature'`
4. Push: `git push origin feature/nazwa`
5. Otwórz Pull Request

---

## 📄 Licencja

MIT License - bezpłatne do użytku komercyjnego i prywatnego

---

## 📞 Wsparcie

- 📖 **Dokumentacja**: [UNRAID_DEPLOYMENT.md](./UNRAID_DEPLOYMENT.md)
- 🐛 **Błędy**: GitHub Issues
- 💬 **Dyskusje**: GitHub Discussions

---

## 🙏 Podziękowania

- FFmpeg Team (ffmpeg.org)
- Electron (electronjs.org)
- Express.js (expressjs.com)
- x265 (videolan.org)

---

## ⭐ Version

```
v1.0.0 - x265-Converter
- Docker support ✅
- Unraid template ✅
- Live preview ✅
- Metadata tagging ✅
- Queue management ✅
- Turbo mode ✅
```

---

**Śledź tego projektu** ⭐ jeśli Ci się podoba!

