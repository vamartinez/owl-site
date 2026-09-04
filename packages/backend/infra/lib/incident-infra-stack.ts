import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * IncidentInfraStack defines infrastructure for the Incident Reporting module:
 *
 * - S3 bucket `incident-evidence` for evidence uploads (photos, videos, PDFs)
 *   with lifecycle rules and CORS configured for presigned PUT uploads.
 * - EventBridge custom event bus and rules for incident domain events:
 *   `incident.created`, `incident.updated`, `regulatory.immediate_notification`
 * - IAM role for EventBridge Scheduler to invoke notification targets for
 *   deadline-based notifications (8h OSHA, 24h OSHA, 72h WorkSafeBC).
 *
 * Requirements: 12.4, 18.1, 18.2, 18.3
 */
export class IncidentInfraStack extends cdk.Stack {
  /** S3 bucket for incident evidence (photos, videos, PDFs) */
  public readonly incidentEvidenceBucket: s3.Bucket;

  /** EventBridge custom event bus for incident domain events */
  public readonly incidentEventBus: events.EventBus;

  /** EventBridge rule for incident.created events */
  public readonly incidentCreatedRule: events.Rule;

  /** EventBridge rule for incident.updated events */
  public readonly incidentUpdatedRule: events.Rule;

  /** EventBridge rule for regulatory.immediate_notification events */
  public readonly regulatoryImmediateRule: events.Rule;

  /** IAM role for EventBridge Scheduler to invoke notification targets */
  public readonly schedulerRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || 'dev';
    const isProd = environment === 'prod';
    const prefix = isProd ? '' : `${environment}-`;

    // ─── S3 Bucket: Incident Evidence ─────────────────────────────────────────
    // Stores photos (JPEG, PNG, HEIC), short videos (MP4, MOV), and documents (PDF).
    // Max file size: 50 MB. Max video duration: 60 seconds (enforced at application layer).
    // Supports presigned PUT uploads from the admin portal.
    this.incidentEvidenceBucket = new s3.Bucket(this, 'IncidentEvidenceBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: isProd
            ? [
                'https://admin.sitecompliance.ca',
                'https://www.sitecompliance.ca',
              ]
            : ['http://localhost:3000', 'http://localhost:5173'],
          allowedHeaders: [
            'Content-Type',
            'Content-Length',
            'x-amz-content-sha256',
            'x-amz-date',
            'Authorization',
          ],
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
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(3),
        },
        {
          id: 'expire-unconfirmed-uploads',
          enabled: true,
          prefix: 'pending/',
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // ─── EventBridge: Incident Event Bus ──────────────────────────────────────
    // Custom event bus for incident domain events. Decouples incident-service
    // from notification-service and other downstream consumers.
    this.incidentEventBus = new events.EventBus(this, 'IncidentEventBus', {
      eventBusName: `${prefix}incident-events`,
    });

    // ─── EventBridge Rule: incident.created ───────────────────────────────────
    // Triggers notification-service when a new incident is created.
    // Matches events with detail-type "incident.created" on the incident bus.
    // Requirement 18.1: Send notification to Safety_Supervisor and Compliance_Reviewer
    // when incident is created with Critical severity.
    this.incidentCreatedRule = new events.Rule(this, 'IncidentCreatedRule', {
      eventBus: this.incidentEventBus,
      ruleName: `${prefix}incident-created`,
      description: 'Routes incident.created events to notification service for alerting',
      eventPattern: {
        source: ['incident-service'],
        detailType: ['incident.created'],
      },
      enabled: true,
    });

    // ─── EventBridge Rule: incident.updated ───────────────────────────────────
    // Triggers notification-service when an incident is updated (state change,
    // severity change, regulatory flag change, etc.).
    // Requirement 18.2: Send notification when regulatory engine determines
    // incident is potentially/immediately reportable.
    this.incidentUpdatedRule = new events.Rule(this, 'IncidentUpdatedRule', {
      eventBus: this.incidentEventBus,
      ruleName: `${prefix}incident-updated`,
      description: 'Routes incident.updated events to notification service',
      eventPattern: {
        source: ['incident-service'],
        detailType: ['incident.updated'],
      },
      enabled: true,
    });

    // ─── EventBridge Rule: regulatory.immediate_notification ──────────────────
    // Triggers immediate notification workflow when an incident is flagged as
    // "immediately_reportable". This creates urgency-based alerts and schedules
    // deadline reminders via EventBridge Scheduler.
    // Requirement 18.3: Reminder notifications for stale incidents.
    this.regulatoryImmediateRule = new events.Rule(this, 'RegulatoryImmediateRule', {
      eventBus: this.incidentEventBus,
      ruleName: `${prefix}regulatory-immediate-notification`,
      description: 'Routes regulatory immediate notification events for urgent alerting and deadline scheduling',
      eventPattern: {
        source: ['incident-service'],
        detailType: ['regulatory.immediate_notification'],
      },
      enabled: true,
    });

    // ─── IAM Role: EventBridge Scheduler ──────────────────────────────────────
    // Used by EventBridge Scheduler to invoke notification targets (Lambda, SNS)
    // when regulatory deadlines are reached (8h OSHA fatality, 24h OSHA
    // hospitalization, 72h WorkSafeBC employer report).
    this.schedulerRole = new iam.Role(this, 'IncidentSchedulerRole', {
      roleName: `${prefix}incident-scheduler-role`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke notification targets for incident deadline reminders',
    });

    // Grant the scheduler role permission to invoke Lambda functions
    // (notification-service will be the target for deadline reminders)
    this.schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeLambdaTargets',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:${prefix}notification-service*`,
        ],
      }),
    );

    // Grant the scheduler role permission to publish to the incident event bus
    // (for re-publishing deadline events if needed)
    this.schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PutEventsToIncidentBus',
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [this.incidentEventBus.eventBusArn],
      }),
    );

    // ─── Stack Outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'IncidentEvidenceBucketName', {
      value: this.incidentEvidenceBucket.bucketName,
      description: 'S3 bucket for incident evidence (photos, videos, PDFs)',
      exportName: `${prefix}incident-evidence-bucket-name`,
    });

    new cdk.CfnOutput(this, 'IncidentEvidenceBucketArn', {
      value: this.incidentEvidenceBucket.bucketArn,
      description: 'ARN of the incident evidence bucket',
      exportName: `${prefix}incident-evidence-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'IncidentEventBusName', {
      value: this.incidentEventBus.eventBusName,
      description: 'EventBridge event bus for incident domain events',
      exportName: `${prefix}incident-event-bus-name`,
    });

    new cdk.CfnOutput(this, 'IncidentEventBusArn', {
      value: this.incidentEventBus.eventBusArn,
      description: 'ARN of the incident event bus',
      exportName: `${prefix}incident-event-bus-arn`,
    });

    new cdk.CfnOutput(this, 'IncidentSchedulerRoleArn', {
      value: this.schedulerRole.roleArn,
      description: 'IAM role ARN for EventBridge Scheduler deadline notifications',
      exportName: `${prefix}incident-scheduler-role-arn`,
    });
  }
}
