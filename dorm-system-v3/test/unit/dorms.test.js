import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../src/store.js';
import {
  parseDormCsv,
  previewDormImport,
  importDorms,
  inspectionStatus,
  updateDorm,
  listDorms,
} from '../../src/services/dorms.js';
const header = '年级,校区,楼栋,宿舍号,性别,班级\r\n';
test('CSV quoted fields, BOM, leading zeros and malformed input', () => {
  const rows = parseDormCsv('\uFEFF' + header + '2027级,主校区,新楼,001,男,"电信1班,2班"\r\n');
  assert.equal(rows[0].dorm, '001');
  assert.equal(rows[0].className, '电信1班,2班');
  for (const content of ['', header, header + '"bad', header + 'a,b', '年级,年级\na,b'])
    assert.throws(() => parseDormCsv(content));
});
test('import previews without writes, adds atomically, skips repeats and survives restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-import-'));
  let db = openStore(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const csv = header + '2027级,主校区,新楼,001,男,电信1班\n';
  assert.equal(previewDormImport(db, csv).added, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM dorms').get().n, 531);
  assert.throws(() =>
    importDorms(db, { username: 'admin' }, csv + '2027级,主校区,新楼,002,未知,电信2班'),
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM dorms').get().n, 531);
  assert.equal(importDorms(db, { username: 'admin' }, csv + csv.split('\r\n')[1]).added, 1);
  assert.equal(importDorms(db, { username: 'admin' }, csv).skipped, 1);
  db.close();
  db = openStore(directory);
  assert.equal(db.prepare("SELECT dorm FROM dorms WHERE building='新楼'").get().dorm, '001');
});
test('completion follows physical rooms, semester/week, edits and deletes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-status-'));
  const db = openStore(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const dorm = db.prepare('SELECT * FROM dorms WHERE id=1').get();
  const duplicate = Number(
    db
      .prepare(
        'INSERT INTO dorms(grade,campus,building,dorm,gender,className) VALUES (?,?,?,?,?,?)',
      )
      .run('新年级', dorm.campus, dorm.building, dorm.dorm, dorm.gender, '另一个班')
      .lastInsertRowid,
  );
  const id = Number(
    db
      .prepare(
        'INSERT INTO records(period_id,dorm_id,week,date,inspector,scores,total) VALUES (1,1,6,?,?,?,90)',
      )
      .run('2026-10-12', '检查员', JSON.stringify(Array(10).fill(9))).lastInsertRowid,
  );
  assert.ok(inspectionStatus(db, 1, 6).checkedIds.includes(duplicate));
  assert.ok(!inspectionStatus(db, 1, 7).checkedIds.includes(1));
  db.prepare('UPDATE records SET week=7 WHERE id=?').run(id);
  assert.ok(!inspectionStatus(db, 1, 6).checkedIds.includes(1));
  assert.ok(inspectionStatus(db, 1, 7).checkedIds.includes(1));
  db.prepare('DELETE FROM records WHERE id=?').run(id);
  assert.equal(inspectionStatus(db, 1, 7).checkedIds.length, 0);
});

test('editing directory preserves record snapshots, rejects conflicts and migrates old records', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-edit-'));
  let db = openStore(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const old = db.prepare('SELECT * FROM dorms WHERE id=1').get();
  const record = Number(
    db
      .prepare(
        'INSERT INTO records(period_id,dorm_id,week,date,inspector,scores,total) VALUES (1,1,6,?,?,?,90)',
      )
      .run('2026-10-12', '检查员', JSON.stringify(Array(10).fill(9))).lastInsertRowid,
  );
  // Emulate the pre-upgrade schema to exercise the backfill on startup.
  db.exec(
    'DROP TRIGGER record_dorm_insert; DROP TRIGGER record_dorm_change; DROP TABLE record_dorms;',
  );
  db.close();
  db = openStore(directory);
  assert.equal(
    db.prepare('SELECT className FROM record_dorms WHERE id=?').get(record).className,
    old.className,
  );
  const input = {
    ...old,
    grade: '2028级',
    campus: '修改校区',
    building: '修改楼',
    dorm: '0009',
    className: '修改班级',
  };
  assert.equal(updateDorm(db, { username: 'admin' }, 1, input).version, 2);
  assert.throws(() => updateDorm(db, { username: 'admin' }, 1, input), { status: 409 });
  const duplicate = db.prepare('SELECT * FROM dorms WHERE id=2').get();
  assert.throws(() => updateDorm(db, { username: 'admin' }, 1, { ...duplicate, version: 2 }), {
    status: 409,
  });
  assert.throws(
    () => updateDorm(db, { username: 'admin' }, 1, { ...input, version: 2, dorm: '' }),
    { status: 400 },
  );
  assert.equal(listDorms(db, new URLSearchParams('keyword=0009')).total, 1);
  assert.equal(db.prepare('SELECT dorm FROM record_dorms WHERE id=?').get(record).dorm, old.dorm);
  db.prepare('UPDATE records SET dorm_id=1,total=80 WHERE id=?').run(record);
  assert.equal(
    db.prepare('SELECT className FROM record_dorms WHERE id=?').get(record).className,
    old.className,
  );
  const newer = Number(
    db
      .prepare(
        'INSERT INTO records(period_id,dorm_id,week,date,inspector,scores,total) VALUES (1,1,7,?,?,?,90)',
      )
      .run('2026-10-19', '检查员', JSON.stringify(Array(10).fill(9))).lastInsertRowid,
  );
  assert.equal(db.prepare('SELECT dorm FROM record_dorms WHERE id=?').get(newer).dorm, '0009');
  db.prepare('UPDATE records SET dorm_id=2 WHERE id=?').run(record);
  assert.equal(
    db.prepare('SELECT className FROM record_dorms WHERE id=?').get(record).className,
    duplicate.className,
  );
  db.close();
  db = openStore(directory);
  assert.equal(db.prepare('SELECT dorm FROM dorms WHERE id=1').get().dorm, '0009');
  assert.equal(db.prepare('SELECT dorm FROM record_dorms WHERE id=?').get(newer).dorm, '0009');
});
