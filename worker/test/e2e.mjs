// Сквозной тест API против `npm run dev` (http://localhost:8787).
import assert from 'node:assert/strict';
const B = process.env.API || 'http://localhost:8787';
const call = async (path, body, token) => {
  const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const now = Date.now();

const a = await call('/api/groups', { name: 'Аня' });
assert.ok(a.token && a.code, 'group created');
assert.equal((await call('/api/join', { code: 'ZZZZZZZZ', name: 'X' })).status, 404);
const b = await call('/api/join', { code: a.code.toLowerCase(), name: 'Борис' });
assert.ok(b.token, 'joined');
assert.equal((await call('/api/sync', {}, 'bad')).status, 401);

// Аня создаёт общий список, личный список и задачи
let r = await call('/api/sync', {
  since: 0,
  lists: [{ id: 'L1', name: 'Дом', owner: null, updated: now }, { id: 'P1', name: 'Секрет', owner: a.memberId, updated: now }],
  tasks: [
    { id: 'T1', list: 'L1', text: 'Купить молоко', done: false, due: now + 60000, prio: 1, assignee: b.memberId, updated: now },
    { id: 'T2', list: 'P1', text: 'Личное', done: false, due: null, prio: 0, assignee: b.memberId, updated: now },
  ],
}, a.token);
assert.equal(r.members.length, 2);
assert.equal(r.lists.length, 2); assert.equal(r.tasks.length, 2);
const t2 = r.tasks.find((t) => t.id === 'T2');
assert.equal(t2.assignee, null, 'assignee ignored in private list');

// Борис видит только общее
let rb = await call('/api/sync', { since: 0 }, b.token);
assert.deepEqual(rb.lists.map((l) => l.id), ['L1']);
assert.deepEqual(rb.tasks.map((t) => t.id), ['T1']);
assert.equal(rb.tasks[0].assignee, b.memberId);
assert.equal(rb.tasks[0].due, now + 60000);

// Борис пытается писать в чужой личный список и менять его
rb = await call('/api/sync', { since: rb.rev, tasks: [{ id: 'T3', list: 'P1', text: 'взлом', updated: now + 1 }], lists: [{ id: 'P1', name: 'hack', updated: now + 5 }] }, b.token);
let ra = await call('/api/sync', { since: 0 }, a.token);
assert.ok(!ra.tasks.some((t) => t.id === 'T3'));
assert.equal(ra.lists.find((l) => l.id === 'P1').name, 'Секрет');

// LWW: старое изменение не затирает новое
await call('/api/sync', { tasks: [{ id: 'T1', list: 'L1', text: 'Устарело', done: false, updated: now - 1000 }] }, b.token);
await call('/api/sync', { tasks: [{ id: 'T1', list: 'L1', text: 'Купить молоко', done: true, due: now + 60000, assignee: b.memberId, updated: now + 10 }] }, b.token);
ra = await call('/api/sync', { since: 0 }, a.token);
const t1 = ra.tasks.find((t) => t.id === 'T1');
assert.equal(t1.text, 'Купить молоко'); assert.equal(t1.done, 1);

// инкрементальный since
const before = ra.rev;
const empty = await call('/api/sync', { since: before }, a.token);
assert.equal(empty.tasks.length + empty.lists.length, 0);

// подписка (формат Safari/Chrome)
const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');
const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
assert.equal((await call('/api/subscribe', { subscription: { endpoint: 'http://x' } }, a.token)).status, 400);
assert.ok((await call('/api/subscribe', { subscription: { endpoint: 'https://push.invalid/abc', keys: { p256dh, auth } } }, a.token)).ok);
const tp = await call('/api/test-push', {}, a.token);
assert.equal(tp.sent, 0, 'unreachable endpoint → 0 sent (но без падения)');

assert.ok((await call('/api/leave', {}, b.token)).ok);
assert.equal((await call('/api/sync', {}, b.token)).status, 401);
console.log('OK');
