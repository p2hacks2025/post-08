import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import { createHash } from "crypto"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)
  const body = event.body ? JSON.parse(event.body) : {}
  const inviteCode = String(body?.inviteCode ?? "").trim().toUpperCase()
  if (!inviteCode) return json(400, { ok: false, message: "inviteCode is required" })

  const inviteHash = sha256Hex(inviteCode)

  // 招待コードから familyId を引く（スキャンなし）
  const invite = await doc.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `INVITE#${inviteHash}`, sk: "META" },
  }))

  const familyId = invite.Item?.familyId as string | undefined
  if (!familyId) return json(404, { ok: false, message: "invite code not found" })

  // すでに参加済みなら上書きしない（Conditionで防ぐ）
  const now = new Date().toISOString()
  try {
    await doc.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${sub}`,
        sk: `FAMILY#${familyId}`,
        familyId,
        userSub: sub,
        role: "member",
        joinedAt: now,
        // GSI1: FAMILY → MEMBERs lookup
        gsi1pk: `FAMILY#${familyId}`,
        gsi1sk: `MEMBER#${sub}`,
      },
      ConditionExpression: "attribute_not_exists(pk)",
    }))
  } catch {
    // 既にある可能性（ConditionFail）
    return json(409, { ok: false, message: "already joined" })
  }

  return json(200, { ok: true, familyId })
}

