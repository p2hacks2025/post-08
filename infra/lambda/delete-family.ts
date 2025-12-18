import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { DeleteCommand, QueryCommand, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb"
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

  // オーナーのみ削除可能
  if (membership.role !== "owner") {
    return json(403, { ok: false, message: "Only the owner can delete the family" })
  }

  // ファミリーMETAを取得（inviteHashを取得するため）
  const familyMeta = await doc.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `FAMILY#${familyId}`, sk: "META" },
  }))

  const inviteHash = familyMeta.Item?.inviteHash

  // 1) Family META を削除
  await doc.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { pk: `FAMILY#${familyId}`, sk: "META" },
  }))

  // 2) Invite mapping を削除
  if (inviteHash) {
    await doc.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `INVITE#${inviteHash}`, sk: "META" },
    }))
  }

  // 3) 全メンバーシップを削除（スキャンで取得）
  const membersScan = await doc.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "sk = :sk",
    ExpressionAttributeValues: {
      ":sk": `FAMILY#${familyId}`,
    },
  }))

  for (const item of membersScan.Items ?? []) {
    if (item.pk?.startsWith("USER#")) {
      await doc.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: item.pk, sk: item.sk },
      }))
    }
  }

  // 4) 手洗いイベントを削除
  const eventsScan = await doc.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":skPrefix": "EVENT#",
    },
  }))

  for (const item of eventsScan.Items ?? []) {
    await doc.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: item.pk, sk: item.sk },
    }))
  }

  // 5) Push購読を削除（このファミリーに関連するもの）
  const pushScan = await doc.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "familyId = :familyId AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":familyId": familyId,
      ":skPrefix": "PUSH#",
    },
  }))

  for (const item of pushScan.Items ?? []) {
    await doc.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: item.pk, sk: item.sk },
    }))
  }

  return json(200, { ok: true, message: "Family deleted successfully" })
}


