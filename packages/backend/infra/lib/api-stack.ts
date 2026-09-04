import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  environment: string;

  // Auth references
  userPool: cognito.UserPool;

  // Data references (DynamoDB tables)
  tenantsTable: dynamodb.Table;
  workersTable: dynamodb.Table;
  certificationsTable: dynamodb.Table;
  contractorsTable: dynamodb.Table;
  contractorWorkersTable: dynamodb.Table;
  sitesTable: dynamodb.Table;
  policiesTable: dynamodb.Table;
  policyVersionsTable: dynamodb.Table;
  decisionRecordsTable: dynamodb.Table;
  accessTokensTable: dynamodb.Table;
  scanSessionsTable: dynamodb.Table;
  enforcementActionsTable: dynamodb.Table;
  overrideRequestsTable: dynamodb.Table;
  revalidationAttemptsTable: dynamodb.Table;
  inspectionsTable: dynamodb.Table;
  mediaAssetsTable: dynamodb.Table;
  detectionResultsTable: dynamodb.Table;
  sceneInterpretationsTable: dynamodb.Table;
  findingsTable: dynamodb.Table;
  dailyComplianceSummariesTable: dynamodb.Table;
  auditTrailTable: dynamodb.Table;
  leadCapturesTable: dynamodb.Table;
  usersTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
  deviceCacheTable: dynamodb.Table;
  offlineQueueTable: dynamodb.Table;
  rateLimitsTable: dynamodb.Table;
  formsTable: dynamodb.Table;
  formVersionsTable: dynamodb.Table;
  formResponsesTable: dynamodb.Table;
  formAuditLogTable: dynamodb.Table;
  incidentsTable: dynamodb.Table;
  incidentTimelineTable: dynamodb.Table;
  incidentRegulatoryDataTable: dynamodb.Table;
  checkinTokensTable: dynamodb.Table;
  selfCheckinAuditLogTable: dynamodb.Table;

  // Events references (SQS/SNS)
  platformEventsTopic: sns.Topic;
  aiPipelineQueue: sqs.Queue;
  certExpiryQueue: sqs.Queue;
  notificationQueue: sqs.Queue;
  reportingQueue: sqs.Queue;

  // Storage references (S3)
  mediaBucket: s3.Bucket;
  auditBucket: s3.Bucket;

  // Incident infrastructure references
  incidentEvidenceBucket: s3.Bucket;
  incidentEventBus: events.EventBus;
  incidentSchedulerRoleArn: string;
}

/**
 * API Stack — API Gateway REST API + Lambda functions for all 11 services.
 *
 * Defines:
 * - REST API with Cognito authorizer
 * - Lambda functions with environment-specific memory and concurrency
 * - API Gateway routes wired to Lambda handlers
 * - SQS event source mappings for async Lambdas
 *
 * Requirements: 18.1, 18.2, 18.9, 18.12, 18.13
 */
export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  // Expose Lambda functions for monitoring stack
  public readonly decisionEngineFn: lambda.Function;
  public readonly policyServiceFn: lambda.Function;
  public readonly identityServiceFn: lambda.Function;
  public readonly accessServiceFn: lambda.Function;
  public readonly aiOrchestrationFn: lambda.Function;
  public readonly detectionLayerFn: lambda.Function;
  public readonly sceneUnderstandingFn: lambda.Function;
  public readonly regulatoryMappingFn: lambda.Function;
  public readonly reportingServiceFn: lambda.Function;
  public readonly notificationServiceFn: lambda.Function;
  public readonly syncServiceFn: lambda.Function;
  public readonly formsServiceFn: lambda.Function;
  public readonly incidentServiceFn: lambda.Function;
  public readonly selfCheckinServiceFn: lambda.Function;
  public readonly reportValidationFn: lambda.Function;
  public readonly documentServiceFn: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const prefix = environment === 'prod' ? '' : `${environment}-`;
    const isProd = environment === 'prod';

    // ─── Shared Lambda Environment Variables ──────────────────────────────────

    const sharedEnv: Record<string, string> = {
      ENVIRONMENT: environment,
      TABLE_PREFIX: prefix,
      SNS_TOPIC_ARN: props.platformEventsTopic.topicArn,
      SQS_QUEUE_URL: props.aiPipelineQueue.queueUrl,
      NOTIFICATION_QUEUE_URL: props.notificationQueue.queueUrl,
      REPORTING_QUEUE_URL: props.reportingQueue.queueUrl,
      MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
      AUDIT_BUCKET_NAME: props.auditBucket.bucketName,
      USER_POOL_ID: props.userPool.userPoolId,
      PUBLIC_APP_DOMAIN: process.env['PUBLIC_APP_DOMAIN'] ?? '',
    };

    // ─── Lambda Defaults ──────────────────────────────────────────────────────

    const runtime = lambda.Runtime.NODEJS_20_X;
    const architecture = lambda.Architecture.ARM_64;
    const tracing = lambda.Tracing.ACTIVE;
    const logRetention = isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.TWO_WEEKS;

    // ─── Concurrency Limits ───────────────────────────────────────────────────
    // Production gets higher concurrency; dev is constrained to control costs.

    const concurrency = {
      api: isProd ? 100 : 10,
      async: isProd ? 50 : 5,
      notification: isProd ? 20 : 5,
    };

    // ─── Lambda Functions ─────────────────────────────────────────────────────

    // 1. Compliance Decision Engine (512 MB, 29s API / 900s async)
    this.decisionEngineFn = new lambda.Function(this, 'DecisionEngineFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgdecisionengine', {
        logGroupName: `/aws/lambda/`+ `${prefix}decision-engine`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}decision-engine`,
      description: 'Compliance Decision Engine — centralized decision evaluation',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/decision-engine'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.api,
    });

    // 2. Policy Service (256 MB, 29s)
    this.policyServiceFn = new lambda.Function(this, 'PolicyServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgpolicyservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}policy-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}policy-service`,
      description: 'Policy Service — CRUD and version management',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/policy'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.api,
    });

    // 3. Identity Service (256 MB, 29s)
    this.identityServiceFn = new lambda.Function(this, 'IdentityServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgidentityservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}identity-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}identity-service`,
      description: 'Identity Service — worker profiles and certification management',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/identity'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.api,
    });

    // 4. Access Service (256 MB, 29s)
    this.accessServiceFn = new lambda.Function(this, 'AccessServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgaccessservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}access-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}access-service`,
      description: 'Access Service — token management and scan sessions',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/access'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.api,
    });

    // 5. AI Orchestration Service (512 MB, 900s)
    this.aiOrchestrationFn = new lambda.Function(this, 'AiOrchestrationFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgaiorchestration', {
        logGroupName: `/aws/lambda/`+ `${prefix}ai-orchestration`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}ai-orchestration`,
      description: 'AI Orchestration Service — pipeline coordination and media management',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/ai-orchestration'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.async,
    });

    // 6. Detection Layer (1024 MB, 900s) — SQS-triggered async
    this.detectionLayerFn = new lambda.Function(this, 'DetectionLayerFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgdetectionlayer', {
        logGroupName: `/aws/lambda/`+ `${prefix}detection-layer`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}detection-layer`,
      description: 'Detection Layer — object detection via Ollama Cloud (qwen3.5:cloud vision)',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/detection'),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(900),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.async,
    });

    // 7. Scene Understanding Layer (512 MB, 900s) — SQS-triggered async
    this.sceneUnderstandingFn = new lambda.Function(this, 'SceneUnderstandingFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgsceneunderstanding', {
        logGroupName: `/aws/lambda/`+ `${prefix}scene-understanding`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}scene-understanding`,
      description: 'Scene Understanding Layer — scene classification from detections',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/scene-understanding'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.async,
    });

    // 8. Regulatory Mapping Layer (512 MB, 900s) — SQS-triggered async
    this.regulatoryMappingFn = new lambda.Function(this, 'RegulatoryMappingFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgregulatorymapping', {
        logGroupName: `/aws/lambda/`+ `${prefix}regulatory-mapping`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}regulatory-mapping`,
      description: 'Regulatory Mapping Layer — map scenes to WorkSafeBC regulations',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/regulatory-mapping'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.async,
    });

    // 9. Reporting Service (512 MB, 900s)
    this.reportingServiceFn = new lambda.Function(this, 'ReportingServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgreportingservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}reporting-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}reporting-service`,
      description: 'Reporting Service — summary generation and report export',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/reporting'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.async,
    });

    // 10. Notification Service (256 MB, 60s) — SQS-triggered async
    this.notificationServiceFn = new lambda.Function(this, 'NotificationServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgnotificationservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}notification-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}notification-service`,
      description: 'Notification Service — email (SES), SMS (SNS), push dispatch',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/notification'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.notification,
    });

    // 11. Sync Service (512 MB, 900s)
    this.syncServiceFn = new lambda.Function(this, 'SyncServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgsyncservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}sync-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}sync-service`,
      description: 'Sync Service — offline data reconciliation and batch processing',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/sync'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.async,
    });

    // 12. Forms Service (256 MB, 29s)
    this.formsServiceFn = new lambda.Function(this, 'FormsServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgformsservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}forms-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}forms-service`,
      description: 'Forms Service — formularios dinámicos, QR y respuestas de contratistas',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/forms'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.api,
    });

    // 13. Incident Service (256 MB, 29s)
    this.incidentServiceFn = new lambda.Function(this, 'IncidentServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgincidentservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}incident-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}incident-service`,
      description: 'Incident Service — CRUD, state transitions, regulatory evaluation, attachments',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/incidents'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency.api,
    });

    // 14. Report Validation Service — moved to NestedStack to stay under 500-resource limit
    // See ReportValidationNestedStack below
    // 15. Document Explorer Service — moved to NestedStack to stay under 500-resource limit
    // See DocumentServiceNestedStack below

    // ─── SQS Event Source Mappings ────────────────────────────────────────────

    // Detection Layer consumes from AI pipeline queue
    this.detectionLayerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(props.aiPipelineQueue, {
        batchSize: 1,
        maxConcurrency: concurrency.async,
      }),
    );

    // Notification Service consumes from notification queue
    this.notificationServiceFn.addEventSource(
      new lambdaEventSources.SqsEventSource(props.notificationQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(10),
        maxConcurrency: concurrency.notification,
      }),
    );

    // Reporting Service consumes from reporting queue
    this.reportingServiceFn.addEventSource(
      new lambdaEventSources.SqsEventSource(props.reportingQueue, {
        batchSize: 1,
        maxConcurrency: concurrency.async,
      }),
    );

    // ─── IAM Permissions — DynamoDB ───────────────────────────────────────────

    const allTables: dynamodb.Table[] = [
      props.tenantsTable,
      props.workersTable,
      props.certificationsTable,
      props.contractorsTable,
      props.contractorWorkersTable,
      props.sitesTable,
      props.policiesTable,
      props.policyVersionsTable,
      props.decisionRecordsTable,
      props.accessTokensTable,
      props.scanSessionsTable,
      props.enforcementActionsTable,
      props.overrideRequestsTable,
      props.revalidationAttemptsTable,
      props.inspectionsTable,
      props.mediaAssetsTable,
      props.detectionResultsTable,
      props.sceneInterpretationsTable,
      props.findingsTable,
      props.dailyComplianceSummariesTable,
      props.auditTrailTable,
      props.leadCapturesTable,
      props.usersTable,
      props.sessionsTable,
      props.deviceCacheTable,
      props.offlineQueueTable,
      props.rateLimitsTable,
      props.formsTable,
      props.formVersionsTable,
      props.formResponsesTable,
      props.formAuditLogTable,
      props.incidentsTable,
      props.incidentTimelineTable,
      props.incidentRegulatoryDataTable,
      props.checkinTokensTable,
      props.selfCheckinAuditLogTable,
    ];

    const allFunctions: lambda.Function[] = [
      this.decisionEngineFn,
      this.policyServiceFn,
      this.identityServiceFn,
      this.accessServiceFn,
      this.aiOrchestrationFn,
      this.detectionLayerFn,
      this.sceneUnderstandingFn,
      this.regulatoryMappingFn,
      this.reportingServiceFn,
      this.notificationServiceFn,
      this.syncServiceFn,
      this.formsServiceFn,
      this.incidentServiceFn,
    ];
    // NOTE: selfCheckinServiceFn is intentionally NOT in allFunctions — it gets
    // scoped table grants below instead of the blanket read/write-all, to keep
    // the ApiStack under the 500-resource CloudFormation limit.

    // Grant read/write to all tables for all functions
    // In production, this should be scoped per-service for least privilege
    for (const fn of allFunctions) {
      for (const table of allTables) {
        table.grantReadWriteData(fn);
      }
    }

    // ─── IAM Permissions — SNS ────────────────────────────────────────────────

    for (const fn of allFunctions) {
      props.platformEventsTopic.grantPublish(fn);
    }

    // ─── IAM Permissions — SQS ────────────────────────────────────────────────

    props.aiPipelineQueue.grantSendMessages(this.aiOrchestrationFn);
    props.aiPipelineQueue.grantConsumeMessages(this.detectionLayerFn);
    props.notificationQueue.grantSendMessages(this.decisionEngineFn);
    props.notificationQueue.grantSendMessages(this.accessServiceFn);
    props.notificationQueue.grantConsumeMessages(this.notificationServiceFn);
    props.reportingQueue.grantSendMessages(this.reportingServiceFn);
    props.reportingQueue.grantConsumeMessages(this.reportingServiceFn);

    // ─── IAM Permissions — S3 ─────────────────────────────────────────────────

    props.mediaBucket.grantReadWrite(this.identityServiceFn);
    props.mediaBucket.grantReadWrite(this.aiOrchestrationFn);
    props.mediaBucket.grantRead(this.detectionLayerFn);
    props.mediaBucket.grantRead(this.sceneUnderstandingFn);
    props.mediaBucket.grantReadWrite(this.syncServiceFn);
    props.mediaBucket.grantReadWrite(this.formsServiceFn);
    props.mediaBucket.grantReadWrite(this.incidentServiceFn);

    props.auditBucket.grantPut(this.decisionEngineFn);
    props.auditBucket.grantRead(this.reportingServiceFn);

    // ─── IAM Permissions — Cognito ────────────────────────────────────────────

    // Identity service needs ListUsers permission for GET /admin/users endpoint
    this.identityServiceFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['cognito-idp:ListUsers'],
        resources: [props.userPool.userPoolArn],
      })
    );

    // ─── API Gateway REST API ─────────────────────────────────────────────────

    this.api = new apigateway.RestApi(this, 'ComplianceApi', {
      restApiName: `${prefix}compliance-api`,
      description: 'AI Construction Compliance Platform REST API',
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        throttlingRateLimit: isProd ? 1000 : 100,
        throttlingBurstLimit: isProd ? 2000 : 200,
      },
      defaultMethodOptions: {
        apiKeyRequired: false,
      },
    });

    // ─── CORS: Gateway Responses (generic for ALL paths) ──────────────────────
    // These gateway responses handle CORS headers for error responses (4xx/5xx)
    // that API Gateway returns before reaching Lambda (e.g., auth failures, missing routes).
    // This covers all current and future paths without creating per-resource OPTIONS methods.

    const corsAllowOrigins = isProd
      ? "'https://admin.sitecompliance.ca, https://www.sitecompliance.ca'"
      : "'*'";
    const corsAllowHeaders = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Correlation-Id,X-Tenant-Id'";
    const corsAllowMethods = "'GET,POST,PATCH,PUT,DELETE,OPTIONS'";

    // Handle CORS on 4XX responses (unauthorized, forbidden, not found, etc.)
    this.api.addGatewayResponse('GatewayResponse4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'method.response.header.Access-Control-Allow-Origin': corsAllowOrigins,
        'method.response.header.Access-Control-Allow-Headers': corsAllowHeaders,
        'method.response.header.Access-Control-Allow-Methods': corsAllowMethods,
      },
    });

    // Handle CORS on missing routes — returns 200 so browser preflight passes
    this.api.addGatewayResponse('GatewayResponseMissingAuth', {
      type: apigateway.ResponseType.MISSING_AUTHENTICATION_TOKEN,
      statusCode: '200',
      responseHeaders: {
        'method.response.header.Access-Control-Allow-Origin': corsAllowOrigins,
        'method.response.header.Access-Control-Allow-Headers': corsAllowHeaders,
        'method.response.header.Access-Control-Allow-Methods': corsAllowMethods,
        'method.response.header.Access-Control-Allow-Credentials': "'true'",
      },
      templates: {
        'application/json': '{}',
      },
    });

    // Cognito authorizer — created here to avoid cross-stack cyclic dependency
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      authorizerName: `${prefix}compliance-cognito-authorizer`,
      cognitoUserPools: [props.userPool],
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // Cognito authorizer method options
    const authorizedMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // ─── Lambda Integrations ──────────────────────────────────────────────────
    // Using allowTestInvoke: false to prevent per-route Lambda::Permission resources.
    // A single wildcard permission per Lambda is granted below instead.

    const policyIntegration = new apigateway.LambdaIntegration(this.policyServiceFn, { allowTestInvoke: false });
    const identityIntegration = new apigateway.LambdaIntegration(this.identityServiceFn, { allowTestInvoke: false });
    const accessIntegration = new apigateway.LambdaIntegration(this.accessServiceFn, { allowTestInvoke: false });
    const aiOrchestrationIntegration = new apigateway.LambdaIntegration(this.aiOrchestrationFn, { allowTestInvoke: false });
    const reportingIntegration = new apigateway.LambdaIntegration(this.reportingServiceFn, { allowTestInvoke: false });
    const syncIntegration = new apigateway.LambdaIntegration(this.syncServiceFn, { allowTestInvoke: false });

    // Contractors reuse identity service (or a dedicated handler — using identity for now)

    // Lead capture — no auth required (public endpoint)

    // Grant API Gateway invoke permission (wildcard) per Lambda — replaces per-route permissions
    const apiArn = this.api.arnForExecuteApi('*', '/*', '*');
    for (const fn of allFunctions) {
      fn.addPermission('ApiGatewayInvoke', {
        principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: apiArn,
      });
    }

    // ─── API Routes: Workers (Identity Service) ───────────────────────────────

    const workers = this.api.root.addResource('workers');
    workers.addMethod('POST', identityIntegration, authorizedMethodOptions);
    workers.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const workerId = workers.addResource('{id}');
    workerId.addMethod('GET', identityIntegration, authorizedMethodOptions);
    workerId.addMethod('PATCH', identityIntegration, authorizedMethodOptions);

    const workerStatus = workerId.addResource('status');
    workerStatus.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const workerCertifications = workerId.addResource('certifications');
    workerCertifications.addMethod('POST', identityIntegration, authorizedMethodOptions);
    workerCertifications.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const workerCertId = workerCertifications.addResource('{certId}');
    workerCertId.addMethod('PATCH', identityIntegration, authorizedMethodOptions);

    const workerCertDocumentUrl = workerCertId.addResource('document-url');
    workerCertDocumentUrl.addMethod('GET', identityIntegration, authorizedMethodOptions);

    // ─── API Routes: Sites (Policy Service) ───────────────────────────────────

    const sites = this.api.root.addResource('sites');
    sites.addMethod('POST', policyIntegration, authorizedMethodOptions);
    sites.addMethod('GET', policyIntegration, authorizedMethodOptions);

    const siteId = sites.addResource('{id}');
    siteId.addMethod('GET', policyIntegration, authorizedMethodOptions);
    siteId.addMethod('PATCH', policyIntegration, authorizedMethodOptions);

    const siteEffectivePolicies = siteId.addResource('effective-policies');
    siteEffectivePolicies.addMethod('GET', policyIntegration, authorizedMethodOptions);

    const siteDailySummary = siteId.addResource('daily-summary');
    siteDailySummary.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    // ─── API Routes: Policies (Policy Service) ────────────────────────────────

    const policies = this.api.root.addResource('policies');
    policies.addMethod('POST', policyIntegration, authorizedMethodOptions);
    policies.addMethod('GET', policyIntegration, authorizedMethodOptions);

    const policyId = policies.addResource('{id}');
    policyId.addMethod('GET', policyIntegration, authorizedMethodOptions);

    const policyVersions = policyId.addResource('versions');
    policyVersions.addMethod('POST', policyIntegration, authorizedMethodOptions);
    policyVersions.addMethod('GET', policyIntegration, authorizedMethodOptions);

    const policyVersionId = policyVersions.addResource('{versionId}');
    policyVersionId.addMethod('GET', policyIntegration, authorizedMethodOptions);

    // ─── API Routes: Access (Access Service) ──────────────────────────────────

    const access = this.api.root.addResource('access');

    const accessRequest = access.addResource('request');
    accessRequest.addMethod('POST', accessIntegration, authorizedMethodOptions);

    const accessScan = access.addResource('scan');
    accessScan.addMethod('POST', accessIntegration, authorizedMethodOptions);

    const accessDecisions = access.addResource('decisions');
    const accessDecisionId = accessDecisions.addResource('{id}');
    accessDecisionId.addMethod('GET', accessIntegration, authorizedMethodOptions);

    const accessTokens = access.addResource('tokens');
    accessTokens.addMethod('POST', accessIntegration, authorizedMethodOptions);

    const accessTokenId = accessTokens.addResource('{id}');
    accessTokenId.addMethod('DELETE', accessIntegration, authorizedMethodOptions);

    const accessRevalidate = access.addResource('revalidate');
    accessRevalidate.addMethod('POST', accessIntegration, authorizedMethodOptions);

    const accessOverride = access.addResource('override');
    accessOverride.addMethod('POST', accessIntegration, authorizedMethodOptions);

    const accessOverrideId = accessOverride.addResource('{id}');
    accessOverrideId.addMethod('PATCH', accessIntegration, authorizedMethodOptions);

    // ─── API Routes: Inspections (AI Orchestration Service) ───────────────────

    const inspections = this.api.root.addResource('inspections');
    inspections.addMethod('POST', aiOrchestrationIntegration, authorizedMethodOptions);

    const inspectionId = inspections.addResource('{id}');

    const inspectionMedia = inspectionId.addResource('media');
    inspectionMedia.addMethod('POST', aiOrchestrationIntegration, authorizedMethodOptions);

    const inspectionAnalyze = inspectionId.addResource('analyze');
    inspectionAnalyze.addMethod('POST', aiOrchestrationIntegration, authorizedMethodOptions);

    // ─── API Routes: Findings (AI Orchestration / Decision Engine) ────────────

    const findings = this.api.root.addResource('findings');
    findings.addMethod('GET', aiOrchestrationIntegration, authorizedMethodOptions);

    const findingId = findings.addResource('{id}');
    findingId.addMethod('GET', aiOrchestrationIntegration, authorizedMethodOptions);

    const findingReview = findingId.addResource('review');
    findingReview.addMethod('POST', aiOrchestrationIntegration, authorizedMethodOptions);

    // ─── API Routes: Reports (Reporting Service) ──────────────────────────────

    const reports = this.api.root.addResource('reports');
    reports.addMethod('POST', reportingIntegration, authorizedMethodOptions);

    const reportId = reports.addResource('{id}');
    reportId.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    const reportExport = reportId.addResource('export');
    reportExport.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    // Worker compliance summary
    const workerComplianceSummary = workerId.addResource('compliance-summary');
    workerComplianceSummary.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    // ─── API Routes: Contractors (Identity Service) ───────────────────────────

    const contractors = this.api.root.addResource('contractors');
    contractors.addMethod('POST', identityIntegration, authorizedMethodOptions);
    contractors.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const contractorId = contractors.addResource('{id}');
    contractorId.addMethod('GET', identityIntegration, authorizedMethodOptions);
    contractorId.addMethod('PATCH', identityIntegration, authorizedMethodOptions);

    const contractorWorkers = contractorId.addResource('workers');
    contractorWorkers.addMethod('GET', identityIntegration, authorizedMethodOptions);
    contractorWorkers.addMethod('POST', identityIntegration, authorizedMethodOptions);

    const contractorWorkerId = contractorWorkers.addResource('{workerId}');
    contractorWorkerId.addMethod('DELETE', identityIntegration, authorizedMethodOptions);

    const contractorCompliance = contractorId.addResource('compliance');
    contractorCompliance.addMethod('GET', identityIntegration, authorizedMethodOptions);

    // ─── API Routes: Admin (Identity Service) ────────────────────────────────

    const admin = this.api.root.addResource('admin');
    const adminUsers = admin.addResource('users');
    adminUsers.addMethod('GET', identityIntegration, authorizedMethodOptions);

    // ─── API Routes: Sync (Sync Service) ──────────────────────────────────────

    const sync = this.api.root.addResource('sync');

    const syncSessions = sync.addResource('sessions');
    syncSessions.addMethod('POST', syncIntegration, authorizedMethodOptions);

    const syncMedia = sync.addResource('media');
    syncMedia.addMethod('POST', syncIntegration, authorizedMethodOptions);

    const syncStatus = sync.addResource('status');
    syncStatus.addMethod('GET', syncIntegration, authorizedMethodOptions);

    // ─── API Routes: Certifications (Identity Service) ──────────────────────────

    const certifications = this.api.root.addResource('certifications');

    const certStats = certifications.addResource('stats');
    certStats.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const certCatalog = certifications.addResource('catalog');
    certCatalog.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const certExpiring = certifications.addResource('expiring');
    certExpiring.addMethod('GET', identityIntegration, authorizedMethodOptions);

    const certPending = certifications.addResource('pending');
    certPending.addMethod('GET', identityIntegration, authorizedMethodOptions);

    // ─── API Routes: Site Access (Access Service) ─────────────────────────────

    const siteAccess = this.api.root.addResource('site-access');

    const siteAccessLive = siteAccess.addResource('live');
    siteAccessLive.addMethod('GET', accessIntegration, authorizedMethodOptions);

    const siteAccessCheckIn = siteAccess.addResource('check-in');
    siteAccessCheckIn.addMethod('POST', accessIntegration, authorizedMethodOptions);

    const siteAccessRecentCheckins = siteAccess.addResource('recent-checkins');
    siteAccessRecentCheckins.addMethod('GET', accessIntegration, authorizedMethodOptions);

    const siteAccessRules = siteAccess.addResource('rules');
    siteAccessRules.addMethod('GET', accessIntegration, authorizedMethodOptions);

    const siteAccessRejections = siteAccess.addResource('rejections');
    siteAccessRejections.addMethod('GET', accessIntegration, authorizedMethodOptions);

    const siteAccessVisits = siteAccess.addResource('visits');
    siteAccessVisits.addMethod('GET', accessIntegration, authorizedMethodOptions);

    // ─── API Routes: Dashboard (Reporting Service) ────────────────────────────

    const dashboard = this.api.root.addResource('dashboard');

    const dashboardKpis = dashboard.addResource('kpis');
    dashboardKpis.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    const dashboardRisks = dashboard.addResource('risks');
    dashboardRisks.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    const dashboardBlockedAccess = dashboard.addResource('blocked-access');
    dashboardBlockedAccess.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    const dashboardExpiringCerts = dashboard.addResource('expiring-certs');
    dashboardExpiringCerts.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    // ─── API Routes: Reports additions (Reporting Service) ────────────────────

    const reportsComplianceSummary = reports.addResource('compliance-summary');
    reportsComplianceSummary.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    const reportsSiteAccessLogs = reports.addResource('site-access-logs');
    reportsSiteAccessLogs.addMethod('GET', reportingIntegration, authorizedMethodOptions);

    // ─── API Routes: Leads (Public — no auth) ─────────────────────────────────

    const leads = this.api.root.addResource('leads');
    leads.addMethod('POST', identityIntegration); // No authorizer — public endpoint

    // ─── API Routes: Forms (Forms Service) ────────────────────────────────────

    const formsIntegration = new apigateway.LambdaIntegration(this.formsServiceFn, { allowTestInvoke: false });

    const forms = this.api.root.addResource('forms');
    forms.addMethod('POST', formsIntegration, authorizedMethodOptions);
    forms.addMethod('GET', formsIntegration, authorizedMethodOptions);

    const formId = forms.addResource('{id}');
    formId.addMethod('GET', formsIntegration, authorizedMethodOptions);
    formId.addMethod('PATCH', formsIntegration, authorizedMethodOptions);

    const formPublish = formId.addResource('publish');
    formPublish.addMethod('POST', formsIntegration, authorizedMethodOptions);

    const formUnpublish = formId.addResource('unpublish');
    formUnpublish.addMethod('POST', formsIntegration, authorizedMethodOptions);

    const formDuplicate = formId.addResource('duplicate');
    formDuplicate.addMethod('POST', formsIntegration, authorizedMethodOptions);

    const formResponses = formId.addResource('responses');
    formResponses.addMethod('GET', formsIntegration, authorizedMethodOptions);

    const formResponseId = formResponses.addResource('{responseId}');
    formResponseId.addMethod('GET', formsIntegration, authorizedMethodOptions);

    const formResponsesExport = formResponses.addResource('export');
    formResponsesExport.addMethod('GET', formsIntegration, authorizedMethodOptions);

    const formAudit = formId.addResource('audit');
    formAudit.addMethod('GET', formsIntegration, authorizedMethodOptions);

    const formUploadUrl = formId.addResource('upload-url');
    formUploadUrl.addMethod('POST', formsIntegration, authorizedMethodOptions);

    // ─── API Routes: Public Forms (No Auth) ───────────────────────────────────

    const publicResource = this.api.root.addResource('public');
    const publicForms = publicResource.addResource('forms');
    const publicFormToken = publicForms.addResource('{token}');
    publicFormToken.addMethod('GET', formsIntegration); // Sin authorizer
    const publicFormResponses = publicFormToken.addResource('responses');
    publicFormResponses.addMethod('POST', formsIntegration); // Sin authorizer
    const publicFormUploadUrl = publicFormToken.addResource('upload-url');
    publicFormUploadUrl.addMethod('POST', formsIntegration); // Sin authorizer

    // ─── API Routes: Safety AI (AI Orchestration Service) ────────────────────

    const safetyAiIntegration = new apigateway.LambdaIntegration(this.aiOrchestrationFn, {
      allowTestInvoke: false,
    });

    const safetyAi = this.api.root.addResource('safety-ai');

    const safetyAiFindings = safetyAi.addResource('findings');
    safetyAiFindings.addMethod('GET', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiFindingId = safetyAiFindings.addResource('{id}');
    safetyAiFindingId.addMethod('GET', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiFindingConfirm = safetyAiFindingId.addResource('confirm');
    safetyAiFindingConfirm.addMethod('PATCH', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiFindingDismiss = safetyAiFindingId.addResource('dismiss');
    safetyAiFindingDismiss.addMethod('PATCH', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiPendingReview = safetyAi.addResource('pending-review');
    safetyAiPendingReview.addMethod('GET', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiViolationsByRule = safetyAi.addResource('violations-by-rule');
    safetyAiViolationsByRule.addMethod('GET', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiCorrectiveActions = safetyAi.addResource('corrective-actions');
    safetyAiCorrectiveActions.addMethod('GET', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiPdfReports = safetyAi.addResource('pdf-reports');
    safetyAiPdfReports.addMethod('GET', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiPdfReportsGenerate = safetyAiPdfReports.addResource('generate');
    safetyAiPdfReportsGenerate.addMethod('POST', safetyAiIntegration, authorizedMethodOptions);

    const safetyAiUploadEvidence = safetyAi.addResource('upload-evidence');
    safetyAiUploadEvidence.addMethod('POST', safetyAiIntegration, authorizedMethodOptions);

    // ─── API Routes: Incidents (Incident Service) ─────────────────────────────
    // Uses {id} + nested {proxy+} routing to keep CloudFormation under limit
    // while remaining compatible with the already-deployed /incidents/{id} resource.
    // The Lambda handler routes internally based on httpMethod + resolved path.

    const incidentIntegration = new apigateway.LambdaIntegration(this.incidentServiceFn, { allowTestInvoke: false });

    const incidents = this.api.root.addResource('incidents');
    incidents.addMethod('POST', incidentIntegration, authorizedMethodOptions);
    incidents.addMethod('GET', incidentIntegration, authorizedMethodOptions);

    // /incidents/export (must come before {id} to avoid path conflict)
    const incidentsExport = incidents.addResource('export');
    incidentsExport.addMethod('POST', incidentIntegration, authorizedMethodOptions);

    // /incidents/osha-300a
    const incidentsOsha = incidents.addResource('osha-300a');
    incidentsOsha.addMethod('GET', incidentIntegration, authorizedMethodOptions);

    // /incidents/{id} — individual incident operations
    const incidentId = incidents.addResource('{id}');
    incidentId.addMethod('GET', incidentIntegration, authorizedMethodOptions);
    incidentId.addMethod('PATCH', incidentIntegration, authorizedMethodOptions);

    // /incidents/{id}/{proxy+} — catch-all for sub-resources (state, severity, comments, etc.)
    const incidentSubProxy = incidentId.addResource('{proxy+}');
    incidentSubProxy.addMethod('GET', incidentIntegration, authorizedMethodOptions);
    incidentSubProxy.addMethod('POST', incidentIntegration, authorizedMethodOptions);
    incidentSubProxy.addMethod('PATCH', incidentIntegration, authorizedMethodOptions);
    incidentSubProxy.addMethod('DELETE', incidentIntegration, authorizedMethodOptions);

    // ─── Document Explorer: Deployed as NestedStack to stay under 500-resource limit ──
    const documentNested = new DocumentServiceNestedStack(this, 'DocumentServiceStack', {
      api: this.api,
      authorizedMethodOptions,
      environment,
      prefix,
      isProd,
      mediaBucket: props.mediaBucket,
      auditTrailTable: props.auditTrailTable,
      allTables,
      platformEventsTopic: props.platformEventsTopic,
      sharedEnv,
    });
    this.documentServiceFn = documentNested.documentServiceFn;

    // ─── Report Validation: Deployed as NestedStack to stay under 500-resource limit ──
    const reportValidationNested = new ReportValidationNestedStack(this, 'ReportValidationStack', {
      api: this.api,
      authorizedMethodOptions,
      prefix,
      isProd,
      mediaBucket: props.mediaBucket,
      allTables,
      platformEventsTopic: props.platformEventsTopic,
      sharedEnv,
    });
    this.reportValidationFn = reportValidationNested.reportValidationFn;

    // ─── Self Check-In: Deployed as NestedStack to stay under 500-resource limit ──
    const selfCheckinNested = new SelfCheckinNestedStack(this, 'SelfCheckinStack', {
      api: this.api,
      publicResource,
      authorizedMethodOptions,
      prefix,
      isProd,
      sharedEnv,
      checkinTokensTable: props.checkinTokensTable,
      selfCheckinAuditLogTable: props.selfCheckinAuditLogTable,
      scanSessionsTable: props.scanSessionsTable,
      rateLimitsTable: props.rateLimitsTable,
      workersTable: props.workersTable,
      sitesTable: props.sitesTable,
      policiesTable: props.policiesTable,
      policyVersionsTable: props.policyVersionsTable,
      decisionRecordsTable: props.decisionRecordsTable,
      certificationsTable: props.certificationsTable,
      platformEventsTopic: props.platformEventsTopic,
    });
    this.selfCheckinServiceFn = selfCheckinNested.selfCheckinServiceFn;

    // ─── Ollama Cloud API key (provider migration: Bedrock → Ollama Cloud) ───
    // First non-AWS secret in the codebase. The VALUE is set out-of-band
    // (`aws secretsmanager put-secret-value --secret-id ${prefix}ollama-api-key
    // --secret-string <key>`), never in code or committed. Strategy B
    // (preferred): inject only the secret ARN and let the shared ollama-client
    // read it at runtime, keeping the raw key out of the Lambda environment.
    // Grants are additive; the misplaced `bedrock:InvokeModel` grant that used
    // to sit on reportValidationFn has been removed — no migrated path calls
    // Bedrock inference anymore (BDA OCR in text-extractor.ts is out of scope).
    const ollamaApiKey = new secretsmanager.Secret(this, 'OllamaApiKey', {
      secretName: `${prefix}ollama-api-key`,
      description: 'Ollama Cloud API key for direct Messages API access',
    });

    for (const fn of [
      this.detectionLayerFn, // detection/detector.ts (vision, qwen3.5:cloud)
      this.sceneUnderstandingFn, // scene-understanding/classifier.ts (text)
      this.regulatoryMappingFn, // regulatory-mapping/mapper.ts (text)
      this.reportValidationFn, // report-validation/validation-engine.ts (RAG)
    ]) {
      ollamaApiKey.grantRead(fn);
      fn.addEnvironment('OLLAMA_API_KEY_SECRET_ARN', ollamaApiKey.secretArn);
    }

    // ─── Stack Outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
      exportName: `${prefix}compliance-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway REST API ID',
      exportName: `${prefix}compliance-api-id`,
    });
  }
}

// ─── Document Service NestedStack ─────────────────────────────────────────────
// Separated to keep the parent ApiStack under CloudFormation's 500-resource limit.

interface DocumentServiceNestedStackProps extends cdk.NestedStackProps {
  api: apigateway.RestApi;
  authorizedMethodOptions: apigateway.MethodOptions;
  environment: string;
  prefix: string;
  isProd: boolean;
  mediaBucket: s3.Bucket;
  auditTrailTable: dynamodb.Table;
  allTables: dynamodb.Table[];
  platformEventsTopic: sns.Topic;
  sharedEnv: Record<string, string>;
}

class DocumentServiceNestedStack extends cdk.NestedStack {
  public readonly documentServiceFn: lambda.Function;

  constructor(scope: Construct, id: string, props: DocumentServiceNestedStackProps) {
    super(scope, id, props);

    const { api, authorizedMethodOptions, prefix, isProd, sharedEnv } = props;

    const runtime = lambda.Runtime.NODEJS_20_X;
    const architecture = lambda.Architecture.ARM_64;
    const tracing = lambda.Tracing.ACTIVE;
    const logRetention = isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.TWO_WEEKS;
    const concurrency = isProd ? 100 : 10;

    // Lambda function
    this.documentServiceFn = new lambda.Function(this, 'DocumentServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgdocumentservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}document-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}document-service`,
      description: 'Document Explorer Service — folder navigation, search, download, integrity',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/documents'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(130),
      environment: {
        ...sharedEnv,
        DOCUMENTS_BUCKET_NAME: props.mediaBucket.bucketName,
      },
      reservedConcurrentExecutions: concurrency,
    });

    // IAM: DynamoDB read/write for all source tables
    for (const table of props.allTables) {
      table.grantReadWriteData(this.documentServiceFn);
    }

    // IAM: SNS publish
    props.platformEventsTopic.grantPublish(this.documentServiceFn);

    // IAM: S3 read + put
    props.mediaBucket.grantRead(this.documentServiceFn);
    props.mediaBucket.grantPut(this.documentServiceFn);

    // IAM: API Gateway invoke
    const apiArn = api.arnForExecuteApi('*', '/*', '*');
    this.documentServiceFn.addPermission('ApiGatewayInvoke', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: apiArn,
    });

    // Lambda integration
    const documentIntegration = new apigateway.LambdaIntegration(this.documentServiceFn, {
      allowTestInvoke: false,
    });

    // API Gateway: single proxy route to handle all /documents/* paths
    // This uses 2 resources instead of 13+, keeping parent stack under 500 limit.
    // The Lambda handler routes internally based on httpMethod + resource.
    const documents = api.root.addResource('documents');
    documents.addMethod('GET', documentIntegration, authorizedMethodOptions);
    documents.addMethod('POST', documentIntegration, authorizedMethodOptions);
    documents.addMethod('PUT', documentIntegration, authorizedMethodOptions);

    const documentsProxy = documents.addResource('{proxy+}');
    documentsProxy.addMethod('GET', documentIntegration, authorizedMethodOptions);
    documentsProxy.addMethod('POST', documentIntegration, authorizedMethodOptions);
    documentsProxy.addMethod('PUT', documentIntegration, authorizedMethodOptions);
  }
}


// ─── Report Validation Service NestedStack ────────────────────────────────────
// Separated to keep the parent ApiStack under CloudFormation's 500-resource limit.

interface ReportValidationNestedStackProps extends cdk.NestedStackProps {
  api: apigateway.RestApi;
  authorizedMethodOptions: apigateway.MethodOptions;
  prefix: string;
  isProd: boolean;
  mediaBucket: s3.Bucket;
  allTables: dynamodb.Table[];
  platformEventsTopic: sns.Topic;
  sharedEnv: Record<string, string>;
}

class ReportValidationNestedStack extends cdk.NestedStack {
  public readonly reportValidationFn: lambda.Function;

  constructor(scope: Construct, id: string, props: ReportValidationNestedStackProps) {
    super(scope, id, props);

    const { api, authorizedMethodOptions, prefix, isProd, sharedEnv } = props;

    const runtime = lambda.Runtime.NODEJS_20_X;
    const architecture = lambda.Architecture.ARM_64;
    const tracing = lambda.Tracing.ACTIVE;
    const logRetention = isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.TWO_WEEKS;
    const concurrency = isProd ? 100 : 10;

    // Lambda function
    this.reportValidationFn = new lambda.Function(this, 'ReportValidationFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgreportvalidation', {
        logGroupName: `/aws/lambda/`+ `${prefix}report-validation`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}report-validation`,
      description: 'Report Validation Service — upload, validate, submit reports and KB management',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/report-validation'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency,
    });

    // IAM: DynamoDB read/write for all tables
    for (const table of props.allTables) {
      table.grantReadWriteData(this.reportValidationFn);
    }

    // IAM: SNS publish
    props.platformEventsTopic.grantPublish(this.reportValidationFn);

    // IAM: S3 read/write (for document upload/retrieval)
    props.mediaBucket.grantReadWrite(this.reportValidationFn);

    // ─── Ollama Cloud API key grant for report-validation ───────────────────
    // The secret + env-ARN injection is created in the parent stack (see
    // configureOllamaSecret) where all four migrated Lambdas are visible; this
    // nested stack only holds reportValidationFn. The misplaced
    // `bedrock:InvokeModel` grant that used to sit here is removed — no migrated
    // path calls Bedrock inference anymore (BDA OCR is out of scope).

    // IAM: API Gateway invoke
    const apiArn = api.arnForExecuteApi('*', '/*', '*');
    this.reportValidationFn.addPermission('ApiGatewayInvoke', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: apiArn,
    });

    // Lambda integration
    const reportValidationIntegration = new apigateway.LambdaIntegration(this.reportValidationFn, {
      allowTestInvoke: false,
    });

    // API Gateway resources
    const reportValidation = api.root.addResource('report-validation');
    const rvReports = reportValidation.addResource('reports');
    rvReports.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);
    rvReports.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);

    const rvReportId = rvReports.addResource('{id}');
    rvReportId.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);

    const rvValidate = rvReportId.addResource('validate');
    rvValidate.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);

    const rvVersions = rvReportId.addResource('versions');
    rvVersions.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);

    const rvSubmit = rvReportId.addResource('submit');
    rvSubmit.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);

    const rvHistory = rvReportId.addResource('history');
    rvHistory.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);

    const rvKb = reportValidation.addResource('kb');
    const rvKbDocs = rvKb.addResource('documents');
    rvKbDocs.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);
    rvKbDocs.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);

    const rvKbDocId = rvKbDocs.addResource('{id}');
    rvKbDocId.addMethod('DELETE', reportValidationIntegration, authorizedMethodOptions);
  }
}

// ─── Self Check-In Service NestedStack ────────────────────────────────────────
// Separated to keep the parent ApiStack under CloudFormation's 500-resource limit.

interface SelfCheckinNestedStackProps extends cdk.NestedStackProps {
  api: apigateway.RestApi;
  publicResource: apigateway.IResource;
  authorizedMethodOptions: apigateway.MethodOptions;
  prefix: string;
  isProd: boolean;
  sharedEnv: Record<string, string>;
  checkinTokensTable: dynamodb.Table;
  selfCheckinAuditLogTable: dynamodb.Table;
  scanSessionsTable: dynamodb.Table;
  rateLimitsTable: dynamodb.Table;
  workersTable: dynamodb.Table;
  sitesTable: dynamodb.Table;
  policiesTable: dynamodb.Table;
  policyVersionsTable: dynamodb.Table;
  decisionRecordsTable: dynamodb.Table;
  certificationsTable: dynamodb.Table;
  platformEventsTopic: sns.Topic;
}

class SelfCheckinNestedStack extends cdk.NestedStack {
  public readonly selfCheckinServiceFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SelfCheckinNestedStackProps) {
    super(scope, id, props);

    const { api, authorizedMethodOptions, prefix, isProd, sharedEnv } = props;

    const runtime = lambda.Runtime.NODEJS_20_X;
    const architecture = lambda.Architecture.ARM_64;
    const tracing = lambda.Tracing.ACTIVE;
    const logRetention = isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.TWO_WEEKS;
    const concurrency = isProd ? 100 : 10;

    this.selfCheckinServiceFn = new lambda.Function(this, 'SelfCheckinServiceFn', {
      runtime,
      architecture,
      tracing,
      logGroup: new logs.LogGroup(this, 'Lgselfcheckinservice', {
        logGroupName: `/aws/lambda/`+ `${prefix}self-checkin-service`,
        retention: logRetention,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      functionName: `${prefix}self-checkin-service`,
      description:
        'Self Check-In Service — public QR/SMS worker check-in + admin token management',
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/services/self-checkin'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(29),
      environment: sharedEnv,
      reservedConcurrentExecutions: concurrency,
    });

    // IAM: read/write only what the service needs (least privilege).
    for (const table of [
      props.checkinTokensTable,
      props.scanSessionsTable,
      props.selfCheckinAuditLogTable,
      props.rateLimitsTable,
      props.decisionRecordsTable, // the in-process decision engine writes records
    ]) {
      table.grantReadWriteData(this.selfCheckinServiceFn);
    }
    for (const table of [
      props.workersTable,
      props.sitesTable,
      props.policiesTable,
      props.policyVersionsTable,
      props.certificationsTable,
    ]) {
      table.grantReadData(this.selfCheckinServiceFn);
    }
    props.platformEventsTopic.grantPublish(this.selfCheckinServiceFn);

    // IAM: API Gateway invoke
    const apiArn = api.arnForExecuteApi('*', '/*', '*');
    this.selfCheckinServiceFn.addPermission('ApiGatewayInvoke', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: apiArn,
    });

    const checkinIntegration = new apigateway.LambdaIntegration(this.selfCheckinServiceFn, {
      allowTestInvoke: false,
    });

    // Route-count minimization (mirrors document-service's {proxy+} approach) to
    // stay under the parent's 500-resource limit.
    //
    // Authenticated management routes live under /checkin/* behind the Cognito
    // authorizer. A proxy handles /checkin/sites/{siteId}/token[/regenerate] and
    // /checkin/sms-link; the handler routes internally on the proxy path.
    const checkin = api.root.addResource('checkin');
    const checkinProxy = checkin.addResource('{proxy+}');
    checkinProxy.addMethod('POST', checkinIntegration, authorizedMethodOptions);

    // Public self check-in — no authorizer. A single {proxy+} handles
    // /public/check-in/{token} and /public/check-in/{token}/verify.
    const publicCheckin = props.publicResource.addResource('check-in');
    const publicCheckinProxy = publicCheckin.addResource('{proxy+}');
    publicCheckinProxy.addMethod('GET', checkinIntegration); // no authorizer
    publicCheckinProxy.addMethod('POST', checkinIntegration); // no authorizer
  }
}
