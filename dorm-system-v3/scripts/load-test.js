import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { once } from 'node:events';

// Generate a real PNG with noisy pixels: 901 KiB, representative of a compressed photo.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(640);
header.writeUInt32BE(480, 4);
header[8] = 8;
header[9] = 2;
const pixels = randomBytes((640 * 3 + 1) * 480);
for (let row = 0; row < 480; row++) pixels[row * (640 * 3 + 1)] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
const photo = 'data:image/png;base64,' + png.toString('base64');
const directory = mkdtempSync(join(tmpdir(), 'dorm-load-'));
const child = fork(new URL('../test/load/server.js', import.meta.url), [directory], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
function message(type) {
  return new Promise((resolve, reject) => {
    const listener = (value) => {
      if (value.type === type) {
        cleanup();
        resolve(value);
      }
    };
    const failed = (code) => {
      cleanup();
      reject(Error(`test server exited: ${code}`));
    };
    const cleanup = () => {
      child.off('message', listener);
      child.off('exit', failed);
    };
    child.on('message', listener);
    child.on('exit', failed);
  });
}
const results = [];
const cookies = [];
const saved = [];
let base;
async function request(path, { method = 'GET', body, cookie } = {}) {
  const start = performance.now();
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
      signal: AbortSignal.timeout(30000),
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ms: performance.now() - start, bytes, headers: res.headers };
  } catch (error) {
    return { status: 0, ms: performance.now() - start, error: error.message };
  }
}
async function scenario(name, rounds, task) {
  const observations = [];
  const start = performance.now();
  await Promise.all(
    Array.from({ length: 40 }, async (_, user) => {
      for (let round = 0; round < rounds; round++) observations.push(await task(user, round));
    }),
  );
  const seconds = (performance.now() - start) / 1000;
  const times = observations.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const r of observations) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const percentile = (p) =>
    Math.round(times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)]);
  const result = {
    name,
    requests: times.length,
    statuses,
    seconds: +seconds.toFixed(2),
    requestsPerSecond: +(times.length / seconds).toFixed(1),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: Math.round(times.at(-1)),
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
const password = 'Load-Test-Password-1234';
const payload = (user, count) =>
  JSON.stringify({
    periodId: 1,
    dormId: user + 1,
    week: 7,
    date: '2026-10-25',
    inspector: `负载测试${user}`,
    scores: Array(10).fill(9),
    photos: Array.from({ length: count }, (_, slot) => ({
      slot,
      data: photo,
      description: 'load test',
    })),
  });
async function submit(user, count) {
  const r = await request('/api/records', {
    method: 'POST',
    cookie: cookies[user],
    body: payload(user, count),
  });
  if (r.status === 201) saved.push({ id: JSON.parse(r.bytes).id, user, count });
  return r;
}
try {
  const ready = await message('ready');
  base = `http://127.0.0.1:${ready.port}`;
  await scenario('40 simultaneous logins', 1, (user) =>
    request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: `load${user}`, password }),
    }),
  );
  // Establish all 40 sessions sequentially so login protection does not mask CRUD throughput.
  for (let user = 0; user < 40; user++) {
    const r = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: `load${user}`, password }),
    });
    if (r.status !== 200) throw Error(`setup login failed: ${r.status}`);
    cookies.push(r.headers.get('set-cookie').split(';')[0]);
  }
  await scenario('40 users querying history and missing rooms', 100, (user, round) =>
    request(
      round % 2
        ? `/api/uninspected?period=1&week=7&page=${(round % 10) + 1}`
        : `/api/records?period=1&page=${(round % 20) + 1}`,
      { cookie: cookies[user] },
    ),
  );
  await scenario('40 users uploading one 901KiB photo (3 rounds)', 3, (user) => submit(user, 1));
  await scenario('40 users uploading four photos (3.52MiB each submission)', 1, (user) =>
    submit(user, 4),
  );
  await scenario('40 users mixed reads and uploads', 25, (user, round) =>
    round % 5 === 0
      ? submit(user, 1)
      : request('/api/records?period=1&page=1', { cookie: cookies[user] }),
  );
  let checkedPhotos = 0;
  const integrityErrors = [];
  const expectedHash = createHash('sha256').update(png).digest('hex');
  for (const entry of saved) {
    const detail = await request(`/api/records/${entry.id}`, { cookie: cookies[entry.user] });
    if (detail.status !== 200) {
      integrityErrors.push(`record ${entry.id} missing`);
      continue;
    }
    const record = JSON.parse(detail.bytes);
    if (
      record.photos.length !== entry.count ||
      record.total !== 90 ||
      record.owner_id !== entry.user + 1
    )
      integrityErrors.push(`record ${entry.id} inconsistent`);
    for (const p of record.photos) {
      const image = await request(`/api/photos/${p.id}`, { cookie: cookies[entry.user] });
      if (
        image.status !== 200 ||
        createHash('sha256').update(image.bytes).digest('hex') !== expectedHash
      )
        integrityErrors.push(`photo ${p.id} corrupted`);
      checkedPhotos++;
    }
  }
  const pending = message('verify');
  child.send('verify');
  const database = await pending;
  const report = {
    date: new Date().toISOString(),
    environment: {
      node: process.version,
      os: process.platform,
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      ramGiB: Math.round(totalmem() / 1073741824),
    },
    concurrency: 40,
    seedRecords: 2000,
    photoBytes: png.length,
    results,
    verification: {
      successfulWrites: saved.length,
      uniqueRecordIds: new Set(saved.map((r) => r.id)).size,
      checkedPhotos,
      integrityErrors,
      ...database,
    },
    limitations: [
      'Local loopback, separate client/server processes on one machine; no real network bandwidth or TLS/nginx.',
      'Closed-loop concurrency 40, requests sent immediately after prior response.',
      'Login burst includes intentional rate limits; CRUD starts after sequential session setup.',
    ],
  };
  const output = resolve(process.argv[2] || 'load-test-results.json');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('REPORT ' + output);
  console.log(JSON.stringify(report.verification));
} finally {
  if (child.connected) {
    const exited = once(child, 'exit');
    child.send('stop');
    await exited;
  }
  rmSync(directory, { recursive: true, force: true });
}
