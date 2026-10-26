import { createApp } from '../../src/app.js';
import { passwordHash } from '../../src/auth.js';
import { transact } from '../../src/store.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const { server, db } = createApp({
  directory: process.argv[2],
  config: { secure: false, trustProxy: false },
});
const password = 'Load-Test-Password-1234';
const credentials = await passwordHash(password);
transact(db, () => {
  for (let i = 0; i < 40; i++)
    db.prepare('INSERT INTO users(username,name,role,salt,hash) VALUES (?,?,?,?,?)').run(
      `load${i}`,
      `压测${i}`,
      'inspector',
      credentials.salt,
      credentials.hash,
    );
  const insert = db.prepare(
    'INSERT INTO records(period_id,dorm_id,week,date,inspector,scores,total,owner_id) VALUES (1,?,6,?,?,?,?,?)',
  );
  for (let i = 0; i < 2000; i++)
    insert.run(
      (i % 531) + 1,
      '2026-10-12',
      '历史压测数据',
      JSON.stringify(Array(10).fill(9)),
      90,
      (i % 40) + 1,
    );
});
const delay = monitorEventLoopDelay({ resolution: 20 });
delay.enable();
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50);
process.on('message', (message) => {
  if (message === 'verify') {
    process.send({
      type: 'verify',
      records: db.prepare('SELECT count(*) AS n FROM records').get().n,
      photos: db.prepare('SELECT count(*) AS n FROM photos').get().n,
      orphanPhotos: db
        .prepare(
          'SELECT count(*) AS n FROM photos p LEFT JOIN records r ON r.id=p.record_id WHERE r.id IS NULL',
        )
        .get().n,
      incomplete: db
        .prepare(
          'SELECT count(*) AS n FROM records r WHERE r.id>2000 AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.record_id=r.id AND p.slot=0)',
        )
        .get().n,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
      peakRssMiB: Math.round(peakRss / 1048576),
      eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
      eventLoopMaxMs: Math.round(delay.max / 1e6),
    });
  }
  if (message === 'stop') {
    clearInterval(sampler);
    delay.disable();
    server.closeAllConnections();
    server.close(() => {
      db.close();
      process.disconnect();
    });
  }
});
server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
