# BizBoard в составе «Кода Новороссии»

Посетитель открывает `/business` на том же сайте. Портал передаёт запросы `/api/v1/*` сервису BizBoard. Существующие маршруты турпортала используют его собственный API и SQLite. BizBoard использует PostgreSQL и Redis. В Compose эти сервисы доступны во внутренней сети.

## Рабочий режим

1. Скопируйте `.env.example` в `.env`. Задайте `PORTAL_SECRET_KEY` и `BIZBOARD_SECRET_KEY` разными случайными строками длиной от 32 байт. Для генерации используйте `openssl rand -hex 32`. Задайте случайный `POSTGRES_PASSWORD` из букв и цифр.
2. Заполните `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` без `@` и `TELEGRAM_WEBHOOK_SECRET`. Для секрета вебхука подойдёт результат `openssl rand -hex 32`. Для первого администратора BizBoard задайте `SUPERADMIN_TELEGRAM_ID` и при необходимости `SUPERADMIN_PHONE`.
3. Укажите публичный HTTPS-адрес в `SITE_URL`. Настройте HTTPS-прокси на порт 8000. По умолчанию Compose публикует его на `127.0.0.1`.
4. Запустите `docker compose up -d --build`. Сервис BizBoard применит миграции Alembic и загрузит справочники.
5. Зарегистрируйте вебхук, подставив свой домен:

```bash
docker compose exec bizboard python -m scripts.set_telegram_webhook https://example.com/api/v1/telegram/webhook
```

Откройте `/business`, войдите через Telegram и подтвердите контакт в боте. Для модерации администратору нужно подключить приложение-аутентификатор в разделе «Модерация».

Для периодического снятия просроченных публикаций добавьте в расписание команду `docker compose exec -T bizboard python -m scripts.expire_listings`. Семейства JWT, лимиты публикации, видимость контактов и полномочия проверяет BizBoard.

## Демо для показа

```bash
docker compose -p kod-demo -f docker-compose.yml -f docker-compose.demo.yml up --build
```

Используйте локальный адрес `http://localhost:8000/business`. Имя проекта `kod-demo` даёт демо собственные тома. Перед рабочим запуском остановите демо, чтобы освободить порт 8000:

```bash
docker compose -p kod-demo -f docker-compose.yml -f docker-compose.demo.yml down
```

Демо содержит вымышленные объявления. Кнопки входа создают отдельного тестового пользователя при каждом входе. Чтобы вернуться к его объявлениям, оставьте вкладку продавца открытой и используйте отдельное приватное окно для модератора. TOTP в демо проверяется тем же API. Рабочая конфигурация использует Telegram и не включает демо-вход.

## Маршруты и исходники

| Адрес или папка | Назначение |
| --- | --- |
| `/business` | Поиск и фильтры объявлений, карточки, компании, кабинеты, модерация |
| `/docs/bizboard` | Swagger BizBoard через портал |
| `/docs` | Swagger туристического портала |
| `web/src/business/` | Веб-интерфейс BizBoard |
| `bizboard/` | Сервис, миграции, тесты и [документация API](../bizboard/docs/README.md) |

Управление ролями и приглашениями организаций, тарифами и платформенными настройками доступно через Swagger BizBoard. В веб-кабинете реализованы создание организации, проверка ИНН и публикации. Сведения о восстановленном ТЗ находятся в [bizboard/docs/TZ-restored.md](../bizboard/docs/TZ-restored.md).
