'use strict';
/* Batch 1: Excel import/export, opening balances, year close, barcode/printing, cheques */

/* ---------- export (.xls that Excel opens, RTL) ---------- */
function exportXls(name, cols, rows) {
  const txt = (v) => (v && typeof v === 'object') ? (v.textContent || '') : (v ?? '');
  const cell = (c, r, i) => { let v = c.csv ? c.csv(r, i) : (c.f ? c.f(r, i) : r[c.k]); v = txt(v); return '<td>' + esc(String(v)) + '</td>'; };
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1" dir="rtl"><tr>' + cols.map(c => '<th style="background:#f5a623">' + esc(c.t) + '</th>').join('') + '</tr>' + rows.map((r, i) => '<tr>' + cols.map(c => cell(c, r, i)).join('') + '</tr>').join('') + '</table></body></html>';
  const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' })), download: name }); document.body.append(a); a.click(); a.remove();
}

/* ---------- file parsing: CSV and XLSX (no libraries) ---------- */
function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/[,;]/g) || []).length ? '\t' : ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
async function unzipFiles(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('الملف ليس xlsx صالحاً');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.slice(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true), st = lho + 30 + lnl + lel;
    files[name] = { method, data: u8.slice(st, st + cs) };
    p += 46 + nl + el + cl;
  }
  return files;
}
async function fileText(f) {
  if (!f) return null; if (f.method === 0) return new TextDecoder().decode(f.data);
  const s = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(s).arrayBuffer());
}
async function parseXlsx(buf) {
  const files = await unzipFiles(buf);
  const ss = [];
  const sst = await fileText(files['xl/sharedStrings.xml']);
  if (sst) { const d = new DOMParser().parseFromString(sst, 'text/xml'); d.querySelectorAll('si').forEach(si => ss.push([...si.querySelectorAll('t')].map(t => t.textContent).join(''))); }
  let sheet = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheet) throw new Error('لا توجد ورقة بيانات في الملف');
  const d = new DOMParser().parseFromString(await fileText(files[sheet]), 'text/xml');
  const col = (r) => { const m = /^([A-Z]+)/.exec(r)[1]; let n = 0; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rows = [];
  d.querySelectorAll('sheetData > row').forEach(rw => {
    const arr = [];
    rw.querySelectorAll('c').forEach(c => {
      const t = c.getAttribute('t'), v = c.querySelector('v'); let val = '';
      if (t === 's') val = ss[+(v ? v.textContent : 0)] ?? '';
      else if (t === 'inlineStr') val = [...c.querySelectorAll('t')].map(x => x.textContent).join('');
      else if (v) val = v.textContent;
      arr[col(c.getAttribute('r'))] = val;
    });
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
    rows.push(arr);
  });
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
async function readTable(file) {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name) || new Uint8Array(buf.slice(0, 2)).join() === '80,75') return parseXlsx(buf);
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('\ufffd')) t = new TextDecoder('windows-1256').decode(buf);
  return parseCsv(t);
}
const xlDate = (v) => { const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); if (/^\d{4,6}(\.\d+)?$/.test(s) && +s > 20000) return new Date(Math.round((+s - 25569) * 86400000)).toISOString().slice(0, 10); const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s); if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); return s; };
function resolveVal(f, v) {
  const T = f.type || 'text', s = String(v ?? '').trim(); if (s === '') return undefined;
  if (T === 'number') { const x = +s.replace(/,/g, ''); if (isNaN(x)) throw new Error('رقم غير صالح في "' + f.t + '": ' + s); return x; }
  if (T === 'check') return /^(1|true|yes|y|نعم|نشط)$/i.test(s) ? 1 : 0;
  if (T === 'date') return xlDate(s);
  if (T === 'ref') { const o = f.ref ? f.ref() : []; const m = o.find(x => x.t === s) || o.find(x => x.t.endsWith(' - ' + s)) || o.find(x => String(x.v) === s) || o.find(x => x.t.includes(s)); if (!m) throw new Error('"' + f.t + '" غير موجود: ' + s); return m.v; }
  if (T === 'select') { const m = (f.options || []).find(x => x.t === s || String(x.v) === s); if (!m) throw new Error('قيمة غير معروفة في "' + f.t + '": ' + s); return m.v; }
  return s;
}
const normH = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/* generic import dialog: fields = same field defs as the card form */
function importDialog(o) {
  const fields = o.fields.filter(f => !f.hide && !f.readonly);
  const out = h('div', { class: 'imp-out' }), file = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', class: 'inp' });
  let parsed = null;
  const info = h('p', { class: 'cd' }, 'الصف الأول يجب أن يحتوي أسماء الأعمدة: ' + fields.map(f => f.t.replace(' *', '')).join(' ، ') + '.  الحقول المعلّمة بـ * إجبارية.');
  const tpl = btn('⬇ تحميل نموذج', () => download((o.title || 'نموذج') + '-نموذج.csv', '\ufeff' + fields.map(f => '"' + f.t.replace(' *', '') + (f.req ? ' *' : '') + '"').join(',') + '\n'));
  file.addEventListener('change', guard(async () => {
    out.innerHTML = ''; parsed = null; if (!file.files[0]) return;
    const rows = await readTable(file.files[0]); if (rows.length < 2) throw new Error('الملف لا يحتوي بيانات');
    const hdr = rows[0].map(normH); const idx = {};
    fields.forEach(f => { const i = hdr.findIndex(x => x === normH(f.t) || x === normH(f.k)); if (i >= 0) idx[f.k] = i; });
    const missing = fields.filter(f => f.req && idx[f.k] === undefined);
    if (missing.length) throw new Error('أعمدة إجبارية ناقصة: ' + missing.map(f => f.t).join('، '));
    parsed = rows.slice(1).map(r => { const d = {}; fields.forEach(f => { if (idx[f.k] !== undefined) d[f.k] = r[idx[f.k]]; }); return d; });
    out.append(h('p', null, 'تم قراءة ' + parsed.length + ' صفاً. معاينة أول 5:'), table(fields.filter(f => idx[f.k] !== undefined).map(f => ({ t: f.t.replace(' *', ''), f: r => r[f.k] })), parsed.slice(0, 5)));
  }));
  const run = async (close) => {
    if (!parsed) throw new Error('اختر ملفاً أولاً');
    let ok = 0; const errs = [];
    for (let i = 0; i < parsed.length; i++) {
      try {
        const data = { ...(o.fixed || {}) };
        fields.forEach(f => { const v = resolveVal(f, parsed[i][f.k]); if (v !== undefined) data[f.k] = v; });
        for (const f of fields) if (f.req && (data[f.k] === undefined || data[f.k] === '')) throw new Error('الحقل مطلوب: ' + f.t);
        await POST(o.path, data); ok++;
      } catch (e) { errs.push('سطر ' + (i + 2) + ': ' + e.message); }
    }
    out.innerHTML = ''; out.append(h('p', { class: ok ? 'ok-t' : 'err-t' }, 'تم استيراد ' + ok + ' من ' + parsed.length + ' صفاً.'), errs.length ? h('div', { class: 'imp-err' }, errs.slice(0, 30).map(e => h('div', null, e))) : null);
    toast('تم استيراد ' + ok + ' صفاً', ok ? 'ok' : 'err'); o.onDone && await o.onDone();
    if (!errs.length) close();
  };
  modal('استيراد من Excel / CSV: ' + (o.title || ''), h('div', null, info, tpl, h('div', { style: { margin: '10px 0' } }, file), out), [{ t: '⬆ بدء الاستيراد', kind: 'pri', fn: run }], { wide: true });
}

/* ---------- barcode (EAN-13) ---------- */
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map(s => [...s].map(b => b === '0' ? '1' : '0').join(''));
const EAN_G = EAN_R.map(s => [...s].reverse().join(''));
const EAN_P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function eanFull(c12) { c12 = String(c12).replace(/\D/g, '').padStart(12, '0').slice(0, 12); let s = 0; for (let i = 0; i < 12; i++) s += +c12[i] * (i % 2 ? 3 : 1); return c12 + ((10 - s % 10) % 10); }
function ean13svg(code, h2) {
  const c = String(code).replace(/\D/g, ''); const full = c.length === 13 ? c : eanFull(c);
  const par = EAN_P[+full[0]]; let bits = '101';
  for (let i = 0; i < 6; i++) bits += (par[i] === 'L' ? EAN_L : EAN_G)[+full[i + 1]];
  bits += '01010'; for (let i = 0; i < 6; i++) bits += EAN_R[+full[i + 7]]; bits += '101';
  let rects = ''; for (let i = 0; i < bits.length; i++) if (bits[i] === '1') rects += '<rect x="' + (i + 9) + '" y="0" width="1" height="' + (h2 ? 40 : 46) + '"/>';
  const txt = '<text x="4" y="52" font-size="8" font-family="monospace">' + full[0] + '</text><text x="' + (9 + 3 + 21) + '" y="52" font-size="8" font-family="monospace" text-anchor="middle" letter-spacing="2.2">' + full.slice(1, 7) + '</text><text x="' + (9 + 50 + 21) + '" y="52" font-size="8" font-family="monospace" text-anchor="middle" letter-spacing="2.2">' + full.slice(7) + '</text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 113 56" fill="#000" preserveAspectRatio="xMidYMid meet" class="ean">' + rects + txt + '</svg>';
}
const itemEan = (it) => /^\d{12,13}$/.test(String(it.barcode || '')) ? String(it.barcode) : eanFull('200' + String(it.id).padStart(9, '0'));

/* ---------- printing (A4 / 80mm receipt) ---------- */
function printEl(title, el, opts = {}) {
  const w = window.open('', '_blank');
  if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'err'); return; }
  const cls = opts.size === '80' ? 'r80' : (opts.cls || '');
  const pg = opts.size === '80' ? '<style>@page{size:80mm auto;margin:3mm}</style>' : '<style>@page{size:A4;margin:12mm}</style>';
  w.document.write('<html dir="rtl"><head><meta charset="utf-8"><title>' + esc(title) + '</title><link rel="stylesheet" href="' + new URL('css/print.css', location.href).href + '">' + pg + '</head><body class="' + cls + '">' + el.outerHTML + '</body></html>');
  w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 500);
}

/* ---------- barcode labels page ---------- */
MZ.pages.labels = async () => {
  await load('items', true);
  const items = MZ.L.items.filter(i => i.active !== 0); const sel = new Set();
  const q = h('input', { class: 'inp', placeholder: 'بحث...', style: { maxWidth: '260px' } });
  const copies = h('input', { class: 'inp', type: 'number', value: 1, min: 1, style: { width: '80px' } });
  const holder = h('div');
  const draw = () => {
    const t = q.value.trim().toLowerCase(); const rows = items.filter(i => !t || (i.name + ' ' + (i.code || '') + ' ' + (i.barcode || '')).toLowerCase().includes(t));
    holder.innerHTML = '';
    holder.append(table([{ t: '✔', f: r => { const c = h('input', { type: 'checkbox', class: 'chk', onclick: (e) => { e.stopPropagation(); c.checked ? sel.add(r.id) : sel.delete(r.id); } }); c.checked = sel.has(r.id); return c; } }, { t: 'الكود', k: 'code' }, { t: 'الصنف', k: 'name' }, { t: 'الباركود', f: r => itemEan(r) + (/^\d{12,13}$/.test(String(r.barcode || '')) ? '' : ' (تلقائي)') }, { t: 'السعر', f: r => fmt(r.sale_price), cls: 'num' }], rows));
  };
  q.addEventListener('input', draw);
  const labelsHtml = () => {
    const pick = items.filter(i => sel.has(i.id)); if (!pick.length) throw new Error('اختر صنفاً واحداً على الأقل');
    const n = Math.max(1, +copies.value || 1); const wrap = h('div', { class: 'labels' });
    pick.forEach(i => { for (let k = 0; k < n; k++) wrap.append(h('div', { class: 'lbl' }, h('div', { class: 'ln' }, i.name), h('div', { html: ean13svg(itemEan(i)) }), h('div', { class: 'lp' }, fmt(i.sale_price) + ' ' + (MZ.settings.currency || '')))); });
    return wrap;
  };
  const assign = async () => {
    const need2 = items.filter(i => !/^\d{12,13}$/.test(String(i.barcode || '')));
    if (!need2.length) return toast('كل الأصناف لها باركود');
    if (!(await confirmBox('تعيين باركود تلقائي ل ' + need2.length + ' صنف بلا باركود؟'))) return;
    for (const i of need2) await PUT('/items/' + i.id, { barcode: itemEan(i) });
    await load('items', true); toast('تم تعيين الباركود'); items.splice(0, items.length, ...MZ.L.items.filter(x => x.active !== 0)); draw();
  };
  draw();
  return h('div', null, pageHead('طباعة باركود الأصناف', btn('🖨 طباعة الملصقات', () => printEl('ملصقات', labelsHtml(), { cls: 'lblpage' }), 'pri'), can('items:edit') ? btn('🏷 تعيين باركود تلقائي', assign) : null,
    btn('تحديد الكل', () => { items.forEach(i => sel.add(i.id)); draw(); }), btn('إلغاء التحديد', () => { sel.clear(); draw(); })),
    h('div', { class: 'filters' }, h('label', null, h('span', null, 'بحث'), q), h('label', null, h('span', null, 'عدد النسخ لكل صنف'), copies)), h('div', { class: 'panel' }, holder));
};

/* ---------- opening balances ---------- */
MZ.pages.opening = async () => {
  await Promise.all([load('accounts', true), load('parties', true)]);
  const date = mkField({ type: 'date' }, today().slice(0, 4) + '-01-01'), auto = mkField({ type: 'check' }, 1), desc = mkField({}, 'قيد الأرصدة الافتتاحية');
  const tb = h('tbody'), lines = []; const tot = h('div', { class: 'totals' });
  const calc = () => { let d = 0, c = 0; lines.forEach(l => { d += +l.dr.value || 0; c += +l.cr.value || 0; }); tot.innerHTML = ''; tot.append(h('div', null, 'إجمالي المدين', h('b', null, fmt(d))), h('div', null, 'إجمالي الدائن', h('b', null, fmt(c))), h('div', null, 'الفرق', h('b', { style: { color: Math.abs(d - c) < 0.005 ? '#2e7d32' : '#c62828' } }, fmt(d - c)))); };
  const addLine = (pre) => {
    const acc = combo(leafAcc()), pt = combo(optsOf('parties', null, p => p.name + (p.type === 'customer' ? ' (عميل)' : ' (مورد)'))), dr = h('input', { class: 'inp', type: 'number', step: 'any', value: pre ? pre.debit : '' }), cr = h('input', { class: 'inp', type: 'number', step: 'any', value: pre ? pre.credit : '' });
    if (pre && pre.account_id) acc.set(pre.account_id); if (pre && pre.party_id) pt.set(pre.party_id);
    [dr, cr].forEach(x => x.addEventListener('input', calc));
    const o = { acc, pt, dr, cr }; o.tr = h('tr', null, h('td', { style: { minWidth: '240px' } }, acc.el), h('td', { style: { minWidth: '200px' } }, pt.el), h('td', null, dr), h('td', null, cr), h('td', null, h('button', { class: 'btn', onclick: () => { lines.splice(lines.indexOf(o), 1); o.tr.remove(); calc(); } }, '×')));
    lines.push(o); tb.append(o.tr); calc(); return o;
  };
  for (let i = 0; i < 4; i++) addLine();
  const fileImp = async () => {
    const inp = h('input', { type: 'file', accept: '.xlsx,.csv' });
    inp.onchange = guard(async () => {
      const rows = await readTable(inp.files[0]); const hdr = rows[0].map(normH);
      const ix = (...n) => hdr.findIndex(x => n.some(k => x === k));
      const ia = ix('الحساب', 'كود الحساب', 'account', 'code'), ip = ix('العميل/المورد', 'الطرف', 'party'), id = ix('مدين', 'debit'), ic = ix('دائن', 'credit');
      if (ia < 0 || (id < 0 && ic < 0)) throw new Error('الأعمدة المطلوبة: الحساب، مدين، دائن (والطرف اختياري)');
      const opts = leafAcc(), popts = optsOf('parties', null, p => p.name); let n = 0;
      lines.splice(0, lines.length); tb.innerHTML = '';
      for (const r of rows.slice(1)) {
        const s = String(r[ia]).trim(); const a = opts.find(x => x.t === s || x.t.startsWith(s + ' ') || x.t.endsWith(' - ' + s)); if (!a) throw new Error('حساب غير موجود: ' + s);
        let pid = null; if (ip >= 0 && String(r[ip]).trim()) { const p = popts.find(x => x.t === String(r[ip]).trim()); if (!p) throw new Error('طرف غير موجود: ' + r[ip]); pid = p.v; }
        addLine({ account_id: a.v, party_id: pid, debit: id >= 0 ? (+String(r[id]).replace(/,/g, '') || '') : '', credit: ic >= 0 ? (+String(r[ic]).replace(/,/g, '') || '') : '' }); n++;
      }
      toast('تم تحميل ' + n + ' سطراً من الملف');
    }); inp.click();
  };
  const save = async () => {
    const ls = lines.filter(l => l.acc.get() && ((+l.dr.value || 0) > 0 || (+l.cr.value || 0) > 0)).map(l => ({ account_id: l.acc.get(), party_id: l.pt.get(), debit: +l.dr.value || 0, credit: +l.cr.value || 0 }));
    if (!ls.length) throw new Error('أدخل سطراً واحداً على الأقل');
    const r = await POST('/opening', { date: date.get(), description: desc.get(), auto_balance: auto.get(), lines: ls });
    toast('تم ترحيل القيد الافتتاحي ' + r.number); await load('parties', true);
    lines.splice(0, lines.length); tb.innerHTML = ''; for (let i = 0; i < 4; i++) addLine();
  };
  const L2 = (t, f) => h('label', { class: 'fld' }, h('span', null, t), f.el);
  const grid = h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['الحساب', 'العميل/المورد (لأرصدة الذمم)', 'مدين', 'دائن', ''].map(t => h('th', null, t)))), tb);
  return h('div', null, pageHead('القيد الافتتاحي (الأرصدة الافتتاحية)', can('journal:edit') ? btn('💾 ترحيل القيد', save, 'pri') : null, btn('⬆ استيراد من Excel', fileImp)),
    h('div', { class: 'panel' }, h('div', { class: 'pb' }, h('div', { class: 'inv-head' }, L2('تاريخ الرصيد الافتتاحي', date), L2('البيان', desc), L2('ترصيد الفرق تلقائياً في حساب الأرصدة الافتتاحية', auto)),
      h('p', { class: 'cd' }, 'للعملاء والموردين: اختر حساب العملاء/الموردين واختر الطرف نفسه ليظهر رصيده في كشف الحساب وأعمار الديون. أرصدة المخزون الافتتاحية تُدخل من شاشة جرد وتسوية.'))),
    h('div', { class: 'tbl-wrap' }, grid), btn('➕ سطر', () => addLine()), tot);
};

/* ---------- year close ---------- */
MZ.pages.yearclose = async () => {
  const year = h('input', { class: 'inp', type: 'number', value: new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0), style: { width: '110px' } });
  const lock = h('input', { type: 'checkbox', class: 'chk', checked: true });
  const box = h('div', { class: 'panel' });
  const preview = async () => {
    const p = await GET('/year/preview' + qs({ year: year.value }));
    box.innerHTML = '';
    box.append(h('div', { class: 'pb' }, h('div', { class: 'cards' }, [['إيرادات السنة', p.revenue], ['مصروفات السنة', p.expense], ['صافي الربح / (الخسارة)', p.profit]].map(([t, v]) => h('div', { class: 'card' }, h('div', { class: 'cd' }, t), h('b', { style: { color: v < 0 ? '#c62828' : '#2e7d32', fontSize: '20px' } }, fmt(v))))),
      h('p', null, p.closed ? '✅ هذه السنة مقفلة بالفعل.' : 'عدد حسابات الإيرادات والمصروفات المتحركة: ' + p.accounts), h('p', { class: 'cd' }, 'تاريخ القفل الحالي: ' + (p.lock_date || 'لا يوجد')),
      h('p', { class: 'cd' }, 'الإقفال ينشئ قيداً بتاريخ 31 ديسمبر يصفّر الإيرادات والمصروفات ويرحّل الصافي إلى الأرباح المحتجزة (3102). عند تفعيل القفل لا يمكن التسجيل أو التعديل في تواريخ حتى نهاية السنة.')));
  };
  const close = async () => {
    const p = await GET('/year/preview' + qs({ year: year.value })); if (p.closed) throw new Error('هذه السنة مقفلة بالفعل');
    if (!(await confirmBox('إقفال سنة ' + year.value + ' بصافي ' + fmt(p.profit) + (lock.checked ? ' وقفل الفترة؟ لا يمكن التسجيل بعد ذلك في هذه الفترة.' : '؟')))) return;
    const r = await POST('/year/close', { year: +year.value, lock: lock.checked }); toast('تم الإقفال: ' + r.number); await preview();
    const me = await GET('/me'); MZ.settings = me.settings;
  };
  const bar = h('div', { class: 'filters' }, h('label', null, h('span', null, 'السنة المالية'), year), h('label', null, h('span', null, 'قفل الفترة بعد الإقفال'), lock), btn('معاينة', preview, 'pri'), can('settings:edit') ? btn('🔒 إقفال السنة', close) : null);
  return h('div', null, pageHead('إقفال السنة المالية'), bar, box);
};

/* ---------- cheques ---------- */
const CQ_TYPE = { receivable: 'شيك وارد (قبض)', payable: 'شيك صادر (دفع)' };
const CQ_ST = { pending: 'معلّق', collected: 'تم التحصيل/الصرف', bounced: 'مرتد' };
MZ.pages.cheques = async () => {
  await Promise.all([load('parties', true), load('accounts', true)]);
  const holder = h('div'), cards = h('div', { class: 'cards' });
  let rows = [];
  const fb = filterBar([{ k: 'type', t: 'النوع', type: 'select', options: [{ v: 'receivable', t: 'وارد' }, { v: 'payable', t: 'صادر' }] }, { k: 'status', t: 'الحالة', type: 'select', options: [{ v: 'pending', t: 'معلّق' }, { v: 'collected', t: 'تم' }, { v: 'bounced', t: 'مرتد' }] }], async (v) => { rows = await GET('/cheques' + qs(v)); draw(); }, { status: 'pending' });
  const days = (d) => Math.round((new Date(String(d).slice(0, 10)) - new Date(today())) / 86400000);
  const draw = () => {
    const pend = rows.filter(r => r.status === 'pending'); const sum = (a) => a.reduce((s, r) => s + Number(r.amount), 0);
    cards.innerHTML = ''; [['معلّق وارد', sum(pend.filter(r => r.type === 'receivable')), '#2e7d32'], ['معلّق صادر', sum(pend.filter(r => r.type === 'payable')), '#c62828'], ['مستحق خلال 7 أيام', sum(pend.filter(r => days(r.due_date) <= 7)), '#e8860c']].forEach(([t, v, c]) => cards.append(h('div', { class: 'card' }, h('div', { class: 'cd' }, t), h('b', { style: { color: c, fontSize: '20px' } }, fmt(v)))));
    holder.innerHTML = '';
    holder.append(table([{ t: 'النوع', f: r => CQ_TYPE[r.type] }, { t: 'رقم الشيك', k: 'number' }, { t: 'البنك', k: 'bank' }, { t: 'الطرف', k: 'party_name' }, { t: 'المبلغ', f: r => fmt(r.amount), cls: 'num' }, { t: 'الاستحقاق', f: r => String(r.due_date).slice(0, 10) },
      { t: 'الحالة', f: r => { const d = days(r.due_date); const late = r.status === 'pending' && d < 0; return h('span', { class: 'tag ' + (r.status === 'collected' ? 'ok' : (r.status === 'bounced' || late ? 'bad' : '')) }, late ? 'متأخر ' + (-d) + ' يوم' : CQ_ST[r.status]); } }], rows, { onrow: (r) => show(r.id) }));
  };
  const reload = async () => { rows = await GET('/cheques' + qs(fb.values())); draw(); };
  const show = guard(async (id) => {
    const c = await GET('/cheques/' + id);
    const bank = mkField({ type: 'ref', ref: () => optsOf('accounts', a => !a.is_group && a.active && a.type === 'asset', accLabel) }, +MZ.settings.acc_bank || null), dt = mkField({ type: 'date' }, today());
    const body = h('div', null, h('div', { class: 'form-grid' }, [['النوع', CQ_TYPE[c.type]], ['رقم الشيك', c.number], ['البنك', c.bank || '-'], ['الطرف', c.party_name], ['المبلغ', fmt(c.amount)], ['تاريخ الاستحقاق', String(c.due_date).slice(0, 10)], ['الحالة', CQ_ST[c.status]], ['ملاحظات', c.notes || '-']].map(([k, v]) => h('div', { class: 'fld' }, h('span', null, k), h('b', null, v)))),
      c.status === 'pending' && can('vouchers:edit') ? h('div', { class: 'form-grid', style: { marginTop: '12px' } }, h('label', { class: 'fld' }, h('span', null, 'التاريخ'), dt.el), h('label', { class: 'fld' }, h('span', null, c.type === 'receivable' ? 'الإيداع في (بنك/خزينة)' : 'الصرف من (بنك/خزينة)'), bank.el)) : null);
    const bt = [];
    if (c.status === 'pending' && can('vouchers:edit')) {
      bt.push({ t: c.type === 'receivable' ? '✔ تحصيل' : '✔ صرف', kind: 'pri', fn: async (cl) => { await POST('/cheques/' + id + '/collect', { date: dt.get(), account_id: bank.get() }); toast('تمت التسوية'); cl(); reload(); } },
        { t: '↩ ارتداد', fn: async (cl) => { if (await confirmBox('تسجيل الشيك كمرتد وإعادة المديونية؟')) { await POST('/cheques/' + id + '/bounce', { date: dt.get() }); toast('تم تسجيل الارتداد'); cl(); reload(); } } },
        { t: '🗑 حذف', fn: async (cl) => { if (await confirmBox('حذف الشيك وقيده؟')) { await DEL('/cheques/' + id); toast('تم الحذف'); cl(); reload(); } } });
    }
    modal('شيك رقم ' + c.number, body, bt);
  });
  const add = () => {
    const f = formFor([{ k: 'type', t: 'النوع', type: 'select', options: [{ v: 'receivable', t: 'شيك وارد (من عميل)' }, { v: 'payable', t: 'شيك صادر (لمورد)' }], req: 1, def: 'receivable' }, { k: 'number', t: 'رقم الشيك', req: 1 }, { k: 'bank', t: 'البنك' },
      { k: 'party_id', t: 'العميل/المورد', type: 'ref', ref: () => optsOf('parties', null, p => p.name + (p.type === 'customer' ? ' (عميل)' : ' (مورد)')), req: 1 }, { k: 'amount', t: 'المبلغ', type: 'number', req: 1 }, { k: 'issue_date', t: 'تاريخ التحرير', type: 'date', def: today() }, { k: 'due_date', t: 'تاريخ الاستحقاق', type: 'date', req: 1 }, { k: 'notes', t: 'ملاحظات', full: 1 }], { type: 'receivable', issue_date: today() });
    modal('شيك جديد', f.el, [{ t: '💾 حفظ وترحيل', kind: 'pri', fn: async (cl) => { const d = f.get(); for (const k of ['number', 'party_id', 'amount', 'due_date']) if (!d[k]) throw new Error('أكمل الحقول المطلوبة'); await POST('/cheques', d); toast('تم تسجيل الشيك'); cl(); reload(); } }]);
  };
  await reload();
  return h('div', null, pageHead('الشيكات وأوراق القبض والدفع', can('vouchers:edit') ? btn('➕ شيك جديد', add, 'pri') : null, btn('تصدير Excel', () => exportXls('الشيكات.xls', [{ t: 'النوع', f: r => CQ_TYPE[r.type] }, { t: 'الرقم', k: 'number' }, { t: 'البنك', k: 'bank' }, { t: 'الطرف', k: 'party_name' }, { t: 'المبلغ', k: 'amount' }, { t: 'الاستحقاق', f: r => String(r.due_date).slice(0, 10) }, { t: 'الحالة', f: r => CQ_ST[r.status] }], rows))), fb, cards, h('div', { class: 'panel' }, holder));
};
