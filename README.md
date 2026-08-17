# 🗓️ Personal Planner — личный календарь-планировщик

Однопользовательский веб-сервис для управления личными проектами и ежедневными задачами.
Публикация: **https://ii.opencustoms.ru/planner/**

## Возможности
- Экран «Сегодня»: Просрочено / Сегодня / Далее + счётчик «Сегодня выполнено: X / Y»
- Быстрое создание задачи (название + дата, остальное дополнительно)
- Проекты и категории (общие и проектные)
- Карточка задачи: редактирование, комментарии (история), завершение/возврат, перенос
- Повторяющиеся задачи: ежедневно / по дням недели / еженедельно / ежемесячно
- Напоминания: Telegram (основной) + browser-уведомления
- Поиск и фильтры в «Все задачи»
- Адаптивный (mobile-first) интерфейс + PWA

## Стек
- Backend: Node 22 + Express + PostgreSQL 16 (pg + SQL-миграции)
- Frontend: vanilla TS-подобный JS SPA, hash-routing, responsive CSS
- Деплой: PM2, nginx reverse-proxy

## Структура
```
server.js              # точка входа
migrations/            # SQL-миграции + run.js
seed/                  # начальные данные (admin, категории)
routes/                # auth, projects, categories, tasks, comments
lib/                   # db.js, recurrence.js, reminder-worker.js
public/                # index.html, css/, js/app.js, sw.js, manifest.json
test/                  # smoke (CRUD API)
```

## Запуск локально
```bash
npm install
cp .env.example .env   # заполните секреты
createdb planner
node migrations/run.js
node seed/run.js
node server.js
```

## Тесты
```bash
npm test        # smoke: auth + CRUD + повторение + фильтры
```

## Правила проекта
- .env и node_modules не в git
- Все секреты — только через environment
- GitHub main — источник истины (см. AGENTS.md workspace)
