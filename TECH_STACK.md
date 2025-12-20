# 技術スタック

## フロントエンド

### コア技術
- **TypeScript** - 型安全なJavaScript
- **Vite** (v7.2.4) - 高速なビルドツールと開発サーバー
- **Vanilla TypeScript** - フレームワークなしの純粋なTypeScript実装

### PWA (Progressive Web App)
- **vite-plugin-pwa** (v1.2.0) - PWA機能の統合
- **Service Worker** - オフライン対応とキャッシュ管理
- **Workbox** - Service Workerのライブラリ（precaching）

### 認証
- **AWS Cognito Hosted UI** - 認証UI
- **PKCE (Proof Key for Code Exchange)** - OAuth 2.0認証フロー

### スタイリング
- **CSS** - カスタムスタイルシート
- **CSS Animations** - キーフレームアニメーション（泡、キラキラなど）

### その他
- **Web Push API** - プッシュ通知
- **Wake Lock API** - 画面のスリープ防止

---

## バックエンド

### ランタイム
- **AWS Lambda** - サーバーレス関数実行環境
- **Node.js 20.x** - ランタイム

### 言語・フレームワーク
- **TypeScript** - 型安全な開発
- **AWS Lambda Handlers** - イベント駆動型の関数

### API
- **AWS API Gateway v2 (HTTP API)** - RESTful APIエンドポイント
- **JWT認証** - Cognito発行のJWTトークンによる認証

### データベース
- **Amazon DynamoDB** - NoSQLデータベース
  - パーティションキー: `pk`
  - ソートキー: `sk`
  - GSI (Global Secondary Index): `GSI1` (gsi1pk, gsi1sk)
  - オンデマンド課金モード

### 認証・認可
- **AWS Cognito User Pool** - ユーザー認証管理
- **JWT Authorizer** - API Gatewayでの認証

### プッシュ通知
- **Web Push API** - ブラウザプッシュ通知
- **VAPID Keys** - プッシュ通知の認証（AWS Secrets Managerで管理）

### スケジューリング
- **AWS EventBridge** - 定期実行（リマインド送信など）

### その他
- **AWS Secrets Manager** - VAPID秘密鍵の管理

---

## インフラ

### Infrastructure as Code
- **AWS CDK (Cloud Development Kit)** - TypeScriptでインフラを定義
- **aws-cdk-lib** (v2.232.2) - CDKのコアライブラリ

### コンピューティング
- **AWS Lambda** - サーバーレス関数
- **NodejsFunction** - TypeScriptからLambda関数を自動ビルド

### API
- **AWS API Gateway v2 (HTTP API)** - RESTful API
- **Lambda Integration** - Lambda関数との統合
- **JWT Authorizer** - Cognito JWTによる認証

### 認証
- **AWS Cognito User Pool** - ユーザー認証
- **Cognito User Pool Client** - アプリケーションクライアント

### データストレージ
- **Amazon DynamoDB** - NoSQLデータベース
- **Amazon S3** - 静的ファイルホスティング（フロントエンド）

### コンテンツ配信
- **Amazon CloudFront** - CDN（コンテンツ配信ネットワーク）
- **S3 Origin** - S3バケットをオリジンとして使用

### CI/CD
- **GitHub Actions** - 継続的インテグレーション・デプロイ
- **GitHub OIDC** - AWS認証（IAM Role連携）
- **AWS IAM Role** - GitHub Actionsからのデプロイ権限

### その他
- **AWS Secrets Manager** - 機密情報の管理
- **AWS EventBridge** - イベント駆動型のスケジューリング

---

## 開発環境

（開発環境については各自で記入してください）
