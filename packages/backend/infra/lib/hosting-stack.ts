import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';

export interface HostingStackProps extends cdk.StackProps {
  /** Deployment environment (dev, prod). Used to derive the API Gateway stage. */
  environment?: string;
  /**
   * The REST API to forward `/api/*` requests to. When provided, both the
   * Admin Portal and Landing Page distributions get an `/api/*` behavior that
   * proxies to the API Gateway execute-api origin, so relative-path requests
   * from a deployed frontend reach the backend instead of the SPA index.html.
   */
  api?: apigateway.RestApi;
}

/**
 * HostingStack creates S3 buckets + CloudFront distributions
 * for the Admin Portal and Landing Page static sites.
 */
export class HostingStack extends cdk.Stack {
  public readonly adminPortalBucket: s3.Bucket;
  public readonly landingPageBucket: s3.Bucket;
  public readonly adminPortalDistribution: cloudfront.Distribution;
  public readonly landingPageDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: HostingStackProps) {
    super(scope, id, props);

    const environment = props?.environment || this.node.tryGetContext('environment') || 'dev';
    const isProd = environment === 'prod';

    // Existing distributions may be subscribed to a CloudFront pricing plan
    // (Security Savings Bundle), which requires a WAF web ACL to stay attached.
    // CloudFormation rejects updates that would drop it, so allow the existing
    // web ACL ARN(s) to be supplied via CDK context and preserved on update:
    //   cdk deploy ... -c webAclId=<arn>            (both distributions)
    //   cdk deploy ... -c adminWebAclId=<arn> -c landingWebAclId=<arn>
    const defaultWebAclId = this.node.tryGetContext('webAclId') as string | undefined;
    const adminWebAclId =
      (this.node.tryGetContext('adminWebAclId') as string | undefined) || defaultWebAclId;
    const landingWebAclId =
      (this.node.tryGetContext('landingWebAclId') as string | undefined) || defaultWebAclId;

    // ─── Admin Portal Bucket ──────────────────────────────────────────────
    this.adminPortalBucket = new s3.Bucket(this, 'AdminPortalBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ─── Landing Page Bucket ──────────────────────────────────────────────
    this.landingPageBucket = new s3.Bucket(this, 'LandingPageBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ─── API Gateway `/api/*` proxy (shared by both distributions) ───────
    // CloudFront receives requests as `/api/<path>`. The execute-api origin
    // expects `/<stage>/<path>` (e.g. `/dev/leads`). We use `originPath` to
    // prepend the stage, and a CloudFront viewer-request Function to strip the
    // leading `/api` segment, so `/api/leads` → origin `/dev/leads`.
    let apiOrigin: origins.HttpOrigin | undefined;
    let apiBehavior: cloudfront.BehaviorOptions | undefined;
    let apiBehaviors: Record<string, cloudfront.BehaviorOptions> = {};

    if (props?.api) {
      const api = props.api;
      // execute-api regional domain: <restApiId>.execute-api.<region>.amazonaws.com
      const apiDomain = `${api.restApiId}.execute-api.${this.region}.amazonaws.com`;

      apiOrigin = new origins.HttpOrigin(apiDomain, {
        originPath: `/${environment}`,
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      });

      // Strip the leading `/api` prefix from the URI before it reaches the
      // origin (which already gets the stage prepended via originPath).
      const stripApiPrefixFn = new cloudfront.Function(this, 'StripApiPrefixFn', {
        code: cloudfront.FunctionCode.fromInline(
          [
            'function handler(event) {',
            '  var request = event.request;',
            "  if (request.uri.startsWith('/api/')) {",
            "    request.uri = request.uri.substring(4);",
            "  } else if (request.uri === '/api') {",
            "    request.uri = '/';",
            '  }',
            '  return request;',
            '}',
          ].join('\n')
        ),
        comment: `${environment} - strip /api prefix before API Gateway origin`,
      });

      apiBehavior = {
        origin: apiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Never cache API responses; forward everything the API needs.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Forward Authorization, tenant, and CORS headers plus query strings/body.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        functionAssociations: [
          {
            function: stripApiPrefixFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      };

      apiBehaviors = { '/api/*': apiBehavior };

      // NOTE: the distribution-level `errorResponses` below remap viewer-facing
      // 403/404 to `/index.html` for SPA client-side routing. These are
      // distribution-wide and also apply to `/api/*`. API Gateway auth
      // rejections surface as 401 (not remapped), so the primary connectivity
      // paths (leads → 201, authenticated GETs → 200) are unaffected. A Lambda
      // that returns a genuine 403/404 on an `/api/*` call would be served the
      // SPA index instead; if that becomes a problem, split the API onto its
      // own distribution or drop the SPA error-response remap. Out of scope for
      // this connectivity fix.
    }

    // ─── CloudFront — Admin Portal ───────────────────────────────────────
    this.adminPortalDistribution = new cloudfront.Distribution(this, 'AdminPortalCDN', {
      additionalBehaviors: apiBehaviors,
      ...(adminWebAclId ? { webAclId: adminWebAclId } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.adminPortalBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // SPA: redirect all 404s to index.html for client-side routing
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      comment: `${environment} - Admin Portal`,
    });

    // ─── CloudFront — Landing Page ───────────────────────────────────────
    this.landingPageDistribution = new cloudfront.Distribution(this, 'LandingPageCDN', {
      additionalBehaviors: apiBehaviors,
      ...(landingWebAclId ? { webAclId: landingWebAclId } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.landingPageBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      comment: `${environment} - Landing Page`,
    });

    // ─── Deploy Admin Portal (if dist exists) ────────────────────────────
    const adminDistPath = path.resolve(__dirname, '../../../admin-portal/dist');
    try {
      new s3deploy.BucketDeployment(this, 'DeployAdminPortal', {
        sources: [s3deploy.Source.asset(adminDistPath)],
        destinationBucket: this.adminPortalBucket,
        distribution: this.adminPortalDistribution,
        distributionPaths: ['/*'],
      });
    } catch {
      // dist folder may not exist yet — skip deployment
    }

    // ─── Deploy Landing Page (if dist exists) ────────────────────────────
    const landingDistPath = path.resolve(__dirname, '../../../landing-page/dist');
    try {
      new s3deploy.BucketDeployment(this, 'DeployLandingPage', {
        sources: [s3deploy.Source.asset(landingDistPath)],
        destinationBucket: this.landingPageBucket,
        distribution: this.landingPageDistribution,
        distributionPaths: ['/*'],
      });
    } catch {
      // dist folder may not exist yet — skip deployment
    }

    // ─── Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AdminPortalURL', {
      value: `https://${this.adminPortalDistribution.distributionDomainName}`,
      description: 'Admin Portal CloudFront URL',
    });

    new cdk.CfnOutput(this, 'LandingPageURL', {
      value: `https://${this.landingPageDistribution.distributionDomainName}`,
      description: 'Landing Page CloudFront URL',
    });

    new cdk.CfnOutput(this, 'AdminPortalBucketName', {
      value: this.adminPortalBucket.bucketName,
      description: 'Admin Portal S3 bucket name',
    });

    new cdk.CfnOutput(this, 'LandingPageBucketName', {
      value: this.landingPageBucket.bucketName,
      description: 'Landing Page S3 bucket name',
    });
  }
}
