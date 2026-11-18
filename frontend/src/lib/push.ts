// Web push: subscribe this browser with the API's VAPID key.
import { api } from './api';

const b64ToUint8 = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushStatus(): Promise<'unsupported' | 'denied' | 'on' | 'off'> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<boolean> {
  const { publicKey } = await api<{ publicKey: string | null }>('/push/key');
  if (!publicKey || !pushSupported()) return false;
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
