import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type Db = DatabaseSync;
export type SqlParam = SQLInputValue;

/** Open (or create) the SQLite database with the pragmas we rely on. Use ':memory:' in tests. */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

const stmtCache = new WeakMap<Db, Map<string, StatementSync>>();

/** Prepared statements are cached per db+sql; call freely in hot paths. */
export function stmt(db: Db, sql: string): StatementSync {
  let cache = stmtCache.get(db);
  if (!cache) stmtCache.set(db, (cache = new Map()));
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
}

/** First row or undefined. Row shape is asserted by the caller's type parameter. */
export function one<T>(db: Db, sql: string, ...params: SqlParam[]): T | undefined {
  return stmt(db, sql).get(...params) as T | undefined;
}

export function all<T>(db: Db, sql: string, ...params: SqlParam[]): T[] {
  return stmt(db, sql).all(...params) as T[];
}

export function run(db: Db, sql: string, ...params: SqlParam[]): { changes: number; lastId: number } {
  const r = stmt(db, sql).run(...params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

const depth = new WeakMap<Db, number>();

/**
 * Run fn in a transaction (nested calls become savepoints). fn must be
 * synchronous: never await inside a transaction.
 */
export function tx<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('tx() callback must be synchronous');
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  } finally {
    depth.set(db, d);
  }
}
