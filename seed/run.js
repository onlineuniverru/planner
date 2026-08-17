/* Seed: администратор + базовые категории + демо-проект. */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO app_user (username, password_hash) VALUES ($1,$2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, hash]
  );

  // Базовые общие категории
  const cats = ['Личное', 'Работа', 'Дом', 'Здоровье', 'Финансы'];
  for (const c of cats) {
    await pool.query(`INSERT INTO category (name, project_id) VALUES ($1,NULL)
      ON CONFLICT DO NOTHING`, [c]);
  }

  console.log('Seed завершён: admin + категории.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
