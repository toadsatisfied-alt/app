'use strict';

const KEY = 'todo-state-v2';
const OLD_KEY = 'todo-state-v1';
const API = (window.TODO_API || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();

/* ---------- state ---------- */
const defaults = () => ({
  lists: ['Работа', 'Дом', 'Покупки'].map((name, i) => ({ id: ['work', 'home', 'shop'][i], name, owner: null, updated: 1, deleted: false, dirty: false })),
  tasks: [],
  view: 'all',
  showDone: false,
  sync: null, // { token, me:{id,name}, code, rev, members:[{id,name}], push, online }
});

let state = load();
function load() {
  try {
    const cur = JSON.parse(localStorage.getItem(KEY));
    if (cur) return Object.assign(defaults(), cur);
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old) return migrate(old);
  } catch {}
  return defaults();
}
function migrate(old) {
  const s = Object.assign(defaults(), { view: old.view, showDone: old.showDone });
  if (old.lists) s.lists = old.lists.map((l) => ({ id: l.id, name: l.name, owner: null, updated: 1, deleted: false, dirty: false }));
  s.tasks = (old.tasks || []).map((t) => ({
    id: t.id, text: t.text, done: !!t.done, list: t.list, prio: t.prio || 0,
    due: t.due ? new Date(t.due).getTime() : null, assignee: null, creator: null,
    created: t.created || now(), updated: t.created || now(), deleted: false, dirty: false, notified: !!t.notified,
  }));
  return s;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
function touch(item) {
  item.updated = now();
  item.dirty = true;
  save();
  scheduleSync();
}

const liveLists = () => state.lists.filter((l) => !l.deleted);
const liveTasks = () => state.tasks.filter((t) => !t.deleted);
const myId = () => state.sync && state.sync.me.id;
const memberName = (id) => {
  if (!id || !state.sync) return '';
  if (id === myId()) return 'Я';
  const m = state.sync.members.find((x) => x.id === id);
  return m ? m.name : '';
};
const listById = (id) => state.lists.find((l) => l.id === id);
const isShared = (l) => !!l && !l.owner;

/* ---------- dates ---------- */
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const isToday = (ms) => ms != null && startOfDay(ms).getTime() === startOfDay(now()).getTime();
const isOverdue = (t) => !t.done && t.due != null && t.due < now();

function fmtDue(ms) {
  const d = new Date(ms);
  const diff = Math.round((startOfDay(d) - startOfDay(now())) / 864e5);
  const day = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера'
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
function localISO(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- views ---------- */
function inView(t, v = state.view) {
  if (v === 'all') return true;
  if (v === 'today') return t.due != null && (isToday(t.due) || isOverdue(t));
  if (v === 'mine') return t.assignee === myId();
  return t.list === v;
}
const sorted = (arr) => arr.slice().sort((a, b) =>
  (b.prio - a.prio) || ((a.due ?? Infinity) - (b.due ?? Infinity)) || a.created - b.created);

function viewName() {
  if (state.view === 'all') return 'Все';
  if (state.view === 'today') return 'Сегодня';
  if (state.view === 'mine') return 'Мои';
  const l = listById(state.view);
  return l && !l.deleted ? listLabel(l) : 'Все';
}
const listLabel = (l) => (l.owner ? '🔒 ' : '') + l.name;

function renderTabs() {
  const open = liveTasks().filter((t) => !t.done);
  const tabs = [{ id: 'all', name: 'Все' }, { id: 'today', name: 'Сегодня' }];
  if (state.sync) tabs.push({ id: 'mine', name: 'Мои' });
  tabs.push(...liveLists().map((l) => ({ id: l.id, name: listLabel(l) })));
  $('tabs').replaceChildren(...tabs.map((l) => {
    const b = document.createElement('button');
    b.className = 'tab' + (l.id === state.view ? ' active' : '');
    b.textContent = l.name;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = open.filter((t) => inView(t, l.id)).length || '';
    b.append(n);
    b.onclick = () => { state.view = l.id; state.showDone = false; save(); render(); };
    return b;
  }));
  const add = document.createElement('button');
  add.className = 'tab';
  add.textContent = '+ Список';
  add.onclick = addList;
  $('tabs').append(add);
}

function row(t) {
  const li = document.createElement('li');
  li.className = `p${t.prio}` + (t.done ? ' done' : '');
  const c = document.createElement('button');
  c.className = 'check';
  c.setAttribute('aria-label', t.done ? 'Вернуть' : 'Выполнить');
  c.textContent = t.done ? '✓' : '';
  c.onclick = () => { t.done = !t.done; touch(t); render(); };
  const b = document.createElement('button');
  b.className = 'body';
  const txt = document.createElement('span');
  txt.className = 'txt';
  txt.textContent = t.text;
  b.append(txt);
  const parts = [];
  if (t.due != null) parts.push(fmtDue(t.due));
  if (state.view === 'all' || state.view === 'today' || state.view === 'mine') {
    const l = listById(t.list);
    if (l) parts.push(listLabel(l));
  }
  const who = memberName(t.assignee);
  if (who) parts.push('→ ' + who);
  if (parts.length) {
    const m = document.createElement('span');
    m.className = 'meta' + (isOverdue(t) ? ' overdue' : '');
    m.textContent = parts.join(' · ');
    b.append(m);
  }
  b.onclick = () => openSheet(t);
  li.append(c, b);
  return li;
}

function render() {
  $('title').textContent = viewName();
  renderTabs();
  const mine = liveTasks().filter((t) => inView(t) && !(listById(t.list) || {}).deleted);
  const open = sorted(mine.filter((t) => !t.done));
  const done = sorted(mine.filter((t) => t.done));
  $('tasks').replaceChildren(...open.map(row));
  $('empty').hidden = open.length > 0 || done.length > 0;
  $('toggle-done').hidden = done.length === 0;
  $('toggle-done').textContent = (state.showDone ? 'Скрыть выполненные' : 'Показать выполненные') + ` (${done.length})`;
  $('done-tasks').hidden = !state.showDone || done.length === 0;
  $('done-tasks').replaceChildren(...(state.showDone ? done.map(row) : []));
  const dot = $('sync-dot');
  dot.hidden = !state.sync;
  dot.className = state.sync && !state.sync.online ? 'off' : '';
  syncBadge();
  setupBell();
}

$('toggle-done').onclick = () => { state.showDone = !state.showDone; save(); render(); };

/* ---------- lists ---------- */
function addList() {
  const name = (prompt('Название списка') || '').trim();
  if (!name) return;
  const priv = state.sync && confirm('Сделать список личным? Его увидите только вы. «Отмена» — общий список.');
  const l = { id: uid(), name, owner: priv ? myId() : null, updated: now(), deleted: false, dirty: true };
  state.lists.push(l);
  state.view = l.id;
  save(); render(); scheduleSync();
}
$('title').onclick = () => {
  const l = listById(state.view);
  if (!l) return;
  const name = prompt('Название списка (пусто — удалить список и его задачи)', l.name);
  if (name === null) return;
  if (!name.trim()) {
    if (!confirm(`Удалить «${l.name}» и все его задачи?`)) return;
    liveTasks().filter((t) => t.list === l.id).forEach((t) => { t.deleted = true; touch(t); });
    l.deleted = true;
    state.view = 'all';
  } else l.name = name.trim();
  touch(l); render();
};

/* ---------- add / edit ---------- */
const defaultList = () => {
  const l = listById(state.view);
  return l && !l.deleted ? l.id : (liveLists()[0] || {}).id || '';
};

function addTask(fields) {
  const t = Object.assign({
    id: uid(), text: '', done: false, list: defaultList(), due: null, prio: 0, assignee: null,
    creator: myId(), created: now(), deleted: false, dirty: true, notified: false,
  }, fields);
  if (!isShared(listById(t.list))) t.assignee = null;
  state.tasks.push(t);
  touch(t);
  return t;
}

$('quick').onsubmit = (e) => {
  e.preventDefault();
  const text = $('quick-text').value.trim();
  if (!text) return;
  const due = state.view === 'today' ? new Date().setHours(new Date().getHours() + 1, 0, 0, 0) : null;
  addTask({ text, due, assignee: state.view === 'mine' ? myId() : null });
  $('quick-text').value = '';
  render();
};
$('quick-more').onclick = () => openSheet(null, $('quick-text').value.trim());

let editing = null;
function fillAssignee(listId, value) {
  const show = state.sync && isShared(listById(listId));
  $('f-assignee-row').hidden = !show;
  if (!show) return;
  $('f-assignee').replaceChildren(new Option('Никому', ''), ...state.sync.members.map((m) => new Option(m.id === myId() ? 'Мне' : m.name, m.id)));
  $('f-assignee').value = value || '';
}
function openSheet(task, text = '') {
  editing = task;
  $('f-text').value = task ? task.text : text;
  $('f-due').value = task && task.due != null ? localISO(task.due) : '';
  $('f-prio').value = task ? task.prio : 0;
  $('f-list').replaceChildren(...liveLists().map((l) => new Option(listLabel(l), l.id)));
  $('f-list').value = task ? task.list : defaultList();
  fillAssignee($('f-list').value, task ? task.assignee : '');
  $('f-delete').hidden = !task;
  $('sheet').showModal();
}
$('f-list').onchange = () => fillAssignee($('f-list').value, $('f-assignee').value);
$('f-cancel').onclick = () => $('sheet').close();
$('f-delete').onclick = () => {
  editing.deleted = true;
  touch(editing); render(); $('sheet').close();
};
$('sheet-form').onsubmit = () => {
  const text = $('f-text').value.trim();
  if (!text) return;
  const list = $('f-list').value;
  const data = {
    text, list, prio: +$('f-prio').value,
    due: $('f-due').value ? new Date($('f-due').value).getTime() : null,
    assignee: state.sync && isShared(listById(list)) ? $('f-assignee').value || null : null,
  };
  if (editing) {
    if (data.due !== editing.due) data.notified = false;
    Object.assign(editing, data);
    touch(editing);
  } else {
    addTask(data);
    $('quick-text').value = '';
  }
  render();
};

/* ---------- sync ---------- */
let syncing = false, syncTimer = 0, syncAgain = false;
function scheduleSync() {
  if (!state.sync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 400);
}

async function api(path, body, token) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { status: res.status, code: data.error });
  return data;
}

const wireList = (l) => ({ id: l.id, name: l.name, owner: l.owner, updated: l.updated, deleted: l.deleted });
const wireTask = (t) => ({ id: t.id, list: t.list, text: t.text, done: t.done, due: t.due, prio: t.prio, assignee: t.assignee, updated: t.updated, deleted: t.deleted });

async function doSync() {
  const s = state.sync;
  if (!s || s.revoked) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    const sentLists = state.lists.filter((l) => l.dirty);
    const sentTasks = state.tasks.filter((t) => t.dirty);
    const sent = new Map([...sentLists, ...sentTasks].map((x) => [x.id, x.updated]));
    const r = await api('/api/sync', { since: s.rev, lists: sentLists.map(wireList), tasks: sentTasks.map(wireTask) }, s.token);

    for (const x of [...sentLists, ...sentTasks]) if (x.updated === sent.get(x.id)) x.dirty = false;
    for (const l of r.lists) {
      const cur = listById(l.id);
      if (cur && cur.updated >= l.updated) continue;
      Object.assign(cur || state.lists[state.lists.push({}) - 1], { id: l.id, name: l.name, owner: l.owner, updated: l.updated, deleted: !!l.deleted, dirty: false });
    }
    for (const t of r.tasks) {
      let cur = state.tasks.find((x) => x.id === t.id);
      if (cur && cur.updated >= t.updated) continue;
      if (!cur) { cur = { created: t.updated, notified: false }; state.tasks.push(cur); }
      const dueChanged = cur.due !== t.due;
      Object.assign(cur, { id: t.id, list: t.list, text: t.text, done: !!t.done, due: t.due, prio: t.prio, assignee: t.assignee, creator: t.creator, updated: t.updated, deleted: !!t.deleted, dirty: false });
      if (dueChanged) cur.notified = false;
    }
    s.rev = r.rev;
    s.members = r.members;
    s.me = r.me;
    s.online = true;
    save();
    render();
    if (document.getElementById('settings').open) renderSettings();
  } catch (e) {
    if (e.status === 401) { s.revoked = true; s.online = false; }
    else s.online = false;
    save();
    render();
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}

setInterval(() => { if (!document.hidden) doSync(); }, 10000);
window.addEventListener('online', doSync);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { doSync(); checkReminders(); render(); } });
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data === 'sync') doSync(); });

/* ---------- push & reminders ---------- */
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const pushSupported = () => 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;

async function enablePush() {
  if (!pushSupported()) throw new Error('Push не поддерживается. На iPhone установите приложение на экран «Домой» (iOS 16.4+).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Уведомления запрещены. Включите их в Настройки → Уведомления → Задачи.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch(API + '/api/config')).json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  await api('/api/subscribe', { subscription: sub.toJSON() }, state.sync.token);
  state.sync.push = true;
  save(); render();
}
async function disablePush() {
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) { await api('/api/unsubscribe', { endpoint: sub.endpoint }, state.sync.token); await sub.unsubscribe(); }
  } catch {}
  state.sync.push = false;
  save(); render();
}

function syncBadge() {
  const n = liveTasks().filter(isOverdue).length;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}

// Локальные напоминания — только пока открыто приложение и нет серверного push
async function checkReminders() {
  if (state.sync && state.sync.push) return;
  let changed = false;
  for (const t of liveTasks()) {
    if (t.done || t.due == null || t.notified || t.due > now()) continue;
    if (state.sync && t.assignee && t.assignee !== myId()) continue;
    t.notified = true;
    changed = true;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready;
        const opts = { body: fmtDue(t.due), tag: 't-' + t.id };
        reg ? reg.showNotification(t.text, opts) : new Notification(t.text, opts);
      } catch {}
    }
  }
  if (changed) { save(); render(); }
}

function setupBell() {
  const bell = $('bell');
  const want = state.sync
    ? !state.sync.push && !state.sync.revoked
    : 'Notification' in window && Notification.permission === 'default';
  bell.hidden = !want;
  bell.onclick = async () => {
    try {
      if (state.sync) await enablePush();
      else await Notification.requestPermission();
    } catch (e) { alert(e.message); }
    render();
  };
}

/* ---------- settings ---------- */
function h(tag, props = {}, ...kids) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.flat().filter((k) => k != null));
  return el;
}
const settingsDlg = $('settings');
$('gear').onclick = () => { renderSettings(); settingsDlg.showModal(); };
settingsDlg.addEventListener('click', (e) => { if (e.target === settingsDlg) settingsDlg.close(); });

function renderSettings(msg = '', isErr = false) {
  const body = $('settings-body');
  const note = msg ? h('p', { className: isErr ? 'err' : '', textContent: msg }) : null;
  const close = h('button', { type: 'button', textContent: 'Закрыть', onclick: () => settingsDlg.close() });
  const s = state.sync;

  if (!API) {
    body.replaceChildren(h('h2', { textContent: 'Настройки' }),
      h('p', { textContent: 'Сервер синхронизации не подключён: задачи хранятся только на этом телефоне. Чтобы делиться списками с другим iPhone, разверните сервер (папка worker) и укажите его адрес в config.js.' }), close);
    return;
  }

  if (!s) {
    const name = h('input', { placeholder: 'Ваше имя', maxLength: 40, autocomplete: 'off' });
    const code = h('input', { placeholder: 'Код приглашения', maxLength: 12, autocapitalize: 'characters', autocomplete: 'off' });
    const run = (fn) => async (e) => {
      const btn = e.currentTarget;
      if (!name.value.trim()) return renderSettings('Введите имя', true);
      btn.disabled = true;
      try { await fn(); } catch (err) {
        const text = { bad_code: 'Код не найден', group_full: 'В группе нет мест' }[err.code] || 'Не удалось подключиться. Проверьте интернет.';
        renderSettings(text, true);
      }
    };
    const connect = (r) => {
      state.sync = { token: r.token, me: { id: r.memberId, name: name.value.trim() }, code: r.code, rev: 0, members: [], push: false, online: true };
      state.lists.forEach((l) => { l.dirty = true; });
      state.tasks.forEach((t) => { t.dirty = true; t.creator = t.creator || r.memberId; });
      save(); render(); doSync();
      renderSettings('Готово! Теперь включите уведомления кнопкой ниже.');
    };
    body.replaceChildren(
      h('h2', { textContent: 'Синхронизация' }),
      h('p', { textContent: 'Объедините два iPhone: общие списки, задачи с назначением и уведомления.' }),
      note, name,
      h('button', { className: 'primary', textContent: 'Создать группу', onclick: run(async () => connect(await api('/api/groups', { name: name.value }))) }),
      h('div', { className: 'sep' }), code,
      h('button', { textContent: 'Войти по коду', onclick: run(async () => connect(await api('/api/join', { name: name.value, code: code.value }))) }),
      close);
    return;
  }

  const pushBtn = s.push
    ? [h('button', { textContent: 'Отправить тестовое уведомление', onclick: async () => {
        try { const r = await api('/api/test-push', {}, s.token); renderSettings(r.sent ? 'Отправлено — должно прийти за пару секунд' : 'Не отправлено: подписка устарела, выключите и включите уведомления', !r.sent); }
        catch { renderSettings('Нет связи с сервером', true); }
      } }),
      h('button', { textContent: 'Выключить push-уведомления', onclick: async () => { await disablePush(); renderSettings(); } })]
    : [h('button', { className: 'primary', textContent: 'Включить push-уведомления', onclick: async () => {
        try { await enablePush(); renderSettings('Push включены'); } catch (e) { renderSettings(e.message, true); }
      } })];

  body.replaceChildren(
    h('h2', { textContent: 'Синхронизация' }),
    s.revoked ? h('p', { className: 'err', textContent: 'Доступ к группе потерян. Выйдите из группы и войдите снова.' }) : null,
    note,
    h('p', { textContent: `Вы: ${s.me.name} · ${s.online ? 'онлайн' : 'нет связи'}` }),
    h('p', { textContent: 'Код приглашения для второго телефона:' }),
    h('div', { className: 'code', textContent: s.code }),
    h('p', { textContent: 'В группе: ' + (s.members.map((m) => m.name).join(', ') || s.me.name) }),
    ...pushBtn,
    h('button', { textContent: 'Синхронизировать сейчас', onclick: async () => { await doSync(); renderSettings(); } }),
    h('button', { className: 'danger', textContent: 'Выйти из группы', onclick: async () => {
      if (!confirm('Выйти из группы? Ваши личные списки на сервере будут удалены, общие задачи останутся у этого телефона.')) return;
      try { await disablePush(); await api('/api/leave', {}, s.token); } catch {}
      state.lists = state.lists.filter((l) => !l.owner);
      state.tasks = state.tasks.filter((t) => (listById(t.list) || {}).id);
      state.tasks.forEach((t) => { t.assignee = null; });
      state.sync = null;
      state.view = 'all';
      save(); render(); renderSettings();
    } }),
    close);
}

/* ---------- start ---------- */
render();
checkReminders();
setInterval(checkReminders, 30000);
if (state.sync) {
  doSync();
  // подписка могла устареть — обновляем её на сервере
  if (state.sync.push && pushSupported() && Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription())
      .then((sub) => sub && api('/api/subscribe', { subscription: sub.toJSON() }, state.sync.token)).catch(() => {});
  }
}
if (location.hash.length > 1) {
  const t = state.tasks.find((x) => x.id === location.hash.slice(1));
  if (t && !t.deleted) openSheet(t);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
