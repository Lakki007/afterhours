/*
  Web Push subscribe flow (client side of server/src/core/push).
  enablePush() asks for permission at a moment the person chose (a button),
  subscribes through the service worker and registers the subscription.
*/
import { OkSchema, PushKeyResponseSchema } from '@afterhours/shared';
import { api } from '../../core/api';

export type PushOutcome = 'on' | 'denied' | 'unsupported' | 'server-off' | 'no-worker';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readyWorker(ms = 6000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => window.setTimeout(() => r(null), ms))]);
}

export async function enablePush(): Promise<PushOutcome> {
  if (!pushSupported()) return 'unsupported';
  const key = await api.get('/api/push/key', PushKeyResponseSchema);
  if (!key.enabled || !key.publicKey) return 'server-off';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await readyWorker();
  if (!reg) return 'no-worker';
  let sub = await reg.pushManager.getSubscription();
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) });
  await api.post('/api/push/subscribe', sub.toJSON(), OkSchema);
  return 'on';
}

/** Already subscribed on this device (permission granted and a live subscription). */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await readyWorker(1500);
  return Boolean(reg && (await reg.pushManager.getSubscription()));
}
