import express from 'express';
import http from 'node:http';
import { resolve } from 'node:path';
import { openStore, root } from './store.js';
import { configFromEnv } from './config.js';
import { authService } from './auth.js';
import { criteria, fail } from './domain.js';
import { securityHeaders, sameOrigin, jsonBody, errorHandler } from './middleware/http.js';
import { recordsRouter } from './routes/records.js';
import { adminRouter } from './routes/admin.js';
import { sessionRouter } from './routes/session.js';
export function createApp({ directory, config = configFromEnv() } = {}) {
  const db = openStore(directory),
    auth = authService(db, config),
    app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? 'loopback');
  app.use(securityHeaders, sameOrigin);
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.post('/api/login', jsonBody(), async (req, res) =>
    res.json(await auth.login(req, res, req.body)),
  );
  app.use('/api', (req, res, next) => {
    auth.required(req);
    next();
  });
  app.use('/api', sessionRouter(db, auth));
  app.get('/api/bootstrap', (req, res) =>
    res.json({
      criteria,
      dorms: db.prepare('SELECT * FROM dorms ORDER BY grade,building,dorm,id').all(),
      historyDorms: db.prepare('SELECT DISTINCT grade,gender,building FROM record_dorms').all(),
      periods: db.prepare('SELECT * FROM periods ORDER BY id DESC').all(),
    }),
  );
  app.use('/api', recordsRouter(db, auth));
  app.use('/api/admin', adminRouter(db, auth));
  app.use('/api', () => fail('接口不存在', 404));
  app.use(
    express.static(resolve(root, 'public'), {
      dotfiles: 'deny',
      etag: false,
      lastModified: false,
      cacheControl: false,
    }),
  );
  app.use(() => fail('页面不存在', 404));
  app.use(errorHandler);
  const server = http.createServer(app);
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.maxRequestsPerSocket = 100;
  return { app, server, db, config };
}
