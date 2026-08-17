/* CRUD проектов: list (неархивные + архивные отдельно), create, get, update, archive/unarchive. */
const express = require('express');
const { pool } = require('../lib/db');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
        (SELECT count(*) FROM task t WHERE t.project_id = p.id AND t.status != 'DONE' AND t.status != 'CANCELLED') AS active_count,
        (SELECT count(*) FROM task t WHERE t.project_id = p.id AND t.status='DONE') AS done_count
       FROM project p ORDER BY p.status='ARCHIVED', p.sort_order, p.name`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, description = '', status = 'ACTIVE', sort_order = 0 } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const { rows } = await pool.query(
      `INSERT INTO project (name, description, status, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), description, status, sort_order]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM project WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, status, sort_order } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE project SET name=COALESCE($2,name), description=COALESCE($3,description),
        status=COALESCE($4,status), sort_order=COALESCE($5,sort_order), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [req.params.id, name && name.trim(), description, status, sort_order]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE project SET status='ARCHIVED', updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/:id/unarchive', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE project SET status='ACTIVE', updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
