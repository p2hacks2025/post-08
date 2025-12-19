// src/mypage.ts - マイページ（ファミリー管理 + 履歴表示 + Push通知対応）
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { handleCallbackIfPresent, isLoggedIn, startLogin, getIdToken, logout } from './auth'
import { isPushSupported, getNotificationPermission, subscribePush } from './push'

// PWA Service Worker登録
registerSW({ immediate: true })

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
  displayName?: string
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

type FamilyMember = {
  sub: string
  role: string
  joinedAt: string
  displayName?: string
}

type MembersResponse = {
  ok: boolean
  isOwner: boolean
  members: FamilyMember[]
  inviteCode?: string
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
let currentTab: 'mypage' | 'settings' = 'mypage' // 現在のタブ
let tabDataLoaded: { mypage: boolean; settings: boolean } = { mypage: false, settings: false } // タブごとのデータ読み込み状態

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

async function fetchHandwashEvents(familyId: string, createdBy?: string): Promise<EventsResponse | null> {
  const idToken = getIdToken()
  if (!idToken) return null

  try {
    let url = `${API_URL}/handwash/events?familyId=${familyId}&limit=30`
    if (createdBy) {
      url += `&createdBy=${encodeURIComponent(createdBy)}`
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// プロファイル更新API
async function updateProfile(displayName: string): Promise<{ ok: boolean; message?: string; displayName?: string }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}


async function fetchFamilyMembers(familyId: string): Promise<MembersResponse | null> {
  const idToken = getIdToken()
  if (!idToken) return null

  try {
    const res = await fetch(`${API_URL}/families/members?familyId=${familyId}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function sendPushToUser(familyId: string, targetSub: string, message: string): Promise<{ ok: boolean; message?: string; sent?: number }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/push/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familyId, targetSub, message }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

async function leaveFamily(familyId: string): Promise<{ ok: boolean; message?: string }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/families/leave`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familyId }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

async function deleteFamily(familyId: string): Promise<{ ok: boolean; message?: string }> {
  const idToken = getIdToken()
  if (!idToken) return { ok: false, message: 'Not logged in' }

  try {
    const res = await fetch(`${API_URL}/families/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familyId }),
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

// 継続日数を計算
function calculateConsecutiveDays(events: HandwashEvent[]): number {
  if (events.length === 0) return 0

  // 日付ごとにグループ化（JSTで）
  const dates = new Set<string>()
  events.forEach(ev => {
    const date = new Date(ev.atMs)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    dates.add(dateStr)
  })

  // 日付をソート
  const sortedDates = Array.from(dates).sort().reverse()

  if (sortedDates.length === 0) return 0

  // 今日から連続日数を計算
  let consecutiveDays = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < sortedDates.length; i++) {
    const dateStr = sortedDates[i]
    const checkDate = new Date(dateStr)
    checkDate.setHours(0, 0, 0, 0)

    const diffDays = Math.floor((today.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === consecutiveDays) {
      consecutiveDays++
    } else {
      break
    }
  }

  return consecutiveDays
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

  app.innerHTML = `
    <div class="card">
      <h1 class="h1">マイページ</h1>
      
      <div class="user-info">
        <div class="user-email">${escapeHtml(me.email)}</div>
        <div class="user-name-section">
          <input type="text" id="userDisplayName" class="input input-small" placeholder="あなたの名前" value="${escapeHtml(me.displayName || '')}" maxlength="30" />
          <button class="btn btn-small" id="updateDisplayName">更新</button>
        </div>
      </div>

      <!-- タブ -->
      <div class="tabs">
        <button class="tab-btn ${currentTab === 'mypage' ? 'active' : ''}" data-tab="mypage">
          🎉 マイページ
        </button>
        <button class="tab-btn ${currentTab === 'settings' ? 'active' : ''}" data-tab="settings">
          ⚙️ 設定
        </button>
      </div>

      <!-- タブコンテンツ（両方読み込んで表示/非表示で切り替え） -->
      <div class="tab-content">
        <div id="mypageTabContent" class="tab-pane ${currentTab === 'mypage' ? 'active' : 'hidden'}">
          ${renderMypageTab()}
        </div>
        <div id="settingsTabContent" class="tab-pane ${currentTab === 'settings' ? 'active' : 'hidden'}">
          ${renderSettingsTab(me)}
        </div>
      </div>

      <hr class="divider" />

      <div class="row">
        <button class="btn secondary" id="refresh">更新</button>
        <button class="btn secondary" id="logout">ログアウト</button>
      </div>
    </div>
  `

  // タブ切り替えイベント（表示/非表示のみ切り替え）
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab') as 'mypage' | 'settings'
      if (tab && tab !== currentTab) {
        // タブボタンのactive状態を更新
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        
        // タブコンテンツの表示/非表示を切り替え
        const mypageContent = document.getElementById('mypageTabContent')
        const settingsContent = document.getElementById('settingsTabContent')
        
        if (tab === 'mypage') {
          mypageContent?.classList.remove('hidden')
          mypageContent?.classList.add('active')
          settingsContent?.classList.remove('active')
          settingsContent?.classList.add('hidden')
          currentTab = 'mypage'
          // マイページタブのデータを読み込む（初回のみ）
          if (!tabDataLoaded.mypage) {
            loadMypageTab()
            tabDataLoaded.mypage = true
          }
        } else {
          settingsContent?.classList.remove('hidden')
          settingsContent?.classList.add('active')
          mypageContent?.classList.remove('active')
          mypageContent?.classList.add('hidden')
          currentTab = 'settings'
          // 設定タブのデータを読み込む（初回のみ）
          if (!tabDataLoaded.settings) {
            loadHistory()
            loadMembers(me)
            tabDataLoaded.settings = true
          }
        }
      }
    })
  })

  // 現在表示されているタブに応じてイベントリスナーとデータを読み込む
  // 注意: renderLoggedInが呼ばれるとDOMが再生成されるため、タブの状態はcurrentTab変数に基づく
  if (currentTab === 'settings') {
    setupSettingsTabEvents(me)
    if (!tabDataLoaded.settings) {
      loadHistory()
      loadMembers(me)
      tabDataLoaded.settings = true
    }
  } else {
    setupMypageTabEvents()
    if (!tabDataLoaded.mypage) {
      loadMypageTab()
      tabDataLoaded.mypage = true
    }
  }
}

// マイページタブのイベント設定
function setupMypageTabEvents() {
  // 既存のイベントリスナーを削除してから追加（重複防止）
  const refreshBtn = document.getElementById('refresh')
  const logoutBtn = document.getElementById('logout')
  
  if (refreshBtn) {
    const newRefreshBtn = refreshBtn.cloneNode(true)
    refreshBtn.parentNode?.replaceChild(newRefreshBtn, refreshBtn)
    newRefreshBtn.addEventListener('click', () => {
      tabDataLoaded.mypage = false // マイページタブのデータ読み込み状態をリセット
      loadAndRender()
    })
  }
  
  if (logoutBtn) {
    const newLogoutBtn = logoutBtn.cloneNode(true)
    logoutBtn.parentNode?.replaceChild(newLogoutBtn, logoutBtn)
    newLogoutBtn.addEventListener('click', () => logout())
  }
  
  // 名前更新ボタン
  const updateDisplayNameBtn = document.getElementById('updateDisplayName')
  const userDisplayNameInput = document.getElementById('userDisplayName') as HTMLInputElement
  if (updateDisplayNameBtn && userDisplayNameInput) {
    updateDisplayNameBtn.addEventListener('click', async () => {
      const displayName = userDisplayNameInput.value.trim()
      if (!displayName) {
        alert('名前を入力してください')
        return
      }

      updateDisplayNameBtn.textContent = '更新中...'
      ;(updateDisplayNameBtn as HTMLButtonElement).disabled = true

      const result = await updateProfile(displayName)
      if (result.ok) {
        updateDisplayNameBtn.textContent = '✓ 更新しました'
        setTimeout(() => {
          updateDisplayNameBtn.textContent = '更新'
          ;(updateDisplayNameBtn as HTMLButtonElement).disabled = false
          loadAndRender()
        }, 1500)
      } else {
        alert(result.message || '更新に失敗しました')
        updateDisplayNameBtn.textContent = '更新'
        ;(updateDisplayNameBtn as HTMLButtonElement).disabled = false
      }
    })
  }
}

// マイページタブのレンダリング
function renderMypageTab(): string {
  return selectedFamilyId ? `
    <div id="mypageStats" class="mypage-stats">
      <p class="p muted">読み込み中...</p>
    </div>
  ` : `
    <p class="p muted">ファミリーを選択してください</p>
  `
}

// 設定タブのレンダリング
function renderSettingsTab(me: MeResponse): string {
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

  return `
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

      <!-- メンバー一覧セクション -->
      <h2 class="h2">👨‍👩‍👧‍👦 ファミリーメンバー</h2>
      ${selectedFamilyId ? `
        <div id="membersList" class="members-list">
          <p class="p muted">読み込み中...</p>
        </div>
      ` : `
        <p class="p muted">ファミリーを選択してください</p>
      `}

      <hr class="divider" />

      <!-- 履歴セクション -->
      <h2 class="h2">手洗い履歴</h2>
      ${selectedFamilyId ? `
        <div id="historyList" class="history-list">
          <p class="p muted">メンバーをクリックして履歴を確認</p>
        </div>
      ` : `
        <p class="p muted">ファミリーを選択または作成してください</p>
      `}

      <hr class="divider" />

      <!-- 通知設定セクション -->
      <h2 class="h2">🔔 リマインド通知</h2>
      ${renderNotificationSection()}
  `
}

// マイページタブのロード
async function loadMypageTab() {
  if (!selectedFamilyId) return

  const statsEl = document.getElementById('mypageStats')
  if (!statsEl) return

  statsEl.innerHTML = '<p class="p muted">読み込み中...</p>'

  const data = await fetchHandwashEvents(selectedFamilyId)
  if (!data || !data.ok) {
    statsEl.innerHTML = '<p class="p muted">データを取得できませんでした</p>'
    return
  }

  const consecutiveDays = calculateConsecutiveDays(data.events)
  const totalEvents = data.events.length
  const todayEvents = data.events.filter(ev => {
    const evDate = new Date(ev.atMs)
    const today = new Date()
    return evDate.getDate() === today.getDate() &&
           evDate.getMonth() === today.getMonth() &&
           evDate.getFullYear() === today.getFullYear()
  }).length

  statsEl.innerHTML = `
    <div class="stats-card">
      <div class="stat-item">
        <div class="stat-value">${consecutiveDays}</div>
        <div class="stat-label">日連続！</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${totalEvents}</div>
        <div class="stat-label">回手を洗った</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${todayEvents}</div>
        <div class="stat-label">今日の回数</div>
      </div>
    </div>
    <div class="encouragement">
      ${consecutiveDays > 0 ? `🎉 ${consecutiveDays}日連続で手を洗えているね！えらい！` : '今日から手洗いを始めよう！'}
    </div>
  `
}

// 設定タブのイベント設定
function setupSettingsTabEvents(me: MeResponse) {
  // ファミリー選択イベント（設定タブ内）
  document.querySelectorAll('#settingsTabContent .family-item[data-family-id]').forEach(el => {
    el.addEventListener('click', () => {
      const familyId = el.getAttribute('data-family-id')
      if (familyId) {
        selectedFamilyId = familyId
        setSelectedFamilyId(familyId)
        renderLoggedIn(me)
        loadHistory()
        loadMembers(me)
      }
    })
  })

  // 作成・参加フォーム
  const createForm = document.getElementById('createForm')
  const joinForm = document.getElementById('joinForm')
  if (!createForm || !joinForm) return

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

  // 名前更新ボタン
  const updateDisplayNameBtn = document.getElementById('updateDisplayName')
  const userDisplayNameInput = document.getElementById('userDisplayName') as HTMLInputElement
  if (updateDisplayNameBtn && userDisplayNameInput) {
    updateDisplayNameBtn.addEventListener('click', async () => {
      const displayName = userDisplayNameInput.value.trim()
      if (!displayName) {
        alert('名前を入力してください')
        return
      }

      updateDisplayNameBtn.textContent = '更新中...'
      ;(updateDisplayNameBtn as HTMLButtonElement).disabled = true

      const result = await updateProfile(displayName)
      if (result.ok) {
        updateDisplayNameBtn.textContent = '✓ 更新しました'
        setTimeout(() => {
          updateDisplayNameBtn.textContent = '更新'
          ;(updateDisplayNameBtn as HTMLButtonElement).disabled = false
          loadAndRender()
        }, 1500)
      } else {
        alert(result.message || '更新に失敗しました')
        updateDisplayNameBtn.textContent = '更新'
        ;(updateDisplayNameBtn as HTMLButtonElement).disabled = false
      }
    })
  }

  // 既存のイベントリスナーを削除してから追加（重複防止）
  const refreshBtn = document.getElementById('refresh')
  const logoutBtn = document.getElementById('logout')
  
  if (refreshBtn) {
    const newRefreshBtn = refreshBtn.cloneNode(true)
    refreshBtn.parentNode?.replaceChild(newRefreshBtn, refreshBtn)
    newRefreshBtn.addEventListener('click', () => {
      tabDataLoaded.settings = false // 設定タブのデータ読み込み状態をリセット
      loadAndRender()
    })
  }
  
  if (logoutBtn) {
    const newLogoutBtn = logoutBtn.cloneNode(true)
    logoutBtn.parentNode?.replaceChild(newLogoutBtn, logoutBtn)
    newLogoutBtn.addEventListener('click', () => logout())
  }

  // 履歴・メンバー読み込み（初回のみ）
  if (selectedFamilyId && !tabDataLoaded.settings) {
    loadHistory()
    loadMembers(me)
    tabDataLoaded.settings = true
  }
}

async function loadHistory() {
  if (!selectedFamilyId) return

  const historyEl = document.getElementById('historyList')
  if (!historyEl) return

  historyEl.innerHTML = '<p class="p muted">メンバーをクリックして履歴を確認</p>'
}

async function loadHistoryForMember(familyId: string, memberSub: string, memberName: string) {
  const historyEl = document.getElementById('historyList')
  if (!historyEl) return

  historyEl.innerHTML = '<p class="p muted">読み込み中...</p>'

  const data = await fetchHandwashEvents(familyId, memberSub)

  if (!data || !data.ok) {
    historyEl.innerHTML = '<p class="p muted">履歴を取得できませんでした</p>'
    return
  }

  if (data.events.length === 0) {
    historyEl.innerHTML = `<p class="p muted">${escapeHtml(memberName || 'このメンバー')}の履歴はまだありません</p>`
    return
  }

  const eventsHtml = `
    <div class="history-header">
      <h3 class="h3">${escapeHtml(memberName || 'メンバー')}の履歴</h3>
      ${memberSub ? `<button class="btn btn-small" id="clearHistoryFilter">すべて表示</button>` : ''}
    </div>
    ${data.events.map(ev => `
      <div class="history-item">
        <div class="history-icon">${ev.mode === 'home' ? '🏠' : ev.mode === 'meal' ? '🍽️' : '🧼'}</div>
        <div class="history-content">
          <div class="history-label">${getModeLabel(ev.mode)}</div>
          <div class="history-time">${formatTime(ev.atMs)}</div>
        </div>
        ${ev.durationSec ? `<div class="history-duration">${ev.durationSec}秒</div>` : ''}
      </div>
    `).join('')}
  `

  historyEl.innerHTML = eventsHtml

  // すべて表示ボタン
  const clearFilterBtn = document.getElementById('clearHistoryFilter')
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', async () => {
      // すべてのメンバーの履歴を表示（フィルタなし）
      const allData = await fetchHandwashEvents(familyId)
      if (allData && allData.ok) {
        if (allData.events.length === 0) {
          historyEl.innerHTML = '<p class="p muted">まだ履歴がありません</p>'
        } else {
          historyEl.innerHTML = `
            <div class="history-header">
              <h3 class="h3">すべての履歴</h3>
            </div>
            ${allData.events.map(ev => `
              <div class="history-item">
                <div class="history-icon">${ev.mode === 'home' ? '🏠' : ev.mode === 'meal' ? '🍽️' : '🧼'}</div>
                <div class="history-content">
                  <div class="history-label">${getModeLabel(ev.mode)}</div>
                  <div class="history-time">${formatTime(ev.atMs)}</div>
                </div>
                ${ev.durationSec ? `<div class="history-duration">${ev.durationSec}秒</div>` : ''}
              </div>
            `).join('')}
          `
        }
      }
      // メンバーの選択を解除
      document.querySelectorAll('.member-item').forEach(el => el.classList.remove('selected'))
    })
  }
}

async function loadMembers(me: MeResponse) {
  if (!selectedFamilyId) return

  const membersEl = document.getElementById('membersList')
  if (!membersEl) return

  membersEl.innerHTML = '<p class="p muted">読み込み中...</p>'

  const data = await fetchFamilyMembers(selectedFamilyId)

  if (!data || !data.ok) {
    membersEl.innerHTML = '<p class="p muted">メンバーを取得できませんでした</p>'
    return
  }

  if (data.members.length === 0) {
    membersEl.innerHTML = '<p class="p muted">メンバーがいません</p>'
    return
  }

  // メンバーをソート（オーナーが上、その後はjoinedAt順）
  const sortedMembers = [...data.members].sort((a, b) => {
    // オーナーを優先
    if (a.role === 'owner' && b.role !== 'owner') return -1
    if (a.role !== 'owner' && b.role === 'owner') return 1
    // 同じロールの場合はjoinedAt順
    return (a.joinedAt || '').localeCompare(b.joinedAt || '')
  })

  const membersHtml = sortedMembers.map(member => {
    const isMe = member.sub === me.sub
    const displayName = member.displayName || (isMe ? 'あなた' : member.sub.slice(0, 8) + '...')
    const roleLabel = member.role === 'owner' ? 'オーナー' : 'メンバー'
    
    // オーナーは自分以外のメンバーに通知を送れる
    const canSendNotification = data.isOwner && !isMe
    
    return `
      <div class="member-item clickable ${isMe ? 'is-me' : ''}" data-member-sub="${member.sub}" data-member-name="${escapeHtml(displayName)}">
        <div class="member-info">
          <div class="member-name">
            ${isMe ? '👤 ' : ''}${escapeHtml(displayName)}
            ${isMe ? '<span class="badge-tiny">あなた</span>' : ''}
          </div>
          <div class="member-role">
            <span class="badge-small ${member.role === 'owner' ? 'owner' : ''}">${roleLabel}</span>
          </div>
        </div>
        ${canSendNotification ? `
          <button class="btn btn-small notify-btn" data-target-sub="${member.sub}" data-name="${escapeHtml(displayName)}" onclick="event.stopPropagation()">
            📢 通知
          </button>
        ` : ''}
      </div>
    `
  }).join('')

  // オーナー向け招待コード表示
  const inviteCodeHtml = data.isOwner && data.inviteCode ? `
    <div class="invite-code-section">
      <div class="invite-label">📋 招待コード</div>
      <div class="invite-code-display">
        <span class="invite-code-value">${escapeHtml(data.inviteCode)}</span>
        <button class="btn btn-small copy-btn" id="copyInviteCode">コピー</button>
      </div>
      <div class="invite-hint">このコードを家族に共有してください</div>
    </div>
  ` : ''

  // 退出・削除ボタン
  const familyActionsHtml = `
    <div class="family-actions">
      ${data.isOwner ? `
        <button class="btn btn-danger" id="deleteFamilyBtn">🗑️ ファミリーを削除</button>
      ` : `
        <button class="btn btn-warning" id="leaveFamilyBtn">🚪 ファミリーを退出</button>
      `}
    </div>
  `

  membersEl.innerHTML = `
    ${inviteCodeHtml}
    <div class="members-container">
      ${membersHtml}
    </div>
    <div id="sendNotificationResult" class="result-box"></div>
    ${familyActionsHtml}
    <div id="familyActionResult" class="result-box"></div>
  `

  // 招待コードコピーボタン
  const copyBtn = document.getElementById('copyInviteCode')
  if (copyBtn && data.inviteCode) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.inviteCode!)
        copyBtn.textContent = '✓ コピーしました'
        setTimeout(() => {
          copyBtn.textContent = 'コピー'
        }, 2000)
      } catch {
        copyBtn.textContent = 'コピー失敗'
        setTimeout(() => {
          copyBtn.textContent = 'コピー'
        }, 2000)
      }
    })
  }

  // メンバーをクリックしたときに履歴を表示
  membersEl.querySelectorAll('.member-item[data-member-sub]').forEach(item => {
    item.addEventListener('click', async () => {
      const memberSub = item.getAttribute('data-member-sub')
      const memberName = item.getAttribute('data-member-name')
      
      if (!memberSub || !selectedFamilyId) return

      // 選択中のメンバーをハイライト
      membersEl.querySelectorAll('.member-item').forEach(el => el.classList.remove('selected'))
      item.classList.add('selected')

      // 履歴を読み込む
      await loadHistoryForMember(selectedFamilyId, memberSub, memberName || '')
    })
  })

  // 通知ボタンのイベント
  membersEl.querySelectorAll('.notify-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation() // メンバーアイテムのクリックイベントを防ぐ
      const target = e.currentTarget as HTMLButtonElement
      const targetSub = target.getAttribute('data-target-sub')
      const targetName = target.getAttribute('data-name')
      
      if (!targetSub || !selectedFamilyId) return

      const message = `${targetName}さん、手洗いしましょう！🧼`
      
      target.textContent = '送信中...'
      target.disabled = true

      const result = await sendPushToUser(selectedFamilyId, targetSub, message)
      const resultEl = document.getElementById('sendNotificationResult')

      if (result.ok) {
        if (resultEl) {
          if (result.sent && result.sent > 0) {
            resultEl.innerHTML = `<span class="success">📢 ${escapeHtml(targetName || '')}さんに通知を送りました！</span>`
          } else {
            resultEl.innerHTML = `<span class="warning">⚠️ ${escapeHtml(targetName || '')}さんは通知を有効にしていません</span>`
          }
        }
        target.textContent = '✓ 送信済'
        setTimeout(() => {
          target.textContent = '📢 通知'
          target.disabled = false
          if (resultEl) resultEl.innerHTML = ''
        }, 3000)
      } else {
        if (resultEl) {
          resultEl.innerHTML = `<span class="error">${escapeHtml(result.message || 'エラーが発生しました')}</span>`
        }
        target.textContent = '📢 通知'
        target.disabled = false
      }
    })
  })

  // ファミリー退出ボタン
  const leaveFamilyBtn = document.getElementById('leaveFamilyBtn')
  if (leaveFamilyBtn) {
    leaveFamilyBtn.addEventListener('click', async () => {
      if (!selectedFamilyId) return

      const confirmed = confirm('本当にこのファミリーから退出しますか？')
      if (!confirmed) return

      leaveFamilyBtn.textContent = '処理中...'
      ;(leaveFamilyBtn as HTMLButtonElement).disabled = true

      const result = await leaveFamily(selectedFamilyId)
      const resultEl = document.getElementById('familyActionResult')

      if (result.ok) {
        if (resultEl) {
          resultEl.innerHTML = `<span class="success">ファミリーから退出しました</span>`
        }
        // 再読み込み
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      } else {
        if (resultEl) {
          resultEl.innerHTML = `<span class="error">${escapeHtml(result.message || 'エラーが発生しました')}</span>`
        }
        leaveFamilyBtn.textContent = '🚪 ファミリーを退出'
        ;(leaveFamilyBtn as HTMLButtonElement).disabled = false
      }
    })
  }

  // ファミリー削除ボタン
  const deleteFamilyBtn = document.getElementById('deleteFamilyBtn')
  if (deleteFamilyBtn) {
    deleteFamilyBtn.addEventListener('click', async () => {
      if (!selectedFamilyId) return

      const confirmed = confirm('本当にこのファミリーを削除しますか？\nすべてのメンバーと履歴が削除されます。この操作は取り消せません。')
      if (!confirmed) return

      const doubleConfirmed = confirm('最終確認：ファミリーを削除してもよろしいですか？')
      if (!doubleConfirmed) return

      deleteFamilyBtn.textContent = '削除中...'
      ;(deleteFamilyBtn as HTMLButtonElement).disabled = true

      const result = await deleteFamily(selectedFamilyId)
      const resultEl = document.getElementById('familyActionResult')

      if (result.ok) {
        if (resultEl) {
          resultEl.innerHTML = `<span class="success">ファミリーを削除しました</span>`
        }
        // 再読み込み
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      } else {
        if (resultEl) {
          resultEl.innerHTML = `<span class="error">${escapeHtml(result.message || 'エラーが発生しました')}</span>`
        }
        deleteFamilyBtn.textContent = '🗑️ ファミリーを削除'
        ;(deleteFamilyBtn as HTMLButtonElement).disabled = false
      }
    })
  }
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

  // 現在表示されているタブを保存（currentTab変数を使用）
  const savedTab = currentTab
  
  // データ読み込み状態をリセット（更新ボタンが押された場合）
  tabDataLoaded = { mypage: false, settings: false }
  
  renderLoggedIn(me)
  
  // renderLoggedIn内で既にデータが読み込まれるため、ここでは追加の処理は不要
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
