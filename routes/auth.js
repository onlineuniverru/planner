/* Роуты аутентификации: вход, проверка, выход. Однопользовательский сервис. */
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../lib/db');
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
    const { rows } = await pool.query(`SELECT * FROM app_user WHERE username = $1`, [username]);
    const user = rows[0];
    const ok = user && await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username, timezone: user.timezone });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.get('/check', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
