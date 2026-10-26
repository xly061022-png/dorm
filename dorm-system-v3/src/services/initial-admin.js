import { passwordHash } from '../auth.js';
import { text, fail } from '../domain.js';
import { transact, audit } from '../store.js';

// Existing accounts are authoritative, even if an administrator was disabled.
export async function initializeAdmin(db, env = process.env) {
  const exists = () => db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (exists()) return { created: false };
  const username = text(env.INITIAL_ADMIN_USERNAME || 'admin', '初始管理员账号', 40);
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(username))
    fail('初始管理员账号须为3至40位字母、数字、下划线或短横线');
  const name = text(env.INITIAL_ADMIN_NAME || '管理员', '初始管理员姓名', 80);
  if (!env.INITIAL_ADMIN_PASSWORD)
    fail(
      '尚无管理员：请在环境变量或 .env 中设置 INITIAL_ADMIN_PASSWORD（12至128位），然后重新启动。',
    );
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username))
    fail('初始管理员账号与现有非管理员账号重名，请换一个 INITIAL_ADMIN_USERNAME；不会覆盖原账号。');
  const credentials = await passwordHash(env.INITIAL_ADMIN_PASSWORD);
  return transact(db, () => {
    // Another process could finish initialization while password hashing awaits.
    if (exists()) return { created: false };
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username))
      fail('初始管理员账号已被占用，请修改 INITIAL_ADMIN_USERNAME');
    const id = Number(
      db
        .prepare("INSERT INTO users(username,name,role,salt,hash) VALUES (?,?,'admin',?,?)")
        .run(username, name, credentials.salt, credentials.hash).lastInsertRowid,
    );
    audit(db, '首次启动', 'create_user', username);
    return { created: true, id, username };
  });
}
