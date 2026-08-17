/* Комментарии задач — хронологическая история записей. */
const express = require('express');
const { pool } = require('../lib/db');
const router = express.Router();

// Список комментариев задачи (хронологически, старые → новые)
router.get('/task/:task_id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM task_comment WHERE task_id=$1 ORDER BY created_at ASC, id ASC`, [req.params.task_id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Добавить комментарий
router.post('/', async (req, res) => {
  try {
    const { task_id, text } = req.body || {};
    if (!task_id) return res.status(400).json({ error: 'task_id обязателен' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'Текст комментария пуст' });
    const { rows } = await pool.query(
      `INSERT INTO task_comment (task_id, text) VALUES ($1,$2) RETURNING *`,
      [task_id, text.trim()]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
