import { Router } from 'express';
import { jsonBody } from '../middleware/http.js';
import {
  createRecord,
  updateRecord,
  deleteRecord,
  getRecord,
  listRecords,
} from '../services/records.js';
import { exportCsv } from '../services/export.js';
import { fail, int } from '../domain.js';
import { inspectionStatus } from '../services/dorms.js';
export function recordsRouter(db, auth) {
  const router = Router();
  const query = (req) => new URLSearchParams(req.url.split('?')[1] || '');
  const id = (req) => int(req.params.id, 1, 2147483647, '记录ID');
  router.get('/inspection-status', (req, res) =>
    res.json(inspectionStatus(db, query(req).get('period'), query(req).get('week'))),
  );
  router.get('/records', (req, res) => res.json(listRecords(db, query(req))));
  router.get('/uninspected', (req, res) => res.json(listRecords(db, query(req), true)));
  router.get('/export', (req, res) => exportCsv(db, query(req), res));
  router.post('/records', jsonBody('17mb'), (req, res) =>
    res.status(201).json(createRecord(db, auth.required(req), req.body)),
  );
  router.get('/records/:id', (req, res) => res.json(getRecord(db, id(req))));
  router.put('/records/:id', jsonBody('17mb'), (req, res) =>
    res.json(updateRecord(db, auth.required(req), id(req), req.body)),
  );
  router.delete('/records/:id', jsonBody('1kb'), (req, res) =>
    res.json(deleteRecord(db, auth.required(req), id(req), req.body)),
  );
  router.get('/photos/:id', (req, res) => {
    const photo = db.prepare('SELECT mime,bytes FROM photos WHERE id=?').get(id(req));
    if (!photo) fail('照片不存在', 404);
    res.type(photo.mime).send(Buffer.from(photo.bytes));
  });
  return router;
}
