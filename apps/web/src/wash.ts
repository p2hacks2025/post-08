// src/wash.ts - 手洗いタイマー（泡UI版）
import './style.css'
import { getIdToken, isLoggedIn, startLogin, handleCallbackIfPresent } from './auth'

const API_URL = import.meta.env.VITE_API_URL as string
const STORAGE_FAMILY_ID = 'selected:familyId'

function getSelectedFamilyId(): string | null {
  return sessionStorage.getItem(STORAGE_FAMILY_ID)
}

type Mode = 'home' | 'meal'
type Phase = 'idle' | 'intro' | 'playing' | 'select' | 'done'

const app = document.querySelector<HTMLDivElement>('#app')!

let mode: Mode | null = null
let elapsedSeconds = 0
let intervalId: number | null = null
let wakeLock: any = null

function setHTML(html: string) {
  app.innerHTML = html
}

function modeLabel(m: Mode) {
  return m === 'home' ? '帰ってきた後' : 'ご飯を食べる前'
}

// --- Wake Lock ---
async function requestWakeLock() {
  try {
    // @ts-ignore
    if ('wakeLock' in navigator) {
      // @ts-ignore
      wakeLock = await navigator.wakeLock.request('screen')
    }
  } catch {}
}

async function releaseWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release()
      wakeLock = null
    }
  } catch {}
}

// --- Timer (カウントアップ) ---
function stopTimer() {
  if (intervalId !== null) {
    window.clearInterval(intervalId)
    intervalId = null
  }
  releaseWakeLock()
}

function startTimer() {
  stopTimer()
  elapsedSeconds = 0
  requestWakeLock()

  intervalId = window.setInterval(() => {
    elapsedSeconds += 1
    updateTimerDisplay()
    
    // 20秒経過で終了ボタンを有効化
    if (elapsedSeconds >= 20) {
      const finishBtn = document.getElementById('finish-btn') as HTMLButtonElement
      const btnHint = document.getElementById('btn-hint')
      if (finishBtn && finishBtn.disabled) {
        finishBtn.disabled = false
        finishBtn.classList.remove('disabled')
      }
      if (btnHint) {
        btnHint.textContent = '終了できます！'
      }
    }
  }, 1000)
}

// --- Backend API call ---
async function recordHandwash() {
  try {
    const idToken = getIdToken()
    const familyId = getSelectedFamilyId()

    const payload = {
      mode,
      finishedAt: new Date().toISOString(),
      durationSec: elapsedSeconds,
    }

    console.log('handwash complete:', payload)

    if (idToken && familyId && API_URL) {
      const res = await fetch(`${API_URL}/handwash/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          familyId,
          mode,
          durationSec: elapsedSeconds,
        }),
      })

      if (res.ok) {
        console.log('handwash event recorded successfully')
        return true
      } else {
        console.warn('handwash event recording failed:', res.status)
      }
    } else {
      console.log('not logged in or no family selected, skipping API call')
    }
  } catch (e) {
    console.warn('complete hook failed (ignored):', e)
  }
  return false
}

// --- 泡パーティクル生成 ---
function createBubbleParticles(x: number, y: number, count = 8) {
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div')
    particle.className = 'bubble-particle'
    const size = 8 + Math.random() * 16
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
    const distance = 40 + Math.random() * 60
    particle.style.width = `${size}px`
    particle.style.height = `${size}px`
    particle.style.left = `${x - size / 2}px`
    particle.style.top = `${y - size / 2}px`
    particle.style.setProperty('--tx', `${Math.cos(angle) * distance}px`)
    particle.style.setProperty('--ty', `${Math.sin(angle) * distance - 30}px`)
    document.body.appendChild(particle)
    setTimeout(() => particle.remove(), 600)
  }
}

// --- 背景の小さな泡を生成（%指定で画面全体に配置）---
function generateBubbleField(): string {
  const bubbles: string[] = []
  const configs = [
    { left: '5%', size: 20, delay: 0.0, dur: 5.5 },
    { left: '15%', size: 14, delay: 1.2, dur: 4.2 },
    { left: '25%', size: 28, delay: 0.5, dur: 6.5 },
    { left: '35%', size: 16, delay: 2.0, dur: 5.0 },
    { left: '45%', size: 22, delay: 0.8, dur: 5.8 },
    { left: '55%', size: 12, delay: 1.5, dur: 4.0 },
    { left: '65%', size: 18, delay: 0.3, dur: 5.2 },
    { left: '75%', size: 24, delay: 2.5, dur: 4.8 },
    { left: '85%', size: 10, delay: 3.0, dur: 3.8 },
    { left: '95%', size: 20, delay: 1.8, dur: 6.2 },
  ]

  configs.forEach((c) => {
    bubbles.push(`
      <div class="small-bubble" style="
        left: ${c.left};
        width: ${c.size}px;
        height: ${c.size}px;
        animation-duration: ${c.dur}s;
        animation-delay: ${c.delay}s;
      "></div>
    `)
  })

  return `<div class="small-bubble-field">${bubbles.join('')}</div>`
}

// --- タイマー表示更新 ---
function updateTimerDisplay() {
  const timerEl = document.querySelector('.wash-timer-display')
  if (timerEl) {
    const mins = Math.floor(elapsedSeconds / 60)
    const secs = elapsedSeconds % 60
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// --- Phase遷移 ---
function transitionToPhase(newPhase: Phase) {
  if (newPhase === 'intro') {
    renderWashScene()
    // 大きな泡がせり上がる
    setTimeout(() => {
      const bigBubble = document.querySelector('.main-big-bubble')
      bigBubble?.classList.add('visible')
    }, 50)
    // せり上がり完了後、アニメーションをフェードイン
    setTimeout(() => {
      const content = document.querySelector('.handwash-content')
      content?.classList.add('visible')
      transitionToPhase('playing')
    }, 1000)
  } else if (newPhase === 'playing') {
    startTimer()
  } else if (newPhase === 'select') {
    stopTimer()
    // コンテンツをフェードアウト
    const content = document.querySelector('.handwash-content')
    const bigBubble = document.querySelector('.main-big-bubble')
    content?.classList.remove('visible')
    content?.classList.add('fade-out')
    
    setTimeout(() => {
      bigBubble?.classList.remove('visible')
      bigBubble?.classList.add('exit')
    }, 300)
    
    setTimeout(() => {
      renderSelectScene()
    }, 1000)
  } else if (newPhase === 'done') {
    renderDone()
  }
}

// --- Views ---
function renderWashScene() {
  setHTML(`
    <div class="wash-scene-new">
      <div class="wash-bg-gradient"></div>
      ${generateBubbleField()}
      
      <div class="main-big-bubble">
        <div class="bubble-shine"></div>
        <div class="bubble-shine-small"></div>
      </div>

      <div class="handwash-content">
        <div class="timer-pill">
          <span class="wash-timer-display">0:00</span>
        </div>

        <div class="animation-container">
          <img src="/steps/01.png" alt="手洗い" class="handwash-anim" />
        </div>

        <p class="status-text">手を洗っています...</p>

        <div class="finish-btn-area">
          <button class="finish-bubble-btn disabled" id="finish-btn" disabled>
            <span class="btn-shine"></span>
            終了
          </button>
          <p class="hint-text" id="btn-hint">20秒後に終了できます</p>
        </div>
      </div>
    </div>
  `)

  document.getElementById('finish-btn')!.addEventListener('click', (e) => {
    if ((e.currentTarget as HTMLButtonElement).disabled) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    createBubbleParticles(rect.left + rect.width / 2, rect.top + rect.height / 2)
    transitionToPhase('select')
  })
}

function renderSelectScene() {
  setHTML(`
    <div class="wash-scene-new">
      <div class="wash-bg-gradient"></div>
      ${generateBubbleField()}

      <div class="select-content visible">
        <h1 class="select-title">いまの場面は？</h1>
        <p class="select-subtitle">タップして記録しよう</p>

        <div class="select-buttons">
          <button class="select-bubble-btn" id="home">
            <span class="btn-shine"></span>
            <span class="btn-icon">🏠</span>
            <span class="btn-label">帰ってきた後</span>
          </button>
          <button class="select-bubble-btn" id="meal">
            <span class="btn-shine"></span>
            <span class="btn-icon">🍽️</span>
            <span class="btn-label">ご飯を食べる前</span>
          </button>
        </div>
      </div>
    </div>
  `)

  document.getElementById('home')!.addEventListener('click', async (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    createBubbleParticles(rect.left + rect.width / 2, rect.top + rect.height / 2)
    mode = 'home'
    await recordHandwash()
    setTimeout(() => transitionToPhase('done'), 150)
  })

  document.getElementById('meal')!.addEventListener('click', async (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    createBubbleParticles(rect.left + rect.width / 2, rect.top + rect.height / 2)
    mode = 'meal'
    await recordHandwash()
    setTimeout(() => transitionToPhase('done'), 150)
  })
}

function renderDone() {
  const modeBadge = mode ? `<div class="done-mode-badge">${modeLabel(mode)}</div>` : ''
  const loggedIn = isLoggedIn()
  const hasFamilyId = !!getSelectedFamilyId()
  const recorded = loggedIn && hasFamilyId

  setHTML(`
    <div class="wash-scene-new">
      <div class="wash-bg-gradient"></div>
      ${generateBubbleField()}

      <div class="done-content visible">
        ${modeBadge}

        <div class="done-emoji">✨</div>
        <h1 class="done-title">おつかれさま！</h1>
        <p class="done-subtitle">きれいにできたね。えらい！</p>
        <p class="done-time">${formatTime(elapsedSeconds)} 手を洗いました</p>

        ${recorded ? `
          <div class="done-recorded">✓ 記録しました</div>
        ` : `
          <div class="done-notice">
            ${!loggedIn ? 'ログインすると履歴が記録されます' : 'マイページでファミリーを選択すると記録されます'}
          </div>
        `}

        <button class="mypage-bubble-btn" id="mypage-btn">
          <span class="btn-shine"></span>
          マイページへ
        </button>
      </div>
    </div>
  `)

  document.getElementById('mypage-btn')!.addEventListener('click', () => {
    location.href = '../mypage/'
  })
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && intervalId !== null) {
    await requestWakeLock()
  }
})

// --- Main ---
;(async () => {
  try {
    await handleCallbackIfPresent()
  } catch (e) {
    console.error('Callback handling failed:', e)
  }

  if (!isLoggedIn()) {
    startLogin()
    return
  }

  // 即座に手洗い開始
  transitionToPhase('intro')
})()
