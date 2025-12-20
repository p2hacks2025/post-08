// src/wash.ts - 手洗いタイマー（泡UI版）
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { getIdToken, isLoggedIn, startLogin, handleCallbackIfPresent } from './auth'

// PWA Service Worker登録
registerSW({ immediate: true })

const API_URL = import.meta.env.VITE_API_URL as string
const STORAGE_FAMILY_ID = 'selected:familyId'

function getSelectedFamilyId(): string | null {
  return sessionStorage.getItem(STORAGE_FAMILY_ID)
}

function setSelectedFamilyId(familyId: string): void {
  sessionStorage.setItem(STORAGE_FAMILY_ID, familyId)
}

// ファミリーを自動選択（未選択の場合）
async function ensureFamilySelected(): Promise<boolean> {
  // 既に選択されていればOK
  if (getSelectedFamilyId()) {
    return true
  }

  const idToken = getIdToken()
  if (!idToken || !API_URL) {
    return false
  }

  try {
    const res = await fetch(`${API_URL}/families`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return false

    const data = await res.json()
    const families = data.families as { familyId: string; name: string }[]

    if (families.length === 0) {
      console.log('No families found. User should create or join one.')
      return false
    }

    // 最初のファミリーを自動選択
    const firstFamily = families[0]
    setSelectedFamilyId(firstFamily.familyId)
    console.log(`Auto-selected family: ${firstFamily.name} (${firstFamily.familyId})`)
    return true
  } catch (e) {
    console.warn('Failed to fetch families:', e)
    return false
  }
}

type Mode = 'home' | 'meal'
type Phase = 'idle' | 'intro' | 'playing' | 'select' | 'done'

const app = document.querySelector<HTMLDivElement>('#app')!

let mode: Mode | null = null
let elapsedSeconds = 0
let intervalId: number | null = null
let wakeLock: any = null
let isSelecting = false // 選択中のフラグ（連続クリック防止）
let bubbleFieldHTML: string | null = null // 泡フィールドのHTMLを保持

// 泡フィールドのDOM要素を保持
let bubbleFieldElement: HTMLElement | null = null

function setHTML(html: string) {
  // 既存の泡フィールドを取得（appの外からも探す）
  if (!bubbleFieldElement) {
    bubbleFieldElement = app.querySelector('.small-bubble-field') as HTMLElement | null
    if (!bubbleFieldElement) {
      bubbleFieldElement = document.querySelector('.small-bubble-field') as HTMLElement | null
    }
  }
  
  // 泡フィールドが存在しない場合は生成
  if (!bubbleFieldElement) {
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = generateBubbleField()
    bubbleFieldElement = tempDiv.firstElementChild as HTMLElement
  }
  
  // HTMLを設定
  app.innerHTML = html
  
  // 新しいHTMLに泡フィールドが含まれていない場合は追加
  const washScene = app.querySelector('.wash-scene-new')
  if (washScene && bubbleFieldElement && !washScene.querySelector('.small-bubble-field')) {
    // 既存のDOM要素を直接追加（アニメーションが継続する）
    washScene.insertBefore(bubbleFieldElement, washScene.firstChild)
  }
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
  // 既に生成済みの場合は再利用
  if (bubbleFieldHTML) {
    return bubbleFieldHTML
  }

  const bubbles: string[] = []
  // サイズを3倍にして、サイズをまちまちにする（ランダム要素を追加）
  // 下の方にランダムに配置し、ランダムなdelayで生成
  const numBubbles = 12 // 泡の数を増やす
  for (let i = 0; i < numBubbles; i++) {
    // 左位置をランダムに（5% ~ 95%）
    const left = 5 + Math.random() * 90
    // サイズをランダムに（30px ~ 90px）
    const baseSize = 30 + Math.random() * 60
    // サイズにランダム要素を追加（±20%）
    const sizeVariation = 1 + (Math.random() - 0.5) * 0.4 // 0.8 ~ 1.2
    const size = Math.round(baseSize * sizeVariation)
    // アニメーション時間をランダムに（8s ~ 14s）
    const baseDur = 8 + Math.random() * 6
    const durVariation = 1 + (Math.random() - 0.5) * 0.2 // 0.9 ~ 1.1
    const dur = (baseDur * durVariation).toFixed(1)
    // ランダムなdelay（0s ~ 10s）で生成タイミングをずらす
    const delay = Math.random() * 10

    bubbles.push(`
      <div class="small-bubble" style="
        left: ${left.toFixed(1)}%;
        width: ${size}px;
        height: ${size}px;
        animation-duration: ${dur}s;
        animation-delay: ${delay.toFixed(1)}s;
      "></div>
    `)
  }

  bubbleFieldHTML = `<div class="small-bubble-field">${bubbles.join('')}</div>`
  return bubbleFieldHTML
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
    // せり上がり完了後（2.7秒後）、アニメーションをフェードインしてタイマー開始
    setTimeout(() => {
      const content = document.querySelector('.handwash-content')
      content?.classList.add('visible')
      transitionToPhase('playing')
    }, 2700) // 大きな泡の上昇完了を待つ
  } else if (newPhase === 'playing') {
    startTimer()
  } else if (newPhase === 'select') {
    stopTimer()
    // コンテンツ（文字・ボタン・画像）をフェードアウト
    const content = document.querySelector('.handwash-content')
    const bigBubble = document.querySelector('.main-big-bubble')
    
    if (content) {
      content.classList.remove('visible')
      content.classList.add('fade-out')
    }
    
    // コンテンツのフェードアウト完了後、大きな泡もフェードアウト
    setTimeout(() => {
      if (bigBubble) {
        // 場面選択と同じようにフェードアウト
        bigBubble.classList.remove('visible')
        bigBubble.classList.add('fade-out')
      }
    }, 300) // フェードアウト時間に合わせる
    
    // 大きな泡がフェードアウトした後、選択シーンに遷移
    setTimeout(() => {
      renderSelectScene()
    }, 600) // フェードアウト時間（0.3s）+ 余裕
  } else if (newPhase === 'done') {
    renderDone()
  }
}

// --- Views ---
function renderWashScene() {
  setHTML(`
    <div class="wash-scene-new">
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
          <video src="/steps/handwash.webm" class="handwash-anim" autoplay loop muted playsinline></video>
        </div>


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
  // 泡フィールドは既に生成済みのHTMLを使用
  const bubbleField = generateBubbleField()
  
  setHTML(`
    <div class="wash-scene-new">
      ${bubbleField}

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
    if (isSelecting) return // 連続クリック防止
    isSelecting = true
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    createBubbleParticles(rect.left + rect.width / 2, rect.top + rect.height / 2)
    
    // フェードアウト
    const selectContent = document.querySelector('.select-content')
    if (selectContent) {
      selectContent.classList.remove('visible')
      selectContent.classList.add('fade-out')
    }
    
    mode = 'home'
    await recordHandwash()
    setTimeout(() => {
      transitionToPhase('done')
      isSelecting = false
    }, 400) // フェードアウト時間に合わせて調整
  })

  document.getElementById('meal')!.addEventListener('click', async (e) => {
    if (isSelecting) return // 連続クリック防止
    isSelecting = true
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    createBubbleParticles(rect.left + rect.width / 2, rect.top + rect.height / 2)
    
    // フェードアウト
    const selectContent = document.querySelector('.select-content')
    if (selectContent) {
      selectContent.classList.remove('visible')
      selectContent.classList.add('fade-out')
    }
    
    mode = 'meal'
    await recordHandwash()
    setTimeout(() => {
      transitionToPhase('done')
      isSelecting = false
    }, 400) // フェードアウト時間に合わせて調整
  })
}

function renderDone() {
  const modeBadge = mode ? `<div class="done-mode-badge">${modeLabel(mode)}</div>` : ''
  const loggedIn = isLoggedIn()
  const hasFamilyId = !!getSelectedFamilyId()
  const recorded = loggedIn && hasFamilyId

  // 泡フィールドは既に生成済みのHTMLを使用
  const bubbleField = generateBubbleField()
  
  setHTML(`
    <div class="wash-scene-new">
      ${bubbleField}

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
            ${!loggedIn ? 'ログインすると履歴が記録されます' : 'マイページでファミリーを作成/参加すると記録されます'}
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

  // ファミリーが選択されていなければ自動選択を試みる
  const hasFamilySelected = await ensureFamilySelected()
  if (!hasFamilySelected) {
    console.log('No family selected and none available. Proceeding without recording.')
  }

  // 即座に手洗い開始
  transitionToPhase('intro')
})()
