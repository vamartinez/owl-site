#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { EventsStack } from '../lib/events-stack';
import { StorageStack } from '../lib/storage-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { ApiStack } from '../lib/api-stack';
import { HostingStack } from '../lib/hosting-stack';
import { IncidentInfraStack } from '../lib/incident-infra-stack';

const app = new cdk.App();

// Read environment from CDK context (default: 'dev')
const environment = app.node.tryGetContext('environment') || 'dev';
const prefix = environment === 'prod' ? '' : `${environment}-`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'ca-central-1',
};

// ─── 1. Data Stack (DynamoDB tables) ──────────────────────────────────────────
const dataStack = new DataStack(app, `${prefix}ComplianceDataStack`, {
  env,
});

// ─── 2. Auth Stack (Cognito User Pool + Authorizer) ───────────────────────────
const authStack = new AuthStack(app, `${prefix}ComplianceAuthStack`, {
  env,
  environment,
});

// ─── 3. Events Stack (SNS Topics + SQS Queues) ───────────────────────────────
const eventsStack = new EventsStack(app, `${prefix}ComplianceEventsStack`, {
  env,
  environment,
});

// ─── 4. Storage Stack (S3 Buckets) ───────────────────────────────────────────
const storageStack = new StorageStack(app, `${prefix}ComplianceStorageStack`, {
  env,
});

// ─── 4b. Incident Infrastructure Stack (S3 + EventBridge + Scheduler) ────────
const incidentInfraStack = new IncidentInfraStack(app, `${prefix}IncidentInfraStack`, {
  env,
});

// ─── 5. Monitoring Stack (CloudWatch Alarms + Dashboards) ─────────────────────
const monitoringStack = new MonitoringStack(app, `${prefix}ComplianceMonitoringStack`, {
  env,
  environment,
});

// ─── 6. API Stack (API Gateway + Lambda functions) ────────────────────────────
// Depends on all other stacks for cross-stack references.
const apiStack = new ApiStack(app, `${prefix}ComplianceApiStack`, {
  env,
  environment,

  // Auth references
  userPool: authStack.userPool,

  // Data references (all DynamoDB tables)
  tenantsTable: dataStack.tenantsTable,
  workersTable: dataStack.workersTable,
  certificationsTable: dataStack.certificationsTable,
  contractorsTable: dataStack.contractorsTable,
  contractorWorkersTable: dataStack.contractorWorkersTable,
  sitesTable: dataStack.sitesTable,
  policiesTable: dataStack.policiesTable,
  policyVersionsTable: dataStack.policyVersionsTable,
  decisionRecordsTable: dataStack.decisionRecordsTable,
  accessTokensTable: dataStack.accessTokensTable,
  scanSessionsTable: dataStack.scanSessionsTable,
  enforcementActionsTable: dataStack.enforcementActionsTable,
  overrideRequestsTable: dataStack.overrideRequestsTable,
  revalidationAttemptsTable: dataStack.revalidationAttemptsTable,
  inspectionsTable: dataStack.inspectionsTable,
  mediaAssetsTable: dataStack.mediaAssetsTable,
  detectionResultsTable: dataStack.detectionResultsTable,
  sceneInterpretationsTable: dataStack.sceneInterpretationsTable,
  findingsTable: dataStack.findingsTable,
  dailyComplianceSummariesTable: dataStack.dailyComplianceSummariesTable,
  auditTrailTable: dataStack.auditTrailTable,
  leadCapturesTable: dataStack.leadCapturesTable,
  usersTable: dataStack.usersTable,
  sessionsTable: dataStack.sessionsTable,
  deviceCacheTable: dataStack.deviceCacheTable,
  offlineQueueTable: dataStack.offlineQueueTable,
  rateLimitsTable: dataStack.rateLimitsTable,
  formsTable: dataStack.formsTable,
  formVersionsTable: dataStack.formVersionsTable,
  formResponsesTable: dataStack.formResponsesTable,
  formAuditLogTable: dataStack.formAuditLogTable,
  incidentsTable: dataStack.incidentsTable,
  incidentTimelineTable: dataStack.incidentTimelineTable,
  incidentRegulatoryDataTable: dataStack.incidentRegulatoryDataTable,
  checkinTokensTable: dataStack.checkinTokensTable,
  selfCheckinAuditLogTable: dataStack.selfCheckinAuditLogTable,

  // Events references (SQS/SNS)
  platformEventsTopic: eventsStack.platformEventsTopic,
  aiPipelineQueue: eventsStack.aiPipelineQueue,
  certExpiryQueue: eventsStack.certExpiryQueue,
  notificationQueue: eventsStack.notificationQueue,
  reportingQueue: eventsStack.reportingQueue,

  // Storage references (S3)
  mediaBucket: storageStack.mediaBucket,
  auditBucket: storageStack.auditBucket,

  // Incident infrastructure references
  incidentEvidenceBucket: incidentInfraStack.incidentEvidenceBucket,
  incidentEventBus: incidentInfraStack.incidentEventBus,
  incidentSchedulerRoleArn: incidentInfraStack.schedulerRole.roleArn,
});

// Explicit dependency ordering
apiStack.addDependency(dataStack);
apiStack.addDependency(authStack);
apiStack.addDependency(eventsStack);
apiStack.addDependency(storageStack);
apiStack.addDependency(incidentInfraStack);
monitoringStack.addDependency(eventsStack);

// ─── 7. Hosting Stack (S3 + CloudFront for Admin Portal & Landing Page) ──────
// Receives the API Gateway so it can add an `/api/*` CloudFront behavior that
// forwards to the execute-api origin, giving deployed frontends a working
// same-origin path to the API without a build-time absolute URL.
const hostingStack = new HostingStack(app, `${prefix}ComplianceHostingStack`, {
  env,
  environment,
  api: apiStack.api,
});
hostingStack.addDependency(apiStack);
