import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationSources } from '../src/app';
import { all, openDb } from '../src/core/db';
import { collectMigrations, runMigrations } from '../src/core/migrate';
import { features } from '../src/features/registry';
import { SRC_ROOT } from './helpers';

describe('migrations', () => {
  let root: string;
  const write = (rel: string, sql: string) => {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, sql);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ah-mig-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('orders core first, then features alphabetically, each by number (not by file listing order)', () => {
    write('core/010_later.sql', 'CREATE TABLE c10 (x);');
    write('core/002_second.sql', 'CREATE TABLE c2 (x);');
    write('zebra/001_z.sql', 'CREATE TABLE z1 (x);');
    write('alpha/003_c.sql', 'CREATE TABLE a3 (x);');
    write('alpha/001_a.sql', 'CREATE TABLE a1 (x);');
    const sources = [
      { scope: 'zebra', dir: join(root, 'zebra') },
      { scope: 'alpha', dir: join(root, 'alpha') },
      { scope: 'core', dir: join(root, 'core') },
      { scope: 'missing', dir: join(root, 'missing') }, // a feature with no migrations is fine
    ];
    expect(collectMigrations(sources).map((m) => m.id)).toEqual([
      'core/002_second.sql',
      'core/010_later.sql',
      'alpha/001_a.sql',
      'alpha/003_c.sql',
      'zebra/001_z.sql',
    ]);
  });

  it('applies once, records each, and picks up new files later', () => {
    write('core/001_a.sql', 'CREATE TABLE a (x);');
    const db = openDb(':memory:');
    const sources = [{ scope: 'core', dir: join(root, 'core') }];
    expect(runMigrations(db, sources).applied).toEqual(['core/001_a.sql']);
    expect(runMigrations(db, sources).applied).toEqual([]);
    write('core/002_b.sql', 'CREATE TABLE b (x);');
    expect(runMigrations(db, sources).applied).toEqual(['core/002_b.sql']);
    expect(all<{ id: string }>(db, 'SELECT id FROM _migrations ORDER BY id').map((r) => r.id)).toEqual(['core/001_a.sql', 'core/002_b.sql']);
    // editing an applied migration is reported, not re-run
    write('core/001_a.sql', 'CREATE TABLE a (x, y);');
    expect(runMigrations(db, sources)).toEqual({ applied: [], changed: ['core/001_a.sql'] });
    db.close();
  });

  it('a failing migration rolls back and is not recorded', () => {
    write('core/001_ok.sql', 'CREATE TABLE ok (x);');
    write('core/002_bad.sql', 'CREATE TABLE half (x); THIS IS NOT SQL;');
    const db = openDb(':memory:');
    expect(() => runMigrations(db, [{ scope: 'core', dir: join(root, 'core') }])).toThrow();
    const tables = all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    expect(tables).toContain('ok');
    expect(tables).not.toContain('half');
    expect(all<{ id: string }>(db, 'SELECT id FROM _migrations').map((r) => r.id)).toEqual(['core/001_ok.sql']);
    db.close();
  });

  it('rejects bad filenames and duplicate numbers', () => {
    write('core/1_bad.sql', '');
    expect(() => collectMigrations([{ scope: 'core', dir: join(root, 'core') }])).toThrow(/Bad migration filename/);
    rmSync(join(root, 'core'), { recursive: true });
    write('core/001_a.sql', '');
    write('core/001_b.sql', '');
    expect(() => collectMigrations([{ scope: 'core', dir: join(root, 'core') }])).toThrow(/Two migrations numbered 001/);
  });

  it('the real migrations apply cleanly on a fresh database', () => {
    const db = openDb(':memory:');
    const r = runMigrations(db, migrationSources(SRC_ROOT, features));
    expect(r.applied[0]).toBe('core/001_core.sql');
    expect(r.applied).toContain('reactions/001_reactions.sql');
    db.close();
  });
});
