/* Telegram-бот планировщика: диалог с ИИ (Z.AI glm) → создание задач.
   Плюс вечерний разбор дня в 20:00 (часовой пояс DEFAULT_TZ): дайджест незакрытых задач. */
const { pool } = require('./db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ZAI_KEY = process.env.ZAI_API_KEY;
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-4-flash';
const ZAI_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const TZ = process.env.DEFAULT_TZ || 'Europe/Moscow';
const REVIEW_HOUR = parseInt(process.env.REVIEW_HOUR || '20'); // вечерний разбор, 20:00 МСК

let offset = 0;
let history = []; // последние сообщения диалога (для контекста)

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.json();
}

// --- Z.AI вызов с ретраями ---
async function llm(messages) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(ZAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ZAI_KEY}` },
        body: JSON.stringify({ model: ZAI_MODEL, messages, temperature: 0.3, max_tokens: 3000, thinking: { type: 'disabled' } })
      });
      const d = await r.json();
      if (d.error) throw new Error(`ZAI ${d.error.code}: ${d.error.message}`);
      const content = d.choices?.[0]?.message?.content || '';
      if (content.trim()) return content; // пустой content считаем сбоем — ретраим
      lastErr = new Error('пустой ответ модели');
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, attempt * 3000)); // 3с, 6с, 9с
  }
  throw lastErr;
}

// --- Логин в планировщик (сервисная сессия) ---
let plannerCookie = null;
async function plannerLogin() {
  const r = await fetch(`http://localhost:${process.env.PORT || 3400}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD })
  });
  const sc = r.headers.get('set-cookie');
  if (sc) plannerCookie = sc.split(';')[0];
}
async function plannerApi(method, path, body) {
  if (!plannerCookie) await plannerLogin();
  const r = await fetch(`http://localhost:${process.env.PORT || 3400}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'Cookie': plannerCookie },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { plannerCookie = null; await plannerLogin(); return plannerApi(method, path, body); }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// --- Контекст дня для ИИ: активные задачи ---
async function tasksContext() {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.due_date, t.due_time, t.priority, t.status, p.name AS project_name
     FROM task t LEFT JOIN project p ON p.id=t.project_id
     WHERE t.status='TODO' ORDER BY t.due_date NULLS LAST LIMIT 40`);
  return rows.map(r => `#${r.id} [${r.due_date || 'без срока'}${r.due_time ? ' ' + r.due_time.slice(0,5) : ''}] ${r.title}${r.project_name ? ' (' + r.project_name + ')' : ''}`).join('\n') || '(задач нет)';
}

const SYSTEM_PROMPT = `Ты — ассистент личного планировщика одного пользователя (Александр, ВЭД-эксперт). Часовой пояс Europe/Moscow. Сегодняшняя дата подставляется в контексте.
Пользователь беседует с тобой, чтобы спланировать день. Твоя задача — помочь определить задачи и управлять ими.
Тексты задач пиши кратко, в инфинитиве (подготовить, позвонить, оплатить).

Тебе доступны действия над задачами из списка в контексте (у каждой id: #N):
- создать новую задачу (tasks)
- отметить выполненной (complete: [id])
- удалить (delete: [id])
- перенести на дату (move: [{id, due_date}])

Всегда возвращай СТРОГО JSON-блок (без текста вокруг):
\`\`\`json
{"reply":"короткий ответ пользователю","tasks":[{"title":"...","due_date":"YYYY-MM-DD","due_time":"HH:MM|null","priority":"LOW|NORMAL|HIGH","description":"|null"}],"complete":[1,2],"delete":[3],"move":[{"id":4,"due_date":"YYYY-MM-DD"}]}
\`\`\`
Все ключи кроме reply необязательны — включай только нужные.
Дату по умолчанию — сегодня. Время вытаскивай из фраз ("в 10 утра" → "10:00"). "Завтра" = сегодня+1.
Для complete/delete/move обязательно уточняй id задач из списка в контексте — не выдумывай их. Если пользователь говорит "закончи первую" — это первая невыполненная с сегодня в списке.
Не создавай задачи без явного намерения пользователя.`;

// --- Обработка сообщения ---
async function handleMessage(text) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const ctx = `Сегодня: ${today} (${TZ}).\nТекущие активные задачи:\n${await tasksContext()}`;
  history.push({ role: 'user', content: text });
  // чистим испорченную историю (пустые/многоточечные ответы)
  history = history.filter(m => m.content && m.content.trim() && m.content.trim() !== '…');
  if (history.length > 16) history = history.slice(-16);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: ctx },
    ...history
  ];
  let raw = '';
  try { raw = await llm(messages); } catch (e) {
    return '⚠️ ИИ временно недоступен (' + e.message + '). Попробуй ещё раз через минуту — напоминания и задачи при этом работают.';
  }
  // вытаскиваем json-блок
  const m = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/\{[\s\S]*\}/);
  let parsed;
  try { parsed = JSON.parse(m ? m[1] || m[0] : raw); } catch { return raw.slice(0, 1500) || '…'; }
  let result = parsed.reply || '';
  const actions = [];
  if (Array.isArray(parsed.tasks) && parsed.tasks.length) {
    for (const t of parsed.tasks) {
      const r = await plannerApi('POST', '/tasks', {
        title: t.title, due_date: t.due_date || today, due_time: t.due_time || null,
        priority: t.priority || 'NORMAL', description: t.description || ''
      });
      actions.push(r.status === 201 ? '✅ Создано: ' + t.title : '❌ Не создано: ' + t.title);
    }
  }
  if (Array.isArray(parsed.complete) && parsed.complete.length) {
    for (const id of parsed.complete) {
      const r = await plannerApi('POST', `/tasks/${id}/complete`);
      actions.push(r.status === 200 ? `✅ Выполнена #${id}` : `❌ #${id} не найдена`);
    }
  }
  if (Array.isArray(parsed.delete) && parsed.delete.length) {
    for (const id of parsed.delete) {
      const r = await plannerApi('DELETE', `/tasks/${id}`);
      actions.push(r.status === 200 ? `🗑 Удалена #${id}` : `❌ #${id} не найдена`);
    }
  }
  if (Array.isArray(parsed.move) && parsed.move.length) {
    for (const m of parsed.move) {
      const r = await plannerApi('POST', `/tasks/${m.id}/move`, { due_date: m.due_date });
      actions.push(r.status === 200 ? `📅 #${m.id} → ${m.due_date}` : `❌ #${m.id} не перенесена`);
    }
  }
  if (actions.length) {
    result += '\n\n' + actions.join('\n');
    result += '\n➡️ ii.opencustoms.ru/planner';
  }
  // в историю — только живые ответы, без ошибок
  if (!result.startsWith('⚠️')) {
    history.push({ role: 'assistant', content: result });
    if (history.length > 16) history = history.slice(-16);
  }
  return result;
}

// --- Вечерний разбор ---
async function eveningReview() {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.due_date, t.due_time FROM task t
     WHERE t.status='TODO' AND t.due_date <= (now() AT TIME ZONE $1)::date
     ORDER BY t.due_date, t.due_time LIMIT 25`, [TZ]);
  if (!rows.length) return false;
  const done = await pool.query(
    `SELECT count(*) AS c FROM task WHERE status='DONE' AND completed_at >= date_trunc('day', now() AT TIME ZONE $1)`, [TZ]);
  const list = rows.map(r => `• #${r.id} ${r.title} (${r.due_date === new Date().toLocaleDateString('sv-SE',{timeZone:TZ}) ? 'сегодня' : r.due_date}${r.due_time ? ', ' + r.due_time.slice(0,5) : ''})`).join('\n');
  const text = `🌙 Разбор дня\n\nВыполнено сегодня: ${done.rows[0].c}\nНе закрыто:\n${list}\n\nЧто переносим на завтра? Напиши, например: «статью на завтра» — перенесу. Или «первую закрой» — отмечу выполненной. Полный список: ii.opencustoms.ru/planner`;
  await tg('sendMessage', { chat_id: CHAT_ID, text });
  return true;
}

// --- Главный цикл ---
function startBot() {
  if (!BOT_TOKEN || !CHAT_ID || !ZAI_KEY) {
    console.log('[bot] не запущен: нужны TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ZAI_API_KEY');
    return;
  }
  // long-poll
  (async function poll() {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}`);
      const d = await r.json();
      for (const u of d.result || []) {
        offset = u.update_id + 1;
        const msg = u.message || u.edited_message;
        if (!msg || String(msg.chat.id) !== String(CHAT_ID)) continue; // только хозяин
        if (msg.text === '/start' || msg.text === '/ping') {
          await tg('sendMessage', { chat_id: CHAT_ID, text: '👋 Я здесь. Просто расскажи, что нужно сделать — создам задачи.' });
          continue;
        }
        if (msg.text === '/разбор' || msg.text === '/review') { await eveningReview(); continue; }
        await tg('sendChatAction', { chat_id: CHAT_ID, action: 'typing' });
        const reply = await handleMessage(msg.text);
        await tg('sendMessage', { chat_id: CHAT_ID, text: reply.slice(0, 4000) });
      }
    } catch (e) { console.error('[bot] poll error:', e.message); }
    setTimeout(poll, 1000);
  })();
  console.log('[bot] запущен (long-poll)');

  // вечерний разбор: проверка раз в минуту
  let lastReviewDay = null;
  setInterval(async () => {
    try {
      const now = new Date();
      const h = parseInt(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }));
      const day = now.toLocaleDateString('sv-SE', { timeZone: TZ });
      if (h === REVIEW_HOUR && lastReviewDay !== day) {
        lastReviewDay = day;
        const sent = await eveningReview();
        if (!sent) console.log('[bot] вечерний разбор: незакрытых задач нет');
      }
    } catch (e) { console.error('[bot] review error:', e.message); }
  }, 60000);
}

module.exports = { startBot, handleMessage, eveningReview };
