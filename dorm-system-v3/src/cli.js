import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { backup } from 'node:sqlite';
import { openStore, transact, audit } from './store.js';
import { createUser, passwordHash } from './auth.js';
import { validateRecord } from './domain.js';

async function secret(prompt) {
  if (!process.stdin.isTTY)
    throw Error('请在交互终端中设置密码；Docker请使用 docker compose run 或 exec，不要加-T');
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = (chunk) => {
      for (const ch of chunk.toString()) {
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.exit(130);
        }
        if (ch === '\r' || ch === '\n') {
          process.stdin.off('data', handler);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    process.stdin.on('data', handler);
  });
}
const [command, ...args] = process.argv.slice(2);
let db;
try {
  db = openStore();
  if (command === 'user') {
    const username = args[0] || 'admin',
      role = args[1] || 'admin',
      name = args[2] || username;
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(username) || !['admin', 'inspector'].includes(role))
      throw Error('账号需3—40位字母/数字/_/-，角色为admin或inspector');
    const old = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    console.log(
      old
        ? `将重置账号 ${username} 的密码、姓名和角色并重新启用。`
        : `创建${role === 'admin' ? '管理员' : '检查员'}账号：${username}`,
    );
    const password = await secret('新密码（12—128位，不回显）：'),
      confirm = await secret('再次输入密码：');
    if (password !== confirm) throw Error('两次密码不一致');
    if (!old) await createUser(db, { username, name, role, password });
    else {
      const credentials = await passwordHash(password);
      transact(db, () => {
        if (
          old.role === 'admin' &&
          old.enabled &&
          role !== 'admin' &&
          db.prepare("SELECT count(*) AS n FROM users WHERE enabled=1 AND role='admin'").get().n <=
            1
        )
          throw Error('不能降级最后一个管理员');
        db.prepare('UPDATE users SET name=?,role=?,salt=?,hash=?,enabled=1 WHERE id=?').run(
          name,
          role,
          credentials.salt,
          credentials.hash,
          old.id,
        );
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(old.id);
        audit(db, '命令行', 'update_user', username);
      });
    }
    console.log('账号已保存，请使用该账号登录。');
  } else if (command === 'backup') {
    const file = resolve(
      args[0] || `backups/dorm-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    if (existsSync(file)) throw Error('备份文件已存在，请使用新文件名');
    mkdirSync(dirname(file), { recursive: true });
    await backup(db, file);
    console.log('完整备份已保存：' + file);
  } else if (command === 'import-json') {
    if (!args[0] || !args[1])
      throw Error('用法：node src/cli.js import-json 旧records.json路径 学期ID');
    const raw = readFileSync(resolve(args[0]), 'utf8').replace(/^\uFEFF/, ''),
      items = JSON.parse(raw),
      periodId = Number(args[1]);
    if (!Array.isArray(items)) throw Error('旧文件必须为记录数组');
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    if (db.prepare('SELECT fingerprint FROM imports WHERE fingerprint=?').get(fingerprint))
      throw Error('该文件已导入，拒绝重复导入');
    const valid = [],
      skipped = [];
    for (const [index, old] of items.entries()) {
      try {
        const dorm = db
          .prepare(
            'SELECT id FROM dorms WHERE grade=? AND campus=? AND building=? AND dorm=? AND className=?',
          )
          .get(old.grade, old.campus, old.building, old.dorm, old.className);
        if (!dorm) throw Error('宿舍基础信息无法匹配');
        const photos = [
          { slot: 0, data: old.fullPhoto, description: '' },
          ...(old.details || [])
            .map((p, i) => ({ slot: i + 1, data: p.img, description: p.desc || '' }))
            .filter((p) => p.data?.startsWith('data:image/')),
        ];
        valid.push(
          validateRecord(db, {
            periodId,
            dormId: dorm.id,
            week: Number(String(old.week).replace(/\D/g, '')),
            date: old.date,
            inspector: old.inspector,
            scores: Object.values(old.scores || {}).map(Number),
            photos,
          }),
        );
      } catch (error) {
        skipped.push({ row: index + 1, error: error.message });
      }
    }
    if (skipped.length) {
      console.error(JSON.stringify(skipped, null, 2));
      throw Error('存在无法导入的记录，已取消全部导入。请修正以上行后重试。');
    }
    transact(db, () => {
      for (const r of valid) {
        const id = Number(
          db
            .prepare(
              'INSERT INTO records(period_id,dorm_id,week,date,inspector,scores,total,owner_id) VALUES (?,?,?,?,?,?,?,NULL)',
            )
            .run(
              r.periodId,
              r.dormId,
              r.week,
              r.date,
              r.inspector,
              JSON.stringify(r.scores),
              r.total,
            ).lastInsertRowid,
        );
        for (const p of r.photos)
          db.prepare(
            'INSERT INTO photos(record_id,slot,description,mime,bytes) VALUES (?,?,?,?,?)',
          ).run(id, p.slot, p.description, p.mime, p.bytes);
      }
      db.prepare('INSERT INTO imports(fingerprint) VALUES (?)').run(fingerprint);
      audit(db, '命令行', 'import_records', valid.length);
    });
    console.log(`已导入${valid.length}条记录。旧记录归管理员管理，旧账号请重新创建。`);
  } else if (command === 'periods')
    console.table(db.prepare('SELECT * FROM periods ORDER BY id').all());
  else
    throw Error(
      '命令：user [账号] [admin|inspector] [姓名]；backup [新备份路径]；periods；import-json 文件 学期ID',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
