// src/home.ts - ホームページ（統一ランディングページ）
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { handleCallbackIfPresent, isLoggedIn } from './auth'

registerSW({ immediate: true })

const app = document.querySelector<HTMLDivElement>('#app')!

// 背景の小さな泡を生成（%指定で画面全体に配置）
function generateBubbleField(): string {
  const bubbles: string[] = []
  const numBubbles = 12
  for (let i = 0; i < numBubbles; i++) {
    const left = 5 + Math.random() * 90
    const baseSize = 30 + Math.random() * 60
    const sizeVariation = 1 + (Math.random() - 0.5) * 0.4
    const size = Math.round(baseSize * sizeVariation)
    const baseDur = 8 + Math.random() * 6
    const durVariation = 1 + (Math.random() - 0.5) * 0.2
    const dur = (baseDur * durVariation).toFixed(1)
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

  return `<div class="small-bubble-field">${bubbles.join('')}</div>`
}

function renderLoading() {
  document.body.classList.add('landing-body')
  app.innerHTML = `
    <div class="card">
      <h1 class="h1">🧼 ぴかって！</h1>
      <p class="p muted">読み込み中...</p>
    </div>
  `
}

function renderHome() {
  const loggedIn = isLoggedIn()
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
  const isAndroid = /Android/.test(navigator.userAgent)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                       (window.navigator as any).standalone === true

  // ランディングページ用のbodyクラスを追加
  document.body.classList.add('landing-body')

  app.innerHTML = `
    <div class="landing-page">
      <!-- ヘッダー -->
      <header class="landing-header">
        <div class="landing-header-content">
          <div class="landing-header-logo">
            <img src="/apple-touch-icon.png" alt="ぴかって！" class="landing-header-icon" />
            <span>ぴかって！</span>
          </div>
          ${!isStandalone ? `
            <button class="landing-header-install" id="scrollToInstall">インストール</button>
          ` : ''}
        </div>
      </header>

      <!-- ヒーローセクション -->
      <section class="landing-hero">
        <div class="landing-hero-content">
          <h1 class="landing-hero-title">ぴかって！は、家族の「ちゃんと」を支える場所</h1>
          <p class="landing-hero-text">
            人、家族、そして日常の習慣。<br>
            <strong>ぴかって！</strong>は、毎日の手洗いを、<br>
            無理なく・楽しく・自然に続けるためのアプリです。
          </p>
          <p class="landing-hero-subtext">
            洗面所で、玄関で、<br>
            「今やる」を迷わず始められる。<br>
            それが、ぴかって！です。
          </p>
          <p class="landing-hero-nfc">
            専用スタンドに置くだけで、<br>
            アプリが起動します。
          </p>
          ${!isStandalone ? `
            <div style="margin-top: 24px;">
              <button class="landing-hero-install" id="scrollToInstallFromHero">インストール</button>
            </div>
          ` : ''}
        </div>
      </section>

      <!-- 機能紹介セクション -->
      <section class="landing-section landing-section-with-bubbles">
        ${generateBubbleField()}
        <h2 class="landing-section-title">ぴかって！でできること</h2>
        
        <div class="landing-features-grid">
          <div class="landing-feature-card">
            <div class="landing-feature-icon">🚀</div>
            <h3 class="landing-feature-title">手洗いを、迷わず始める</h3>
            <p class="landing-feature-text">
              専用スタンドに置くだけで起動できます。<br>
              ホーム画面からもすぐに起動可能。<br>
              洗面所に立ったその瞬間に、手洗いが始まります。
            </p>
          </div>

          <div class="landing-feature-card">
            <div class="landing-feature-icon">⏱️</div>
            <h3 class="landing-feature-title">20秒を、ちゃんと守れる</h3>
            <p class="landing-feature-text">
              タイマーは20秒固定。<br>
              途中で終わらせることはできません。<br>
              「なんとなく洗った」をなくします。
            </p>
          </div>

          <div class="landing-feature-card">
            <div class="landing-feature-icon">👨‍👩‍👧‍👦</div>
            <h3 class="landing-feature-title">家族で、ゆるくつながる</h3>
            <p class="landing-feature-text">
              誰が・いつ手を洗ったか。<br>
              細かく管理しなくても、家族で自然に共有できます。
            </p>
          </div>

          <div class="landing-feature-card">
            <div class="landing-feature-icon">🔔</div>
            <h3 class="landing-feature-title">忘れがちなときは、そっと知らせる</h3>
            <p class="landing-feature-text">
              毎日決まった時間に、<br>
              「今日はまだだよ」をやさしくリマインド。
            </p>
          </div>
        </div>
      </section>

      <!-- デザインの考え方セクション -->
      <section class="landing-section landing-section-alt">
        <h2 class="landing-section-title">日常に溶け込む、やさしい設計</h2>
        
        <div class="landing-design-grid">
          <div class="landing-design-item">
            <h3 class="landing-design-title">洗面所が、スタート地点</h3>
            <p class="landing-design-text">
              アプリを探す必要はありません。<br>
              行動が起きる場所から、体験が始まります。
            </p>
          </div>

          <div class="landing-design-item">
            <h3 class="landing-design-title">操作は、できるだけ少なく</h3>
            <p class="landing-design-text">
              ボタンは大きく、画面はシンプルに。<br>
              子どもでも迷わず使えることを大切にしています。
            </p>
          </div>

          <div class="landing-design-item">
            <h3 class="landing-design-title">見張らない、責めない</h3>
            <p class="landing-design-text">
              ぴかって！は、<br>
              「管理するアプリ」ではありません。<br>
              家族の安心を、そっと支えるアプリです。
            </p>
          </div>
        </div>
      </section>

      <!-- 価値観セクション -->
      <section class="landing-section landing-section-with-bubbles">
        ${generateBubbleField()}
        <h2 class="landing-section-title">ぴかって！が大切にしている考え方</h2>
        
        <div class="landing-values-grid">
          <div class="landing-value-card">
            <h3 class="landing-value-title">習慣は、続いてこそ意味がある</h3>
            <p class="landing-value-text">
              頑張らせるより、続けやすく。<br>
              ルールより、流れをつくる。
            </p>
          </div>

          <div class="landing-value-card">
            <h3 class="landing-value-title">家族は、チーム</h3>
            <p class="landing-value-text">
              誰か一人が頑張るのではなく、<br>
              家族みんなで自然に回る仕組みを。
            </p>
          </div>

          <div class="landing-value-card">
            <h3 class="landing-value-title">テクノロジーは、裏方でいい</h3>
            <p class="landing-value-text">
              目立たなくていい。<br>
              でも、確実に役に立つこと。
            </p>
          </div>
        </div>
      </section>

      <!-- 使用場面セクション -->
      <section class="landing-section landing-section-alt">
        <h2 class="landing-section-title">こんな場面で使われています</h2>
        
        <div class="landing-scenarios-grid">
          <div class="landing-scenario-item">
            <div class="landing-scenario-icon">🏠</div>
            <p class="landing-scenario-text">帰宅後、洗面所に向かったとき</p>
          </div>

          <div class="landing-scenario-item">
            <div class="landing-scenario-icon">🍽️</div>
            <p class="landing-scenario-text">食事の前、手を洗うタイミングで</p>
          </div>

          <div class="landing-scenario-item">
            <div class="landing-scenario-icon">💬</div>
            <p class="landing-scenario-text">子どもに声をかけるきっかけとして</p>
          </div>

          <div class="landing-scenario-item">
            <div class="landing-scenario-icon">👨‍👩‍👧‍👦</div>
            <p class="landing-scenario-text">家族で「今日どうだった？」を話すときに</p>
          </div>
        </div>
      </section>

      <!-- フッター -->
      <section class="landing-footer landing-section-with-bubbles">
        ${generateBubbleField()}
        <p class="landing-footer-text">
          洗面所に、ぴかっと。<br>
          手洗いに、迷いをなくす。
        </p>
        <p class="landing-footer-subtext">
          ぴかって！で、家族の毎日を少しだけ安心に
        </p>
        <p class="landing-footer-note">
          手洗いは、ただの作業じゃない。<br>
          家族を守る、小さな習慣。<br>
          ぴかって！は、その一歩を支えます。
        </p>
      </section>

      <!-- はじめるのは、とても簡単セクション -->
      ${!isStandalone ? `
        <section class="landing-cta" id="install-section">
          <div class="landing-cta-content">
            <h2 class="landing-cta-title">はじめるのは、とても簡単</h2>
            <p class="landing-section-subtitle" style="text-align: center; margin-bottom: 32px; color: rgba(255, 255, 255, 0.9);">
              ホーム画面に追加するだけ。<br>アプリのように、すぐ使えます。
            </p>
            <div class="pwa-install-section">
              <div class="pwa-install-header">
                <span class="pwa-install-icon">📱</span>
                <h2 class="h2" style="color: white;">アプリをインストール</h2>
              </div>
              <p class="small pwa-install-description" style="color: rgba(255, 255, 255, 0.8);">
                ホーム画面に追加して、アプリのように快適に使えます
              </p>
            
            ${isIOS ? `
              <div class="pwa-install-steps">
                <div class="install-step">
                  <div class="step-number">1</div>
                  <div class="step-content">
                    <div class="step-title">Safariの共有ボタンをタップ</div>
                    <div class="step-description">画面下部の共有アイコン（□↑）をタップ</div>
                  </div>
                </div>
                <div class="install-step">
                  <div class="step-number">2</div>
                  <div class="step-content">
                    <div class="step-title">「ホーム画面に追加」を選択</div>
                    <div class="step-description">メニューから「ホーム画面に追加」を選びます</div>
                  </div>
                </div>
                <div class="install-step">
                  <div class="step-number">3</div>
                  <div class="step-content">
                    <div class="step-title">完了！</div>
                    <div class="step-description">ホーム画面からアプリを起動できます</div>
                  </div>
                </div>
              </div>
            ` : isAndroid ? `
              <div class="pwa-install-steps">
                <div class="install-step">
                  <div class="step-number">1</div>
                  <div class="step-content">
                    <div class="step-title">メニューボタンをタップ</div>
                    <div class="step-description">ブラウザの右上（3点）メニューを開く</div>
                  </div>
                </div>
                <div class="install-step">
                  <div class="step-number">2</div>
                  <div class="step-content">
                    <div class="step-title">「アプリをインストール」を選択</div>
                    <div class="step-description">メニューから「アプリをインストール」または「ホーム画面に追加」を選びます</div>
                  </div>
                </div>
                <div class="install-step">
                  <div class="step-number">3</div>
                  <div class="step-content">
                    <div class="step-title">完了！</div>
                    <div class="step-description">ホーム画面からアプリを起動できます</div>
                  </div>
                </div>
              </div>
            ` : `
              <div class="pwa-install-steps">
                <div class="install-step">
                  <div class="step-number">1</div>
                  <div class="step-content">
                    <div class="step-title">アドレスバーのインストールアイコンをクリック</div>
                    <div class="step-description">ブラウザのアドレスバーに表示される「インストール」アイコンをクリック</div>
                  </div>
                </div>
                <div class="install-step">
                  <div class="step-number">2</div>
                  <div class="step-content">
                    <div class="step-title">「インストール」を確認</div>
                    <div class="step-description">表示されるダイアログで「インストール」をクリック</div>
                  </div>
                </div>
                <div class="install-step">
                  <div class="step-number">3</div>
                  <div class="step-content">
                    <div class="step-title">完了！</div>
                    <div class="step-description">デスクトップやランチャーからアプリを起動できます</div>
                  </div>
                </div>
              </div>
            `}
            </div>
            
            <p class="landing-cta-text" style="margin-top: 32px; margin-bottom: 24px;">アプリをインストールしなくても確認できます。</p>
            
            <div class="landing-cta-actions">
              ${loggedIn ? `
                <button class="btn btn-large btn-primary" id="startWashFromInstall">
                  🧼 手洗いをはじめる
                </button>
                <button class="btn btn-large secondary" id="goMypageFromInstall">
                  📊 マイページ
                </button>
              ` : `
                <button class="btn btn-large btn-primary" id="checkLoginFromInstall">ログインして確認する</button>
              `}
            </div>
          </div>
        </section>
      ` : ''}
    </div>
    <div class="version-info">v1.0.0</div>
  `

  // インストールボタンのスムーズスクロール
  const scrollToInstallBtn = document.getElementById('scrollToInstall')
  if (scrollToInstallBtn) {
    scrollToInstallBtn.addEventListener('click', () => {
      const installSection = document.getElementById('install-section')
      if (installSection) {
        installSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  const scrollToInstallFromHeroBtn = document.getElementById('scrollToInstallFromHero')
  if (scrollToInstallFromHeroBtn) {
    scrollToInstallFromHeroBtn.addEventListener('click', () => {
      const installSection = document.getElementById('install-section')
      if (installSection) {
        installSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  if (loggedIn) {
    const startWashFromInstallBtn = document.getElementById('startWashFromInstall')
    if (startWashFromInstallBtn) {
      startWashFromInstallBtn.addEventListener('click', () => {
        location.href = '/wash/'
      })
    }
    const goMypageFromInstallBtn = document.getElementById('goMypageFromInstall')
    if (goMypageFromInstallBtn) {
      goMypageFromInstallBtn.addEventListener('click', () => {
        location.href = '/mypage/'
      })
    }
  } else {
    const checkLoginFromInstallBtn = document.getElementById('checkLoginFromInstall')
    if (checkLoginFromInstallBtn) {
      checkLoginFromInstallBtn.addEventListener('click', () => {
        location.href = '/mypage/'
      })
    }
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
