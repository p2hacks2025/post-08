import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { createHash } from "crypto"
import { doc, TABLE_NAME } from "./db"
import { json, getSub, withErrorHandling } from "./_shared"
import { assertFamilyMember } from "./authz"

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

const handlerImpl: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sub = getSub(event)
    const body = event.body ? JSON.parse(event.body) : {}

    const familyId = String(body?.familyId ?? "").trim()
    const subscription = body?.subscription
    if (!familyId) return json(400, { ok: false, message: "familyId is required" })
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json(400, { ok: false, message: "subscription is invalid" })
    }

    await assertFamilyMember(sub, familyId)

    const endpoint = String(subscription.endpoint)
    const endpointHash = sha256Hex(endpoint).slice(0, 32)
    const now = new Date().toISOString()

    await doc.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${sub}`,
        sk: `PUSH#${endpointHash}`,
        entity: "PUSH_SUB",
        userSub: sub,
        familyId,
        endpoint,
        keys: subscription.keys,
        userAgent: body?.userAgent,
        createdAt: now,
        // family → subscriptions を引けるように（GSI用）
        gsi1pk: `FAMILY#${familyId}`,
        gsi1sk: `USER#${sub}#PUSH#${endpointHash}`,
      },
    }))

    return json(200, { ok: true })
  } catch (e: any) {
    if (e?.code === "FORBIDDEN") return json(403, { ok: false, message: "not a family member" })
    return json(500, { ok: false, message: e?.message ?? "internal error" })
  }
}

export const handler = withErrorHandling(handlerImpl, 'PushSubscribeFunction')

