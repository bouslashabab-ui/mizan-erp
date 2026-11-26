'use strict';
const C = require('./core');
const { bad, money, num, isDate, postEntry, removeEntry, nextSeq, pad, getSettings, audit, checkLock } = C;

const TYPES = {
  sale: { p: 'S-', jt: 'SI', mod: 'sales' }, sale_return: { p: 'SR-', jt: 'SR', mod: 'sales' },
  purchase: { p: 'P-', jt: 'PI', mod: 'purchases' }, purchase_return: { p: 'PR-', jt: 'PR', mod: 'purchases' },
  quote: { p: 'Q-', mod: 'sales', draft: true }, sale_order: { p: 'SO-', mod: 'sales', draft: true },
  purchase_order: { p: 'PO-', mod: 'purchases', draft: true }
};

async function onHand(conn, itemId, wh) {
  const [r] = await conn.query('SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE item_id=?' + (wh ? ' AND warehouse_id=?' : ''), wh ? [itemId, wh] : [itemId]);
  return Number(r[0].q);
}

async function prepareLines(conn, body) {
  const raw = body.lines || [];
  if (!raw.length) throw bad('الفاتورة بدون أصناف');
  const ids = [...new Set(raw.map(l => +l.item_id))];
  const [items] = await conn.query('SELECT * FROM items WHERE id IN (?)', [ids]);
  const [units] = await conn.query('SELECT * FROM item_units WHERE item_id IN (?)', [ids]);
  const im = {}; items.forEach(i => im[i.id] = i);
  const out = [];
  for (const l of raw) {
    const it = im[+l.item_id];
    if (!it) throw bad('صنف غير موجود');
    const qty = num(l.qty), price = num(l.price), disc = money(l.discount);
    if (qty <= 0) throw bad('الكمية يجب أن تكون أكبر من صفر للصنف ' + it.name);
    if (price < 0) throw bad('سعر غير صحيح للصنف ' + it.name);
    let unit = l.unit || it.unit, factor = 1;
    if (unit !== it.unit) {
      const u = units.find(x => x.item_id === it.id && x.unit === unit);
      if (!u) throw bad('الوحدة "' + unit + '" غير معرفة للصنف ' + it.name);
      factor = u.factor;
    }
    const total = money(qty * price - disc);
    if (total < 0) throw bad('خصم السطر أكبر من قيمته للصنف ' + it.name);
    out.push({ item: it, item_id: it.id, unit, factor, qty, price, discount: disc, total });
  }
  return out;
}

async function createInvoice(user, body, perms) {
  const T = TYPES[body.type];
  if (!T) throw bad('نوع الفاتورة غير صحيح');
  if (!isDate(body.date)) throw bad('التاريخ غير صحيح');
  return C.tx(async (conn) => {
    const lines = await prepareLines(conn, body);
    const sub = money(lines.reduce((s, l) => s + l.total, 0));
    const disc = money(body.discount);
    if (disc < 0 || disc > sub) throw bad('الخصم غير صحيح');
    const ratio = sub > 0 ? (sub - disc) / sub : 0;
    let tax = 0;
    lines.forEach(l => { tax += l.total * ratio * (num(l.item.tax_rate) / 100); });
    tax = money(tax);
    const total = money(sub - disc + tax);
    const method = body.pay_method === 'bank' ? 'bank' : (body.pay_method === 'credit' ? 'credit' : 'cash');
    let paid = 0;
    if (!T.draft) paid = method === 'credit' ? money(body.paid) : total;
    if (paid < 0 || paid > total) throw bad('المبلغ المدفوع غير صحيح');
    if (!T.draft && total - paid > 0.004 && !body.party_id) throw bad('اختر العميل/المورد للبيع أو الشراء الآجل');
    if (body.party_id) {
      const [p] = await conn.query('SELECT type FROM parties WHERE id=?', [body.party_id]);
      if (!p[0]) throw bad('الطرف غير موجود');
    }
    if (T.mod !== 'sales' && T.mod !== 'purchases') throw bad('نوع غير مدعوم');
    const s = await getSettings(conn);
    let status = T.draft ? 'draft' : 'posted';
    const lim = num(s.approval_limit);
    if (!T.draft && lim > 0 && total >= lim && !(perms.includes('*') || perms.includes('approve:edit'))) status = 'pending';
    const n = await nextSeq(conn, 'inv_' + body.type);
    const number = T.p + pad(n);
    const [r] = await conn.query('INSERT INTO invoices(type,number,date,party_id,warehouse_id,branch_id,rep_id,subtotal,discount,tax,total,paid,pay_method,status,notes,source_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [body.type, number, body.date, body.party_id || null, body.warehouse_id || null, body.branch_id || user.branch_id || null, body.rep_id || null, sub, disc, tax, total, paid, method, status, body.notes || null, body.source_id || null, user.id]);
    const id = r.insertId;
    await conn.query('INSERT INTO invoice_lines(invoice_id,item_id,unit,factor,qty,price,discount,total) VALUES ?',
      [lines.map(l => [id, l.item_id, l.unit, l.factor, l.qty, l.price, l.discount, l.total])]);
    if (status === 'posted') await postInvoice(conn, user, id);
    await audit(user, 'create', 'invoice', id, number + ' ' + body.type + ' ' + total, conn);
    return { id, number, status };
  });
}

async function postInvoice(conn, user, id) {
  const [iv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [id]);
  const inv = iv[0];
  if (!inv) throw bad('الفاتورة غير موجودة');
  if (inv.entry_id) throw bad('الفاتورة مرحلة بالفعل');
  const T = TYPES[inv.type];
  await checkLock(conn, inv.date);
  const [lines] = await conn.query('SELECT l.*, i.kind, i.name iname, i.avg_cost, i.tax_rate FROM invoice_lines l JOIN items i ON i.id=l.item_id WHERE l.invoice_id=?', [id]);
  const s = await getSettings(conn);
  const A = (k) => { const v = +s[k]; if (!v) throw bad('لم يتم ضبط الحساب الافتراضي: ' + k + ' (الإعدادات > ربط الحسابات)'); return v; };
  const isSale = inv.type === 'sale', isSR = inv.type === 'sale_return', isPI = inv.type === 'purchase', isPR = inv.type === 'purchase_return';
  const stockLines = lines.filter(l => l.kind === 'stock');
  if (stockLines.length && !inv.warehouse_id) throw bad('اختر المخزن');
  const ratio = inv.subtotal > 0 ? (inv.subtotal - inv.discount) / inv.subtotal : 0;
  let cogs = 0, invPart = 0, expPart = 0;
  // stock effects
  const need = {};
  for (const l of lines) {
    const base = l.qty * l.factor;
    if (l.kind !== 'stock') { expPart += l.total * ratio; continue; }
    if (isSale || isPR) {
      need[l.item_id] = (need[l.item_id] || 0) + base;
    }
  }
  if (s.allow_negative !== '1') {
    for (const k of Object.keys(need)) {
      const have = await onHand(conn, +k, inv.warehouse_id);
      if (have + 1e-9 < need[k]) { const nm = lines.find(x => x.item_id === +k).iname; throw bad('الكمية غير كافية في المخزن للصنف "' + nm + '" (المتاح ' + have + ')'); }
    }
  }
  for (const l of lines) {
    if (l.kind !== 'stock') continue;
    const base = l.qty * l.factor;
    if (isSale) {
      cogs += base * l.avg_cost;
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id) VALUES(?,?,?,?,?,?,?)', [inv.date, inv.warehouse_id, l.item_id, -base, l.avg_cost, 'invoice', id]);
    } else if (isSR) {
      cogs += base * l.avg_cost;
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id) VALUES(?,?,?,?,?,?,?)', [inv.date, inv.warehouse_id, l.item_id, base, l.avg_cost, 'invoice', id]);
    } else if (isPI) {
      const net = l.total * ratio;
      const cost = base > 0 ? net / base : 0;
      const have = await onHand(conn, l.item_id, 0);
      const avg = have > 0 ? ((have * l.avg_cost) + (base * cost)) / (have + base) : cost;
      await conn.query('UPDATE items SET avg_cost=? WHERE id=?', [avg, l.item_id]);
      l.avg_cost = avg; invPart += net;
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id) VALUES(?,?,?,?,?,?,?)', [inv.date, inv.warehouse_id, l.item_id, base, cost, 'invoice', id]);
    } else if (isPR) {
      const net = l.total * ratio;
      invPart += net;
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id) VALUES(?,?,?,?,?,?,?)', [inv.date, inv.warehouse_id, l.item_id, -base, base > 0 ? net / base : 0, 'invoice', id]);
    }
  }
  cogs = money(cogs); invPart = money(invPart); expPart = money(expPart);
  const credit = money(inv.total - inv.paid);
  const treas = inv.pay_method === 'bank' ? A('acc_bank') : A('acc_cash');
  const P = inv.party_id;
  const L = [];
  const add = (account_id, debit, credit, party) => { if (debit > 0 || credit > 0) L.push({ account_id, debit, credit, party_id: party || null }); };
  const sales = money(inv.subtotal);
  if (isSale) {
    add(treas, inv.paid, 0); add(A('acc_ar'), credit, 0, P); add(A('acc_disc'), inv.discount, 0);
    add(A('acc_sales'), 0, sales); add(A('acc_tax_out'), 0, inv.tax);
    add(A('acc_cogs'), cogs, 0); add(A('acc_inv'), 0, cogs);
  } else if (isSR) {
    add(A('acc_sales_ret'), sales, 0); add(A('acc_tax_out'), inv.tax, 0);
    add(A('acc_disc'), 0, inv.discount); add(treas, 0, inv.paid); add(A('acc_ar'), 0, credit, P);
    add(A('acc_inv'), cogs, 0); add(A('acc_cogs'), 0, cogs);
  } else if (isPI) {
    add(A('acc_inv'), invPart, 0); add(expPart > 0 ? A('acc_exp') : 0, expPart, 0);
    add(A('acc_tax_in'), inv.tax, 0); add(treas, 0, inv.paid); add(A('acc_ap'), 0, credit, P);
    // rounding guard
    const dd = L.reduce((x, l) => x + l.debit, 0), cc = L.reduce((x, l) => x + l.credit, 0);
    if (Math.abs(dd - cc) > 0.005 && Math.abs(dd - cc) < 0.1) L[0].debit = money(L[0].debit + (cc - dd));
  } else if (isPR) {
    add(treas, inv.paid, 0); add(A('acc_ap'), credit, 0, P);
    add(A('acc_inv'), 0, invPart); add(expPart > 0 ? A('acc_exp') : 0, 0, expPart); add(A('acc_tax_in'), 0, inv.tax);
    const dd = L.reduce((x, l) => x + l.debit, 0), cc = L.reduce((x, l) => x + l.credit, 0);
    if (Math.abs(dd - cc) > 0.005 && Math.abs(dd - cc) < 0.1) { const t = L.find(l => l.credit > 0); t.credit = money(t.credit + (dd - cc)); }
  }
  const je = await postEntry(conn, { type: T.jt, date: inv.date, branch_id: inv.branch_id, description: 'فاتورة ' + inv.number, ref_type: 'invoice', ref_id: id, lines: L, user });
  await conn.query('UPDATE invoices SET entry_id=?, status=?, cogs=? WHERE id=?', [je.id, 'posted', cogs, id]);
}

async function approveInvoice(user, id) {
  return C.tx(async (conn) => {
    const [iv] = await conn.query('SELECT status FROM invoices WHERE id=?', [id]);
    if (!iv[0] || iv[0].status !== 'pending') throw bad('الفاتورة ليست بانتظار الاعتماد');
    await postInvoice(conn, user, id);
    await audit(user, 'approve', 'invoice', id, null, conn);
  });
}
async function rejectInvoice(user, id) {
  const [r] = await C.db().query("UPDATE invoices SET status='rejected' WHERE id=? AND status='pending'", [id]);
  if (!r.affectedRows) throw bad('الفاتورة ليست بانتظار الاعتماد');
  await audit(user, 'reject', 'invoice', id);
}

async function cancelInvoice(user, id) {
  return C.tx(async (conn) => {
    const [iv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [id]);
    const inv = iv[0];
    if (!inv) throw bad('الفاتورة غير موجودة');
    if (inv.status === 'cancelled') throw bad('الفاتورة ملغاة بالفعل');
    if (inv.entry_id) await removeEntry(conn, inv.entry_id);
    await conn.query("DELETE FROM stock_moves WHERE ref_type='invoice' AND ref_id=?", [id]);
    await conn.query("UPDATE invoices SET status='cancelled', entry_id=NULL WHERE id=?", [id]);
    await audit(user, 'cancel', 'invoice', id, inv.number, conn);
  });
}

async function convertInvoice(user, id, to, perms) {
  const [iv] = await C.db().query('SELECT * FROM invoices WHERE id=?', [id]);
  const inv = iv[0];
  if (!inv) throw bad('المستند غير موجود');
  if (!['quote', 'sale_order', 'purchase_order'].includes(inv.type)) throw bad('يمكن تحويل عروض الأسعار وأوامر البيع/الشراء فقط');
  if (inv.status === 'converted') throw bad('تم تحويله مسبقاً');
  const target = to || (inv.type === 'purchase_order' ? 'purchase' : (inv.type === 'quote' ? 'sale_order' : 'sale'));
  const [lines] = await C.db().query('SELECT item_id,unit,qty,price,discount FROM invoice_lines WHERE invoice_id=?', [id]);
  const res = await createInvoice(user, { type: target, date: new Date().toISOString().slice(0, 10), party_id: inv.party_id, warehouse_id: inv.warehouse_id, branch_id: inv.branch_id, discount: inv.discount, pay_method: inv.party_id ? 'credit' : 'cash', paid: 0, notes: 'محول من ' + inv.number, source_id: id, lines }, perms);
  await C.db().query("UPDATE invoices SET status='converted' WHERE id=?", [id]);
  return res;
}

async function createVoucher(user, b) {
  if (!['receipt', 'payment'].includes(b.type)) throw bad('نوع السند غير صحيح');
  const amt = money(b.amount);
  if (amt <= 0) throw bad('المبلغ يجب أن يكون أكبر من صفر');
  if (!b.account_id || !b.counter_id) throw bad('اختر حساب الخزينة والحساب المقابل');
  if (+b.account_id === +b.counter_id) throw bad('الحسابان متطابقان');
  return C.tx(async (conn) => {
    const n = await nextSeq(conn, 'v_' + b.type);
    const number = (b.type === 'receipt' ? 'RV-' : 'PV-') + pad(n);
    const rec = b.type === 'receipt';
    const lines = rec
      ? [{ account_id: b.account_id, debit: amt, credit: 0 }, { account_id: b.counter_id, debit: 0, credit: amt, party_id: b.party_id, cost_center_id: b.cost_center_id }]
      : [{ account_id: b.counter_id, debit: amt, credit: 0, party_id: b.party_id, cost_center_id: b.cost_center_id }, { account_id: b.account_id, debit: 0, credit: amt }];
    const je = await postEntry(conn, { type: rec ? 'RV' : 'PV', date: b.date, branch_id: b.branch_id || user.branch_id, description: b.notes || (rec ? 'سند قبض ' : 'سند صرف ') + number, ref_type: 'voucher', ref_id: 0, lines, user });
    const [r] = await conn.query('INSERT INTO vouchers(type,number,date,account_id,counter_id,party_id,amount,cost_center_id,branch_id,notes,entry_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.type, number, b.date, b.account_id, b.counter_id, b.party_id || null, amt, b.cost_center_id || null, b.branch_id || user.branch_id || null, b.notes || null, je.id, user.id]);
    await conn.query('UPDATE journal_entries SET ref_id=? WHERE id=?', [r.insertId, je.id]);
    await audit(user, 'create', 'voucher', r.insertId, number + ' ' + amt, conn);
    return { id: r.insertId, number };
  });
}
async function deleteVoucher(user, id) {
  return C.tx(async (conn) => {
    const [v] = await conn.query('SELECT * FROM vouchers WHERE id=?', [id]);
    if (!v[0]) throw bad('السند غير موجود');
    await removeEntry(conn, v[0].entry_id);
    await conn.query('DELETE FROM vouchers WHERE id=?', [id]);
    await audit(user, 'delete', 'voucher', id, v[0].number, conn);
  });
}

async function stockAdjust(user, b) {
  if (!isDate(b.date) || !b.warehouse_id) throw bad('بيانات الجرد ناقصة');
  return C.tx(async (conn) => {
    const s = await getSettings(conn);
    const L = []; let diffVal = 0; let n = 0;
    for (const l of (b.lines || [])) {
      const [it] = await conn.query('SELECT id,avg_cost,kind FROM items WHERE id=?', [l.item_id]);
      if (!it[0] || it[0].kind !== 'stock') continue;
      const cur = await onHand(conn, l.item_id, b.warehouse_id);
      const diff = num(l.counted) - cur;
      if (Math.abs(diff) < 1e-9) continue;
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id,note) VALUES(?,?,?,?,?,?,?,?)', [b.date, b.warehouse_id, l.item_id, diff, it[0].avg_cost, 'adjust', 0, b.note || 'تسوية جرد']);
      diffVal += diff * it[0].avg_cost; n++;
    }
    diffVal = money(diffVal);
    if (Math.abs(diffVal) > 0.004) {
      if (!+s.acc_inv || !+s.acc_adjust) throw bad('اضبط حسابي المخزون وفروق الجرد في الإعدادات');
      await postEntry(conn, { type: 'JV', date: b.date, description: 'تسوية جرد مخزني', lines: diffVal > 0
        ? [{ account_id: +s.acc_inv, debit: diffVal, credit: 0 }, { account_id: +s.acc_adjust, debit: 0, credit: diffVal }]
        : [{ account_id: +s.acc_adjust, debit: -diffVal, credit: 0 }, { account_id: +s.acc_inv, debit: 0, credit: -diffVal }], user });
    }
    await audit(user, 'adjust', 'stock', b.warehouse_id, n + ' items', conn);
    return { changed: n, value: diffVal };
  });
}
async function stockTransfer(user, b) {
  if (!isDate(b.date) || !b.from || !b.to || +b.from === +b.to) throw bad('اختر مخزنين مختلفين');
  return C.tx(async (conn) => {
    const s = await getSettings(conn);
    for (const l of (b.lines || [])) {
      const q = num(l.qty); if (q <= 0) continue;
      const have = await onHand(conn, l.item_id, b.from);
      if (have + 1e-9 < q && s.allow_negative !== '1') throw bad('الكمية غير كافية في المخزن المحول منه');
      const [it] = await conn.query('SELECT avg_cost FROM items WHERE id=?', [l.item_id]);
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id,note) VALUES(?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)',
        [b.date, b.from, l.item_id, -q, it[0].avg_cost, 'transfer', 0, 'تحويل مخزني', b.date, b.to, l.item_id, q, it[0].avg_cost, 'transfer', 0, 'تحويل مخزني']);
    }
    await audit(user, 'transfer', 'stock', b.from + '>' + b.to, null, conn);
    return { ok: true };
  });
}

async function produce(user, b) {
  const q = num(b.qty);
  if (q <= 0 || !b.bom_id || !b.warehouse_id || !isDate(b.date)) throw bad('بيانات أمر التصنيع ناقصة');
  return C.tx(async (conn) => {
    const [bm] = await conn.query('SELECT * FROM boms WHERE id=?', [b.bom_id]);
    if (!bm[0]) throw bad('قائمة المواد غير موجودة');
    const [bl] = await conn.query('SELECT l.*, i.avg_cost, i.name FROM bom_lines l JOIN items i ON i.id=l.item_id WHERE l.bom_id=?', [b.bom_id]);
    if (!bl.length) throw bad('قائمة المواد فارغة');
    const mult = q / (bm[0].qty || 1);
    const s = await getSettings(conn);
    let cost = 0;
    for (const l of bl) {
      const need = l.qty * mult;
      const have = await onHand(conn, l.item_id, b.warehouse_id);
      if (have + 1e-9 < need && s.allow_negative !== '1') throw bad('خامة غير كافية: ' + l.name);
      cost += need * l.avg_cost;
      await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id,note) VALUES(?,?,?,?,?,?,?,?)', [b.date, b.warehouse_id, l.item_id, -need, l.avg_cost, 'prod', 0, 'استهلاك تصنيع']);
    }
    cost = money(cost);
    const unitCost = cost / q;
    const have = await onHand(conn, bm[0].item_id, 0);
    const [oi] = await conn.query('SELECT avg_cost FROM items WHERE id=?', [bm[0].item_id]);
    const avg = have > 0 ? (have * oi[0].avg_cost + q * unitCost) / (have + q) : unitCost;
    await conn.query('UPDATE items SET avg_cost=? WHERE id=?', [avg, bm[0].item_id]);
    await conn.query('INSERT INTO stock_moves(date,warehouse_id,item_id,qty,unit_cost,ref_type,ref_id,note) VALUES(?,?,?,?,?,?,?,?)', [b.date, b.warehouse_id, bm[0].item_id, q, unitCost, 'prod', 0, 'إنتاج تام']);
    const n = await nextSeq(conn, 'prod');
    const [r] = await conn.query('INSERT INTO prod_orders(number,date,bom_id,warehouse_id,qty,cost,created_by) VALUES(?,?,?,?,?,?,?)', ['MO-' + pad(n), b.date, b.bom_id, b.warehouse_id, q, cost, user.id]);
    await audit(user, 'create', 'prod_order', r.insertId, 'MO-' + pad(n), conn);
    return { id: r.insertId, cost };
  });
}

async function payrollRun(user, month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('الشهر غير صحيح');
  return C.tx(async (conn) => {
    const [ex] = await conn.query('SELECT id FROM payroll_runs WHERE month=?', [month]);
    if (ex[0]) throw bad('تم احتساب رواتب هذا الشهر مسبقاً');
    const [emps] = await conn.query('SELECT * FROM employees WHERE active=1');
    if (!emps.length) throw bad('لا يوجد موظفون نشطون');
    const s = await getSettings(conn);
    if (!+s.acc_salary || !+s.acc_sal_pay || !+s.acc_ded_pay) throw bad('اضبط حسابات الرواتب في الإعدادات');
    let g = 0, d = 0;
    const rows = emps.map(e => { const gr = money(e.salary + e.allowances), de = money(e.deductions); g += gr; d += de; return { e, gr, de, net: money(gr - de) }; });
    g = money(g); d = money(d);
    const date = month + '-' + new Date(+month.slice(0, 4), +month.slice(5), 0).getDate();
    const je = await postEntry(conn, { type: 'JV', date, description: 'رواتب شهر ' + month, ref_type: 'payroll', lines: [
      { account_id: +s.acc_salary, debit: g, credit: 0 }, { account_id: +s.acc_sal_pay, debit: 0, credit: money(g - d) }, { account_id: +s.acc_ded_pay, debit: 0, credit: d }], user });
    const [r] = await conn.query('INSERT INTO payroll_runs(month,total_gross,total_ded,total_net,entry_id) VALUES(?,?,?,?,?)', [month, g, d, money(g - d), je.id]);
    await conn.query('INSERT INTO payroll_lines(run_id,employee_id,gross,ded,net) VALUES ?', [rows.map(x => [r.insertId, x.e.id, x.gr, x.de, x.net])]);
    await audit(user, 'create', 'payroll', r.insertId, month, conn);
    return { id: r.insertId, gross: g, net: money(g - d) };
  });
}
async function payrollPay(user, b) {
  return C.tx(async (conn) => {
    const [r] = await conn.query('SELECT * FROM payroll_runs WHERE id=?', [b.run_id]);
    if (!r[0]) throw bad('مسير الرواتب غير موجود');
    const s = await getSettings(conn);
    if (!isDate(b.date) || !b.account_id) throw bad('بيانات الصرف ناقصة');
    await postEntry(conn, { type: 'PV', date: b.date, description: 'صرف رواتب ' + r[0].month, ref_type: 'payroll_pay', ref_id: r[0].id, lines: [
      { account_id: +s.acc_sal_pay, debit: r[0].total_net, credit: 0 }, { account_id: +b.account_id, debit: 0, credit: r[0].total_net }], user });
    await audit(user, 'pay', 'payroll', r[0].id, null, conn);
  });
}

async function depreciate(user, date) {
  if (!isDate(date)) throw bad('التاريخ غير صحيح');
  return C.tx(async (conn) => {
    const s = await getSettings(conn);
    if (!+s.acc_dep_exp || !+s.acc_accum) throw bad('اضبط حسابي الإهلاك في الإعدادات');
    const [as] = await conn.query("SELECT * FROM assets WHERE status='active'");
    let total = 0, n = 0;
    for (const a of as) {
      if (a.last_dep && a.last_dep.slice(0, 7) >= date.slice(0, 7)) continue;
      if (a.buy_date && a.buy_date.slice(0, 7) > date.slice(0, 7)) continue;
      const base = a.cost - a.salvage;
      let m = base / (Math.max(1, a.life_years) * 12);
      m = Math.min(m, base - a.accumulated);
      m = money(m);
      if (m <= 0) continue;
      await conn.query('UPDATE assets SET accumulated=accumulated+?, last_dep=? WHERE id=?', [m, date, a.id]);
      total += m; n++;
    }
    total = money(total);
    if (total > 0) await postEntry(conn, { type: 'JV', date, description: 'إهلاك الأصول الثابتة ' + date.slice(0, 7), ref_type: 'depreciation', lines: [
      { account_id: +s.acc_dep_exp, debit: total, credit: 0 }, { account_id: +s.acc_accum, debit: 0, credit: total }], user });
    await audit(user, 'depreciate', 'assets', date, n + ' assets / ' + total, conn);
    return { assets: n, total };
  });
}

module.exports = { TYPES, createInvoice, approveInvoice, rejectInvoice, cancelInvoice, convertInvoice, createVoucher, deleteVoucher, stockAdjust, stockTransfer, produce, payrollRun, payrollPay, depreciate, onHand };
