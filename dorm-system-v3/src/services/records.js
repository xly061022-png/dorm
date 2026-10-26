import { transact, audit } from '../store.js';
import { fail, validateRecord, level } from '../domain.js';
import { own, admin } from './permissions.js';
import { addPhotos } from '../repositories/photos.js';
import { recordSelect, filters, page } from '../repositories/queries.js';

export function createRecord(db, user, input) {
  const r = validateRecord(db, input);
  const id = transact(db, () => {
    const id = Number(
      db
        .prepare(
          'INSERT INTO records(period_id,dorm_id,week,date,inspector,scores,total,owner_id) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          r.periodId,
          r.dormId,
          r.week,
          r.date,
          r.inspector,
          JSON.stringify(r.scores),
          r.total,
          user.id,
        ).lastInsertRowid,
    );
    addPhotos(db, id, r.photos);
    audit(db, user.username, 'create_record', id);
    return id;
  });
  return { id };
}
export function updateRecord(db, user, id, input) {
  const r = transact(db, () => {
    const old = db.prepare('SELECT * FROM records WHERE id=?').get(id);
    if (!old) fail('记录不存在', 404);
    own(user, old);
    if (input.version !== old.version) fail('记录已被他人修改，请重新打开后再编辑', 409);
    const r = validateRecord(db, input, id);
    db.prepare(
      'UPDATE records SET period_id=?,dorm_id=?,week=?,date=?,inspector=?,scores=?,total=?,version=version+1 WHERE id=?',
    ).run(r.periodId, r.dormId, r.week, r.date, r.inspector, JSON.stringify(r.scores), r.total, id);
    addPhotos(db, id, r.photos);
    audit(db, user.username, 'update_record', id);
    return { id, version: old.version + 1 };
  });
  return r;
}
export function deleteRecord(db, user, id, input) {
  admin(user);
  transact(db, () => {
    const old = db.prepare('SELECT version FROM records WHERE id=?').get(id);
    if (!old) fail('记录不存在', 404);
    if (input.version !== old.version) fail('记录已变化，请刷新后再删除', 409);
    db.prepare('DELETE FROM records WHERE id=?').run(id);
    audit(db, user.username, 'delete_record', id);
  });
  return { ok: true };
}
export function getRecord(db, id) {
  const r = db.prepare(recordSelect + ' WHERE r.id=?').get(id);
  if (!r) fail('记录不存在', 404);
  r.scores = JSON.parse(r.scores);
  r.level = level(r.total);
  r.photos = db
    .prepare('SELECT id,slot,description FROM photos WHERE record_id=? ORDER BY slot')
    .all(id);
  return r;
}
export function listRecords(db, q, un = false) {
  const f = filters(db, q, un);
  const base = un ? 'FROM dorms d' : 'FROM records r JOIN record_dorms d ON d.id=r.id';
  const select = un ? 'SELECT d.* FROM dorms d' : recordSelect;
  return page(
    db,
    select +
      ' WHERE ' +
      f.where +
      (un ? ' ORDER BY d.grade,d.building,d.dorm,d.id' : ' ORDER BY r.date DESC,r.id DESC'),
    'SELECT count(*) AS n ' + base + ' WHERE ' + f.where,
    f.args,
    q,
    (r) => {
      if (!un) {
        delete r.scores;
        r.level = level(r.total);
      }
      return r;
    },
  );
}
