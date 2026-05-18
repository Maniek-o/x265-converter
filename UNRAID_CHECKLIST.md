# ✅ x265-Converter na Unraid - Checklist Wdrożenia

## 📋 PRE-DEPLOYMENT

- [ ] Unraid 6.11+ jest zainstalowany
- [ ] Docker jest dostępny (domyślnie jest)
- [ ] Masz dostęp SSH do Unraid (lub Terminal w WebUI)
- [ ] Masz co najmniej 2GB wolnego miejsca
- [ ] Masz IP Unraid (np. 192.168.1.100)

---

## 🎯 WYBÓR METODY

### ✅ METODA 1: Community Applications (Easiest)
```
( ) 1. Unraid WebUI → Apps
( ) 2. Search "x265-converter"
( ) 3. Click Install
( ) 4. Konfiguruj porty i foldery
( ) 5. Click Apply
( ) 6. Otwórz http://IP:3001
```

### ✅ METODA 2: Terminal + Docker (Recommended)
```
( ) 1. SSH do Unraid lub Utilities → Terminal
( ) 2. mkdir -p /mnt/user/x265-converter
( ) 3. cd /mnt/user && git clone <repo>
( ) 4. cd x265-converter
( ) 5. docker build -t x265-converter:latest .
( ) 6. ./start-on-unraid.sh
( ) 7. Otwórz http://IP:3001
```

### ✅ METODA 3: Docker Compose
```
( ) 1. SSH lub Terminal
( ) 2. cd /mnt/user/x265-converter
( ) 3. docker-compose up -d
( ) 4. docker logs -f x265-converter
( ) 5. Otwórz http://IP:3001
```

---

## 🔧 KONFIGURACJA FOLDERY/VOLUMES

Muszą istnieć przed uruchomieniem:

```
( ) /mnt/user/media
    └─ Tutaj będą źródłowe video i wyniki konwersji
    
( ) /mnt/user/appdata/x265-converter/tmp
    └─ Folder roboczy, cache, tymczasowe pliki
```

Jeśli nie istnieją, stwórz je:
```bash
mkdir -p /mnt/user/media
mkdir -p /mnt/user/appdata/x265-converter/tmp
chmod 777 /mnt/user/appdata/x265-converter/tmp
```

---

## 🔌 ZMIENNE ŚRODOWISKA

Wymagane (zmień na Twoje wartości):

| Zmienna | Wartość | Opis |
|---------|---------|------|
| `PORT` | `3001` | Port serwera |
| `HOST` | `0.0.0.0` | Nasłuchiwanie (0.0.0.0 = dostępne sieciowo) |
| `PUBLIC_URL` | `http://192.168.1.100:3001` | Zamień IP na Twoje |
| `AUTO_OPEN_BROWSER` | `0` | Nie otwieraj (dla Unraid) |
| `FILE_OPEN_ENABLED` | `0` | Wyłącz otwieranie plików |

Opcjonalne (dla wydajności):

| Zmienna | Domyślnie | Opis |
|---------|----------|------|
| `CPU_LIMIT` | `4` | Max rdzeni CPU |
| `MEMORY_LIMIT` | `2G` | Max RAM |

---

## 🚀 URUCHOMIENIE

### Start kontenera
```bash
( ) docker start x265-converter
( ) Czekaj 5 sekund
( ) Sprawdź logi: docker logs x265-converter
( ) Powinno być: "Nasłuchiwanie na http://0.0.0.0:3001"
```

### Sprawdzenie zdrowia
```bash
( ) curl http://localhost:3001/api/health
( ) Powinno być: { "ok": true, ... }
```

### Dostęp z przeglądarki
```bash
( ) Otwórz: http://192.168.1.100:3001  (zamień IP)
( ) Powinna się załadować aplikacja
( ) Interface powinien być responsywny
```

---

## ✅ FIRST RUN TEST

1. **Przeskanuj folder**
```
( ) Kliknij "Przeskanuj folder"
( ) Wstaw ścieżkę: /data  (lub /data/subfolder)
( ) Czekaj aż pojawią się pliki
( ) Powinna być lista video w formacie .mp4, .mkv, .avi itp
```

2. **Dodaj do kolejki**
```
( ) Zaznacz jeden plik (kliknij checkbox)
( ) Ustaw parametry konwersji (np. 30%, CPU)
( ) Kliknij "Dodaj do kolejki" lub "Dodaj wszystkie"
( ) Plik powinien pojawić się w sekcji "Kolejka"
```

3. **Uruchom konwersję**
```
( ) Kliknij "Konwertuj / Start"
( ) Czekaj aż job zmieni status na "processing"
( ) Monitor powinien pokazać postęp (%)
( ) Logi powinny pokazać linię ffmpeg
```

4. **Sprawdź wynik**
```
( ) Czekaj aż konwersja się skończy
( ) Status powinien zmienić się na "completed"
( ) Plik wynikowy powinien pojawić się w /mnt/user/media
( ) Rozmiar powinien być mniejszy niż oryginał (np. 30% - mniejsze file)
```

---

## 🔍 TROUBLESHOOTING

### Kontener nie startuje
```bash
( ) docker ps -a | grep x265-converter
    Jeśli status = "Exited", to:
( ) docker logs x265-converter
( ) Szukaj erroru (np. "port already in use")
( ) Jeśli port zajęty: zmień port z 3001 na inny (np. 3002)
```

### Aplikacja nie odpowiada
```bash
( ) curl http://localhost:3001/
    Jeśli timeout/connection refused, to:
( ) docker ps | grep x265-converter
    Jeśli nie ma, to: docker start x265-converter
( ) docker logs -f x265-converter
    Czekaj aż pojawi się: "Nasłuchiwanie"
```

### FFmpeg nie znaleziony
```bash
( ) docker exec x265-converter ffmpeg -version
    Jeśli brak:
( ) docker exec x265-converter ffprobe -version
( ) Odbuduj obraz: docker build --no-cache -t x265-converter:latest .
```

### Brak dostępu z innej maszyny
```bash
( ) Sprawdź IP Unraid: hostname -I
( ) Sprawdź firewall: netstat -tulpn | grep 3001
( ) Sprawdź czy HOST=0.0.0.0 w kontenerze
( ) Spróbuj: http://192.168.X.X:3001 (zamień X)
```

### Encoding très wolny
```bash
( ) docker stats x265-converter
    Sprawdź CPU % - jeśli <100%, to:
( ) docker-compose.yml → deploy.resources
( ) Zwiększ CPU limit na dostępne rdzenie
( ) Restart kontenera: docker restart x265-converter
```

---

## 📊 MONITORING

### Bieżące logi
```bash
( ) docker logs -f x265-converter
```

### Statystyki zasobów
```bash
( ) docker stats x265-converter
    Monitoring: CPU, Memory, Network
```

### Status kontenera
```bash
( ) docker ps | grep x265-converter
    Running? Uptime? Restarts?
```

### Health check
```bash
( ) curl http://localhost:3001/api/health
    Sprawdza: ffmpeg path, job queue, CPU usage
```

---

## 🎯 POST-DEPLOYMENT

### Optymalizacja
- [ ] Ustaw limity CPU/RAM w docker-compose.yml
- [ ] Przesunięcie folderu tmp na szybsze medium (cache pool?)
- [ ] Cron job do czyszczenia starych plików tymczasowych
- [ ] Backup konfiguracji aplikacji

### Monitoring długoterminowy
- [ ] Ustaw alertowanie na pełny dysk
- [ ] Monitor użycia CPU podczas batch encoding
- [ ] Logging errów konwersji (ffmpeg stderr)

### Autostart Unraid
- [ ] Dodaj do `/boot/config/go` lub use autorun na reboot
```bash
# Jeśli chcesz aby startował automatycznie:
# Dodaj do /boot/config/go:
docker start x265-converter
```

---

## 📝 NOTES

Zapisz tutaj swoje ustawienia:

```
IP Unraid: _______________
Port: _______________
Media folder: _______________
Temp folder: _______________
URL dostępu: _______________
CPU limit: _______________
RAM limit: _______________
```

---

## ✨ Wszystko gotowe!

Jeśli wszystkie checklisty są zaznaczone ✅, Twoja aplikacja powinna działać bez problemów!

---

## 🆘 Dodatkowa pomoc

📖 **Szczegółowa instrukcja**: [UNRAID_DEPLOYMENT.md](./UNRAID_DEPLOYMENT.md)

🐛 **Bądź w kontakcie**: GitHub Issues lub dokumentacja

