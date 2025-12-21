# P2HACKS2025 アピールシート

## プロダクト名
ぴかって！

<img width="350" height="350" alt="icon" src="https://github.com/user-attachments/assets/40fefe18-74a4-4b2d-ac7d-f0297e698926" />

## コンセプト
**実用的**なものを作りたい！

手を泡で洗って、**衛生面でキラキラ！**　させよう。

## 対象ユーザ
- **小さな子どものいるご家庭**
子どもが手洗いを面倒くさがったり、短時間で済ませてしまったりすることに悩んでいる親御さん。

- **健康管理を大切にする家族**
家族全員の衛生習慣を**見える化**し、健康を守りたいと考えている方。


## 利用の流れ
1. ホームページにアクセス：https://d2olzroc7yrsgc.cloudfront.net/にアクセスしてください。インストール方法が書かれています。

2. タッチして起動: 洗面所に設置された専用スタンドにスマホを置くだけ。NFCがPWAのリンクを読み込むと、即座にアプリが立ち上がります。

3. 手洗いのカウントダウン: 20秒間のカウントがスタート。楽しくしっかりと手を洗います。

4. シュチュエーション選択: 洗い終わったら、今のシーン（🏠帰宅 / 🍽️食事前）をタップして記録。

5. キラキラの達成感: 保存が完了すると、手がきれいになったキラキラ（✨）の演出。

6. つながる安心: 記録は家族のマイページに共有されます．

## 推しポイント
- **手軽な操作**
 画面を操作してアプリを探す必要はありません。NFCスタンドに置く、その動作がスイッチになります。

- **手洗い習慣の保証**
20秒経過するまで終了ボタンが機能しないため、「なんとなく手洗い」を防止し，手洗いの実効性を高めます。

- **記録の可視化**
 継続日数カウントにより、親が付きっきりにならなくても、アプリが子供の頑張りをキラキラと称賛し続けます。

## スクリーンショット

|マイページ|ファミリー設定|手洗い中|手洗い完了|手洗い履歴|
|---|---|---|---|---|
|<img width="180" src="https://github.com/user-attachments/assets/79cb6112-3b80-464c-ac43-7e160e231eb2" />| <img width="180" src="https://github.com/user-attachments/assets/3e690f87-ccb5-4259-b51c-bdacbae40cb2" /> |<img width="180" src="https://github.com/user-attachments/assets/04781968-427a-4b19-b417-cc0f3b623a14" />|<img width="180" src="https://github.com/user-attachments/assets/a3739af8-efaa-4aa5-a335-c70e5fae9904" />|<img width="180" src="https://github.com/user-attachments/assets/a2a87365-9f1d-46c8-93de-3718d82f1cc1" />|



## 開発体制

### 役割分担
s260o
- セブンイレブン(元)
- フロント/バック

ほしーも
- ファミリーマート(現)
- デザイン

ghalgkalhrl
- ファミリーマート(元)
- 発表会資料作成


### 開発における工夫した点

- ハードとソフトの融合: 手洗いという物理的な行動に合わせ、スマホの操作負担を減らすためにNFCタグを採用。PWAと組み合わせることで、「アプリを探す・開く」という手間を排除しました。

- ステート管理: 家族というグループ単位でのデータ管理を実現するため、DynamoDBのテーブル設計を工夫し、家族間でのリアルタイムな通知と履歴閲覧を両立させました。

- 開発効率の最大化: GitHub ActionsによるCI/CDを構築。短期間の開発体制でも、インフラとフロントの両方を迅速かつ安全にアップデートできる体制を整えました。

## 開発技術

### 利用したプログラミング言語
- Java/TypeScript

- HTML/CSS


### 利用したフレームワーク・ライブラリ
- フロントエンド:Node.js, Vite, Vanilla TypeScript
  
- AWS : CDK (Cloud Development Kit), Lambda, API Gateway, DynamoDB, S3, CloudFront
 
- ユーザー認証: Amazon Cognito (Hosted UI / OAuth2 PKCE)

### その他開発に使用したツール・サービス
- 開発ツール: GitHub, GitHub Actions, VS Code, Cursor

- デザイン：Figma, Clipstudiopaint, Canva

- ハードウェア: NFCタグ (NTAG215)

- その他：Gemini, ChatGpt, Github Copilot
