import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda"
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns"

const ERROR_TOPIC_ARN = process.env.ERROR_TOPIC_ARN
const snsClient = ERROR_TOPIC_ARN ? new SNSClient({}) : null

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

// 構造化ログ出力
export function log(level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, any>) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  }
  console.log(JSON.stringify(logEntry))
}

// エラー通知をSNSに送信
export async function notifyError(functionName: string, error: Error, context?: Record<string, any>) {
  if (!snsClient || !ERROR_TOPIC_ARN) {
    log('warn', 'Error notification skipped: SNS not configured', { functionName })
    return
  }

  try {
    const errorMessage = {
      functionName,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      context,
      timestamp: new Date().toISOString(),
    }

    await snsClient.send(
      new PublishCommand({
        TopicArn: ERROR_TOPIC_ARN,
        Subject: `[ERROR] ${functionName} - ${error.name}`,
        Message: JSON.stringify(errorMessage, null, 2),
      })
    )

    log('info', 'Error notification sent', { functionName, errorName: error.name })
  } catch (e) {
    // SNS送信エラーはログに記録するだけ（無限ループを防ぐ）
    log('error', 'Failed to send error notification', { 
      functionName, 
      originalError: error.message,
      snsError: e instanceof Error ? e.message : String(e),
    })
  }
}

// エラーハンドリング付きハンドラーラッパー
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  functionName: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      log('info', `Function started: ${functionName}`)
      const result = await handler(...args)
      log('info', `Function completed: ${functionName}`)
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      log('error', `Function failed: ${functionName}`, {
        error: err.message,
        stack: err.stack,
      })
      
      await notifyError(functionName, err, {
        requestId: args[0]?.requestContext?.requestId,
        path: args[0]?.rawPath,
        method: args[0]?.requestContext?.http?.method,
      })

      // エラーレスポンスを返す
      return json(500, {
        ok: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' 
          ? 'An error occurred' 
          : err.message,
      })
    }
  }) as T
}

