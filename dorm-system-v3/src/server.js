import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { initializeAdmin } from './services/initial-admin.js';
export { createApp } from './app.js';
export { configFromEnv } from './config.js';
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { server, db, config } = createApp();
  try {
    const result = await initializeAdmin(db);
    if (result.created)
      console.log(
        `已创建初始管理员：${result.username}。密码使用 INITIAL_ADMIN_PASSWORD 的配置值。`,
      );
  } catch (error) {
    console.error('启动失败：' + error.message);
    db.close();
    process.exit(1);
  }
  server.listen(config.port, config.host, () =>
    console.log(`宿舍检查系统：http://${config.host}:${config.port}`),
  );
  server.on('error', (error) => {
    console.error(error);
    db.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 10000);
      deadline.unref();
      server.close(() => {
        clearTimeout(deadline);
        db.close();
      });
    });
}
