import { fail } from '../domain.js';
export function admin(user) {
  if (user.role !== 'admin') fail('需要管理员权限', 403);
}
export function own(user, record) {
  if (user.role !== 'admin' && user.id !== record.owner_id) fail('只能修改自己创建的记录', 403);
}
