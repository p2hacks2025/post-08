import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="card">
    <h1 class="h1">マイページ（仮）</h1>
    <p class="p">ここにファミリー設定・履歴・リマインドを実装予定。</p>
    <button class="btn secondary" id="back">戻る</button>
  </div>
`
document.getElementById('back')!.addEventListener('click', () => {
  // base: './' の静的配信でも崩れないよう相対で戻る
  location.href = '../index.html'
})
