import { int, fail } from '../domain.js';
export function filters(db, q, uninspected = false) {
  const args = [],
    parts = [];
  const period = int(q.get('period'), 1, 2147483647, '学期');
  const p = db.prepare('SELECT * FROM periods WHERE id=?').get(period);
  if (!p) fail('学期不存在');
  const week = q.get('week') ? int(q.get('week'), 1, p.weeks, '周次') : null;
  if (uninspected) {
    if (!week) fail('请选择周次');
    parts.push(`NOT EXISTS (SELECT 1 FROM records r JOIN dorms checked ON checked.id=r.dorm_id
      WHERE r.period_id=? AND r.week=? AND checked.campus=d.campus AND checked.building=d.building AND checked.dorm=d.dorm)`);
    args.push(period, week);
  } else {
    parts.push('r.period_id=?');
    args.push(period);
    if (week) {
      parts.push('r.week=?');
      args.push(week);
    }
  }
  for (const name of ['grade', 'gender', 'building'])
    if (q.get(name)) {
      parts.push(`d.${name}=?`);
      args.push(q.get(name));
    }
  const keyword = (q.get('keyword') || '').trim();
  if (keyword) {
    if (keyword.length > 100) fail('关键词过长');
    parts.push("instr(lower(d.className || ' ' || d.dorm || ' ' || d.building),lower(?))>0");
    args.push(keyword);
  }
  if (!uninspected && q.get('level')) {
    const ranges = { 优秀: [90, 100], 良好: [80, 89], 合格: [60, 79], 不合格: [0, 59] };
    const range = ranges[q.get('level')];
    if (!range) fail('等级错误');
    parts.push('r.total BETWEEN ? AND ?');
    args.push(...range);
  }
  return { where: parts.join(' AND '), args };
}
export const recordSelect = `SELECT r.*,d.grade,d.campus,d.building,d.dorm,d.gender,d.className,u.name AS ownerName
  FROM records r JOIN dorms d ON d.id=r.dorm_id LEFT JOIN users u ON u.id=r.owner_id`;
export function page(db, select, count, args, q, transform = (x) => x) {
  const size = int(q.get('pageSize') || 10, 1, 100, '每页条数'),
    requested = int(q.get('page') || 1, 1, 10000000, '页码');
  const total = db.prepare(count).get(...args).n,
    pages = Math.max(1, Math.ceil(total / size)),
    current = Math.min(requested, pages);
  return {
    items: db
      .prepare(select + ' LIMIT ? OFFSET ?')
      .all(...args, size, (current - 1) * size)
      .map(transform),
    total,
    pages,
    page: current,
    pageSize: size,
  };
}
