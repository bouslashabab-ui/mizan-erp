'use strict';
const http = require('http');
const C = require('./core');
const TR = require('./trade');
const R = require('./reports');
const EXT = require('./ext');
const { bad, money, isDate, HttpError } = C;
const Q = async (sql, p) => (await C.db().query(sql, p))[0];

// generic tables: module for permission + writable columns
const TABLES = {
  branches: ['settings', ['code', 'name', 'address', 'phone', 'active']],
  cost_centers: ['accounts', ['code', 'name', 'parent_id', 'active']],
  accounts: ['accounts', ['code', 'name', 'name_en', 'parent_id', 'type', 'is_group', 'cc_required', 'active', 'notes']],
  parties: ['parties', ['type', 'code', 'name', 'phone', 'email', 'address', 'tax_no', 'credit_limit', 'rep_id', 'active', 'notes']],
  item_groups: ['items', ['code', 'name', 'parent_id']],
  items: ['items', ['code', 'name', 'name_en', 'group_id', 'kind', 'unit', 'barcode', 'sale_price', 'min_qty', 'tax_rate', 'active', 'notes']],
  item_units: ['items', ['item_id', 'unit', 'factor', 'price', 'barcode']],
  warehouses: ['warehouses', ['code', 'name', 'parent_id', 'branch_id', 'active']],
  employees: ['hr', ['code', 'name', 'job', 'department', 'branch_id', 'hire_date', 'phone', 'salary', 'allowances', 'deductions', 'active']],
  assets: ['assets', ['code', 'name', 'category', 'branch_id', 'buy_date', 'cost', 'salvage', 'life_years', 'status']],
  budgets: ['budgets', ['account_id', 'year', 'month', 'amount']],
  leads: ['crm', ['name', 'company', 'phone', 'email', 'source', 'stage', 'value', 'owner_id', 'notes', 'next_action']],
  boms: ['mfg', ['item_id', 'name', 'qty']],
  bom_lines: ['mfg', ['bom_id', 'item_id', 'qty']],
  maint_orders: ['misc', ['title', 'asset_id', 'requester', 'priority', 'status', 'cost', 'opened', 'closed', 'notes']],
  estate_units: ['misc', ['code', 'name', 'kind', 'address', 'area', 'rent', 'tenant', 'tenant_phone', 'lease_start', 'lease_end', 'status']],
  students: ['misc', ['code', 'name', 'phone', 'course', 'fees', 'paid', 'start_date', 'status', 'notes']],
  archive_docs: ['misc', ['title', 'category', 'doc_date', 'ref_no', 'link', 'notes']]
};
const FILTERABLE = ['parent_id', 'type', 'item_id', 'account_id', 'year', 'group_id', 'bom_id', 'stage', 'status', 'branch_id'];
const MODULE_LABELS = { accounts: 'الحسابات', journal: 'القيود', parties: 'العملاء والموردين', items: 'الأصناف', warehouses: 'المخازن', sales: 'المبيعات', purchases: 'المشتريات', vouchers: 'السندات والخزينة', reports: 'التقارير', hr: 'الموارد البشرية', assets: 'الأصول الثابتة', settings: 'الإعدادات', users: 'المستخدمون', audit: 'سجل المراجعة', approve: 'الاعتمادات', crm: 'علاقات العملاء', budgets: 'الموازنات', mfg: 'التصنيع', misc: 'وحدات أخرى' };

const DEFAULT_CHART = [
  ['1', 'الأصول', 'asset', null, 1], ['11', 'الأصول المتداولة', 'asset', '1', 1], ['1101', 'الصندوق', 'asset', '11', 0], ['1102', 'البنك', 'asset', '11', 0],
  ['1103', 'العملاء', 'asset', '11', 0], ['1104', 'المخزون', 'asset', '11', 0], ['1105', 'ضريبة القيمة المضافة - مدخلات', 'asset', '11', 0],
  ['12', 'الأصول الثابتة', 'asset', '1', 1], ['1201', 'الأصول الثابتة', 'asset', '12', 0], ['1202', 'مجمع الإهلاك', 'asset', '12', 0],
  ['2', 'الخصوم', 'liability', null, 1], ['21', 'الخصوم المتداولة', 'liability', '2', 1], ['2101', 'الموردون', 'liability', '21', 0], ['2102', 'رواتب مستحقة', 'liability', '21', 0],
  ['2103', 'ضريبة القيمة المضافة - مخرجات', 'liability', '21', 0], ['2104', 'استقطاعات مستحقة', 'liability', '21', 0],
  ['3', 'حقوق الملكية', 'equity', null, 1], ['3101', 'رأس المال', 'equity', '3', 0], ['3102', 'الأرباح المحتجزة', 'equity', '3', 0], ['3103', 'أرصدة افتتاحية', 'equity', '3', 0],
  ['4', 'الإيرادات', 'revenue', null, 1], ['4101', 'المبيعات', 'revenue', '4', 0], ['4102', 'مردودات المبيعات', 'revenue', '4', 0], ['4103', 'إيرادات أخرى', 'revenue', '4', 0],
  ['5', 'المصروفات', 'expense', null, 1], ['5101', 'تكلفة البضاعة المباعة', 'expense', '5', 0], ['5102', 'الرواتب والأجور', 'expense', '5', 0], ['5103', 'الإيجارات', 'expense', '5', 0],
  ['5104', 'الكهرباء والمياه', 'expense', '5', 0], ['5105', 'مصروف الإهلاك', 'expense', '5', 0], ['5106', 'مصروفات عمومية وإدارية', 'expense', '5', 0],
  ['5107', 'خصم مسموح به', 'expense', '5', 0], ['5108', 'فروق جرد المخزون', 'expense', '5', 0]
];
const DEFAULT_MAP = { acc_cash: '1101', acc_bank: '1102', acc_ar: '1103', acc_inv: '1104', acc_tax_in: '1105', acc_ap: '2101', acc_sal_pay: '2102', acc_tax_out: '2103', acc_ded_pay: '2104',
  acc_sales: '4101', acc_sales_ret: '4102', acc_cogs: '5101', acc_salary: '5102', acc_dep_exp: '5105', acc_accum: '1202', acc_disc: '5107', acc_adjust: '5108', acc_exp: '5106', acc_opening: '3103' };
const ALL_MODS = Object.keys(MODULE_LABELS);
const roleSet = (mods, edit) => JSON.stringify([...mods.map(m => m + ':view'), ...edit.map(m => m + ':edit')]);
const DEFAULT_ROLES = [
  ['مدير النظام', JSON.stringify(['*'])],
  ['محاسب', roleSet(['accounts', 'journal', 'parties', 'items', 'warehouses', 'sales', 'purchases', 'vouchers', 'reports', 'assets', 'budgets', 'hr'], ['accounts', 'journal', 'vouchers', 'assets', 'budgets', 'parties'])],
  ['مبيعات', roleSet(['parties', 'items', 'sales', 'reports', 'crm'], ['sales', 'parties', 'crm'])],
  ['مشتريات', roleSet(['parties', 'items', 'purchases', 'reports'], ['purchases', 'parties'])],
  ['أمين مخزن', roleSet(['items', 'warehouses', 'reports', 'mfg'], ['items', 'warehouses', 'mfg'])],
  ['موارد بشرية', roleSet(['hr', 'reports'], ['hr'])],
  ['مشاهد', roleSet(['accounts', 'journal', 'parties', 'items', 'warehouses', 'sales', 'purchases', 'vouchers', 'reports', 'hr', 'assets', 'budgets', 'crm'], [])]
];

async function setup(b) {
  const [u] = await C.db().query('SELECT COUNT(*) c FROM users');
  if (u[0].c > 0) throw new HttpError(403, 'تم إعداد النظام من قبل');
  const username = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw bad('اسم المستخدم: حروف إنجليزية وأرقام (3 على الأقل)');
  if (pw.length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
  await C.tx(async (conn) => {
    for (const r of DEFAULT_ROLES) await conn.query('INSERT IGNORE INTO roles(name,perms) VALUES(?,?)', r);
    const idByCode = {};
    for (const a of DEFAULT_CHART) {
      const [r] = await conn.query('INSERT INTO accounts(code,name,type,parent_id,is_group) VALUES(?,?,?,?,?)', [a[0], a[1], a[2], a[3] ? idByCode[a[3]] : null, a[4]]);
      idByCode[a[0]] = r.insertId;
    }
    for (const k of Object.keys(DEFAULT_MAP)) await conn.query('INSERT INTO settings(k,v) VALUES(?,?)', [k, idByCode[DEFAULT_MAP[k]]]);
    const set = { company_name: String(b.company || 'شركتي'), currency: 'ج.م', approval_limit: '0', lock_date: '', allow_negative: '0', invoice_footer: 'شكراً لتعاملكم معنا' };
    for (const k of Object.keys(set)) await conn.query('INSERT INTO settings(k,v) VALUES(?,?)', [k, set[k]]);
    const [br] = await conn.query("INSERT INTO branches(code,name) VALUES('01','الفرع الرئيسي')");
    await conn.query("INSERT INTO warehouses(code,name,branch_id) VALUES('01','المخزن الرئيسي',?)", [br.insertId]);
    await conn.query("INSERT INTO cost_centers(code,name) VALUES('01','المركز الرئيسي')");
    await conn.query("INSERT INTO item_groups(code,name) VALUES('01','أصناف عامة')");
    const [role] = await conn.query("SELECT id FROM roles WHERE name='مدير النظام'");
    await conn.query('INSERT INTO users(username,name,pass_hash,role_id,branch_id) VALUES(?,?,?,?,?)', [username, String(b.name || 'مدير النظام'), C.hashPw(pw), role[0].id, br.insertId]);
  });
  await C.audit({ username }, 'setup', 'system', 0, 'first-run setup');
}

const attempts = new Map();
function throttle(key) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter(t => now - t < 600000);
  if (a.length >= 8) throw new HttpError(429, 'محاولات كثيرة، حاول بعد 10 دقائق');
  a.push(now); attempts.set(key, a);
}

async function login(b, ip) {
  const username = String(b.username || '').trim().toLowerCase();
  throttle(ip + '|' + username);
  const [r] = await C.db().query('SELECT u.*, r.perms, r.name role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.username=?', [username]);
  const u = r[0];
  if (!u || !u.active || !C.checkPw(String(b.password || ''), u.pass_hash)) throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  attempts.delete(ip + '|' + username);
  await C.audit({ id: u.id, username }, 'login', 'user', u.id);
  return { token: C.sign({ uid: u.id, exp: Date.now() + 12 * 3600 * 1000 }), user: pub(u) };
}
const pub = (u) => ({ id: u.id, username: u.username, name: u.name, role_id: u.role_id, role_name: u.role_name, branch_id: u.branch_id, perms: JSON.parse(u.perms || '[]') });

async function auth(req) {
  const h = req.headers.authorization || '';
  const p = C.verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!p) throw new HttpError(401, 'انتهت الجلسة، سجل الدخول من جديد');
  const [r] = await C.db().query('SELECT u.*, r.perms, r.name role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?', [p.uid]);
  if (!r[0] || !r[0].active) throw new HttpError(401, 'الحساب غير نشط');
  return { ...pub(r[0]), raw: r[0] };
}
const need = (u, perm) => { if (!C.can(u, perm)) throw new HttpError(403, 'ليست لديك صلاحية: ' + (MODULE_LABELS[perm.split(':')[0]] || perm)); };

function pick(body, cols) {
  const o = {};
  for (const c of cols) if (body[c] !== undefined) o[c] = (body[c] === '' ? null : body[c]);
  return o;
}

async function generic(req, u, name, id, body, query) {
  const [mod, cols] = TABLES[name];
  const m = req.method;
  if (m === 'GET') {
    need(u, mod + ':view');
    const w = [], p = [];
    for (const f of FILTERABLE) if (query[f] !== undefined && cols.concat(['id']).includes(f)) { w.push(f + '=?'); p.push(query[f]); }
    if (query.q) { const nc = cols.filter(c => ['name', 'code', 'title', 'barcode', 'phone'].includes(c)); if (nc.length) { w.push('(' + nc.map(c => c + ' LIKE ?').join(' OR ') + ')'); nc.forEach(() => p.push('%' + query.q + '%')); } }
    let sql = 'SELECT * FROM ' + name + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY ' + (cols.includes('code') ? 'code,' : '') + 'id LIMIT 5000';
    if (name === 'items') {
      sql = `SELECT t.*, COALESCE((SELECT SUM(qty) FROM stock_moves WHERE item_id=t.id),0) qty FROM items t` + (w.length ? ' WHERE ' + w.join(' AND ').replace(/(^|[ (])(group_id|code|name|barcode|phone|id|kind)/g, '$1t.$2') : '') + ' ORDER BY t.code,t.id LIMIT 5000';
    }
    if (id) { const r = await Q('SELECT * FROM ' + name + ' WHERE id=?', [id]); if (!r[0]) throw new HttpError(404, 'غير موجود'); return r[0]; }
    return Q(sql, p);
  }
  need(u, mod + ':edit');
  if (m === 'POST' || m === 'PUT') {
    const d = pick(body, cols);
    if (name === 'accounts') await accountChecks(d, id);
    if (name === 'parties' && m === 'POST' && !['customer', 'supplier'].includes(d.type)) throw bad('نوع الطرف غير صحيح');
    if (name === 'items' && d.kind && !['stock', 'service'].includes(d.kind)) throw bad('نوع الصنف غير صحيح');
    if (['item_groups', 'cost_centers', 'warehouses', 'accounts'].includes(name) && d.parent_id && id && +d.parent_id === +id) throw bad('لا يمكن أن يكون الفرع أباً لنفسه');
    const keys = Object.keys(d);
    if (!keys.length) throw bad('لا توجد بيانات');
    if (m === 'POST') {
      if (name === 'budgets') {
        await C.db().query('INSERT INTO budgets(account_id,year,month,amount) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)', [d.account_id, d.year, d.month, d.amount]);
        return { ok: true };
      }
      const [r] = await C.db().query('INSERT INTO ' + name + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')', keys.map(k => d[k]));
      await C.audit(u, 'create', name, r.insertId, JSON.stringify(d));
      return { id: r.insertId };
    }
    await C.db().query('UPDATE ' + name + ' SET ' + keys.map(k => k + '=?').join(',') + ' WHERE id=?', [...keys.map(k => d[k]), id]);
    await C.audit(u, 'update', name, id, JSON.stringify(d));
    return { ok: true };
  }
  if (m === 'DELETE') {
    await deleteChecks(name, id);
    await C.db().query('DELETE FROM ' + name + ' WHERE id=?', [id]);
    if (name === 'items') { await C.db().query('DELETE FROM item_units WHERE item_id=?', [id]); }
    if (name === 'boms') await C.db().query('DELETE FROM bom_lines WHERE bom_id=?', [id]);
    await C.audit(u, 'delete', name, id);
    return { ok: true };
  }
  throw new HttpError(405, 'طريقة غير مدعومة');
}
async function accountChecks(d, id) {
  if (d.type && !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(d.type)) throw bad('نوع الحساب غير صحيح');
  if (d.parent_id) {
    const p = await Q('SELECT is_group,type FROM accounts WHERE id=?', [d.parent_id]);
    if (!p[0] || !p[0].is_group) throw bad('الحساب الأب يجب أن يكون حساباً رئيسياً');
    if (d.type && p[0].type !== d.type) throw bad('نوع الحساب يجب أن يطابق نوع الحساب الأب');
  }
  if (id && d.is_group === 0 || (id && d.is_group === '0')) {
    const n = await Q('SELECT COUNT(*) c FROM accounts WHERE parent_id=?', [id]); if (n[0].c) throw bad('الحساب له حسابات فرعية');
  }
  if (id && (d.is_group === 1 || d.is_group === '1')) {
    const n = await Q('SELECT COUNT(*) c FROM journal_lines WHERE account_id=?', [id]); if (n[0].c) throw bad('الحساب عليه حركة ولا يمكن جعله رئيسياً');
  }
}
async function deleteChecks(name, id) {
  const chk = async (sql, msg) => { const r = await Q(sql, [id]); if (r[0].c) throw bad(msg); };
  if (name === 'accounts') {
    await chk('SELECT COUNT(*) c FROM accounts WHERE parent_id=?', 'الحساب له حسابات فرعية');
    await chk('SELECT COUNT(*) c FROM journal_lines WHERE account_id=?', 'الحساب عليه حركة، أوقفه بدلاً من حذفه');
    await chk("SELECT COUNT(*) c FROM settings WHERE k LIKE 'acc\\_%' AND v=CAST(? AS CHAR)", 'الحساب مستخدم في ربط الحسابات الافتراضي');
  }
  if (name === 'parties') { await chk('SELECT COUNT(*) c FROM invoices WHERE party_id=?', 'الطرف عليه فواتير'); await chk('SELECT COUNT(*) c FROM journal_lines WHERE party_id=?', 'الطرف عليه حركة'); }
  if (name === 'items') { await chk('SELECT COUNT(*) c FROM invoice_lines WHERE item_id=?', 'الصنف مستخدم في فواتير'); await chk('SELECT COUNT(*) c FROM stock_moves WHERE item_id=?', 'الصنف عليه حركة مخزنية'); }
  if (name === 'item_groups') { await chk('SELECT COUNT(*) c FROM items WHERE group_id=?', 'المجموعة بها أصناف'); await chk('SELECT COUNT(*) c FROM item_groups WHERE parent_id=?', 'المجموعة لها فروع'); }
  if (name === 'warehouses') { await chk('SELECT COUNT(*) c FROM stock_moves WHERE warehouse_id=?', 'المخزن عليه حركة'); await chk('SELECT COUNT(*) c FROM warehouses WHERE parent_id=?', 'المخزن له فروع'); }
  if (name === 'branches') { await chk('SELECT COUNT(*) c FROM journal_entries WHERE branch_id=?', 'الفرع عليه حركة'); }
  if (name === 'cost_centers') { await chk('SELECT COUNT(*) c FROM journal_lines WHERE cost_center_id=?', 'مركز التكلفة عليه حركة'); await chk('SELECT COUNT(*) c FROM cost_centers WHERE parent_id=?', 'المركز له فروع'); }
  if (name === 'employees') { await chk('SELECT COUNT(*) c FROM payroll_lines WHERE employee_id=?', 'الموظف عليه رواتب'); }
}

async function journalApi(req, u, id, body, query) {
  const m = req.method;
  if (m === 'GET') {
    need(u, 'journal:view');
    if (id) {
      const e = await Q('SELECT * FROM journal_entries WHERE id=?', [id]);
      if (!e[0]) throw new HttpError(404, 'غير موجود');
      e[0].lines = await Q('SELECT l.*, a.code account_code, a.name account_name FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=? ORDER BY l.id', [id]);
      return e[0];
    }
    const w = [], p = [];
    if (isDate(query.from)) { w.push('e.date>=?'); p.push(query.from); }
    if (isDate(query.to)) { w.push('e.date<=?'); p.push(query.to); }
    if (query.type) { w.push('e.type=?'); p.push(query.type); }
    if (query.q) { w.push('(e.number LIKE ? OR e.description LIKE ?)'); p.push('%' + query.q + '%', '%' + query.q + '%'); }
    return Q('SELECT e.*, (SELECT SUM(debit) FROM journal_lines WHERE entry_id=e.id) total FROM journal_entries e' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY e.date DESC,e.id DESC LIMIT 500', p);
  }
  need(u, 'journal:edit');
  if (m === 'POST') {
    const r = await C.tx(async (conn) => {
      const je = await C.postEntry(conn, { type: 'JV', date: body.date, branch_id: body.branch_id || u.branch_id, description: body.description, lines: body.lines, user: u });
      await C.audit(u, 'create', 'journal', je.id, je.number, conn); return je;
    });
    return r;
  }
  const [e] = await C.db().query('SELECT * FROM journal_entries WHERE id=?', [id]);
  if (!e[0]) throw new HttpError(404, 'غير موجود');
  if (e[0].type !== 'JV') throw bad('هذا القيد ناتج عن مستند، عدّل أو احذف المستند نفسه');
  if (m === 'PUT') {
    return C.tx(async (conn) => {
      await C.removeEntry(conn, id);
      const je = await C.postEntry(conn, { type: 'JV', date: body.date, branch_id: body.branch_id || e[0].branch_id, description: body.description, lines: body.lines, user: u });
      await C.audit(u, 'update', 'journal', je.id, 'was ' + e[0].number, conn); return je;
    });
  }
  if (m === 'DELETE') { await C.tx(async (conn) => { await C.removeEntry(conn, id); await C.audit(u, 'delete', 'journal', id, e[0].number, conn); }); return { ok: true }; }
}

async function invoicesApi(req, u, id, action, body, query) {
  const m = req.method;
  if (m === 'GET') {
    const type = id ? (await Q('SELECT type FROM invoices WHERE id=?', [id]))[0] : null;
    const mod = (type ? type.type : (query.type || 'sale')).startsWith('purchase') ? 'purchases' : 'sales';
    need(u, mod + ':view');
    if (id) {
      const r = await Q('SELECT v.*, p.name party_name, w.name warehouse_name FROM invoices v LEFT JOIN parties p ON p.id=v.party_id LEFT JOIN warehouses w ON w.id=v.warehouse_id WHERE v.id=?', [id]);
      if (!r[0]) throw new HttpError(404, 'غير موجود');
      r[0].lines = await Q('SELECT l.*, i.name item_name, i.code item_code FROM invoice_lines l JOIN items i ON i.id=l.item_id WHERE l.invoice_id=? ORDER BY l.id', [id]);
      return r[0];
    }
    const w = [], p = [];
    if (query.type) { w.push('v.type IN (?)'); p.push(query.type.split(',')); }
    if (query.status) { w.push('v.status=?'); p.push(query.status); }
    if (isDate(query.from)) { w.push('v.date>=?'); p.push(query.from); }
    if (isDate(query.to)) { w.push('v.date<=?'); p.push(query.to); }
    if (query.party_id) { w.push('v.party_id=?'); p.push(+query.party_id); }
    if (query.q) { w.push('(v.number LIKE ? OR pp.name LIKE ?)'); p.push('%' + query.q + '%', '%' + query.q + '%'); }
    return Q('SELECT v.id,v.type,v.number,v.date,v.total,v.paid,v.status,v.party_id,pp.name party_name FROM invoices v LEFT JOIN parties pp ON pp.id=v.party_id' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY v.date DESC,v.id DESC LIMIT 500', p);
  }
  if (m === 'POST' && !id) {
    const T = TR.TYPES[body.type]; if (!T) throw bad('نوع غير صحيح');
    need(u, T.mod + ':edit');
    return TR.createInvoice(u, body, u.perms);
  }
  if (m === 'POST' && id && action) {
    const row = (await Q('SELECT type FROM invoices WHERE id=?', [id]))[0];
    if (!row) throw new HttpError(404, 'غير موجود');
    const mod = row.type.startsWith('purchase') ? 'purchases' : 'sales';
    if (action === 'approve') { need(u, 'approve:edit'); await TR.approveInvoice(u, id); return { ok: true }; }
    if (action === 'reject') { need(u, 'approve:edit'); await TR.rejectInvoice(u, id); return { ok: true }; }
    need(u, mod + ':edit');
    if (action === 'cancel') { await TR.cancelInvoice(u, id); return { ok: true }; }
    if (action === 'convert') return TR.convertInvoice(u, id, body.to, u.perms);
  }
  throw new HttpError(405, 'غير مدعوم');
}

async function route(req, url, body) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const q = Object.fromEntries(url.searchParams);
  const m = req.method;
  const head = parts[0];
  if (head === 'health') return { ok: true, t: Date.now() };
  if (head === 'status') { const [r] = await C.db().query('SELECT COUNT(*) c FROM users'); return { setup_needed: r[0].c === 0 }; }
  if (head === 'setup' && m === 'POST') { await setup(body); return { ok: true }; }
  if (head === 'login' && m === 'POST') return login(body, req.socket.remoteAddress || 'ip');
  const u = await auth(req);
  const id = parts[1] && /^\d+$/.test(parts[1]) ? +parts[1] : null;
  if (head === 'me') return { user: { id: u.id, username: u.username, name: u.name, role_name: u.role_name, branch_id: u.branch_id, perms: u.perms }, settings: await C.getSettings(), modules: MODULE_LABELS };
  if (head === 'password' && m === 'POST') {
    if (!C.checkPw(String(body.old || ''), u.raw.pass_hash)) throw bad('كلمة المرور الحالية غير صحيحة');
    if (String(body.password || '').length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
    await C.db().query('UPDATE users SET pass_hash=? WHERE id=?', [C.hashPw(body.password), u.id]); await C.audit(u, 'password', 'user', u.id); return { ok: true };
  }
  if (head === 'settings') {
    if (m === 'GET') return C.getSettings();
    need(u, 'settings:edit');
    for (const k of Object.keys(body)) if (/^[a-z_]{2,40}$/.test(k)) await C.db().query('INSERT INTO settings(k,v) VALUES(?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, String(body[k] ?? '')]);
    await C.audit(u, 'update', 'settings', 0, Object.keys(body).join(','));
    return { ok: true };
  }
  if (head === 'roles') {
    if (m === 'GET') { need(u, 'users:view'); return (await Q('SELECT * FROM roles ORDER BY id')).map(r => ({ ...r, perms: JSON.parse(r.perms) })); }
    need(u, 'users:edit');
    const perms = JSON.stringify(Array.isArray(body.perms) ? body.perms.filter(x => typeof x === 'string') : []);
    if (m === 'POST') { const [r] = await C.db().query('INSERT INTO roles(name,perms) VALUES(?,?)', [(String(body.name || '').trim() || (() => { throw bad('اسم الدور مطلوب'); })()), perms]); await C.audit(u, 'create', 'role', r.insertId); return { id: r.insertId }; }
    if (m === 'PUT' && id) { const r0 = (await Q('SELECT name FROM roles WHERE id=?', [id]))[0]; if (r0 && r0.name === 'مدير النظام') throw bad('لا يمكن تعديل صلاحيات مدير النظام'); await C.db().query('UPDATE roles SET name=?, perms=? WHERE id=?', [body.name, perms, id]); await C.audit(u, 'update', 'role', id); return { ok: true }; }
    if (m === 'DELETE' && id) { const c = await Q('SELECT COUNT(*) c FROM users WHERE role_id=?', [id]); if (c[0].c) throw bad('الدور مستخدم'); await C.db().query('DELETE FROM roles WHERE id=?', [id]); return { ok: true }; }
  }
  if (head === 'users') {
    if (m === 'GET') { need(u, 'users:view'); return Q('SELECT u.id,u.username,u.name,u.role_id,u.branch_id,u.active,u.created_at,r.name role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY u.id'); }
    need(u, 'users:edit');
    if (m === 'POST') {
      const un = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,40}$/.test(un)) throw bad('اسم المستخدم غير صحيح');
      if (String(body.password || '').length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
      const [r] = await C.db().query('INSERT INTO users(username,name,pass_hash,role_id,branch_id) VALUES(?,?,?,?,?)', [un, body.name || un, C.hashPw(body.password), body.role_id || null, body.branch_id || null]);
      await C.audit(u, 'create', 'user', r.insertId, un); return { id: r.insertId };
    }
    if (m === 'PUT' && id) {
      const f = [], p = [];
      if (body.name !== undefined) { f.push('name=?'); p.push(body.name); }
      if (body.role_id !== undefined) { f.push('role_id=?'); p.push(body.role_id || null); }
      if (body.branch_id !== undefined) { f.push('branch_id=?'); p.push(body.branch_id || null); }
      if (body.active !== undefined) { if (id === u.id && !+body.active) throw bad('لا يمكنك إيقاف حسابك'); f.push('active=?'); p.push(+body.active ? 1 : 0); }
      if (body.password) { if (String(body.password).length < 8) throw bad('كلمة المرور 8 أحرف على الأقل'); f.push('pass_hash=?'); p.push(C.hashPw(body.password)); }
      if (f.length) await C.db().query('UPDATE users SET ' + f.join(',') + ' WHERE id=?', [...p, id]);
      await C.audit(u, 'update', 'user', id, Object.keys(body).filter(k => k !== 'password').join(',')); return { ok: true };
    }
    if (m === 'DELETE' && id) { if (id === u.id) throw bad('لا يمكنك حذف حسابك'); await C.db().query('DELETE FROM users WHERE id=?', [id]); await C.audit(u, 'delete', 'user', id); return { ok: true }; }
  }
  if (head === 'audit') { need(u, 'audit:view'); return Q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500'); }
  if (head === 'journal') return journalApi(req, u, id, body, q);
  if (head === 'invoices') return invoicesApi(req, u, id, parts[2], body, q);
  if (head === 'vouchers') {
    if (m === 'GET') {
      need(u, 'vouchers:view');
      if (id) { const r = await Q('SELECT v.*, a.name account_name, c.name counter_name, p.name party_name FROM vouchers v JOIN accounts a ON a.id=v.account_id JOIN accounts c ON c.id=v.counter_id LEFT JOIN parties p ON p.id=v.party_id WHERE v.id=?', [id]); return r[0]; }
      const w = [], p = [];
      if (q.type) { w.push('v.type=?'); p.push(q.type); }
      if (isDate(q.from)) { w.push('v.date>=?'); p.push(q.from); }
      if (isDate(q.to)) { w.push('v.date<=?'); p.push(q.to); }
      return Q('SELECT v.*, a.name account_name, c.name counter_name, p.name party_name FROM vouchers v JOIN accounts a ON a.id=v.account_id JOIN accounts c ON c.id=v.counter_id LEFT JOIN parties p ON p.id=v.party_id' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY v.date DESC,v.id DESC LIMIT 500', p);
    }
    need(u, 'vouchers:edit');
    if (m === 'POST') return TR.createVoucher(u, body);
    if (m === 'DELETE' && id) { await TR.deleteVoucher(u, id); return { ok: true }; }
  }
  if (head === 'stock') {
    if (parts[1] === 'adjust' && m === 'POST') { need(u, 'warehouses:edit'); return TR.stockAdjust(u, body); }
    if (parts[1] === 'transfer' && m === 'POST') { need(u, 'warehouses:edit'); return TR.stockTransfer(u, body); }
  }
  if (head === 'prod' && m === 'POST') { need(u, 'mfg:edit'); return TR.produce(u, body); }
  if (head === 'prod' && m === 'GET') { need(u, 'mfg:view'); return Q('SELECT p.*, i.name item_name FROM prod_orders p JOIN boms b ON b.id=p.bom_id JOIN items i ON i.id=b.item_id ORDER BY p.id DESC LIMIT 200'); }
  if (head === 'payroll') {
    if (m === 'GET') { need(u, 'hr:view'); if (id) return Q('SELECT l.*, e.name FROM payroll_lines l JOIN employees e ON e.id=l.employee_id WHERE l.run_id=?', [id]); return Q('SELECT * FROM payroll_runs ORDER BY month DESC'); }
    need(u, 'hr:edit');
    if (parts[1] === 'run') return TR.payrollRun(u, body.month);
    if (parts[1] === 'pay') return TR.payrollPay(u, body);
  }
  if (head === 'assets' && parts[1] === 'depreciate' && m === 'POST') { need(u, 'assets:edit'); return TR.depreciate(u, body.date); }
  if (head === 'reports') {
    need(u, 'reports:view');
    const k = parts[1];
    if (k === 'dashboard') return R.dashboard();
    if (k === 'trial') return R.trial(q);
    if (k === 'ledger') return R.ledger(q);
    if (k === 'customers') return R.partyBalances('customer');
    if (k === 'suppliers') return R.partyBalances('supplier');
    if (k === 'aging') return R.aging(q.type === 'supplier' ? 'supplier' : 'customer');
    if (k === 'stock') return R.stockBalance(q);
    if (k === 'stockcard') return R.stockCard(q);
    if (k === 'movement') return R.itemMovement(q);
    if (k === 'invoices') return R.invoiceReport(q);
    if (k === 'budget') return R.budgetReport(q);
  }
  { const ex = await EXT.handle(req, u, parts, id, body, q); if (ex !== undefined) return ex; }
  if (TABLES[head]) return generic(req, u, head, id, body, q);
  throw new HttpError(404, 'مسار غير موجود');
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Max-Age': '86400' };
let ready = false, startErr = null;

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/api/health') return send(200, { ok: true, ready, error: startErr ? String(startErr.message || startErr) : undefined });
  if (!ready) return send(503, { error: startErr ? 'تعذر الاتصال بقاعدة البيانات' : 'الخادم يبدأ التشغيل، حاول بعد لحظات' });
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
  req.on('end', async () => {
    try {
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch (e) { throw bad('بيانات غير صالحة'); } }
      const out = await route(req, url, body);
      send(200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (e instanceof HttpError) return send(e.code, { error: e.message });
      if (e && e.code === 'ER_DUP_ENTRY') return send(400, { error: 'قيمة مكررة: يوجد سجل بنفس الكود أو الاسم' });
      if (e && e.code === 'ER_DATA_TOO_LONG') return send(400, { error: 'قيمة أطول من المسموح في أحد الحقول' });
      if (e && (e.code === 'ER_TRUNCATED_WRONG_VALUE' || e.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || e.code === 'ER_WARN_DATA_OUT_OF_RANGE')) return send(400, { error: 'قيمة غير صالحة في أحد الحقول' });
      if (e && (e.code === 'ER_ROW_IS_REFERENCED_2' || e.code === 'ER_ROW_IS_REFERENCED')) return send(400, { error: 'لا يمكن الحذف: السجل مستخدم في مستندات أخرى' });
      if (e && e.code === 'ER_NO_REFERENCED_ROW_2') return send(400, { error: 'القيمة المختارة غير موجودة' });
      console.error(e);
      send(500, { error: 'خطأ في الخادم' });
    }
  });
});
server.listen(process.env.PORT || 8080, () => console.log('listening'));
C.initDb().then((n) => { ready = true; console.log('db ready', n); }).catch((e) => { startErr = e; console.error('db init failed', e.message); });
