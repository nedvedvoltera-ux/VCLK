# Чеклист пользовательских функций VKS

Источник истины для ручной проверки и покрытия unit-тестами.
При добавлении функции в UI: обновить этот файл, `GLOSSARY.md` и тесты.

Легенда статусов тестов: `unit` — автотест есть; `manual` — только ручная проверка; `e2e-later` — кандидат на Playwright позже.

---

## A. Комната ожидания (pre-join)

| ID | Функция | Где в UI | Тест |
|----|---------|----------|------|
| A01 | Deep-link: предзаполнение комнаты из `?room=` | Поле «Код комнаты» | unit |
| A02 | Deep-link: предзаполнение имени из `?name=` | Поле «Ваше имя» | unit |
| A03 | Ввод отображаемого имени | Форма входа | unit (`canJoin`) |
| A04 | Ввод кода комнаты | Форма входа | unit (`canJoin`) |
| A05 | Ссылка-приглашение (read-only) | Поле «Ссылка-приглашение» | unit |
| A06 | Расширенные настройки: URL сервера токенов | Collapsible | manual |
| A07 | Кнопка «Войти» / «Подключение...» | Submit формы | unit + manual |
| A08 | Превью камеры (`getUserMedia`) | Hero preview | manual / e2e-later |
| A09 | Индикатор уровня микрофона | Микрофон OK / Нет сигнала | manual |
| A10 | Выбор камеры | Select «Камера» | manual |
| A11 | Выбор микрофона | Select «Микрофон» | manual |
| A12 | Сообщение о необходимости HTTPS | Ошибка превью | unit |
| A13 | Индикатор качества сети | «Интернет: X Мбит/с» | unit |
| A14 | Аватар-инициал (буква имени) | Hero avatar | manual |
| A15 | Заснять фото-аватар | Кнопка «Заснять» | manual / e2e-later |
| A16 | Отображение заснятого аватара | Hero image | manual |
| A17 | Ошибка входа (токен/аватар) | `.error` | manual |
| A18 | Ошибка устройств / прав доступа | Диагностика | manual |

## B. Комната общения (in-room)

| ID | Функция | Где в UI | Тест |
|----|---------|----------|------|
| B01 | Подключение к LiveKit по JWT | `LiveKitRoom` | manual / e2e-later |
| B02 | Воспроизведение чужого аудио | `RoomAudioRenderer` | manual |
| B03 | Toast состояния соединения | `ConnectionStateToast` | manual |
| B04 | Часы в топбаре | Слева сверху | manual |
| B05 | Название комнаты в топбаре | `<h2>` | manual |
| B06 | Счётчик участников | `N уч.` | manual |
| B07 | Бейдж REC при активной записи | `meet-rec-badge` | unit (парсинг статуса) |
| B08 | Показать / скрыть участников | Кнопка топбара | manual |
| B09 | Копировать ссылку-приглашение | Кнопка топбара | unit (сборка URL) |
| B10 | Выйти из комнаты | Кнопка «Выйти» | unit (сброс токена — логика) |
| B11 | Список участников | Боковая панель | manual |
| B12 | Подсветка говорящего в списке | `говорит` / `is-speaking` | manual |
| B13 | Видео-плитки участников | Stage | manual |
| B14 | Превью фото при выключенной камере | `meet-avatar-overlay` | unit (парсинг metadata) |
| B15 | Бейдж «Говорит: имя» на плитке | `meet-speaking-badge` | manual |
| B16 | Режим «фокус» (основной + миниатюры) | Desktop | unit (выбор трека) |
| B17 | Режим «сетка 2×2» | Desktop GridLayout | manual |
| B18 | Переключение вида фокус ↔ сетка | Меню ⚙ | manual |
| B19 | Mobile: 1 участник | Full tile | unit (раскладка) |
| B20 | Mobile: 2 участника (PiP) | Main + self preview | unit |
| B21 | Mobile: 3+ участников (стек) | Vertical stack | unit |
| B22 | Приоритет демонстрации экрана в порядке треков | Stage | unit |
| B23 | Плейсхолдер «Ожидание видео...» | Empty tile | manual |
| B24 | Микрофон вкл/выкл | ControlBar | manual / e2e-later |
| B25 | Камера вкл/выкл | ControlBar | manual / e2e-later |
| B26 | Демонстрация экрана | ControlBar | manual / e2e-later |
| B27 | Чат: открыть / закрыть | ControlBar + drawer | unit (группировка сообщений) |
| B28 | Чат: отправка сообщения | Форма чата | unit (валидация пустого) |
| B29 | Чат: история сообщений | Список | unit |
| B30 | Меню вида и записи | Кнопка ⚙ | manual |
| B31 | Начать запись | Пункт меню | unit (клиентский разбор ответа) |
| B32 | Остановить запись | Пункт меню | unit |
| B33 | Состояние «Обработка...» записи | Disabled button | manual |
| B34 | Ошибка записи | `meet-record-error` | unit |
| B35 | Синхронизация статуса записи (poll) | Фоновый fetch | unit |
| B36 | Возврат в комнату ожидания при disconnect | `onDisconnected` | manual |

## C. Архив записей (server HTML)

| ID | Функция | URL | Тест |
|----|---------|-----|------|
| C01 | Страница логина | `GET /recordings/login` | unit |
| C02 | Ошибка неверного логина/пароля | `?error=1` | unit |
| C03 | Успешный вход (cookie-сессия) | `POST /recordings/login` | unit |
| C04 | Список записей `.mp4` | `GET /recordings` | unit |
| C05 | Просмотр выбранного файла | `?file=` | unit (path safety) |
| C06 | Стрим/скачивание файла | `/recordings/files/*` | unit |
| C07 | Выход | `GET /recordings/logout` | unit |
| C08 | Защита при пустом пароле (503) | `/recordings*` | unit |
| C09 | Статус транскрипта у записи | Список файлов | unit (label mapping) |
| C10 | Кнопка «Транскрипт» / «Запустить» | Список файлов | manual |
| C11 | Модальное окно транскрипта | Overlay на `/recordings` | manual |
| C12 | Вкладка «Транскрипт» (сегменты/таймкоды) | Модалка | manual |
| C13 | Вкладка «Саммари» (сетевая Qwen) | Модалка | manual |
| C14 | Перезапуск транскрибации / саммари | Кнопки в модалке | unit (job payload) |
| C15 | Автопостановка в очередь после stop | `/recording/stop` | unit (helpers) |

## D. Backend API (поддержка UI)

| ID | Endpoint | Функция UI | Тест |
|----|----------|------------|------|
| D01 | `GET /health` | Мониторинг | unit |
| D02 | `POST /token` | Вход в комнату | unit |
| D03 | `GET /token` | Альтернативный вход | unit |
| D04 | `POST /avatar` | Загрузка аватара | unit |
| D05 | `GET /avatar/:id` | Отображение аватара | unit |
| D06 | `POST /recording/start` | Начать запись | unit |
| D07 | `POST /recording/stop` | Остановить запись | unit |
| D08 | `GET /recording/status` | REC / sync | unit |
| D09 | `GET /recordings/:file/transcript` | Модалка транскрипта | unit |
| D10 | `POST /recordings/:file/transcribe` | Запуск/рестарт ASR | unit |
| D11 | `POST /recordings/:file/summarize` | Рестарт саммари | unit |

---

## Когда запускать тесты

| Момент | Команда |
|--------|---------|
| После доработки локально | `npm test` (из корня) |
| Перед push / релизом на GitHub | `npm run test:release` |
| Только backend | `npm run test:server` |
| Только web helpers | `npm run test:web` |

`test:release` = unit-тесты server + web + production build web.

---

## Правило сопровождения

1. Новая кнопка / экран / API → строка в этом чеклисте (новый ID).
2. Новый термин → запись в `GLOSSARY.md`.
3. Чистая логика → helper + unit-тест.
4. UI-поведение, зависящее от браузера/LiveKit → пока `manual` / `e2e-later`.
