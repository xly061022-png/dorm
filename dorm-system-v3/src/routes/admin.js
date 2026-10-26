import { Router } from 'express';
import { jsonBody } from '../middleware/http.js';
import { createUser } from '../auth.js';
import { admin } from '../services/permissions.js';
import { updateUser, createPeriod, activatePeriod } from '../services/admin.js';
import { page } from '../repositories/queries.js';
import { int } from '../domain.js';
import { previewDormImport, importDorms, listDorms, updateDorm } from '../services/dorms.js';
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
  router.post('/dorms/preview', jsonBody('5mb'), (req, res) => {
    authorize(req);
    res.json(previewDormImport(db, req.body.content));
  });
  router.get('/dorms', (req, res) =>
    res.json(listDorms(db, new URLSearchParams(req.url.split('?')[1] || ''))),
  );
  router.put('/dorms/:id', jsonBody(), (req, res) =>
    res.json(updateDorm(db, authorize(req), id(req), req.body)),
  );
  router.post('/dorms/import', jsonBody('5mb'), (req, res) =>
    res.json(importDorms(db, authorize(req), req.body.content)),
  );
  router.get('/dorms/template', (req, res) => {
    res
      .type('text/csv')
      .attachment('dorm-template.csv')
      .send(
        '\uFEFF年级,校区,楼栋,宿舍号,性别,班级\r\n2027级,主校区,1号楼,101,男,电子信息工程1班\r\n',
      );
  });
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
