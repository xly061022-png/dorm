'use strict';
const $ = (id) => document.getElementById(id);
const state = {
  auth: null,
  boot: null,
  tab: 'inspect',
  editing: null,
  photos: new Map(),
  photoTickets: [0, 0, 0, 0],
  pendingPhotos: 0,
  saving: false,
  dirty: false,
  users: [],
  rows: { history: [], missing: [] },
  pages: { history: 1, missing: 1, audit: 1 },
  sizes: { history: 10, missing: 10, audit: 10 },
  tickets: { history: 0, missing: 0, audit: 0 },
  filters: { history: {}, missing: {} },
};
const today = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function button(label, action, className) {
  const b = node('button', label, className);
  b.type = 'button';
  b.addEventListener('click', () => guard(action));
  return b;
}
function options(select, values, placeholder) {
  select.replaceChildren();
  if (placeholder !== undefined) select.add(new Option(placeholder, ''));
  values.forEach((v) =>
    select.add(
      new Option(typeof v === 'object' ? v.label : v, typeof v === 'object' ? v.value : v),
    ),
  );
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}
function showLogin(message = '') {
  state.auth = null;
  $('app-view').hidden = true;
  $('login-view').hidden = false;
  $('login-error').textContent = message;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  for (const kind of ['history', 'missing', 'audit']) state.tickets[kind]++;
}
async function api(path, { method = 'GET', data, signal } = {}) {
  const headers = {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });
  if (!res.headers.get('content-type')?.includes('application/json'))
    throw Error(
      '服务地址不正确。请启动后端，通过 http://localhost:3000 或部署域名访问，不要使用Live Server。',
    );
  const value = await res.json();
  if (res.status === 401 && path !== '/login') showLogin('登录已失效，请重新登录。');
  if (!res.ok) throw Error(value.error || '请求失败');
  return value;
}
async function guard(action) {
  try {
    await action();
  } catch (e) {
    if (e.name !== 'AbortError') notice(e.message, true);
  }
}
const period = () => state.boot.periods.find((p) => p.id === Number($('period-select').value));
function currentWeek() {
  const p = period();
  return Math.max(
    1,
    Math.min(p.weeks, Math.floor((Date.parse(today()) - Date.parse(p.start)) / 604800000) + 1),
  );
}
function weekOptions(select, all = false) {
  options(
    select,
    Array.from({ length: period().weeks }, (_, i) => ({ label: `第${i + 1}周`, value: i + 1 })),
    all ? '全部周次' : undefined,
  );
}
function calculateWeek() {
  const date = $('inspection-date').value;
  if (!date) return;
  const week = Math.floor((Date.parse(date) - Date.parse(period().start)) / 604800000) + 1;
  $('inspection-week').value = Math.max(1, Math.min(period().weeks, week));
  $('week-hint').textContent =
    week < 1 || week > period().weeks
      ? '日期超出当前学期周次范围，请核实学期并手动选择周次。'
      : `按学期第1周周一 ${period().start} 推算，周次可手动调整。`;
}
function unique(field, list = state.boot.dorms) {
  return [...new Set(list.map((d) => d[field]))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN', { numeric: true }),
  );
}
function dormCascade(step = 0) {
  const controls = ['dorm-grade', 'dorm-gender', 'dorm-building', 'dorm-select'],
    fields = ['grade', 'gender', 'building', 'id'];
  for (let i = step; i < 4; i++) {
    let list = state.boot.dorms;
    for (let j = 0; j < i; j++)
      list = list.filter((d) => String(d[fields[j]]) === $(controls[j]).value);
    const values =
      i === 3
        ? list.map((d) => ({ value: d.id, label: `${d.dorm} · ${d.className}` }))
        : unique(fields[i], list);
    options($(controls[i]), values, ['请选择年级', '请选择类型', '请选择楼栋', '请选择宿舍'][i]);
    $(controls[i]).disabled = i > 0 && !$(controls[i - 1]).value;
  }
  const d = state.boot.dorms.find((d) => d.id === Number($('dorm-select').value));
  $('dorm-summary').textContent = d
    ? `${d.campus} · ${d.building} · ${d.dorm} · ${d.gender} · ${d.className}`
    : '请选择年级、类型、楼栋和宿舍。';
}
function selectDorm(d) {
  dormCascade();
  $('dorm-grade').value = d.grade;
  dormCascade(1);
  $('dorm-gender').value = d.gender;
  dormCascade(2);
  $('dorm-building').value = d.building;
  dormCascade(3);
  $('dorm-select').value = d.id;
  dormCascade(4);
}
function scoreLevel(total) {
  return total >= 90 ? '优秀' : total >= 80 ? '良好' : total >= 60 ? '合格' : '不合格';
}
function badge(total) {
  return node(
    'span',
    scoreLevel(total),
    'badge ' + (total >= 90 ? '' : total >= 80 ? 'good' : total >= 60 ? 'fair' : 'bad'),
  );
}
function totalScore() {
  const total = [...document.querySelectorAll('.score-input')].reduce(
    (n, input) => n + (Number(input.value) || 0),
    0,
  );
  $('total-score').textContent = total;
  const b = badge(total);
  $('total-level').className = b.className;
  $('total-level').textContent = b.textContent;
}
function renderCriteria() {
  const list = $('criteria-list');
  list.replaceChildren();
  state.boot.criteria.forEach((criterion, i) => {
    const row = node('div', undefined, 'criterion'),
      label = node('label', `${i + 1}. ${criterion}`);
    label.htmlFor = 'score-' + i;
    const controls = node('div', undefined, 'score-controls'),
      input = node('input');
    input.type = 'number';
    input.min = 0;
    input.max = 10;
    input.step = 1;
    input.required = true;
    input.value = 0;
    input.id = 'score-' + i;
    input.className = 'score-input';
    input.setAttribute('aria-label', criterion + '得分');
    input.addEventListener('input', () => {
      totalScore();
      state.dirty = true;
    });
    const adjust = (delta) => {
      input.value = Math.max(0, Math.min(10, Math.trunc(Number(input.value) || 0) + delta));
      totalScore();
      state.dirty = true;
    };
    const minus = button('−', () => adjust(-1)),
      plus = button('+', () => adjust(1));
    minus.setAttribute('aria-label', criterion + '减一分');
    plus.setAttribute('aria-label', criterion + '加一分');
    controls.append(minus, input, plus);
    row.append(label, controls);
    list.append(row);
  });
  totalScore();
}
function renderPhotoFields() {
  $('photo-fields').replaceChildren();
  for (let slot = 0; slot < 4; slot++) {
    const card = node('div', undefined, 'photo-card'),
      label = node('label', slot === 0 ? '全景照片 · 必传' : `特写照片 ${slot}`);
    const input = node('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.id = 'photo-' + slot;
    label.htmlFor = input.id;
    const preview = node('div');
    preview.id = 'photo-preview-' + slot;
    const desc = node('input');
    desc.type = 'text';
    desc.maxLength = 500;
    desc.placeholder = slot === 0 ? '全景说明（选填）' : '问题说明（选填）';
    desc.id = 'photo-desc-' + slot;
    desc.setAttribute('aria-label', slot === 0 ? '全景说明' : `特写${slot}说明`);
    input.addEventListener('change', () => guard(() => choosePhoto(slot, input)));
    const remove = button('移除照片', () => {
      state.photoTickets[slot]++;
      state.photos.delete(slot);
      input.value = '';
      desc.value = '';
      paintPhoto(slot);
      state.dirty = true;
    });
    card.append(label, preview, input, desc, remove);
    $('photo-fields').append(card);
    paintPhoto(slot);
  }
}
function paintPhoto(slot) {
  const preview = $('photo-preview-' + slot),
    photo = state.photos.get(slot);
  preview.replaceChildren();
  if (photo) {
    const img = node('img');
    img.alt = slot === 0 ? '全景照片预览' : `特写${slot}预览`;
    img.src = photo.data || '/api/photos/' + photo.id;
    preview.append(img);
  } else preview.append(node('div', '尚未选择照片', 'photo-placeholder'));
}
async function choosePhoto(slot, input) {
  const file = input.files[0];
  if (!file) return;
  const ticket = ++state.photoTickets[slot];
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw Error('请选择20MB以内的JPEG、PNG或WebP图片。');
  state.pendingPhotos++;
  updateSaveButton();
  try {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw Error('无法读取这张图片，请重新拍照或选择完整的JPEG、PNG、WebP文件。');
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const data = canvas.toDataURL('image/jpeg', 0.82);
    if (data.length > 4 * 1024 * 1024) throw Error('图片压缩后仍然过大，请选择较小的图片');
    if (ticket !== state.photoTickets[slot]) return;
    state.photos.set(slot, { slot, data });
    paintPhoto(slot);
    state.dirty = true;
    notice('照片已处理完成。');
  } finally {
    state.pendingPhotos--;
    updateSaveButton();
  }
}
function updateSaveButton() {
  $('save-inspection').disabled = state.saving || state.pendingPhotos > 0;
  $('save-inspection').textContent = state.pendingPhotos
    ? '正在处理图片…'
    : state.saving
      ? '正在保存…'
      : state.editing
        ? '保存修改'
        : '保存检查记录';
}
function resetInspection() {
  state.editing = null;
  state.photos.clear();
  state.photoTickets = state.photoTickets.map((n) => n + 1);
  $('inspection-form').reset();
  weekOptions($('inspection-week'));
  $('inspection-date').value = today();
  $('inspector').value = state.auth.user.name;
  calculateWeek();
  dormCascade();
  renderCriteria();
  renderPhotoFields();
  $('inspection-title').textContent = '新增检查记录';
  state.dirty = false;
  updateSaveButton();
}
async function saveInspection(event) {
  event.preventDefault();
  if (state.saving || state.pendingPhotos) return;
  if (!state.photos.has(0)) throw Error('请先上传全景照片。');
  const payload = {
    periodId: Number($('period-select').value),
    dormId: Number($('dorm-select').value),
    week: Number($('inspection-week').value),
    date: $('inspection-date').value,
    inspector: $('inspector').value,
    scores: state.boot.criteria.map((_, i) => Number($('score-' + i).value)),
    photos: [...state.photos.values()].map((p) => ({
      ...p,
      description: $('photo-desc-' + p.slot).value,
    })),
  };
  const edit = state.editing;
  if (edit) payload.version = edit.version;
  state.saving = true;
  updateSaveButton();
  try {
    await api('/records' + (edit ? '/' + edit.id : ''), {
      method: edit ? 'PUT' : 'POST',
      data: payload,
    });
    resetInspection();
    await switchTab('history');
    notice('检查记录已保存。');
  } finally {
    state.saving = false;
    updateSaveButton();
  }
}
function makeFilters(kind) {
  const container = $(kind + '-filters');
  container.replaceChildren();
  const values = state.filters[kind];
  for (const [key, title] of [
    ['week', '周次'],
    ['grade', '年级'],
    ['gender', '类型'],
    ['building', '楼栋'],
    ...(kind === 'history' ? [['level', '等级']] : []),
  ]) {
    const label = node('label', title),
      select = node('select');
    select.dataset.filter = key;
    select.id = kind + '-' + key;
    if (key === 'week') {
      weekOptions(select, kind === 'history');
      select.value = values.week ?? (kind === 'missing' ? currentWeek() : '');
    } else
      options(select, key === 'level' ? ['优秀', '良好', '合格', '不合格'] : unique(key), '全部');
    if (key !== 'week') select.value = values[key] || '';
    select.addEventListener('change', () => guard(() => loadList(kind, 1)));
    label.append(select);
    container.append(label);
  }
  const label = node('label', '班级 / 宿舍关键词', 'keyword'),
    input = node('input');
  input.dataset.filter = 'keyword';
  input.type = 'search';
  input.placeholder = '输入班级、楼栋或房间';
  input.maxLength = 100;
  input.value = values.keyword || '';
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => guard(() => loadList(kind, 1)), 280);
  });
  label.append(input);
  container.append(
    label,
    button('刷新', () => loadList(kind, 1)),
  );
}
function query(kind) {
  const values = {};
  $(kind + '-filters')
    .querySelectorAll('[data-filter]')
    .forEach((n) => (values[n.dataset.filter] = n.value));
  state.filters[kind] = values;
  return new URLSearchParams({ period: $('period-select').value, ...values });
}
function renderPager(kind, data, onPage) {
  const container = $(kind + '-pager');
  container.replaceChildren();
  container.append(
    node('span', `共 ${data.total} 条 · 第 ${data.page} / ${data.pages} 页`, 'pager-summary'),
  );
  for (const [label, p] of [
    ['首页', 1],
    ['上一页', data.page - 1],
    ['下一页', data.page + 1],
    ['末页', data.pages],
  ]) {
    const b = button(label, () => onPage(p));
    b.disabled = p < 1 || p > data.pages || p === data.page;
    container.append(b);
  }
  const select = node('select');
  select.setAttribute('aria-label', '每页条数');
  options(
    select,
    [10, 20, 50].map((n) => ({ label: n + '条 / 页', value: n })),
  );
  select.value = state.sizes[kind];
  select.addEventListener('change', () => {
    state.sizes[kind] = Number(select.value);
    guard(() => onPage(1));
  });
  container.append(select);
  const jump = node('input');
  jump.type = 'number';
  jump.min = 1;
  jump.max = data.pages;
  jump.value = data.page;
  jump.setAttribute('aria-label', '跳转页码');
  container.append(
    jump,
    button('跳转', () => {
      const p = Number(jump.value);
      if (!Number.isInteger(p) || p < 1 || p > data.pages) throw Error('请输入有效页码');
      return onPage(p);
    }),
  );
}
function cell(main, sub) {
  const td = node('td', main);
  if (sub) td.append(node('small', sub));
  return td;
}
async function loadList(kind, page = 1) {
  const ticket = ++state.tickets[kind],
    params = query(kind);
  params.set('page', page);
  params.set('pageSize', state.sizes[kind]);
  const body = $(kind + '-body');
  $(kind + '-status').textContent = '正在加载…';
  $(kind + '-pager').replaceChildren();
  body.replaceChildren();
  try {
    const data = await api('/' + (kind === 'history' ? 'records' : 'uninspected') + '?' + params);
    if (ticket !== state.tickets[kind] || !state.auth) return;
    state.pages[kind] = data.page;
    state.rows[kind] = data.items;
    $(kind + '-status').textContent =
      `当前筛选共 ${data.total} ${kind === 'history' ? '条检查记录' : '条未检查宿舍条目'}`;
    if (!data.items.length) {
      const tr = node('tr'),
        td = node('td', '当前条件下暂无数据。', 'empty');
      td.colSpan = 6;
      tr.append(td);
      body.append(tr);
    }
    for (const r of data.items) {
      const tr = node('tr'),
        actions = node('td', undefined, 'actions');
      if (kind === 'history') {
        tr.append(
          cell('第' + r.week + '周', r.date),
          cell(r.building + ' / ' + r.dorm, r.campus + ' · ' + r.gender),
          cell(r.grade, r.className),
        );
        const score = cell(r.total + '分');
        score.append(node('br'), badge(r.total));
        tr.append(score, cell(r.inspector, r.ownerName ? '录入：' + r.ownerName : ''));
        actions.append(button('详情', () => viewRecord(r.id)));
        if (state.auth.user.role === 'admin' || r.owner_id === state.auth.user.id)
          actions.append(button('编辑', () => editRecord(r.id)));
        if (state.auth.user.role === 'admin')
          actions.append(
            button(
              '删除',
              async () => {
                if (!confirm(`确认删除 ${r.building} ${r.dorm} 第${r.week}周的检查记录和照片？`))
                  return;
                await api('/records/' + r.id, { method: 'DELETE', data: { version: r.version } });
                await loadList(kind, state.pages[kind]);
                notice('记录已删除。');
              },
              'danger',
            ),
          );
      } else {
        tr.append(
          cell(r.grade),
          cell(r.campus, r.building),
          cell(r.dorm),
          cell(r.gender),
          cell(r.className),
        );
        actions.append(
          button('去打分', async () => {
            if (state.dirty && !confirm('当前评分尚未保存，确定重新填写？')) return;
            resetInspection();
            selectDorm(r);
            $('inspection-week').value = state.filters.missing.week;
            await switchTab('inspect');
          }),
        );
      }
      tr.append(actions);
      body.append(tr);
    }
    renderPager(kind, data, (p) => loadList(kind, p));
  } catch (e) {
    if (ticket !== state.tickets[kind]) return;
    $(kind + '-status').textContent = '加载失败：' + e.message;
    throw e;
  }
}
async function viewRecord(id) {
  const r = await api('/records/' + id);
  $('detail-title').textContent = `${r.building} ${r.dorm} · 第${r.week}周`;
  const content = $('detail-content');
  content.replaceChildren();
  const summary = node('div', undefined, 'detail-summary');
  summary.append(
    node('p', `${r.grade} · ${r.campus} · ${r.gender}`),
    node('p', r.className),
    node('p', `${r.date} · 检查人 ${r.inspector} · ${r.total}分（${r.level}）`),
  );
  content.append(summary);
  r.scores.forEach((value, i) => {
    const row = node('div', undefined, 'detail-score');
    row.append(node('span', `${i + 1}. ${state.boot.criteria[i]}`), node('strong', value + '分'));
    content.append(row);
  });
  const photos = node('div', undefined, 'detail-photos');
  r.photos.forEach((p) => {
    const card = node('div'),
      a = node('a');
    a.href = '/api/photos/' + p.id;
    a.target = '_blank';
    a.rel = 'noopener';
    const img = node('img');
    img.src = a.href;
    img.alt = p.slot === 0 ? '全景照片' : `特写${p.slot}`;
    a.append(img);
    card.append(
      a,
      node(
        'p',
        (p.slot === 0 ? '全景' : `特写${p.slot}`) + (p.description ? ' · ' + p.description : ''),
      ),
    );
    photos.append(card);
  });
  content.append(photos);
  $('detail-dialog').showModal();
}
async function editRecord(id) {
  if (state.dirty && !confirm('当前评分尚未保存，确定打开其他记录？')) return;
  const r = await api('/records/' + id);
  $('period-select').value = r.period_id;
  resetInspection();
  state.editing = r;
  selectDorm(state.boot.dorms.find((d) => d.id === r.dorm_id));
  $('inspection-date').value = r.date;
  $('inspection-week').value = r.week;
  $('inspector').value = r.inspector;
  r.scores.forEach((n, i) => ($('score-' + i).value = n));
  totalScore();
  r.photos.forEach((p) => {
    state.photos.set(p.slot, p);
    $('photo-desc-' + p.slot).value = p.description;
    paintPhoto(p.slot);
  });
  $('inspection-title').textContent = '编辑检查记录 #' + r.id;
  updateSaveButton();
  await switchTab('inspect');
}
async function switchTab(tab) {
  if (tab === 'admin' && state.auth.user.role !== 'admin') return;
  state.tab = tab;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + tab));
  document
    .querySelectorAll('[data-tab]')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('page-title').textContent = {
    inspect: '现场检查',
    history: '历史记录',
    missing: '未查宿舍',
    admin: '系统管理',
  }[tab];
  notice('');
  if (['history', 'missing'].includes(tab)) await loadList(tab, state.pages[tab]);
  if (tab === 'admin') await loadAdmin();
}
async function boot() {
  state.boot = await api('/bootstrap');
  options(
    $('period-select'),
    state.boot.periods.map((p) => ({ value: p.id, label: p.name + (p.active ? ' · 当前' : '') })),
  );
  $('period-select').value = (state.boot.periods.find((p) => p.active) || state.boot.periods[0]).id;
  state.filters = { history: {}, missing: {} };
  state.pages = { history: 1, missing: 1, audit: 1 };
  resetInspection();
  makeFilters('history');
  makeFilters('missing');
  $('account-name').textContent =
    state.auth.user.name + ' · ' + (state.auth.user.role === 'admin' ? '管理员' : '检查员');
  $('admin-tab').hidden = state.auth.user.role !== 'admin';
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  await switchTab('inspect');
}
async function loadAdmin() {
  state.users = await api('/admin/users');
  const body = $('users-body');
  body.replaceChildren();
  for (const u of state.users) {
    const tr = node('tr');
    tr.append(
      cell(u.username),
      cell(u.name),
      cell(u.role === 'admin' ? '管理员' : '检查员'),
      cell(u.enabled ? '启用' : '停用'),
    );
    const action = node('td');
    action.append(button('编辑 / 重置密码', () => userForm(u)));
    tr.append(action);
    body.append(tr);
  }
  renderPeriods();
  await loadAudit(state.pages.audit);
}
function renderPeriods() {
  $('period-list').replaceChildren();
  for (const p of state.boot.periods) {
    const row = node('div', undefined, 'period-row'),
      label = node('span', p.name);
    label.append(node('small', `第1周周一：${p.start} · 共${p.weeks}周`));
    row.append(
      label,
      p.active
        ? node('span', '当前学期', 'badge')
        : button('设为当前', async () => {
            await api('/admin/periods/' + p.id + '/activate', { method: 'POST', data: {} });
            await refreshPeriods();
            notice('已设为当前学期，下次登录时默认选中。');
          }),
    );
    $('period-list').append(row);
  }
}
async function refreshPeriods() {
  const selected = $('period-select').value;
  state.boot = await api('/bootstrap');
  options(
    $('period-select'),
    state.boot.periods.map((p) => ({ value: p.id, label: p.name + (p.active ? ' · 当前' : '') })),
  );
  $('period-select').value = selected;
  renderPeriods();
}
function userForm(u) {
  const form = $('user-form');
  form.reset();
  form.elements.id.value = u?.id || '';
  form.elements.username.disabled = Boolean(u);
  form.elements.username.value = u?.username || '';
  form.elements.name.value = u?.name || '';
  form.elements.role.value = u?.role || 'inspector';
  form.elements.enabled.value = u?.enabled === 0 ? 'false' : 'true';
  form.elements.enabled.disabled = !u;
  form.elements.password.required = !u;
  form.querySelector('.form-error').textContent = '';
  $('user-form-title').textContent = u ? '编辑账号' : '新增账号';
  $('user-dialog').showModal();
}
async function loadAudit(page = 1) {
  const ticket = ++state.tickets.audit,
    data = await api('/admin/audit?' + new URLSearchParams({ page, pageSize: state.sizes.audit }));
  if (ticket !== state.tickets.audit || !state.auth) return;
  state.pages.audit = data.page;
  $('audit-body').replaceChildren();
  const names = {
    login: '登录',
    create_record: '新增记录',
    update_record: '修改记录',
    delete_record: '删除记录',
    create_user: '新增账号',
    update_user: '修改账号',
    change_password: '修改密码',
    create_period: '新增学期',
    activate_period: '切换默认学期',
    import_records: '导入旧记录',
  };
  for (const r of data.items) {
    const tr = node('tr');
    tr.append(
      cell(new Date(r.created_at).toLocaleString('zh-CN')),
      cell(r.actor),
      cell(names[r.action] || r.action),
      cell(r.target),
    );
    $('audit-body').append(tr);
  }
  renderPager('audit', data, loadAudit);
}
async function exportList(kind) {
  const q = query(kind);
  q.set('kind', kind === 'missing' ? 'uninspected' : 'records');
  const res = await fetch('/api/export?' + q);
  if (!res.ok) {
    if (res.status === 401) showLogin('请重新登录');
    throw Error((await res.json()).error || '导出失败');
  }
  const url = URL.createObjectURL(await res.blob()),
    a = node('a');
  a.href = url;
  a.download = (kind === 'missing' ? '未查宿舍' : '检查记录') + '_' + today() + '.csv';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) $(close.dataset.close).close();
  const tab = event.target.closest('[data-tab]');
  if (tab) guard(() => switchTab(tab.dataset.tab));
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  guard(async () => {
    if (action === 'logout') {
      if (state.dirty && !confirm('还有未保存的评分，确定退出？')) return;
      await api('/logout', { method: 'POST', data: {} });
      state.dirty = false;
      showLogin();
    }
    if (action === 'password') {
      $('password-form').reset();
      document.querySelector('#password-form .form-error').textContent = '';
      $('password-dialog').showModal();
    }
    if (action === 'reset-inspection') {
      if (!state.dirty || confirm('确定清空当前表单？')) resetInspection();
    }
    if (action === 'new-user') userForm();
    if (action === 'audit-refresh') await loadAudit(1);
    if (action === 'export-history') await exportList('history');
    if (action === 'export-missing') await exportList('missing');
  });
});
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    b = form.querySelector('button');
  b.disabled = true;
  $('login-error').textContent = '';
  try {
    state.auth = await api('/login', {
      method: 'POST',
      data: { username: form.elements.username.value, password: form.elements.password.value },
    });
    form.elements.password.value = '';
    await boot();
  } catch (e) {
    $('login-error').textContent = e.message;
  } finally {
    b.disabled = false;
  }
});
$('inspection-form').addEventListener('submit', (event) => guard(() => saveInspection(event)));
$('inspection-form').addEventListener('input', () => (state.dirty = true));
$('inspection-date').addEventListener('change', calculateWeek);
['dorm-grade', 'dorm-gender', 'dorm-building', 'dorm-select'].forEach((id, i) =>
  $(id).addEventListener('change', () => dormCascade(i + 1)),
);
$('period-select').addEventListener('focus', () => {
  $('period-select').dataset.previous = $('period-select').value;
});
$('period-select').addEventListener('change', () =>
  guard(async () => {
    if (state.dirty && !confirm('切换学期将清空未保存的评分，是否继续？')) {
      $('period-select').value = $('period-select').dataset.previous;
      return;
    }
    $('period-select').dataset.previous = $('period-select').value;
    state.filters = { history: {}, missing: {} };
    state.pages.history = state.pages.missing = 1;
    resetInspection();
    makeFilters('history');
    makeFilters('missing');
    await switchTab(state.tab);
  }),
);
$('user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = event.currentTarget,
    b = f.querySelector('[type=submit]');
  b.disabled = true;
  f.querySelector('.form-error').textContent = '';
  try {
    const id = f.elements.id.value;
    await api('/admin/users' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      data: {
        username: f.elements.username.value,
        name: f.elements.name.value,
        role: f.elements.role.value,
        enabled: f.elements.enabled.value === 'true',
        password: f.elements.password.value,
      },
    });
    $('user-dialog').close();
    if (Number(id) === state.auth.user.id) {
      showLogin('账号已更新，请重新登录。');
      return;
    }
    await loadAdmin();
    notice('账号已保存。');
  } catch (e) {
    f.querySelector('.form-error').textContent = e.message;
  } finally {
    b.disabled = false;
  }
});
$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = event.currentTarget,
    b = f.querySelector('button:not([type=button])');
  b.disabled = true;
  try {
    if (f.elements.password.value !== f.elements.confirm.value) throw Error('两次输入的密码不一致');
    await api('/password', { method: 'PUT', data: { password: f.elements.password.value } });
    f.reset();
    showLogin('密码已修改，请使用新密码登录。');
  } catch (e) {
    f.querySelector('.form-error').textContent = e.message;
  } finally {
    b.disabled = false;
  }
});
$('period-form').addEventListener('submit', (event) => {
  event.preventDefault();
  guard(async () => {
    const f = event.currentTarget,
      b = f.querySelector('button');
    b.disabled = true;
    try {
      await api('/admin/periods', {
        method: 'POST',
        data: {
          name: f.elements.name.value,
          start: f.elements.start.value,
          weeks: Number(f.elements.weeks.value),
          active: true,
        },
      });
      await refreshPeriods();
      f.reset();
      notice('新学期已创建，可在顶部切换学期。');
    } finally {
      b.disabled = false;
    }
  });
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
(async () => {
  try {
    state.auth = await api('/me');
    await boot();
  } catch (e) {
    showLogin(e.message === '请先登录' ? '' : e.message);
  }
})();
