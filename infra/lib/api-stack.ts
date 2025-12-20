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

    // 3) SNS Topic for error notifications
    const errorTopic = new sns.Topic(this, 'ErrorNotificationTopic', {
      displayName: 'Handwash API Error Notifications',
    })
    
    // メールアドレスが指定されている場合はサブスクリプションを追加
    if (props.alertEmail) {
      errorTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail)
      )
    }

    // 3) Lambda functions（TSをバンドル）
    const lambdaEnv = { 
      TABLE_NAME: table.tableName,
      ERROR_TOPIC_ARN: errorTopic.topicArn,
    }

    const meFn = new NodejsFunction(this, 'MeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'me.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE, // X-Rayトレーシングを有効化
      timeout: cdk.Duration.seconds(10),
    })

    const createFamilyFn = new NodejsFunction(this, 'CreateFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'create-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const listFamiliesFn = new NodejsFunction(this, 'ListFamiliesFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'list-families.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const joinFamilyFn = new NodejsFunction(this, 'JoinFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'join-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const createHandwashEventFn = new NodejsFunction(this, 'CreateHandwashEventFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'create-handwash-event.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const listHandwashEventsFn = new NodejsFunction(this, 'ListHandwashEventsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'list-handwash-events.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const pushSubscribeFn = new NodejsFunction(this, 'PushSubscribeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'push-subscribe.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const sendReminderFn = new NodejsFunction(this, 'SendReminderFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'send-reminder.ts'),
      handler: 'handler',
      environment: {
        ...lambdaEnv,
        VAPID_SECRET_NAME: vapidSecretName,
      },
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
    })

    const listFamilyMembersFn = new NodejsFunction(this, 'ListFamilyMembersFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'list-family-members.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const sendPushToUserFn = new NodejsFunction(this, 'SendPushToUserFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'send-push-to-user.ts'),
      handler: 'handler',
      environment: {
        ...lambdaEnv,
        VAPID_SECRET_NAME: vapidSecretName,
      },
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(30),
    })

    const leaveFamilyFn = new NodejsFunction(this, 'LeaveFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'leave-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
    })

    const deleteFamilyFn = new NodejsFunction(this, 'DeleteFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'delete-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(30),
    })

    const updateProfileFn = new NodejsFunction(this, 'UpdateProfileFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'update-profile.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(10),
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

    // SNS Topicへのパブリッシュ権限をすべてのLambda関数に付与
    errorTopic.grantPublish(meFn)
    errorTopic.grantPublish(createFamilyFn)
    errorTopic.grantPublish(listFamiliesFn)
    errorTopic.grantPublish(joinFamilyFn)
    errorTopic.grantPublish(createHandwashEventFn)
    errorTopic.grantPublish(listHandwashEventsFn)
    errorTopic.grantPublish(pushSubscribeFn)
    errorTopic.grantPublish(sendReminderFn)
    errorTopic.grantPublish(listFamilyMembersFn)
    errorTopic.grantPublish(sendPushToUserFn)
    errorTopic.grantPublish(leaveFamilyFn)
    errorTopic.grantPublish(deleteFamilyFn)
    errorTopic.grantPublish(updateProfileFn)

    // 5) EventBridge Scheduler for daily reminder (20:00 JST = 11:00 UTC)
    new events.Rule(this, 'ReminderSchedule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '11', // UTC 11:00 = JST 20:00
      }),
      targets: [new targets.LambdaFunction(sendReminderFn)],
    })

    // 6) WAF v2 WebACL
    const webAcl = new wafv2.CfnWebACL(this, 'ApiWebACL', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL', // API Gateway用
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'ApiWebACL',
      },
      rules: [
        // AWS Managed Rules - Core Rule Set
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
          },
        },
        // AWS Managed Rules - Known Bad Inputs
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'KnownBadInputs',
          },
        },
        // レート制限ルール（1分間に100リクエスト/IP）
        {
          name: 'RateLimitRule',
          priority: 0, // 最優先
          action: {
            block: {},
          },
          statement: {
            rateBasedStatement: {
              limit: 100, // 1分間あたり100リクエスト
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },
      ],
    })

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

    // WAFをAPI Gatewayにアタッチ（HTTP APIのStage ARN形式）
    // HTTP APIのStage ARNは arn:aws:apigateway:REGION::/apis/API_ID/stages/STAGE_NAME の形式
    // HTTP APIにはデフォルトで $default ステージが存在する
    const httpApiId = httpApi.apiId
    const httpApiStageArn = `arn:aws:apigateway:${this.region}::/apis/${httpApiId}/stages/$default`
    
    new wafv2.CfnWebACLAssociation(this, 'ApiWebACLAssociation', {
      resourceArn: httpApiStageArn,
      webAclArn: webAcl.attrArn,
    })

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

    // 9) CloudWatch Alarms
    // Lambda関数のエラー率監視
    const lambdaFunctions = [
      { name: 'Me', fn: meFn },
      { name: 'CreateFamily', fn: createFamilyFn },
      { name: 'ListFamilies', fn: listFamiliesFn },
      { name: 'JoinFamily', fn: joinFamilyFn },
      { name: 'CreateHandwashEvent', fn: createHandwashEventFn },
      { name: 'ListHandwashEvents', fn: listHandwashEventsFn },
      { name: 'PushSubscribe', fn: pushSubscribeFn },
      { name: 'SendReminder', fn: sendReminderFn },
      { name: 'ListFamilyMembers', fn: listFamilyMembersFn },
      { name: 'SendPushToUser', fn: sendPushToUserFn },
      { name: 'LeaveFamily', fn: leaveFamilyFn },
      { name: 'DeleteFamily', fn: deleteFamilyFn },
      { name: 'UpdateProfile', fn: updateProfileFn },
    ]

    lambdaFunctions.forEach(({ name, fn }) => {
      // エラー率アラーム（5分間で1回以上のエラー）
      const errorAlarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        metric: fn.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: 1, // 5分間で1回以上のエラー
        evaluationPeriods: 1,
        alarmDescription: `Error alarm for ${name} function`,
      })

      // レイテンシーアラーム（P99が3秒を超えた場合）
      const latencyAlarm = new cloudwatch.Alarm(this, `${name}LatencyAlarm`, {
        metric: fn.metricDuration({
          period: cdk.Duration.minutes(5),
          statistic: 'p99',
        }),
        threshold: 3000, // 3秒（ミリ秒）
        evaluationPeriods: 2,
        alarmDescription: `Latency alarm for ${name} function`,
      })

      // アラームが発火したらSNSに通知
      errorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(errorTopic))
      latencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(errorTopic))
    })

    // API Gatewayのエラー率監視
    const apiErrorAlarm = new cloudwatch.Alarm(this, 'ApiErrorRateAlarm', {
      metric: httpApi.metricClientError({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // 5分間で10回以上の4xxエラー
      evaluationPeriods: 1,
      alarmDescription: 'API Gateway client error rate alarm',
    })

    const apiServerErrorAlarm = new cloudwatch.Alarm(this, 'ApiServerErrorRateAlarm', {
      metric: httpApi.metricServerError({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5, // 5分間で5回以上の5xxエラー
      evaluationPeriods: 1,
      alarmDescription: 'API Gateway server error rate alarm',
    })

    apiErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(errorTopic))
    apiServerErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(errorTopic))

    // 10) Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName })
    new cdk.CfnOutput(this, 'ErrorTopicArn', { 
      value: errorTopic.topicArn,
      description: 'SNS Topic ARN for error notifications',
    })
  }
}
