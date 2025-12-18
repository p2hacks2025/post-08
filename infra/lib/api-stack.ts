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
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as path from 'path'

type Props = cdk.StackProps & {
  userPool: cognito.UserPool
  userPoolClient: cognito.UserPoolClient
  webDistributionDomain: string
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

    // 3) Lambda functions（TSをバンドル）
    const lambdaEnv = { TABLE_NAME: table.tableName }

    const meFn = new NodejsFunction(this, 'MeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'me.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const createFamilyFn = new NodejsFunction(this, 'CreateFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'create-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const listFamiliesFn = new NodejsFunction(this, 'ListFamiliesFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'list-families.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const joinFamilyFn = new NodejsFunction(this, 'JoinFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'join-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const createHandwashEventFn = new NodejsFunction(this, 'CreateHandwashEventFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'create-handwash-event.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const listHandwashEventsFn = new NodejsFunction(this, 'ListHandwashEventsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'list-handwash-events.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const pushSubscribeFn = new NodejsFunction(this, 'PushSubscribeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'push-subscribe.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const sendReminderFn = new NodejsFunction(this, 'SendReminderFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'send-reminder.ts'),
      handler: 'handler',
      environment: {
        ...lambdaEnv,
        VAPID_SECRET_NAME: vapidSecretName,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
    })

    const listFamilyMembersFn = new NodejsFunction(this, 'ListFamilyMembersFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'list-family-members.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const sendPushToUserFn = new NodejsFunction(this, 'SendPushToUserFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'send-push-to-user.ts'),
      handler: 'handler',
      environment: {
        ...lambdaEnv,
        VAPID_SECRET_NAME: vapidSecretName,
      },
      timeout: cdk.Duration.seconds(30),
    })

    const leaveFamilyFn = new NodejsFunction(this, 'LeaveFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'leave-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
    })

    const deleteFamilyFn = new NodejsFunction(this, 'DeleteFamilyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'delete-family.ts'),
      handler: 'handler',
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
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

    // 5) EventBridge Scheduler for daily reminder (20:00 JST = 11:00 UTC)
    new events.Rule(this, 'ReminderSchedule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '11', // UTC 11:00 = JST 20:00
      }),
      targets: [new targets.LambdaFunction(sendReminderFn)],
    })

    // 6) HTTP API
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: [
          'http://localhost:5173',
          `https://${props.webDistributionDomain}`,
        ],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type'],
      },
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

    // 9) Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName })
  }
}
