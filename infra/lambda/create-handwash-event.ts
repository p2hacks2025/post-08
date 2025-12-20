import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { randomUUID } from "crypto"
import { doc, TABLE_NAME } from "./db"
import { json, getSub, withErrorHandling } from "./_shared"
import { assertFamilyMember } from "./authz"

function pad13(n: number): string {
  // epoch ms は13桁想定。文字列比較で時系列になるようゼロ埋め
  const s = String(Math.max(0, Math.floor(n)))
  return s.padStart(13, "0")
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sub = getSub(event)
    const body = event.body ? JSON.parse(event.body) : {}

    const familyId = String(body?.familyId ?? "").trim()
    if (!familyId) return json(400, { ok: false, message: "familyId is required" })

    // 任意項目（必要になったら増やせる）
    const mode = body?.mode != null ? String(body.mode) : undefined
    const durationSec = body?.durationSec != null ? Number(body.durationSec) : undefined
    const note = body?.note != null ? String(body.note).slice(0, 200) : undefined

    await assertFamilyMember(sub, familyId)

    const nowMs = Date.now()
    const eventId = randomUUID()
    const sk = `EVENT#${pad13(nowMs)}#${eventId}`

    await doc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `FAMILY#${familyId}`,
          sk,
          entity: "HANDWASH_EVENT",
          familyId,
          eventId,
          atMs: nowMs,
          createdBy: sub,
          mode,
          durationSec,
          note,
        },
      })
    )

    return json(200, {
      ok: true,
      event: { familyId, eventId, atMs: nowMs, createdBy: sub, mode, durationSec, note },
    })
  } catch (e: any) {
    if (e?.code === "FORBIDDEN") return json(403, { ok: false, message: "not a family member" })
    return json(500, { ok: false, message: e?.message ?? "internal error" })
  }
}

export const handler = withErrorHandling(handlerImpl, 'CreateHandwashEventFunction')

