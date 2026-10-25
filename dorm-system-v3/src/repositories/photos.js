export function addPhotos(db, id, photos) {
  db.prepare('DELETE FROM photos WHERE record_id=?').run(id);
  const insert = db.prepare(
    'INSERT INTO photos(record_id,slot,description,mime,bytes) VALUES (?,?,?,?,?)',
  );
  for (const p of photos) insert.run(id, p.slot, p.description, p.mime, p.bytes);
}
