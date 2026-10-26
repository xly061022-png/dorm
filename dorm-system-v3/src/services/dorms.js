import { fail, int, text } from '../domain.js';
import { page } from '../repositories/queries.js';
import { transact, audit } from '../store.js';

const fields = ['grade', 'campus', 'building', 'dorm', 'gender', 'className'];
const labels = ['年级', '校区', '楼栋', '宿舍号', '性别', '班级'];

export function listDorms(db, query) {
  const keyword = (query.get('keyword') || '').trim();
  if (keyword.length > 100) fail('关键词最多100字');
  const where =
    " WHERE instr(lower(grade || ' ' || campus || ' ' || building || ' ' || dorm || ' ' || gender || ' ' || className),lower(?))>0";
  return page(
    db,
    'SELECT * FROM dorms' + where + ' ORDER BY grade,building,dorm,id',
    'SELECT count(*) AS n FROM dorms' + where,
    [keyword],
    query,
  );
}

export function updateDorm(db, user, id, input) {
  const row = Object.fromEntries(
    fields.map((field, i) => [field, text(input[field], labels[i], 100)]),
  );
  if (!['男', '女', '待确认'].includes(row.gender)) fail('性别请填写男、女或待确认');
  if (
    fields.some((field) =>
      [...row[field]].some((char) => char.charCodeAt(0) < 32 || char === '\ufffd'),
    )
  )
    fail('宿舍信息不能包含控制字符或乱码');
  return transact(db, () => {
    const old = db.prepare('SELECT * FROM dorms WHERE id=?').get(id);
    if (!old) fail('宿舍不存在', 404);
    if (input.version !== old.version) fail('宿舍信息已被其他人修改，请刷新列表后重新编辑', 409);
    if (
      db
        .prepare(
          'SELECT id FROM dorms WHERE id<>? AND grade=? AND campus=? AND building=? AND dorm=? AND gender=? AND className=?',
        )
        .get(id, ...fields.map((field) => row[field]))
    )
      fail('已存在完全相同的宿舍条目，请检查信息', 409);
    db.prepare(
      'UPDATE dorms SET grade=?,campus=?,building=?,dorm=?,gender=?,className=?,version=version+1 WHERE id=?',
    ).run(...fields.map((field) => row[field]), id);
    audit(
      db,
      user.username,
      'update_dorm',
      JSON.stringify({
        id,
        before: Object.fromEntries(fields.map((field) => [field, old[field]])),
        after: row,
      }),
    );
    return { id, version: old.version + 1 };
  });
}

// CSV supports Excel/WPS UTF-8 exports, quoted commas and escaped quotes.
export function parseDormCsv(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024)
    fail('请选择2MB以内的CSV文件');
  const rows = [];
  let row = [],
    value = '',
    quoted = false,
    closed = false;
  const source = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  function endField() {
    row.push(value);
    value = '';
    closed = false;
  }
  function endRow() {
    endField();
    if (row.some((cell) => cell.trim())) rows.push(row);
    row = [];
    if (rows.length > 5001) fail('每次最多导入5000行');
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === ',') endField();
    else if (char === '\n') endRow();
    else if (char === '"' && value === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') fail('CSV引号格式错误，请使用Excel/WPS另存为CSV UTF-8');
      value += char;
    }
  }
  if (quoted) fail('CSV引号未闭合');
  endRow();
  const headings = rows.shift()?.map((cell) => cell.trim());
  if (!headings || new Set(headings).size !== headings.length) fail('表头为空或重复');
  const indices = fields.map((field, i) =>
    headings.findIndex((h) => h === field || h === labels[i]),
  );
  if (indices.some((i) => i < 0)) fail('表头必须包含：' + labels.join('、'));
  if (!rows.length) fail('文件中没有宿舍数据');
  return rows.map((cells, index) => {
    if (cells.length !== headings.length) fail(`第${index + 2}行列数与表头不一致`);
    return Object.fromEntries(fields.map((field, i) => [field, cells[indices[i]].trim()]));
  });
}

export function previewDormImport(db, content) {
  const rows = parseDormCsv(content),
    errors = [],
    additions = [];
  const key = (row) => JSON.stringify(fields.map((field) => row[field]));
  const seen = new Set(db.prepare('SELECT * FROM dorms').all().map(key));
  let skipped = 0;
  rows.forEach((row, index) => {
    for (const [i, field] of fields.entries()) {
      if (
        !row[field] ||
        row[field].length > 100 ||
        [...row[field]].some((char) => char.charCodeAt(0) < 32 || char === '\ufffd')
      )
        errors.push(`第${index + 2}行：${labels[i]}不能为空、不能包含乱码/控制字符，且最多100字`);
    }
    if (!['男', '女', '待确认'].includes(row.gender))
      errors.push(`第${index + 2}行：性别请填写男、女或待确认`);
    if (seen.has(key(row))) skipped++;
    else {
      seen.add(key(row));
      additions.push(row);
    }
  });
  return { total: rows.length, skipped, added: additions.length, errors, rows: additions };
}
export function importDorms(db, user, content) {
  return transact(db, () => {
    const preview = previewDormImport(db, content);
    if (preview.errors.length) fail(preview.errors.slice(0, 10).join('；'));
    const insert = db.prepare(
      'INSERT INTO dorms(grade,campus,building,dorm,gender,className) VALUES (?,?,?,?,?,?)',
    );
    for (const row of preview.rows) insert.run(...fields.map((field) => row[field]));
    audit(db, user.username, 'import_dorms', `新增${preview.added}条，跳过${preview.skipped}条`);
    return { added: preview.added, skipped: preview.skipped, total: preview.total };
  });
}

export function inspectionStatus(db, periodValue, weekValue) {
  const periodId = int(periodValue, 1, 2147483647, '学期');
  const period = db.prepare('SELECT weeks FROM periods WHERE id=?').get(periodId);
  if (!period) fail('学期不存在');
  const week = int(weekValue, 1, period.weeks, '周次');
  // A physical room may have multiple class entries; mark all of them together.
  const checked = db
    .prepare(
      `SELECT d.id FROM dorms d WHERE EXISTS (
    SELECT 1 FROM records r JOIN dorms room ON room.id=r.dorm_id
    WHERE r.period_id=? AND r.week=? AND room.campus=d.campus
      AND room.building=d.building AND room.dorm=d.dorm)`,
    )
    .all(periodId, week);
  return { periodId, week, checkedIds: checked.map((d) => d.id) };
}
