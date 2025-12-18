import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda"

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function getSub(event: any): string {
  const sub = event?.requestContext?.authorizer?.jwt?.claims?.sub
  if (!sub) throw new Error("Missing JWT sub")
  return String(sub)
}

