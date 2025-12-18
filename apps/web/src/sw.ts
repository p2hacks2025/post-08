/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Workboxのプリキャッシュ（vite-plugin-pwaが自動的にマニフェストを注入）
precacheAndRoute(self.__WB_MANIFEST)

// 明示的なfetchハンドラー（PWAインストール条件を満たすため）
self.addEventListener('fetch', (event) => {
  // Workboxが処理しないリクエストはネットワークから取得
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request) as Promise<Response>
      })
    )
  }
})

// Push通知の受信
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || '手洗いリマインド'
  const options = {
    body: data.body || '今日の手洗い、忘れてない？',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    tag: 'handwash-reminder',
    renotify: true,
  } as NotificationOptions
  event.waitUntil(self.registration.showNotification(title, options))
})

// 通知クリック時の処理
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification?.data?.url as string) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windowClients) => {
      // 既に開いてるタブがあればフォーカス
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      // なければ新しいウィンドウを開く
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})
