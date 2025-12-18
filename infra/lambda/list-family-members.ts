import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { QueryCommand, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"
import { json, getSub } from "./_shared"
import { assertFamilyMember } from "./authz"

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getSub(event)
  const familyId = event.queryStringParameters?.familyId

  if (!familyId) {
    return json(400, { ok: false, message: "familyId is required" })
  }

  // 自分がそのファミリーに所属しているか確認 & 自分のroleを取得
  const myMembershipQuery = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :pk AND sk = :sk",
    ExpressionAttributeValues: {
      ":pk": `USER#${sub}`,
      ":sk": `FAMILY#${familyId}`,
    },
  }))

  const myMembership = myMembershipQuery.Items?.[0]
  if (!myMembership) {
    return json(403, { ok: false, message: "Not a member of this family" })
  }

  const isOwner = myMembership.role === "owner"

  // ファミリーのMETAを取得（招待コードのハッシュが保存されている）
  const familyMeta = await doc.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `FAMILY#${familyId}`, sk: "META" },
  }))

  // 招待コードを逆引き（オーナーのみ）
  let inviteCode: string | undefined
  if (isOwner && familyMeta.Item?.inviteHash) {
    // INVITEレコードから招待コードを取得するため、inviteHashを使って検索
    // 実際の招待コードは保存していないので、ハッシュから逆引きはできない
    // → 招待コードをMETAに直接保存するように変更が必要
    // 暫定: ハッシュの一部を表示（実際は招待コード自体を保存すべき）
  }

  // 方法1: GSI1を使う（新しいデータ）
  let members: Array<{
    sub: string
    role: string
    joinedAt: string
    displayName?: string
  }> = []

  // まずGSI1で試す
  const gsi1Query = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":skPrefix": "MEMBER#",
    },
  }))

  if (gsi1Query.Items && gsi1Query.Items.length > 0) {
    members = gsi1Query.Items.map((item) => ({
      sub: item.userSub as string,
      role: item.role as string,
      joinedAt: item.joinedAt as string,
      displayName: item.displayName as string | undefined,
    }))
  } else {
    // 方法2: GSI1にデータがない場合、スキャンで取得（既存データ対応）
    // 注: データ量が少ない前提（ハッカソン用）
    const scanResult = await doc.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "sk = :sk",
      ExpressionAttributeValues: {
        ":sk": `FAMILY#${familyId}`,
      },
    }))

    members = (scanResult.Items ?? [])
      .filter(item => item.pk?.startsWith("USER#"))
      .map((item) => ({
        sub: (item.pk as string).replace("USER#", ""),
        role: item.role as string ?? "member",
        joinedAt: item.joinedAt as string ?? "",
        displayName: item.displayName as string | undefined,
      }))
  }

  return json(200, {
    ok: true,
    isOwner,
    members,
    familyName: familyMeta.Item?.name,
    // オーナーのみ招待コードを返す
    inviteCode: isOwner ? (familyMeta.Item?.inviteCode as string | undefined) : undefined,
  })
}
