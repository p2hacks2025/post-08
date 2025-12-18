import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"
import { assertFamilyMember } from "./authz"

function pad13(n: number): string {
  const s = String(Math.max(0, Math.floor(n)))
  return s.padStart(13, "0")
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sub = getSub(event)
    const qs = event.queryStringParameters ?? {}

    const familyId = String(qs.familyId ?? "").trim()
    if (!familyId) return json(400, { ok: false, message: "familyId is required" })

    await assertFamilyMember(sub, familyId)

    // from/to は epoch ms（数値）で受ける。なければ直近7日を返す。
    const now = Date.now()
    const from = qs.from ? Number(qs.from) : now - 7 * 24 * 60 * 60 * 1000
    const to = qs.to ? Number(qs.to) : now

    const limit = qs.limit ? Math.min(200, Math.max(1, Number(qs.limit))) : 50
    const asc = qs.asc === "1" || qs.asc === "true"

    const fromKey = `EVENT#${pad13(from)}#`
    // 上限は同じmsの中の全IDを含めたいので、末尾に大きい文字を足す
    const toKey = `EVENT#${pad13(to)}#\uffff`

    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND sk BETWEEN :from AND :to",
        ExpressionAttributeValues: {
          ":pk": `FAMILY#${familyId}`,
          ":from": fromKey,
          ":to": toKey,
        },
        Limit: limit,
        ScanIndexForward: asc, // true=昇順、false=降順（新しい順）
      })
    )

    const events = (res.Items ?? []).map((it) => ({
      familyId: it.familyId,
      eventId: it.eventId,
      atMs: it.atMs,
      createdBy: it.createdBy,
      mode: it.mode,
      durationSec: it.durationSec,
      note: it.note,
    }))

    return json(200, { ok: true, events })
  } catch (e: any) {
    if (e?.code === "FORBIDDEN") return json(403, { ok: false, message: "not a family member" })
    return json(500, { ok: false, message: e?.message ?? "internal error" })
  }
}

