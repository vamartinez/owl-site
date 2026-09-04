import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Monitoring Stack — CloudWatch alarms, log groups, and dashboards for the
 * AI Construction Compliance Platform.
 *
 * Alarms:
 * - Lambda function errors (any service)
 * - DLQ message count > 0
 * - API Gateway 5xx error rate
 * - Lambda duration exceeding 10 seconds
 *
 * Log groups use environment-prefixed naming for isolation between environments.
 *
 * Requirements: 18.7, 18.14
 */
export class MonitoringStack extends cdk.Stack {
  /** CloudWatch dashboard for operational overview */
  public readonly dashboard: cloudwatch.Dashboard;

  /** Lambda errors alarm */
  public readonly lambdaErrorsAlarm: cloudwatch.Alarm;
  /** DLQ messages alarm */
  public readonly dlqMessagesAlarm: cloudwatch.Alarm;
  /** API Gateway 5xx alarm */
  public readonly apiGateway5xxAlarm: cloudwatch.Alarm;
  /** Lambda duration alarm */
  public readonly lambdaDurationAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const prefix = environment === 'prod' ? '' : `${environment}-`;

    // Service names matching the Lambda function naming convention
    const serviceNames = [
      'decision-engine',
      'policy',
      'identity',
      'access',
      'ai-orchestration',
      'detection',
      'scene-understanding',
      'regulatory-mapping',
      'reporting',
      'notification',
      'sync',
      'contractors',
    ];

    // DLQ names matching the events stack naming convention
    const dlqNames = [
      'ai-pipeline-dlq',
      'cert-expiry-dlq',
      'notification-dlq',
      'reporting-dlq',
    ];

    // ─── Log Groups ───────────────────────────────────────────────────────────
    // Each Lambda service gets a dedicated log group with environment-prefixed naming.

    serviceNames.forEach(
      (serviceName) =>
        new logs.LogGroup(this, `LogGroup-${serviceName}`, {
          logGroupName: `/aws/lambda/${prefix}compliance-${serviceName}`,
          retention: environment === 'prod'
            ? logs.RetentionDays.ONE_YEAR
            : logs.RetentionDays.ONE_WEEK,
          removalPolicy: environment === 'prod'
            ? cdk.RemovalPolicy.RETAIN
            : cdk.RemovalPolicy.DESTROY,
        }),
    );

    // Scheduled function log groups
    const scheduledFunctions = ['cert-expiry-checker', 'daily-summary-trigger'];
    scheduledFunctions.forEach((fnName) => {
      new logs.LogGroup(this, `LogGroup-${fnName}`, {
        logGroupName: `/aws/lambda/${prefix}compliance-${fnName}`,
        retention: environment === 'prod'
          ? logs.RetentionDays.ONE_YEAR
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: environment === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      });
    });

    // API Gateway log group
    new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: `/aws/apigateway/${prefix}compliance-api`,
      retention: environment === 'prod'
        ? logs.RetentionDays.ONE_YEAR
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // ─── Alarms ───────────────────────────────────────────────────────────────

    // Alarm: Lambda errors across all compliance services
    // CloudWatch math expressions support max 10 metrics, so we use a namespace-level metric.
    const lambdaErrorsMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    this.lambdaErrorsAlarm = new cloudwatch.Alarm(this, 'LambdaErrorsAlarm', {
      alarmName: `${prefix}compliance-lambda-errors`,
      alarmDescription: 'Triggers when any compliance Lambda function reports errors',
      metric: lambdaErrorsMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: DLQ message count > 0
    // Any message landing in a DLQ indicates a processing failure that needs attention.
    const dlqMetrics: Record<string, cloudwatch.IMetric> = {};
    dlqNames.forEach((dlqName, index) => {
      dlqMetrics[`d${index}`] = new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: {
          QueueName: `${prefix}${dlqName}`,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });
    });

    const dlqMessagesMathExpression = new cloudwatch.MathExpression({
      expression: dlqNames.map((_, i) => `d${i}`).join(' + '),
      usingMetrics: dlqMetrics,
      period: cdk.Duration.minutes(5),
      label: 'Total DLQ Messages',
    });

    this.dlqMessagesAlarm = new cloudwatch.Alarm(this, 'DlqMessagesAlarm', {
      alarmName: `${prefix}compliance-dlq-messages`,
      alarmDescription: 'Triggers when any dead-letter queue has messages (processing failures)',
      metric: dlqMessagesMathExpression,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: API Gateway 5xx error rate
    const apiGateway5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: `${prefix}compliance-api`,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    this.apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: `${prefix}compliance-api-5xx`,
      alarmDescription: 'Triggers when API Gateway returns 5xx errors',
      metric: apiGateway5xxMetric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: Lambda duration exceeding 10 seconds
    // Uses the maximum duration across all Lambda functions.
    const lambdaDurationMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
    });

    this.lambdaDurationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      alarmName: `${prefix}compliance-lambda-duration`,
      alarmDescription: 'Triggers when any Lambda function duration exceeds 10 seconds',
      metric: lambdaDurationMetric,
      threshold: 10000, // 10 seconds in milliseconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ─── Dashboard ────────────────────────────────────────────────────────────

    this.dashboard = new cloudwatch.Dashboard(this, 'OperationalDashboard', {
      dashboardName: `${prefix}compliance-operations`,
    });

    // Row 1: Lambda Invocations and Errors
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: serviceNames.map(
          (serviceName) =>
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Invocations',
              dimensionsMap: {
                FunctionName: `${prefix}compliance-${serviceName}`,
              },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
        ),
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: serviceNames.map(
          (serviceName) =>
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Errors',
              dimensionsMap: {
                FunctionName: `${prefix}compliance-${serviceName}`,
              },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
        ),
        width: 12,
        height: 6,
      }),
    );

    // Row 2: Lambda Duration and Throttles
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (p99)',
        left: serviceNames.map(
          (serviceName) =>
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Duration',
              dimensionsMap: {
                FunctionName: `${prefix}compliance-${serviceName}`,
              },
              statistic: 'p99',
              period: cdk.Duration.minutes(5),
            }),
        ),
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Throttles',
        left: serviceNames.map(
          (serviceName) =>
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Throttles',
              dimensionsMap: {
                FunctionName: `${prefix}compliance-${serviceName}`,
              },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
        ),
        width: 12,
        height: 6,
      }),
    );

    // Row 3: API Gateway metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiName: `${prefix}compliance-api` },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Latency',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: `${prefix}compliance-api` },
            statistic: 'p50',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: `${prefix}compliance-api` },
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Errors (4xx / 5xx)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4XXError',
            dimensionsMap: { ApiName: `${prefix}compliance-api` },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: { ApiName: `${prefix}compliance-api` },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 6,
      }),
    );

    // Row 4: SQS Queue Depths (processing queues and DLQs)
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SQS Queue Depth (Processing)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/SQS',
            metricName: 'ApproximateNumberOfMessagesVisible',
            dimensionsMap: { QueueName: `${prefix}ai-pipeline-queue` },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/SQS',
            metricName: 'ApproximateNumberOfMessagesVisible',
            dimensionsMap: { QueueName: `${prefix}cert-expiry-queue` },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/SQS',
            metricName: 'ApproximateNumberOfMessagesVisible',
            dimensionsMap: { QueueName: `${prefix}notification-queue` },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/SQS',
            metricName: 'ApproximateNumberOfMessagesVisible',
            dimensionsMap: { QueueName: `${prefix}reporting-queue` },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Dead-Letter Queue Messages',
        left: dlqNames.map(
          (dlqName) =>
            new cloudwatch.Metric({
              namespace: 'AWS/SQS',
              metricName: 'ApproximateNumberOfMessagesVisible',
              dimensionsMap: { QueueName: `${prefix}${dlqName}` },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
        ),
        width: 12,
        height: 6,
      }),
    );

    // Row 5: Alarm status widget
    this.dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarm Status',
        alarms: [
          this.lambdaErrorsAlarm,
          this.dlqMessagesAlarm,
          this.apiGateway5xxAlarm,
          this.lambdaDurationAlarm,
        ],
        width: 24,
        height: 3,
      }),
    );

    // ─── Stack Outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'DashboardName', {
      value: this.dashboard.dashboardName,
      description: 'CloudWatch dashboard for operational monitoring',
      exportName: `${prefix}compliance-dashboard-name`,
    });

    new cdk.CfnOutput(this, 'LambdaErrorsAlarmArn', {
      value: this.lambdaErrorsAlarm.alarmArn,
      description: 'ARN of the Lambda errors alarm',
      exportName: `${prefix}compliance-lambda-errors-alarm-arn`,
    });

    new cdk.CfnOutput(this, 'DlqMessagesAlarmArn', {
      value: this.dlqMessagesAlarm.alarmArn,
      description: 'ARN of the DLQ messages alarm',
      exportName: `${prefix}compliance-dlq-messages-alarm-arn`,
    });

    new cdk.CfnOutput(this, 'ApiGateway5xxAlarmArn', {
      value: this.apiGateway5xxAlarm.alarmArn,
      description: 'ARN of the API Gateway 5xx alarm',
      exportName: `${prefix}compliance-api-5xx-alarm-arn`,
    });

    new cdk.CfnOutput(this, 'LambdaDurationAlarmArn', {
      value: this.lambdaDurationAlarm.alarmArn,
      description: 'ARN of the Lambda duration alarm',
      exportName: `${prefix}compliance-lambda-duration-alarm-arn`,
    });
  }
}
