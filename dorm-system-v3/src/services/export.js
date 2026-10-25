import { filters, recordSelect } from '../repositories/queries.js';
import { level } from '../domain.js';
export function exportCsv(db, q, res) {
  const un = q.get('kind') === 'uninspected',
    f = filters(db, q, un);
  const cols = un
    ? ['grade', 'campus', 'building', 'dorm', 'gender', 'className']
    : [
        'week',
        'date',
        'grade',
        'campus',
        'building',
        'dorm',
        'gender',
        'className',
        'inspector',
        'total',
        'level',
      ];
  const names = {
    week: '周次',
    date: '日期',
    grade: '年级',
    campus: '校区',
    building: '楼栋',
    dorm: '宿舍',
    gender: '性别',
    className: '班级',
    inspector: '检查人',
    total: '总分',
    level: '等级',
  };
  const cell = (v) =>
    '"' +
    String(v ?? '')
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dorm-export.csv"');
  res.write('\uFEFF' + cols.map((c) => names[c]).join(',') + '\r\n');
  const rows = db
    .prepare(
      (un ? 'SELECT d.* FROM dorms d' : recordSelect) +
        ' WHERE ' +
        f.where +
        (un ? ' ORDER BY d.id' : ' ORDER BY r.date DESC,r.id DESC'),
    )
    .iterate(...f.args);
  for (const r of rows) {
    r.level = level(r.total);
    res.write(cols.map((c) => cell(r[c])).join(',') + '\r\n');
  }
  return res.end();
}
