import { describe, expect, it } from 'vitest';
import { formatPassword, normaliseKitId, normalisePassword, PASSWORD_ALPHABET, SignInRequestSchema } from './auth';

describe('kit ids', () => {
  it('normalises the ways people type them', () => {
    for (const v of ['AH-042', 'ah-42', 'ah042', ' AH 42 ', 'Ah_042']) expect(normaliseKitId(v)).toBe('AH-042');
    expect(normaliseKitId('AH-1234')).toBe('AH-1234');
  });
  it('rejects junk', () => {
    for (const v of ['', 'AH-', 'XY-042', 'AH-0', '42', 'AH-12345']) expect(normaliseKitId(v)).toBeNull();
  });
});

describe('passwords', () => {
  it('alphabet has no lookalikes', () => {
    for (const c of '0O1lI') expect(PASSWORD_ALPHABET.includes(c)).toBe(false);
  });
  it('normalises case and separators', () => {
    expect(normalisePassword('k7m 4qp')).toBe('K7M4QP');
    expect(normalisePassword('K7M-4QP')).toBe('K7M4QP');
    expect(formatPassword('K7M4QP')).toBe('K7M 4QP');
  });
  it('sign-in schema normalises both fields', () => {
    expect(SignInRequestSchema.parse({ kitId: 'ah42', password: 'k7m 4qp' })).toEqual({ kitId: 'AH-042', password: 'K7M4QP' });
    expect(SignInRequestSchema.safeParse({ kitId: 'nope', password: 'x' }).success).toBe(false);
  });
});
