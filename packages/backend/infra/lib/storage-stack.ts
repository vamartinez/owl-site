import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * StorageStack defines S3 buckets for the AI Construction Compliance Platform.
 *
 * Buckets:
 * - media-assets: Inspection images (max 25MB), certification documents (max 10MB)
 * - audit-storage: Immutable decision records (7-year regulatory retention)
 *
 * Requirements: 18.4, 14.4, 14.5
 */
export class StorageStack extends cdk.Stack {
  public readonly mediaBucket: s3.Bucket;
  public readonly auditBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || 'dev';
    const isProd = environment === 'prod';

    // --- Media Assets Bucket ---
    // Stores inspection images and certification documents.
    // Supports signed URL uploads with CORS configured for admin portal and landing page.
    this.mediaBucket = new s3.Bucket(this, 'MediaAssetsBucket', {
      // Let CDK auto-generate a unique bucket name to avoid global naming conflicts
      // bucketName: `${bucketPrefix}compliance-media`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: isProd
            ? [
                'https://admin.sitecompliance.ca',
                'https://www.sitecompliance.ca',
              ]
            : ['http://localhost:3000', 'http://localhost:5173'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag', 'x-amz-request-id'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: 'transition-infrequent-access',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
        {
          id: 'abort-incomplete-multipart',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // --- Audit Storage Bucket ---
    // Stores immutable decision records and explainability payloads.
    // Append-only: Object Lock in COMPLIANCE mode prevents modification/deletion.
    // 7-year retention per WorkSafeBC regulatory requirements (Req 12.5).
    this.auditBucket = new s3.Bucket(this, 'AuditStorageBucket', {
      // Let CDK auto-generate a unique bucket name to avoid global naming conflicts
      // bucketName: `${bucketPrefix}compliance-audit`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true, // Required for Object Lock; always enabled for audit
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Never auto-delete audit data
      enforceSSL: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: isProd
        ? s3.ObjectLockRetention.compliance(cdk.Duration.days(2557)) // ~7 years
        : s3.ObjectLockRetention.governance(cdk.Duration.days(30)), // 30 days for dev
      lifecycleRules: [
        {
          id: 'transition-glacier',
          enabled: isProd,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
        {
          id: 'abort-incomplete-multipart',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    // --- Stack Outputs ---
    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: this.mediaBucket.bucketName,
      description: 'S3 bucket for media assets (inspection images, certification docs)',
      exportName: `${environment}-media-bucket-name`,
    });

    new cdk.CfnOutput(this, 'MediaBucketArn', {
      value: this.mediaBucket.bucketArn,
      description: 'ARN of the media assets bucket',
      exportName: `${environment}-media-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'AuditBucketName', {
      value: this.auditBucket.bucketName,
      description: 'S3 bucket for immutable audit/decision records',
      exportName: `${environment}-audit-bucket-name`,
    });

    new cdk.CfnOutput(this, 'AuditBucketArn', {
      value: this.auditBucket.bucketArn,
      description: 'ARN of the audit storage bucket',
      exportName: `${environment}-audit-bucket-arn`,
    });
  }
}
