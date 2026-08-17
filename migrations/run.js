/* Миграции: запуск всех .sql в migrations/ по порядку. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  const dir = path.join(__dirname);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  for (const f of files) {
    const { rowCount } = await pool.query(`SELECT 1 FROM _migrations WHERE name = $1`, [f]);
    if (rowCount > 0) { console.log(`skip  ${f}`); continue; }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query(`INSERT INTO _migrations (name) VALUES ($1)`, [f]);
      await pool.query('COMMIT');
      console.log(`applied ${f}`);
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error(`FAILED ${f}:`, e.message);
      process.exit(1);
    }
  }
  console.log('Миграции завершены.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
