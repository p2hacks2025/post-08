import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as wafv2 from 'aws-cdk-lib/aws-wafv2'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as path from 'path'
import * as logs from 'aws-cdk-lib/aws-logs'

type Props = cdk.StackProps & {
  userPool: cognito.UserPool
  userPoolClient: cognito.UserPoolClient
  webDistributionDomain: string
  alertEmail?: string // エラー通知用のメールアドレス（オプション）
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    // 1) DynamoDB table
    const table = new dynamodb.Table(this, 'AppTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 個人/ハッカソン用
    })

    // GSI for family -> subscriptions lookup
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    })

    // 2) VAPID Secret (既存のシークレットを参照、なければ手動で作成が必要)
    const vapidSecretName = 'handwash/vapid'
    const vapidSecret = secretsmanager.Secret.fromSecretNameV2(this, 'VapidSecret', vapidSecretName)

    // 3) SNS Topic for error notifications（オプション: メール通知が必要な場合のみ）
    const errorTopic = props.alertEmail ? new sns.Topic(this, 'ErrorNotificationTopic', {
      displayName: 'Handwash API Error Notifications',
    }) : undefined
    
    // メールアドレスが指定されている場合はサブスクリプションを追加
    if (props.alertEmail && errorTopic) {
      errorTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail)
      )
    }

    // 3) Lambda functions（コスト最適化: 最小限の設定）
    const lambdaEnv = { 
      TABLE_NAME: table.tableName,
      ...(errorTopic && { ERROR_TOPIC_ARN: errorTopic.topicArn }),
    }

    // 共通のLambda設定（極端に低コスト設定）
    const defaultLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      tracing: lambda.Tracing.DISABLED, // X-Ray完全無効化（コスト削減）
      timeout: cdk.Duration.seconds(5), // タイムアウトを短縮
      memorySize: 128, // 最小メモリサイズ
      logRetention: logs.RetentionDays.ONE_DAY, // ログ保持期間1日（コスト削減）
    }

    const meFn = new NodejsFunction(this, 'MeFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'me.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const createFamilyFn = new NodejsFunction(this, 'CreateFamilyFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'create-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const listFamiliesFn = new NodejsFunction(this, 'ListFamiliesFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'list-families.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const joinFamilyFn = new NodejsFunction(this, 'JoinFamilyFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'join-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const createHandwashEventFn = new NodejsFunction(this, 'CreateHandwashEventFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'create-handwash-event.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const listHandwashEventsFn = new NodejsFunction(this, 'ListHandwashEventsFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'list-handwash-events.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const pushSubscribeFn = new NodejsFunction(this, 'PushSubscribeFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'push-subscribe.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const sendReminderFn = new NodejsFunction(this, 'SendReminderFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'send-reminder.ts'),
      handler: 'handler',
      environment: {
        ...lambdaEnv,
        VAPID_SECRET_NAME: vapidSecretName,
      },
      timeout: cdk.Duration.minutes(2), // リマインダーは少し長め
      memorySize: 256, // リマインダーは少し多め
    })

    const listFamilyMembersFn = new NodejsFunction(this, 'ListFamilyMembersFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'list-family-members.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const sendPushToUserFn = new NodejsFunction(this, 'SendPushToUserFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'send-push-to-user.ts'),
      handler: 'handler',
      environment: {
        ...lambdaEnv,
        VAPID_SECRET_NAME: vapidSecretName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256, // プッシュ通知は少し多め
    })

    const leaveFamilyFn = new NodejsFunction(this, 'LeaveFamilyFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'leave-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const deleteFamilyFn = new NodejsFunction(this, 'DeleteFamilyFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'delete-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(10),
    })

    const updateProfileFn = new NodejsFunction(this, 'UpdateProfileFunction', {
      ...defaultLambdaProps,
      entry: path.join(__dirname, '..', 'lambda', 'update-profile.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    // 4) Permissions
    table.grantReadData(meFn)
    table.grantReadWriteData(createFamilyFn)
    table.grantReadWriteData(joinFamilyFn)
    table.grantReadData(listFamiliesFn)
    table.grantReadWriteData(createHandwashEventFn)
    table.grantReadData(listHandwashEventsFn)
    table.grantReadWriteData(pushSubscribeFn)
    table.grantReadWriteData(sendReminderFn)

    // VAPID秘密鍵への読み取り権限
    vapidSecret.grantRead(sendReminderFn)
    vapidSecret.grantRead(sendPushToUserFn)

    // メンバー一覧・通知送信
    table.grantReadData(listFamilyMembersFn)
    table.grantReadWriteData(sendPushToUserFn)

    // ファミリー退出・削除
    table.grantReadWriteData(leaveFamilyFn)
    table.grantReadWriteData(deleteFamilyFn)

    // プロファイル更新
    table.grantReadWriteData(updateProfileFn)

    // SNS Topicへのパブリッシュ権限（エラー通知がある場合のみ）
    if (errorTopic) {
      const lambdaFunctions = [
        meFn, createFamilyFn, listFamiliesFn, joinFamilyFn,
        createHandwashEventFn, listHandwashEventsFn, pushSubscribeFn,
        sendReminderFn, listFamilyMembersFn, sendPushToUserFn,
        leaveFamilyFn, deleteFamilyFn, updateProfileFn,
      ]
      lambdaFunctions.forEach(fn => errorTopic.grantPublish(fn))
    }

    // 5) EventBridge Scheduler for daily reminder (20:00 JST = 11:00 UTC)
    new events.Rule(this, 'ReminderSchedule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '11', // UTC 11:00 = JST 20:00
      }),
      targets: [new targets.LambdaFunction(sendReminderFn)],
    })

    // 6) WAF v2 WebACL
    // 注意: HTTP API (apigatewayv2) にはWAFを直接アタッチできません
    // WAFを使う場合は REST API (apigateway) に切り替える必要があります
    // または CloudFront + WAF (CLOUDFRONT scope) を前段に置く方法もあります
    // 一旦、WAF関連のコードはコメントアウトしてデプロイを通します
    // 
    // const webAcl = new wafv2.CfnWebACL(this, 'ApiWebACL', {
    //   defaultAction: { allow: {} },
    //   scope: 'REGIONAL', // API Gateway用
    //   visibilityConfig: {
    //     sampledRequestsEnabled: true,
    //     cloudWatchMetricsEnabled: true,
    //     metricName: 'ApiWebACL',
    //   },
    //   rules: [
    //     // AWS Managed Rules - Core Rule Set
    //     {
    //       name: 'AWSManagedRulesCommonRuleSet',
    //       priority: 1,
    //       overrideAction: { none: {} },
    //       statement: {
    //         managedRuleGroupStatement: {
    //           vendorName: 'AWS',
    //           name: 'AWSManagedRulesCommonRuleSet',
    //         },
    //       },
    //       visibilityConfig: {
    //         sampledRequestsEnabled: true,
    //         cloudWatchMetricsEnabled: true,
    //         metricName: 'CommonRuleSet',
    //       },
    //     },
    //     // AWS Managed Rules - Known Bad Inputs
    //     {
    //       name: 'AWSManagedRulesKnownBadInputsRuleSet',
    //       priority: 2,
    //       overrideAction: { none: {} },
    //       statement: {
    //         managedRuleGroupStatement: {
    //           vendorName: 'AWS',
    //           name: 'AWSManagedRulesKnownBadInputsRuleSet',
    //         },
    //       },
    //       visibilityConfig: {
    //         sampledRequestsEnabled: true,
    //         cloudWatchMetricsEnabled: true,
    //         metricName: 'KnownBadInputs',
    //       },
    //     },
    //     // レート制限ルール（1分間に100リクエスト/IP）
    //     {
    //       name: 'RateLimitRule',
    //       priority: 0, // 最優先
    //       action: {
    //         block: {},
    //       },
    //       statement: {
    //         rateBasedStatement: {
    //           limit: 100, // 1分間あたり100リクエスト
    //           aggregateKeyType: 'IP',
    //         },
    //       },
    //       visibilityConfig: {
    //         sampledRequestsEnabled: true,
    //         cloudWatchMetricsEnabled: true,
    //         metricName: 'RateLimitRule',
    //       },
    //     },
    //   ],
    // })

    // 6) HTTP API
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: [
          'http://localhost:5173',
          `https://${props.webDistributionDomain}`,
        ],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type'],
      },
    })

    // HTTP API Stage（極端に低いスロットリング設定）
    // 既存の$defaultステージを更新するため、CfnStageを使用
    const httpStage = new apigwv2.CfnStage(this, 'HttpStage', {
      apiId: httpApi.apiId,
      stageName: '$default',
      // 極端に低いスロットリング: 1秒あたり2リクエスト、バースト5
      defaultRouteSettings: {
        throttlingRateLimit: 2,      // 1秒あたり2リクエスト（過剰リクエストを完全にブロック）
        throttlingBurstLimit: 5,     // バースト時5リクエスト
      },
    })

    // WAFをAPI Gatewayにアタッチ
    // 注意: HTTP API (apigatewayv2) にはWAFを直接アタッチできません
    // WAFを使う場合は REST API (apigateway) に切り替える必要があります
    // または CloudFront + WAF (CLOUDFRONT scope) を前段に置く方法もあります
    // 一旦、WAF Associationはコメントアウトしてデプロイを通します
    // 
    // const httpApiId = httpApi.apiId
    // const httpApiStageArn = `arn:aws:apigateway:${this.region}::/apis/${httpApiId}/stages/$default`
    // 
    // new wafv2.CfnWebACLAssociation(this, 'ApiWebACLAssociation', {
    //   resourceArn: httpApiStageArn,
    //   webAclArn: webAcl.attrArn,
    // })

    // 7) JWT Authorizer
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      'JwtAuth',
      props.userPool.userPoolProviderUrl,
      { jwtAudience: [props.userPoolClient.userPoolClientId] },
    )

    // 8) Routes
    httpApi.addRoutes({
      path: '/me',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('MeIntegration', meFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/families',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('CreateFamilyIntegration', createFamilyFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/families',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ListFamiliesIntegration', listFamiliesFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/families/join',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('JoinFamilyIntegration', joinFamilyFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/handwash/events',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('CreateHandwashEventIntegration', createHandwashEventFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/handwash/events',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ListHandwashEventsIntegration', listHandwashEventsFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/push/subscribe',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('PushSubscribeIntegration', pushSubscribeFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/families/members',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ListFamilyMembersIntegration', listFamilyMembersFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/push/send',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('SendPushToUserIntegration', sendPushToUserFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/families/leave',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('LeaveFamilyIntegration', leaveFamilyFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/families/delete',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('DeleteFamilyIntegration', deleteFamilyFn),
      authorizer: jwtAuthorizer,
    })

    httpApi.addRoutes({
      path: '/profile',
      methods: [apigwv2.HttpMethod.PUT],
      integration: new integrations.HttpLambdaIntegration('UpdateProfileIntegration', updateProfileFn),
      authorizer: jwtAuthorizer,
    })

    // 9) CloudWatch Alarms（最小限に削減: エラー通知がある場合のみ）
    // 利用されない予定なので、アラームは最小限に（または完全に無効化）
    if (errorTopic) {
      // 重大なエラーのみ監視（API Gatewayの5xxエラーのみ）
      const apiServerErrorAlarm = new cloudwatch.Alarm(this, 'ApiServerErrorRateAlarm', {
        metric: httpApi.metricServerError({
          period: cdk.Duration.minutes(15), // 評価頻度を下げる
          statistic: 'Sum',
        }),
        threshold: 10, // 15分間で10回以上の5xxエラー
        evaluationPeriods: 1,
        alarmDescription: 'API Gateway server error rate alarm',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })

      apiServerErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(errorTopic))
    }

    // 10) Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName })
    if (errorTopic) {
      new cdk.CfnOutput(this, 'ErrorTopicArn', { 
        value: errorTopic.topicArn,
        description: 'SNS Topic ARN for error notifications',
      })
    }
  }
}
