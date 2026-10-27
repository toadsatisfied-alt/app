# Сервер синхронизации и push-уведомлений

Cloudflare Worker + база D1. Хранит общие задачи группы (двух телефонов), личные списки и push-подписки, раз в минуту проверяет сроки и отправляет уведомления.

## Развёртывание (один раз)

Нужен бесплатный аккаунт Cloudflare и Node.js 20+ на компьютере.

```bash
cd worker
npm install
npx wrangler login

# 1. База данных
npx wrangler d1 create todo          # скопируйте database_id в wrangler.toml
npx wrangler d1 execute todo --remote --file schema.sql

# 2. Ключи для push
npm run vapid                        # публичный ключ → VAPID_PUBLIC_KEY в wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY   # вставьте приватный ключ

# 3. Публикация
npm run deploy                       # выведет адрес вида https://todo-sync.<имя>.workers.dev
```

Затем впишите этот адрес в `config.js` в корне проекта:

```js
window.TODO_API = 'https://todo-sync.<имя>.workers.dev';
```

и обновите ветку `gh-pages`. Дальше на первом iPhone: ⚙︎ → «Создать группу» → «Включить push». На втором: ⚙︎ → «Войти по коду».

## Локальная проверка

```bash
printf "VAPID_PRIVATE_KEY=...\nVAPID_PUBLIC_KEY=...\n" > .dev.vars
npx wrangler d1 execute todo --local --persist-to .state --file schema.sql
npm run dev        # http://localhost:8787
npm test           # сквозной тест API
```

## Как это работает
- Каждый телефон при входе получает секретный токен (в базе хранится только его хеш).
- `POST /api/sync` отправляет изменения и получает чужие. Побеждает последнее изменение; удаления хранятся как пометки.
- Личные списки (🔒) видит и меняет только владелец.
- Уведомление о сроке получает назначенный человек (если не назначен — автор). Также приходят уведомления «добавил(а) задачу», «назначил(а) вам», «выполнил(а)».
