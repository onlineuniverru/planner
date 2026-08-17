/* ICS-фид задач для подписки в календарях (iPhone, Яндекс, Google).
   Доступ по секретному токену (?token=...), т.к. календари не умеют сессии. */
const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');

// Секрет для фида — из .env (CALENDAR_TOKEN). Если не задан — фид выключен.
function tokenOk(req) {
  const t = process.env.CALENDAR_TOKEN;
  if (!t) return false;
  return req.query.token === t;
}

function icsEscape(s) {
  return (s || '').toString()
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
function dt(d, t) {
  // all-day: YYYYMMDD; с временем: YYYYMMDDTHHMMSS
  if (!d) return null;
  const y = d.slice(0,4), mo = d.slice(5,7), dd = d.slice(8,10);
  if (t) {
    const hh = t.slice(0,2), mi = t.slice(3,5);
    return { value: `${y}${mo}${dd}T${hh}${mi}00`, allDay: false };
  }
  return { value: `${y}${mo}${dd}`, allDay: true };
}

router.get('/feed.ics', async (req, res) => {
  if (!tokenOk(req)) return res.status(401).send('Unauthorized');
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.due_date, t.due_time, t.description, t.priority, t.status,
              p.name AS project_name, c.name AS category_name
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN category c ON c.id = t.category_id
       WHERE t.status = 'TODO' AND t.due_date IS NOT NULL
       ORDER BY t.due_date, t.due_time NULLS LAST`
    );
    const now = new Date();
    const nowUtc = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const timezoneMs = 'Europe/Moscow';

    let body = '';
    body += 'BEGIN:VCALENDAR\r\n';
    body += 'VERSION:2.0\r\n';
    body += 'PRODID:-//Personal Planner//RU\r\n';
    body += 'CALSCALE:GREGORIAN\r\n';
    body += 'METHOD:PUBLISH\r\n';
    body += 'X-WR-CALNAME:Личные задачи (планировщик)\r\n';
    body += 'X-WR-TIMEZONE:' + timezoneMs + '\r\n';
    for (const t of rows) {
      const dtv = dt(t.due_date, t.due_time);
      if (!dtv) continue;
      const prioMap = { LOW: 9, NORMAL: 5, HIGH: 1 };
      const summary = [t.title, t.project_name ? `[${t.project_name}]` : ''].filter(Boolean).join(' ');
      body += 'BEGIN:VEVENT\r\n';
      body += 'UID:planner-' + t.id + '@ii.opencustoms.ru\r\n';
      if (dtv.allDay) {
        body += 'DTSTART;VALUE=DATE:' + dtv.value + '\r\n';
        // all-day заканчивается на следующий день (duration 1 день)
        const next = new Date(t.due_date + 'T00:00:00Z');
        next.setUTCDate(next.getUTCDate() + 1);
        body += 'DTEND;VALUE=DATE:' + next.toISOString().slice(0,10).replace(/-/g, '') + '\r\n';
      } else {
        body += 'DTSTART;TZID=' + timezoneMs + ':' + dtv.value + '\r\n';
        const end = new Date(t.due_date + 'T' + t.due_time.slice(0,5) + ':00Z');
        end.setUTCMinutes(end.getUTCMinutes() + 30);
        body += 'DTEND;TZID=' + timezoneMs + ':' + end.toISOString().slice(0,16).replace(/[-:]/g, '') + '00\r\n';
      }
      body += 'DTSTAMP:' + nowUtc + 'Z\r\n';
      body += 'SUMMARY:' + icsEscape(summary) + '\r\n';
      if (t.description) body += 'DESCRIPTION:' + icsEscape(t.description) + '\r\n';
      if (t.category_name) body += 'CATEGORIES:' + icsEscape(t.category_name) + '\r\n';
      body += 'PRIORITY:' + (prioMap[t.priority] || 5) + '\r\n';
      body += 'END:VEVENT\r\n';
    }
    body += 'END:VCALENDAR\r\n';

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="planner.ics"');
    res.send(body);
  } catch (e) {
    console.error('[calendar] error:', e.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
