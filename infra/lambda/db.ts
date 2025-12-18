import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

export const TABLE_NAME = process.env.TABLE_NAME!

const ddb = new DynamoDBClient({})
export const doc = DynamoDBDocumentClient.from(ddb)

