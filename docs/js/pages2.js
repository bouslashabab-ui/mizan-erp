'use strict';
/* Accounting & trade: journal, vouchers, invoices, POS, stock operations */
const partyOpts = (type) => () => optsOf('parties', p => p.type === type && p.active);
const leafAcc = () => optsOf('accounts', a => !a.is_group && a.active, accLabel);
const companyHead = () => h('div', { class: 'hd' }, h('span', { class: 'plogo', html: LOGO.replace(/#fff/g, '#c26a00') }), h('div', null, h('h2', null, MZ.settings.company_name || ''), h('div', null, (MZ.settings.company_address || '') + ' ' + (MZ.settings.company_phone || '')), MZ.settings.tax_no ? h('div', null, 'الرقم الضريبي: ' + MZ.settings.tax_no) : null), h('div', null, 'ميزان ERP'));

/* ---------- journal ---------- */
function journalEditor(e) {
  const lines = [];
  const date = mkField({ type: 'date' }, e ? e.date : today()), desc = mkField({}, e ? e.description : '');
  const body = h('div'); const tot = h('div', { class: 'totals' });
  const addLine = (l) => {
    const acc = combo(leafAcc(), l ? l.account_id : null);
    const cc = combo(optsOf('cost_centers'), l ? l.cost_center_id : null);
    const pt = combo(optsOf('parties', null, p => p.name + (p.type === 'customer' ? ' (عميل)' : ' (مورد)')), l ? l.party_id : null);
    const dr = h('input', { class: 'inp', type: 'number', step: 'any', value: l && l.debit ? l.debit : '' }), cr = h('input', { class: 'inp', type: 'number', step: 'any', value: l && l.credit ? l.credit : '' });
    const ds = h('input', { class: 'inp', value: l ? (l.description || '') : '' });
    dr.oninput = () => { if (+dr.value) cr.value = ''; calc(); }; cr.oninput = () => { if (+cr.value) dr.value = ''; calc(); };
    const o = { acc, cc, pt, dr, cr, ds }; lines.push(o);
    o.tr = h('tr', null, h('td', null, acc.el), h('td', null, dr), h('td', null, cr), h('td', null, ds), h('td', null, cc.el), h('td', null, pt.el), h('td', null, h('button', { class: 'btn sm danger', onclick: () => { lines.splice(lines.indexOf(o), 1); o.tr.remove(); calc(); } }, '×')));
    tb.append(o.tr);
  };
  const tb = h('tbody');
  const calc = () => { const d = lines.reduce((s, l) => s + (+l.dr.value || 0), 0), c = lines.reduce((s, l) => s + (+l.cr.value || 0), 0); tot.innerHTML = ''; tot.append(h('div', null, 'إجمالي المدين', h('b', null, fmt(d))), h('div', null, 'إجمالي الدائن', h('b', null, fmt(c))), h('div', null, 'الفرق', h('b', { class: Math.abs(d - c) < 0.005 ? 'pos' : 'neg' }, fmt(d - c)))); };
  const grid = h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['الحساب', 'مدين', 'دائن', 'البيان', 'مركز التكلفة', 'العميل/المورد', ''].map(t => h('th', null, t)))), tb);
  if (e) e.lines.forEach(addLine); else { addLine(); addLine(); }
  calc();
  const get = () => ({ date: date.get(), description: desc.get(), lines: lines.map(l => ({ account_id: l.acc.get(), debit: +l.dr.value || 0, credit: +l.cr.value || 0, description: l.ds.value || null, cost_center_id: l.cc.get(), party_id: l.pt.get() })) });
  body.append(h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, h('span', null, 'التاريخ'), date.el), h('label', { class: 'fld full' }, h('span', null, 'البيان'), desc.el)), h('div', { class: 'tbl-wrap', style: { marginTop: '10px' } }, grid), btn('➕ سطر', () => addLine()), tot);
  return { el: body, get };
}
function openJournal(e) {
  const j = journalEditor(e);
  modal(e ? 'قيد يومية ' + e.number : 'قيد يومية جديد', j.el, [
    { t: '💾 حفظ', kind: 'pri', fn: async (c) => { const d = j.get(); e ? await PUT('/journal/' + e.id, d) : await POST('/journal', d); toast('تم حفظ القيد'); c(); MZ.wins.journal && MZ.wins.journal.refresh(); } },
    e && e.type === 'JV' ? { t: '🗑 حذف', fn: async (c) => { if (await confirmBox('حذف القيد؟')) { await DEL('/journal/' + e.id); c(); toast('تم الحذف'); MZ.wins.journal && MZ.wins.journal.refresh(); } } } : null].filter(Boolean), { wide: true });
}
MZ.pages.journal = async () => {
  await Promise.all([load('accounts', true), load('cost_centers', true), load('parties', true)]);
  const holder = h('div'); let rows = [];
  const bar = filterBar([{ k: 'from', t: 'من', type: 'date', def: monthStart() }, { k: 'to', t: 'إلى', type: 'date' }, { k: 'q', t: 'بحث' }], async (v) => { rows = await GET('/journal' + qs(v)); draw(); }, { from: monthStart() });
  const cols = [{ t: 'الرقم', k: 'number' }, { t: 'النوع', f: r => ({ JV: 'قيد يومية', SI: 'مبيعات', SR: 'مردود مبيعات', PI: 'مشتريات', PR: 'مردود مشتريات', RV: 'قبض', PV: 'صرف', CQ: 'شيك', OB: 'افتتاحي', CL: 'إقفال' }[r.type] || r.type) }, { t: 'التاريخ', k: 'date' }, { t: 'البيان', k: 'description' }, { t: 'القيمة', k: 'total', num: 1 }];
  const draw = () => { holder.innerHTML = ''; holder.append(table(cols, rows, { onrow: guard(async (r) => openJournal(await GET('/journal/' + r.id))) })); };
  rows = await GET('/journal' + qs({ from: monthStart() })); draw();
  return h('div', null, pageHead('القيود اليومية', can('journal:edit') ? btn('➕ قيد جديد', () => openJournal(null), 'pri') : null, btn('تصدير', () => download('journal.csv', csvOf(cols, rows)))), bar, h('div', { class: 'panel' }, holder));
};

/* ---------- vouchers ---------- */
function openVoucher(type, v) {
  const rec = type === 'receipt';
  const fs = formFor([{ k: 'date', t: 'التاريخ', type: 'date', def: today() }, { k: 'account_id', t: rec ? 'استلام في (خزينة/بنك)' : 'الصرف من (خزينة/بنك)', type: 'ref', ref: leafAcc, req: 1 },
    { k: 'counter_id', t: rec ? 'الحساب الدائن (المقابل)' : 'الحساب المدين (المقابل)', type: 'ref', ref: leafAcc, req: 1 },
    { k: 'party_id', t: 'العميل/المورد (اختياري)', type: 'ref', ref: () => optsOf('parties', null, p => p.name + (p.type === 'customer' ? ' (عميل)' : ' (مورد)')) },
    { k: 'cost_center_id', t: 'مركز التكلفة', type: 'ref', ref: () => optsOf('cost_centers') }, { k: 'amount', t: 'المبلغ', type: 'number', req: 1 }, { k: 'notes', t: 'البيان', type: 'textarea', full: 1 }],
    v || { account_id: +MZ.settings.acc_cash || null });
  if (!v) { const pf = fs.field('party_id'), cf = fs.field('counter_id'); pf.el.addEventListener('change', () => { const pid = pf.get(), pr = byId('parties', pid); if (pr && !cf.get()) { const a = +(pr.type === 'customer' ? MZ.settings.acc_ar : MZ.settings.acc_ap); if (a) cf.set(a); } }); }
  if (!v) { const hint = h('p', { class: 'cd' }, rec ? 'للتحصيل من عميل اختر حساب العملاء كحساب مقابل مع تحديد العميل.' : 'لدفع مصروف اختر حساب المصروف كحساب مقابل، ولسداد مورد اختر حساب الموردين مع تحديد المورد.'); fs.el.append(hint); }
  modal((rec ? 'سند قبض' : 'سند صرف') + (v ? ' ' + v.number : ' جديد'), fs.el, v ? [{ t: '🖨 طباعة', fn: () => printVoucher(v) }, { t: '🗑 حذف السند', fn: async (c) => { if (await confirmBox('حذف السند وقيده؟')) { await DEL('/vouchers/' + v.id); c(); toast('تم الحذف'); MZ.wins['v-' + type].refresh(); } } }]
    : [{ t: '💾 حفظ وترحيل', kind: 'pri', fn: async (c) => { const d = fs.get(); for (const k of ['account_id', 'counter_id', 'amount']) if (!d[k]) throw new Error('أكمل الحقول المطلوبة'); const r = await POST('/vouchers', { ...d, type }); toast('تم الترحيل ' + r.number); c(); MZ.wins['v-' + type] && MZ.wins['v-' + type].refresh(); } }]);
}
function printVoucher(v) {
  printEl('سند', h('div', { class: 'print-doc' }, companyHead(), h('h2', null, (v.type === 'receipt' ? 'سند قبض' : 'سند صرف') + ' رقم ' + v.number), h('p', null, 'التاريخ: ' + v.date),
    h('table', null, h('tbody', null, h('tr', null, h('th', null, 'الخزينة'), h('td', null, v.account_name)), h('tr', null, h('th', null, 'الحساب المقابل'), h('td', null, v.counter_name)), h('tr', null, h('th', null, 'الطرف'), h('td', null, v.party_name || '')), h('tr', null, h('th', null, 'المبلغ'), h('td', { class: 'num' }, fmt(v.amount))), h('tr', null, h('th', null, 'البيان'), h('td', null, v.notes || '')))),
    h('div', { class: 'sig' }, h('div', null, 'المستلم'), h('div', null, 'المحاسب'), h('div', null, 'المدير'))));
}
const voucherPage = (type) => async () => {
  await Promise.all([load('accounts', true), load('parties', true), load('cost_centers', true)]);
  const rec = type === 'receipt'; let rows = []; const holder = h('div');
  const cols = [{ t: 'الرقم', k: 'number' }, { t: 'التاريخ', k: 'date' }, { t: 'الخزينة', k: 'account_name' }, { t: 'الحساب المقابل', k: 'counter_name' }, { t: 'الطرف', k: 'party_name' }, { t: 'المبلغ', k: 'amount', num: 1 }, { t: 'البيان', k: 'notes' }];
  const draw = () => { holder.innerHTML = ''; holder.append(table(cols, rows, { onrow: guard(async (r) => openVoucher(type, await GET('/vouchers/' + r.id))) })); };
  const bar = filterBar([{ k: 'from', t: 'من', type: 'date' }, { k: 'to', t: 'إلى', type: 'date' }], async (v) => { rows = await GET('/vouchers' + qs({ ...v, type })); draw(); });
  rows = await GET('/vouchers?type=' + type); draw();
  return h('div', null, pageHead(rec ? 'سندات القبض' : 'سندات الصرف', can('vouchers:edit') ? btn('➕ ' + (rec ? 'سند قبض جديد' : 'سند صرف جديد'), () => openVoucher(type, null), 'pri') : null), bar, h('div', { class: 'panel' }, holder));
};
MZ.pages['v-receipt'] = voucherPage('receipt');
MZ.pages['v-payment'] = voucherPage('payment');

/* ---------- invoices ---------- */
async function unitsMap() { const u = await GET('/item_units'); const m = {}; u.forEach(x => (m[x.item_id] = m[x.item_id] || []).push(x)); MZ.L.unitsMap = m; return m; }
function invoiceEditor(type, src) {
  const sale = type.startsWith('sale') || type === 'quote'; const draftType = ['quote', 'sale_order', 'purchase_order'].includes(type);
  const um = MZ.L.unitsMap || {};
  const pf = mkField({ type: 'ref', ref: partyOpts(sale ? 'customer' : 'supplier') }), date = mkField({ type: 'date' }, today());
  const wh = mkField({ type: 'ref', ref: () => optsOf('warehouses') }), pm = mkField({ type: 'select', options: [{ v: 'cash', t: 'نقدي (خزينة)' }, { v: 'bank', t: 'بنك/تحويل' }, { v: 'credit', t: 'آجل' }] }, draftType ? 'credit' : 'cash');
  const whs = MZ.L.warehouses || []; if (whs[0]) wh.set(whs[0].id);
  const paid = mkField({ type: 'number' }, 0), disc = mkField({ type: 'number' }, 0), notes = mkField({}, '');
  const tb = h('tbody'), lines = []; const tot = h('div', { class: 'totals' });
  const itemOpts = optsOf('items', i => i.active, i => (i.code ? i.code + ' - ' : '') + i.name);
  const addLine = (pre) => {
    const it = combo(itemOpts), unit = h('select', { class: 'inp' }), qty = h('input', { class: 'inp', type: 'number', step: 'any', value: pre ? pre.qty : 1 }), price = h('input', { class: 'inp', type: 'number', step: 'any', value: pre ? pre.price : '' }), ld = h('input', { class: 'inp', type: 'number', step: 'any', value: pre ? pre.discount : 0 });
    const lt = h('td', { class: 'num' }, '0.00'); const stock = h('td', { class: 'cd num' }, '');
    const base = () => byId('items', it.get());
    const setUnits = () => { const b = base(); unit.innerHTML = ''; if (!b) return; unit.append(h('option', { value: b.unit }, b.unit)); (um[b.id] || []).forEach(u => unit.append(h('option', { value: u.unit }, u.unit + ' (×' + fq(u.factor) + ')'))); stock.textContent = b.kind === 'stock' ? 'رصيد: ' + fq(b.qty) : ''; };
    const setPrice = () => { const b = base(); if (!b) return; const u = (um[b.id] || []).find(x => x.unit === unit.value); price.value = sale ? (u && u.price ? u.price : (u ? b.sale_price * u.factor : b.sale_price)) : (u ? (b.avg_cost * u.factor).toFixed(2) : b.avg_cost || ''); calc(); };
    it.inp.addEventListener('change', () => { setUnits(); setPrice(); }); unit.addEventListener('change', setPrice);
    [qty, price, ld].forEach(x => x.addEventListener('input', calc));
    const o = { it, unit, qty, price, ld, lt };
    if (pre) { it.set(pre.item_id); setUnits(); unit.value = pre.unit; }
    o.tr = h('tr', null, h('td', { style: { minWidth: '260px' } }, it.el), h('td', null, unit), h('td', { style: { width: '90px' } }, qty), h('td', { style: { width: '110px' } }, price), h('td', { style: { width: '90px' } }, ld), lt, stock, h('td', null, h('button', { class: 'btn sm danger', onclick: () => { lines.splice(lines.indexOf(o), 1); o.tr.remove(); calc(); } }, '×')));
    lines.push(o); tb.append(o.tr); calc(); return o;
  };
  const calc = () => {
    let sub = 0, tax = 0; const ld = +disc.get() || 0;
    lines.forEach(l => { const t = (+l.qty.value || 0) * (+l.price.value || 0) - (+l.ld.value || 0); l.t = t; sub += t; l.lt.textContent = fmt(t); });
    const ratio = sub > 0 ? (sub - ld) / sub : 0;
    lines.forEach(l => { const b = byId('items', l.it.get()); if (b) tax += l.t * ratio * ((b.tax_rate || 0) / 100); });
    const total = sub - ld + tax; calc.total = total;
    tot.innerHTML = ''; tot.append(h('div', null, 'الإجمالي', h('b', null, fmt(sub))), h('div', null, 'الخصم', h('b', null, fmt(ld))), h('div', null, 'الضريبة', h('b', null, fmt(tax))), h('div', null, 'الصافي', h('b', null, fmt(total))));
  };
  disc.el.addEventListener('input', calc);
  const grid = h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['الصنف', 'الوحدة', 'الكمية', 'السعر', 'خصم', 'الإجمالي', '', ''].map(t => h('th', null, t)))), tb);
  if (src) src.lines.forEach(l => addLine(l)); else addLine();
  const win = h('div');
  const L = (t, f) => h('label', { class: 'fld' }, h('span', null, t), f.el);
  const save = async () => {
    const ls = lines.filter(l => l.it.get()).map(l => ({ item_id: l.it.get(), unit: l.unit.value, qty: +l.qty.value, price: +l.price.value, discount: +l.ld.value || 0 }));
    if (!ls.length) throw new Error('أضف صنفاً واحداً على الأقل');
    const b = { type, date: date.get(), party_id: pf.get(), warehouse_id: wh.get(), pay_method: pm.get(), paid: pm.get() === 'credit' ? (+paid.get() || 0) : undefined, discount: +disc.get() || 0, notes: notes.get(), lines: ls };
    const r = await POST('/invoices', b);
    toast(r.status === 'pending' ? 'تم الحفظ وبانتظار الاعتماد: ' + r.number : 'تم الحفظ: ' + r.number);
    closeWin(MZ.active); await load('items', true); const pg = MZ.wins['inv-' + type]; pg && pg.refresh();
    return r;
  };
  win.append(pageHead(INV_AR[type] + ' جديد', btn('💾 حفظ' + (draftType ? '' : ' وترحيل'), save, 'pri'), btn('إغلاق', () => closeWin(MZ.active))),
    h('div', { class: 'panel' }, h('div', { class: 'pb' }, h('div', { class: 'inv-head' }, L(sale ? 'العميل' : 'المورد', pf), L('التاريخ', date), L('المخزن', wh), draftType ? null : L('طريقة الدفع', pm), draftType ? null : L('المدفوع (للآجل)', paid), L('خصم عام (قيمة)', disc), h('label', { class: 'fld', style: { gridColumn: '1/-1' } }, h('span', null, 'ملاحظات'), notes.el)))),
    h('div', { class: 'tbl-wrap' }, grid), btn('➕ إضافة صنف', () => addLine().it.inp.focus()), tot);
  return win;
}
async function showInvoice(id, listType) {
  const v = await GET('/invoices/' + id);
  const sale = v.type.startsWith('sale') || v.type === 'quote';
  const doc = h('div', { class: 'print-doc' }, companyHead(), h('h2', null, INV_AR[v.type] + ' رقم ' + v.number), h('div', { class: 'bc', html: ean13svg('299' + String(v.id).padStart(9, '0')) }),
    h('p', null, 'التاريخ: ' + v.date + ' | ' + (sale ? 'العميل: ' : 'المورد: ') + (v.party_name || 'نقدي') + ' | المخزن: ' + (v.warehouse_name || '')),
    table([{ t: 'م', f: (r, i) => i + 1 }, { t: 'الكود', k: 'item_code' }, { t: 'الصنف', k: 'item_name' }, { t: 'الوحدة', k: 'unit' }, { t: 'الكمية', f: r => fq(r.qty), cls: 'num' }, { t: 'السعر', k: 'price', num: 1 }, { t: 'خصم', k: 'discount', num: 1 }, { t: 'الإجمالي', k: 'total', num: 1 }], v.lines),
    h('div', { class: 'tot' }, h('span', null, 'الإجمالي: ' + fmt(v.subtotal)), h('span', null, 'الخصم: ' + fmt(v.discount)), h('span', null, 'الضريبة: ' + fmt(v.tax)), h('span', null, 'الصافي: ' + fmt(v.total)), h('span', null, 'المدفوع: ' + fmt(v.paid)), h('span', null, 'المتبقي: ' + fmt(v.total - v.paid))),
    h('p', null, v.notes || ''), h('p', null, MZ.settings.invoice_footer || ''));
  const btns = [{ t: '🖨 طباعة A4', fn: () => printEl(v.number, doc) }, { t: '🧾 إيصال 80مم', fn: () => printEl(v.number, doc, { size: '80' }) }];
  const mod = v.type.startsWith('purchase') ? 'purchases' : 'sales';
  if (v.status === 'pending' && can('approve:edit')) btns.push({ t: '✔ اعتماد', kind: 'pri', fn: async (c) => { await POST('/invoices/' + id + '/approve'); toast('تم الاعتماد والترحيل'); c(); refreshInv(v.type); } }, { t: '✖ رفض', fn: async (c) => { await POST('/invoices/' + id + '/reject'); c(); refreshInv(v.type); } });
  if (['quote', 'sale_order', 'purchase_order'].includes(v.type) && v.status !== 'converted' && can(mod + ':edit')) btns.push({ t: '⇢ تحويل إلى ' + (v.type === 'purchase_order' ? 'فاتورة مشتريات' : (v.type === 'quote' ? 'أمر بيع' : 'فاتورة مبيعات')), kind: 'pri', fn: async (c) => { const r = await POST('/invoices/' + id + '/convert', {}); toast('تم التحويل: ' + r.number); c(); refreshInv(v.type); } });
  if (v.status !== 'cancelled' && v.status !== 'converted' && can(mod + ':edit')) btns.push({ t: '🗑 إلغاء المستند', fn: async (c) => { if (await confirmBox('إلغاء المستند وعكس قيده وحركته المخزنية؟')) { await POST('/invoices/' + id + '/cancel'); toast('تم الإلغاء'); c(); await load('items', true); refreshInv(v.type); } } });
  modal(INV_AR[v.type] + ' ' + v.number + ' - ' + (STATUS_AR[v.status] || v.status), doc, btns, { wide: true });
}
const refreshInv = (t) => { const w = MZ.wins['inv-' + t]; w && w.refresh(); };
const invoicePage = (type) => async () => {
  await Promise.all([load('parties', true), load('items', true), load('warehouses', true), unitsMap()]);
  const sale = type.startsWith('sale') || type === 'quote'; let rows = []; const holder = h('div');
  const cols = [{ t: 'الرقم', k: 'number' }, { t: 'التاريخ', k: 'date' }, { t: sale ? 'العميل' : 'المورد', f: r => r.party_name || 'نقدي' }, { t: 'الإجمالي', k: 'total', num: 1 }, { t: 'المدفوع', k: 'paid', num: 1 }, { t: 'الحالة', f: r => h('span', { class: 'tag ' + ({ posted: 'ok', pending: 'warn', cancelled: 'bad', rejected: 'bad' }[r.status] || '') }, STATUS_AR[r.status] || r.status) }];
  const draw = () => { holder.innerHTML = ''; holder.append(table(cols, rows, { onrow: guard((r) => showInvoice(r.id)) }), h('div', { class: 'statusbar' }, h('span', null, 'عدد: ' + rows.length), h('span', null, 'الإجمالي: ' + fmt(rows.filter(r => r.status === 'posted').reduce((s, r) => s + r.total, 0))))); };
  const bar = filterBar([{ k: 'from', t: 'من', type: 'date' }, { k: 'to', t: 'إلى', type: 'date' }, { k: 'party_id', t: sale ? 'العميل' : 'المورد', type: 'ref', ref: partyOpts(sale ? 'customer' : 'supplier') }, { k: 'status', t: 'الحالة', type: 'select', options: Object.entries(STATUS_AR).map(([v, t]) => ({ v, t })) }, { k: 'q', t: 'بحث بالرقم' }], async (v) => { rows = await GET('/invoices' + qs({ ...v, type })); draw(); });
  rows = await GET('/invoices?type=' + type); draw();
  const mod = type.startsWith('purchase') ? 'purchases' : 'sales';
  return h('div', null, pageHead(INV_AR[type] + (type === 'sale' || type === 'purchase' ? 'ات' : ''), can(mod + ':edit') ? btn('➕ ' + INV_AR[type] + ' جديد', () => { const id = 'new-' + type + '-' + Date.now(); openWin(id, INV_AR[type] + ' جديد', () => invoiceEditor(type)); }, 'pri') : null), bar, h('div', { class: 'panel' }, holder));
};
['sale', 'sale_return', 'purchase', 'purchase_return', 'quote', 'sale_order', 'purchase_order'].forEach(t => { MZ.pages['inv-' + t] = invoicePage(t); });
MZ.pages.approvals = async () => {
  const rows = await GET('/invoices?status=pending');
  return h('div', null, pageHead('الاعتمادات المعلقة'), h('div', { class: 'panel' }, table([{ t: 'الرقم', k: 'number' }, { t: 'النوع', f: r => INV_AR[r.type] }, { t: 'التاريخ', k: 'date' }, { t: 'الإجمالي', k: 'total', num: 1 }], rows, { onrow: guard((r) => showInvoice(r.id)), empty: 'لا توجد مستندات بانتظار الاعتماد' })));
};

/* ---------- POS ---------- */
MZ.pages.pos = async () => {
  await Promise.all([load('items', true), load('warehouses', true), load('parties', true), unitsMap()]);
  const cart = []; const wh = mkField({ type: 'ref', ref: () => optsOf('warehouses') }); { const mw = mainWh(); if (mw) wh.set(mw.id); }
  const pm = mkField({ type: 'select', options: [{ v: 'cash', t: 'نقدي' }, { v: 'bank', t: 'بطاقة/بنك' }] }, 'cash');
  const search = h('input', { class: 'inp', placeholder: 'امسح الباركود أو ابحث باسم/كود الصنف ثم Enter', autofocus: true });
  const grid = h('div', { class: 'start' }), cartEl = h('div'), totalEl = h('div', { class: 'kpi pos' });
  const items = MZ.L.items.filter(i => i.active);
  const add = (it) => { const l = cart.find(x => x.item_id === it.id); if (l) l.qty++; else cart.push({ item_id: it.id, name: it.name, unit: it.unit, qty: 1, price: it.sale_price }); drawCart(); };
  const drawGrid = () => { const q = search.value.trim().toLowerCase(); grid.innerHTML = ''; items.filter(i => !q || (i.name + ' ' + (i.code || '') + ' ' + (i.barcode || '')).toLowerCase().includes(q)).slice(0, 60).forEach(i => grid.append(h('div', { class: 'sq', onclick: () => add(i) }, h('b', null, i.name), h('span', { class: 'cd' }, fmt(i.sale_price) + (i.kind === 'stock' ? ' | ' + fq(i.qty) : ''))))); };
  search.addEventListener('input', drawGrid);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = search.value.trim(); const ex = items.find(i => i.barcode === q || i.code === q); if (ex) { add(ex); search.value = ''; drawGrid(); } } });
  const drawCart = () => {
    cartEl.innerHTML = ''; let t = 0;
    cartEl.append(table([{ t: 'الصنف', k: 'name' }, { t: 'الكمية', f: l => h('input', { class: 'inp', type: 'number', value: l.qty, style: { width: '80px' }, oninput: (e) => { l.qty = +e.target.value; tot(); } }) }, { t: 'السعر', f: l => h('input', { class: 'inp', type: 'number', value: l.price, style: { width: '100px' }, oninput: (e) => { l.price = +e.target.value; tot(); } }) },
      { t: '', f: l => h('button', { class: 'btn sm danger', onclick: () => { cart.splice(cart.indexOf(l), 1); drawCart(); } }, '×') }], cart, { empty: 'السلة فارغة' }));
    tot();
  };
  const tot = () => { const t = cart.reduce((s, l) => s + l.qty * l.price, 0); totalEl.innerHTML = '<span>الإجمالي (قبل الضريبة)</span><b>' + fmt(t) + '</b>'; };
  const pay = async () => {
    if (!cart.length) throw new Error('السلة فارغة');
    const r = await POST('/invoices', { type: 'sale', date: today(), warehouse_id: wh.get(), pay_method: pm.get(), lines: cart.map(l => ({ item_id: l.item_id, unit: l.unit, qty: l.qty, price: l.price })), notes: 'نقطة بيع' });
    toast('تمت عملية البيع ' + r.number); cart.length = 0; drawCart(); await load('items', true); showInvoice(r.id);
  };
  drawGrid(); drawCart();
  return h('div', null, pageHead('نقطة البيع'), h('div', { class: 'cols2' }, h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'الأصناف'), h('div', { class: 'pb' }, search, h('div', { style: { height: '10px' } }), grid)),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'السلة'), h('div', { class: 'pb' }, h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, h('span', null, 'المخزن'), wh.el), h('label', { class: 'fld' }, h('span', null, 'الدفع'), pm.el)), cartEl, totalEl, h('div', { style: { marginTop: '10px' } }, btn('💵 دفع وإصدار فاتورة', pay, 'pri'))))));
};

/* ---------- stock operations ---------- */
MZ.pages.stock_adjust = async () => {
  await Promise.all([load('warehouses', true), load('items', true)]);
  const wh = mkField({ type: 'ref', ref: () => optsOf('warehouses') }); { const mw = mainWh(); if (mw) wh.set(mw.id); }
  const date = mkField({ type: 'date' }, today()); const holder = h('div'); let rows = [];
  const loadRows = async () => { const st = await GET('/reports/stock?by_wh=1&warehouse_id=' + wh.get()); const m = {}; st.forEach(s => m[s.id] = s.qty); rows = MZ.L.items.filter(i => i.kind === 'stock' && i.active).map(i => ({ ...i, cur: m[i.id] || 0, counted: '' })); draw(); };
  const draw = () => { holder.innerHTML = ''; holder.append(table([{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الدفتري', f: r => fq(r.cur), cls: 'num' }, { t: 'الفعلي (الجرد)', f: r => h('input', { class: 'inp', type: 'number', step: 'any', value: r.counted, style: { width: '120px' }, oninput: (e) => { r.counted = e.target.value; } }) }], rows)); };
  const save = async () => { const ls = rows.filter(r => r.counted !== '').map(r => ({ item_id: r.id, counted: +r.counted })); if (!ls.length) throw new Error('أدخل الكميات الفعلية'); const r = await POST('/stock/adjust', { date: date.get(), warehouse_id: wh.get(), lines: ls }); toast('تمت التسوية: ' + r.changed + ' صنف، قيمة الفرق ' + fmt(r.value)); await load('items', true); loadRows(); };
  wh.el.addEventListener('change', guard(loadRows)); await loadRows();
  return h('div', null, pageHead('جرد وتسوية المخزون', btn('💾 اعتماد التسوية', save, 'pri')), h('div', { class: 'filters' }, h('label', null, h('span', null, 'المخزن'), wh.el), h('label', null, h('span', null, 'التاريخ'), date.el)),
    h('p', { class: 'cd' }, 'أدخل الكمية الفعلية فقط للأصناف التي جردتها. الفروق تسجل حركة مخزنية وقيداً بفروق الجرد بمتوسط التكلفة. استخدمه أيضاً للرصيد الافتتاحي.'), h('div', { class: 'panel' }, holder));
};
MZ.pages.stock_transfer = async () => {
  await Promise.all([load('warehouses', true), load('items', true)]);
  const f = mkField({ type: 'ref', ref: () => optsOf('warehouses') }), t = mkField({ type: 'ref', ref: () => optsOf('warehouses') }), date = mkField({ type: 'date' }, today());
  const lines = []; const tb = h('tbody');
  const add = () => { const it = combo(optsOf('items', i => i.kind === 'stock')), q = h('input', { class: 'inp', type: 'number', step: 'any' }); const o = { it, q }; o.tr = h('tr', null, h('td', null, it.el), h('td', null, q), h('td', null, h('button', { class: 'btn sm danger', onclick: () => { lines.splice(lines.indexOf(o), 1); o.tr.remove(); } }, '×'))); lines.push(o); tb.append(o.tr); }; add();
  const save = async () => { const ls = lines.filter(l => l.it.get() && +l.q.value > 0).map(l => ({ item_id: l.it.get(), qty: +l.q.value })); if (!f.get() || !t.get() || !ls.length) throw new Error('أكمل البيانات'); await POST('/stock/transfer', { date: date.get(), from: f.get(), to: t.get(), lines: ls }); toast('تم التحويل'); lines.splice(0); tb.innerHTML = ''; add(); };
  return h('div', null, pageHead('تحويل بين المخازن', btn('💾 تنفيذ التحويل', save, 'pri')), h('div', { class: 'filters' }, h('label', null, h('span', null, 'من مخزن'), f.el), h('label', null, h('span', null, 'إلى مخزن'), t.el), h('label', null, h('span', null, 'التاريخ'), date.el)),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'الصنف'), h('th', null, 'الكمية (وحدة أساسية)'), h('th'))), tb)), btn('➕ صنف', add));
};
