# ДомДело

«ДомДело» превращает неформальное сообщение в домовом чате MAX в одно коллективное дело: проблема → подтверждения соседей → назначение → работа → фото результата → проверка жильцами.

Это первый рабочий срез MVP. В нём уже доступен сквозной сценарий мини-приложения, API, PostgreSQL-модель, дедупликация, workflow, загрузка фото, outbox и защищённый webhook. Многошаговый сбор всех полей непосредственно в чате MAX отмечен как следующий срез, а не выдаётся за готовую интеграцию.

## Быстрый запуск через Docker

Требуются Docker Engine/Desktop и Compose.

1. Скопируйте `.env.example` в `.env`.
2. Заполните как минимум `POSTGRES_PASSWORD`, `S3_SECRET_ACCESS_KEY` и `SESSION_SECRET` случайными значениями.
3. Выполните:

```bash
docker compose up --build
```

Мини-приложение: `http://localhost:8080`  
OpenAPI UI: `http://localhost:8080/docs`  
Health: `http://localhost:8080/health/ready`

Для остановки: `docker compose down`. Данные сохраняются в именованных volumes. Для полного удаления тестовых данных используется отдельная явная команда `docker compose down -v`.

## Локальный demo-режим без Docker

Нужны Node.js `24.21.0` и pnpm `11.25.0`.

```bash
pnpm install --frozen-lockfile
pnpm build:packages
```

В первом терминале:

```bash
STORAGE_MODE=memory DEMO_MODE=true MAX_WEBHOOK_SECRET=local-test-secret pnpm dev:server
```

Во втором:

```bash
pnpm dev:web
```

Откройте `http://localhost:5173`. В верхней панели можно переключать вымышленные роли жильца, диспетчера и исполнителя.

## Основной сценарий

1. Житель описывает проблему.
2. Объяснимое правило ищет похожие открытые дела по дому, категории, подъезду, месту, периоду и сходству текста.
3. Житель присоединяется к совпадению либо создаёт новое дело.
4. Диспетчер назначает исполнителя и меняет статусы только по разрешённому графу.
5. Исполнитель добавляет фото результата.
6. Житель подтверждает результат либо оспаривает его.

Подробная проверка: [docs/testing-scenario.md](docs/testing-scenario.md).

## Архитектура

Модульный монолит на TypeScript:

- Fastify + официальный `@maxhub/max-bot-api`;
- React + Vite + MAX UI + TanStack Query;
- PostgreSQL 17.11 + Drizzle + `pg_trgm`;
- S3-совместимое хранилище, MinIO только для локального demo-контура;
- outbox worker без Redis;
- Nginx reverse proxy и единый Dockerfile с targets `server`/`web`.

Подробнее: [docs/architecture.md](docs/architecture.md).

## Конфигурация MAX

1. Создайте бота и передайте токен только через `MAX_BOT_TOKEN`.
2. Задайте `MAX_WEBHOOK_SECRET` длиной 5–256 символов (`A-Z`, `a-z`, `0-9`, `_`, `-`).
3. Разместите стенд на публичном HTTPS-домене с доверенным сертификатом и портом 443.
4. Создайте подписку `POST https://platform-api2.max.ru/subscriptions` на `${PUBLIC_BASE_URL}/webhooks/max`.
5. Мини-приложение подключите к тому же боту. Frontend передаёт только `window.WebApp.initData`; `MAX_BOT_TOKEN` во frontend не попадает.

Актуальность MAX API проверена 23.09.2026: используется `platform-api2.max.ru`, webhook HTTPS и заголовок `X-Max-Bot-Api-Secret`.

## Проверки качества

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm openapi:export
```

Фактический контракт: [docs/openapi.yaml](docs/openapi.yaml). Карта проверок и demo-данных: [docs/DATA-API.yaml](docs/DATA-API.yaml).

## Безопасность и данные

- Рабочие секреты не хранятся в репозитории; `.env` игнорируется.
- `initData` проверяется сервером через HMAC-SHA256 и срок выдачи.
- Роль и дом берутся из серверной сессии.
- Создание дела защищено `Idempotency-Key`, webhook — таблицей обработанных событий, смена статуса — `expectedVersion`.
- Фото ограничены JPEG/PNG/WebP и 8 МБ; S3-ссылки имеют ограниченный срок.
- Контейнер приложения запускается от пользователя `node`, web — на unprivileged Nginx.
- В seed нет реальных персональных данных; все сущности помечены `is_demo=true`.

## Известные ограничения

- Для реальной проверки MAX нужны токен организаторов и публичный HTTPS-стенд.
- На машине разработки Docker отсутствует, поэтому clean-clone Compose-запуск ещё необходимо проверить в среде с Docker.
- MinIO community upstream архивирован; в локальном контуре сохранён требуемый стек, но перед production-пилотом нужен поддерживаемый S3-вариант.
- Реальные интеграции с УК, ГИС ЖКХ и муниципальными системами не входят в MVP и не имитируются.

