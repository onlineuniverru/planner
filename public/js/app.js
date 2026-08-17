/* Personal Planner — SPA-фронтенд (vanilla JS, hash-routing) */
const BASE = location.pathname.startsWith('/planner') ? '/planner' : '';
const API = BASE + '/api';
let state = { projects: [], categories: [], tz: 'Europe/Moscow', currentTask: null };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtTime = t => t ? t.slice(0,5) : '';
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day:'numeric', month:'short' }) : '';

// --- API helper ---
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(API + path, opts);
  if (r.status === 401) { location.hash = '#/login'; throw new Error('unauthorized'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok && data.error) throw new Error(data.error);
  return data;
}

// --- Toast ---
let toastTimer;
function toast(msg, type = '') {
  const el = $('#toast'); el.textContent = msg; el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// --- Auth ---
async function init() {
  try {
    const check = await api('GET', '/auth/check');
    if (!check.authenticated) { showLogin(); bindLogin(); return; }
    await bootApp();
  } catch { showLogin(); bindLogin(); }
}

function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#login-error').textContent = '';
}
function bindLogin() {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#login-user').value, password = $('#login-pass').value;
    try {
      const r = await api('POST', '/auth/login', { username, password });
      state.tz = r.timezone || state.tz;
      await bootApp();
    } catch (err) { $('#login-error').textContent = err.message; }
  });
}
async function bootApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  state.projects = await api('GET', '/projects');
  state.categories = await api('GET', '/categories');
  updateTopbarDate();
  bindTabs();
  startRouter();
  render();
}

function bindTabs() {
  $$('#tabs .tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
}

// --- Роутер ---
const views = ['today', 'all', 'projects', 'done'];
function startRouter() {
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/today';
}
function currentView() {
  const h = location.hash.replace('#/', '');
  const v = h.split('/')[0];
  return views.includes(v) ? v : 'today';
}
function setView(v) { location.hash = '#/' + v; }

// --- Рендер ---
function render() {
  const v = currentView();
  $$('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  const view = $('#view');
  if (v === 'today') renderToday(view);
  else if (v === 'all') renderAll(view);
  else if (v === 'projects') renderProjects(view);
  else if (v === 'done') renderDone(view);
}

function updateTopbarDate() {
  try {
    $('#topbar-date').textContent = new Intl.DateTimeFormat('ru-RU', {
      weekday:'short', day:'numeric', month:'long'
    }).format(new Date());
  } catch { $('#topbar-date').textContent = ''; }
}

// --- Компонент задачи (переиспользуемый элемент списка) ---
function taskEl(t, opts = {}) {
  const el = document.createElement('div');
  el.className = 'task' + (t.status === 'DONE' ? ' done' : '');
  if (opts.overdue) el.classList.add('task-overdue');
  if (opts.isToday && t.status !== 'DONE') el.classList.add('task-today-border');
  const pri = t.priority || 'NORMAL';
  const meta = [];
  if (t.due_time) meta.push(`🕐 ${fmtTime(t.due_time)}`);
  if (t.project_name) meta.push(`📁 ${esc(t.project_name)}`);
  if (t.category_name) meta.push(`🏷 ${esc(t.category_name)}`);
  if (meta.length === 0) meta.push('Без срока');
  el.innerHTML = `
    <div class="task-check" data-complete="${t.id}">✓</div>
    <div class="task-body" data-open="${t.id}">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">
        <span class="pri-${pri}">${pri === 'HIGH' ? '▲' : pri === 'LOW' ? '▽' : '●'} ${pri === 'HIGH' ? 'Высокий' : pri === 'LOW' ? 'Низкий' : 'Средний'}</span>
        <span class="tag">${meta.join('</span><span class="tag">')}</span>
        ${t.due_date ? `<span>${fmtDate(t.due_date)}</span>` : ''}
      </div>
    </div>
    <div class="task-actions">
      ${opts.allowMove ? `<button class="icon-btn" data-move="${t.id}" title="Перенести">📅</button>` : ''}
    </div>`;
  return el;
}

// --- Экран Сегодня ---
async function renderToday(view) {
  view.innerHTML = '<div class="empty">Загрузка...</div>';
  let data;
  try { data = await api('GET', `/tasks/today?tz=${encodeURIComponent(state.tz)}`); }
  catch (e) { view.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`; return; }

  const doneCnt = data.done_today.length;
  const totalCnt = data.today.length + doneCnt;
  const pct = totalCnt ? Math.round(doneCnt / totalCnt * 100) : 0;

  let html = `
    <div class="progress-bar">
      <span class="progress-label">Сегодня выполнено:</span>
      <span class="progress-num">${doneCnt} / ${totalCnt}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;

  // Просрочено
  html += `<div class="section overdue"><h2>⚠️ Просрочено <span class="badge">${data.overdue.length}</span></h2>`;
  html += data.overdue.length ? '' : '<div class="empty" style="padding:16px">Нет просроченных</div>';
  view.innerHTML = html;
  data.overdue.forEach(t => view.appendChild(taskEl(t, { overdue: true, allowMove: true })));

  // Сегодня
  const secToday = document.createElement('div');
  secToday.className = 'section';
  secToday.innerHTML = `<h2>📌 Сегодня <span class="badge">${data.today.length}</span></h2>`;
  view.appendChild(secToday);
  if (data.today.length) data.today.forEach(t => secToday.appendChild(taskEl(t, { isToday: true, allowMove: true })));
  else secToday.appendChild(Object.assign(document.createElement('div'), { className:'empty', textContent:'На сегодня задач нет' }));

  // Далее
  const secNext = document.createElement('div');
  secNext.className = 'section';
  const upcoming = [...data.upcoming].sort((a,b) => (a.due_date||'').localeCompare(b.due_date||''));
  secNext.innerHTML = `<h2>🗓 Далее <span class="badge">${upcoming.length}</span></h2>`;
  view.appendChild(secNext);
  if (upcoming.length) upcoming.slice(0, 20).forEach(t => secNext.appendChild(taskEl(t, { allowMove: true })));
  else secNext.appendChild(Object.assign(document.createElement('div'), { className:'empty', textContent:'Предстоящих задач нет' }));

  bindListActions(view);
}

// --- Все задачи (фильтры + поиск) ---
async function renderAll(view) {
  const projOpts = `<option value="">Все проекты</option>` + state.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const catOpts = `<option value="">Все категории</option>` + state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  view.innerHTML = `
    <div class="filters">
      <input class="f-search" id="f-search" placeholder="🔍 Поиск...">
      <select id="f-project">${projOpts}</select>
      <select id="f-category">${catOpts}</select>
      <select id="f-priority">
        <option value="">Приоритет</option>
        <option value="LOW">Низкий</option><option value="NORMAL">Средний</option><option value="HIGH">Высокий</option>
      </select>
      <select id="f-status">
        <option value="">Статус</option>
        <option value="TODO">В работе</option>
        <option value="DONE">Выполнено</option>
        <option value="CANCELLED">Отменено</option>
      </select>
      <select id="f-period">
        <option value="">Период</option>
        <option value="overdue">Просроченные</option>
        <option value="week">Эта неделя</option><option value="month">Этот месяц</option>
      </select>
    </div>
    <div id="all-list" class="empty">Загрузка...</div>`;
  const apply = () => loadAll();
  $('#f-search').oninput = apply;
  $$('#f-project,#f-category,#f-priority,#f-status,#f-period').forEach(s => s.onchange = apply);
  await loadAll();
}

async function loadAll() {
  const qs = new URLSearchParams();
  const s = $('#f-search').value.trim(); if (s) qs.set('search', s);
  const p = $('#f-project').value; if (p) qs.set('project_id', p);
  const c = $('#f-category').value; if (c) qs.set('category_id', c);
  const pri = $('#f-priority').value; if (pri) qs.set('priority', pri);
  const st = $('#f-status').value; if (st) qs.set('status', st);
  const period = $('#f-period').value;
  const today = new Date().toISOString().slice(0,10);
  if (period === 'overdue') qs.set('date_to', new Date(Date.now()-864e5).toISOString().slice(0,10));
  if (period === 'week') { qs.set('date_from', today); qs.set('date_to', new Date(Date.now()+6*864e5).toISOString().slice(0,10)); }
  if (period === 'month') { qs.set('date_from', today); qs.set('date_to', new Date(Date.now()+30*864e5).toISOString().slice(0,10)); }
  const listEl = $('#all-list');
  try {
    const tasks = await api('GET', '/tasks?' + qs.toString());
    listEl.innerHTML = '';
    if (!tasks.length) { listEl.className = 'empty'; listEl.textContent = 'Ничего не найдено'; return; }
    listEl.className = '';
    tasks.forEach(t => listEl.appendChild(taskEl(t, { allowMove: true })));
    bindListActions(listEl);
  } catch (e) { listEl.textContent = 'Ошибка: ' + e.message; }
}

// --- Проекты ---
async function renderProjects(view) {
  view.innerHTML = '<div class="filters"><button class="btn btn-primary" id="btn-new-project">＋ Новый проект</button></div><div id="proj-list" class="empty">Загрузка...</div>';
  $('#btn-new-project').onclick = () => openProjectModal(null);
  state.projects = await api('GET', '/projects').catch(() => []);
  const list = $('#proj-list');
  list.innerHTML = ''; list.className = '';
  if (!state.projects.length) { list.className = 'empty'; list.textContent = 'Нет проектов'; }
  state.projects.forEach(p => {
    const el = document.createElement('div');
    el.className = 'project-card' + (p.status === 'ARCHIVED' ? ' archived' : '');
    const active = p.active_count || 0, done = p.done_count || 0;
    el.innerHTML = `<h4>${esc(p.name)} ${p.status === 'ARCHIVED' ? '<span class="p-arch">(архив)</span>' : ''}</h4>
      ${p.description ? `<p class="p-desc">${esc(p.description)}</p>` : ''}
      <div class="p-stats"><span>● Активных: ${active}</span><span>✓ Выполнено: ${done}</span><span>Всего: ${active + done}</span></div>`;
    el.onclick = () => openProjectModal(p);
    list.appendChild(el);
  });
}

// --- Выполненные ---
async function renderDone(view) {
  view.innerHTML = '<div class="empty">Загрузка...</div>';
  try {
    const tasks = await api('GET', '/tasks?status=DONE');
    if (!tasks.length) { view.innerHTML = '<div class="empty">Выполненных задач нет</div>'; return; }
    view.innerHTML = '';
    tasks.slice(0, 100).forEach(t => {
      const el = taskEl(t);
      el.classList.add('done');
      // кнопка возврата
      const actions = $('.task-actions', el);
      const rb = document.createElement('button');
      rb.className = 'icon-btn'; rb.title = 'Вернуть в работу'; rb.textContent = '↩️';
      rb.onclick = async e => { e.stopPropagation(); await completeTask(t.id, false); toast('Возвращено в работу', 'success'); };
      actions.prepend(rb);
      view.appendChild(el);
    });
    bindListActions(view);
  } catch (e) { view.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`; }
}

// --- События списка ---
function bindListActions(root) {
  $$('.task-check', root).forEach(cb => cb.onclick = async e => {
    e.stopPropagation();
    const id = cb.dataset.complete;
    await completeTask(id, true);
  });
  $$('.task-body', root).forEach(b => b.onclick = () => openTaskModal(b.dataset.open));
  $$('[data-move]', root).forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    promptMove(btn.dataset.move);
  });
}

async function completeTask(id, complete) {
  try {
    if (complete) {
      await api('POST', `/tasks/${id}/complete`);
      toast('✓ Выполнено', 'success');
    } else {
      await api('POST', `/tasks/${id}/reopen`);
      toast('Вернул в работу', 'success');
    }
    await refreshData();
    render();
  } catch (e) { toast(e.message, 'error'); }
}

async function refreshData() {
  state.projects = await api('GET', '/projects').catch(() => state.projects);
  state.categories = await api('GET', '/categories').catch(() => state.categories);
}

// --- Перенос даты ---
function promptMove(id) {
  const d = prompt('Перенести на дату (ГГГГ-ММ-ДД):');
  if (!d) return;
  const m = d.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!m) { toast('Неверный формат даты', 'error'); return; }
  api('POST', `/tasks/${id}/move`, { due_date: d })
    .then(() => { toast('Задача перенесена', 'success'); render(); })
    .catch(e => toast(e.message, 'error'));
}

// --- Быстрое создание ---
function bindQuickAdd() {
  $('#btn-quick-add').onclick = openQuickModal;
}
function openQuickModal() {
  const today = new Date().toISOString().slice(0,10);
  $('#q-title').value = ''; $('#q-date').value = today;
  $('#q-time').value = ''; $('#q-priority').value = 'NORMAL';
  $('#q-remind').value = ''; $('#q-repeat').value = ''; $('#q-desc').value = '';
  fillProjectSelect('q-project'); fillCategorySelect('q-category');
  openModal('quick-modal'); setTimeout(() => $('#q-title').focus(), 100);
}
function fillProjectSelect(id) {
  const sel = $('#' + id); sel.innerHTML = '<option value="">—</option>' +
    state.projects.filter(p => p.status === 'ACTIVE').map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}
function fillCategorySelect(id) {
  const sel = $('#' + id); sel.innerHTML = '<option value="">—</option>' +
    state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function remindOffsetToTs(dateVal, timeVal, offsetKey) {
  if (!dateVal) return null;
  const map = { '5m':5,'15m':15,'1h':60,'1d':1440 };
  const mins = map[offsetKey]; if (!mins) return null;
  let base = new Date(dateVal + 'T' + (timeVal || '09:00'));
  base.setMinutes(base.getMinutes() - mins);
  return base.toISOString();
}

// --- Модалки: открытие/закрытие ---
function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); if (id === 'task-modal') state.currentTask = null; }
$$('.modal-close').forEach(b => b.onclick = () => closeModal(b.dataset.close));
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));

// --- Карточка задачи ---
async function openTaskModal(id) {
  const t = await api('GET', `/tasks/${id}`).catch(() => null);
  if (!t) { toast('Задача не найдена', 'error'); return; }
  state.currentTask = t;
  $('#t-title').value = t.title;
  $('#t-desc').value = t.description || '';
  $('#t-priority').value = t.priority || 'NORMAL';
  $('#t-status').value = t.status;
  $('#t-date').value = t.due_date || '';
  $('#t-time').value = t.due_time ? fmtTime(t.due_time) : '';
  $('#t-repeat').value = t.recurrence_rule || '';
  // Напоминание: показать опцию (приблизительно)
  const remind = t.reminder_at ? '5m' : ''; $('#t-remind').value = remind;
  fillProjectSelect('t-project'); fillCategorySelect('t-category');
  $('#t-project').value = t.project_id || '';
  $('#t-category').value = t.category_id || '';
  // Показываем/скрываем «Вернуть в работу»
  $('#t-reopen').style.display = t.status === 'DONE' ? '' : 'none';
  bindTaskActions(t);
  await loadComments(t.id);
  openModal('task-modal');
}

function bindTaskActions(t) {
  $('#task-form').onsubmit = async e => { e.preventDefault(); await saveTask(t.id); };
  $('#t-complete').onclick = async () => { await completeTask(t.id, true); closeModal('task-modal'); };
  $('#t-reopen').onclick = async () => { await completeTask(t.id, false); closeModal('task-modal'); };
  $('#t-delete').onclick = async () => {
    if (!confirm('Удалить задачу?')) return;
    await api('DELETE', `/tasks/${t.id}`).catch(e => toast(e.message, 'error'));
    closeModal('task-modal'); toast('Удалено', 'success'); render();
  };
  $('#comment-form').onsubmit = async e => {
    e.preventDefault();
    const text = $('#c-text').value.trim();
    if (!text) return;
    await api('POST', '/comments', { task_id: t.id, text });
    $('#c-text').value = '';
    await loadComments(t.id);
    toast('Комментарий добавлен', 'success');
  };
}

async function saveTask(id) {
  const payload = {
    title: $('#t-title').value.trim(),
    description: $('#t-desc').value,
    project_id: $('#t-project').value || null,
    category_id: $('#t-category').value || null,
    priority: $('#t-priority').value,
    status: $('#t-status').value,
    due_date: $('#t-date').value || null,
    due_time: $('#t-time').value || null,
    recurrence_rule: $('#t-repeat').value || null,
    reminder_at: remindOffsetToTs($('#t-date').value, $('#t-time').value, $('#t-remind').value),
  };
  // Спецобработка: если выбрано "—" у напоминания — очистить
  try {
    await api('PUT', `/tasks/${id}`, payload);
    if (!$('#t-remind').value) await api('DELETE', `/tasks/${id}/reminder`).catch(() => {});
    closeModal('task-modal'); toast('Сохранено', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadComments(taskId) {
  const list = $('#comments-list');
  list.innerHTML = '';
  const rows = await api('GET', `/comments/task/${taskId}`).catch(() => []);
  if (!rows.length) { list.innerHTML = '<div class="empty" style="padding:12px">Комментариев пока нет</div>'; return; }
  rows.forEach(c => {
    const el = document.createElement('div');
    el.className = 'comment';
    const time = new Date(c.created_at).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    el.innerHTML = `${esc(c.text)}<span class="c-time">${time}</span>`;
    list.appendChild(el);
  });
  list.scrollTop = list.scrollHeight;
}

// --- Проект-модалка ---
function openProjectModal(p) {
  $('#p-name').value = p ? p.name : '';
  $('#p-desc').value = p ? p.description || '' : '';
  if (p) {
    $('#project-form').onsubmit = async e => { e.preventDefault(); await api('PUT', `/projects/${p.id}`, { name: $('#p-name').value.trim(), description: $('#p-desc').value }); closeModal('project-modal'); toast('Сохранено', 'success'); await refreshData(); render(); };
    $('#p-archive').style.display = '';
    $('#p-archive').onclick = async () => {
      const act = p.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      await api('POST', `/projects/${p.id}/${act}`);
      closeModal('project-modal'); await refreshData(); render(); toast(act === 'archive' ? 'Архивирован' : 'Возвращён из архива', 'success');
    };
  } else {
    $('#project-form').onsubmit = async e => { e.preventDefault(); await api('POST', '/projects', { name: $('#p-name').value.trim(), description: $('#p-desc').value }); closeModal('project-modal'); toast('Создан', 'success'); await refreshData(); render(); };
    $('#p-archive').style.display = 'none';
  }
  openModal('project-modal');
}

// --- Быстрое создание submit ---
$('#quick-form').addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    title: $('#q-title').value.trim(),
    project_id: $('#q-project').value || null,
    category_id: $('#q-category').value || null,
    priority: $('#q-priority').value,
    due_date: $('#q-date').value || null,
    due_time: $('#q-time').value || null,
    recurrence_rule: $('#q-repeat').value || null,
    description: $('#q-desc').value,
    reminder_at: remindOffsetToTs($('#q-date').value, $('#q-time').value, $('#q-remind').value),
  };
  try {
    await api('POST', '/tasks', payload);
    closeModal('quick-modal');
    toast('✓ Задача создана', 'success');
    render();
  } catch (err) { toast(err.message, 'error'); }
});

bindQuickAdd();
initBrowserNotifications();
init();

// --- PWA + Browser-уведомления (Этап 6) ---
function initBrowserNotifications() {
  // Регистрация service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(BASE + '/sw.js').catch(() => {});
  }
  // Полинг браузерных напоминаний (после логина проверяем каждые 30с)
  setInterval(checkBrowserNotifications, 30000);
}

async function checkBrowserNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  // Спрашиваем разрешение при первом заходе (лениво)
  if (Notification.permission === 'default') {
    Notification.requestPermission();
    return;
  }
  try {
    const rows = await api('GET', '/reminders/browser');
    for (const r of rows) {
      try {
        const n = new Notification('⏰ Планировщик', {
          body: r.title + (r.due_date ? '\nСрок: ' + fmtDate(r.due_date) : ''),
          icon: 'data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>🗓️</text></svg>',
          tag: 'task-' + r.id
        });
        n.onclick = () => { window.focus(); location.hash = '#/today'; n.close(); };
        await api('POST', '/reminders/browser/ack', { task_id: r.id });
      } catch {}
    }
  } catch {}
}
