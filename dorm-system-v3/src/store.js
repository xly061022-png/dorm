import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function openStore(directory = process.env.DATA_DIR || resolve(root, 'storage')) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'dorm.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','inspector')),
      salt TEXT NOT NULL, hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      start TEXT NOT NULL, weeks INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_period ON periods(active) WHERE active=1;
    CREATE TABLE IF NOT EXISTS dorms (
      id INTEGER PRIMARY KEY AUTOINCREMENT, grade TEXT NOT NULL, campus TEXT NOT NULL,
      building TEXT NOT NULL, dorm TEXT NOT NULL, gender TEXT NOT NULL, className TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS dorm_filters ON dorms(grade,gender,building);
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, period_id INTEGER NOT NULL REFERENCES periods(id),
      dorm_id INTEGER NOT NULL REFERENCES dorms(id), week INTEGER NOT NULL,
      date TEXT NOT NULL, inspector TEXT NOT NULL, scores TEXT NOT NULL, total INTEGER NOT NULL,
      owner_id INTEGER REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX IF NOT EXISTS records_filter ON records(period_id,week,dorm_id,id DESC);
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL, description TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL,
      UNIQUE(record_id,slot));
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
      target TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS imports (fingerprint TEXT PRIMARY KEY);
  `);
  // v2 -> v3: discard only obsolete sessions; users, records and photos stay intact.
  if (
    db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .some((column) => column.name === 'csrf')
  ) {
    transact(db, () => {
      db.exec('DELETE FROM sessions; ALTER TABLE sessions DROP COLUMN csrf;');
    });
  }
  // Snapshot the room labels once, so editing the directory never rewrites history.
  transact(db, () => {
    if (
      !db
        .prepare('PRAGMA table_info(dorms)')
        .all()
        .some((column) => column.name === 'version')
    ) {
      db.exec('ALTER TABLE dorms ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS record_dorms (
      id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
      grade TEXT NOT NULL, campus TEXT NOT NULL, building TEXT NOT NULL,
      dorm TEXT NOT NULL, gender TEXT NOT NULL, className TEXT NOT NULL);
      INSERT INTO record_dorms SELECT r.id,d.grade,d.campus,d.building,d.dorm,d.gender,d.className
        FROM records r JOIN dorms d ON d.id=r.dorm_id WHERE NOT EXISTS (SELECT 1 FROM record_dorms s WHERE s.id=r.id);
      CREATE TRIGGER IF NOT EXISTS record_dorm_insert AFTER INSERT ON records BEGIN
        INSERT INTO record_dorms SELECT NEW.id,grade,campus,building,dorm,gender,className FROM dorms WHERE id=NEW.dorm_id;
      END;
      CREATE TRIGGER IF NOT EXISTS record_dorm_change AFTER UPDATE OF dorm_id ON records WHEN NEW.dorm_id != OLD.dorm_id BEGIN
        DELETE FROM record_dorms WHERE id=NEW.id;
        INSERT INTO record_dorms SELECT NEW.id,grade,campus,building,dorm,gender,className FROM dorms WHERE id=NEW.dorm_id;
      END;
      PRAGMA user_version=4;`);
  });
  if (!db.prepare('SELECT count(*) AS n FROM dorms').get().n) {
    const dorms = JSON.parse(
      readFileSync(resolve(root, 'seed/dorms.json'), 'utf8').replace(/^\uFEFF/, ''),
    );
    const insert = db.prepare(
      'INSERT INTO dorms(grade,campus,building,dorm,gender,className) VALUES (?,?,?,?,?,?)',
    );
    transact(db, () => {
      for (const d of dorms)
        insert.run(d.grade, d.campus, d.building, d.dorm, d.gender || '待确认', d.className);
    });
  }
  if (!db.prepare('SELECT count(*) AS n FROM periods').get().n) {
    db.prepare('INSERT INTO periods(name,start,weeks,active) VALUES (?,?,?,1)').run(
      '2026—2027学年第一学期',
      '2026-09-07',
      20,
    );
  }
  return db;
}
export function transact(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function audit(db, actor, action, target) {
  db.prepare('INSERT INTO audit(actor,action,target) VALUES (?,?,?)').run(
    actor,
    action,
    String(target),
  );
}
