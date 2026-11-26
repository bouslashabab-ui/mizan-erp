'use strict';
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const SCHEMA = require('./schema');

const cfg = {
  host: process.env.DB_HOST, port: +(process.env.DB_PORT || 4000),
  user: process.env.DB_USER, password: process.env.DB_PASS,
  db: process.env.DB_NAME || 'mizan'
};
const SECRET = process.env.APP_SECRET || crypto.createHash('sha256').update('mizan|' + (cfg.password || '')).digest('hex');
let pool = null;

async function initDb() {
  const base = { host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, dateStrings: true, decimalNumbers: true, timezone: '+00:00' };
  let dbName = cfg.db;
  const c = await mysql.createConnection(base);
  try { await c.query('CREATE DATABASE IF NOT EXISTS `' + dbName + '`'); }
  catch (e) { dbName = 'test'; }
  await c.end();
  pool = mysql.createPool({ ...base, database: dbName, connectionLimit: 6, waitForConnections: true });
  for (const s of SCHEMA) await pool.query(s);
  return dbName;
}
const db = () => pool;

// ---------- auth ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return 's1$' + salt + '$' + h;
}
function checkPw(pw, stored) {
  const p = String(stored).split('$');
  if (p[0] !== 's1') return false;
  const h = crypto.scryptSync(pw, p[1], 64);
  const b = Buffer.from(p[2], 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return b + '.' + s;
}
function verify(tok) {
  if (!tok) return null;
  const [b, s] = tok.split('.');
  if (!b || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
function can(user, perm) {
  if (!user) return false;
  const p = user.perms;
  if (p.includes('*')) return true;
  return p.includes(perm) || (perm.endsWith(':view') && p.includes(perm.split(':')[0] + ':edit'));
}

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (m) => new HttpError(400, m);
const money = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const num = (n) => { const x = Number(n); return isFinite(x) ? x : 0; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function audit(user, action, entity, id, detail, conn) {
  try {
    await (conn || pool).query('INSERT INTO audit_log(user_id,username,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)',
      [user && user.id || null, user && user.username || null, action, entity, String(id ?? ''), detail ? String(detail).slice(0, 2000) : null]);
  } catch (e) { /* never block */ }
}

async function getSettings(conn) {
  const [rows] = await (conn || pool).query('SELECT k,v FROM settings');
  const o = {}; rows.forEach(r => o[r.k] = r.v); return o;
}
async function nextSeq(conn, name) {
  await conn.query('INSERT INTO seq(name,n) VALUES(?,0) ON DUPLICATE KEY UPDATE n=n', [name]);
  const [r] = await conn.query('SELECT n FROM seq WHERE name=? FOR UPDATE', [name]);
  const n = (r[0] ? r[0].n : 0) + 1;
  await conn.query('UPDATE seq SET n=? WHERE name=?', [n, name]);
  return n;
}
const pad = (n, w = 6) => String(n).padStart(w, '0');

async function checkLock(conn, date) {
  const s = await getSettings(conn);
  if (s.lock_date && date <= s.lock_date) throw bad('الفترة مقفلة حتى ' + s.lock_date + ' ولا يمكن التسجيل فيها');
}

// Create a balanced journal entry. lines: [{account_id, debit, credit, description, cost_center_id, party_id}]
async function postEntry(conn, e) {
  if (!isDate(e.date)) throw bad('تاريخ القيد غير صحيح');
  await checkLock(conn, e.date);
  const lines = (e.lines || []).map(l => ({ ...l, debit: money(l.debit), credit: money(l.credit) }))
    .filter(l => l.debit > 0 || l.credit > 0);
  if (lines.length < 2) throw bad('القيد يحتاج سطرين على الأقل');
  let d = 0, c = 0;
  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) throw bad('لا يمكن أن يحتوي السطر على مدين ودائن معاً');
    if (l.debit < 0 || l.credit < 0) throw bad('القيم السالبة غير مسموحة');
    d += l.debit; c += l.credit;
  }
  if (Math.abs(d - c) > 0.005) throw bad('القيد غير متوازن: مدين ' + money(d) + ' / دائن ' + money(c));
  const ids = [...new Set(lines.map(l => l.account_id))];
  const [accs] = await conn.query('SELECT id,is_group,active,name FROM accounts WHERE id IN (?)', [ids]);
  if (accs.length !== ids.length) throw bad('حساب غير موجود في القيد');
  for (const a of accs) {
    if (a.is_group) throw bad('الحساب "' + a.name + '" حساب رئيسي ولا يقبل الترحيل');
    if (!a.active) throw bad('الحساب "' + a.name + '" موقوف');
  }
  const type = e.type || 'JV';
  const n = await nextSeq(conn, 'je_' + type);
  const number = type + '-' + pad(n);
  const [r] = await conn.query('INSERT INTO journal_entries(number,type,date,branch_id,description,ref_type,ref_id,created_by) VALUES(?,?,?,?,?,?,?,?)',
    [number, type, e.date, e.branch_id || null, e.description || null, e.ref_type || null, e.ref_id || null, e.user ? e.user.id : null]);
  const vals = lines.map(l => [r.insertId, l.account_id, l.debit, l.credit, l.description || null, l.cost_center_id || null, l.party_id || null]);
  await conn.query('INSERT INTO journal_lines(entry_id,account_id,debit,credit,description,cost_center_id,party_id) VALUES ?', [vals]);
  return { id: r.insertId, number };
}

async function removeEntry(conn, entryId) {
  if (!entryId) return;
  const [e] = await conn.query('SELECT date FROM journal_entries WHERE id=?', [entryId]);
  if (e[0]) await checkLock(conn, e[0].date);
  await conn.query('DELETE FROM journal_lines WHERE entry_id=?', [entryId]);
  await conn.query('DELETE FROM journal_entries WHERE id=?', [entryId]);
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) { try { await conn.rollback(); } catch (_) {} throw e; }
  finally { conn.release(); }
}

module.exports = { initDb, db, hashPw, checkPw, sign, verify, can, HttpError, bad, money, num, isDate, audit, getSettings, nextSeq, pad, postEntry, removeEntry, checkLock, tx };
