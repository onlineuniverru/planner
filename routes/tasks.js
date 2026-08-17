/* CRUD задач + экран «Сегодня» + фильтры + завершение/перенос + повторение. */
const express = require('express');
const { pool } = require('../lib/db');
const { nextOccurrence } = require('../lib/recurrence');
const router = express.Router();

// JOIN-вью задач с именами проекта и категории
const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, p.status AS project_status,
         c.name AS category_name
  FROM task t
  LEFT JOIN project p ON p.id = t.project_id
  LEFT JOIN category c ON c.id = t.category_id`;

// Список задач с фильтрами
// query: search, project_id, category_id, status, priority, date_from, date_to
router.get('/', async (req, res) => {
  try {
    const q = req.query || {};
    const where = [];
    const params = [];
    if (q.search) { params.push(`%${q.search}%`); where.push(`t.title ILIKE $${params.length}`); }
    if (q.project_id) { params.push(q.project_id); where.push(`t.project_id = $${params.length}`); }
    if (q.category_id) { params.push(q.category_id); where.push(`t.category_id = $${params.length}`); }
    if (q.priority) { params.push(q.priority); where.push(`t.priority = $${params.length}`); }
    if (q.status) {
      if (q.status === 'ACTIVE') where.push(`t.status = 'TODO'`);
      else { params.push(q.status); where.push(`t.status = $${params.length}`); }
    }
    if (q.date_from) { params.push(q.date_from); where.push(`t.due_date >= $${params.length}`); }
    if (q.date_to) { params.push(q.date_to); where.push(`t.due_date <= $${params.length}`); }
    const sql = `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.due_date NULLS LAST, t.due_time NULLS LAST, t.priority DESC, t.created_at`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Экран «Сегодня»: одноразовый запрос всех задач, группировка на клиенте
// server отдаёт готовые блоки: overdue / today / upcoming / done_today
router.get('/today', async (req, res) => {
  try {
    const tz = req.query.tz || process.env.DEFAULT_TZ || 'Europe/Moscow';
    // День в TZ пользователя
    const { today, start } = await dayBounds(tz);
    const { rows } = await pool.query(`${TASK_SELECT} WHERE t.status = 'TODO' ORDER BY t.due_date NULLS LAST, t.due_time NULLS LAST, t.priority DESC`);
    const doneRows = await pool.query(`${TASK_SELECT} WHERE t.status='DONE' AND t.completed_at >= $1`, [start]);
    res.json({
      overdue: rows.filter(r => r.due_date && r.due_date < today),
      today: rows.filter(r => r.due_date === today),
      upcoming: rows.filter(r => !r.due_date || r.due_date > today),
      done_today: doneRows.rows,
      todayLabel: today
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Нормализуем границы дня в TZ пользователя
async function dayBounds(tz) {
  const { rows } = await pool.query(
    `SELECT (now() AT TIME ZONE $1)::date AS today,
            (now() AT TIME ZONE $1)::date::timestamp AT TIME ZONE $1 AS start`,
    [tz]
  );
  const today = rows[0].today;         // 'YYYY-MM-DD'
  const start = rows[0].start;         // timestamptz начала дня
  return { today, start };
}

// Создать задачу
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const { rows } = await pool.query(
      `INSERT INTO task (title, description, project_id, category_id, priority, due_date, due_time, reminder_at, recurrence_rule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.title.trim(), b.description || '', b.project_id || null, b.category_id || null,
       b.priority || 'NORMAL', b.due_date || null, b.due_time || null,
       b.reminder_at || null, b.recurrence_rule || null]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Получить задачу
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Редактировать задачу (все поля, кроме завершения)
router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const { rows } = await pool.query(
      `UPDATE task SET
         title=COALESCE($2,title),
         description=CASE WHEN $3::bool THEN $4 ELSE description END,
         project_id=CASE WHEN $5::bool IS NULL THEN project_id WHEN $5::bool THEN $6 ELSE NULL END,
         category_id=CASE WHEN $7::bool IS NULL THEN category_id WHEN $7::bool THEN $8 ELSE NULL END,
         priority=COALESCE($9,priority),
         due_date=COALESCE($10,due_date),
         due_time=COALESCE($11,due_time),
         reminder_at=COALESCE($12,reminder_at),
         recurrence_rule=COALESCE($13,recurrence_rule),
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [req.params.id, b.title && b.title.trim(), b.description !== undefined, b.description,
       b.project_id === null ? null : b.project_id !== undefined, b.project_id || null,
       b.category_id === null ? null : b.category_id !== undefined, b.category_id || null,
       b.priority, b.due_date, b.due_time, b.reminder_at, b.recurrence_rule]);
    // NOTE: для "очистить reminder_at" используем явный null через отдельный эндпоинт
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Завершить задачу. Если повторяющаяся — создать следующий экземпляр.
router.post('/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;
    const { rows } = await pool.query(`SELECT * FROM task WHERE id=$1`, [id]);
    const t = rows[0];
    if (!t) return res.status(404).json({ error: 'Не найдено' });

    // Завершаем текущую
    await pool.query(`UPDATE task SET status='DONE', completed_at=now(), updated_at=now() WHERE id=$1`, [id]);

    // Если повторяющаяся и есть срок — создаём следующий экземпляр
    if (t.recurrence_rule && t.due_date) {
      const nxt = nextOccurrence(t.recurrence_rule, t.due_date);
      if (nxt) {
        const nextDate = nxt.toISOString().slice(0, 10);
        await pool.query(
          `INSERT INTO task (title, description, project_id, category_id, priority, due_date, due_time, reminder_at, recurrence_rule)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [t.title, t.description, t.project_id, t.category_id, t.priority, nextDate, t.due_time, t.reminder_at, t.recurrence_rule]);
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Вернуть задачу в работу
router.post('/:id/reopen', async (req, res) => {
  try {
    const { rows } = await pool.query(`UPDATE task SET status='TODO', completed_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Отмена задачи
router.post('/:id/cancel', async (req, res) => {
  try {
    const { rows } = await pool.query(`UPDATE task SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Перенос задачи на другую дату
router.post('/:id/move', async (req, res) => {
  try {
    const { due_date } = req.body || {};
    if (!due_date) return res.status(400).json({ error: 'Укажите дату' });
    const { rows } = await pool.query(`UPDATE task SET due_date=$2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, due_date]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Убрать напоминание
router.delete('/:id/reminder', async (req, res) => {
  try {
    const { rows } = await pool.query(`UPDATE task SET reminder_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Удалить задачу (не обязательно по ТЗ, но удобно)
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM task WHERE id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
