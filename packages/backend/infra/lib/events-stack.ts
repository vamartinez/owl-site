import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface EventsStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Events Stack — SQS/SNS infrastructure for the AI Construction Compliance Platform.
 *
 * Defines SNS topics for event publishing and SQS queues for async processing.
 * Each processing queue has a dead-letter queue (maxReceiveCount: 3).
 * Event delivery targets at-least-once semantics within 10 seconds.
 *
 * Requirements: 11.1, 11.4, 11.7, 18.5, 18.8, 18.14
 */
export class EventsStack extends cdk.Stack {
  /** SNS topic for platform-wide event publishing */
  public readonly platformEventsTopic: sns.Topic;

  /** AI pipeline processing queue */
  public readonly aiPipelineQueue: sqs.Queue;
  /** AI pipeline dead-letter queue */
  public readonly aiPipelineDlq: sqs.Queue;

  /** Certification expiry processing queue */
  public readonly certExpiryQueue: sqs.Queue;
  /** Certification expiry dead-letter queue */
  public readonly certExpiryDlq: sqs.Queue;

  /** Notification dispatch queue */
  public readonly notificationQueue: sqs.Queue;
  /** Notification dead-letter queue */
  public readonly notificationDlq: sqs.Queue;

  /** Reporting processing queue */
  public readonly reportingQueue: sqs.Queue;
  /** Reporting dead-letter queue */
  public readonly reportingDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const prefix = environment === 'prod' ? '' : `${environment}-`;

    // ─── SNS Topics ───────────────────────────────────────────────────────────

    this.platformEventsTopic = new sns.Topic(this, 'PlatformEventsTopic', {
      topicName: `${prefix}platform-events`,
      displayName: 'AI Construction Compliance Platform Events',
    });

    // ─── Dead-Letter Queues ───────────────────────────────────────────────────

    this.aiPipelineDlq = new sqs.Queue(this, 'AiPipelineDlq', {
      queueName: `${prefix}ai-pipeline-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.certExpiryDlq = new sqs.Queue(this, 'CertExpiryDlq', {
      queueName: `${prefix}cert-expiry-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.notificationDlq = new sqs.Queue(this, 'NotificationDlq', {
      queueName: `${prefix}notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.reportingDlq = new sqs.Queue(this, 'ReportingDlq', {
      queueName: `${prefix}reporting-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // ─── Processing Queues ────────────────────────────────────────────────────

    this.aiPipelineQueue = new sqs.Queue(this, 'AiPipelineQueue', {
      queueName: `${prefix}ai-pipeline-queue`,
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.aiPipelineDlq,
        maxReceiveCount: 3,
      },
    });

    this.certExpiryQueue = new sqs.Queue(this, 'CertExpiryQueue', {
      queueName: `${prefix}cert-expiry-queue`,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.certExpiryDlq,
        maxReceiveCount: 3,
      },
    });

    this.notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: `${prefix}notification-queue`,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.notificationDlq,
        maxReceiveCount: 3,
      },
    });

    this.reportingQueue = new sqs.Queue(this, 'ReportingQueue', {
      queueName: `${prefix}reporting-queue`,
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.reportingDlq,
        maxReceiveCount: 3,
      },
    });

    // ─── SNS → SQS Subscriptions ─────────────────────────────────────────────
    // Route events to appropriate queues based on filter policies.

    this.platformEventsTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(this.aiPipelineQueue, {
        rawMessageDelivery: true,
        filterPolicy: {
          event_type: sns.SubscriptionFilter.stringFilter({
            allowlist: [
              'InspectionUploaded',
              'DetectionCompleted',
              'SceneClassified',
            ],
          }),
        },
      }),
    );

    this.platformEventsTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(this.certExpiryQueue, {
        rawMessageDelivery: true,
        filterPolicy: {
          event_type: sns.SubscriptionFilter.stringFilter({
            allowlist: [
              'CertificationExpired',
              'CertificationValidated',
            ],
          }),
        },
      }),
    );

    this.platformEventsTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(this.notificationQueue, {
        rawMessageDelivery: true,
        filterPolicy: {
          event_type: sns.SubscriptionFilter.stringFilter({
            allowlist: [
              'WorkerCreated',
              'CertificationUploaded',
              'CertificationExpired',
              'AccessDecisionGenerated',
              'FindingGenerated',
              'FindingReviewed',
              'DailyComplianceSummaryGenerated',
            ],
          }),
        },
      }),
    );

    this.platformEventsTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(this.reportingQueue, {
        rawMessageDelivery: true,
        filterPolicy: {
          event_type: sns.SubscriptionFilter.stringFilter({
            allowlist: [
              'DailyComplianceSummaryRequested',
              'FindingGenerated',
              'FindingReviewed',
              'AccessDecisionGenerated',
            ],
          }),
        },
      }),
    );

    // ─── Stack Outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'PlatformEventsTopicArn', {
      value: this.platformEventsTopic.topicArn,
      description: 'ARN of the platform events SNS topic',
      exportName: `${prefix}platform-events-topic-arn`,
    });

    new cdk.CfnOutput(this, 'AiPipelineQueueUrl', {
      value: this.aiPipelineQueue.queueUrl,
      description: 'URL of the AI pipeline SQS queue',
      exportName: `${prefix}ai-pipeline-queue-url`,
    });

    new cdk.CfnOutput(this, 'CertExpiryQueueUrl', {
      value: this.certExpiryQueue.queueUrl,
      description: 'URL of the certification expiry SQS queue',
      exportName: `${prefix}cert-expiry-queue-url`,
    });

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: this.notificationQueue.queueUrl,
      description: 'URL of the notification SQS queue',
      exportName: `${prefix}notification-queue-url`,
    });

    new cdk.CfnOutput(this, 'ReportingQueueUrl', {
      value: this.reportingQueue.queueUrl,
      description: 'URL of the reporting SQS queue',
      exportName: `${prefix}reporting-queue-url`,
    });

    new cdk.CfnOutput(this, 'AiPipelineDlqUrl', {
      value: this.aiPipelineDlq.queueUrl,
      description: 'URL of the AI pipeline dead-letter queue',
      exportName: `${prefix}ai-pipeline-dlq-url`,
    });

    new cdk.CfnOutput(this, 'CertExpiryDlqUrl', {
      value: this.certExpiryDlq.queueUrl,
      description: 'URL of the certification expiry dead-letter queue',
      exportName: `${prefix}cert-expiry-dlq-url`,
    });

    new cdk.CfnOutput(this, 'NotificationDlqUrl', {
      value: this.notificationDlq.queueUrl,
      description: 'URL of the notification dead-letter queue',
      exportName: `${prefix}notification-dlq-url`,
    });

    new cdk.CfnOutput(this, 'ReportingDlqUrl', {
      value: this.reportingDlq.queueUrl,
      description: 'URL of the reporting dead-letter queue',
      exportName: `${prefix}reporting-dlq-url`,
    });
  }
}
