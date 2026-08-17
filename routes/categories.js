/* CRUD категорий (общие + проектные). */
const express = require('express');
const { pool } = require('../lib/db');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { project_id } = req.query;
    let sql = `SELECT * FROM category`;
    const params = [];
    if (project_id) { params.push(project_id); sql += ` WHERE project_id = $1 OR project_id IS NULL`; }
    sql += ` ORDER BY sort_order, name`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, project_id = null, sort_order = 0 } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const { rows } = await pool.query(
      `INSERT INTO category (name, project_id, sort_order) VALUES ($1,$2,$3) RETURNING *`,
      [name.trim(), project_id, sort_order]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, project_id, sort_order } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE category SET name=COALESCE($2,name), project_id=COALESCE($3,project_id), sort_order=COALESCE($4,sort_order)
       WHERE id=$1 RETURNING *`,
      [req.params.id, name && name.trim(), project_id, sort_order]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM category WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
