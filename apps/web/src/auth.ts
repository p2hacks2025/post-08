// src/auth.ts - Cognito Hosted UI + PKCE 認証モジュール
import { randomString, sha256Base64Url } from './pkce'

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN as string
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI as string

const STORAGE_VERIFIER = 'pkce:verifier'
const STORAGE_STATE = 'pkce:state'
const STORAGE_TOKENS = 'auth:tokens'

type TokenResponse = {
  access_token: string
  id_token: string
  refresh_token?: string
  token_type: 'Bearer'
  expires_in: number
}

export function getIdToken(): string | null {
  const raw = sessionStorage.getItem(STORAGE_TOKENS)
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as TokenResponse
    return t.id_token ?? null
  } catch {
    return null
  }
}

export function isLoggedIn(): boolean {
  return !!getIdToken()
}

export async function startLogin(): Promise<void> {
  const verifier = randomString(80)
  const challenge = await sha256Base64Url(verifier)
  const state = randomString(24)

  sessionStorage.setItem(STORAGE_VERIFIER, verifier)
  sessionStorage.setItem(STORAGE_STATE, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  // Hosted UI へ
  window.location.assign(`${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`)
}

export async function handleCallbackIfPresent(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')

  if (!code) return false // コールバックじゃない

  const expectedState = sessionStorage.getItem(STORAGE_STATE)
  const verifier = sessionStorage.getItem(STORAGE_VERIFIER)

  // stateチェック（CSRF対策）
  if (!expectedState || !returnedState || expectedState !== returnedState) {
    throw new Error('Invalid state (possible CSRF).')
  }
  if (!verifier) {
    throw new Error('Missing PKCE verifier.')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })

  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }

  const tokens = (await res.json()) as TokenResponse
  sessionStorage.setItem(STORAGE_TOKENS, JSON.stringify(tokens))

  // URLの ?code=... を消す（見た目/再実行防止）
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  window.history.replaceState({}, '', url.toString())

  return true
}

export function logout(): void {
  sessionStorage.removeItem(STORAGE_TOKENS)
  sessionStorage.removeItem(STORAGE_VERIFIER)
  sessionStorage.removeItem(STORAGE_STATE)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: REDIRECT_URI,
  })
  window.location.assign(`${COGNITO_DOMAIN}/logout?${params.toString()}`)
}

