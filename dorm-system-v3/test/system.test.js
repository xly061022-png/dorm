import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { backup, DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server.js';
import { createUser } from '../src/auth.js';
import { root } from '../src/store.js';
import { request as httpRequest } from 'node:http';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N1sAAAAASUVORK5CYII=';
test('end-to-end API, authorization, pagination, persistence and migration', async (t) => {
  const directory = mkdtempSync(resolve(root, 'test-data-'));
  const config = { host: '127.0.0.1', port: 0, secure: false, trustProxy: false };
  let app = createApp({ directory, config });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  let base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await createUser(app.db, {
    username: 'admin',
    name: '管理员',
    role: 'admin',
    password: 'Example-Admin-1234',
  });
  await createUser(app.db, {
    username: 'checker',
    name: '检查员',
    role: 'inspector',
    password: 'Example-Checker-1234',
  });
  await createUser(app.db, {
    username: 'second',
    name: '另一检查员',
    role: 'inspector',
    password: 'Example-Second-1234',
  });
  async function request(path, { method = 'GET', data, user, headers = {} } = {}) {
    const h = { ...headers };
    if (data !== undefined) h['Content-Type'] = 'application/json';
    if (user) {
      h.Cookie = user.cookie;
    }
    Object.assign(h, headers);
    const res = await fetch(base + '/api' + path, {
      method,
      headers: h,
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      data: res.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(buffer.toString())
        : buffer,
      headers: res.headers,
    };
  }
  async function login(username, password) {
    const r = await request('/login', { method: 'POST', data: { username, password } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    return { ...r.data, cookie: r.headers.get('set-cookie').split(';')[0] };
  }
  let admin, checker, second, boot, record, recordId, photoId;
  await t.test('anonymous access, origin and strict CSP', async () => {
    for (const p of ['/records?period=1', '/bootstrap', '/photos/1', '/export?period=1'])
      assert.equal((await request(p)).status, 401);
    assert.equal((await request('/health')).status, 200);
    assert.equal(
      (
        await request('/login', {
          method: 'POST',
          data: {},
          headers: { Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.equal((await fetch(base + '/storage/dorm.sqlite')).status, 404);
  });
  await t.test('login and role isolation', async () => {
    assert.equal(
      (await request('/login', { method: 'POST', data: { username: 'admin', password: 'wrong' } }))
        .status,
      401,
    );
    admin = await login('admin', 'Example-Admin-1234');
    checker = await login('checker', 'Example-Checker-1234');
    second = await login('second', 'Example-Second-1234');
    assert.equal((await request('/admin/users', { user: checker })).status, 403);
    boot = (await request('/bootstrap', { user: checker })).data;
    assert.equal(boot.dorms.length, 531);
    assert.equal(boot.criteria.length, 10);
    record = {
      periodId: 1,
      dormId: boot.dorms[0].id,
      week: 6,
      date: '2026-10-12',
      inspector: '真实姓名',
      scores: Array(10).fill(9),
      photos: [{ slot: 0, data: png, description: '全景' }],
    };
  });
  await t.test('server validation, CSRF and ownership', async () => {
    assert.equal(
      (
        await request('/records', {
          method: 'POST',
          user: checker,
          data: record,
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
      403,
    );
    for (const patch of [
      { scores: [100] },
      { photos: [] },
      { date: '2026-02-30' },
      { week: 21 },
      { photos: [{ slot: 0, data: 'data:image/png;base64,aGVsbG8=' }] },
    ])
      assert.equal(
        (
          await request('/records', {
            method: 'POST',
            user: checker,
            data: { ...record, ...patch },
          })
        ).status,
        400,
      );
    const r = await request('/records', {
      method: 'POST',
      user: checker,
      data: { ...record, owner_id: admin.user.id, total: 0 },
    });
    assert.equal(r.status, 201);
    recordId = r.data.id;
    const detail = (await request('/records/' + recordId, { user: checker })).data;
    assert.equal(detail.owner_id, checker.user.id);
    assert.equal(detail.total, 90);
    photoId = detail.photos[0].id;
    const photo = await request('/photos/' + photoId, { user: checker });
    assert.equal(photo.status, 200);
    assert.ok(photo.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(
      (
        await request('/records/' + recordId, {
          method: 'PUT',
          user: second,
          data: { ...record, version: 1 },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/records/' + recordId, {
          method: 'DELETE',
          user: checker,
          data: { version: 1 },
        })
      ).status,
      403,
    );
  });
  await t.test('optimistic locking, photo retention and foreign photo rejection', async () => {
    const update = {
      ...record,
      version: 1,
      photos: [{ id: photoId, slot: 0, description: '保留照片' }],
      scores: Array(10).fill(8),
    };
    assert.equal(
      (await request('/records/' + recordId, { method: 'PUT', user: checker, data: update }))
        .status,
      200,
    );
    assert.equal(
      (await request('/records/' + recordId, { method: 'PUT', user: checker, data: update }))
        .status,
      409,
    );
    const r = await request('/records', { method: 'POST', user: checker, data: record });
    const other = (await request('/records/' + r.data.id, { user: checker })).data;
    assert.equal(
      (
        await request('/records/' + recordId, {
          method: 'PUT',
          user: checker,
          data: { ...record, version: 2, photos: [{ slot: 0, id: other.photos[0].id }] },
        })
      ).status,
      400,
    );
    assert.equal((await request('/records/' + recordId, { user: checker })).data.version, 2);
  });
  await t.test('real SQL pagination, filters, missing rooms and complete export', async () => {
    for (let i = 0; i < 13; i++)
      assert.equal(
        (
          await request('/records', {
            method: 'POST',
            user: checker,
            data: { ...record, dormId: boot.dorms[i + 1].id },
          })
        ).status,
        201,
      );
    const first = (await request('/records?period=1&pageSize=10', { user: checker })).data,
      secondPage = (await request('/records?period=1&pageSize=10&page=2', { user: checker })).data;
    assert.equal(first.total, 15);
    assert.equal(first.items.length, 10);
    assert.equal(secondPage.items.length, 5);
    assert.ok(!first.items.some((a) => secondPage.items.some((b) => a.id === b.id)));
    assert.equal((await request('/records?period=1&page=999', { user: checker })).data.page, 2);
    assert.equal((await request('/records?period=1&page=0', { user: checker })).status, 400);
    assert.equal(
      (await request('/records?period=1&level=' + encodeURIComponent('良好'), { user: checker }))
        .data.total,
      1,
    );
    const missing = (await request('/uninspected?period=1&week=6&pageSize=100', { user: checker }))
      .data;
    assert.ok(!missing.items.some((d) => d.id === record.dormId));
    assert.equal(
      (await request('/uninspected?period=1&week=7', { user: checker })).data.total,
      531,
    );
    assert.equal((await request('/uninspected?period=1', { user: checker })).status, 400);
    const csv = (await request('/export?period=1', { user: checker })).data.toString();
    assert.equal(csv.trim().split('\r\n').length, 16);
    const q = encodeURIComponent("' OR 1=1 --");
    assert.equal(
      (await request('/records?period=1&keyword=' + q, { user: checker })).data.total,
      0,
    );
  });
  await t.test(
    'account management, final administrator protection, disabling revokes sessions',
    async () => {
      assert.equal(
        (
          await request('/admin/users', {
            method: 'POST',
            user: admin,
            data: {
              username: 'new_user',
              name: '新用户',
              role: 'inspector',
              password: 'Example-New-1234',
            },
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request('/admin/users/' + admin.user.id, {
            method: 'PUT',
            user: admin,
            data: { name: '管理员', role: 'inspector', enabled: true },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('/admin/users/' + second.user.id, {
            method: 'PUT',
            user: admin,
            data: { name: '已停用', role: 'inspector', enabled: false },
          })
        ).status,
        200,
      );
      assert.equal((await request('/me', { user: second })).status, 401);
      assert.equal(
        (
          await request('/login', {
            method: 'POST',
            data: { username: 'second', password: 'Example-Second-1234' },
          })
        ).status,
        401,
      );
    },
  );
  await t.test('semester creation isolates previous records and missing list', async () => {
    assert.equal(
      (
        await request('/admin/periods', {
          method: 'POST',
          user: admin,
          data: { name: '下学期', start: '2027-03-02', weeks: 20, active: true },
        })
      ).status,
      400,
    );
    const r = await request('/admin/periods', {
      method: 'POST',
      user: admin,
      data: { name: '下学期', start: '2027-03-01', weeks: 20, active: true },
    });
    assert.equal(r.status, 201);
    assert.equal((await request('/records?period=' + r.data.id, { user: checker })).data.total, 0);
    assert.equal(
      (await request('/uninspected?period=' + r.data.id + '&week=6', { user: checker })).data.total,
      531,
    );
    assert.equal((await request('/admin/audit', { user: admin })).status, 200);
  });
  await t.test('restart preserves records, photos, accounts and unexpired sessions', async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    app = createApp({ directory, config });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + app.server.address().port;
    assert.equal((await request('/me', { user: checker })).status, 200);
    assert.equal((await request('/records?period=1', { user: checker })).data.total, 15);
    const detail = (await request('/records/' + recordId, { user: checker })).data;
    assert.equal((await request('/photos/' + detail.photos[0].id, { user: checker })).status, 200);
  });
  await t.test('consistent backup, deletion cascade and monotonically increasing IDs', async () => {
    const file = resolve(directory, 'snapshot.sqlite');
    await backup(app.db, file);
    const snapshot = new DatabaseSync(file);
    assert.equal(snapshot.prepare('SELECT count(*) AS n FROM records').get().n, 15);
    assert.ok(snapshot.prepare('SELECT count(*) AS n FROM photos').get().n >= 15);
    snapshot.close();
    const last = app.db.prepare('SELECT max(id) AS id FROM records').get().id;
    const r = (await request('/records/' + last, { user: admin })).data;
    assert.equal(
      (
        await request('/records/' + last, {
          method: 'DELETE',
          user: admin,
          data: { version: r.version },
        })
      ).status,
      200,
    );
    assert.equal((await request('/photos/' + r.photos[0].id, { user: admin })).status, 404);
    const next = await request('/records', { method: 'POST', user: checker, data: record });
    assert.ok(next.data.id > last);
  });
  await t.test('legacy import atomicity and duplicate detection', async () => {
    const d = boot.dorms[0],
      legacy = [
        {
          ...d,
          week: '第6周',
          date: '2026-10-12',
          inspector: '旧检查员',
          scores: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['项目' + i, '8'])),
          fullPhoto: png,
          details: [],
        },
      ];
    const file = resolve(directory, 'legacy.json');
    writeFileSync(file, JSON.stringify(legacy));
    const run = () =>
      spawnSync(process.execPath, [resolve(root, 'src/cli.js'), 'import-json', file, '1'], {
        env: { ...process.env, DATA_DIR: directory },
        encoding: 'utf8',
      });
    assert.equal(run().status, 0);
    assert.equal(run().status, 1);
    const before = app.db.prepare('SELECT count(*) AS n FROM records').get().n;
    writeFileSync(file, JSON.stringify([...legacy, { ...legacy[0], fullPhoto: '' }]));
    assert.equal(run().status, 1);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM records').get().n, before);
  });
  await t.test('password reset, logout and per-client/account rate limiting', async () => {
    assert.equal(
      (
        await request('/password', {
          method: 'PUT',
          user: checker,
          data: { password: 'Example-Changed-1234' },
        })
      ).status,
      200,
    );
    assert.equal((await request('/me', { user: checker })).status, 401);
    checker = await login('checker', 'Example-Changed-1234');
    assert.equal(
      (await request('/logout', { method: 'POST', user: checker, data: {} })).status,
      200,
    );
    assert.equal((await request('/me', { user: checker })).status, 401);
    for (let i = 0; i < 8; i++)
      assert.equal(
        (
          await request('/login', {
            method: 'POST',
            data: { username: 'unknown', password: 'bad' },
          })
        ).status,
        401,
      );
    assert.equal(
      (await request('/login', { method: 'POST', data: { username: 'unknown', password: 'bad' } }))
        .status,
      429,
    );
    // Another account on the same connection is not locked by this account's failures.
    assert.equal(
      (
        await request('/login', {
          method: 'POST',
          data: { username: 'admin', password: 'Example-Admin-1234' },
        })
      ).status,
      200,
    );
  });
});

test('cookie-only sessions, proxy HTTPS and parser errors', async (t) => {
  // Use node:http so the test sends nginx's exact Host header (fetch normalizes it).
  function proxyRequest(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(url, { method, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: {
              get: (name) => {
                const value = res.headers[name];
                return Array.isArray(value) ? value.join('; ') : value;
              },
            },
            json: async () => JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const directory = mkdtempSync(resolve(root, 'test-data-'));
  const { server, db } = createApp({ directory, config: { secure: true, trustProxy: 'loopback' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await createUser(db, {
    username: 'secure',
    name: '代理测试',
    role: 'admin',
    password: 'Proxy-Password-1234',
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {
    'Content-Type': 'application/json',
    Host: 'dorm.example.com',
    'X-Forwarded-Proto': 'https',
    Origin: 'https://dorm.example.com',
  };
  const login = await proxyRequest(base + '/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ username: 'secure', password: 'Proxy-Password-1234' }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.deepEqual(Object.keys(await login.json()), ['user']);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.notEqual(db.prepare('SELECT token FROM sessions').get().token, cookie.split('=')[1]);
  const me = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
  assert.deepEqual(Object.keys(await me.json()), ['user']);
  const post = (body, extra = {}) =>
    proxyRequest(base + '/api/admin/periods', {
      method: 'POST',
      headers: { ...headers, Cookie: cookie, ...extra },
      body,
    });
  assert.equal((await post('{}', { Origin: 'https://other.example.com' })).status, 403);
  assert.equal((await post('{}', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post('[]')).status, 400);
  assert.equal((await post(JSON.stringify({ padding: 'x'.repeat(17000) }))).status, 413);
  assert.equal(
    (await post(JSON.stringify({ name: '新学期', start: '2027-03-01', weeks: 20 }))).status,
    201,
  );
  db.exec('UPDATE sessions SET expires=0');
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: cookie } })).status, 401);
});
