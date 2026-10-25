import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
export { createApp } from './app.js';
export { configFromEnv } from './config.js';
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { server, db, config } = createApp();
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
