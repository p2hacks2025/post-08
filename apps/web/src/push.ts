// src/push.ts - Web Push購読管理

const API_URL = import.meta.env.VITE_API_URL as string
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = [...raw].map((c) => c.charCodeAt(0))
  return new Uint8Array(arr)
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied'
  return Notification.permission
}

export async function subscribePush(idToken: string, familyId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    if (!isPushSupported()) {
      return { ok: false, message: 'このブラウザはプッシュ通知に対応していません' }
    }

    if (!VAPID_PUBLIC_KEY) {
      return { ok: false, message: 'VAPID公開鍵が設定されていません' }
    }

    // 通知許可を要求
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { ok: false, message: '通知が許可されませんでした' }
    }

    // Service Worker登録（既に他のファイルで登録されているはず）
    let registration = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      // まだ登録されていない場合は待機（他のファイルで登録中かもしれない）
      await navigator.serviceWorker.ready
      registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        return { ok: false, message: 'Service Workerが登録されていません' }
      }
    }

    // 既存の購読があるかチェック
    let subscription = await registration.pushManager.getSubscription()

    // なければ新規購読
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    // サーバーに送信
    const res = await fetch(`${API_URL}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        familyId,
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      }),
    })

    const data = await res.json()
    if (!data.ok) {
      return { ok: false, message: data.message || '登録に失敗しました' }
    }

    return { ok: true }
  } catch (e: any) {
    console.error('Push subscription failed:', e)
    return { ok: false, message: e?.message || 'エラーが発生しました' }
  }
}

export async function unsubscribePush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return true

    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return true

    await subscription.unsubscribe()
    return true
  } catch {
    return false
  }
}

