CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  rev INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_group ON members(group_id);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subs_member ON subs(member_id);
CREATE TABLE IF NOT EXISTS lists (
  group_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  PRIMARY KEY (group_id, id)
);
CREATE TABLE IF NOT EXISTS tasks (
  group_id TEXT NOT NULL,
  id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due INTEGER,
  prio INTEGER NOT NULL DEFAULT 0,
  assignee TEXT,
  creator TEXT NOT NULL,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  PRIMARY KEY (group_id, id)
);
CREATE INDEX IF NOT EXISTS tasks_rev ON tasks(group_id, rev);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due) WHERE done = 0 AND deleted = 0 AND notified = 0;
