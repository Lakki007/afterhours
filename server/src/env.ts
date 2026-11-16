import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Load the nearest .env (cwd, then parents up to 3 levels) into process.env without overriding real env vars. */
export function loadDotEnv(start = process.cwd()): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 4; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
