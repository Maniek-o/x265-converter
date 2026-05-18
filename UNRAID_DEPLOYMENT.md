# 🎬 x265-Converter na Unraid - Instrukcja wdrożenia

## 📋 Spis treści
1. [Przygotowanie](#przygotowanie)
2. [Metoda 1: Unraid Community Applications (NAJŁATWIEJ)](#metoda-1-unraid-community-applications)
3. [Metoda 2: Docker CLI na Unraid](#metoda-2-docker-cli-na-unraid)
4. [Metoda 3: Budowanie i push do Docker Hub](#metoda-3-budowanie-i-push-do-docker-hub)
5. [Konfiguracja](#konfiguracja)
6. [Uruchamianie](#uruchamianie)
7. [Troubleshooting](#troubleshooting)

---

## Przygotowanie

### Wymagania
- **Unraid OS** (6.11+)
- **Docker** (zainstalowany domyślnie na Unraid)
- **Dostęp SSH** lub **Unraid Terminal** (dostępne w WebUI)
- Folder na dysku Unraid: `/mnt/user/media` lub inny
- ~2GB wolnego miejsca na kontener

### Sprawdzenie wersji Unraid
```bash
cat /etc/unraid-version
```

---

## Metoda 1: Unraid Community Applications (NAJŁATWIEJ)

### Krok 1: Zainstaluj Community Applications
1. W Unraid WebUI przejdź do: **Apps** → **Community Applications** (jeśli nie masz, zainstaluj z App Store)

### Krok 2: Dodaj szablon kontenera

**Opcja A: GitHub (Jeśli masz projekt na GitHub)**

1. Wejdź do: **Apps** → **Community Applications**
2. Kliknij: **Add Container** (lub **Browse Custom** jeśli dostępne)
3. W pole **Repository URL** wstaw:
   ```
   https://raw.githubusercontent.com/TWOJA_NAZWA/x265-converter/main/x265-converter-unraid.xml
   ```
   (Zamień `TWOJA_NAZWA` na Twoją nazwę GitHub)

4. Aplikacja automatycznie pobierze szablon i pokaże formularz konfiguracji

**Opcja B: Bez GitHub (Wklejenie XML)**

1. Pobierz plik [x265-converter-unraid.xml](./x265-converter-unraid.xml)
2. Otwórz go w edytorze tekstu
3. Skopiuj **całą zawartość**
4. W Unraid WebUI: **Apps** → **Install Community Applications** 
5. Wklej XML do pola tekstowego
6. Kliknij **Install**

**Opcja C: Wyszukiwanie w Community Apps**

1. Jeśli szablon jest już w oficjalnym repozytorium Unraid:
   - Wejdź do: **Apps** → **Community Applications**
   - Wyszukaj: `x265-converter`
   - Kliknij **Install**

### Krok 3: Konfiguracja i start
Wymagane ustawienia w formularzu:
- **Web UI Port**: `3001`
- **Media Folder**: `/mnt/user/media` (lub dowolny inny folder z plikami)
- **Temp Folder**: `/mnt/user/appdata/x265-converter/tmp`
- **PUBLIC_URL**: `http://IP_UNRAID:3001` (zamień IP_UNRAID na IP Twojej maszyny)

Kliknij: **Add** → Kontener się zbuduje i uruchomi

### Krok 4: Otwórz interfejs
```
http://192.168.X.X:3001
```
(Zamień `192.168.X.X` na IP Twojego Unraid)

---

## Metoda 2: Docker CLI na Unraid

### Krok 1: Otwórz terminal Unraid
1. W WebUI Unraid: **Utilites** → **Terminal** (lub SSH)

### Krok 2: Klonuj repozytorium
```bash
cd /mnt/user
git clone https://github.com/yourusername/x265-converter.git
cd x265-converter
```

Jeśli nie masz gita:
```bash
# Pobierz jako ZIP z GitHub i rozpakuj
```

### Krok 3: Budowanie obrazu (na Unraid)
```bash
docker build -t x265-converter:latest .
```

Jeśli chcesz, żeby Unraid pokazywał przycisk Update, użyj obrazu publikowanego do GHCR:
```bash
ghcr.io/maniek-o/x265-converter:latest
```
⏱️ Pierwsze budowanie może trwać 3-5 minut (pobieranie pakietów)

### Krok 4: Tworzenie folderu dla temp i appdata
```bash
mkdir -p /mnt/user/appdata/x265-converter/tmp
chmod 777 /mnt/user/appdata/x265-converter/tmp
```

### Krok 4b: Ręczne odświeżenie z GHCR
```bash
docker pull ghcr.io/maniek-o/x265-converter:latest
docker restart x265-converter
```

### Krok 5: Uruchomienie kontenera
```bash
docker run -d \
  --name x265-converter \
  -p 3001:3001 \
  --restart unless-stopped \
  -e HOST=0.0.0.0 \
  -e PORT=3001 \
  -e PUBLIC_URL="http://192.168.X.X:3001" \
  -e AUTO_OPEN_BROWSER=0 \
  -e FILE_OPEN_ENABLED=0 \
  -v /mnt/user/media:/data \
  -v /mnt/user/appdata/x265-converter/tmp:/tmp/x265-converter \
  x265-converter:latest
```

**Zamień** `192.168.X.X` **na IP Twojego Unraid**

### Krok 6: Sprawdzenie statusu
```bash
docker ps -a | grep x265-converter
docker logs x265-converter
```

### Krok 7: Otwórz aplikację
```
http://192.168.X.X:3001
```

---

## Metoda 3: Budowanie i push do Docker Hub

### Krok 1: Zaloguj się do Docker Hub
```bash
docker login -u yourdockerlogin
```

### Krok 2: Buduj i tag
```bash
docker build -t yourdockerlogin/x265-converter:latest .
```

### Krok 3: Push na Docker Hub
```bash
docker push yourdockerlogin/x265-converter:latest
```

### Krok 4: Na Unraid, pull z Docker Hub
```bash
docker pull yourdockerlogin/x265-converter:latest
docker run -d --name x265-converter -p 3001:3001 \
  -v /mnt/user/media:/data \
  -v /mnt/user/appdata/x265-converter/tmp:/tmp/x265-converter \
  yourdockerlogin/x265-converter:latest
```

---

## Konfiguracja

### Zmienne środowiska (Environment Variables)

| Zmienna | Domyślnie | Opis |
|---------|-----------|------|
| `PORT` | `3001` | Port serwera |
| `HOST` | `0.0.0.0` | Nasłuchiwanie (0.0.0.0 = z sieci) |
| `PUBLIC_URL` | `http://localhost:3001` | URL dostępu (dla linków w mailu, itd.) |
| `AUTO_OPEN_BROWSER` | `0` | Otwieranie przeglądarki (wyłączane dla Unraid) |
| `FILE_OPEN_ENABLED` | `0` | Otwieranie plików z backendu (wyłączane) |
| `APP_TMP_DIR` | `/tmp/x265-converter` | Folder tymczasowy |
| `NODE_ENV` | `production` | Tryb Node.js |

### Foldery (Volumes)

| Wewnątrz kontenera | Na Unraid | Opis |
|-------------------|-----------|------|
| `/data` | `/mnt/user/media` (lub inny) | Źródłowe pliki video + wyniki |
| `/tmp/x265-converter` | `/mnt/user/appdata/x265-converter/tmp` | Cache, pliki tymczasowe |
| `/downloads` | `/mnt/user/downloads` | (Opcjonalnie) Wyniki konwersji |

### Limity zasobów
Domyślnie (w docker-compose.yml):
- **CPU**: max 4 rdzenie, min 2 rdzenie
- **RAM**: max 2GB, min 1GB

Możesz zmienić w `docker-compose.yml` sekcja `deploy.resources`

---

## Uruchamianie

### Start kontenera
```bash
docker start x265-converter
```

### Zatrzymanie kontenera
```bash
docker stop x265-converter
```

### Restart
```bash
docker restart x265-converter
```

### Usunięcie kontenera
```bash
docker rm x265-converter
# Usuń obraz
docker rmi x265-converter:latest
```

### Sprawdzenie logów
```bash
docker logs -f x265-converter
# Wyjście: [server] Nasłuchiwanie na http://0.0.0.0:3001/
```

---

## Troubleshooting

### Problem: Kontener nie startuje
```bash
# Sprawdź logi
docker logs x265-converter

# Typowe błędy:
# 1. Port 3001 już zajęty
#    → Zmień port: -p 3002:3001

# 2. Brak uprawnienia do folderu
#    → Uprawnienia: chmod 777 /mnt/user/media
```

### Problem: Aplikacja nie odpowiada
```bash
# Sprawdź czy kontener żyje
docker ps | grep x265-converter

# Jeśli nie ma, restart
docker restart x265-converter
```

### Problem: Konwersja nie działa
```bash
# Sprawdź czy ffmpeg działa wewnątrz kontenera
docker exec x265-converter ffmpeg -version
docker exec x265-converter ffprobe -version

# Jeśli brak, przebuduj obraz
docker build --no-cache -t x265-converter:latest .
```

### Problem: Brak dostępu z innej maszyny
```bash
# 1. Sprawdź firewall Unraid
#    → Ports: 3001 musi być otwarty

# 2. Sprawdź czy HOST=0.0.0.0 w zmiennych
#    → Jeśli jest localhost/127.0.0.1, zmień na 0.0.0.0

# 3. Sprawdź IP Unraid
#    → Unraid WebUI → right top → Network Info
```

### Problem: Encoding bardzo wolny
```bash
# Sprawdź użycie CPU
docker stats x265-converter

# Jeśli CPU <100% → zwiększ limity CPU w docker-compose.yml
# Jeśli dysk wolny <1GB → usuń stare konwersje
```

---

## Zaawansowana konfiguracja

### Docker Compose (alternatywa do docker run)
```bash
# Na Unraid w folderze x265-converter:
docker-compose up -d
docker-compose down
docker-compose logs -f
```

### Odtworzenie kontenera w Unraid WebUI
1. **Docker** tab → **Containers** → `x265-converter` → Edit → Update

### Automatyczne backupy
Ustaw cron job w Unraid:
```bash
# Codziennie o 2:00 backup /mnt/user/appdata/x265-converter
# Unraid WebUI → Utilities → Cron Jobs (z plugina cron)
```

---

## Informacje ogólne

### Lokalne ścieżki na Unraid
- `/mnt/user/` - dane użytkownika (dyski array)
- `/mnt/cache/` - cache pool (jeśli istnieje)
- `/mnt/nvme/` - NVMe (jeśli masz)

### Przydatne polecenia
```bash
# IP Unraid
ip addr | grep inet

# Wolne miejsce
df -h /mnt/user/

# Procesy Docker
docker ps -a
docker stats

# Usunięcie niezużywanych obrazów
docker image prune -a -f
```

---

## ✅ Podsumowanie konfiguracji

| Element | Wartość |
|---------|---------|
| **Port** | `3001` |
| **URL** | `http://IP_UNRAID:3001` |
| **Folder media** | `/mnt/user/media` |
| **Folder temp** | `/mnt/user/appdata/x265-converter/tmp` |
| **Restart** | `unless-stopped` (auto-start) |
| **Encoding** | Na maszynie Unraid (ffmpeg) |
| **Interface** | WebUI (dostępny z każdej maszyny) |

---

## 🚀 Quick Start (TL;DR)

1. **SSH do Unraid**:
   ```bash
   ssh root@YOUR_UNRAID_IP
   ```

2. **Klonuj repo**:
   ```bash
   cd /mnt/user && git clone https://github.com/yourusername/x265-converter.git
   ```

3. **Buduj obraz**:
   ```bash
   cd x265-converter && docker build -t x265-converter:latest .
   ```

4. **Uruchom kontener**:
   ```bash
   docker run -d --name x265-converter -p 3001:3001 \
     -e PUBLIC_URL="http://192.168.X.X:3001" \
     -v /mnt/user/media:/data \
     -v /mnt/user/appdata/x265-converter/tmp:/tmp/x265-converter \
     x265-converter:latest
   ```

5. **Otwórz przeglądarkę**:
   ```
   http://192.168.X.X:3001
   ```

---

## 📞 Pomoc

- Logi: `docker logs x265-converter`
- Status: `docker ps`
- Zasoby: `docker stats x265-converter`

---

## 🔗 FAQ - Szablon i URL

### P: Skąd skopiować URL szablonu?

**A:** Są 3 opcje:

1. **Jeśli masz GitHub (REKOMENDOWANE)**
   ```
   https://raw.githubusercontent.com/TWOJA_NAZWA/x265-converter/main/x265-converter-unraid.xml
   ```
   - Wklej ten URL w Unraid WebUI → Apps → Add Container → Repository URL
   - Zamień `TWOJA_NAZWA` na Twoją nazwę GitHub

2. **Bez GitHub (Ręczne wklejenie)**
   - Pobierz plik `x265-converter-unraid.xml` z projektu
   - Otwórz w Notepad i skopiuj zawartość
   - W Unraid: Apps → Install Community Applications → wklej XML

3. **Jeśli jest w oficjalnym repo**
   - Apps → Community Applications → Wyszukaj "x265-converter"

### P: Jak opublikować na GitHub?

1. Stwórz konto na github.com
2. Utwórz nowe repozytorium
3. Wrzuć cały folder `x265-converter`
4. Ustaw na "Public"
5. URL szablonu: `https://raw.githubusercontent.com/TWOJA_NAZWA/x265-converter/main/x265-converter-unraid.xml`

### P: Czy mogę hostować szablonu gdzie indziej?

Tak! Możesz opublikować XML na:
- Gist (https://gist.github.com) - raw URL
- Pastebin - raw URL
- Własny serwer - HTTP URL do pliku
- Gitlab, Gitea, itp - raw URL do XML

Ważne: URL musi wskazywać bezpośrednio na plik XML, nie na stronę HTML.

