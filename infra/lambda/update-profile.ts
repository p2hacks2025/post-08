import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)
  const body = event.body ? JSON.parse(event.body) : {}
  const displayName = String(body?.displayName ?? "").trim()

  if (!displayName) {
    return json(400, { ok: false, message: "displayName is required" })
  }

  if (displayName.length > 30) {
    return json(400, { ok: false, message: "displayName must be 30 characters or less" })
  }

  // ユーザープロファイルを保存
  await doc.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `USER#${sub}`,
      sk: "PROFILE",
      entity: "USER_PROFILE",
      userSub: sub,
      displayName,
      updatedAt: new Date().toISOString(),
    },
  }))

  // すべてのファミリーのメンバーシップを更新（displayNameを反映）
  // まず、ユーザーが所属しているファミリーを取得
  const membershipsQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `USER#${sub}`,
      ":skPrefix": "FAMILY#",
    },
  }))

  // 各メンバーシップのdisplayNameを更新
  for (const membership of membershipsQuery.Items ?? []) {
    const familyId = membership.familyId as string
    if (familyId) {
      // メンバーシップのdisplayNameを更新
      await doc.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...membership,
          displayName,
        },
      }))

      // GSI1のdisplayNameも更新
      await doc.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `FAMILY#${familyId}`,
          sk: `MEMBER#${sub}`,
          gsi1pk: `FAMILY#${familyId}`,
          gsi1sk: `MEMBER#${sub}`,
          entity: "MEMBERSHIP",
          userSub: sub,
          familyId,
          role: membership.role,
          joinedAt: membership.joinedAt,
          displayName,
        },
      }))
    }
  }

  return json(200, { ok: true, displayName })
}

