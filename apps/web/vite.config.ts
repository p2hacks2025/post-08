import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        wash: resolve(__dirname, 'wash/index.html'),
        mypage: resolve(__dirname, 'mypage/index.html'),
      },
    },
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module',
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
      },
      manifest: {
        name: '手洗いサポート',
        short_name: '手洗い',
        description: '家族みんなで楽しく手洗い習慣をつけよう！20秒タイマーと履歴管理で手洗いをサポート。',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/wash/',
        theme_color: '#22d3ee',
        background_color: '#0f172a',
        categories: ['health', 'lifestyle'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
