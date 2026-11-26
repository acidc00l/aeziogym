// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported')

const urlBase64ToUint8Array = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications permission was not granted')
  const reg = await navigator.serviceWorker.ready
  const { key } = await api('/api/push/public-key')
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })

// Re-subscribe quietly when the server's VAPID keys changed (or it lost this device's subscription):
// otherwise every reminder fails with VapidPkHashMismatch and the user never finds out. Only acts
// when notifications are already allowed and this device was subscribed — it never prompts.
export async function refreshPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const { key } = await api('/api/push/public-key')
  const want = urlBase64ToUint8Array(key)
  const raw = sub.options && sub.options.applicationServerKey
  const have = raw ? new Uint8Array(raw) : null
  let current = sub
  if (!have || have.length !== want.length || have.some((b, i) => b !== want[i])) {
    await sub.unsubscribe().catch(() => {})
    current = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  }
  // Idempotent on the server (replaces the same endpoint): also heals a subscription it dropped.
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: current.toJSON() }) })
}
