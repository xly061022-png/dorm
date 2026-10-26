import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../../src/store.js';
import { initializeAdmin } from '../../src/services/initial-admin.js';
import { createUser, authService } from '../../src/auth.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'initial-admin-'));
  const db = openStore(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return db;
}
const password = 'Initial-Admin-12345';
test('first startup creates a hashed administrator that can log in', async (t) => {
  const db = fixture(t);
  assert.equal((await initializeAdmin(db, { INITIAL_ADMIN_PASSWORD: password })).created, true);
  const user = db.prepare('SELECT * FROM users').get();
  assert.equal(user.username, 'admin');
  assert.equal(user.role, 'admin');
  assert.notEqual(user.hash, password);
  const auth = authService(db, { secure: false });
  let cookie;
  const login = await auth.login(
    { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
    {
      setHeader: (_, value) => {
        cookie = value;
      },
    },
    { username: 'admin', password },
  );
  assert.equal(login.user.id, user.id);
  assert.match(cookie, /HttpOnly/);
});
test('later startup ignores changed or missing bootstrap credentials', async (t) => {
  const db = fixture(t);
  await initializeAdmin(db, { INITIAL_ADMIN_PASSWORD: password });
  const original = db.prepare('SELECT * FROM users').get();
  assert.equal(
    (
      await initializeAdmin(db, {
        INITIAL_ADMIN_USERNAME: 'other',
        INITIAL_ADMIN_PASSWORD: 'different-password',
      })
    ).created,
    false,
  );
  assert.equal((await initializeAdmin(db, {})).created, false);
  assert.deepEqual(db.prepare('SELECT * FROM users').all(), [original]);
  db.exec('UPDATE users SET enabled=0');
  assert.equal((await initializeAdmin(db, { INITIAL_ADMIN_PASSWORD: password })).created, false);
  assert.equal(db.prepare('SELECT enabled FROM users').get().enabled, 0);
});
test('missing or invalid initial password does not create an account', async (t) => {
  const db = fixture(t);
  await assert.rejects(initializeAdmin(db, {}), /INITIAL_ADMIN_PASSWORD/);
  await assert.rejects(initializeAdmin(db, { INITIAL_ADMIN_PASSWORD: 'short' }), /12至128/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
});
test('existing inspector is never overwritten or promoted by initialization', async (t) => {
  const db = fixture(t);
  await createUser(db, { username: 'admin', name: '检查员', role: 'inspector', password });
  await assert.rejects(initializeAdmin(db, { INITIAL_ADMIN_PASSWORD: password }), /重名/);
  assert.equal(db.prepare('SELECT role FROM users').get().role, 'inspector');
  assert.equal(
    (
      await initializeAdmin(db, {
        INITIAL_ADMIN_USERNAME: 'manager',
        INITIAL_ADMIN_NAME: '学院管理',
        INITIAL_ADMIN_PASSWORD: password,
      })
    ).created,
    true,
  );
});
test('simultaneous initialization creates only one administrator', async (t) => {
  const db = fixture(t);
  const env = { INITIAL_ADMIN_PASSWORD: password };
  const result = await Promise.all([initializeAdmin(db, env), initializeAdmin(db, env)]);
  assert.equal(result.filter((r) => r.created).length, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get().n, 1);
});
