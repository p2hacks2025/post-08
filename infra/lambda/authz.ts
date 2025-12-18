import { GetCommand } from "@aws-sdk/lib-dynamodb"
import { doc, TABLE_NAME } from "./db"

export async function assertFamilyMember(sub: string, familyId: string): Promise<void> {
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${sub}`, sk: `FAMILY#${familyId}` },
    })
  )

  if (!res.Item) {
    const err = new Error("FORBIDDEN_NOT_MEMBER") as Error & { code?: string }
    err.code = "FORBIDDEN"
    throw err
  }
}

