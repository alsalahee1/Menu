'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

const db = new Database(config.databaseFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Add a column to an existing table if it is missing.
 *
 * schema.sql only uses CREATE TABLE IF NOT EXISTS, so it can create new tables
 * but never alters existing ones. Columns added after a database already
 * exists have to be applied here.
 *
 * `definition` must include a constant default (SQLite cannot add a column
 * with a non-constant default to a populated table).
 */
function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

/** Columns introduced after the initial release. */
const ADDED_COLUMNS = [
  // Online payments
  ['restaurants', 'online_payments_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['orders', 'payment_reference', "TEXT NOT NULL DEFAULT ''"],
  // Arabic / bilingual menu content
  ['restaurants', 'name_ar', "TEXT NOT NULL DEFAULT ''"],
  ['restaurants', 'description_ar', "TEXT NOT NULL DEFAULT ''"],
  ['categories', 'name_ar', "TEXT NOT NULL DEFAULT ''"],
  ['categories', 'description_ar', "TEXT NOT NULL DEFAULT ''"],
  ['menu_items', 'name_ar', "TEXT NOT NULL DEFAULT ''"],
  ['menu_items', 'description_ar', "TEXT NOT NULL DEFAULT ''"],
  ['option_groups', 'name_ar', "TEXT NOT NULL DEFAULT ''"],
  ['options', 'name_ar', "TEXT NOT NULL DEFAULT ''"],
];

/** Create missing tables, then apply additive column migrations. */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const applied = [];
  for (const [table, column, definition] of ADDED_COLUMNS) {
    if (ensureColumn(table, column, definition)) applied.push(`${table}.${column}`);
  }
  if (applied.length) console.log(`[db] added columns: ${applied.join(', ')}`);
}

module.exports = { db, migrate, ensureColumn };
