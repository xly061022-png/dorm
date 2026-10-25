import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { createUser } from '../../src/auth.js';
import { createRecord } from '../../src/services/records.js';

export default async function setup() {
  // Separate temporary database; never uses DATA_DIR or a production account.
  const directory = mkdtempSync(join(tmpdir(), 'dorm-e2e-'));
  const { server, db } = createApp({ directory, config: { secure: false, trustProxy: false } });
  const id = await createUser(db, {
    username: 'admin',
    name: '测试管理员',
    role: 'admin',
    password: 'E2e-Password-1234',
  });
  await createUser(db, {
    username: 'checker',
    name: '测试检查员',
    role: 'inspector',
    password: 'E2e-Password-1234',
  });
  for (let i = 1; i <= 15; i++)
    createRecord(
      db,
      { id, username: 'admin' },
      {
        periodId: 1,
        dormId: i,
        week: 6,
        date: '2026-10-12',
        inspector: '分页测试',
        scores: Array(10).fill(9),
        photos: [
          {
            slot: 0,
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N1sAAAAASUVORK5CYII=',
          },
        ],
      },
    );
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3107, '127.0.0.1', resolve);
    });
  } catch (error) {
    db.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  };
}
