import type { APIGatewayProxyHandlerV2 } from "aws-lambda"
import { QueryCommand, ScanCommand, GetCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb"
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
    // GSI1から取得したメンバーをマップ（subでユニークにする）
    const memberMap = new Map<string, {
      sub: string
      role: string
      joinedAt: string
      displayName?: string
    }>()
    
    // プロファイルからdisplayNameを取得するためのバッチ取得
    const profileKeys = gsi1Query.Items
      .filter(item => item.pk?.startsWith("USER#"))
      .map(item => ({ pk: item.pk as string, sk: "PROFILE" }))
    
    const profileMap = new Map<string, string>()
    if (profileKeys.length > 0) {
      const batchResult = await doc.send(new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: { Keys: profileKeys },
        },
      }))
      
      for (const profile of batchResult.Responses?.[TABLE_NAME] ?? []) {
        const userSub = profile.userSub as string
        const displayName = profile.displayName as string | undefined
        if (userSub && displayName) {
          profileMap.set(userSub, displayName)
        }
      }
    }
    
    for (const item of gsi1Query.Items) {
      const sub = item.userSub as string
      // pkがUSER#で始まるアイテムのみを対象とする（正しいメンバーシップアイテム）
      // pk: FAMILY#${familyId}, sk: MEMBER#${sub} のような重複アイテムを除外
      if (sub && item.pk?.startsWith("USER#") && !memberMap.has(sub)) {
        // メンバーシップアイテムのdisplayNameを優先、なければプロファイルから取得
        const displayName = item.displayName as string | undefined || profileMap.get(sub)
        memberMap.set(sub, {
          sub,
          role: item.role as string,
          joinedAt: item.joinedAt as string,
          displayName,
        })
      }
    }
    
    members = Array.from(memberMap.values())
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

    // subでユニークにする
    const memberMap = new Map<string, {
      sub: string
      role: string
      joinedAt: string
      displayName?: string
    }>()
    
    // プロファイルからdisplayNameを取得するためのバッチ取得
    const userSubs = new Set<string>()
    for (const item of scanResult.Items ?? []) {
      if (item.pk?.startsWith("USER#")) {
        const sub = (item.pk as string).replace("USER#", "")
        userSubs.add(sub)
      }
    }
    
    const profileMap = new Map<string, string>()
    if (userSubs.size > 0) {
      const profileKeys = Array.from(userSubs).map(sub => ({ pk: `USER#${sub}`, sk: "PROFILE" }))
      const batchResult = await doc.send(new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: { Keys: profileKeys },
        },
      }))
      
      for (const profile of batchResult.Responses?.[TABLE_NAME] ?? []) {
        const userSub = profile.userSub as string
        const displayName = profile.displayName as string | undefined
        if (userSub && displayName) {
          profileMap.set(userSub, displayName)
        }
      }
    }
    
    for (const item of scanResult.Items ?? []) {
      if (item.pk?.startsWith("USER#")) {
        const sub = (item.pk as string).replace("USER#", "")
        if (!memberMap.has(sub)) {
          // メンバーシップアイテムのdisplayNameを優先、なければプロファイルから取得
          const displayName = item.displayName as string | undefined || profileMap.get(sub)
          memberMap.set(sub, {
            sub,
            role: item.role as string ?? "member",
            joinedAt: item.joinedAt as string ?? "",
            displayName,
          })
        }
      }
    }
    
    members = Array.from(memberMap.values())
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
