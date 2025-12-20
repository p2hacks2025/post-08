import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb"
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager"
import webpush from "web-push"
import { doc, TABLE_NAME } from "./db"
import { json, getSub, withErrorHandling } from "./_shared"
import { assertFamilyMember } from "./authz"

const sm = new SecretsManagerClient({})
const VAPID_SECRET_NAME = process.env.VAPID_SECRET_NAME ?? "handwash/vapid"

let cachedVapid: { subject: string; publicKey: string; privateKey: string } | null = null

async function getVapidKeys() {
  if (cachedVapid) return cachedVapid
  const res = await sm.send(new GetSecretValueCommand({ SecretId: VAPID_SECRET_NAME }))
  cachedVapid = JSON.parse(res.SecretString ?? "{}")
  return cachedVapid!
}

const handlerImpl: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event) // 送信者
  const body = event.body ? JSON.parse(event.body) : {}
  
  const familyId = String(body?.familyId ?? "").trim()
  const targetSub = String(body?.targetSub ?? "").trim()
  const message = String(body?.message ?? "手洗いしなさい！").trim()

  if (!familyId) return json(400, { ok: false, message: "familyId is required" })
  if (!targetSub) return json(400, { ok: false, message: "targetSub is required" })

  // 1) 送信者がownerであることを確認
  await assertFamilyMember(sub, familyId)
  
  // 送信者の所属情報を取得してownerか確認
  const membershipQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND sk = :sk",
    ExpressionAttributeValues: {
      ":pk": `USER#${sub}`,
      ":sk": `FAMILY#${familyId}`,
    },
  }))
  
  const membership = membershipQuery.Items?.[0]
  if (membership?.role !== "owner") {
    return json(403, { ok: false, message: "Only owner can send notifications" })
  }

  // 2) ターゲットユーザーが同じファミリーに所属しているか確認
  await assertFamilyMember(targetSub, familyId)

  // 3) ターゲットユーザーのPush購読を取得
  const pushQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `USER#${targetSub}`,
      ":skPrefix": "PUSH#",
    },
  }))

  const subscriptions = pushQuery.Items ?? []
  if (subscriptions.length === 0) {
    return json(200, { ok: true, sent: 0, message: "No push subscriptions found for target user" })
  }

  // 4) VAPID keys取得
  const vapid = await getVapidKeys()
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  // 5) Push送信
  const payload = JSON.stringify({
    title: "🧼 手洗いリマインド",
    body: message,
    url: "/wash/",
  })

  let sent = 0
  let failed = 0

  for (const sub of subscriptions) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: sub.keys,
    }

    try {
      await webpush.sendNotification(subscription, payload)
      sent++
    } catch (err: any) {
      // 410 Gone or 404 = subscription expired
      if (err.statusCode === 410 || err.statusCode === 404) {
        // 期限切れの購読を削除
        await doc.send(new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: sub.pk, sk: sub.sk },
        }))
      }
      failed++
    }
  }

  return json(200, { ok: true, sent, failed })
}

export const handler = withErrorHandling(handlerImpl, 'SendPushToUserFunction')

