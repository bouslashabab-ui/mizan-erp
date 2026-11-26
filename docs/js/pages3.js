'use strict';
/* Reports, HR, assets, budgets, CRM, manufacturing, misc, dashboard */
function reportPage(title, fields, fetcher, render, initial = {}, pre) {
  return async () => {
    if (pre) await pre();
    const out = h('div'); let last = null;
    const run = async (v) => { out.innerHTML = '<div class="loading">جاري التحميل...</div>'; try { const d = await fetcher(v); last = { d, v }; out.innerHTML = ''; out.append(render(d, v)); } catch (e) { out.innerHTML = ''; out.append(h('div', { class: 'err-box' }, e.message)); } };
    const bar = filterBar(fields, run, initial);
    const el = h('div', null, pageHead(title, btn('🖨 طباعة', () => printEl(title, h('div', null, companyHead(), h('h2', null, title), out.cloneNode(true))))), bar, out);
    if (!fields.some(f => f.must)) run(bar.values());
    return el;
  };
}
const dateFields = (from) => [{ k: 'from', t: 'من تاريخ', type: 'date', def: from || yearStart() }, { k: 'to', t: 'إلى تاريخ', type: 'date', def: today() }];
const tbRows = (a) => { const bal = a.opening + a.dr - a.cr; return bal; };
const sumTree = (rows) => { const byid = {}; rows.forEach(r => { byid[r.id] = { ...r, o: r.opening, d: r.dr, c: r.cr }; }); const ids = Object.keys(byid); rows.forEach(r => { let p = byid[r.parent_id]; while (p) { p.o += r.opening; p.d += r.dr; p.c += r.cr; p = byid[p.parent_id]; } }); return rows.map(r => byid[r.id]); };
// the loop above adds each row to ALL ancestors, but groups also carry their own sums from children; avoid double counting by only adding leaves
const rollup = (rows) => { const by = {}; rows.forEach(r => by[r.id] = { ...r, o: 0, d: 0, c: 0 }); rows.filter(r => !r.is_group).forEach(r => { let n = by[r.id]; while (n) { n.o += r.opening; n.d += r.dr; n.c += r.cr; n = by[n.parent_id]; } }); return rows.map(r => by[r.id]); };
const depthOf = (rows) => { const by = {}; rows.forEach(r => by[r.id] = r); return (r) => { let d = 0, p = by[r.parent_id]; while (p) { d++; p = by[p.parent_id]; } return d; }; };

MZ.pages.trial = reportPage('ميزان المراجعة', [...dateFields(), { k: 'level', t: 'المستوى', type: 'select', options: [{ v: '1', t: 'رئيسي فقط' }, { v: '2', t: 'حتى المستوى 2' }, { v: '3', t: 'حتى المستوى 3' }, { v: '9', t: 'كل الحسابات' }] }, { k: 'branch_id', t: 'الفرع', type: 'ref', ref: () => optsOf('branches') }, { k: 'zero', t: 'إخفاء الحسابات الصفرية', type: 'check', def: 1 }],
  (v) => GET('/reports/trial' + qs({ from: v.from, to: v.to, branch_id: v.branch_id })),
  (rows, v) => {
    const rr = rollup(rows); const dp = depthOf(rows); const lvl = +v.level || 9;
    const vis = rr.filter(r => dp(r) < lvl && (!v.zero || r.o || r.d || r.c));
    const cols = [{ t: 'الكود', k: 'code' }, { t: 'الحساب', f: r => h('span', { style: { paddingRight: dp(r) * 16 + 'px', fontWeight: r.is_group ? 700 : 400 } }, r.name), csv: r => r.name },
      { t: 'رصيد أول (مدين)', f: r => r.o > 0 ? fmt(r.o) : '', cls: 'num', csv: r => r.o > 0 ? r.o : '' }, { t: 'رصيد أول (دائن)', f: r => r.o < 0 ? fmt(-r.o) : '', cls: 'num', csv: r => r.o < 0 ? -r.o : '' },
      { t: 'حركة مدين', f: r => fmt(r.d), cls: 'num', csv: r => r.d }, { t: 'حركة دائن', f: r => fmt(r.c), cls: 'num', csv: r => r.c },
      { t: 'رصيد مدين', f: r => { const b = r.o + r.d - r.c; return b > 0 ? fmt(b) : ''; }, cls: 'num', csv: r => { const b = r.o + r.d - r.c; return b > 0 ? b : ''; } }, { t: 'رصيد دائن', f: r => { const b = r.o + r.d - r.c; return b < 0 ? fmt(-b) : ''; }, cls: 'num', csv: r => { const b = r.o + r.d - r.c; return b < 0 ? -b : ''; } }];
    const lf = rr.filter(r => !r.is_group); const S = (f) => lf.reduce((s, r) => s + f(r), 0);
    const bal = (r) => r.o + r.d - r.c;
    const foot = ['', 'الإجمالي', fmt(S(r => Math.max(r.o, 0))), fmt(S(r => Math.max(-r.o, 0))), fmt(S(r => r.d)), fmt(S(r => r.c)), fmt(S(r => Math.max(bal(r), 0))), fmt(S(r => Math.max(-bal(r), 0)))];
    return h('div', null, h('div', { class: 'panel' }, table(cols, vis, { foot, onrow: (r) => { if (!r.is_group) openWin('ledger-' + r.id, 'أستاذ ' + r.name, () => MZ.pages.ledger({ account_id: r.id, from: v.from, to: v.to })()); } })),
      btn('تصدير Excel', () => download('trial-balance.csv', csvOf(cols, vis))));
  }, { from: yearStart(), to: today(), zero: 1, level: '9' }, () => load('branches'));

MZ.pages.ledger = (pre = {}) => reportPage('كشف حساب (الأستاذ)', [...dateFields(pre.from), { k: 'account_id', t: 'الحساب', type: 'ref', ref: () => optsOf('accounts', null, accLabel), must: 1 }, { k: 'party_id', t: 'عميل/مورد', type: 'ref', ref: () => optsOf('parties', null, p => p.name + (p.type === 'customer' ? ' (عميل)' : ' (مورد)')) }, { k: 'cc_id', t: 'مركز التكلفة', type: 'ref', ref: () => optsOf('cost_centers') }],
  (v) => { if (!v.account_id && !v.party_id) throw new Error('اختر حساباً أو عميلاً/مورداً ثم اضغط عرض'); return GET('/reports/ledger' + qs(v)); },
  (d) => {
    const cols = [{ t: 'التاريخ', k: 'date' }, { t: 'الرقم', k: 'number' }, { t: 'الحساب', k: 'account_name' }, { t: 'البيان', k: 'description' }, { t: 'مدين', k: 'debit', f: r => r.debit ? fmt(r.debit) : '', cls: 'num', csv: r => r.debit }, { t: 'دائن', k: 'credit', f: r => r.credit ? fmt(r.credit) : '', cls: 'num', csv: r => r.credit }, { t: 'الرصيد', f: r => fmt(r.balance) + (r.balance >= 0 ? ' م' : ' د'), cls: 'num', csv: r => r.balance }];
    return h('div', null, h('p', null, h('b', null, 'رصيد أول المدة: ' + fmt(d.opening) + (d.opening >= 0 ? ' مدين' : ' دائن'))), h('div', { class: 'panel' }, table(cols, d.rows, { foot: ['', '', '', 'الرصيد الختامي', fmt(d.rows.reduce((s, r) => s + r.debit, 0)), fmt(d.rows.reduce((s, r) => s + r.credit, 0)), fmt(d.closing)] })), btn('تصدير Excel', () => download('ledger.csv', csvOf(cols, d.rows))));
  }, { account_id: pre.account_id, from: pre.from || yearStart(), to: pre.to || today() }, () => Promise.all([load('accounts'), load('parties'), load('cost_centers')]));
const statementPage = (type) => () => MZ.pages.ledger({ })().then(el => el);
MZ.pages.statement_c = reportPage('كشف حساب عميل', [...dateFields(), { k: 'party_id', t: 'العميل', type: 'ref', ref: () => optsOf('parties', p => p.type === 'customer'), must: 1 }],
  (v) => { if (!v.party_id) throw new Error('اختر العميل ثم اضغط عرض'); return GET('/reports/ledger' + qs({ ...v, account_id: MZ.settings.acc_ar })); }, partyStmt, {}, () => load('parties'));
MZ.pages.statement_s = reportPage('كشف حساب مورد', [...dateFields(), { k: 'party_id', t: 'المورد', type: 'ref', ref: () => optsOf('parties', p => p.type === 'supplier'), must: 1 }],
  (v) => { if (!v.party_id) throw new Error('اختر المورد ثم اضغط عرض'); return GET('/reports/ledger' + qs({ ...v, account_id: MZ.settings.acc_ap })); }, partyStmt, {}, () => load('parties'));
function partyStmt(d) {
  const cols = [{ t: 'التاريخ', k: 'date' }, { t: 'الرقم', k: 'number' }, { t: 'البيان', k: 'description' }, { t: 'مدين', f: r => r.debit ? fmt(r.debit) : '', cls: 'num', csv: r => r.debit }, { t: 'دائن', f: r => r.credit ? fmt(r.credit) : '', cls: 'num', csv: r => r.credit }, { t: 'الرصيد', f: r => fmt(r.balance), cls: 'num', csv: r => r.balance }];
  return h('div', null, h('p', null, h('b', null, 'رصيد سابق: ' + fmt(d.opening))), h('div', { class: 'panel' }, table(cols, d.rows, { foot: ['', '', 'الرصيد المستحق', fmt(d.rows.reduce((s, r) => s + r.debit, 0)), fmt(d.rows.reduce((s, r) => s + r.credit, 0)), fmt(d.closing)] })), btn('تصدير Excel', () => download('statement.csv', csvOf(cols, d.rows))));
}
const balancesPage = (kind, title) => reportPage(title, [], () => GET('/reports/' + kind), (rows) => {
  const cols = [{ t: 'الكود', k: 'code' }, { t: 'الاسم', k: 'name' }, { t: 'الهاتف', k: 'phone' }, { t: 'حد الائتمان', k: 'credit_limit', num: 1 }, { t: 'الرصيد', f: r => h('span', { class: (kind === 'customers' ? r.balance : -r.balance) > 0 ? 'neg' : '' }, fmt(kind === 'customers' ? r.balance : -r.balance)), cls: 'num', csv: r => kind === 'customers' ? r.balance : -r.balance }];
  const tot = rows.reduce((s, r) => s + (kind === 'customers' ? r.balance : -r.balance), 0);
  return h('div', null, h('div', { class: 'panel' }, table(cols, rows.filter(r => Math.abs(r.balance) > 0.004), { foot: ['', 'الإجمالي', '', '', fmt(tot)], onrow: (r) => openWin('stmt-' + r.id, 'كشف ' + r.name, () => MZ.pages[kind === 'customers' ? 'statement_c' : 'statement_s']()) })), btn('تصدير Excel', () => download(kind + '.csv', csvOf(cols, rows))));
}, {}, () => load('parties'));
MZ.pages.bal_c = balancesPage('customers', 'أرصدة العملاء');
MZ.pages.bal_s = balancesPage('suppliers', 'أرصدة الموردين');
const agingPage = (type, title) => reportPage(title, [], () => GET('/reports/aging?type=' + type), (rows) => {
  const cols = [{ t: 'الاسم', k: 'name' }, { t: '0-30', f: r => fmt(r.b0), cls: 'num', csv: r => r.b0 }, { t: '31-60', f: r => fmt(r.b30), cls: 'num', csv: r => r.b30 }, { t: '61-90', f: r => fmt(r.b60), cls: 'num', csv: r => r.b60 }, { t: '91-120', f: r => fmt(r.b90), cls: 'num', csv: r => r.b90 }, { t: 'أكثر', f: r => fmt(r.older), cls: 'num', csv: r => r.older }, { t: 'الإجمالي', f: r => fmt(r.total), cls: 'num', csv: r => r.total }];
  const S = (k) => fmt(rows.reduce((s, r) => s + r[k], 0));
  return h('div', null, h('div', { class: 'panel' }, table(cols, rows, { foot: ['الإجمالي', S('b0'), S('b30'), S('b60'), S('b90'), S('older'), S('total')], empty: 'لا توجد أرصدة مستحقة' })), btn('تصدير Excel', () => download('aging.csv', csvOf(cols, rows))));
});
MZ.pages.aging_c = agingPage('customer', 'أعمار ديون العملاء');
MZ.pages.aging_s = agingPage('supplier', 'أعمار ديون الموردين');

MZ.pages.stock_bal = reportPage('أرصدة المخازن', [{ k: 'warehouse_id', t: 'المخزن', type: 'ref', ref: () => optsOf('warehouses') }, { k: 'to', t: 'حتى تاريخ', type: 'date' }, { k: 'group_id', t: 'المجموعة', type: 'ref', ref: () => optsOf('item_groups') }],
  (v) => GET('/reports/stock' + qs({ warehouse_id: v.warehouse_id, to: v.to })), (rows, v) => {
    if (v.group_id) rows = rows.filter(r => r.group_id === +v.group_id);
    const cols = [{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الوحدة', k: 'unit' }, { t: 'الكمية', f: r => h('span', { class: r.min_qty > 0 && r.qty < r.min_qty ? 'neg' : '' }, fq(r.qty)), cls: 'num', csv: r => r.qty }, { t: 'متوسط التكلفة', f: r => fmt(r.avg_cost), cls: 'num', csv: r => r.avg_cost }, { t: 'القيمة', f: r => fmt(r.value), cls: 'num', csv: r => r.value }];
    return h('div', null, h('div', { class: 'panel' }, table(cols, rows, { foot: ['', 'الإجمالي', '', '', '', fmt(rows.reduce((s, r) => s + r.value, 0))], onrow: (r) => openWin('card-' + r.id, 'كارت ' + r.name, () => MZ.pages.stockcard({ item_id: r.id })()) })), btn('تصدير Excel', () => download('stock.csv', csvOf(cols, rows))));
  }, {}, () => Promise.all([load('warehouses'), load('item_groups')]));
MZ.pages.stockcard = (pre = {}) => reportPage('كارت الصنف', [...dateFields('2000-01-01'), { k: 'item_id', t: 'الصنف', type: 'ref', ref: () => optsOf('items'), must: 1 }, { k: 'warehouse_id', t: 'المخزن', type: 'ref', ref: () => optsOf('warehouses') }],
  (v) => { if (!v.item_id) throw new Error('اختر الصنف ثم اضغط عرض'); return GET('/reports/stockcard' + qs(v)); },
  (d) => { const cols = [{ t: 'التاريخ', k: 'date' }, { t: 'المخزن', k: 'wh' }, { t: 'البيان', f: x => ({ invoice: 'فاتورة', adjust: 'جرد', transfer: 'تحويل', prod: 'تصنيع' }[x.ref_type] || '') + (x.note ? ' - ' + x.note : '') }, { t: 'وارد', f: x => x.qty > 0 ? fq(x.qty) : '', cls: 'num', csv: x => x.qty > 0 ? x.qty : '' }, { t: 'صادر', f: x => x.qty < 0 ? fq(-x.qty) : '', cls: 'num', csv: x => x.qty < 0 ? -x.qty : '' }, { t: 'الرصيد', f: x => fq(x.balance), cls: 'num', csv: x => x.balance }];
    return h('div', null, h('p', null, h('b', null, 'رصيد أول: ' + fq(d.opening))), h('div', { class: 'panel' }, table(cols, d.rows, { foot: ['', '', 'الرصيد', '', '', fq(d.closing)] }))); },
  { item_id: pre.item_id, from: '2000-01-01', to: today() }, () => Promise.all([load('items'), load('warehouses')]));
MZ.pages.movement = reportPage('الأصناف الأكثر حركة والراكدة', dateFields(monthStart().slice(0, 5) + '01-01'), (v) => GET('/reports/movement' + qs(v)), (d) => h('div', null,
  h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الأكثر مبيعاً'), table([{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الكمية المباعة', f: r => fq(r.qty), cls: 'num' }, { t: 'عدد الحركات', k: 'cnt' }], d.top)),
  h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'أصناف راكدة (رصيد بلا مبيعات في الفترة)'), table([{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الرصيد', f: r => fq(r.qty), cls: 'num' }, { t: 'قيمة راكدة', f: r => fmt(r.qty * r.avg_cost), cls: 'num' }], d.stagnant))));
const salesRep = (title, types, group) => reportPage(title, [...dateFields(monthStart()), { k: 'party_id', t: 'العميل/المورد', type: 'ref', ref: () => optsOf('parties') }, { k: 'type', t: 'النوع', type: 'select', options: types }], (v) => GET('/reports/invoices' + qs({ ...v, group })), (rows) => {
  const cols = group === 'item' ? [{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الكمية', f: r => fq(r.qty), cls: 'num', csv: r => r.qty }, { t: 'القيمة', f: r => fmt(r.total), cls: 'num', csv: r => r.total }]
    : group === 'party' ? [{ t: 'الاسم', f: r => r.name || 'نقدي', csv: r => r.name }, { t: 'عدد الفواتير', k: 'cnt' }, { t: 'الإجمالي', f: r => fmt(r.total), cls: 'num', csv: r => r.total }, { t: 'المدفوع', f: r => fmt(r.paid), cls: 'num', csv: r => r.paid }]
      : group === 'month' ? [{ t: 'الشهر', k: 'month' }, { t: 'النوع', f: r => INV_AR[r.type] }, { t: 'العدد', k: 'cnt' }, { t: 'الإجمالي', f: r => fmt(r.total), cls: 'num', csv: r => r.total }]
        : [{ t: 'الرقم', k: 'number' }, { t: 'النوع', f: r => INV_AR[r.type] }, { t: 'التاريخ', k: 'date' }, { t: 'الطرف', f: r => r.party || 'نقدي', csv: r => r.party }, { t: 'الإجمالي', f: r => fmt(r.total), cls: 'num', csv: r => r.total }];
  return h('div', null, h('div', { class: 'panel' }, table(cols, rows, { foot: group === 'item' || group === 'month' || group === 'party' ? null : null })), btn('تصدير Excel', () => download(title + '.csv', csvOf(cols, rows))));
}, { from: monthStart(), to: today() }, () => load('parties'));
const SALE_TYPES = [{ v: 'sale', t: 'مبيعات' }, { v: 'sale_return', t: 'مردود مبيعات' }], PUR_TYPES = [{ v: 'purchase', t: 'مشتريات' }, { v: 'purchase_return', t: 'مردود مشتريات' }];
MZ.pages.rep_sales_item = salesRep('مبيعات حسب الصنف', SALE_TYPES, 'item');
MZ.pages.rep_sales_party = salesRep('مبيعات حسب العميل', SALE_TYPES, 'party');
MZ.pages.rep_sales_month = salesRep('مبيعات شهرية', SALE_TYPES, 'month');
MZ.pages.rep_pur_item = salesRep('مشتريات حسب الصنف', PUR_TYPES, 'item');
MZ.pages.rep_pur_party = salesRep('مشتريات حسب المورد', PUR_TYPES, 'party');
MZ.pages.rep_inv_list = salesRep('كشف الفواتير', [...SALE_TYPES, ...PUR_TYPES], '');

/* income statement + balance sheet */
function sectionRows(rr, type, sign) { return rr.filter(r => r.type === type && !r.is_group && (r.o || r.d || r.c)).map(r => ({ code: r.code, name: r.name, amt: sign * (r.o + r.d - r.c) })); }
MZ.pages.income = reportPage('قائمة الدخل', dateFields(), (v) => GET('/reports/trial' + qs({ from: v.from, to: v.to })), (rows) => {
  const rr = rollup(rows).map(r => ({ ...r, o: 0 })); // period movement only
  const rev = sectionRows(rr, 'revenue', -1), exp = sectionRows(rr, 'expense', 1);
  const tr = rev.reduce((s, r) => s + r.amt, 0), te = exp.reduce((s, r) => s + r.amt, 0);
  const cogsAcc = +MZ.settings.acc_cogs; const cogs = exp.filter(r => rows.find(a => a.code === r.code && a.id === cogsAcc)).reduce((s, r) => s + r.amt, 0);
  const c = [{ t: 'الكود', k: 'code' }, { t: 'البند', k: 'name' }, { t: 'المبلغ', f: r => fmt(r.amt), cls: 'num' }];
  return h('div', null, h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الإيرادات'), table(c, rev, { foot: ['', 'إجمالي الإيرادات', fmt(tr)] })),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'المصروفات'), table(c, exp, { foot: ['', 'إجمالي المصروفات', fmt(te)] })),
    h('div', { class: 'kpis' }, h('div', { class: 'kpi' }, h('span', null, 'مجمل الربح'), h('b', null, fmt(tr - cogs))), h('div', { class: 'kpi ' + (tr - te >= 0 ? 'pos' : 'neg') }, h('span', null, 'صافي الربح / (الخسارة)'), h('b', null, fmt(tr - te)))));
});
MZ.pages.balance = reportPage('المركز المالي (الميزانية)', [{ k: 'to', t: 'كما في تاريخ', type: 'date', def: today() }], (v) => GET('/reports/trial' + qs({ to: v.to })), (rows) => {
  const rr = rollup(rows); const leaf = rr.filter(r => !r.is_group);
  const bal = (r) => r.o + r.d - r.c;
  const A = leaf.filter(r => r.type === 'asset' && bal(r)).map(r => ({ code: r.code, name: r.name, amt: bal(r) }));
  const Lb = leaf.filter(r => r.type === 'liability' && bal(r)).map(r => ({ code: r.code, name: r.name, amt: -bal(r) }));
  const E = leaf.filter(r => r.type === 'equity' && bal(r)).map(r => ({ code: r.code, name: r.name, amt: -bal(r) }));
  const profit = -leaf.filter(r => r.type === 'revenue' || r.type === 'expense').reduce((s, r) => s + bal(r), 0);
  const ta = A.reduce((s, r) => s + r.amt, 0), tl = Lb.reduce((s, r) => s + r.amt, 0), te = E.reduce((s, r) => s + r.amt, 0) + profit;
  const c = [{ t: 'الكود', k: 'code' }, { t: 'البند', k: 'name' }, { t: 'المبلغ', f: r => fmt(r.amt), cls: 'num' }];
  return h('div', null, h('div', { class: 'cols2' }, h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الأصول'), table(c, A, { foot: ['', 'إجمالي الأصول', fmt(ta)] })),
    h('div', null, h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الخصوم'), table(c, Lb, { foot: ['', 'إجمالي الخصوم', fmt(tl)] })),
      h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'حقوق الملكية'), table(c, [...E, { code: '', name: 'أرباح/خسائر الفترة', amt: profit }], { foot: ['', 'إجمالي حقوق الملكية', fmt(te)] })))),
    h('div', { class: 'kpis' }, h('div', { class: 'kpi ' + (Math.abs(ta - tl - te) < 0.01 ? 'pos' : 'neg') }, h('span', null, 'الأصول - (الخصوم + حقوق الملكية)'), h('b', null, fmt(ta - tl - te)))));
});

/* ---------- HR ---------- */
MZ.pages.employees = () => crudPage({
  title: 'الموظفون', card: 'بطاقة الموظف', path: '/employees', perm: 'hr', needs: ['branches'], defaults: { active: 1, salary: 0, allowances: 0, deductions: 0 },
  cols: [{ t: 'الكود', k: 'code' }, { t: 'الاسم', k: 'name' }, { t: 'الوظيفة', k: 'job' }, { t: 'القسم', k: 'department' }, { t: 'الراتب', k: 'salary', num: 1 }, { t: 'البدلات', k: 'allowances', num: 1 }, { t: 'الاستقطاعات', k: 'deductions', num: 1 }, activeCol],
  fields: [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'الاسم', req: 1 }, { k: 'job', t: 'الوظيفة' }, { k: 'department', t: 'القسم' }, { k: 'branch_id', t: 'الفرع', type: 'ref', ref: () => optsOf('branches') }, { k: 'hire_date', t: 'تاريخ التعيين', type: 'date' },
    { k: 'phone', t: 'الهاتف', dir: 'ltr' }, { k: 'salary', t: 'الراتب الأساسي', type: 'number' }, { k: 'allowances', t: 'بدلات', type: 'number' }, { k: 'deductions', t: 'استقطاعات', type: 'number' }, { k: 'active', t: 'نشط', type: 'check' }]
});
MZ.pages.payroll = async () => {
  await load('accounts', true);
  const runs = await GET('/payroll'); const ed = can('hr:edit');
  const m = mkField({ type: 'text' }, today().slice(0, 7)); m.el.type = 'month';
  const run = async () => { const r = await POST('/payroll/run', { month: m.get() }); toast('تم احتساب الرواتب: صافي ' + fmt(r.net)); MZ.wins.payroll.refresh(); };
  const pay = (r) => { const a = mkField({ type: 'ref', ref: leafAcc }, +MZ.settings.acc_cash), d = mkField({ type: 'date' }, today()); modal('صرف رواتب ' + r.month, h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, h('span', null, 'الصرف من'), a.el), h('label', { class: 'fld' }, h('span', null, 'التاريخ'), d.el)), [{ t: 'صرف ' + fmt(r.total_net), kind: 'pri', fn: async (c) => { await POST('/payroll/pay', { run_id: r.id, account_id: a.get(), date: d.get() }); toast('تم الصرف'); c(); } }]); };
  const view = async (r) => { const l = await GET('/payroll/' + r.id); modal('تفاصيل رواتب ' + r.month, table([{ t: 'الموظف', k: 'name' }, { t: 'الإجمالي', k: 'gross', num: 1 }, { t: 'الاستقطاع', k: 'ded', num: 1 }, { t: 'الصافي', k: 'net', num: 1 }], l), [{ t: '🖨 طباعة', fn: () => printEl('رواتب', h('div', null, companyHead(), h('h2', null, 'مسير رواتب ' + r.month), table([{ t: 'الموظف', k: 'name' }, { t: 'الإجمالي', k: 'gross', num: 1 }, { t: 'الاستقطاع', k: 'ded', num: 1 }, { t: 'الصافي', k: 'net', num: 1 }], l))) }], { wide: true }); };
  return h('div', null, pageHead('مسير الرواتب'), ed ? h('div', { class: 'filters' }, h('label', null, h('span', null, 'الشهر'), m.el), btn('احتساب رواتب الشهر وترحيلها', run, 'pri')) : null,
    h('div', { class: 'panel' }, table([{ t: 'الشهر', k: 'month' }, { t: 'الإجمالي', k: 'total_gross', num: 1 }, { t: 'الاستقطاعات', k: 'total_ded', num: 1 }, { t: 'الصافي', k: 'total_net', num: 1 }, { t: '', f: r => h('span', null, btn('تفاصيل', () => view(r)), ' ', ed ? btn('صرف', () => pay(r)) : '') }], runs)));
};

/* ---------- assets / budgets ---------- */
MZ.pages.assets = async () => {
  const el = await crudPage({
    title: 'الأصول الثابتة', card: 'بطاقة الأصل', path: '/assets', perm: 'assets', needs: ['branches'], defaults: { life_years: 5, salvage: 0, status: 'active', buy_date: today() },
    cols: [{ t: 'الكود', k: 'code' }, { t: 'الأصل', k: 'name' }, { t: 'الفئة', k: 'category' }, { t: 'تاريخ الشراء', k: 'buy_date' }, { t: 'التكلفة', k: 'cost', num: 1 }, { t: 'العمر', k: 'life_years' }, { t: 'مجمع الإهلاك', k: 'accumulated', num: 1 }, { t: 'القيمة الدفترية', f: r => fmt(r.cost - r.accumulated), cls: 'num' }, { t: 'الحالة', f: r => r.status === 'active' ? 'نشط' : 'مستبعد' }],
    fields: [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'اسم الأصل', req: 1 }, { k: 'category', t: 'الفئة' }, { k: 'branch_id', t: 'الفرع', type: 'ref', ref: () => optsOf('branches') }, { k: 'buy_date', t: 'تاريخ الشراء', type: 'date' }, { k: 'cost', t: 'التكلفة', type: 'number', req: 1 }, { k: 'salvage', t: 'قيمة الخردة', type: 'number' }, { k: 'life_years', t: 'العمر الإنتاجي (سنوات)', type: 'number' }, { k: 'status', t: 'الحالة', type: 'select', options: [{ v: 'active', t: 'نشط' }, { v: 'disposed', t: 'مستبعد' }] }]
  });
  const d = mkField({ type: 'date' }, today());
  const run = async () => { const r = await POST('/assets/depreciate', { date: d.get() }); toast(r.total ? 'تم إهلاك ' + r.assets + ' أصل بقيمة ' + fmt(r.total) : 'لا توجد أصول مستحقة للإهلاك في هذا الشهر'); MZ.wins.assets.refresh(); };
  return h('div', null, can('assets:edit') ? h('div', { class: 'filters' }, h('label', null, h('span', null, 'تاريخ قيد الإهلاك'), d.el), btn('احتساب إهلاك الشهر وترحيله', run, 'pri'), h('span', { class: 'cd' }, 'ملاحظة: سجل شراء الأصل بسند صرف على حساب الأصول الثابتة.')) : null, el);
};
MZ.pages.budgets = async () => {
  await load('accounts', true);
  const y = mkField({ type: 'number' }, new Date().getFullYear()); const out = h('div');
  const run = async () => { const rows = await GET('/reports/budget?year=' + y.get()); out.innerHTML = ''; out.append(table([{ t: 'الكود', k: 'code' }, { t: 'الحساب', k: 'name' }, { t: 'الموازنة', f: r => fmt(r.budget), cls: 'num' }, { t: 'الفعلي', f: r => fmt(r.actual), cls: 'num' }, { t: 'الفرق', f: r => h('span', { class: (r.type === 'expense' ? r.variance > 0 : r.variance < 0) ? 'neg' : 'pos' }, fmt(r.variance)), cls: 'num' }, { t: '%', f: r => r.budget ? fmt(r.actual / r.budget * 100, 0) + '%' : '' }], rows, { empty: 'لا توجد موازنات لهذه السنة' })); };
  const acc = mkField({ type: 'ref', ref: () => optsOf('accounts', a => !a.is_group && (a.type === 'revenue' || a.type === 'expense'), accLabel) }), amt = mkField({ type: 'number' }, '');
  const add = async () => { if (!acc.get() || !(amt.get() >= 0)) throw new Error('اختر الحساب وأدخل المبلغ الشهري'); for (let m = 1; m <= 12; m++) await POST('/budgets', { account_id: acc.get(), year: y.get(), month: m, amount: amt.get() }); toast('تم تحديد الموازنة السنوية (توزيع شهري متساوٍ)'); run(); };
  await run();
  return h('div', null, pageHead('الموازنات', btn('عرض', run, 'pri')), h('div', { class: 'filters' }, h('label', null, h('span', null, 'السنة'), y.el),
    can('budgets:edit') ? h('span', { class: 'cd' }, 'تحديد موازنة: ') : null, can('budgets:edit') ? h('label', null, h('span', null, 'حساب (إيراد/مصروف)'), acc.el) : null, can('budgets:edit') ? h('label', null, h('span', null, 'المبلغ الشهري'), amt.el) : null, can('budgets:edit') ? btn('حفظ الموازنة', add) : null),
    h('div', { class: 'panel' }, out));
};

/* ---------- CRM ---------- */
const STAGES = [{ v: 'new', t: 'جديد' }, { v: 'contacted', t: 'تم التواصل' }, { v: 'proposal', t: 'عرض مقدم' }, { v: 'won', t: 'تم الكسب' }, { v: 'lost', t: 'خسارة' }];
MZ.pages.crm = () => crudPage({
  title: 'علاقات العملاء (CRM)', card: 'فرصة بيعية', path: '/leads', perm: 'crm', defaults: { stage: 'new', value: 0 },
  cols: [{ t: 'الاسم', k: 'name' }, { t: 'الشركة', k: 'company' }, { t: 'الهاتف', k: 'phone' }, { t: 'المصدر', k: 'source' }, { t: 'المرحلة', f: r => h('span', { class: 'tag ' + (r.stage === 'won' ? 'ok' : r.stage === 'lost' ? 'bad' : 'warn') }, (STAGES.find(s => s.v === r.stage) || {}).t) }, { t: 'القيمة', k: 'value', num: 1 }, { t: 'الإجراء القادم', k: 'next_action' }],
  fields: [{ k: 'name', t: 'الاسم', req: 1 }, { k: 'company', t: 'الشركة' }, { k: 'phone', t: 'الهاتف', dir: 'ltr' }, { k: 'email', t: 'البريد', dir: 'ltr' }, { k: 'source', t: 'المصدر' }, { k: 'stage', t: 'المرحلة', type: 'select', options: STAGES }, { k: 'value', t: 'القيمة المتوقعة', type: 'number' }, { k: 'next_action', t: 'موعد المتابعة', type: 'date' }, { k: 'notes', t: 'ملاحظات', type: 'textarea', full: 1 }]
});

/* ---------- manufacturing ---------- */
MZ.pages.boms = async () => {
  await Promise.all([load('items', true), load('warehouses', true), load('boms', true)]);
  const boms = await GET('/boms'); const ed = can('mfg:edit');
  const openBom = async (b) => {
    const lines = b ? await GET('/bom_lines?bom_id=' + b.id) : [];
    const f = formFor([{ k: 'item_id', t: 'المنتج التام', type: 'ref', ref: () => optsOf('items', i => i.kind === 'stock'), req: 1 }, { k: 'name', t: 'اسم القائمة' }, { k: 'qty', t: 'كمية الإنتاج المرجعية', type: 'number', def: 1 }], b || { qty: 1 });
    const body = h('div'); const tbl = h('div');
    const drawL = () => { tbl.innerHTML = ''; tbl.append(table([{ t: 'الخامة', f: l => nameOf('items', l.item_id) }, { t: 'الكمية', f: l => fq(l.qty), cls: 'num' }, { t: '', f: l => ed ? btn('حذف', async () => { await DEL('/bom_lines/' + l.id); lines.splice(lines.indexOf(l), 1); drawL(); }) : '' }], lines, { empty: 'أضف الخامات' })); };
    drawL();
    const it = combo(optsOf('items', i => i.kind === 'stock')), q = h('input', { class: 'inp', type: 'number', step: 'any', placeholder: 'الكمية' });
    body.append(f.el, h('h4', null, 'مكونات القائمة'), tbl, b && ed ? h('div', { class: 'filters' }, h('label', null, h('span', null, 'خامة'), it.el), h('label', null, h('span', null, 'كمية'), q), btn('إضافة', async () => { if (!it.get() || !(+q.value > 0)) throw new Error('أكمل البيانات'); const r = await POST('/bom_lines', { bom_id: b.id, item_id: it.get(), qty: +q.value }); lines.push({ id: r.id, item_id: it.get(), qty: +q.value }); drawL(); })) : (b ? null : h('p', { class: 'cd' }, 'احفظ القائمة ثم أضف الخامات')));
    modal(b ? 'قائمة مواد' : 'قائمة مواد جديدة', body, ed ? [{ t: '💾 حفظ', kind: 'pri', fn: async (c) => { const d = f.get(); if (!d.item_id) throw new Error('اختر المنتج'); b ? await PUT('/boms/' + b.id, d) : await POST('/boms', d); toast('تم الحفظ'); c(); MZ.wins.boms.refresh(); } }] : null, { wide: true });
  };
  const wh = mkField({ type: 'ref', ref: () => optsOf('warehouses') }); if (MZ.L.warehouses[0]) wh.set(MZ.L.warehouses[0].id);
  const produce = (b) => { const q = mkField({ type: 'number' }, 1), d = mkField({ type: 'date' }, today()); modal('أمر تصنيع', h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, h('span', null, 'المخزن'), wh.el), h('label', { class: 'fld' }, h('span', null, 'الكمية المنتجة'), q.el), h('label', { class: 'fld' }, h('span', null, 'التاريخ'), d.el)), [{ t: 'تنفيذ التصنيع', kind: 'pri', fn: async (c) => { const r = await POST('/prod', { bom_id: b.id, warehouse_id: wh.get(), qty: q.get(), date: d.get() }); toast('تم التصنيع، التكلفة ' + fmt(r.cost)); c(); await load('items', true); MZ.wins.boms.refresh(); } }]); };
  const orders = await GET('/prod').catch(() => []);
  return h('div', null, pageHead('التصنيع', ed ? btn('➕ قائمة مواد جديدة', () => openBom(null), 'pri') : null),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'قوائم المواد (BOM)'), table([{ t: 'المنتج', f: b => nameOf('items', b.item_id) }, { t: 'الاسم', k: 'name' }, { t: '', f: b => h('span', null, btn('فتح', () => openBom(b)), ' ', ed ? btn('⚙ تصنيع', () => produce(b), 'pri') : '') }], boms)),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'أوامر التصنيع'), table([{ t: 'الرقم', k: 'number' }, { t: 'التاريخ', k: 'date' }, { t: 'المنتج', k: 'item_name' }, { t: 'الكمية', f: r => fq(r.qty), cls: 'num' }, { t: 'التكلفة', k: 'cost', num: 1 }], orders)));
};

/* ---------- misc modules ---------- */
MZ.pages.maint = () => crudPage({ title: 'الصيانة', card: 'أمر صيانة', path: '/maint_orders', perm: 'misc', defaults: { priority: 'normal', status: 'open', opened: today(), cost: 0 },
  cols: [{ t: 'العنوان', k: 'title' }, { t: 'الطالب', k: 'requester' }, { t: 'الأولوية', f: r => ({ low: 'منخفضة', normal: 'عادية', high: 'عالية' }[r.priority]) }, { t: 'الحالة', f: r => ({ open: 'مفتوح', progress: 'قيد التنفيذ', done: 'منتهي' }[r.status]) }, { t: 'التكلفة', k: 'cost', num: 1 }, { t: 'تاريخ الفتح', k: 'opened' }],
  fields: [{ k: 'title', t: 'العنوان', req: 1, full: 1 }, { k: 'requester', t: 'الطالب' }, { k: 'priority', t: 'الأولوية', type: 'select', options: [{ v: 'low', t: 'منخفضة' }, { v: 'normal', t: 'عادية' }, { v: 'high', t: 'عالية' }] }, { k: 'status', t: 'الحالة', type: 'select', options: [{ v: 'open', t: 'مفتوح' }, { v: 'progress', t: 'قيد التنفيذ' }, { v: 'done', t: 'منتهي' }] }, { k: 'cost', t: 'التكلفة', type: 'number' }, { k: 'opened', t: 'تاريخ الفتح', type: 'date' }, { k: 'closed', t: 'تاريخ الإغلاق', type: 'date' }, { k: 'notes', t: 'تفاصيل', type: 'textarea', full: 1 }] });
MZ.pages.estate = () => crudPage({ title: 'العقارات والإيجارات', card: 'وحدة عقارية', path: '/estate_units', perm: 'misc', defaults: { status: 'vacant', rent: 0, area: 0 },
  cols: [{ t: 'الكود', k: 'code' }, { t: 'الوحدة', k: 'name' }, { t: 'النوع', k: 'kind' }, { t: 'المساحة', k: 'area' }, { t: 'الإيجار', k: 'rent', num: 1 }, { t: 'المستأجر', k: 'tenant' }, { t: 'انتهاء العقد', k: 'lease_end' }, { t: 'الحالة', f: r => r.status === 'rented' ? h('span', { class: 'tag ok' }, 'مؤجرة') : h('span', { class: 'tag warn' }, 'شاغرة') }],
  fields: [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'اسم الوحدة', req: 1 }, { k: 'kind', t: 'النوع (شقة/محل/مكتب)' }, { k: 'address', t: 'العنوان' }, { k: 'area', t: 'المساحة م²', type: 'number' }, { k: 'rent', t: 'الإيجار الشهري', type: 'number' }, { k: 'tenant', t: 'المستأجر' }, { k: 'tenant_phone', t: 'هاتف المستأجر', dir: 'ltr' }, { k: 'lease_start', t: 'بداية العقد', type: 'date' }, { k: 'lease_end', t: 'نهاية العقد', type: 'date' }, { k: 'status', t: 'الحالة', type: 'select', options: [{ v: 'vacant', t: 'شاغرة' }, { v: 'rented', t: 'مؤجرة' }] }] });
MZ.pages.students = () => crudPage({ title: 'المعاهد والطلاب', card: 'بطاقة الطالب', path: '/students', perm: 'misc', defaults: { status: 'active', fees: 0, paid: 0, start_date: today() },
  cols: [{ t: 'الكود', k: 'code' }, { t: 'الطالب', k: 'name' }, { t: 'الدورة', k: 'course' }, { t: 'الرسوم', k: 'fees', num: 1 }, { t: 'المدفوع', k: 'paid', num: 1 }, { t: 'المتبقي', f: r => fmt(r.fees - r.paid), cls: 'num' }, { t: 'الحالة', f: r => r.status === 'active' ? 'منتظم' : 'منقطع' }],
  fields: [{ k: 'code', t: 'الكود', dir: 'ltr' }, { k: 'name', t: 'اسم الطالب', req: 1 }, { k: 'phone', t: 'الهاتف', dir: 'ltr' }, { k: 'course', t: 'الدورة/الفصل' }, { k: 'fees', t: 'الرسوم', type: 'number' }, { k: 'paid', t: 'المدفوع', type: 'number' }, { k: 'start_date', t: 'تاريخ البدء', type: 'date' }, { k: 'status', t: 'الحالة', type: 'select', options: [{ v: 'active', t: 'منتظم' }, { v: 'stopped', t: 'منقطع' }] }, { k: 'notes', t: 'ملاحظات', full: 1 }] });
MZ.pages.archive = () => crudPage({ title: 'الأرشيف', card: 'مستند', path: '/archive_docs', perm: 'misc', defaults: { doc_date: today() },
  cols: [{ t: 'العنوان', k: 'title' }, { t: 'التصنيف', k: 'category' }, { t: 'التاريخ', k: 'doc_date' }, { t: 'الرقم المرجعي', k: 'ref_no' }, { t: 'الرابط', f: r => r.link ? h('a', { href: r.link, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'فتح') : '' }],
  fields: [{ k: 'title', t: 'العنوان', req: 1, full: 1 }, { k: 'category', t: 'التصنيف' }, { k: 'doc_date', t: 'تاريخ المستند', type: 'date' }, { k: 'ref_no', t: 'الرقم المرجعي' }, { k: 'link', t: 'رابط الملف (Drive أو غيره)', dir: 'ltr', full: 1 }, { k: 'notes', t: 'ملاحظات', type: 'textarea', full: 1 }] });

/* ---------- dashboard / start page ---------- */
MZ.pages.home = async () => {
  let d = null; try { d = await GET('/reports/dashboard'); } catch (e) { }
  const k = (t, v, c) => h('div', { class: 'kpi ' + (c || '') }, h('span', null, t), h('b', null, d ? fmt(v) : '—'));
  const series = d ? d.series : []; const mx = Math.max(1, ...series.map(s => Math.max(s.rev, s.exp)));
  const quick = [['🧾', 'فاتورة مبيعات', 'inv-sale'], ['🛒', 'فاتورة مشتريات', 'inv-purchase'], ['💰', 'سند قبض', 'v-receipt'], ['💸', 'سند صرف', 'v-payment'], ['📒', 'قيد يومية', 'journal'], ['👥', 'العملاء', 'customers'], ['📦', 'الأصناف', 'items'], ['🏬', 'أرصدة المخازن', 'stock_bal'], ['⚖', 'ميزان المراجعة', 'trial'], ['📈', 'قائمة الدخل', 'income'], ['🖥', 'نقطة البيع', 'pos'], ['⚙', 'الإعدادات', 'settings']].filter(q => MZ.pages[q[2]]);
  return h('div', null, pageHead('الصفحة الرئيسية - ' + (MZ.settings.company_name || '')),
    h('div', { class: 'kpis' }, k('النقدية والبنوك', d && d.cash, 'pos'), k('مستحق على العملاء', d && d.ar), k('مستحق للموردين', d && d.ap, 'neg'), k('قيمة المخزون', d && d.stock), k('مبيعات الشهر', d && d.sales, 'pos'), k('مصروفات الشهر', d && d.expenses, 'neg'),
      d && d.pending ? h('div', { class: 'kpi neg', style: { cursor: 'pointer' }, onclick: () => openPage('approvals') }, h('span', null, 'مستندات بانتظار الاعتماد'), h('b', null, d.pending)) : null, d && d.low ? h('div', { class: 'kpi neg', style: { cursor: 'pointer' }, onclick: () => openPage('stock_bal') }, h('span', null, 'أصناف تحت حد الطلب'), h('b', null, d.low)) : null),
    h('div', { class: 'cols2' },
      h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'وصول سريع'), h('div', { class: 'pb' }, h('div', { class: 'start' }, quick.map(q => h('div', { class: 'sq', onclick: () => openPage(q[2]) }, h('i', null, q[0]), q[1]))))),
      h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الإيرادات والمصروفات (آخر 6 شهور)'), h('div', { class: 'pb' }, series.length ? h('div', { class: 'bars' }, series.map(s => h('div', { class: 'bar' }, h('div', { class: 'bb' }, h('i', { style: { height: (s.rev / mx * 125) + 'px' }, title: 'إيرادات ' + fmt(s.rev) }), h('i', { class: 'e', style: { height: (s.exp / mx * 125) + 'px' }, title: 'مصروفات ' + fmt(s.exp) })), h('small', null, s.m)))) : h('p', { class: 'empty' }, 'لا توجد حركة بعد. ابدأ بتسجيل فاتورة أو قيد.')))),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'آخر القيود'), table([{ t: 'الرقم', k: 'number' }, { t: 'التاريخ', k: 'date' }, { t: 'البيان', k: 'description' }], d ? d.last : [], { empty: 'لا توجد قيود بعد' })));
};
