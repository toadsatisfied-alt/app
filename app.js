'use strict';

const KEY = 'todo-state-v1';
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);

const defaults = () => ({
  lists: [{ id: 'work', name: 'Работа' }, { id: 'home', name: 'Дом' }, { id: 'shop', name: 'Покупки' }],
  tasks: [],
  view: 'all',
  showDone: false,
});

let state = load();
function load() {
  try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY))); }
  catch { return defaults(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const isToday = (iso) => iso && startOfDay(iso).getTime() === startOfDay(Date.now()).getTime();
const hasTime = (iso) => iso.length > 10;

function fmtDue(iso) {
  const d = new Date(iso);
  const today = startOfDay(Date.now());
  const diff = Math.round((startOfDay(d) - today) / 864e5);
  const day = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера'
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}
const isOverdue = (t) => !t.done && t.due && new Date(t.due) < new Date();

function visible(t) {
  if (state.view === 'all') return true;
  if (state.view === 'today') return t.due && (isToday(t.due) || isOverdue(t));
  return t.list === state.view;
}
function sorted(arr) {
  return arr.slice().sort((a, b) =>
    (b.prio - a.prio) || ((a.due || '9') < (b.due || '9') ? -1 : 1) || a.created - b.created);
}

function viewName() {
  if (state.view === 'all') return 'Все';
  if (state.view === 'today') return 'Сегодня';
  const l = state.lists.find((x) => x.id === state.view);
  return l ? l.name : 'Все';
}

function renderTabs() {
  const count = (v) => state.tasks.filter((t) => !t.done && (v === 'all' || (v === 'today' ? t.due && (isToday(t.due) || isOverdue(t)) : t.list === v))).length;
  const tabs = [{ id: 'all', name: 'Все' }, { id: 'today', name: 'Сегодня' }, ...state.lists];
  $('tabs').replaceChildren(...tabs.map((l) => {
    const b = document.createElement('button');
    b.className = 'tab' + (l.id === state.view ? ' active' : '');
    b.textContent = l.name;
    const n = document.createElement('span');
    n.className = 'n'; n.textContent = count(l.id) || '';
    b.append(n);
    b.onclick = () => { state.view = l.id; state.showDone = false; save(); render(); };
    return b;
  }));
  const add = document.createElement('button');
  add.className = 'tab'; add.textContent = '+ Список';
  add.onclick = addList;
  $('tabs').append(add);
}

function row(t) {
  const li = document.createElement('li');
  li.className = `p${t.prio}` + (t.done ? ' done' : '');
  const c = document.createElement('button');
  c.className = 'check'; c.setAttribute('aria-label', t.done ? 'Вернуть' : 'Выполнить');
  c.textContent = t.done ? '✓' : '';
  c.onclick = () => { t.done = !t.done; save(); render(); };
  const b = document.createElement('button');
  b.className = 'body';
  const txt = document.createElement('span');
  txt.className = 'txt'; txt.textContent = t.text;
  b.append(txt);
  const parts = [];
  if (t.due) parts.push(fmtDue(t.due));
  if (state.view === 'all' || state.view === 'today') {
    const l = state.lists.find((x) => x.id === t.list);
    if (l) parts.push(l.name);
  }
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
  const mine = state.tasks.filter(visible);
  const open = sorted(mine.filter((t) => !t.done));
  const done = sorted(mine.filter((t) => t.done));
  $('tasks').replaceChildren(...open.map(row));
  $('empty').hidden = open.length > 0 || done.length > 0;
  $('toggle-done').hidden = done.length === 0;
  $('toggle-done').textContent = (state.showDone ? 'Скрыть выполненные' : 'Показать выполненные') + ` (${done.length})`;
  $('done-tasks').hidden = !state.showDone || done.length === 0;
  $('done-tasks').replaceChildren(...(state.showDone ? done.map(row) : []));
  syncBadge();
  document.title = 'Задачи';
}

$('toggle-done').onclick = () => { state.showDone = !state.showDone; save(); render(); };

/* ---- lists ---- */
function addList() {
  const name = (prompt('Название списка') || '').trim();
  if (!name) return;
  const l = { id: uid(), name };
  state.lists.push(l);
  state.view = l.id;
  save(); render();
}
$('title').onclick = () => {
  const l = state.lists.find((x) => x.id === state.view);
  if (!l) return;
  const name = prompt('Название списка (пусто — удалить список и его задачи)', l.name);
  if (name === null) return;
  if (!name.trim()) {
    if (!confirm(`Удалить «${l.name}» и все его задачи?`)) return;
    state.tasks = state.tasks.filter((t) => t.list !== l.id);
    state.lists = state.lists.filter((x) => x.id !== l.id);
    state.view = 'all';
  } else l.name = name.trim();
  save(); render();
};

/* ---- add / edit ---- */
const defaultList = () => (state.lists.some((l) => l.id === state.view) ? state.view : (state.lists[0] || {}).id || '');

$('quick').onsubmit = (e) => {
  e.preventDefault();
  const text = $('quick-text').value.trim();
  if (!text) return;
  const due = state.view === 'today' ? localISO(new Date().setHours(new Date().getHours() + 1, 0, 0, 0)) : '';
  state.tasks.push({ id: uid(), text, done: false, list: defaultList(), due, prio: 0, created: Date.now() });
  $('quick-text').value = '';
  save(); render();
};
$('quick-more').onclick = () => openSheet(null, $('quick-text').value.trim());

function localISO(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let editing = null;
function openSheet(task, text = '') {
  editing = task;
  $('f-text').value = task ? task.text : text;
  $('f-due').value = task ? task.due : '';
  $('f-prio').value = task ? task.prio : 0;
  $('f-list').replaceChildren(...state.lists.map((l) => new Option(l.name, l.id)));
  $('f-list').value = task ? task.list : defaultList();
  $('f-delete').hidden = !task;
  $('sheet').showModal();
}
$('f-cancel').onclick = () => $('sheet').close();
$('f-delete').onclick = () => {
  state.tasks = state.tasks.filter((t) => t !== editing);
  save(); render(); $('sheet').close();
};
$('sheet-form').onsubmit = () => {
  const text = $('f-text').value.trim();
  if (!text) return;
  const data = { text, due: $('f-due').value, prio: +$('f-prio').value, list: $('f-list').value };
  if (editing) Object.assign(editing, data, { notified: false });
  else { state.tasks.push({ id: uid(), done: false, created: Date.now(), ...data }); $('quick-text').value = ''; }
  save(); render();
};

/* ---- reminders ----
   iOS can't fire local notifications while the PWA is closed (that needs a push
   server), so: notify while the app is open, and show the overdue count as a badge. */
function syncBadge() {
  const n = state.tasks.filter(isOverdue).length;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}
async function checkReminders() {
  let changed = false;
  for (const t of state.tasks) {
    if (t.done || !t.due || t.notified || new Date(t.due) > new Date()) continue;
    t.notified = true; changed = true;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready;
        const opts = { body: fmtDue(t.due), tag: t.id };
        reg ? reg.showNotification(t.text, opts) : new Notification(t.text, opts);
      } catch {}
    }
  }
  if (changed) { save(); render(); }
}
function setupBell() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  $('bell').hidden = false;
  $('bell').onclick = async () => {
    const r = await Notification.requestPermission();
    if (r !== 'default') $('bell').hidden = true;
  };
}

setupBell();
render();
checkReminders();
setInterval(checkReminders, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); render(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
