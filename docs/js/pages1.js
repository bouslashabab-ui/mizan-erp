'use strict';
/* Setup & master data: generic card + list pages, trees, items, parties, users */
const yesno = (v) => v ? h('span', { class: 'tag ok' }, 'نعم') : h('span', { class: 'tag' }, 'لا');
const activeCol = { t: 'الحالة', f: r => r.active ? h('span', { class: 'tag ok' }, 'نشط') : h('span', { class: 'tag bad' }, 'موقوف') };

function formFor(fields, row, extra) {
  const fs = fields.filter(f => !f.hide).map(f => mkField(f, row ? row[f.k] : undefined));
  const el = h('div', { class: 'form-grid' }, fs.map(x => h('label', { class: 'fld' + (x.f.full ? ' full' : '') }, h('span', null, x.f.t + (x.f.req ? ' *' : '')), x.el)));
  return {
    el, fs,
    get() { const o = {}; fs.forEach(x => { if (!x.f.readonly) o[x.f.k] = x.get(); }); return o; },
    set(r) { fs.forEach(x => x.set(r ? r[x.f.k] : (x.f.def ?? (x.f.type === 'check' ? 0 : '')))); },
    field(k) { return fs.find(x => x.f.k === k); }
  };
}

/* generic list + card editor with a bottom record bar */
async function crudPage(cfg) {
  for (const n of (cfg.needs || [])) await load(n, true);
  const canEdit = can(cfg.perm + ':edit');
  let rows = [], cur = [];
  const fields = typeof cfg.fields === 'function' ? cfg.fields() : cfg.fields;
  const q = h('input', { class: 'inp', placeholder: 'بحث بالاسم أو الكود...', style: { maxWidth: '280px' } });
  const holder = h('div');
  async function reload() { rows = await GET(cfg.path + (cfg.filter ? qs(cfg.filter) : '')); draw(); }
  function draw() {
    const t = q.value.trim().toLowerCase();
    cur = t ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(t)) : rows;
    holder.innerHTML = '';
    holder.append(table(cfg.cols, cur, { onrow: (r, tr) => edit(cur.indexOf(r)) }));
    holder.append(h('div', { class: 'statusbar' }, h('span', null, 'عدد السجلات: ' + cur.length)));
  }
  function edit(idx) {
    let i = idx;
    const body = h('div');
    let form;
    const show = (k) => {
      i = Math.max(0, Math.min(cur.length ? cur.length - 1 : 0, k));
      const r = i >= 0 && cur[i] ? cur[i] : null; mk(r);
    };
    let isNew = false;
    const mk = (r) => {
      isNew = !r; body.innerHTML = '';
      form = formFor(fields, r || { ...(cfg.defaults || {}), ...(cfg.filter || {}) });
      if (r) form.cur = r;
      body.append(form.el);
      if (cfg.extra) { const ex = cfg.extra(r, form); ex && body.append(ex); }
      lab.textContent = isNew ? 'جديد' : (i + 1) + ' / ' + cur.length;
    };
    const lab = h('span', { class: 'rb-pos' });
    const save = async () => {
      const data = { ...form.get(), ...(cfg.fixed || {}) };
      for (const f of fields) if (f.req && (data[f.k] === null || data[f.k] === undefined || data[f.k] === '')) throw new Error('الحقل مطلوب: ' + f.t);
      if (isNew) { const r = await POST(cfg.path, data); toast('تمت الإضافة'); await reload(); const ni = cur.findIndex(x => x.id === r.id); if (cfg.reloadLookups) await load(cfg.reloadLookups, true); show(ni >= 0 ? ni : 0); }
      else { await PUT(cfg.path + '/' + form.cur.id, data); toast('تم الحفظ'); const id = form.cur.id; await reload(); if (cfg.reloadLookups) await load(cfg.reloadLookups, true); show(cur.findIndex(x => x.id === id)); }
    };
    const del = async () => {
      if (isNew) return;
      if (!(await confirmBox('حذف هذا السجل نهائياً؟'))) return;
      await DEL(cfg.path + '/' + form.cur.id); toast('تم الحذف'); await reload(); if (cfg.reloadLookups) await load(cfg.reloadLookups, true);
      if (!cur.length) m.close(); else show(i);
    };
    const nb = (t, fn, title) => h('button', { class: 'rb', title, onclick: guard(fn) }, t);
    const bar = h('div', { class: 'recbar' },
      h('div', { class: 'rb-nav' }, nb('⏮', () => show(0)), nb('◀', () => show(i - 1)), lab, nb('▶', () => show(i + 1)), nb('⏭', () => show(cur.length - 1))),
      h('div', { class: 'rb-act' }, canEdit ? nb('➕ جديد', () => mk(null)) : null, canEdit ? nb('💾 حفظ', save) : null, canEdit && !cfg.noDelete ? nb('🗑 حذف', del) : null));
    const wrap = h('div', null, body);
    const m = modal(cfg.card || cfg.title, h('div', null, wrap, bar), null, { wide: cfg.wide });
    $('.win-body', m.win).style.padding = '0'; body.style.padding = '14px 16px';
    if (idx >= 0) show(idx); else mk(null);
  }
  q.addEventListener('input', draw);
  await reload();
  return h('div', null, pageHead(cfg.title, q, canEdit ? btn('➕ جديد', () => edit(-1), 'pri') : null,
    btn('تصدير Excel', () => download(cfg.title + '.csv', csvOf(cfg.cols, cur)))), h('div', { class: 'panel' }, holder));
}

/* tree page: left tree, right card (accounts, warehouses, item groups, cost centers) */
function buildTree(rows) {
  const kids = {}; rows.forEach(r => { (kids[r.parent_id || 0] = kids[r.parent_id || 0] || []).push(r); });
  return { kids, roots: kids[0] || [] };
}
async function treePage(cfg) {
  for (const n of (cfg.needs || [])) await load(n, true);
  const canEdit = can(cfg.perm + ':edit');
  let rows = await GET(cfg.path), sel = null, extra = cfg.loadExtra ? await cfg.loadExtra() : null;
  const open = new Set(); const fields = typeof cfg.fields === 'function' ? cfg.fields : () => cfg.fields;
  const treeEl = h('div', { class: 'tree' }), cardEl = h('div');
  const q = h('input', { class: 'inp', placeholder: 'بحث...' });
  function nodeLabel(r) { return cfg.label ? cfg.label(r, extra) : h('span', null, (r.code ? r.code + ' ' : '') + r.name); }
  function drawTree() {
    treeEl.innerHTML = '';
    const { kids, roots } = buildTree(rows); const term = q.value.trim().toLowerCase();
    const walk = (n, depth) => {
      const ch = kids[n.id] || [];
      const match = term && (n.name + ' ' + (n.code || '')).toLowerCase().includes(term);
      if (term && !match && !ch.some(function f(c) { return (c.name + ' ' + (c.code || '')).toLowerCase().includes(term) || (kids[c.id] || []).some(f); })) return;
      const isOpen = term || open.has(n.id);
      const row = h('div', { class: 'tn' + (sel && sel.id === n.id ? ' sel' : ''), style: { paddingRight: (6 + depth * 18) + 'px' }, onclick: () => { selectRow(n); } },
        h('span', { class: 'tg', onclick: (e) => { e.stopPropagation(); isOpen ? open.delete(n.id) : open.add(n.id); drawTree(); } }, ch.length ? (isOpen ? '▾' : '▸') : (n.is_group ? '▫' : '•')), nodeLabel(n));
      treeEl.append(row);
      if (isOpen) ch.forEach(c => walk(c, depth + 1));
    };
    roots.forEach(r => walk(r, 0));
  }
  function selectRow(r) { sel = r; drawTree(); drawCard(r); }
  function drawCard(r, parent) {
    cardEl.innerHTML = '';
    const isNew = !r;
    const form = formFor(fields(extra), r || { ...(cfg.defaults || {}), ...(parent ? { parent_id: parent.id, ...(cfg.inherit ? cfg.inherit(parent) : {}) } : {}) });
    const save = async () => {
      const data = form.get();
      for (const f of fields(extra)) if (f.req && (data[f.k] === null || data[f.k] === '' || data[f.k] === undefined)) throw new Error('الحقل مطلوب: ' + f.t);
      let id;
      if (isNew) { id = (await POST(cfg.path, data)).id; toast('تمت الإضافة'); } else { await PUT(cfg.path + '/' + r.id, data); id = r.id; toast('تم الحفظ'); }
      rows = await GET(cfg.path); if (cfg.lookup) await load(cfg.lookup, true); if (data.parent_id) open.add(+data.parent_id);
      const nr = rows.find(x => x.id === id); sel = nr; drawTree(); drawCard(nr);
    };
    const del = async () => {
      if (!r) return; if (!(await confirmBox('حذف "' + r.name + '"؟'))) return;
      await DEL(cfg.path + '/' + r.id); toast('تم الحذف'); rows = await GET(cfg.path); if (cfg.lookup) await load(cfg.lookup, true); sel = null; drawTree(); drawCard(null);
    };
    const nb = (t, fn) => h('button', { class: 'rb', onclick: guard(fn) }, t);
    const flat = () => { const out = []; const { kids, roots } = buildTree(rows); const w = (n) => { out.push(n); (kids[n.id] || []).forEach(w); }; roots.forEach(w); return out; };
    const go = (d) => { const f = flat(); if (!f.length) return; const i = sel ? f.findIndex(x => x.id === sel.id) : -1; const n = f[Math.max(0, Math.min(f.length - 1, i + d))]; (n.parent_id ? open.add(n.parent_id) : 0); selectRow(n); };
    const bar = h('div', { class: 'recbar' },
      h('div', { class: 'rb-nav' }, nb('⏮', () => { const f = flat(); f[0] && selectRow(f[0]); }), nb('◀', () => go(-1)), h('span', { class: 'rb-pos' }, isNew ? 'جديد' : (r.code || r.name)), nb('▶', () => go(1)), nb('⏭', () => { const f = flat(); f.length && selectRow(f[f.length - 1]); })),
      h('div', { class: 'rb-act' }, canEdit ? nb('➕ جديد', () => { sel = null; drawTree(); drawCard(null); }) : null,
        canEdit && r ? nb('↳ فرع جديد', () => drawCard(null, r)) : null, canEdit ? nb('💾 حفظ', save) : null, canEdit && r ? nb('🗑 حذف', del) : null));
    cardEl.append(h('div', { class: 'panel' }, h('div', { class: 'ph' }, cfg.card + (r ? ': ' + r.name : ' - جديد')), h('div', { class: 'pb' }, form.el, cfg.cardExtra && r ? cfg.cardExtra(r, extra) : null), bar));
  }
  q.addEventListener('input', drawTree);
  rows.filter(r => !r.parent_id).forEach(r => open.add(r.id));
  drawTree(); drawCard(null);
  return h('div', null, pageHead(cfg.title, canEdit ? btn('➕ ' + (cfg.newLabel || 'جديد'), () => { sel = null; drawTree(); drawCard(null); }, 'pri') : null,
    btn('فتح الكل', () => { rows.forEach(r => open.add(r.id)); drawTree(); }), btn('طي الكل', () => { open.clear(); drawTree(); })),
    h('div', { class: 'split' }, h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الشجرة'), h('div', { class: 'pb' }, q, treeEl)), cardEl));
}

const ACC_TYPES = [{ v: 'asset', t: 'أصول' }, { v: 'liability', t: 'خصوم' }, { v: 'equity', t: 'حقوق ملكية' }, { v: 'revenue', t: 'إيرادات' }, { v: 'expense', t: 'مصروفات' }];
MZ.pages.accounts = () => treePage({
  title: 'دليل الحسابات', card: 'بطاقة الحساب', path: '/accounts', perm: 'accounts', lookup: 'accounts', newLabel: 'حساب جديد', needs: ['accounts'],
  defaults: { type: 'asset', active: 1, is_group: 0 },
  inherit: (p) => ({ type: p.type }),
  loadExtra: async () => { const t = await GET('/reports/trial'); const bal = {}; const byid = {}; t.forEach(a => byid[a.id] = a); t.forEach(a => { let v = a.opening + a.dr - a.cr; let p = a; while (p) { bal[p.id] = (bal[p.id] || 0) + v; p = byid[p.parent_id]; } }); return { bal }; },
  label: (r, ex) => h('span', null, r.code + ' ' + r.name, ex && ex.bal[r.id] ? h('span', { class: 'cd' }, '  ' + fmt(ex.bal[r.id])) : null),
  fields: () => [
    { k: 'code', t: 'كود الحساب', req: 1, dir: 'ltr' }, { k: 'name', t: 'اسم الحساب', req: 1 }, { k: 'name_en', t: 'الاسم بالإنجليزية', dir: 'ltr' },
    { k: 'parent_id', t: 'الحساب الأب', type: 'ref', ref: () => optsOf('accounts', a => a.is_group, accLabel) },
    { k: 'type', t: 'نوع الحساب', type: 'select', options: ACC_TYPES, req: 1 },
    { k: 'is_group', t: 'حساب رئيسي (يجمع حسابات فرعية)', type: 'check' }, { k: 'cc_required', t: 'يتطلب مركز تكلفة', type: 'check' }, { k: 'active', t: 'نشط', type: 'check' },
    { k: 'notes', t: 'ملاحظات', type: 'textarea', full: 1 }]
});
MZ.pages.warehouses = () => treePage({
  title: 'المخازن', card: 'بطاقة المخزن', path: '/warehouses', perm: 'warehouses', lookup: 'warehouses', newLabel: 'مخزن جديد', needs: ['warehouses', 'branches'],
  defaults: { active: 1 },
  fields: () => [{ k: 'code', t: 'كود المخزن', dir: 'ltr' }, { k: 'name', t: 'اسم المخزن', req: 1 }, { k: 'parent_id', t: 'المخزن الأب', type: 'ref', ref: () => optsOf('warehouses') },
    { k: 'branch_id', t: 'الفرع', type: 'ref', ref: () => optsOf('branches') }, { k: 'active', t: 'نشط', type: 'check' }]
});
MZ.pages.item_groups = () => treePage({
  title: 'مجموعات الأصناف', card: 'بطاقة المجموعة', path: '/item_groups', perm: 'items', lookup: 'item_groups', newLabel: 'مجموعة جديدة', needs: ['item_groups'],
  fields: () => [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'اسم المجموعة', req: 1 }, { k: 'parent_id', t: 'المجموعة الأب', type: 'ref', ref: () => optsOf('item_groups') }]
});
MZ.pages.cost_centers = () => treePage({
  title: 'مراكز التكلفة', card: 'بطاقة المركز', path: '/cost_centers', perm: 'accounts', lookup: 'cost_centers', newLabel: 'مركز جديد', needs: ['cost_centers'], defaults: { active: 1 },
  fields: () => [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'اسم المركز', req: 1 }, { k: 'parent_id', t: 'المركز الأب', type: 'ref', ref: () => optsOf('cost_centers') }, { k: 'active', t: 'نشط', type: 'check' }]
});
MZ.pages.branches = () => crudPage({
  title: 'الفروع', card: 'بطاقة الفرع', path: '/branches', perm: 'settings', reloadLookups: 'branches', defaults: { active: 1 },
  cols: [{ t: 'الكود', k: 'code' }, { t: 'اسم الفرع', k: 'name' }, { t: 'العنوان', k: 'address' }, { t: 'الهاتف', k: 'phone' }, activeCol],
  fields: [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'اسم الفرع', req: 1 }, { k: 'address', t: 'العنوان' }, { k: 'phone', t: 'الهاتف', dir: 'ltr' }, { k: 'active', t: 'نشط', type: 'check' }]
});

/* parties */
const partyPage = (type) => () => crudPage({
  title: type === 'customer' ? 'العملاء' : 'الموردون', card: type === 'customer' ? 'بطاقة العميل' : 'بطاقة المورد', path: '/parties', perm: 'parties', filter: { type }, fixed: { type }, reloadLookups: 'parties',
  defaults: { type, active: 1, credit_limit: 0 },
  cols: [{ t: 'الكود', k: 'code' }, { t: 'الاسم', k: 'name' }, { t: 'الهاتف', k: 'phone' }, { t: 'العنوان', k: 'address' }, { t: 'حد الائتمان', k: 'credit_limit', num: 1 }, activeCol],
  fields: [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'الاسم', req: 1 }, { k: 'phone', t: 'الهاتف', dir: 'ltr' }, { k: 'email', t: 'البريد الإلكتروني', dir: 'ltr' },
    { k: 'tax_no', t: 'الرقم الضريبي', dir: 'ltr' }, { k: 'credit_limit', t: 'حد الائتمان', type: 'number' }, { k: 'address', t: 'العنوان', full: 1 }, { k: 'notes', t: 'ملاحظات', full: 1 }, { k: 'active', t: 'نشط', type: 'check' }]
});
MZ.pages.customers = partyPage('customer');
MZ.pages.suppliers = partyPage('supplier');

/* items with tabs: basic / units / balances */
MZ.pages.items = () => crudPage({
  title: 'الأصناف', card: 'بطاقة الصنف', path: '/items', perm: 'items', wide: true, reloadLookups: 'items', needs: ['item_groups', 'warehouses'],
  defaults: { kind: 'stock', unit: 'قطعة', active: 1, sale_price: 0, min_qty: 0, tax_rate: 0 },
  cols: [{ t: 'الكود', k: 'code' }, { t: 'اسم الصنف', k: 'name' }, { t: 'المجموعة', f: r => nameOf('item_groups', r.group_id) }, { t: 'الوحدة', k: 'unit' },
    { t: 'سعر البيع', k: 'sale_price', num: 1 }, { t: 'متوسط التكلفة', k: 'avg_cost', num: 1 }, { t: 'الرصيد', f: r => r.kind === 'stock' ? fq(r.qty) : '—', cls: 'num' }, activeCol],
  fields: [{ k: 'code', t: 'كود الصنف', dir: 'ltr' }, { k: 'name', t: 'اسم الصنف', req: 1 }, { k: 'name_en', t: 'الاسم بالإنجليزية', dir: 'ltr' },
    { k: 'group_id', t: 'المجموعة', type: 'ref', ref: () => optsOf('item_groups') }, { k: 'kind', t: 'النوع', type: 'select', options: [{ v: 'stock', t: 'مخزني' }, { v: 'service', t: 'خدمة' }], req: 1 },
    { k: 'unit', t: 'الوحدة الأساسية', req: 1 }, { k: 'barcode', t: 'الباركود', dir: 'ltr' }, { k: 'sale_price', t: 'سعر البيع (الوحدة الأساسية)', type: 'number' },
    { k: 'tax_rate', t: 'نسبة الضريبة %', type: 'number' }, { k: 'min_qty', t: 'حد إعادة الطلب', type: 'number' }, { k: 'notes', t: 'ملاحظات', full: 1 }, { k: 'active', t: 'نشط', type: 'check' }],
  extra: (r) => {
    if (!r) return h('p', { class: 'empty' }, 'احفظ الصنف أولاً ثم أضف الوحدات وشاهد الأرصدة');
    const box = h('div', { style: { marginTop: '14px' } });
    const tabs = ['الوحدات والتحويل', 'الأرصدة بالمخازن', 'كارت الصنف'];
    const head = h('div', { class: 'ctabs' }), body = h('div');
    const show = async (i) => {
      $$('.ctab', head).forEach((x, j) => x.classList.toggle('on', i === j)); body.innerHTML = '';
      if (i === 0) {
        const ed = can('items:edit');
        const units = await GET('/item_units?item_id=' + r.id);
        const draw = () => {
          body.innerHTML = '';
          body.append(h('p', { class: 'cd' }, 'الوحدة الأساسية: ' + r.unit + '. المعامل = عدد الوحدات الأساسية في الوحدة الكبرى (مثال: كرتونة = 12).'));
          body.append(table([{ t: 'الوحدة', k: 'unit' }, { t: 'المعامل', k: 'factor', num: 1 }, { t: 'السعر', k: 'price', num: 1 }, { t: 'الباركود', k: 'barcode' },
            { t: '', f: u => ed ? h('button', { class: 'btn sm danger', onclick: guard(async () => { await DEL('/item_units/' + u.id); units.splice(units.indexOf(u), 1); draw(); }) }, 'حذف') : '' }], units));
          if (ed) { const f = formFor([{ k: 'unit', t: 'الوحدة' }, { k: 'factor', t: 'المعامل', type: 'number', def: 1 }, { k: 'price', t: 'سعر البيع', type: 'number', def: 0 }, { k: 'barcode', t: 'باركود', dir: 'ltr' }]);
            body.append(h('div', { style: { marginTop: '10px' } }, f.el, btn('إضافة وحدة', async () => { const d = f.get(); if (!d.unit || !(d.factor > 0)) throw new Error('أدخل الوحدة والمعامل'); const x = await POST('/item_units', { ...d, item_id: r.id }); units.push({ ...d, id: x.id }); draw(); }, 'pri'))); }
        }; draw();
      } else if (i === 1) {
        const st = await GET('/reports/stock?by_wh=1'); const mine = st.filter(x => x.id === r.id && x.qty !== 0);
        body.append(table([{ t: 'المخزن', f: x => nameOf('warehouses', x.warehouse_id) }, { t: 'الكمية', k: 'qty', f: x => fq(x.qty), cls: 'num' }, { t: 'القيمة', k: 'value', num: 1 }], mine, { empty: 'لا يوجد رصيد' }));
      } else {
        const c = await GET('/reports/stockcard?item_id=' + r.id);
        body.append(h('p', { class: 'cd' }, 'رصيد أول المدة: ' + fq(c.opening)));
        body.append(table([{ t: 'التاريخ', k: 'date' }, { t: 'المخزن', k: 'wh' }, { t: 'البيان', f: x => ({ invoice: 'فاتورة', adjust: 'جرد', transfer: 'تحويل', prod: 'تصنيع' }[x.ref_type] || '') + (x.note ? ' - ' + x.note : '') },
          { t: 'الكمية', f: x => fq(x.qty), cls: 'num' }, { t: 'الرصيد', f: x => fq(x.balance), cls: 'num' }], c.rows));
      }
    };
    tabs.forEach((t, i) => head.append(h('div', { class: 'ctab', onclick: guard(() => show(i)) }, t)));
    box.append(head, body); show(0); return box;
  }
});

/* users & roles */
MZ.pages.users = async () => {
  await Promise.all([load('roles', true), load('branches', true)]);
  const users = await GET('/users'); const ed = can('users:edit');
  const roleOpts = (MZ.L.roles || []).map(r => ({ v: r.id, t: r.name }));
  const fields = (isNew) => [{ k: 'username', t: 'اسم المستخدم', req: 1, dir: 'ltr', readonly: !isNew, hide: false }, { k: 'name', t: 'الاسم' }, { k: 'role_id', t: 'الدور', type: 'select', options: roleOpts },
    { k: 'branch_id', t: 'الفرع', type: 'ref', ref: () => optsOf('branches') }, { k: 'password', t: isNew ? 'كلمة المرور (8 أحرف على الأقل)' : 'كلمة مرور جديدة (اتركها فارغة بلا تغيير)', type: 'password' }, { k: 'active', t: 'نشط', type: 'check', def: 1 }];
  const editU = (u) => {
    const f = formFor(fields(!u), u ? { ...u, password: '' } : { active: 1 });
    modal(u ? 'تعديل مستخدم' : 'مستخدم جديد', f.el, [{ t: 'حفظ', kind: 'pri', fn: async (c) => { const d = f.get(); if (u) { if (!d.password) delete d.password; delete d.username; await PUT('/users/' + u.id, d); } else await POST('/users', d); toast('تم الحفظ'); c(); MZ.wins.users.refresh(); } }]);
  };
  const rolesPanel = await rolesView();
  return h('div', null, pageHead('المستخدمون والصلاحيات', ed ? btn('➕ مستخدم جديد', () => editU(null), 'pri') : null),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'المستخدمون'), table([{ t: 'المستخدم', k: 'username' }, { t: 'الاسم', k: 'name' }, { t: 'الدور', k: 'role_name' }, { t: 'الفرع', f: u => nameOf('branches', u.branch_id) }, { t: 'الحالة', f: u => u.active ? h('span', { class: 'tag ok' }, 'نشط') : h('span', { class: 'tag bad' }, 'موقوف') },
      { t: '', f: u => ed ? h('span', null, btn('تعديل', () => editU(u)), ' ', u.id !== MZ.user.id ? btn('حذف', async () => { if (await confirmBox('حذف المستخدم ' + u.username + '؟')) { await DEL('/users/' + u.id); MZ.wins.users.refresh(); } }) : '') : '' }], users)),
    rolesPanel);
};
async function rolesView() {
  const roles = await GET('/roles'); const ed = can('users:edit');
  const mods = Object.entries(MZ.modules);
  const panel = h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الأدوار وصلاحياتها', ed ? btn('➕ دور جديد', () => editRole(null)) : null));
  const editRole = (r) => {
    const name = h('input', { class: 'inp', value: r ? r.name : '', placeholder: 'اسم الدور' });
    const has = (p) => r && (r.perms.includes('*') || r.perms.includes(p));
    const checks = {};
    const tb = h('table', { class: 'grid perm-grid' }, h('thead', null, h('tr', null, h('th', null, 'الوحدة'), h('th', null, 'عرض'), h('th', null, 'تعديل'))),
      h('tbody', null, mods.map(([k, t]) => { const v = h('input', { type: 'checkbox', class: 'chk' }), e = h('input', { type: 'checkbox', class: 'chk' }); v.checked = has(k + ':view') || has(k + ':edit'); e.checked = has(k + ':edit'); checks[k] = [v, e]; e.onchange = () => { if (e.checked) v.checked = true; }; return h('tr', null, h('td', null, t), h('td', null, v), h('td', null, e)); })));
    modal(r ? 'تعديل دور' : 'دور جديد', h('div', null, name, tb), [{ t: 'حفظ', kind: 'pri', fn: async (c) => { const perms = []; mods.forEach(([k]) => { if (checks[k][1].checked) perms.push(k + ':edit'); else if (checks[k][0].checked) perms.push(k + ':view'); }); const b = { name: name.value, perms }; r ? await PUT('/roles/' + r.id, b) : await POST('/roles', b); c(); toast('تم الحفظ'); MZ.wins.users.refresh(); } }]);
  };
  panel.append(table([{ t: 'الدور', k: 'name' }, { t: 'الصلاحيات', f: r => r.perms.includes('*') ? h('span', { class: 'tag ok' }, 'كامل الصلاحيات') : r.perms.length + ' صلاحية' }, { t: '', f: r => ed && !r.perms.includes('*') ? h('span', null, btn('تعديل', () => editRole(r)), ' ', btn('حذف', async () => { if (await confirmBox('حذف الدور؟')) { await DEL('/roles/' + r.id); MZ.wins.users.refresh(); } })) : '' }], roles));
  return panel;
}

MZ.pages.audit = async () => {
  const rows = await GET('/audit');
  return h('div', null, pageHead('سجل المراجعة'), h('div', { class: 'panel' }, table([{ t: 'الوقت', k: 'ts' }, { t: 'المستخدم', k: 'username' }, { t: 'العملية', k: 'action' }, { t: 'الكيان', k: 'entity' }, { t: 'المعرف', k: 'entity_id' }, { t: 'التفاصيل', f: r => (r.detail || '').slice(0, 120) }], rows)));
};

MZ.pages.settings = async () => {
  const s = await GET('/settings'); await load('accounts', true);
  const ed = can('settings:edit');
  const accOpt = () => optsOf('accounts', a => !a.is_group, accLabel);
  const gen = [{ k: 'company_name', t: 'اسم الشركة' }, { k: 'company_phone', t: 'هاتف الشركة', dir: 'ltr' }, { k: 'company_address', t: 'العنوان' }, { k: 'tax_no', t: 'الرقم الضريبي', dir: 'ltr' },
    { k: 'currency', t: 'العملة' }, { k: 'invoice_footer', t: 'تذييل الفاتورة', full: 1 }];
  const ctl = [{ k: 'lock_date', t: 'قفل الفترة حتى تاريخ (لا يسمح بالتسجيل قبله)', type: 'date' }, { k: 'approval_limit', t: 'حد الاعتماد: فواتير بقيمة تساوي أو تزيد تحتاج اعتماداً (0 = معطل)', type: 'number' },
    { k: 'allow_negative', t: 'السماح بالبيع بالسالب (رصيد مخزني)', type: 'select', options: [{ v: '0', t: 'لا' }, { v: '1', t: 'نعم' }] }];
  const maps = [['acc_cash', 'الصندوق'], ['acc_bank', 'البنك'], ['acc_ar', 'العملاء'], ['acc_ap', 'الموردون'], ['acc_inv', 'المخزون'], ['acc_sales', 'المبيعات'], ['acc_sales_ret', 'مردودات المبيعات'], ['acc_cogs', 'تكلفة البضاعة المباعة'],
    ['acc_disc', 'خصم مسموح به'], ['acc_tax_in', 'ضريبة مدخلات'], ['acc_tax_out', 'ضريبة مخرجات'], ['acc_exp', 'مصروفات المشتريات الخدمية'], ['acc_adjust', 'فروق الجرد'], ['acc_salary', 'مصروف الرواتب'], ['acc_sal_pay', 'رواتب مستحقة'], ['acc_ded_pay', 'استقطاعات مستحقة'],
    ['acc_dep_exp', 'مصروف الإهلاك'], ['acc_accum', 'مجمع الإهلاك'], ['acc_opening', 'أرصدة افتتاحية']].map(([k, t]) => ({ k, t, type: 'ref', ref: accOpt }));
  const init = { ...s, allow_negative: s.allow_negative || '0' };
  maps.forEach(m => { init[m.k] = +s[m.k] || ''; });
  const f1 = formFor(gen, s), f2 = formFor(ctl, init), f3 = formFor(maps, init);
  const save = async () => { const d = { ...f1.get(), ...f2.get(), ...f3.get() }; Object.keys(d).forEach(k => { if (d[k] === null) d[k] = ''; }); await PUT('/settings', d); Object.assign(MZ.settings, d); toast('تم حفظ الإعدادات'); };
  const pw = () => { const o = mkField({ type: 'password' }), n = mkField({ type: 'password' }); modal('تغيير كلمة مروري', h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, h('span', null, 'كلمة المرور الحالية'), o.el), h('label', { class: 'fld' }, h('span', null, 'كلمة المرور الجديدة (8 أحرف على الأقل)'), n.el)), [{ t: 'تغيير', kind: 'pri', fn: async (c) => { await POST('/password', { old: o.get(), password: n.get() }); toast('تم تغيير كلمة المرور'); c(); } }]); };
  return h('div', null, pageHead('الإعدادات', btn('تغيير كلمة مروري', pw), ed ? btn('💾 حفظ', save, 'pri') : null),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'بيانات الشركة'), h('div', { class: 'pb' }, f1.el)),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الضوابط'), h('div', { class: 'pb' }, f2.el)),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'ربط الحسابات الافتراضية (تستخدم في الترحيل التلقائي)'), h('div', { class: 'pb' }, f3.el)));
};
