/* Служебные хелперы базы данных. */
require('dotenv').config();
const { Pool, types } = require('pg');
const { pool: _ } = require('pg'); // не используется

// OID для DATE = 1082. Заставляем pg возвращать дату как 'YYYY-MM-DD' (без времени/зоны).
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (val) => val); // val уже строка 'YYYY-MM-DD' от сервера

// OID для TIMESTAMPTZ = 1184: возвращаем как ISO (значение по умолчанию) — ок.

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

module.exports = { pool };
