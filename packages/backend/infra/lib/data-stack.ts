import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  // Expose table references for other stacks
  public readonly tenantsTable: dynamodb.Table;
  public readonly workersTable: dynamodb.Table;
  public readonly certificationsTable: dynamodb.Table;
  public readonly contractorsTable: dynamodb.Table;
  public readonly contractorWorkersTable: dynamodb.Table;
  public readonly sitesTable: dynamodb.Table;
  public readonly policiesTable: dynamodb.Table;
  public readonly policyVersionsTable: dynamodb.Table;
  public readonly decisionRecordsTable: dynamodb.Table;
  public readonly accessTokensTable: dynamodb.Table;
  public readonly scanSessionsTable: dynamodb.Table;
  public readonly enforcementActionsTable: dynamodb.Table;
  public readonly overrideRequestsTable: dynamodb.Table;
  public readonly revalidationAttemptsTable: dynamodb.Table;
  public readonly inspectionsTable: dynamodb.Table;
  public readonly mediaAssetsTable: dynamodb.Table;
  public readonly detectionResultsTable: dynamodb.Table;
  public readonly sceneInterpretationsTable: dynamodb.Table;
  public readonly findingsTable: dynamodb.Table;
  public readonly dailyComplianceSummariesTable: dynamodb.Table;
  public readonly auditTrailTable: dynamodb.Table;
  public readonly leadCapturesTable: dynamodb.Table;
  public readonly usersTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  public readonly deviceCacheTable: dynamodb.Table;
  public readonly offlineQueueTable: dynamodb.Table;
  public readonly rateLimitsTable: dynamodb.Table;
  public readonly formsTable: dynamodb.Table;
  public readonly formVersionsTable: dynamodb.Table;
  public readonly formResponsesTable: dynamodb.Table;
  public readonly formAuditLogTable: dynamodb.Table;
  public readonly checkinTokensTable: dynamodb.Table;
  public readonly selfCheckinAuditLogTable: dynamodb.Table;
  public readonly incidentsTable: dynamodb.Table;
  public readonly incidentTimelineTable: dynamodb.Table;
  public readonly incidentRegulatoryDataTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || 'dev';
    const prefix = environment === 'prod' ? '' : `${environment}-`;

    // --- Tenants Table ---
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: `${prefix}Tenants`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    // --- Workers Table ---
    this.workersTable = new dynamodb.Table(this, 'WorkersTable', {
      tableName: `${prefix}Workers`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.workersTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Certifications Table ---
    this.certificationsTable = new dynamodb.Table(this, 'CertificationsTable', {
      tableName: `${prefix}Certifications`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.certificationsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Contractors Table ---
    this.contractorsTable = new dynamodb.Table(this, 'ContractorsTable', {
      tableName: `${prefix}Contractors`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.contractorsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- ContractorWorkers Table ---
    this.contractorWorkersTable = new dynamodb.Table(this, 'ContractorWorkersTable', {
      tableName: `${prefix}ContractorWorkers`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.contractorWorkersTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Sites Table ---
    this.sitesTable = new dynamodb.Table(this, 'SitesTable', {
      tableName: `${prefix}Sites`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    // --- Policies Table ---
    this.policiesTable = new dynamodb.Table(this, 'PoliciesTable', {
      tableName: `${prefix}Policies`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.policiesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- PolicyVersions Table ---
    this.policyVersionsTable = new dynamodb.Table(this, 'PolicyVersionsTable', {
      tableName: `${prefix}PolicyVersions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.policyVersionsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- DecisionRecords Table (append-only, never updated) ---
    this.decisionRecordsTable = new dynamodb.Table(this, 'DecisionRecordsTable', {
      tableName: `${prefix}DecisionRecords`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Always retain — 7-year regulatory requirement
      pointInTimeRecovery: true, // Always enabled for audit compliance
    });

    this.decisionRecordsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.decisionRecordsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- AccessTokens Table (TTL: expiresAt) ---
    this.accessTokensTable = new dynamodb.Table(this, 'AccessTokensTable', {
      tableName: `${prefix}AccessTokens`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    // --- ScanSessions Table ---
    this.scanSessionsTable = new dynamodb.Table(this, 'ScanSessionsTable', {
      tableName: `${prefix}ScanSessions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.scanSessionsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- EnforcementActions Table ---
    this.enforcementActionsTable = new dynamodb.Table(this, 'EnforcementActionsTable', {
      tableName: `${prefix}EnforcementActions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.enforcementActionsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- OverrideRequests Table ---
    this.overrideRequestsTable = new dynamodb.Table(this, 'OverrideRequestsTable', {
      tableName: `${prefix}OverrideRequests`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.overrideRequestsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- RevalidationAttempts Table ---
    this.revalidationAttemptsTable = new dynamodb.Table(this, 'RevalidationAttemptsTable', {
      tableName: `${prefix}RevalidationAttempts`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // --- Inspections Table ---
    this.inspectionsTable = new dynamodb.Table(this, 'InspectionsTable', {
      tableName: `${prefix}Inspections`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.inspectionsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- MediaAssets Table ---
    this.mediaAssetsTable = new dynamodb.Table(this, 'MediaAssetsTable', {
      tableName: `${prefix}MediaAssets`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // --- DetectionResults Table ---
    this.detectionResultsTable = new dynamodb.Table(this, 'DetectionResultsTable', {
      tableName: `${prefix}DetectionResults`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // --- SceneInterpretations Table ---
    this.sceneInterpretationsTable = new dynamodb.Table(this, 'SceneInterpretationsTable', {
      tableName: `${prefix}SceneInterpretations`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // --- Findings Table ---
    this.findingsTable = new dynamodb.Table(this, 'FindingsTable', {
      tableName: `${prefix}Findings`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.findingsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.findingsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- DailyComplianceSummaries Table ---
    this.dailyComplianceSummariesTable = new dynamodb.Table(this, 'DailyComplianceSummariesTable', {
      tableName: `${prefix}DailyComplianceSummaries`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.dailyComplianceSummariesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- AuditTrail Table ---
    this.auditTrailTable = new dynamodb.Table(this, 'AuditTrailTable', {
      tableName: `${prefix}AuditTrail`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Always retain — audit compliance
      pointInTimeRecovery: true, // Always enabled for audit compliance
    });

    this.auditTrailTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- LeadCaptures Table ---
    this.leadCapturesTable = new dynamodb.Table(this, 'LeadCapturesTable', {
      tableName: `${prefix}LeadCaptures`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.leadCapturesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Users Table ---
    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `${prefix}Users`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Sessions Table (TTL: expiresAt, 60 min) ---
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: `${prefix}Sessions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    // --- DeviceCache Table (TTL: expiresAt, 72 hours) ---
    this.deviceCacheTable = new dynamodb.Table(this, 'DeviceCacheTable', {
      tableName: `${prefix}DeviceCache`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    // --- OfflineQueue Table (TTL: expiresAt, 72 hours) ---
    this.offlineQueueTable = new dynamodb.Table(this, 'OfflineQueueTable', {
      tableName: `${prefix}OfflineQueue`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    // --- RateLimits Table (TTL: expiresAt, 1 hour) ---
    this.rateLimitsTable = new dynamodb.Table(this, 'RateLimitsTable', {
      tableName: `${prefix}RateLimits`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    // --- Forms Table ---
    this.formsTable = new dynamodb.Table(this, 'FormsTable', {
      tableName: `${prefix}Forms`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.formsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- FormVersions Table ---
    this.formVersionsTable = new dynamodb.Table(this, 'FormVersionsTable', {
      tableName: `${prefix}FormVersions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    // --- FormResponses Table ---
    this.formResponsesTable = new dynamodb.Table(this, 'FormResponsesTable', {
      tableName: `${prefix}FormResponses`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.formResponsesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- FormAuditLog Table (always RETAIN, always PITR, TTL: expiresAt) ---
    this.formAuditLogTable = new dynamodb.Table(this, 'FormAuditLogTable', {
      tableName: `${prefix}FormAuditLog`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiresAt',
    });

    this.formAuditLogTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- CheckinTokens Table (worker self check-in) ---
    // PK: TENANT#{tenant_id}, SK: CHECKIN_TOKEN#{token_id}
    // GSI1 (public resolution): GSI1PK = TOKEN#{token}
    // GSI2 (active token per site): GSI2PK = SITE#{site_id}, GSI2SK = CHECKIN_TOKEN#{token_kind}
    // ttl auto-cleans expired SMS magic-link tokens.
    this.checkinTokensTable = new dynamodb.Table(this, 'CheckinTokensTable', {
      tableName: `${prefix}CheckinTokens`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
      timeToLiveAttribute: 'ttl',
    });

    this.checkinTokensTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.checkinTokensTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- SelfCheckinAuditLog Table (always RETAIN, always PITR, TTL: expiresAt) ---
    // PK: SITE#{site_id}, SK: AUDIT#{timestamp}#{short_uuid}
    // GSI1 (by tenant): GSI1PK = TENANT#{tenant_id}, GSI1SK = AUDIT#{timestamp}
    this.selfCheckinAuditLogTable = new dynamodb.Table(this, 'SelfCheckinAuditLogTable', {
      tableName: `${prefix}SelfCheckinAuditLog`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiresAt',
    });

    this.selfCheckinAuditLogTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // PK: TENANT#{tenant_id}, SK: INCIDENT#{incident_id}
    // GSI1 (by site): GSI1PK = TENANT#{tenant_id}#SITE#{site_id}, GSI1SK = {created_at}
    // GSI2 (by status): GSI2PK = TENANT#{tenant_id}#STATUS#{status}, GSI2SK = {created_at}
    // GSI3 (by regulatory flag): GSI3PK = TENANT#{tenant_id}#REGFLAG#{regulatory_flag}, GSI3SK = {created_at}
    this.incidentsTable = new dynamodb.Table(this, 'IncidentsTable', {
      tableName: `${prefix}Incidents`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    this.incidentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.incidentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.incidentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- IncidentTimeline Table (append-only, never updated or deleted) ---
    // PK: INCIDENT#{incident_id}, SK: EVENT#{timestamp}#{event_id}
    this.incidentTimelineTable = new dynamodb.Table(this, 'IncidentTimelineTable', {
      tableName: `${prefix}IncidentTimeline`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Always retain — immutable audit trail
      pointInTimeRecovery: true, // Always enabled for audit compliance
    });

    // --- IncidentRegulatoryData Table ---
    // PK: INCIDENT#{incident_id}, SK: REGDATA#{type}
    // type = "worksafebc_employer" | "osha_300" | "worksafebc_emergency"
    this.incidentRegulatoryDataTable = new dynamodb.Table(this, 'IncidentRegulatoryDataTable', {
      tableName: `${prefix}IncidentRegulatoryData`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    // --- Stack Outputs ---
    new cdk.CfnOutput(this, 'TablePrefix', {
      value: prefix,
      description: 'DynamoDB table name prefix for this environment',
    });
  }
}
