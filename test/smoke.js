/* Smoke-тест Personal Planner (этапы 2): auth + CRUD всех сущностей. */
const BASE = 'http://localhost:3400/api';
let cookie = '';

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (cookie) opts.headers['Cookie'] = cookie;
  const r = await fetch(BASE + path, opts);
  const resp = await r.json().catch(() => ({}));
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: r.status, body: resp };
}

let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.error(`✗ ${name}`, extra || ''); }
}
function hasKeys(obj, keys) { return keys.every(k => k in obj); }

(async () => {
  // 401 до логина
  let r = await req('GET', '/tasks');
  assert('401 без авторизации', r.status === 401);

  // Логин
  r = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert('вход админа', r.status === 200 && r.body.ok);

  // Проверка сессии
  r = await req('GET', '/auth/check');
  assert('сессия активна', r.body.authenticated === true);

  // Проект
  r = await req('POST', '/projects', { name: 'СПОТ' });
  assert('создание проекта', r.status === 201 && hasKeys(r.body, ['id','name']));
  const pid = r.body.id;

  // Категория (общая)
  r = await req('POST', '/categories', { name: 'Публикации' });
  assert('создание категории', r.status === 201 && r.body.id);
  const cid = r.body.id;

  // Задача
  r = await req('POST', '/tasks', { title: 'Подготовить статью по СПОТ', project_id: pid, category_id: cid, priority: 'HIGH', due_date: '2026-08-17', due_time: '14:00' });
  assert('создание задачи', r.status === 201 && hasKeys(r.body, ['id','title','project_id','category_id']));
  const tid = r.body.id;

  // Экран Сегодня
  r = await req('GET', '/tasks/today?tz=Europe/Moscow');
  assert('экран сегодня: today содержит задачу', r.status === 200 && Array.isArray(r.body.today) && r.body.today.some(t => t.id === tid));

  // Комментарий
  r = await req('POST', '/comments', { task_id: tid, text: 'Нужно согласовать с юристом' });
  assert('добавление комментария', r.status === 201 && r.body.task_id === tid);
  r = await req('GET', `/comments/task/${tid}`);
  assert('чтение комментариев (история)', r.status === 200 && r.body.length === 1);

  // Обновление задачи
  r = await req('PUT', `/tasks/${tid}`, { description: 'Описание тестовое' });
  assert('обновление задачи (description)', r.status === 200 && r.body.description === 'Описание тестовое');

  // Завершение (неповторяющаяся)
  r = await req('POST', `/tasks/${tid}/complete`);
  assert('завершение задачи', r.status === 200);
  r = await req('GET', `/tasks/${tid}`);
  assert('статус DONE', r.body.status === 'DONE' && r.body.completed_at);

  // Вернуть в работу
  r = await req('POST', `/tasks/${tid}/reopen`);
  assert('вернуть в работу', r.status === 200 && r.body.status === 'TODO');

  // Перенос
  r = await req('POST', `/tasks/${tid}/move`, { due_date: '2026-08-18' });
  assert('перенос задачи', r.status === 200 && r.body.due_date === '2026-08-18');

  // Повторяющаяся задача: создать, завершить → должен появиться следующий экземпляр
  r = await req('POST', '/tasks', { title: 'Ежедневная проверка', due_date: '2026-08-17', recurrence_rule: 'DAILY' });
  const rid = r.body.id;
  r = await req('POST', `/tasks/${rid}/complete`);
  assert('завершение повторяющейся', r.status === 200);
  r = await req('GET', '/tasks?recurrence_check=1');
  const dailyNext = r.body.find(t => t.title === 'Ежедневная проверка' && t.status === 'TODO');
  assert('создан следующий экземпляр повторяющейся', !!dailyNext && dailyNext.due_date === '2026-08-18');

  // Фильтр по проекту
  r = await req('GET', `/tasks?project_id=${pid}`);
  assert('фильтр по проекту', r.status === 200 && r.body.every(t => t.project_id === pid));

  console.log(`\nРезультат: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
