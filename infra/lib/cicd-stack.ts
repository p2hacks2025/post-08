import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'

type Props = cdk.StackProps & {
  /**
   * GitHub リポジトリ (例: "p2hacks2025/post-08")
   */
  githubRepo: string
}

export class CicdStack extends cdk.Stack {
  public readonly webBucket: s3.Bucket
  public readonly distribution: cloudfront.Distribution
  public readonly deployRole: iam.Role

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    // =================================================================
    // 1) GitHub OIDC Provider（アカウントに1つだけ必要）
    // =================================================================
    // 既存のOIDCプロバイダーがあるかチェックして、なければ作成
    const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['ffffffffffffffffffffffffffffffffffffffff'], // GitHub Actionsは動的
    })

    // =================================================================
    // 2) GitHub Actions用 IAM Role (OIDC経由でAssumeRole)
    // =================================================================
    this.deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: 'handwash-github-actions-deploy',
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            // mainブランチからのみデプロイ可能に制限
            'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    })

    // CDKデプロイに必要な権限（AdministratorAccessは強すぎるので本番では絞る）
    // ハッカソン/個人開発では許容範囲
    this.deployRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
    )

    // =================================================================
    // 3) S3 Bucket (Webホスティング用)
    // =================================================================
    this.webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `handwash-web-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront経由のみ
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // スタック削除時にオブジェクトも削除
    })

    // =================================================================
    // 4) CloudFront Distribution
    // =================================================================
    // OAC (Origin Access Control) を使用
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    })

    this.distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.webBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // MPA: 各ディレクトリにindex.htmlがあるのでSPAフォールバックは不要
      // CloudFront Functionsでディレクトリアクセス時にindex.htmlを追加
    })

    // CloudFront Function: ディレクトリアクセス時に /index.html を追加
    const rewriteFunction = new cloudfront.Function(this, 'RewriteFunction', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  
  // URIが / で終わる場合は index.html を追加
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  }
  // 拡張子がない場合は /index.html を追加
  else if (!uri.includes('.')) {
    request.uri += '/index.html';
  }
  
  return request;
}
      `),
      functionName: 'HandwashRewriteFunction',
    })

    // CloudFront Distributionにfunctionを追加
    const cfnDistribution = this.webDistribution.node.defaultChild as cloudfront.CfnDistribution
    cfnDistribution.addPropertyOverride('DistributionConfig.DefaultCacheBehavior.FunctionAssociations', [
      {
        EventType: 'viewer-request',
        FunctionARN: rewriteFunction.functionArn,
      },
    ])

    // =================================================================
    // 5) Outputs
    // =================================================================
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: this.webBucket.bucketName,
      description: 'S3 bucket for web hosting',
    })

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    })

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront domain name (use this URL)',
    })

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.deployRole.roleArn,
      description: 'IAM Role ARN for GitHub Actions',
    })
  }
}

