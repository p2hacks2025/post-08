import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { QueryCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"
import { assertFamilyMember } from "./authz"

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)
  const familyId = event.queryStringParameters?.familyId

  if (!familyId) {
    return json(400, { ok: false, message: "familyId is required" })
  }

  // 自分がそのファミリーに所属しているか確認
  await assertFamilyMember(sub, familyId)

  // GSI1でファミリーのメンバーを取得（FAMILY#familyId のメンバーシップを検索）
  // USER#sub#FAMILY#familyId の形式で保存されているので、逆引きする
  // → 実際は FAMILY#familyId の下に MEMBER#sub を置く方が効率的だが、
  //   既存スキーマに合わせて USER# をスキャンする

  // 方法: GSI1を使ってfamily → membersを取得
  // gsi1pk = FAMILY#familyId, gsi1sk begins_with USER# でメンバー取得
  const memberQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":skPrefix": "MEMBER#",
    },
  }))

  const memberItems = memberQuery.Items ?? []

  if (memberItems.length === 0) {
    return json(200, { ok: true, members: [] })
  }

  // メンバーのsub一覧
  const members = memberItems.map((item) => ({
    sub: item.userSub as string,
    role: item.role as string,
    joinedAt: item.joinedAt as string,
    displayName: item.displayName as string | undefined,
  }))

  // 自分のroleを確認（owner判定用）
  const myMembership = members.find((m) => m.sub === sub)
  const isOwner = myMembership?.role === "owner"

  return json(200, {
    ok: true,
    isOwner,
    members,
  })
}

