/* Personal Planner — сервер. Однопользовательский календарь-планировщик. */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { pool } = require('./lib/db');
const { startReminderWorker } = require('./lib/reminder-worker');
const { startBot } = require('./lib/bot');

const app = express();
const PORT = parseInt(process.env.PORT || '3400');

app.locals.pool = pool;

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'planner-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

// Статика
app.use(express.static(path.join(__dirname, 'public')));

// Auth guard для /api (кроме auth)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
});

// Роуты
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/comments', require('./routes/comments'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Reminder-воркер (Telegram + browser polling endpoint)
startReminderWorker(app);

// Telegram-ИИ-бот (диалог + вечерний разбор)
startBot();

// Экспорт для тестов
module.exports = app;

// Прямой запуск
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Personal Planner запущен на http://localhost:${PORT}`);
  });
}
