# WestForge Audio Server

Маленький сервис, который даёт приложению **обычный аудио-поток** вместо YouTube-плеера.
Телефон стримит звук отсюда → нативный плеер играет его в фоне на любом устройстве.

```
Телефон ──/stream/<videoId>──► этот сервер ──yt-dlp──► YouTube
Телефон ◄──────── audio ───────┘ (кэш на диске)
```

Поиск треков остаётся в приложении (YouTube Data API). Сервер только достаёт звук.

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/health` | Проверка живости (цель для keep-alive пинга) |
| GET | `/stream/:videoId` | Аудио-поток трека (поддерживает Range/перемотку) |
| GET | `/prefetch/:videoId` | Заранее скачать в кэш, не отдавая (опционально) |

`videoId` — это 11-символьный id ролика YouTube. Если задан `ACCESS_TOKEN`,
добавляй `?token=...` или заголовок `X-Access-Token`.

## Переменные окружения

| Имя | По умолчанию | Зачем |
|---|---|---|
| `PORT` | `8080` | Render задаёт сам |
| `CACHE_DIR` | `./cache` | Где хранить скачанное |
| `MAX_CACHE_MB` | `2048` | Лимит кэша (LRU-вытеснение) |
| `ACCESS_TOKEN` | — | Если задан — закрывает сервер токеном |
| `YTDLP_FORMAT` | `bestaudio[ext=m4a]/bestaudio` | Формат звука |
| `COOKIES_CONTENT` | — | Содержимое cookies.txt (если YouTube блокирует IP) |
| `COOKIES_FILE` | — | Путь к готовому cookies.txt |

## Запуск локально (проверка)

```bash
cd server
npm install
node index.js
# в браузере открой: http://localhost:8080/stream/qU9mHegkTc4  → должен заиграть трек
```

## Деплой на Render (бесплатно)

1. Залей репозиторий на GitHub.
2. Render → **New + → Blueprint** → выбери репозиторий (он прочитает `server/render.yaml`).
   Либо вручную: **New + → Web Service → Docker**, Root Directory = `server`.
3. После деплоя скопируй сгенерированный `ACCESS_TOKEN` (Render → Environment) —
   он понадобится в приложении.
4. URL вида `https://westforge-audio.onrender.com`.

### Анти-сон (Render Free засыпает после 15 мин)

Заведи внешний пингер на `https://<твой-сервис>.onrender.com/health`
каждые ~10 минут:

- [cron-job.org](https://cron-job.org) или [UptimeRobot](https://uptimerobot.com) — бесплатно.

> ⚠️ Render Free: диск **эфемерный** (кэш стирается при перезапуске) и IP
> дата-центра — YouTube может потребовать «подтвердите, что вы не бот». Если
> увидишь ошибки `extract failed` — задай `COOKIES_CONTENT` (cookies.txt
> залогиненного Google-аккаунта) или перенеси контейнер на VPS/домашний ПК.

## Деплой на VPS / домашний ПК

```bash
cd server
docker compose up -d --build
# сервер на :8080, кэш в ./cache
```

Обнови yt-dlp при поломках извлечения: пересобери образ
(`docker compose build --no-cache`) — он тянет свежий бинарь yt-dlp.

## Если YouTube начал блокировать (extract failed)

1. Экспортируй cookies из браузера (расширение «Get cookies.txt LOCALLY»),
   открой YouTube залогиненным.
2. Содержимое файла положи в `COOKIES_CONTENT` (Render) или смонтируй файл и
   укажи `COOKIES_FILE`.
3. Самый надёжный лекарь от блокировок — резидентный IP (домашний ПК/Raspberry).
