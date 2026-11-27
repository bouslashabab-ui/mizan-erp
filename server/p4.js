'use strict';
/* Phase 4: cash flow statement, dated inventory valuation, reorder report, monthly period lock */
const C = require('./core');
const R = require('./reports');
const { bad, isDate, HttpError } = C;
const Q = async (sql, p) => (await C.db().query(sql, p))[0];
const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const need = (u, perm) => { if (!C.can(u, perm)) throw new HttpError(403, 'ليست لديك صلاحية'); };
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

async function cashIds(s) { const accs = await Q('SELECT id,parent_id FROM accounts'); const ids = []; for (const k of ['acc_cash', 'acc_bank']) if (+s[k]) ids.push(...R.descendants(accs, +s[k])); return [...new Set(ids)]; }

async function cashflow(q) {
  const from = isDate(q.from) ? q.from : new Date().getFullYear() + '-01-01', to = isDate(q.to) ? q.to : new Date().toISOString().slice(0, 10);
  const s = await C.getSettings(); const ids = await cashIds(s); if (!ids.length) throw bad('اضبط حسابي النقدية والبنك في الإعدادات أولًا');
  const idSet = new Set(ids); const ph = ids.map(() => '?').join(',');
  const open = (await Q('SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id IN (' + ph + ') AND e.date<?', [...ids, from]))[0].v;
  const entries = (await Q('SELECT DISTINCT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE l.account_id IN (' + ph + ') AND e.date>=? AND e.date<=?', [...ids, from, to])).map(r => r.id);
  const cats = { operating: {}, investing: {}, financing: {} };
  if (entries.length) {
    const lines = await Q('SELECT l.entry_id,l.account_id,l.debit,l.credit,a.code,a.name,a.type FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id IN (' + entries.join(',') + ')');
    for (const l of lines) {
      if (idSet.has(l.account_id)) continue;
      const amt = r2(l.credit - l.debit); if (!amt) continue; // cash effect of this counter line
      const cat = /^12/.test(l.code) ? 'investing' : (l.type === 'equity' || /^(3|22)/.test(l.code) && l.type === 'equity') ? 'financing' : 'operating';
      const k = l.code + ' ' + l.name; cats[cat][k] = r2((cats[cat][k] || 0) + amt);
    }
  }
  const out = {}; let net = 0;
  for (const c of Object.keys(cats)) { const rows = Object.entries(cats[c]).map(([name, amount]) => ({ name, amount })).filter(r => r.amount).sort((a, b) => b.amount - a.amount); const total = r2(rows.reduce((x, r) => x + r.amount, 0)); out[c] = { rows, total }; net = r2(net + total); }
  const close = (await Q('SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id IN (' + ph + ') AND e.date<=?', [...ids, to]))[0].v;
  return { from, to, ...out, net, opening: r2(open), closing: r2(close), check: r2(open + net - close) };
}

async function valuation(q) {
  const to = isDate(q.to) ? q.to : new Date().toISOString().slice(0, 10); const w = ['m.date<=?'], p = [to];
  if (q.warehouse_id) { w.push('m.warehouse_id=?'); p.push(+q.warehouse_id); }
  const rows = await Q(`SELECT i.id,i.code,i.name,i.unit,COALESCE(SUM(m.qty),0) qty,COALESCE(SUM(m.qty*m.unit_cost),0) val FROM items i JOIN stock_moves m ON m.item_id=i.id AND ${w.join(' AND ')} WHERE i.kind='stock' GROUP BY i.id,i.code,i.name,i.unit HAVING ABS(SUM(m.qty))>0.00005 OR ABS(SUM(m.qty*m.unit_cost))>0.004 ORDER BY i.name`, p);
  rows.forEach(r => { r.qty = Math.round(r.qty * 10000) / 10000; r.value = r2(r.val); r.avg = r.qty > 0 ? r2(r.val / r.qty) : 0; delete r.val; });
  const total = r2(rows.reduce((x, r) => x + r.value, 0)); let gl = null;
  const s = await C.getSettings();
  if (+s.acc_inv && !q.warehouse_id) { const accs = await Q('SELECT id,parent_id FROM accounts'); const ids = R.descendants(accs, +s.acc_inv); gl = r2((await Q('SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id IN (' + ids.map(() => '?').join(',') + ') AND e.date<=?', [...ids, to]))[0].v); }
  return { to, rows, total, gl, diff: gl === null ? null : r2(total - gl) };
}

async function reorder(q) {
  const rows = (await R.stockBalance({})).filter(r => r.min_qty > 0 && r.qty <= r.min_qty).map(r => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, qty: r.qty, min_qty: r.min_qty, short: Math.round((r.min_qty - r.qty) * 10000) / 10000, suggest: Math.round((r.min_qty * 2 - r.qty) * 10000) / 10000, avg_cost: r.avg_cost, est_cost: r2((r.min_qty * 2 - r.qty) * r.avg_cost), out: r.qty <= 0 }));
  rows.sort((a, b) => (b.out - a.out) || (b.short - a.short));
  return { rows, total_est: r2(rows.reduce((x, r) => x + r.est_cost, 0)) };
}

async function periods() {
  const s = await C.getSettings(); const lock = s.lock_date || '';
  const rows = await Q("SELECT DATE_FORMAT(date,'%Y-%m') m, COUNT(*) n FROM journal_entries GROUP BY m ORDER BY m DESC LIMIT 24");
  return { lock_date: lock, months: rows.map(r => ({ month: r.m, entries: r.n, end: lastDay(r.m), locked: !!lock && lastDay(r.m) <= lock })) };
}
async function setLock(u, b) {
  const d = String(b.lock_date || '');
  if (d && !(isDate(d) && d === lastDay(d.slice(0, 7)))) throw bad('اختر آخر يوم في شهر (مثال 2026-10-31) أو اتركه فارغًا لفتح الفترات');
  if (d && d > new Date().toISOString().slice(0, 10)) throw bad('لا يمكن قفل شهر لم ينتهِ بعد');
  const before = (await C.getSettings()).lock_date || '';
  await C.db().query("INSERT INTO settings(k,v) VALUES('lock_date',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [d]);
  await C.audit(u, 'lock', 'period', 0, (before || 'مفتوح') + ' -> ' + (d || 'مفتوح')); return { lock_date: d, before };
}

async function backup(u) {
  const names = (await Q('SHOW TABLES')).map(r => Object.values(r)[0]); const data = {}; let rows = 0;
  for (const n of names) { if (!/^[a-z_]+$/.test(n)) continue; const r = await Q('SELECT * FROM `' + n + '`'); if (n === 'users') r.forEach(x => { delete x.pass_hash; }); data[n] = r; rows += r.length; }
  await C.audit(u, 'backup', 'system', 0, names.length + ' tables ' + rows + ' rows');
  return { app: 'mizan-erp', exported: new Date().toISOString(), tables: Object.keys(data).length, rows, data };
}
async function handle(req, u, parts, id, body, q) {
  const head = parts[0], m = req.method;
  if (head === 'reports' && m === 'GET' && ['cashflow', 'valuation', 'reorder'].includes(parts[1])) { need(u, 'reports:view'); return parts[1] === 'cashflow' ? cashflow(q) : parts[1] === 'valuation' ? valuation(q) : reorder(q); }
  if (head === 'backup' && m === 'GET') { need(u, 'settings:edit'); return backup(u); }
  if (head === 'period') { if (m === 'GET') { need(u, 'reports:view'); return periods(); } need(u, 'settings:edit'); if (m === 'POST') return setLock(u, body); }
  return undefined;
}
module.exports = { handle };
