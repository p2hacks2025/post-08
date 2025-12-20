import type { ScheduledHandler } from "aws-lambda"
import { QueryCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager"
import * as webpush from "web-push"
import { doc, TABLE_NAME } from "./db"
import { log, notifyError } from "./_shared"

const secretsClient = new SecretsManagerClient({})
const VAPID_SECRET_NAME = process.env.VAPID_SECRET_NAME || "handwash/vapid"

// VAPID設定をキャッシュ
let vapidConfigured = false

async function setupVapid() {
  if (vapidConfigured) return

  try {
    const secret = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: VAPID_SECRET_NAME })
    )
    const vapid = JSON.parse(secret.SecretString || "{}")
    webpush.setVapidDetails(
      vapid.subject || "mailto:noreply@example.com",
      vapid.publicKey,
      vapid.privateKey
    )
    vapidConfigured = true
    console.log("VAPID configured successfully")
  } catch (e) {
    console.error("Failed to get VAPID secret:", e)
    throw e
  }
}

function pad13(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(13, "0")
}

// 今日の0:00 JST（UTC+9）を epoch ms で返す
function getTodayStartJST(): number {
  const now = new Date()
  // JSTでの今日の0:00を計算
  const jstOffset = 9 * 60 * 60 * 1000
  const nowJST = now.getTime() + jstOffset
  const todayStartJST = Math.floor(nowJST / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
  return todayStartJST - jstOffset // UTCに戻す
}

// 今日手洗いしたユーザーのsubを取得
async function getTodayWashedUsers(familyId: string, todayStart: number): Promise<Set<string>> {
  const washedUsers = new Set<string>()
  const fromKey = `EVENT#${pad13(todayStart)}#`
  const toKey = `EVENT#${pad13(Date.now())}#\uffff`

  const res = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND sk BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":from": fromKey,
      ":to": toKey,
    },
  }))

  for (const item of res.Items ?? []) {
    if (item.createdBy) {
      washedUsers.add(item.createdBy as string)
    }
  }

  return washedUsers
}

// 購読削除（410/404の場合）
async function deleteSubscription(pk: string, sk: string) {
  try {
    await doc.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
    }))
    console.log(`Deleted expired subscription: ${pk} ${sk}`)
  } catch (e) {
    console.error("Failed to delete subscription:", e)
  }
}

// 全てのPush購読を取得（ハッカソン用の簡易実装）
async function getAllPushSubscriptions(): Promise<any[]> {
  const items: any[] = []
  let lastKey: any = undefined

  do {
    const res: any = await doc.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "entity = :entity",
      ExpressionAttributeValues: { ":entity": "PUSH_SUB" },
      ExclusiveStartKey: lastKey,
    }))

    if (res.Items) {
      items.push(...res.Items)
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return items
}

const handlerImpl: ScheduledHandler = async () => {
  try {
    log('info', 'Reminder Lambda started')

    await setupVapid()

    const todayStart = getTodayStartJST()
    log('info', 'Today start (JST) calculated', { todayStart: new Date(todayStart).toISOString() })

    // 全購読を取得
    const allSubscriptions = await getAllPushSubscriptions()
    log('info', 'Push subscriptions retrieved', { count: allSubscriptions.length })

    // ファミリーごとにグループ化
    const familyMap = new Map<string, any[]>()
    for (const item of allSubscriptions) {
      const fid = item.familyId as string
      if (!familyMap.has(fid)) familyMap.set(fid, [])
      familyMap.get(fid)!.push(item)
    }

    let sentCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const [familyId, subs] of familyMap) {
      const washedUsers = await getTodayWashedUsers(familyId, todayStart)
      log('info', 'Family processed', { familyId, washedUsersCount: washedUsers.size, subscriptionsCount: subs.length })

      for (const sub of subs) {
        const userSub = sub.userSub as string

        // 今日既に手洗いしていたらスキップ
        if (washedUsers.has(userSub)) {
          log('info', 'User already washed today, skipping', { userSub })
          skippedCount++
          continue
        }

        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: sub.keys,
        }

        const payload = JSON.stringify({
          title: "🧼 手洗いリマインド",
          body: "今日の手洗い、忘れてない？",
          url: "/",
        })

        try {
          await webpush.sendNotification(pushSubscription, payload)
          sentCount++
          log('info', 'Reminder sent', { userSub })
        } catch (e: any) {
          errorCount++
          log('error', 'Failed to send reminder', { 
            userSub, 
            statusCode: e?.statusCode, 
            message: e?.message 
          })

          // 410 Gone or 404 = 購読が無効になった
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await deleteSubscription(sub.pk, sub.sk)
          }
        }
      }
    }

    log('info', 'Reminder completed', { sentCount, skippedCount, errorCount })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    log('error', 'Reminder Lambda failed', {
      error: err.message,
      stack: err.stack,
    })
    await notifyError('SendReminderFunction', err)
    throw error
  }
}

export const handler = handlerImpl
