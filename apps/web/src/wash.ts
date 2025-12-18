// src/wash.ts - 手洗いタイマー
import './style.css'
import { getIdToken, isLoggedIn, startLogin, handleCallbackIfPresent } from './auth'

const API_URL = import.meta.env.VITE_API_URL as string
const STORAGE_FAMILY_ID = 'selected:familyId'

function getSelectedFamilyId(): string | null {
  return sessionStorage.getItem(STORAGE_FAMILY_ID)
}

type Mode = 'home' | 'meal'
type MediaType = 'none' | 'image' | 'video'

type Step = {
  title: string
  text?: string
  mediaType: MediaType
  src?: string
}

const STEPS: Step[] = [
  { title: '手をぬらす', mediaType: 'image', src: '/steps/01.png' },
  { title: 'せっけんをつける', mediaType: 'image', src: '/steps/02.png' },
  { title: '手のひら/甲/指の間', mediaType: 'video', src: '/steps/demo.webm' },
  { title: '親指・指先・手首', mediaType: 'none' },
  { title: 'すすぐ→ふく', mediaType: 'none' },
]

const app = document.querySelector<HTMLDivElement>('#app')!

let mode: Mode | null = null
let remaining = 20
let intervalId: number | null = null
let startedAt = 0
let wakeLock: any = null

function setHTML(html: string) {
  app.innerHTML = html
}

function modeLabel(m: Mode) {
  return m === 'home' ? '帰ってきたとき' : 'ごはんのまえ'
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

// --- Timer ---
function stopTimer() {
  if (intervalId !== null) {
    window.clearInterval(intervalId)
    intervalId = null
  }
  releaseWakeLock()
}

function startTimer() {
  stopTimer()
  remaining = 20
  startedAt = Date.now()
  requestWakeLock()

  intervalId = window.setInterval(() => {
    remaining -= 1
    if (remaining <= 0) {
      stopTimer()
      void onComplete('timer')
      renderDone()
      return
    }
    renderWash()
  }, 1000)
}

// --- Backend API call ---
async function onComplete(reason: 'timer' | 'skip') {
  try {
    const idToken = getIdToken()
    const familyId = getSelectedFamilyId()
    const durationSec = 20 - Math.max(remaining, 0)

    const payload = {
      mode,
      reason,
      finishedAt: new Date().toISOString(),
      durationSec,
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
          durationSec,
          note: reason === 'skip' ? 'skipped' : undefined,
        }),
      })

      if (res.ok) {
        console.log('handwash event recorded successfully')
      } else {
        console.warn('handwash event recording failed:', res.status)
      }
    } else {
      console.log('not logged in or no family selected, skipping API call')
    }
  } catch (e) {
    console.warn('complete hook failed (ignored):', e)
  }
}

// --- Views ---
function renderSelect() {
  setHTML(`
    <div class="card">
      <h1 class="h1">🧼 手洗いタイマー</h1>
      <p class="p">どっちかをタップしてスタート！</p>

      <div class="row">
        <button class="btn" id="home">🏠 帰ってきたとき</button>
        <button class="btn" id="meal">🍽️ ごはんのまえ</button>
      </div>

      <div style="height: 16px"></div>

      <div class="row">
        <button class="btn secondary" id="backHome">← ホームへ戻る</button>
      </div>
    </div>
  `)

  document.getElementById('home')!.addEventListener('click', () => {
    mode = 'home'
    startTimer()
    renderWash()
  })
  document.getElementById('meal')!.addEventListener('click', () => {
    mode = 'meal'
    startTimer()
    renderWash()
  })
  document.getElementById('backHome')!.addEventListener('click', () => {
    location.href = '../'
  })
}

function currentStepIndex(): number {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const seg = Math.max(1, Math.floor(20 / STEPS.length))
  return Math.min(STEPS.length - 1, Math.floor(elapsed / seg))
}

function renderMedia(step: Step) {
  if (step.mediaType === 'image' && step.src) {
    return `<div class="media"><img alt="${step.title}" src="${step.src}" /></div>`
  }
  if (step.mediaType === 'video' && step.src) {
    return `<div class="media"><video src="${step.src}" playsinline muted autoplay loop></video></div>`
  }
  return `<div class="media"><div style="padding:14px;font-weight:800;color:#6b7280;">ここに画像/アニメを入れられます</div></div>`
}

function renderWash() {
  const idx = currentStepIndex()
  const step = STEPS[idx]
  const badge = mode ? `<div class="badge">${modeLabel(mode)}</div>` : ''
  const timerText = String(Math.max(remaining, 0)).padStart(2, '0')
  const showSkip = (20 - remaining) >= 8

  setHTML(`
    <div class="card">
      ${badge}
      <h1 class="h1">てあらい中</h1>

      ${renderMedia(step)}

      <div class="p" style="font-weight:900;margin-bottom:6px;">いま：${step.title}</div>
      <div class="p" style="margin-bottom:10px;color:#6b7280;">${step.text ?? ''}</div>

      <div class="timer">${timerText}</div>

      ${showSkip ? `
        <div class="skipRow">
          <button class="linklike" id="skip">スキップ</button>
        </div>
      ` : ''}

      <div class="row" style="margin-top:10px;">
        <button class="btn secondary" id="restart">さいしょから(20秒)</button>
        <button class="btn secondary" id="back">もどる</button>
      </div>
    </div>
  `)

  if (showSkip) {
    document.getElementById('skip')!.addEventListener('click', async () => {
      stopTimer()
      await onComplete('skip')
      renderDone()
    })
  }

  document.getElementById('restart')!.addEventListener('click', () => {
    startTimer()
    renderWash()
  })
  document.getElementById('back')!.addEventListener('click', () => {
    stopTimer()
    mode = null
    renderSelect()
  })
}

function renderDone() {
  const badge = mode ? `<div class="badge">${modeLabel(mode)}</div>` : ''
  const loggedIn = isLoggedIn()
  const hasFamilyId = !!getSelectedFamilyId()
  const recorded = loggedIn && hasFamilyId

  setHTML(`
    <div class="card">
      ${badge}
      <h1 class="h1">おつかれさま！</h1>
      <p class="p">きれいにできたね。えらい！</p>

      ${recorded ? `
        <div class="recorded-badge">✓ 記録しました</div>
      ` : `
        <p class="p muted" style="font-size: 12px;">
          ${!loggedIn ? 'ログインすると履歴が記録されます' : 'マイページでファミリーを選択すると記録されます'}
        </p>
      `}

      <div class="row">
        <button class="btn" id="again">もういちど</button>
        <button class="btn secondary" id="backHome">ホームへ</button>
      </div>

      <div style="height:10px"></div>

      <div class="row">
        <button class="btn secondary" id="mypage">マイページへ</button>
      </div>
    </div>
  `)

  document.getElementById('again')!.addEventListener('click', () => {
    startTimer()
    renderWash()
  })
  document.getElementById('backHome')!.addEventListener('click', () => {
    location.href = '../'
  })
  document.getElementById('mypage')!.addEventListener('click', () => {
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
    // OAuth callback handling
    await handleCallbackIfPresent()
  } catch (e) {
    console.error('Callback handling failed:', e)
  }

  // 未ログインならCognito認証へリダイレクト
  if (!isLoggedIn()) {
    startLogin()
    return
  }

  renderSelect()
})()

