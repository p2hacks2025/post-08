import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)
  const body = event.body ? JSON.parse(event.body) : {}
  const familyId = String(body?.familyId ?? "").trim()

  if (!familyId) {
    return json(400, { ok: false, message: "familyId is required" })
  }

  // 自分のメンバーシップを確認
  const membershipQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND sk = :sk",
    ExpressionAttributeValues: {
      ":pk": `USER#${sub}`,
      ":sk": `FAMILY#${familyId}`,
    },
  }))

  const membership = membershipQuery.Items?.[0]
  if (!membership) {
    return json(404, { ok: false, message: "You are not a member of this family" })
  }

  // オーナーは退出できない（先に削除するか、オーナー権限を譲渡する必要がある）
  if (membership.role === "owner") {
    return json(400, { ok: false, message: "Owner cannot leave. Delete the family or transfer ownership first." })
  }

  // メンバーシップを削除
  await doc.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: `USER#${sub}`,
      sk: `FAMILY#${familyId}`,
    },
  }))

  // Push購読も削除（このファミリーに関連するもの）
  const pushQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `USER#${sub}`,
      ":skPrefix": "PUSH#",
    },
  }))

  for (const item of pushQuery.Items ?? []) {
    if (item.familyId === familyId) {
      await doc.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: item.pk, sk: item.sk },
      }))
    }
  }

  return json(200, { ok: true, message: "Left the family successfully" })
}

