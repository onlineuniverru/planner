/* Вспомогательные ф-ции для повторяющихся задач и дат. */
const { pool } = require('./db');

// Парсим recurrence_rule в объект
// Форматы: 'DAILY' | 'WEEKLY' | 'WEEKLY:MO,WE,FR' | 'MONTHLY'
function parseRecurrence(rule) {
  if (!rule) return null;
  const [kind, param] = rule.split(':');
  const r = { kind };
  if (param) r.days = param.split(',').map(d => d.trim().toUpperCase());
  return r;
}

// Следующая дата по правилу после givenDate
function nextOccurrence(ruleStr, fromDate) {
  const r = parseRecurrence(ruleStr);
  if (!r) return null;
  const dowIdx = { MO:1, TU:2, WE:3, TH:4, FR:5, SA:6, SU:0 };
  const d = new Date(fromDate);
  d.setHours(12, 0, 0, 0);
  const maxIter = 400;
  let iter = 0;
  while (iter++ < maxIter) {
    d.setDate(d.getDate() + 1);
    if (r.kind === 'DAILY') return d;
    if (r.kind === 'WEEKLY') return d;
    if (r.kind === 'MONTHLY') {
      // берём первое подходящее число следующего месяца — для MVP: увеличиваем месяц
      const nd = new Date(d);
      nd.setDate(1);
      nd.setMonth(nd.getMonth() + 1);
      // стараемся сохранить день исходной даты, иначе последний день месяца
      const origDay = fromDate.getDate();
      nd.setDate(Math.min(origDay, new Date(nd.getFullYear(), nd.getMonth()+1, 0).getDate()));
      return nd;
    }
    if (r.kind === 'WEEKLY' && r.days) {
      const cur = d.getDay();
      if (r.days.includes(Object.keys(dowIdx).find(k => dowIdx[k] === cur))) return d;
      continue;
    }
    if (r.kind === 'WEEKLY' && !r.days) return d;
    // неизвестный вид — вернуть null
    return null;
  }
  return null;
}

// Получить все задачи, чей reminder_at наступил и ещё не отправлен
async function getDueReminders(now) {
  const { rows } = await pool.query(
    `SELECT * FROM task WHERE status='TODO' AND reminder_at IS NOT NULL AND reminder_at <= $1
     AND id NOT IN (SELECT task_id FROM reminder_log WHERE sent_at IS NOT NULL)`,
    [now]
  );
  return rows;
}

module.exports = { parseRecurrence, nextOccurrence, getDueReminders };
