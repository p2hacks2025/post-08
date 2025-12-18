import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { randomUUID, createHash, randomBytes } from "crypto"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"

function makeInviteCode(): string {
  // 例: ABCD-EFGH（見やすい招待コード）
  const raw = randomBytes(6).toString("base64").replace(/[^A-Z0-9]/gi, "").toUpperCase()
  const code = (raw + "XXXXXXXX").slice(0, 8)
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)

  const body = event.body ? JSON.parse(event.body) : {}
  const name = String(body?.name ?? "").trim()
  if (!name) return json(400, { ok: false, message: "name is required" })

  const familyId = randomUUID()
  const inviteCode = makeInviteCode()
  const inviteHash = sha256Hex(inviteCode)
  const now = new Date().toISOString()

  // 1) Family META
  await doc.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `FAMILY#${familyId}`,
      sk: "META",
      familyId,
      name,
      createdAt: now,
      createdBy: sub,
      inviteHash,
    },
    ConditionExpression: "attribute_not_exists(pk)",
  }))

  // 2) Invite mapping（招待コード→familyId）
  await doc.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `INVITE#${inviteHash}`,
      sk: "META",
      familyId,
      createdAt: now,
    },
    ConditionExpression: "attribute_not_exists(pk)",
  }))

  // 3) Membership（作成者は owner）
  await doc.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `USER#${sub}`,
      sk: `FAMILY#${familyId}`,
      familyId,
      userSub: sub,
      role: "owner",
      joinedAt: now,
      // GSI1: FAMILY → MEMBERs lookup
      gsi1pk: `FAMILY#${familyId}`,
      gsi1sk: `MEMBER#${sub}`,
    },
  }))

  return json(200, { ok: true, familyId, name, inviteCode })
}

