/* Reminder-движок: проверяет по расписанию задачи с reminder_at, отправляет уведомления.
   Каналы: Telegram (основной) + browser (через polling-эндпоинт).
   Архитектура пригодна для добавления inline-кнопок позже. */
const { pool } = require('./db');

let appRef = null;

// Формирование текста напоминания
function formatReminder(task, tz) {
  const tzLabel = tz || process.env.DEFAULT_TZ || 'Europe/Moscow';
  let timeStr = '';
  try {
    timeStr = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', timeZone: tzLabel
    }).format(new Date());
  } catch { timeStr = ''; }
  let dueInfo = '';
  if (task.due_date) {
    const d = new Date(task.due_date + 'T12:00:00Z');
    const dateStr = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
    const today = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: tzLabel }).format(new Date());
    const label = dateStr === today ? 'сегодня' : dateStr;
    dueInfo = `Срок: ${label}`;
    if (task.due_time) dueInfo += `, ${task.due_time.slice(0,5)}`;
  }
  return {
    text: `⏰ OpenCustoms\n${task.title}${dueInfo ? '\n' + dueInfo : ''}`,
    taskId: task.id
  };
}

// Отправка в Telegram
async function sendTelegram(task, tz) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[reminder] Telegram не настроен (нет TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID), пропуск. Задача id=' + task.id);
    return false;
  }
  const { text } = formatReminder(task, tz);
  try {
    // Без inline-кнопок на первом этапе (архитектура позволяет добавить позже)
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const data = await resp.json();
    if (!data.ok) {
      console.log('[reminder] Telegram error:', data.description);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[reminder] Telegram send failed:', e.message);
    return false;
  }
}

// Логирование отправки
async function logSent(taskId, channel) {
  try {
    await pool.query(`INSERT INTO reminder_log (task_id, channel) VALUES ($1,$2)`, [taskId, channel]);
  } catch (e) { console.error('[reminder] log failed:', e.message); }
}

// Один проход проверки
async function processDue(tz) {
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `SELECT * FROM task WHERE status='TODO' AND reminder_at IS NOT NULL AND reminder_at <= $1
     AND id NOT IN (SELECT task_id FROM reminder_log)`,
    [now]
  );
  for (const task of rows) {
    await sendTelegram(task, tz);
    await logSent(task.id, 'telegram');
  }
  return rows.length;
}

// Периодический запуск
function startReminderWorker(app) {
  appRef = app;
  const tz = process.env.DEFAULT_TZ || 'Europe/Moscow';
  // Опрос раз в 30 секунд
  const WORKER_MS = 30 * 1000;
  setInterval(() => { processDue(tz).catch(e => console.error('[reminder] worker error:', e.message)); }, WORKER_MS);
  console.log('[reminder] worker запущен, интервал 30s');

  // Эндпоинт для браузерных уведомлений (polling): возвращает задачи с неотправленными browser-напоминаниями
  app.get('/api/reminders/browser', async (req, res) => {
    try {
      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `SELECT * FROM task WHERE status='TODO' AND reminder_at IS NOT NULL AND reminder_at <= $1
         AND id NOT IN (SELECT task_id FROM reminder_log WHERE channel='browser')
         AND id NOT IN (SELECT task_id FROM reminder_log WHERE channel='telegram')`,
        [now]
      );
      res.json(rows.map(r => ({ id: r.id, title: r.title, due_date: r.due_date, due_time: r.due_time })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
  });

  // Пометить browser-напоминание отправленным (клиент подтверждает после показа)
  app.post('/api/reminders/browser/ack', async (req, res) => {
    try {
      const { task_id } = req.body || {};
      if (task_id) await logSent(task_id, 'browser');
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
  });
}

module.exports = { startReminderWorker, processDue, formatReminder };
