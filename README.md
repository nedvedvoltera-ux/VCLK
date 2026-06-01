# LiveKit local MVP

Минимальный проект для быстрого старта:

- `docker-compose` поднимает `redis` + `egress` для серверной записи
- `livekit-bin/livekit-server.exe` поднимает LiveKit signaling/media сервер
- `server` генерирует JWT токен для входа в комнату
- `web` дает простой UI для подключения к комнате
- запись в комнате использует LiveKit Egress API

## 1) Запуск Redis + Egress (для записи)

Требуется Docker Desktop.

```bash
docker compose up -d redis egress
```

Проверка:

```bash
docker compose ps
```

Ожидается, что сервисы `redis` и `egress` в статусе `Up`.

## 2) Запуск LiveKit

```bash
./livekit-bin/livekit-server.exe --config ./livekit.yaml
```

`livekit.yaml` уже настроен на Redis (`localhost:6379`), это нужно для работы Egress.

Порты LiveKit:

- `7888/tcp` — signaling/API
- `7882/tcp` — WebRTC TCP fallback
- `50000-50100/udp` — медиатрафик (для локального MVP диапазон уменьшен)

## 3) Запуск token server

```bash
cd server
npm install
npm run dev
```

По умолчанию:

- `http://localhost:3101/health`
- `http://localhost:3101/token?room=demo-room&username=alice`

Опционально можно создать `server/.env` по шаблону `server/.env.example`.

## 4) Запуск UI

```bash
cd web
npm install
npm run dev
```

Откройте URL из Vite (теперь `https://localhost:5173`), заполните:

- `Your name`
- `Room`
- `Token server URL` (обычно тот же origin, например `https://localhost:5173`)

Нажмите **Join room**.

### HTTPS для других устройств

При заходе с другого устройства используйте `https://<IP-адрес-хоста>:5173` и подтвердите self-signed сертификат в браузере.
Через Vite-прокси запросы `/token` и LiveKit signaling (`/livekit`) идут в локальные сервисы без mixed-content ошибок.

## 5) Проверка нескольких клиентов

Откройте UI на двух устройствах/вкладках:

- одинаковая `Room`
- разные `Your name`

После подключения клиенты должны видеть и слышать друг друга.

## 6) Запись (LiveKit Egress)

В интерфейсе комнаты есть кнопка `Начать запись / Остановить запись`.

Backend эндпоинты:

- `POST /recording/start` c body `{ "room": "demo-room" }`
- `POST /recording/stop` c body `{ "room": "demo-room" }`
- `GET /recording/status?room=demo-room`

Важно: для фактической записи нужен подключенный сервис **egress** (обычно вместе с Redis).

Если видите ошибку `egress not connected (redis required)`, это почти всегда значит, что не запущены `redis/egress` или LiveKit запущен без Redis-конфига.

### Просмотр записей по URL

После запуска backend доступна страница:

- `http://localhost:3101/recordings`
- `https://localhost:5173/recordings` (через Vite proxy, удобно для dev UI)

Она защищена Basic Auth. Логин/пароль берутся из `server/.env`:

- `RECORDINGS_VIEW_USER`
- `RECORDINGS_VIEW_PASSWORD`

Видео файлы физически сохраняются в папке:

- `recordings/` (в корне проекта)

## 7) Прод-стек на Linux через Docker

В репозитории есть готовый набор:

- `docker-compose.prod.yml` — полный стек (`web`, `server`, `livekit`, `redis`, `egress`)
- `web/Dockerfile` — production build UI + Nginx
- `server/Dockerfile` — backend контейнер
- `livekit.prod.yaml` и `egress.prod.yaml` — конфиги LiveKit/Egress для контейнерной сети
- `livekit.prod.turn.yaml` — пример prod-конфига со встроенным TURN
- `deploy.sh` — простой скрипт деплоя

### Быстрый запуск на сервере

```bash
git clone <your-repo-url>
cd livekitproj
cp .env.prod.example .env
cp server/.env.example server/.env
mkdir -p recordings
chmod +x deploy.sh
./deploy.sh
```

UI будет доступен по:

- `http://<IP_сервера>:8080` (или другой порт из `WEB_PORT` в `.env`)

### Как собирать Docker руками (без скрипта)

```bash
docker compose -f docker-compose.prod.yml build web server
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=200
```

### Как накатывать обновления

```bash
git pull
./deploy.sh
```

### Сетевое хранилище для записей

В `.env` (в корне проекта) задайте:

```bash
RECORDINGS_HOST_PATH=/mnt/dfs/livekit-recordings
```

И смонтируйте вашу DFS/SMB шару в этот путь средствами Linux (`cifs`/`fstab`/systemd mount).

### Встроенный TURN для B2B-сетей

В прод-стеке уже подготовлен шаблон `livekit.prod.turn.yaml`.

1. В `.env` (корень проекта) укажите:

```bash
LIVEKIT_CONFIG_FILE=./livekit.prod.turn.yaml
```

2. В `livekit.prod.turn.yaml` обязательно задайте:

- `turn.domain` — публичный DNS TURN (например `turn.vks.company.ru`)
- TLS вариант:
  - либо `cert_file` + `key_file` (если LiveKit сам терминирует TURN/TLS)
  - либо `external_tls: true` (если TLS терминируется на L4 балансировщике)

3. Откройте порты на сервере/firewall:

- `3478/udp` — TURN/UDP (+ STUN)
- `5349/tcp` — TURN/TLS
- `30000-40000/udp` — TURN relay диапазон
- дополнительно LiveKit:
  - `7888/tcp`, `7882/tcp`, `50000-50100/udp`

4. Перезапуск:

```bash
./deploy.sh
```

Примечание: если включить TURN/TLS без валидной TLS-схемы (сертификаты или external TLS), часть клиентов из корпоративных сетей не сможет подключаться через TURN/TLS.

## 8) Dev-режим полностью в Docker (hot reload)

Если хотите разрабатывать локально, но чтобы все сервисы исполнялись в контейнерах, используйте:

- `docker-compose.dev.yml`
- `livekit.dev.yaml`
- `egress.dev.yaml`

### Первый запуск dev-стека

```bash
cp server/.env.example server/.env
mkdir -p recordings
docker compose -f docker-compose.dev.yml up -d
```

Доступ:

- UI (Vite): `https://localhost:5173`
- Backend: `http://localhost:3101`

### Разработка

- меняете код в `web/src` или `server/index.js`
- изменения подхватываются внутри контейнеров автоматически (`vite` + `node --watch`)

### Полезные команды

```bash
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f --tail=200 web server livekit egress
docker compose -f docker-compose.dev.yml down
```
