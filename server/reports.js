'use strict';
const C = require('./core');
const { bad, isDate, getSettings } = C;
const Q = async (sql, p) => (await C.db().query(sql, p))[0];

function descendants(accs, id) {
  const out = [id]; let fr = [id];
  while (fr.length) { const nx = accs.filter(a => fr.includes(a.parent_id)).map(a => a.id); out.push(...nx); fr = nx; }
  return out;
}
function range(q) {
  const from = isDate(q.from) ? q.from : '1900-01-01', to = isDate(q.to) ? q.to : '2999-12-31';
  return { from, to };
}

async function trial(q) {
  const { from, to } = range(q);
  const br = q.branch_id ? ' AND e.branch_id=' + (+q.branch_id) : '';
  const cc = q.cc_id ? ' AND l.cost_center_id=' + (+q.cc_id) : '';
  return Q(`SELECT a.id,a.code,a.name,a.parent_id,a.type,a.is_group,
    COALESCE(SUM(CASE WHEN x.date<? THEN x.debit-x.credit END),0) opening,
    COALESCE(SUM(CASE WHEN x.date>=? THEN x.debit END),0) dr,
    COALESCE(SUM(CASE WHEN x.date>=? THEN x.credit END),0) cr
    FROM accounts a LEFT JOIN (SELECT l.account_id,e.date,l.debit,l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.date<=?${br}${cc}) x ON x.account_id=a.id
    GROUP BY a.id,a.code,a.name,a.parent_id,a.type,a.is_group ORDER BY a.code`, [from, from, from, to]);
}

async function ledger(q) {
  const { from, to } = range(q);
  const accs = await Q('SELECT id,parent_id FROM accounts');
  let ids = null;
  if (q.account_id) ids = descendants(accs, +q.account_id);
  let w = '', p = [];
  if (ids) { w += ' AND l.account_id IN (?)'; p.push(ids); }
  if (q.party_id) { w += ' AND l.party_id=?'; p.push(+q.party_id); }
  if (q.cc_id) { w += ' AND l.cost_center_id=?'; p.push(+q.cc_id); }
  if (q.branch_id) { w += ' AND e.branch_id=?'; p.push(+q.branch_id); }
  if (!ids && !q.party_id) throw bad('اختر حساباً أو طرفاً');
  const op = await Q(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.date<?${w}`, [from, ...p]);
  const rows = await Q(`SELECT e.id entry_id,e.number,e.type,e.date,COALESCE(l.description,e.description) description,l.debit,l.credit,a.name account_name,a.code account_code
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE e.date>=? AND e.date<=?${w} ORDER BY e.date,e.id,l.id`, [from, to, ...p]);
  let bal = op[0].b;
  rows.forEach(r => { bal += r.debit - r.credit; r.balance = Math.round(bal * 100) / 100; });
  return { opening: op[0].b, rows, closing: Math.round(bal * 100) / 100 };
}

async function partyBalances(type) {
  const s = await getSettings();
  const acc = +(type === 'customer' ? s.acc_ar : s.acc_ap);
  return Q(`SELECT p.id,p.code,p.name,p.phone,p.credit_limit,COALESCE(SUM(l.debit-l.credit),0) balance
    FROM parties p LEFT JOIN journal_lines l ON l.party_id=p.id AND l.account_id=? WHERE p.type=? GROUP BY p.id,p.code,p.name,p.phone,p.credit_limit ORDER BY p.name`, [acc, type]);
}

async function aging(type) {
  const bals = await partyBalances(type);
  const itype = type === 'customer' ? 'sale' : 'purchase';
  const today = Date.now();
  const out = [];
  for (const b of bals) {
    let owe = type === 'customer' ? b.balance : -b.balance;
    if (owe <= 0.004) continue;
    const invs = await Q("SELECT date,total-paid due FROM invoices WHERE party_id=? AND type=? AND status='posted' AND total-paid>0 ORDER BY date DESC", [b.id, itype]);
    const bk = [0, 0, 0, 0, 0];
    let left = owe;
    for (const iv of invs) {
      if (left <= 0) break;
      const take = Math.min(left, iv.due); left -= take;
      const days = Math.floor((today - new Date(iv.date).getTime()) / 86400000);
      bk[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3] += take;
    }
    bk[4] += left;
    out.push({ id: b.id, name: b.name, total: owe, b0: bk[0], b30: bk[1], b60: bk[2], b90: bk[3], older: bk[4] });
  }
  return out;
}

async function stockBalance(q) {
  const w = []; const p = [];
  if (q.warehouse_id) { w.push('m.warehouse_id=?'); p.push(+q.warehouse_id); }
  if (q.to && isDate(q.to)) { w.push('m.date<=?'); p.push(q.to); }
  const gw = q.by_wh === '1' ? ',m.warehouse_id' : '';
  const rows = await Q(`SELECT i.id,i.code,i.name,i.unit,i.group_id,i.avg_cost,i.min_qty${gw ? ',m.warehouse_id' : ''},COALESCE(SUM(m.qty),0) qty
    FROM items i LEFT JOIN stock_moves m ON m.item_id=i.id ${w.length ? 'AND ' + w.join(' AND ') : ''}
    WHERE i.kind='stock' AND i.active=1 GROUP BY i.id,i.code,i.name,i.unit,i.group_id,i.avg_cost,i.min_qty${gw} ORDER BY i.name`, p);
  rows.forEach(r => r.value = Math.round(r.qty * r.avg_cost * 100) / 100);
  return rows;
}
async function stockCard(q) {
  if (!q.item_id) throw bad('اختر الصنف');
  const { from, to } = range(q);
  const wh = q.warehouse_id ? ' AND warehouse_id=' + (+q.warehouse_id) : '';
  const op = await Q('SELECT COALESCE(SUM(qty),0) b FROM stock_moves WHERE item_id=? AND date<?' + wh, [+q.item_id, from]);
  const rows = await Q('SELECT m.id,m.date,m.qty,m.unit_cost,m.ref_type,m.ref_id,m.note,w.name wh FROM stock_moves m JOIN warehouses w ON w.id=m.warehouse_id WHERE m.item_id=? AND m.date>=? AND m.date<=?' + wh.replace(/warehouse_id/g, 'm.warehouse_id') + ' ORDER BY m.date,m.id', [+q.item_id, from, to]);
  let bal = op[0].b; rows.forEach(r => { bal += r.qty; r.balance = bal; });
  return { opening: op[0].b, rows, closing: bal };
}
async function itemMovement(q) {
  const { from, to } = range(q);
  const sold = await Q(`SELECT i.id,i.code,i.name,i.unit,COALESCE(SUM(-m.qty),0) qty,COUNT(m.id) cnt FROM items i JOIN stock_moves m ON m.item_id=i.id AND m.ref_type='invoice' AND m.qty<0 AND m.date>=? AND m.date<=?
    JOIN invoices v ON v.id=m.ref_id AND v.type='sale' AND v.status='posted' GROUP BY i.id,i.code,i.name,i.unit ORDER BY qty DESC LIMIT 100`, [from, to]);
  const stag = await Q(`SELECT i.id,i.code,i.name,i.unit,COALESCE(SUM(m.qty),0) qty,i.avg_cost FROM items i JOIN stock_moves m ON m.item_id=i.id WHERE i.kind='stock' AND i.active=1
    AND i.id NOT IN (SELECT m2.item_id FROM stock_moves m2 WHERE m2.ref_type='invoice' AND m2.qty<0 AND m2.date>=? AND m2.date<=?) GROUP BY i.id,i.code,i.name,i.unit,i.avg_cost HAVING SUM(m.qty)>0 ORDER BY SUM(m.qty*i.avg_cost) DESC LIMIT 100`, [from, to]);
  return { top: sold, stagnant: stag };
}

async function incomeBalance(q) {
  const t = await trial({ from: q.from, to: q.to, branch_id: q.branch_id });
  return t;
}

async function invoiceReport(q) {
  const { from, to } = range(q);
  const w = ["v.status='posted'", 'v.date>=?', 'v.date<=?']; const p = [from, to];
  if (q.type) { w.push('v.type=?'); p.push(q.type); }
  if (q.party_id) { w.push('v.party_id=?'); p.push(+q.party_id); }
  if (q.branch_id) { w.push('v.branch_id=?'); p.push(+q.branch_id); }
  if (q.group === 'item') {
    return Q(`SELECT i.id,i.code,i.name,SUM(l.qty*l.factor) qty,SUM(l.total) total FROM invoice_lines l JOIN invoices v ON v.id=l.invoice_id JOIN items i ON i.id=l.item_id WHERE ${w.join(' AND ')} GROUP BY i.id,i.code,i.name ORDER BY total DESC LIMIT 500`, p);
  }
  if (q.group === 'party') {
    return Q(`SELECT p.id,p.name,COUNT(v.id) cnt,SUM(v.total) total,SUM(v.paid) paid FROM invoices v LEFT JOIN parties p ON p.id=v.party_id WHERE ${w.join(' AND ')} GROUP BY p.id,p.name ORDER BY total DESC LIMIT 500`, p);
  }
  if (q.group === 'month') {
    return Q(`SELECT DATE_FORMAT(v.date,'%Y-%m') month,v.type,COUNT(v.id) cnt,SUM(v.total) total FROM invoices v WHERE ${w.join(' AND ')} GROUP BY month,v.type ORDER BY month`, p);
  }
  return Q(`SELECT v.id,v.number,v.type,v.date,v.total,v.paid,v.status,p.name party FROM invoices v LEFT JOIN parties p ON p.id=v.party_id WHERE ${w.join(' AND ')} ORDER BY v.date DESC,v.id DESC LIMIT 1000`, p);
}

async function budgetReport(q) {
  const y = +q.year || new Date().getFullYear();
  const bud = await Q('SELECT account_id,SUM(amount) amount FROM budgets WHERE year=? GROUP BY account_id', [y]);
  const act = await Q(`SELECT l.account_id,SUM(l.debit-l.credit) amount FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE YEAR(e.date)=? GROUP BY l.account_id`, [y]);
  const accs = await Q('SELECT id,code,name,type FROM accounts WHERE is_group=0 ORDER BY code');
  const bm = {}, am = {}; bud.forEach(b => bm[b.account_id] = b.amount); act.forEach(a => am[a.account_id] = a.amount);
  return accs.filter(a => bm[a.id] !== undefined).map(a => {
    const actual = a.type === 'revenue' || a.type === 'liability' || a.type === 'equity' ? -(am[a.id] || 0) : (am[a.id] || 0);
    return { id: a.id, code: a.code, name: a.name, type: a.type, budget: bm[a.id], actual, variance: actual - bm[a.id] };
  });
}

async function dashboard() {
  const s = await getSettings();
  const bal = async (id) => { if (!+id) return 0; const accs = await Q('SELECT id,parent_id FROM accounts'); const ids = descendants(accs, +id); const r = await Q('SELECT COALESCE(SUM(debit-credit),0) b FROM journal_lines WHERE account_id IN (?)', [ids]); return r[0].b; };
  const cash = (await bal(s.acc_cash)) + (await bal(s.acc_bank));
  const ar = await bal(s.acc_ar), ap = -(await bal(s.acc_ap));
  const stock = (await stockBalance({})).reduce((x, r) => x + r.value, 0);
  const now = new Date(); const m0 = now.toISOString().slice(0, 7) + '-01';
  const sales = await Q("SELECT COALESCE(SUM(CASE WHEN type='sale' THEN subtotal-discount WHEN type='sale_return' THEN -(subtotal-discount) END),0) v FROM invoices WHERE status='posted' AND date>=?", [m0]);
  const exp = await Q("SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE a.type='expense' AND e.date>=?", [m0]);
  const series = await Q(`SELECT DATE_FORMAT(e.date,'%Y-%m') m, SUM(CASE WHEN a.type='revenue' THEN l.credit-l.debit ELSE 0 END) rev, SUM(CASE WHEN a.type='expense' THEN l.debit-l.credit ELSE 0 END) exp
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE e.date>=DATE_SUB(?, INTERVAL 5 MONTH) GROUP BY m ORDER BY m`, [m0]);
  const pend = await Q("SELECT COUNT(*) c FROM invoices WHERE status='pending'");
  const low = (await stockBalance({})).filter(r => r.min_qty > 0 && r.qty < r.min_qty).length;
  const last = await Q('SELECT id,number,type,date,description FROM journal_entries ORDER BY id DESC LIMIT 6');
  const counts = {};
  for (const t of ['parties', 'items', 'invoices', 'accounts', 'employees']) counts[t] = (await Q('SELECT COUNT(*) c FROM ' + t))[0].c;
  return { cash, ar, ap, stock, sales: sales[0].v, expenses: exp[0].v, series, pending: pend[0].c, low, last, counts };
}

module.exports = { trial, ledger, partyBalances, aging, stockBalance, stockCard, itemMovement, incomeBalance, invoiceReport, budgetReport, dashboard, descendants };
