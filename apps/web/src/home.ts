// src/home.ts - ホームページ（統一ランディングページ）
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { handleCallbackIfPresent, isLoggedIn, startLogin } from './auth'

registerSW({ immediate: true })

const app = document.querySelector<HTMLDivElement>('#app')!

function renderLoading() {
  app.innerHTML = `
    <div class="card">
      <h1 class="h1">🧼 ぴかって！</h1>
      <p class="p muted">読み込み中...</p>
    </div>
  `
}

function renderHome() {
  const loggedIn = isLoggedIn()

  app.innerHTML = `
    <div class="card home-card">
      <div class="home-hero">
        <div class="home-icon">🧼</div>
        <h1 class="h1">ぴかって！</h1>
        <p class="p">家族みんなで楽しく手洗い習慣！</p>
      </div>

      <div class="home-features">
        <div class="feature-item">
          <span class="feature-icon">⏱️</span>
          <span>20秒タイマー</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">👨‍👩‍👧‍👦</span>
          <span>家族で共有</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">🔔</span>
          <span>リマインド通知</span>
        </div>
      </div>

      ${loggedIn ? `
        <button class="btn btn-large btn-primary" id="startWash">
          🧼 手洗いをはじめる
        </button>

        <div style="height: 12px"></div>

        <div class="row">
          <button class="btn secondary flex-1" id="goMypage">📊 マイページ</button>
        </div>
      ` : `
        <button class="btn btn-large btn-primary" id="login">ログインして始める</button>
      `}

      <p class="small" style="margin-top: 16px;">
        ${loggedIn 
          ? '手洗いの記録は自動で保存されます' 
          : 'ログインして、手洗い履歴の記録・家族との共有・リマインド通知を使いましょう！'}
      </p>
    </div>
    <div class="version-info">v1.0.0</div>
  `

  if (loggedIn) {
    document.getElementById('startWash')!.addEventListener('click', () => {
      location.href = '/wash/'
    })
    document.getElementById('goMypage')!.addEventListener('click', () => {
      location.href = '/mypage/'
    })
  } else {
    document.getElementById('login')!.addEventListener('click', () => startLogin())
  }
}

// --- Main ---
;(async () => {
  renderLoading()

  try {
    // OAuth callback handling
    await handleCallbackIfPresent()
  } catch (e) {
    console.error('Callback handling failed:', e)
  }

  renderHome()
})()
