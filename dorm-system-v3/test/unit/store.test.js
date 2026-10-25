import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, transact } from '../../src/store.js';
test('transaction rollback prevents partial writes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-ut-')),
    db = openStore(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.throws(() =>
    transact(db, () => {
      db.prepare('INSERT INTO imports VALUES (?)').run('partial');
      throw Error('cancel');
    }),
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM imports').get().n, 0);
});
test('v2 migration discards legacy sessions and preserves business data', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-migration-'));
  let db = openStore(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec("ALTER TABLE sessions ADD COLUMN csrf TEXT NOT NULL DEFAULT ''; PRAGMA user_version=0;");
  db.prepare('INSERT INTO imports VALUES (?)').run('preserved');
  db.close();
  db = openStore(directory);
  assert.equal(db.prepare('SELECT count(*) AS n FROM dorms').get().n, 531);
  assert.equal(db.prepare('SELECT fingerprint FROM imports').get().fingerprint, 'preserved');
  assert.ok(
    !db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .some((c) => c.name === 'csrf'),
  );
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
});
