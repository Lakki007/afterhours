/*
  Flattens the web feature registry into the lists each surface needs.
  Surfaces read from here; features never import this file.
*/
import { features } from '../features/registry';
import type { SceneDef, WebFeature } from './feature';

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export const attendeeRoutes = features.flatMap((f) => (f.routes ?? []).map((r) => ({ ...r, feature: f.name })));

export const homeCards = features
  .flatMap((f) => (f.home ? [{ feature: f.name, ...f.home }] : []))
  .sort(byOrder);

export const navItems = features
  .flatMap((f) => (f.nav ? [{ feature: f.name, ...f.nav }] : []))
  .sort(byOrder);

export const consolePanels = features
  .flatMap((f) => (f.console ? [{ feature: f.name, ...f.console }] : []))
  .sort(byOrder);

export const scenes: (SceneDef & { feature: string })[] = features
  .flatMap((f) => (f.scenes ?? []).map((sc) => ({ ...sc, feature: f.name })))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

export const attendeeOverlays: WebFeature[] = features.filter((f) => f.AttendeeOverlay);
export const screenOverlays: WebFeature[] = features.filter((f) => f.ScreenOverlay);
