import { buildPushPayload } from '@block65/webcrypto-web-push';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_ITEMS = 1000;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json' } });
const fail = (status, error) => json({ error }, status);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const newCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname;
    try {
      if (path === '/api/config' && req.method === 'GET') return json({ publicKey: env.VAPID_PUBLIC_KEY });
      if (req.method !== 'POST') return fail(404, 'not_found');
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') return fail(400, 'bad_json');

      if (path === '/api/groups') return createGroup(env, body);
      if (path === '/api/join') return joinGroup(env, body);

      const me = await auth(env, req);
      if (!me) return fail(401, 'unauthorized');
      switch (path) {
        case '/api/sync': return sync(env, ctx, me, body);
        case '/api/subscribe': return subscribe(env, me, body);
        case '/api/unsubscribe': return unsubscribe(env, me, body);
        case '/api/test-push': return testPush(env, ctx, me);
        case '/api/leave': return leave(env, me);
      }
      return fail(404, 'not_found');
    } catch (e) {
      console.error(e);
      return fail(500, 'server_error');
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  },
};

async function auth(env, req) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  return env.DB.prepare('SELECT id, group_id, name FROM members WHERE token_hash = ?').bind(await sha256(m[1])).first();
}

async function addMember(env, groupId, name) {
  const token = randomHex(32);
  const id = randomHex(8);
  await env.DB.prepare('INSERT INTO members (id, group_id, name, token_hash, created) VALUES (?,?,?,?,?)')
    .bind(id, groupId, name, await sha256(token), Date.now()).run();
  return { token, memberId: id };
}

async function createGroup(env, body) {
  const name = str(body.name, 40);
  if (!name) return fail(400, 'name_required');
  const id = randomHex(8);
  let code;
  for (let i = 0; i < 5; i++) {
    code = newCode();
    try {
      await env.DB.prepare('INSERT INTO groups (id, code, rev, created) VALUES (?,?,0,?)').bind(id, code, Date.now()).run();
      break;
    } catch (e) { code = null; }
  }
  if (!code) return fail(500, 'code_failed');
  return json({ ...(await addMember(env, id, name)), code });
}

async function joinGroup(env, body) {
  const name = str(body.name, 40);
  const code = str(body.code, 16).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) return fail(400, 'name_required');
  const g = await env.DB.prepare('SELECT id FROM groups WHERE code = ?').bind(code).first();
  if (!g) return fail(404, 'bad_code');
  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM members WHERE group_id = ?').bind(g.id).first();
  if (count >= 10) return fail(409, 'group_full');
  return json({ ...(await addMember(env, g.id, name)), code });
}

async function nextRev(env, groupId) {
  const r = await env.DB.prepare('UPDATE groups SET rev = rev + 1 WHERE id = ? RETURNING rev').bind(groupId).first();
  return r.rev;
}

const canSee = (list, me) => list && (list.owner === null || list.owner === me.id);

async function sync(env, ctx, me, body) {
  const g = me.group_id;
  const since = Number.isInteger(body.since) ? body.since : 0;
  const inLists = Array.isArray(body.lists) ? body.lists : [];
  const inTasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (inLists.length + inTasks.length > MAX_ITEMS) return fail(413, 'too_many');

  const members = (await env.DB.prepare('SELECT id, name FROM members WHERE group_id = ?').bind(g).all()).results;
  const memberIds = new Set(members.map((m) => m.id));
  const events = [];

  for (const l of inLists) {
    const id = str(l.id, 40), name = str(l.name, 60), updated = Number(l.updated);
    if (!id || !name || !Number.isFinite(updated)) continue;
    const owner = l.owner === me.id ? me.id : null;
    const cur = await env.DB.prepare('SELECT owner, updated FROM lists WHERE group_id = ? AND id = ?').bind(g, id).first();
    if (cur && !canSee(cur, me)) continue;
    if (cur && updated <= cur.updated) continue;
    const rev = await nextRev(env, g);
    await env.DB.prepare(
      `INSERT INTO lists (group_id, id, name, owner, updated, deleted, rev) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(group_id, id) DO UPDATE SET name=excluded.name, updated=excluded.updated, deleted=excluded.deleted, rev=excluded.rev`
    ).bind(g, id, name, cur ? cur.owner : owner, updated, l.deleted ? 1 : 0, rev).run();
  }

  for (const t of inTasks) {
    const id = str(t.id, 40), listId = str(t.list, 40), text = str(t.text, 500), updated = Number(t.updated);
    if (!id || !listId || !text || !Number.isFinite(updated)) continue;
    const list = await env.DB.prepare('SELECT owner, deleted FROM lists WHERE group_id = ? AND id = ?').bind(g, listId).first();
    if (!canSee(list, me)) continue;
    const shared = list.owner === null;
    const cur = await env.DB.prepare('SELECT * FROM tasks WHERE group_id = ? AND id = ?').bind(g, id).first();
    if (cur && updated <= cur.updated) continue;
    const due = Number.isFinite(t.due) ? Math.trunc(t.due) : null;
    const assignee = shared && memberIds.has(t.assignee) ? t.assignee : null;
    const done = t.done ? 1 : 0, deleted = t.deleted ? 1 : 0;
    const prio = [0, 1, 2].includes(t.prio) ? t.prio : 0;
    const creator = cur ? cur.creator : me.id;
    const notified = cur && cur.due === due && !(cur.done && !done) ? cur.notified : 0;
    const rev = await nextRev(env, g);
    await env.DB.prepare(
      `INSERT INTO tasks (group_id, id, list_id, text, done, due, prio, assignee, creator, updated, deleted, notified, rev)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(group_id, id) DO UPDATE SET list_id=excluded.list_id, text=excluded.text, done=excluded.done, due=excluded.due,
         prio=excluded.prio, assignee=excluded.assignee, updated=excluded.updated, deleted=excluded.deleted,
         notified=excluded.notified, rev=excluded.rev`
    ).bind(g, id, listId, text, done, due, prio, assignee, creator, updated, deleted, notified, rev).run();

    if (shared && !deleted) {
      const others = members.filter((m) => m.id !== me.id).map((m) => m.id);
      const url = `./#${id}`;
      if (!cur || cur.deleted) {
        // новая задача: назначенному, иначе всем остальным
        const to = assignee && assignee !== me.id ? [assignee] : assignee ? [] : others;
        if (to.length) events.push({ to, title: assignee ? `${me.name} назначил(а) вам` : `${me.name} добавил(а) задачу`, body: text, tag: `t-${id}`, url });
      } else {
        if (assignee && assignee !== cur.assignee && assignee !== me.id)
          events.push({ to: [assignee], title: `${me.name} назначил(а) вам`, body: text, tag: `t-${id}`, url });
        if (done && !cur.done) events.push({ to: others, title: `${me.name} выполнил(а)`, body: text, tag: `d-${id}`, url });
      }
    }
  }

  if (events.length) ctx.waitUntil(Promise.all(events.map((e) => pushToMembers(env, e.to, e))));

  const lists = (await env.DB.prepare(
    'SELECT id, name, owner, updated, deleted, rev FROM lists WHERE group_id = ? AND rev > ? AND (owner IS NULL OR owner = ?)'
  ).bind(g, since, me.id).all()).results;
  const tasks = (await env.DB.prepare(
    `SELECT t.id, t.list_id AS list, t.text, t.done, t.due, t.prio, t.assignee, t.creator, t.updated, t.deleted, t.rev
     FROM tasks t JOIN lists l ON l.group_id = t.group_id AND l.id = t.list_id
     WHERE t.group_id = ? AND t.rev > ? AND (l.owner IS NULL OR l.owner = ?)`
  ).bind(g, since, me.id).all()).results;
  const { rev } = await env.DB.prepare('SELECT rev FROM groups WHERE id = ?').bind(g).first();
  return json({ rev, me: { id: me.id, name: me.name }, members, lists, tasks });
}

async function subscribe(env, me, body) {
  const s = body.subscription;
  const endpoint = s && s.endpoint, p256dh = s && s.keys && s.keys.p256dh, auth = s && s.keys && s.keys.auth;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !p256dh || !auth) return fail(400, 'bad_subscription');
  await env.DB.prepare(
    `INSERT INTO subs (endpoint, member_id, p256dh, auth, created) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id, p256dh=excluded.p256dh, auth=excluded.auth`
  ).bind(endpoint, me.id, p256dh, auth, Date.now()).run();
  return json({ ok: true });
}

async function unsubscribe(env, me, body) {
  await env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND member_id = ?').bind(str(body.endpoint, 2000), me.id).run();
  return json({ ok: true });
}

async function leave(env, me) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM subs WHERE member_id = ?').bind(me.id),
    env.DB.prepare('DELETE FROM members WHERE id = ?').bind(me.id),
    env.DB.prepare('UPDATE tasks SET assignee = NULL WHERE group_id = ? AND assignee = ?').bind(me.group_id, me.id),
    env.DB.prepare('DELETE FROM tasks WHERE group_id = ? AND list_id IN (SELECT id FROM lists WHERE group_id = ? AND owner = ?)').bind(me.group_id, me.group_id, me.id),
    env.DB.prepare('DELETE FROM lists WHERE group_id = ? AND owner = ?').bind(me.group_id, me.id),
  ]);
  return json({ ok: true });
}

async function testPush(env, ctx, me) {
  const n = await pushToMembers(env, [me.id], { title: 'Тестовое уведомление', body: 'Push работает 🎉', tag: 'test', url: './' });
  return json({ sent: n });
}

async function pushToMembers(env, memberIds, msg) {
  if (!memberIds.length) return 0;
  const q = memberIds.map(() => '?').join(',');
  const subs = (await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM subs WHERE member_id IN (${q})`).bind(...memberIds).all()).results;
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const data = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, url: msg.url });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const payload = await buildPushPayload(
        { data, options: { ttl: 3600, urgency: 'high' } },
        { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
        vapid,
      );
      const res = await fetch(s.endpoint, payload);
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(s.endpoint).run();
      else if (res.ok) sent++;
      else console.error('push failed', res.status, await res.text());
    } catch (e) { console.error('push error', e); }
  }));
  return sent;
}

async function sendDueReminders(env) {
  const now = Date.now();
  // давно просроченные не напоминаем, только помечаем
  await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE notified = 0 AND due IS NOT NULL AND due < ?').bind(now - 24 * 3600e3).run();
  const due = (await env.DB.prepare(
    'SELECT group_id, id, text, assignee, creator FROM tasks WHERE done = 0 AND deleted = 0 AND notified = 0 AND due IS NOT NULL AND due <= ? LIMIT 200'
  ).bind(now).all()).results;
  for (const t of due) {
    // помечаем до отправки: при гонке двух cron-запусков уведомление не задвоится
    const claimed = await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE group_id = ? AND id = ? AND notified = 0').bind(t.group_id, t.id).run();
    if (!claimed.meta.changes) continue;
    await pushToMembers(env, [t.assignee || t.creator], { title: '⏰ Пора', body: t.text, tag: `t-${t.id}`, url: `./#${t.id}` });
  }
}
