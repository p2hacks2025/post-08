// src/mypage.ts - マイページ（ファミリー管理対応）
import './style.css'
import { handleCallbackIfPresent, isLoggedIn, startLogin, getIdToken, logout } from './auth'

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

// --- Views ---
function renderLoading() {
  app.innerHTML = `
    <div class="card">
      <h1 class="h1">マイページ</h1>
      <p class="p muted">読み込み中...</p>
    </div>
  `
}

function renderLoggedOut() {
  app.innerHTML = `
    <div class="card">
      <h1 class="h1">マイページ</h1>
      <p class="p">ログインして履歴やファミリー設定を管理できます。</p>
      <div class="row">
        <button class="btn" id="login">ログイン</button>
        <button class="btn secondary" id="back">戻る</button>
      </div>
    </div>
  `
  document.getElementById('login')!.addEventListener('click', () => startLogin())
  document.getElementById('back')!.addEventListener('click', () => {
    location.href = '../index.html'
  })
}

function renderLoggedIn(me: MeResponse) {
  const familiesHtml = me.families.length > 0
    ? me.families.map(f => `
        <div class="family-item">
          <div class="family-name">${escapeHtml(f.name)}</div>
          <div class="family-meta">
            <span class="badge-small ${f.role === 'owner' ? 'owner' : ''}">${f.role === 'owner' ? 'オーナー' : 'メンバー'}</span>
            <span class="family-date">${new Date(f.joinedAt).toLocaleDateString('ja-JP')}</span>
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
      <div class="family-list">
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

      <div class="row">
        <button class="btn secondary" id="refresh">更新</button>
        <button class="btn secondary" id="logout">ログアウト</button>
        <button class="btn secondary" id="back">戻る</button>
      </div>
    </div>
  `

  // イベント設定
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
      // リロードして一覧更新
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

  document.getElementById('refresh')!.addEventListener('click', () => loadAndRender())
  document.getElementById('logout')!.addEventListener('click', () => logout())
  document.getElementById('back')!.addEventListener('click', () => {
    location.href = '../index.html'
  })
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

  if (!isLoggedIn()) {
    renderLoggedOut()
    return
  }

  const me = await fetchMe()
  if (!me) {
    renderLoggedOut()
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
