import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail, text } from './domain.js';
import { transact, audit } from './store.js';
const derive = promisify(scrypt);
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    fail('密码长度必须为12至128位');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await derive(password, salt, 64)).toString('hex') };
}
export async function createUser(db, input, actor = '命令行', authorize = () => {}) {
  const username = text(input.username, '账号', 40);
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(username)) fail('账号须为3至40位字母、数字、下划线或短横线');
  const name = text(input.name || username, '姓名', 80),
    role = input.role;
  if (!['admin', 'inspector'].includes(role)) fail('角色错误');
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail('账号已存在', 409);
  const { salt, hash } = await passwordHash(input.password);
  authorize();
  return transact(db, () => {
    const id = Number(
      db
        .prepare('INSERT INTO users(username,name,role,salt,hash) VALUES (?,?,?,?,?)')
        .run(username, name, role, salt, hash).lastInsertRowid,
    );
    audit(db, actor, 'create_user', username);
    return id;
  });
}
export function authService(db, config) {
  const buckets = new Map();
  let pending = 0;
  function current(req) {
    const token = /(?:^|;\s*)dorm_session=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || '',
    )?.[1];
    if (!token) return null;
    return db
      .prepare(
        `SELECT u.id,u.username,u.name,u.role,s.token FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.enabled=1`,
      )
      .get(digest(token), Date.now());
  }
  function required(req) {
    const user = current(req);
    if (!user) fail('请先登录', 401);
    return user;
  }
  function cookie(res, token, age) {
    res.setHeader(
      'Set-Cookie',
      `dorm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`,
    );
  }
  async function login(req, res, input) {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.expires < now) buckets.delete(k);
    const ip = req.ip || req.socket.remoteAddress;
    const username = typeof input?.username === 'string' ? input.username.trim().slice(0, 40) : '';
    const keys = [`ip:${ip}`, `user:${ip}:${username.toLowerCase()}`];
    if (buckets.size > 10000 || pending >= 4) fail('登录繁忙，请稍后再试', 429);
    keys.forEach((k, i) => {
      if ((buckets.get(k)?.count || 0) >= (i ? 8 : 60)) fail('登录尝试过多，请15分钟后重试', 429);
    });
    keys.forEach((k) => {
      const b = buckets.get(k) || { count: 0, expires: now + 900000 };
      b.count++;
      buckets.set(k, b);
    });
    if (typeof input?.password !== 'string' || input.password.length > 128)
      fail('账号或密码错误', 401);
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    pending++;
    let hash;
    try {
      hash = await derive(input.password, user?.salt || 'not-a-real-user', 64);
    } finally {
      pending--;
    }
    if (!user || !user.enabled || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex')))
      fail('账号或密码错误', 401);
    // Account may have been reset while asynchronous password verification ran.
    if (
      db.prepare('SELECT hash,enabled FROM users WHERE id=?').get(user.id)?.hash !== user.hash ||
      !db.prepare('SELECT enabled FROM users WHERE id=?').get(user.id)?.enabled
    )
      fail('账号已更新，请重新登录', 401);
    buckets.delete(keys[1]);
    const token = randomBytes(32).toString('hex');
    transact(db, () => {
      db.prepare('DELETE FROM sessions WHERE expires<? OR user_id=?').run(now, user.id);
      db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').run(
        digest(token),
        user.id,
        now + 28800000,
      );
      audit(db, user.username, 'login', user.id);
    });
    cookie(res, token, 28800);
    return { user: { id: user.id, username: user.username, name: user.name, role: user.role } };
  }
  function logout(req, res) {
    const u = current(req);
    if (u) db.prepare('DELETE FROM sessions WHERE token=?').run(u.token);
    cookie(res, '', 0);
  }
  return { current, required, login, logout };
}
