import { describe, expect, it } from 'vitest';
import type { ServerFeature } from '../src/core/context';
import { seedOrder } from '../src/core/seedOrder';
import { features } from '../src/features/registry';

const f = (name: string, seedAfter?: string[]): ServerFeature => ({ name, seedAfter });

describe('seedOrder', () => {
  it('keeps registry order and moves a feature after its seedAfter deps', () => {
    expect(seedOrder([f('a', ['c']), f('b'), f('c')]).map((x) => x.name)).toEqual(['c', 'a', 'b']);
  });
  it('ignores unknown deps and throws on cycles', () => {
    expect(seedOrder([f('a', ['zzz'])]).map((x) => x.name)).toEqual(['a']);
    expect(() => seedOrder([f('a', ['b']), f('b', ['a'])])).toThrow(/cycle/);
  });
  it('the real registry seeds schedule before attendance', () => {
    const names = seedOrder(features).map((x) => x.name);
    expect(names.indexOf('schedule')).toBeLessThan(names.indexOf('attendance'));
  });
});
