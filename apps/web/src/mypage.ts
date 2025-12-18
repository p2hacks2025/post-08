// src/mypage.ts - マイページ（ファミリー管理 + 履歴表示 + Push通知対応）
import './style.css'
import { handleCallbackIfPresent, isLoggedIn, startLogin, getIdToken, logout } from './auth'
import { isPushSupported, getNotificationPermission, subscribePush } from './push'

const API_URL = import.meta.env.VITE_API_URL as string

const app = document.querySelector<HTMLDivElement>('#app')!

type Family = {
  familyId: string
  name: string
  role: string
  joinedAt: string
}

type MeResponse = {
  ok: boolean
  sub: string
  email: string
  username: string
  families: Family[]
}

type HandwashEvent = {
  familyId: string
  eventId: string
  atMs: number
  createdBy: string
  mode?: string
  durationSec?: number
  note?: string
}

type EventsResponse = {
  ok: boolean
  events: HandwashEvent[]
}

// 現在選択中のファミリーID（sessionStorageで共有してmain.tsでも使う）
const STORAGE_FAMILY_ID = 'selected:familyId'

function getSelectedFamilyId(): string | null {
  return sessionStorage.getItem(STORAGE_FAMILY_ID)
}

function setSelectedFamilyId(id: string | null) {
  if (id) {
    sessionStorage.setItem(STORAGE_FAMILY_ID, id)
  } else {
    sessionStorage.removeItem(STORAGE_FAMILY_ID)
  }
}

let selectedFamilyId: string | null = getSelectedFamilyId()

// --- API calls ---
async function fetchMe(): Promise<MeResponse | null> {
  const idToken = getIdToken()
  if (!idToken) return null

  try {
    const res = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function createFamily(name: string): Promise<{ ok: boolean; inviteCode?: string; message?: string }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/families`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

async function joinFamily(inviteCode: string): Promise<{ ok: boolean; message?: string }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/families/join`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inviteCode }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

async function fetchHandwashEvents(familyId: string): Promise<EventsResponse | null> {
  const idToken = getIdToken()
  if (!idToken) return null

  try {
    const res = await fetch(`${API_URL}/handwash/events?familyId=${familyId}&limit=30`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function recordHandwashEvent(familyId: string, mode?: string): Promise<{ ok: boolean; message?: string }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/handwash/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familyId, mode, durationSec: 20 }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

// --- Views ---
function renderLoading() {
  app.innerHTML = `
    <div class="card">
      <h1 class="h1">マイページ</h1>
      <p class="p muted">読み込み中...</p>
    </div>
  `
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getModeLabel(mode?: string): string {
  if (mode === 'home') return '帰宅時'
  if (mode === 'meal') return '食事前'
  return '手洗い'
}

function renderNotificationSection(): string {
  if (!isPushSupported()) {
    return '<p class="p muted">このブラウザはプッシュ通知に対応していません</p>'
  }

  const permission = getNotificationPermission()

  if (permission === 'granted') {
    return `
      <div class="notification-status enabled">
        <span class="notification-icon">✓</span>
        <span>通知は有効です</span>
      </div>
      <p class="p muted" style="font-size: 12px;">毎日夜に手洗いリマインドが届きます</p>
    `
  }

  if (permission === 'denied') {
    return `
      <div class="notification-status disabled">
        <span class="notification-icon">✕</span>
        <span>通知がブロックされています</span>
      </div>
      <p class="p muted" style="font-size: 12px;">ブラウザの設定から通知を許可してください</p>
    `
  }

  return `
    <p class="p" style="font-size: 13px;">手洗いを忘れないようにリマインド通知を受け取れます</p>
    <button class="btn" id="enableNotification">🔔 通知を有効にする</button>
    <div id="notificationResult" class="result-box"></div>
  `
}

function renderLoggedIn(me: MeResponse) {
  // ファミリーが1つ以上あれば最初のを選択（sessionStorageにも保存）
  if (!selectedFamilyId && me.families.length > 0) {
    selectedFamilyId = me.families[0].familyId
    setSelectedFamilyId(selectedFamilyId)
  }

  const familiesHtml = me.families.length > 0
    ? me.families.map(f => `
        <div class="family-item ${f.familyId === selectedFamilyId ? 'selected' : ''}" data-family-id="${f.familyId}">
          <div class="family-name">${escapeHtml(f.name)}</div>
          <div class="family-meta">
            <span class="badge-small ${f.role === 'owner' ? 'owner' : ''}">${f.role === 'owner' ? 'オーナー' : 'メンバー'}</span>
          </div>
        </div>
      `).join('')
    : '<p class="p muted">まだファミリーに参加していません</p>'

  app.innerHTML = `
    <div class="card">
      <h1 class="h1">マイページ</h1>
      
      <div class="user-info">
        <div class="user-email">${escapeHtml(me.email)}</div>
      </div>

      <hr class="divider" />

      <h2 class="h2">ファミリー</h2>
      <div class="family-list clickable">
        ${familiesHtml}
      </div>

      <div class="action-section">
        <button class="btn" id="showCreate">ファミリーを作成</button>
        <button class="btn secondary" id="showJoin">招待コードで参加</button>
      </div>

      <!-- 作成フォーム（非表示） -->
      <div id="createForm" class="form-section hidden">
        <input type="text" id="familyName" class="input" placeholder="ファミリー名" maxlength="30" />
        <div class="row">
          <button class="btn" id="doCreate">作成</button>
          <button class="btn secondary" id="cancelCreate">キャンセル</button>
        </div>
        <div id="createResult" class="result-box"></div>
      </div>

      <!-- 参加フォーム（非表示） -->
      <div id="joinForm" class="form-section hidden">
        <input type="text" id="inviteCode" class="input" placeholder="招待コード（例: ABCD-EFGH）" maxlength="10" />
        <div class="row">
          <button class="btn" id="doJoin">参加</button>
          <button class="btn secondary" id="cancelJoin">キャンセル</button>
        </div>
        <div id="joinResult" class="result-box"></div>
      </div>

      <hr class="divider" />

      <!-- 履歴セクション -->
      <h2 class="h2">手洗い履歴</h2>
      ${selectedFamilyId ? `
        <div class="history-actions">
          <button class="btn record-btn" id="recordHome">🏠 帰宅時を記録</button>
          <button class="btn record-btn" id="recordMeal">🍽️ 食事前を記録</button>
        </div>
        <div id="historyList" class="history-list">
          <p class="p muted">読み込み中...</p>
        </div>
      ` : `
        <p class="p muted">ファミリーを選択または作成してください</p>
      `}

      <hr class="divider" />

      <!-- 通知設定セクション -->
      <h2 class="h2">🔔 リマインド通知</h2>
      ${renderNotificationSection()}

      <hr class="divider" />

      <div class="row">
        <button class="btn secondary" id="refresh">更新</button>
        <button class="btn secondary" id="logout">ログアウト</button>
        <button class="btn secondary" id="back">戻る</button>
      </div>
    </div>
  `

  // ファミリー選択イベント
  document.querySelectorAll('.family-item[data-family-id]').forEach(el => {
    el.addEventListener('click', () => {
      const familyId = el.getAttribute('data-family-id')
      if (familyId) {
        selectedFamilyId = familyId
        setSelectedFamilyId(familyId)
        renderLoggedIn(me)
        loadHistory()
      }
    })
  })

  // 作成・参加フォーム
  const createForm = document.getElementById('createForm')!
  const joinForm = document.getElementById('joinForm')!

  document.getElementById('showCreate')!.addEventListener('click', () => {
    createForm.classList.remove('hidden')
    joinForm.classList.add('hidden')
  })

  document.getElementById('showJoin')!.addEventListener('click', () => {
    joinForm.classList.remove('hidden')
    createForm.classList.add('hidden')
  })

  document.getElementById('cancelCreate')!.addEventListener('click', () => {
    createForm.classList.add('hidden')
  })

  document.getElementById('cancelJoin')!.addEventListener('click', () => {
    joinForm.classList.add('hidden')
  })

  document.getElementById('doCreate')!.addEventListener('click', async () => {
    const nameInput = document.getElementById('familyName') as HTMLInputElement
    const resultEl = document.getElementById('createResult')!
    const name = nameInput.value.trim()

    if (!name) {
      resultEl.innerHTML = '<span class="error">ファミリー名を入力してください</span>'
      return
    }

    resultEl.textContent = '作成中...'
    const result = await createFamily(name)

    if (result.ok && result.inviteCode) {
      resultEl.innerHTML = `
        <span class="success">作成しました！</span>
        <div class="invite-code-box">
          <div class="invite-label">招待コード</div>
          <div class="invite-code">${result.inviteCode}</div>
          <div class="invite-hint">このコードを家族に共有してください</div>
        </div>
      `
      setTimeout(() => loadAndRender(), 2000)
    } else {
      resultEl.innerHTML = `<span class="error">${escapeHtml(result.message || 'エラーが発生しました')}</span>`
    }
  })

  document.getElementById('doJoin')!.addEventListener('click', async () => {
    const codeInput = document.getElementById('inviteCode') as HTMLInputElement
    const resultEl = document.getElementById('joinResult')!
    const code = codeInput.value.trim().toUpperCase()

    if (!code) {
      resultEl.innerHTML = '<span class="error">招待コードを入力してください</span>'
      return
    }

    resultEl.textContent = '参加中...'
    const result = await joinFamily(code)

    if (result.ok) {
      resultEl.innerHTML = '<span class="success">参加しました！</span>'
      setTimeout(() => loadAndRender(), 1000)
    } else {
      resultEl.innerHTML = `<span class="error">${escapeHtml(result.message || 'エラーが発生しました')}</span>`
    }
  })

  // 手洗い記録ボタン
  const recordHomeBtn = document.getElementById('recordHome')
  const recordMealBtn = document.getElementById('recordMeal')

  if (recordHomeBtn) {
    recordHomeBtn.addEventListener('click', async () => {
      if (!selectedFamilyId) return
      recordHomeBtn.textContent = '記録中...'
      const result = await recordHandwashEvent(selectedFamilyId, 'home')
      if (result.ok) {
        recordHomeBtn.textContent = '✓ 記録しました！'
        setTimeout(() => {
          recordHomeBtn.textContent = '🏠 帰宅時を記録'
          loadHistory()
        }, 1500)
      } else {
        recordHomeBtn.textContent = 'エラー'
        setTimeout(() => {
          recordHomeBtn.textContent = '🏠 帰宅時を記録'
        }, 1500)
      }
    })
  }

  if (recordMealBtn) {
    recordMealBtn.addEventListener('click', async () => {
      if (!selectedFamilyId) return
      recordMealBtn.textContent = '記録中...'
      const result = await recordHandwashEvent(selectedFamilyId, 'meal')
      if (result.ok) {
        recordMealBtn.textContent = '✓ 記録しました！'
        setTimeout(() => {
          recordMealBtn.textContent = '🍽️ 食事前を記録'
          loadHistory()
        }, 1500)
      } else {
        recordMealBtn.textContent = 'エラー'
        setTimeout(() => {
          recordMealBtn.textContent = '🍽️ 食事前を記録'
        }, 1500)
      }
    })
  }

  // 通知有効化ボタン
  const enableNotificationBtn = document.getElementById('enableNotification')
  if (enableNotificationBtn) {
    enableNotificationBtn.addEventListener('click', async () => {
      const idToken = getIdToken()
      if (!idToken || !selectedFamilyId) {
        const resultEl = document.getElementById('notificationResult')
        if (resultEl) {
          resultEl.innerHTML = '<span class="error">ファミリーを選択してください</span>'
        }
        return
      }

      enableNotificationBtn.textContent = '設定中...'
      const result = await subscribePush(idToken, selectedFamilyId)

      const resultEl = document.getElementById('notificationResult')
      if (result.ok) {
        if (resultEl) {
          resultEl.innerHTML = '<span class="success">通知を有効にしました！</span>'
        }
        setTimeout(() => renderLoggedIn(me), 1500)
      } else {
        if (resultEl) {
          resultEl.innerHTML = `<span class="error">${escapeHtml(result.message || 'エラーが発生しました')}</span>`
        }
        enableNotificationBtn.textContent = '🔔 通知を有効にする'
      }
    })
  }

  document.getElementById('refresh')!.addEventListener('click', () => loadAndRender())
  document.getElementById('logout')!.addEventListener('click', () => logout())
  document.getElementById('back')!.addEventListener('click', () => {
    location.href = '../'
  })

  // 履歴読み込み
  if (selectedFamilyId) {
    loadHistory()
  }
}

async function loadHistory() {
  if (!selectedFamilyId) return

  const historyEl = document.getElementById('historyList')
  if (!historyEl) return

  historyEl.innerHTML = '<p class="p muted">読み込み中...</p>'

  const data = await fetchHandwashEvents(selectedFamilyId)

  if (!data || !data.ok) {
    historyEl.innerHTML = '<p class="p muted">履歴を取得できませんでした</p>'
    return
  }

  if (data.events.length === 0) {
    historyEl.innerHTML = '<p class="p muted">まだ履歴がありません</p>'
    return
  }

  const eventsHtml = data.events.map(ev => `
    <div class="history-item">
      <div class="history-icon">${ev.mode === 'home' ? '🏠' : ev.mode === 'meal' ? '🍽️' : '🧼'}</div>
      <div class="history-content">
        <div class="history-label">${getModeLabel(ev.mode)}</div>
        <div class="history-time">${formatTime(ev.atMs)}</div>
      </div>
      ${ev.durationSec ? `<div class="history-duration">${ev.durationSec}秒</div>` : ''}
    </div>
  `).join('')

  historyEl.innerHTML = eventsHtml
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function loadAndRender() {
  renderLoading()

  // 未ログインならCognito認証へリダイレクト
  if (!isLoggedIn()) {
    startLogin()
    return
  }

  const me = await fetchMe()
  if (!me) {
    // API失敗時も再ログインを促す
    startLogin()
    return
  }

  renderLoggedIn(me)
}

// --- Main ---
;(async () => {
  renderLoading()

  try {
    await handleCallbackIfPresent()
  } catch (e) {
    console.error('Callback handling failed:', e)
  }

  await loadAndRender()
})()
