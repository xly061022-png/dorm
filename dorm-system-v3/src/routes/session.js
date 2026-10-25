import { Router } from 'express';
import { jsonBody } from '../middleware/http.js';
import { passwordHash } from '../auth.js';
import { transact, audit } from '../store.js';
export function sessionRouter(db, auth) {
  const router = Router();
  router.get('/me', (req, res) => {
    const { id, username, name, role } = auth.required(req);
    res.json({ user: { id, username, name, role } });
  });
  router.post('/logout', jsonBody(), (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });
  router.put('/password', jsonBody(), async (req, res) => {
    const credentials = await passwordHash(req.body.password);
    const user = auth.required(req);
    transact(db, () => {
      db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(
        credentials.salt,
        credentials.hash,
        user.id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(db, user.username, 'change_password', user.id);
    });
    auth.logout(req, res);
    res.json({ ok: true });
  });
  return router;
}
