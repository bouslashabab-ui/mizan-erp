'use strict';
/* Phase 4 pages: cash flow, dated inventory valuation, reorder report, monthly period lock, home polish */
const note = (t) => h('div', { class: 'panel' }, h('div', { class: 'pb', style: { color: '#5a4a1a', background: '#fff8e6' } }, t));
const kp = (t, v, c) => h('div', { class: 'kpi ' + (c || '') }, h('span', null, t), h('b', null, v));
const cfSec = (title, sec, sign) => h('div', { class: 'panel' }, h('div', { class: 'ph' }, title), table([{ t: 'البند', k: 'name' }, { t: 'المبلغ', f: r => fmt(r.amount), cls: 'num' }], sec.rows, { foot: ['الصافي', fmt(sec.total)], empty: 'لا توجد حركة' }));
MZ.pages.cashflow = reportPage('قائمة التدفقات النقدية', dateFields(), (v) => GET('/reports/cashflow' + qs({ from: v.from, to: v.to })), (d) => h('div', null,
  h('div', { class: 'kpis' }, kp('رصيد النقدية أول الفترة', fmt(d.opening)), kp('صافي التدفق', fmt(d.net), d.net >= 0 ? 'pos' : 'neg'), kp('رصيد النقدية آخر الفترة', fmt(d.closing), 'pos')),
  cfSec('الأنشطة التشغيلية', d.operating), cfSec('الأنشطة الاستثمارية (أصول ثابتة)', d.investing), cfSec('الأنشطة التمويلية (حقوق الملكية)', d.financing),
  h('div', { class: 'panel' }, h('div', { class: 'pb', style: { fontWeight: 700, color: Math.abs(d.check) < 0.005 ? '#1d6b3a' : '#b3261e' } }, Math.abs(d.check) < 0.005 ? '✔ مطابقة: الرصيد الأول + صافي التدفق = الرصيد الأخير' : '✖ فرق مطابقة ' + fmt(d.check)),
    h('div', { class: 'pb' }, 'الطريقة المباشرة: كل حركة على حسابات النقدية والبنوك تُصنَّف حسب الحساب المقابل (أصول ثابتة = استثماري، حقوق ملكية = تمويلي، الباقي تشغيلي).'))));
MZ.pages.stock_val = reportPage('تقييم المخزون بتاريخ', [{ k: 'to', t: 'كما في تاريخ', type: 'date', def: today() }], (v) => GET('/reports/valuation' + qs({ to: v.to })), (d) => h('div', null,
  h('div', { class: 'kpis' }, kp('قيمة المخزون', fmt(d.total), 'pos'), d.gl === null ? null : kp('رصيد حساب المخزون بالأستاذ', fmt(d.gl)), d.diff === null ? null : kp('الفرق (مخزن - أستاذ)', fmt(d.diff), Math.abs(d.diff) < 0.005 ? 'pos' : 'neg')),
  h('div', { class: 'panel' }, table([{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الوحدة', k: 'unit' }, { t: 'الكمية', f: r => fmt(r.qty, 3).replace(/\.?0+$/, ''), cls: 'num' }, { t: 'متوسط التكلفة', f: r => fmt(r.avg), cls: 'num' }, { t: 'القيمة', f: r => fmt(r.value), cls: 'num' }], d.rows, { foot: ['', '', '', '', 'الإجمالي', fmt(d.total)], empty: 'لا مخزون في هذا التاريخ' })),
  note('القيمة = مجموع (الكمية × تكلفة الحركة) لكل حركات المخزن حتى التاريخ. أي فرق مع الأستاذ يعني قيودًا يدوية على حساب المخزون أو حركات بلا قيد.')));
MZ.pages.reorder = reportPage('أصناف تحتاج إعادة طلب', [], () => GET('/reports/reorder'), (d) => h('div', null,
  h('div', { class: 'kpis' }, kp('عدد الأصناف', d.rows.length, d.rows.length ? 'neg' : 'pos'), kp('تكلفة الطلب المقترح (تقديري)', fmt(d.total_est))),
  h('div', { class: 'panel' }, table([{ t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الرصيد', f: r => h('b', { style: { color: r.out ? '#b3261e' : '#8a4b00' } }, fmt(r.qty, 3).replace(/\.?0+$/, '')), cls: 'num' }, { t: 'حد إعادة الطلب', f: r => fmt(r.min_qty, 3).replace(/\.?0+$/, ''), cls: 'num' }, { t: 'العجز', f: r => fmt(r.short, 3).replace(/\.?0+$/, ''), cls: 'num' }, { t: 'الكمية المقترحة', f: r => fmt(r.suggest, 3).replace(/\.?0+$/, ''), cls: 'num' }, { t: 'تكلفة تقديرية', f: r => fmt(r.est_cost), cls: 'num' }, { t: 'الحالة', f: r => r.out ? h('span', { class: 'tag bad' }, 'نفد') : h('span', { class: 'tag' }, 'قارب النفاد') }], d.rows, { empty: '✔ لا توجد أصناف تحت حد إعادة الطلب' })),
  note('الكمية المقترحة = ضعف حد إعادة الطلب ناقص الرصيد الحالي. حدد حد إعادة الطلب من بطاقة الصنف.')));
MZ.pages.periods = async () => {
  const d = await GET('/period'); const admin = can('settings:edit');
  const set = async (date) => { if (await confirmBox(date ? 'قفل كل الفترات حتى ' + date + '؟ لن يمكن تسجيل أي مستند بتاريخ قبلها.' : 'فتح كل الفترات؟ سيصبح التسجيل بأي تاريخ ممكنًا.')) { await POST('/period', { lock_date: date }); toast('تم'); openPage('periods'); } };
  return h('div', null, pageHead('🔒 قفل الفترات الشهرية'), h('div', { class: 'kpis' }, kp('الفترات مقفلة حتى', d.lock_date || 'لا يوجد قفل', d.lock_date ? 'pos' : '')),
    note('القفل يمنع تسجيل أو تعديل أي قيد أو مستند بتاريخ يسبق نهاية الشهر المقفل. يطبّق على كل المستندات لأنها كلها تمر بالقيود. الفتح والقفل يُسجَّلان في سجل المراجعة.'),
    h('div', { class: 'panel' }, table([{ t: 'الشهر', k: 'month' }, { t: 'عدد القيود', k: 'entries', cls: 'num' }, { t: 'نهاية الشهر', k: 'end' }, { t: 'الحالة', f: r => r.locked ? h('span', { class: 'tag ok' }, '🔒 مقفل') : h('span', { class: 'tag' }, 'مفتوح') }, { t: '', f: r => admin ? (r.locked ? '' : btn('قفل حتى هذا الشهر', () => set(r.end), 'sm')) : '' }], d.months, { empty: 'لا قيود بعد' })),
    admin && d.lock_date ? btn('فتح كل الفترات', () => set(''), 'sm') : null);
};
MZ.pages.backup = async () => {
  const run = async () => { const d = await GET('/backup'); const day = today(); const blob = new Blob([JSON.stringify(d)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mizan-backup-' + day + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('تم تنزيل النسخة: ' + d.tables + ' جدول و ' + d.rows + ' سجل'); };
  return h('div', null, pageHead('💾 النسخ الاحتياطي'), h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'نسخة كاملة بضغطة واحدة'), h('div', { class: 'pb' }, h('p', null, 'تنزيل ملف JSON بكل بيانات النظام (الحسابات، القيود، الأصناف، المخزون، الفواتير، السندات، الموظفين وغيرها).'), btn('⬇ تنزيل نسخة احتياطية كاملة', run, 'pri'))),
    note('كلمات مرور المستخدمين لا تُضمَّن في النسخة. احفظ النسخة خارج الموقع (جوجل درايف أو الهاتف) أسبوعيًا على الأقل. الاستعادة التلقائية من الملف غير مفعّلة بعد حفاظًا على البيانات، وتتم عند الحاجة بدعم فني.'));
};
/* home polish */
(function () {
  const orig = MZ.pages.home; const bar = (l, v, mx, c) => h('div', { class: 'bar-row' }, h('span', { class: 'bl' }, l), h('div', { class: 'bt' }, h('i', { style: { width: (mx ? Math.max(2, Math.round(Math.abs(v) / mx * 100)) : 0) + '%', background: c } })), h('b', null, fmt(v)));
  MZ.pages.home = async () => {
    const root = await orig(); const x = h('div', { class: 'dash-x' });
    const jobs = await Promise.allSettled([GET('/reports/dashboard'), GET('/reports/reorder'), GET('/period')]); const ok = (i) => jobs[i].status === 'fulfilled' ? jobs[i].value : null; const d = ok(0), ro = ok(1), pe = ok(2);
    if (d) { const mx = Math.max(Math.abs(d.cash), Math.abs(d.ar), Math.abs(d.ap), Math.abs(d.stock), 1); x.append(h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'المركز الحالي'), h('div', { class: 'pb' }, bar('النقدية', d.cash, mx, '#2b4a45'), bar('العملاء', d.ar, mx, '#7fb800'), bar('الموردون', d.ap, mx, '#e07a1f'), bar('المخزون', d.stock, mx, '#1d6b3a')))); }
    if (ro) x.append(h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'تنبيهات المخزون'), h('div', { class: 'pb' }, ro.rows.length ? [...ro.rows.slice(0, 5).map(r => h('div', { class: 'alert-line' }, (r.out ? '⛔ ' : '⚠ ') + r.name + ': ' + fmt(r.qty, 3).replace(/\.?0+$/, '') + ' من ' + fmt(r.min_qty, 3).replace(/\.?0+$/, ''))), btn('تقرير إعادة الطلب', () => openPage('reorder'), 'sm')] : '✔ لا توجد أصناف تحت حد إعادة الطلب')));
    if (pe) x.append(h('div', { class: 'panel' }, h('div', { class: 'ph' }, 'حالة الفترات'), h('div', { class: 'pb' }, h('div', { class: 'lock-st' }, pe.lock_date ? '🔒 مقفلة حتى ' + pe.lock_date : '🔓 كل الفترات مفتوحة'), btn('إدارة الفترات', () => openPage('periods'), 'sm'), ' ', can('settings:edit') ? btn('💾 نسخة احتياطية', () => openPage('backup'), 'sm') : null, ' ', btn('التدفقات النقدية', () => openPage('cashflow'), 'sm'))));
    root.append(x); return root;
  };
})();
