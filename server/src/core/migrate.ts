import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, all, run, tx } from './db';

export interface MigrationSource {
  /** 'core' or a feature name. */
  scope: string;
  dir: string;
}

export interface Migration {
  /** "<scope>/<file>", e.g. "core/001_init.sql". Primary key in the _migrations table. */
  id: string;
  scope: string;
  number: number;
  file: string;
  sql: string;
}

const FILE_RE = /^(\d{3})_[a-z0-9_-]+\.sql$/;

/**
 * Deterministic order: 'core' first, then feature scopes alphabetically,
 * each scope by its 3-digit number. Features must not depend on another
 * feature's tables (only on core ones).
 */
export function collectMigrations(sources: MigrationSource[]): Migration[] {
  const sorted = [...sources].sort((a, b) => {
    if (a.scope === b.scope) return 0;
    if (a.scope === 'core') return -1;
    if (b.scope === 'core') return 1;
    return a.scope < b.scope ? -1 : 1;
  });
  const seenScopes = new Set<string>();
  const out: Migration[] = [];
  for (const { scope, dir } of sorted) {
    if (seenScopes.has(scope)) throw new Error(`Migration scope "${scope}" listed twice`);
    seenScopes.add(scope);
    if (!existsSync(dir)) continue;
    const numbers = new Map<number, string>();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      const m = FILE_RE.exec(file);
      if (!m?.[1]) throw new Error(`Bad migration filename ${scope}/${file}: use NNN_snake_name.sql`);
      const n = Number(m[1]);
      const clash = numbers.get(n);
      if (clash) throw new Error(`Two migrations numbered ${m[1]} in ${scope}: ${clash} and ${file}`);
      numbers.set(n, file);
    }
    const ordered = [...numbers.entries()].sort((a, b) => a[0] - b[0]);
    for (const [number, file] of ordered) {
      out.push({ id: `${scope}/${file}`, scope, number, file, sql: readFileSync(join(dir, file), 'utf8') });
    }
  }
  return out;
}

const checksum = (sql: string) => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

export interface MigrateResult {
  applied: string[];
  /** Already-applied migrations whose file changed since. Never re-run; warn loudly. */
  changed: string[];
}

export function runMigrations(db: Db, sources: MigrationSource[]): MigrateResult {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const done = new Map(all<{ id: string; checksum: string }>(db, 'SELECT id, checksum FROM _migrations').map((r) => [r.id, r.checksum]));
  const result: MigrateResult = { applied: [], changed: [] };
  for (const m of collectMigrations(sources)) {
    const sum = checksum(m.sql);
    const prev = done.get(m.id);
    if (prev !== undefined) {
      if (prev !== sum) result.changed.push(m.id);
      continue;
    }
    tx(db, () => {
      db.exec(m.sql);
      run(db, 'INSERT INTO _migrations (id, scope, checksum, applied_at) VALUES (?, ?, ?, ?)', m.id, m.scope, sum, Date.now());
    });
    result.applied.push(m.id);
  }
  return result;
}
