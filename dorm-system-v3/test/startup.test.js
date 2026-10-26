import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { root } from '../src/store.js';

test('real startup reads env file and never resets existing credentials on restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-startup-'));
  const envFile = join(directory, '.env');
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const password = 'Startup-Test-$12345';
  let child;
  let logs = '';
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit');
      child.kill();
      await done;
    }
  }
  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), DATA_DIR: directory };
  for (const name of ['INITIAL_ADMIN_PASSWORD', 'INITIAL_ADMIN_USERNAME', 'INITIAL_ADMIN_NAME'])
    delete env[name];
  async function start(content) {
    writeFileSync(envFile, content);
    child = spawn(process.execPath, [`--env-file=${envFile}`, 'src/server.js'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(Error('启动超时')), 10000);
      child.on('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(Error('意外退出 ' + code));
      });
      child.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      child.stdout.on('data', (chunk) => {
        logs += chunk;
        output += chunk;
        if (output.includes(`http://127.0.0.1:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }
  const login = (secret) =>
    fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: secret }),
    });
  await start(`INITIAL_ADMIN_PASSWORD='${password}'\n`);
  assert.equal((await login(password)).status, 200);
  await stop();
  await start("INITIAL_ADMIN_PASSWORD='Changed-Password-12345'\n");
  assert.equal((await login(password)).status, 200);
  assert.equal((await login('Changed-Password-12345')).status, 401);
  await stop();
  await start('');
  assert.equal((await login(password)).status, 200);
  assert.ok(!logs.includes(password));
  assert.ok(!logs.includes('Changed-Password-12345'));
});

test('fresh database with no initial password exits with a clear setup error', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorm-startup-missing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: directory };
  delete env.INITIAL_ADMIN_PASSWORD;
  const result = spawnSync(process.execPath, ['src/server.js'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INITIAL_ADMIN_PASSWORD/);
});
