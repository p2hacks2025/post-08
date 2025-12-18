// src/pkce.ts - PKCE (Proof Key for Code Exchange) ユーティリティ

function base64UrlEncode(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function randomString(length = 64): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  // URL安全文字に寄せる
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('')
}

export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

