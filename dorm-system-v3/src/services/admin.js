import { transact, audit } from '../store.js';
import { text, int, validDate, fail } from '../domain.js';
import { passwordHash } from '../auth.js';
export async function updateUser(db, user, id, input, authorize) {
  const credentials = input.password ? await passwordHash(input.password) : null;
  authorize();
  transact(db, () => {
    const old = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!old) fail('账号不存在', 404);
    const name = text(input.name, '姓名', 80),
      role = input.role,
      enabled = input.enabled === true ? 1 : input.enabled === false ? 0 : null;
    if (!['admin', 'inspector'].includes(role) || enabled === null) fail('账号参数错误');
    if (
      old.role === 'admin' &&
      old.enabled &&
      (!enabled || role !== 'admin') &&
      db.prepare("SELECT count(*) AS n FROM users WHERE enabled=1 AND role='admin'").get().n <= 1
    )
      fail('不能停用或降级最后一个管理员', 409);
    db.prepare('UPDATE users SET name=?,role=?,enabled=?,salt=?,hash=? WHERE id=?').run(
      name,
      role,
      enabled,
      credentials?.salt || old.salt,
      credentials?.hash || old.hash,
      id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(db, user.username, 'update_user', old.username);
  });
  return { ok: true };
}
export function createPeriod(db, user, input) {
  const name = text(input.name, '学期名称', 80),
    start = validDate(input.start),
    weeks = int(input.weeks, 1, 52, '周数');
  if (new Date(start).getUTCDay() !== 1) fail('学期开始日期应为第1周周一');
  const id = transact(db, () => {
    if (input.active) db.exec('UPDATE periods SET active=0');
    const id = Number(
      db
        .prepare('INSERT INTO periods(name,start,weeks,active) VALUES (?,?,?,?)')
        .run(name, start, weeks, input.active ? 1 : 0).lastInsertRowid,
    );
    audit(db, user.username, 'create_period', id);
    return id;
  });
  return { id };
}
export function activatePeriod(db, user, id) {
  if (!db.prepare('SELECT id FROM periods WHERE id=?').get(id)) fail('学期不存在', 404);
  transact(db, () => {
    db.exec('UPDATE periods SET active=0');
    db.prepare('UPDATE periods SET active=1 WHERE id=?').run(id);
    audit(db, user.username, 'activate_period', id);
  });
  return { ok: true };
}
