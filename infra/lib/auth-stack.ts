import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'

type Props = cdk.StackProps & {
  webDistributionDomain: string
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolClient: cognito.UserPoolClient

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const prodOrigin = `https://${props.webDistributionDomain}`

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 10,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ハッカソン/個人開発用。prodはRETAIN推奨
    })

    this.userPoolClient = this.userPool.addClient('WebClient', {
      generateSecret: false, // PWAなのでsecretなし（重要）
      authFlows: {
        userPassword: true,  // Step2の疎通テストを楽にするため
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          // Dev
          'http://localhost:5173/',
          'http://localhost:5173/wash/',
          'http://localhost:5173/mypage/',
          // Prod (CloudFront)
          `${prodOrigin}/`,
          `${prodOrigin}/wash/`,
          `${prodOrigin}/mypage/`,
        ],
        logoutUrls: [
          'http://localhost:5173/',
          'http://localhost:5173/wash/',
          'http://localhost:5173/mypage/',
          `${prodOrigin}/`,
          `${prodOrigin}/wash/`,
          `${prodOrigin}/mypage/`,
        ],
      },
    })

    // Hosted UI用ドメイン（任意だけど"企業っぽい"ので最初から作る）
    // domainPrefix はグローバル一意。被ったら変えてOK。
    const domain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: `handwash-${cdk.Names.uniqueId(this).toLowerCase().slice(-8)}` },
    })

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId })
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`,
    })
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId })
    new cdk.CfnOutput(this, 'Issuer', { value: this.userPool.userPoolProviderUrl })
  }
}

