// Order feature seeds: registry order, honouring each feature's `seedAfter`.
import type { ServerFeature } from './context';

/** Registry order, except a feature runs after the ones named in its `seedAfter`. */
export function seedOrder(list: ServerFeature[]): ServerFeature[] {
  const byName = new Map(list.map((f) => [f.name, f]));
  const out: ServerFeature[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (f: ServerFeature) => {
    const st = state.get(f.name);
    if (st === 'done') return;
    if (st === 'visiting') throw new Error(`seedAfter cycle at ${f.name}`);
    state.set(f.name, 'visiting');
    for (const dep of f.seedAfter ?? []) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    state.set(f.name, 'done');
    out.push(f);
  };
  list.forEach(visit);
  return out;
}
