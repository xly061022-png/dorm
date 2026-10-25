export const criteria = [
  '是否有插排串联、私拉乱接',
  '是否发现电吹风、电烧水壶、电饭锅等大功率电器',
  '卫生间、洗手盆是否干净整洁',
  '宿舍地面是否干净、无垃圾',
  '宿舍中间走廊是否堆积杂物（包括箱子、鞋架、衣柜等）',
  '鞋子、书、衣服是否堆积在床边或门后',
  '床沿是否存在乱挂衣服、毛巾等物品',
  '桌面物品是否摆放整齐',
  '床上被褥是否整理铺好（叠好）',
  '宿舍是否有异味',
];
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function text(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(`${label}不能为空且最多${max}字`);
  return value.trim();
}
export function int(value, min, max, label = '参数') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${label}超出范围`);
  return n;
}
export function validDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail('日期格式错误');
  return value;
}
export function level(total) {
  return total >= 90 ? '优秀' : total >= 80 ? '良好' : total >= 60 ? '合格' : '不合格';
}
export function decodePhoto(data) {
  if (typeof data !== 'string' || data.length > 4.2 * 1024 * 1024) fail('单张照片不能超过3MB');
  const m = data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) fail('照片仅支持JPEG、PNG、WebP');
  const bytes = Buffer.from(m[2], 'base64');
  const valid =
    m[1] === 'jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : m[1] === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > 3 * 1024 * 1024) fail('照片格式或大小不正确');
  return { bytes, mime: 'image/' + m[1] };
}
export function validateRecord(db, input, existingId = null) {
  if (!input || typeof input !== 'object') fail('数据格式错误');
  const periodId = int(input.periodId, 1, 2147483647, '学期');
  const period = db.prepare('SELECT * FROM periods WHERE id=?').get(periodId);
  if (!period) fail('学期不存在');
  const dormId = int(input.dormId, 1, 2147483647, '宿舍');
  if (!db.prepare('SELECT id FROM dorms WHERE id=?').get(dormId)) fail('宿舍不存在');
  const week = int(input.week, 1, period.weeks, '周次'),
    date = validDate(input.date);
  if (
    !Array.isArray(input.scores) ||
    input.scores.length !== 10 ||
    input.scores.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10)
  )
    fail('十项评分必须是0至10之间的整数');
  if (!Array.isArray(input.photos) || input.photos.length < 1 || input.photos.length > 4)
    fail('请上传全景照片，最多三张特写');
  const slots = new Set();
  const photos = input.photos.map((p) => {
    const slot = int(p?.slot, 0, 3, '照片位置');
    if (slots.has(slot)) fail('照片位置重复');
    slots.add(slot);
    const description = p.description ? text(p.description, '照片说明', 500) : '';
    if (p.data) return { slot, description, ...decodePhoto(p.data) };
    const old = db
      .prepare('SELECT mime,bytes FROM photos WHERE id=? AND record_id=? AND slot=?')
      .get(int(p.id, 1, 2147483647), existingId, slot);
    if (!old) fail('照片引用无效，请重新上传');
    return { slot, description, ...old };
  });
  if (!slots.has(0)) fail('全景照片必传');
  return {
    periodId,
    dormId,
    week,
    date,
    inspector: text(input.inspector, '检查人', 80),
    scores: input.scores,
    total: input.scores.reduce((a, b) => a + b, 0),
    photos,
  };
}
