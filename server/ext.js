'use strict';
// Cheques, opening balances, year-end close
const C = require('./core');
const { bad, money, isDate, HttpError } = C;
const Q = async (sql, p) => (await C.db().query(sql, p))[0];
const need = (u, perm) => { if (!C.can(u, perm)) throw new HttpError(403, 'ليست لديك صلاحية'); };

async function ensureAcc(conn, key, code, name, type, parentCode) {
  const s = await C.getSettings(conn);
  if (s[key]) { const [a] = await conn.query('SELECT id FROM accounts WHERE id=?', [+s[key]]); if (a[0]) return a[0].id; }
  let [a] = await conn.query('SELECT id FROM accounts WHERE code=?', [code]);
  let id;
  if (a[0]) id = a[0].id;
  else {
    const [p] = await conn.query('SELECT id FROM accounts WHERE code=?', [parentCode]);
    const [r] = await conn.query('INSERT INTO accounts(code,name,parent_id,type,is_group,active) VALUES(?,?,?,?,0,1)', [code, name, p[0] ? p[0].id : null, type]);
    id = r.insertId;
  }
  await conn.query('INSERT INTO settings(k,v) VALUES(?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [key, String(id)]);
  return id;
}

const CH_SQL = 'SELECT c.*, p.name party_name FROM cheques c LEFT JOIN parties p ON p.id=c.party_id';

async function chequeCreate(u, b) {
  const type = b.type === 'payable' ? 'payable' : 'receivable';
  const amount = money(b.amount);
  if (!(amount > 0)) throw bad('أدخل مبلغ الشيك');
  if (!String(b.number || '').trim()) throw bad('أدخل رقم الشيك');
  if (!isDate(b.due_date)) throw bad('تاريخ الاستحقاق غير صحيح');
  const issue = isDate(b.issue_date) ? b.issue_date : new Date().toISOString().slice(0, 10);
  if (!b.party_id) throw bad('اختر العميل/المورد');
  return C.tx(async (conn) => {
    const [p] = await conn.query('SELECT id,type FROM parties WHERE id=?', [b.party_id]);
    if (!p[0]) throw bad('الطرف غير موجود');
    const s = await C.getSettings(conn);
    let lines;
    if (type === 'receivable') {
      const notes = await ensureAcc(conn, 'acc_notes_rec', '1106', 'أوراق القبض (شيكات)', 'asset', '11');
      lines = [{ account_id: notes, debit: amount, credit: 0, party_id: null }, { account_id: +s.acc_ar, debit: 0, credit: amount, party_id: p[0].id }];
    } else {
      const notes = await ensureAcc(conn, 'acc_notes_pay', '2105', 'أوراق الدفع (شيكات)', 'liability', '21');
      lines = [{ account_id: +s.acc_ap, debit: amount, credit: 0, party_id: p[0].id }, { account_id: notes, debit: 0, credit: amount, party_id: null }];
    }
    const e = await C.postEntry(conn, { type: 'CQ', date: issue, description: (type === 'receivable' ? 'استلام شيك رقم ' : 'إصدار شيك رقم ') + b.number, lines, user: u, ref_type: 'cheque', ref_id: 0 });
    const [r] = await conn.query('INSERT INTO cheques(type,number,bank,party_id,amount,issue_date,due_date,status,notes,reg_entry_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [type, String(b.number).trim(), b.bank || null, p[0].id, amount, issue, b.due_date, 'pending', b.notes || null, e.id, u.id]);
    await conn.query('UPDATE journal_entries SET ref_id=? WHERE id=?', [r.insertId, e.id]);
    await C.audit(u, 'create', 'cheque', r.insertId, type + ' ' + b.number + ' ' + amount, conn);
    return { id: r.insertId };
  });
}

async function chequeAct(u, id, act, b) {
  return C.tx(async (conn) => {
    const [r] = await conn.query('SELECT * FROM cheques WHERE id=? FOR UPDATE', [id]);
    const c = r[0]; if (!c) throw new HttpError(404, 'الشيك غير موجود');
    if (c.status !== 'pending') throw bad('الشيك ليس في حالة معلّق');
    const s = await C.getSettings(conn);
    const date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
    const rec = c.type === 'receivable';
    const notes = await ensureAcc(conn, rec ? 'acc_notes_rec' : 'acc_notes_pay', rec ? '1106' : '2105', rec ? 'أوراق القبض (شيكات)' : 'أوراق الدفع (شيكات)', rec ? 'asset' : 'liability', rec ? '11' : '21');
    let e;
    if (act === 'collect') {
      const bank = +(b.account_id || s.acc_bank); if (!bank) throw bad('اختر حساب البنك');
      const lines = rec ? [{ account_id: bank, debit: c.amount, credit: 0 }, { account_id: notes, debit: 0, credit: c.amount }]
        : [{ account_id: notes, debit: c.amount, credit: 0 }, { account_id: bank, debit: 0, credit: c.amount }];
      e = await C.postEntry(conn, { type: 'CQ', date, description: (rec ? 'تحصيل شيك رقم ' : 'صرف شيك رقم ') + c.number, lines, user: u, ref_type: 'cheque', ref_id: id });
      await conn.query("UPDATE cheques SET status='collected', settle_date=?, set_entry_id=? WHERE id=?", [date, e.id, id]);
    } else if (act === 'bounce') {
      const ctrl = rec ? +s.acc_ar : +s.acc_ap;
      const lines = rec ? [{ account_id: ctrl, debit: c.amount, credit: 0, party_id: c.party_id }, { account_id: notes, debit: 0, credit: c.amount }]
        : [{ account_id: notes, debit: c.amount, credit: 0 }, { account_id: ctrl, debit: 0, credit: c.amount, party_id: c.party_id }];
      e = await C.postEntry(conn, { type: 'CQ', date, description: 'ارتداد شيك رقم ' + c.number, lines, user: u, ref_type: 'cheque', ref_id: id });
      await conn.query("UPDATE cheques SET status='bounced', settle_date=?, set_entry_id=? WHERE id=?", [date, e.id, id]);
    } else throw bad('إجراء غير معروف');
    await C.audit(u, act, 'cheque', id, c.number, conn);
    return { ok: true };
  });
}

async function chequeDelete(u, id) {
  return C.tx(async (conn) => {
    const [r] = await conn.query('SELECT * FROM cheques WHERE id=? FOR UPDATE', [id]);
    const c = r[0]; if (!c) throw new HttpError(404, 'غير موجود');
    if (c.status !== 'pending') throw bad('لا يمكن حذف شيك تمت تسويته');
    await conn.query('DELETE FROM cheques WHERE id=?', [id]);
    await C.removeEntry(conn, c.reg_entry_id);
    await C.audit(u, 'delete', 'cheque', id, c.number, conn);
    return { ok: true };
  });
}

async function opening(u, b) {
  if (!isDate(b.date)) throw bad('تاريخ القيد الافتتاحي غير صحيح');
  const lines = (b.lines || []).map(l => ({ account_id: +l.account_id, debit: money(l.debit), credit: money(l.credit), party_id: l.party_id || null, description: 'رصيد افتتاحي' })).filter(l => l.account_id && (l.debit > 0 || l.credit > 0));
  if (!lines.length) throw bad('أدخل سطراً واحداً على الأقل');
  return C.tx(async (conn) => {
    let d = 0, c = 0; lines.forEach(l => { d += l.debit; c += l.credit; });
    const diff = money(d - c);
    if (Math.abs(diff) > 0.004) {
      if (!b.auto_balance) throw bad('القيد غير متوازن: الفرق ' + diff + ' (فعّل الترصيد التلقائي لحساب الأرصدة الافتتاحية)');
      const s = await C.getSettings(conn);
      lines.push({ account_id: +s.acc_opening, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, description: 'ترصيد الأرصدة الافتتاحية' });
    }
    const e = await C.postEntry(conn, { type: 'OB', date: b.date, description: b.description || 'قيد افتتاحي', lines, user: u, ref_type: 'opening', ref_id: 0 });
    await C.audit(u, 'create', 'opening', e.id, e.number, conn);
    return e;
  });
}

async function yearSums(year) {
  const rows = await Q("SELECT a.id, a.type, a.code, a.name, COALESCE(SUM(l.debit-l.credit),0) bal FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE a.type IN ('revenue','expense') AND e.date>=? AND e.date<=? GROUP BY a.id,a.type,a.code,a.name HAVING ABS(SUM(l.debit-l.credit))>0.004", [year + '-01-01', year + '-12-31']);
  let rev = 0, exp = 0; rows.forEach(r => { if (r.type === 'revenue') rev += -Number(r.bal); else exp += Number(r.bal); });
  return { rows, revenue: money(rev), expense: money(exp), profit: money(rev - exp) };
}
async function yearPreview(q) {
  const year = +q.year; if (!(year > 1990 && year < 2200)) throw bad('سنة غير صحيحة');
  const s = await yearSums(year);
  const done = await Q("SELECT number FROM journal_entries WHERE ref_type='close' AND ref_id=?", [year]);
  const st = await C.getSettings();
  return { year, revenue: s.revenue, expense: s.expense, profit: s.profit, accounts: s.rows.length, closed: !!done[0], lock_date: st.lock_date || '' };
}
async function yearClose(u, b) {
  const year = +b.year; if (!(year > 1990 && year < 2200)) throw bad('سنة غير صحيحة');
  return C.tx(async (conn) => {
    const [dup] = await conn.query("SELECT number FROM journal_entries WHERE ref_type='close' AND ref_id=?", [year]);
    if (dup[0]) throw bad('تم إقفال سنة ' + year + ' من قبل (' + dup[0].number + ')');
    const s = await C.getSettings(conn);
    const date = year + '-12-31';
    if (s.lock_date && s.lock_date >= date) throw bad('الفترة مقفلة بالفعل حتى ' + s.lock_date);
    const [rows] = await conn.query("SELECT a.id, a.type, COALESCE(SUM(l.debit-l.credit),0) bal FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE a.type IN ('revenue','expense') AND e.date>=? AND e.date<=? GROUP BY a.id,a.type HAVING ABS(SUM(l.debit-l.credit))>0.004", [year + '-01-01', date]);
    if (!rows.length) throw bad('لا توجد حركة إيرادات أو مصروفات في سنة ' + year);
    const [re] = await conn.query("SELECT id FROM accounts WHERE code='3102'");
    if (!re[0]) throw bad('حساب الأرباح المحتجزة (3102) غير موجود');
    const lines = []; let d = 0, c = 0;
    rows.forEach(r => { const bal = money(r.bal); if (bal > 0) { lines.push({ account_id: r.id, debit: 0, credit: bal, description: 'إقفال سنة ' + year }); c += bal; } else { lines.push({ account_id: r.id, debit: -bal, credit: 0, description: 'إقفال سنة ' + year }); d += -bal; } });
    const net = money(d - c);
    if (net > 0) lines.push({ account_id: re[0].id, debit: 0, credit: net, description: 'صافي ربح سنة ' + year });
    else if (net < 0) lines.push({ account_id: re[0].id, debit: -net, credit: 0, description: 'صافي خسارة سنة ' + year });
    const e = await C.postEntry(conn, { type: 'CL', date, description: 'قيد إقفال السنة المالية ' + year, lines, user: u, ref_type: 'close', ref_id: year });
    if (b.lock) await conn.query("INSERT INTO settings(k,v) VALUES('lock_date',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [date]);
    await C.audit(u, 'close', 'year', year, e.number + ' profit ' + money(c - d), conn);
    return { number: e.number, profit: money(c - d), locked: !!b.lock };
  });
}

async function handle(req, u, parts, id, body, q) {
  const m = req.method, head = parts[0];
  if (head === 'cheques') {
    if (m === 'GET') {
      need(u, 'vouchers:view');
      if (id) return (await Q(CH_SQL + ' WHERE c.id=?', [id]))[0];
      const w = [], p = [];
      if (q.type) { w.push('c.type=?'); p.push(q.type); }
      if (q.status) { w.push('c.status=?'); p.push(q.status); }
      return Q(CH_SQL + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY c.due_date, c.id', p);
    }
    need(u, 'vouchers:edit');
    if (m === 'POST' && !id) return chequeCreate(u, body);
    if (m === 'POST' && id && (parts[2] === 'collect' || parts[2] === 'bounce')) return chequeAct(u, id, parts[2], body);
    if (m === 'DELETE' && id) return chequeDelete(u, id);
  }
  if (head === 'opening' && m === 'POST') { need(u, 'journal:edit'); return opening(u, body); }
  if (head === 'year' && parts[1] === 'preview' && m === 'GET') { need(u, 'reports:view'); return yearPreview(q); }
  if (head === 'year' && parts[1] === 'close' && m === 'POST') { need(u, 'settings:edit'); return yearClose(u, body); }
  return undefined;
}
module.exports = { handle };
