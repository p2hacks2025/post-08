#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { AuthStack } from '../lib/auth-stack'
import { ApiStack } from '../lib/api-stack'
import { CicdStack } from '../lib/cicd-stack'

const app = new cdk.App()

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
}

// GitHub リポジトリ名（OIDC認証に使用）
const GITHUB_REPO = 'p2hacks2025/post-08'

// ============================================================
// 1) CicdStack (S3 + CloudFront + GitHub OIDC)
// ============================================================
const cicd = new CicdStack(app, 'CicdStack', {
  env,
  githubRepo: GITHUB_REPO,
})

// ============================================================
// 2) AuthStack (Cognito) - CloudFront URLを callback に追加
// ============================================================
const auth = new AuthStack(app, 'AuthStack', {
  env,
  webDistributionDomain: cicd.distribution.distributionDomainName,
})

// ============================================================
// 3) ApiStack (Lambda + API Gateway + DynamoDB)
// ============================================================
new ApiStack(app, 'ApiStack', {
  env,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  webDistributionDomain: cicd.distribution.distributionDomainName,
  // エラー通知用のメールアドレス（オプション、環境変数から取得）
  alertEmail: process.env.ALERT_EMAIL,
})
