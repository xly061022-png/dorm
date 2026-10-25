import { Router } from 'express';
import { jsonBody } from '../middleware/http.js';
import { createUser } from '../auth.js';
import { admin } from '../services/permissions.js';
import { updateUser, createPeriod, activatePeriod } from '../services/admin.js';
import { page } from '../repositories/queries.js';
import { int } from '../domain.js';
export function adminRouter(db, auth) {
  const router = Router();
  const authorize = (req) => {
    const user = auth.required(req);
    admin(user);
    return user;
  };
  const id = (req) => int(req.params.id, 1, 2147483647, 'ID');
  router.use((req, res, next) => {
    authorize(req);
    next();
  });
  router.get('/users', (req, res) =>
    res.json(db.prepare('SELECT id,username,name,role,enabled FROM users ORDER BY id').all()),
  );
  router.post('/users', jsonBody(), async (req, res) => {
    const user = authorize(req);
    const id = await createUser(db, req.body, user.username, () => authorize(req));
    res.status(201).json({ id });
  });
  router.put('/users/:id', jsonBody(), async (req, res) =>
    res.json(await updateUser(db, authorize(req), id(req), req.body, () => authorize(req))),
  );
  router.post('/periods', jsonBody(), (req, res) =>
    res.status(201).json(createPeriod(db, authorize(req), req.body)),
  );
  router.post('/periods/:id/activate', jsonBody(), (req, res) =>
    res.json(activatePeriod(db, authorize(req), id(req))),
  );
  router.get('/audit', (req, res) =>
    res.json(
      page(
        db,
        'SELECT * FROM audit ORDER BY id DESC',
        'SELECT count(*) AS n FROM audit',
        [],
        new URLSearchParams(req.url.split('?')[1] || ''),
      ),
    ),
  );
  return router;
}
