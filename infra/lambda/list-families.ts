import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"
import { json, getSub, withErrorHandling } from "./_shared"

const handlerImpl: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)

  // 所属一覧（USER#sub）
  const q = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `USER#${sub}`,
      ":skPrefix": "FAMILY#",
    },
  }))

  const memberships = (q.Items ?? []).map((it) => ({
    familyId: it.familyId as string,
    role: (it.role as string) ?? "member",
    joinedAt: it.joinedAt as string,
  }))

  if (memberships.length === 0) return json(200, { ok: true, families: [] })

  // family meta を batch get
  const keys = memberships.map((m) => ({ pk: `FAMILY#${m.familyId}`, sk: "META" }))
  const b = await doc.send(new BatchGetCommand({
    RequestItems: {
      [TABLE_NAME]: { Keys: keys },
    },
  }))

  const metas = new Map<string, any>()
  for (const item of b.Responses?.[TABLE_NAME] ?? []) {
    metas.set(item.familyId, item)
  }

  const families = memberships.map((m) => ({
    ...m,
    name: metas.get(m.familyId)?.name ?? "(unknown)",
  }))

  return json(200, { ok: true, families })
}

export const handler = withErrorHandling(handlerImpl, 'ListFamiliesFunction')

