// Banco de dados SQLite (módulo nativo node:sqlite) e utilitários de persistência.
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'storage');
fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'laudo.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, tagline TEXT,
  theme TEXT, sender TEXT, orientation_text TEXT, published INTEGER DEFAULT 1,
  logo_file TEXT, logo_dark_file TEXT, created_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, cpf TEXT,
  roles TEXT, scope TEXT, token TEXT UNIQUE, password_hash TEXT,
  active INTEGER DEFAULT 1, terms_accepted_at TEXT, last_access_at TEXT,
  link_opened_at TEXT, invited_by INTEGER, blocks TEXT,
  created_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS municipalities (
  ibge TEXT PRIMARY KEY, name TEXT, pop2022 INTEGER, pop2024 INTEGER,
  porte_cet TEXT, porte_override TEXT, override_reason TEXT
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY, brand_id INTEGER, cnpj TEXT UNIQUE, razao TEXT, fantasia TEXT,
  address TEXT, cep TEXT, municipio_ibge TEXT, porte_override TEXT, porte_override_reason TEXT,
  situacao_cadastral TEXT, cnpj_data TEXT, cnpj_checked_at TEXT, cnpj_source TEXT,
  coordinator_id INTEGER, status TEXT DEFAULT 'ativa', cred_expiry TEXT, cred_portaria TEXT,
  rep_name TEXT, rep_cpf TEXT, rep_role TEXT, contact_email TEXT, contact_phone TEXT,
  rt_id INTEGER, config TEXT, drive_folder TEXT, created_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS store_users ( store_id INTEGER, user_id INTEGER, kind TEXT, PRIMARY KEY (store_id, user_id) );
CREATE TABLE IF NOT EXISTS rts (
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, cpf TEXT, council TEXT, reg_number TEXT, uf TEXT,
  email TEXT, phone TEXT, validated_by INTEGER, validated_at TEXT, created_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS laudos (
  id INTEGER PRIMARY KEY, store_id INTEGER, code TEXT UNIQUE, process_type TEXT, scope_items TEXT,
  deadline TEXT, status TEXT, sub_status TEXT, version INTEGER DEFAULT 0, data TEXT, reviews TEXT,
  alerts_just TEXT, rt_id INTEGER, coordinator_id INTEGER, params_version INTEGER,
  requested_by INTEGER, created_at TEXT, updated_at TEXT, last_activity_at TEXT,
  submitted_at TEXT, protocol TEXT, result TEXT, exigencia TEXT, cancel_reason TEXT,
  parent_laudo_id INTEGER, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, laudo_id INTEGER, item TEXT, slot TEXT, file TEXT, pdf_file TEXT, small_file TEXT,
  sha TEXT, dhash TEXT, width INTEGER, height INTEGER, size INTEGER, is_color INTEGER, brightness REAL, sharpness REAL,
  taken_at TEXT, lat REAL, lng REAL, source TEXT, caption TEXT, essential INTEGER DEFAULT 1, annotations TEXT,
  uploaded_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, laudo_id INTEGER, store_id INTEGER, equipment_id INTEGER, kind TEXT, item TEXT,
  file TEXT, original_name TEXT, mime TEXT, size INTEGER, sha TEXT, meta TEXT,
  uploaded_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY, store_id INTEGER, type TEXT, subtype TEXT, description TEXT, brand TEXT, model TEXT,
  serial TEXT, patrimonio TEXT, box TEXT, specs TEXT, cert TEXT, status TEXT DEFAULT 'ativo',
  photos TEXT, confirmed_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY, laudo_id INTEGER, n INTEGER, code TEXT UNIQUE, reason TEXT, snapshot TEXT,
  public_token TEXT, access_password TEXT, access_until TEXT, revoked INTEGER DEFAULT 0,
  docs TEXT, views INTEGER DEFAULT 0, created_at TEXT, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT, user_id INTEGER, user_name TEXT, role TEXT, via TEXT, ip TEXT, ua TEXT,
  action TEXT, entity TEXT, entity_id TEXT, store_id INTEGER, laudo_id INTEGER, item TEXT,
  before TEXT, after TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'auditoria é imutável'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'auditoria é imutável'); END;
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY, entity TEXT, entity_id INTEGER, label TEXT, deleted_at TEXT, deleted_by INTEGER, restored_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, at TEXT, channel TEXT, to_addr TEXT, to_name TEXT, subject TEXT, body TEXT,
  brand_id INTEGER, store_id INTEGER, laudo_id INTEGER, kind TEXT, status TEXT DEFAULT 'enviado'
);
CREATE TABLE IF NOT EXISTS params ( version INTEGER PRIMARY KEY, label TEXT, data TEXT, created_at TEXT, created_by INTEGER );
CREATE TABLE IF NOT EXISTS sessions ( id TEXT PRIMARY KEY, user_id INTEGER, via TEXT, ua TEXT, ip TEXT, created_at TEXT, last_seen TEXT, pending_2fa TEXT );
CREATE TABLE IF NOT EXISTS presence ( laudo_id INTEGER, item TEXT, user_id INTEGER, at TEXT, PRIMARY KEY (laudo_id, item, user_id) );
`);

const now = () => new Date().toISOString();
const J = (s, d = null) => { if (s == null || s === '') return d; try { return JSON.parse(s); } catch { return d; } };
const S = (o) => (o == null ? null : JSON.stringify(o));
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');

function one(sql, ...p) { return db.prepare(sql).get(...p); }
function all(sql, ...p) { return db.prepare(sql).all(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }
function insert(table, obj) {
  const keys = Object.keys(obj);
  const r = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => obj[k] === undefined ? null : obj[k]));
  return Number(r.lastInsertRowid);
}
function update(table, id, obj, key = 'id') {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE ${key}=?`)
    .run(...keys.map((k) => obj[k] === undefined ? null : obj[k]), id);
}
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, DATA_DIR, now, J, S, token, one, all, run, insert, update, tx };
