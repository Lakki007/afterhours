import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { PASSWORD_ALPHABET, PASSWORD_LENGTH } from '@afterhours/shared';

// scrypt cost: N=2^14, r=8, p=1 (~16 MB, a few tens of ms). Strong enough for
// 6-char one-afternoon passwords behind a rate limit, cheap enough to hash
// 300 kits at generation time.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function scryptAsync(pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scryptAsync(pw, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash of a random password, used to keep timing equal when a kit id does not exist. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(8).toString('hex'));
  return dummyHash;
}

/** 6 characters from the unambiguous alphabet, CSPRNG. */
export function generatePassword(): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

/** Opaque random token for cookies. Only its sha256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
