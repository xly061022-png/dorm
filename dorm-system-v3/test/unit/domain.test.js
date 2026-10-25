import { test } from 'node:test';
import assert from 'node:assert/strict';
import { level, text, int, validDate, decodePhoto } from '../../src/domain.js';
import { configFromEnv } from '../../src/config.js';
import { admin, own } from '../../src/services/permissions.js';
import { passwordHash, digest } from '../../src/auth.js';

test('score level boundaries', () => {
  for (const [score, expected] of [
    [0, '不合格'],
    [59, '不合格'],
    [60, '合格'],
    [79, '合格'],
    [80, '良好'],
    [89, '良好'],
    [90, '优秀'],
    [100, '优秀'],
  ])
    assert.equal(level(score), expected);
});
test('dates reject calendar overflow, accept leap day', () => {
  assert.equal(validDate('2024-02-29'), '2024-02-29');
  for (const invalid of ['2025-02-29', '2026-04-31', '2026-1-01', null])
    assert.throws(() => validDate(invalid), /日期/);
});
test('validation trims text and rejects invalid integer ranges', () => {
  assert.equal(text(' 张三 ', '姓名'), '张三');
  for (const value of ['', '    ', 123]) assert.throws(() => text(value, '姓名'));
  assert.equal(int('3', 1, 10), 3);
  for (const value of [0, 11, 1.5, 'NaN', Infinity]) assert.throws(() => int(value, 1, 10));
});
test('image signature and size validation', () => {
  for (const image of [
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,aGVsbG8=',
    'x'.repeat(5 * 1024 * 1024),
  ])
    assert.throws(() => decodePhoto(image));
});
test('authorization distinguishes owner and administrator', () => {
  admin({ role: 'admin' });
  own({ role: 'inspector', id: 2 }, { owner_id: 2 });
  own({ role: 'admin', id: 1 }, { owner_id: 2 });
  assert.throws(() => admin({ role: 'inspector' }), { status: 403 });
  assert.throws(() => own({ role: 'inspector', id: 1 }, { owner_id: 2 }), { status: 403 });
});
test('password salts are unique and session identifiers are hashed', async () => {
  const a = await passwordHash('Example-Password-123'),
    b = await passwordHash('Example-Password-123');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(digest('hello').length, 64);
  await assert.rejects(passwordHash('short'));
});
test('localhost production configuration needs no domain or origin env', () => {
  assert.deepEqual(configFromEnv({ NODE_ENV: 'production' }), {
    host: '127.0.0.1',
    port: 3000,
    secure: true,
    trustProxy: 'loopback',
  });
  assert.equal(configFromEnv({}).secure, false);
  for (const port of ['-1', 'abc', '65536']) assert.throws(() => configFromEnv({ PORT: port }));
});
