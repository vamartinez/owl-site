/**
 * Daily Compliance Summary Generator.
 * Aggregates access decisions, findings, enforcement actions, and certification status
 * for a given site and reporting period.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.6
 */

import { v4 as uuidv4 } from 'uuid';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { DecisionResult, FindingStatus, CertificationStatus } from '../../shared/types/common.js';
import type {
  DailyComplianceSummary,
  AccessDecisionCounts,
  FindingCounts,
  UnresolvedEnforcementSummary,
  EnforcementActionSummaryItem,
  CertificationComplianceItem,
  PolicyVersionReference,
  AINarrative,
  WorkerComplianceSummary,
  WorkerCertificationSummary,
  RecentAccessDecision,
} from './types.js';

/**
 * Generates a Daily Compliance Summary for a site and reporting period.
 * Requirement 13.1: Generate within 60s of request.
 * Requirement 13.6: If no data, return zero counts with "no activity recorded".
 */
export async function generateDailyComplianceSummary(
  tenantId: string,
  siteId: string,
  reportingPeriodStart: string,
  reportingPeriodEnd: string
): Promise<DailyComplianceSummary> {
  const [accessDecisions, findings, unresolvedEnforcement, certCompliance, activePolicies] =
    await Promise.all([
      aggregateAccessDecisions(tenantId, siteId, reportingPeriodStart, reportingPeriodEnd),
      aggregateFindings(tenantId, siteId, reportingPeriodStart, reportingPeriodEnd),
      aggregateUnresolvedEnforcementActions(tenantId, siteId, reportingPeriodEnd),
      aggregateCertificationCompliance(tenantId, siteId),
      getActivePolicyVersions(tenantId, siteId, reportingPeriodStart, reportingPeriodEnd),
    ]);

  const noActivity =
    accessDecisions.total === 0 && findings.total === 0 && unresolvedEnforcement.count === 0;

  const aiNarrative = generateAINarrative(
    accessDecisions,
    findings,
    unresolvedEnforcement,
    certCompliance,
    noActivity
  );

  const summary: DailyComplianceSummary = {
    summary_id: uuidv4(),
    tenant_id: tenantId,
    site_id: siteId,
    reporting_period_start: reportingPeriodStart,
    reporting_period_end: reportingPeriodEnd,
    generated_at: new Date().toISOString(),
    access_decisions: accessDecisions,
    findings,
    unresolved_enforcement_actions: unresolvedEnforcement,
    certification_compliance: certCompliance,
    active_policy_versions: activePolicies,
    ai_narrative: aiNarrative,
    no_activity: noActivity,
  };

  // Store the summary in DynamoDB
  await storeSummary(summary);

  return summary;
}

/**
 * Aggregates access decision counts for the reporting period.
 */
export async function aggregateAccessDecisions(
  tenantId: string,
  siteId: string,
  periodStart: string,
  periodEnd: string
): Promise<AccessDecisionCounts> {
  const tableName = getTableName('DecisionRecords');

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
          ':start': periodStart,
          ':end': periodEnd,
        },
      })
    );

    const items = result.Items ?? [];
    const counts: AccessDecisionCounts = {
      allowed: 0,
      conditional: 0,
      denied: 0,
      total: items.length,
    };

    for (const item of items) {
      const decision = item['decision'] as string;
      if (decision === DecisionResult.ALLOWED) counts.allowed++;
      else if (decision === DecisionResult.CONDITIONAL) counts.conditional++;
      else if (decision === DecisionResult.DENIED) counts.denied++;
    }

    return counts;
  } catch (error) {
    console.error('Error aggregating access decisions:', error);
    return { allowed: 0, conditional: 0, denied: 0, total: 0 };
  }
}

/**
 * Aggregates finding counts for the reporting period.
 */
export async function aggregateFindings(
  tenantId: string,
  siteId: string,
  periodStart: string,
  periodEnd: string
): Promise<FindingCounts> {
  const tableName = getTableName('Findings');

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
          ':start': periodStart,
          ':end': periodEnd,
        },
      })
    );

    const items = result.Items ?? [];
    const counts: FindingCounts = {
      generated: 0,
      confirmed: 0,
      dismissed: 0,
      pending_review: 0,
      total: items.length,
    };

    for (const item of items) {
      const status = item['status'] as string;
      if (status === FindingStatus.GENERATED) counts.generated++;
      else if (status === FindingStatus.CONFIRMED) counts.confirmed++;
      else if (status === FindingStatus.DISMISSED) counts.dismissed++;
      else if (status === FindingStatus.PENDING_REVIEW) counts.pending_review++;
    }

    return counts;
  } catch (error) {
    console.error('Error aggregating findings:', error);
    return { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 };
  }
}

/**
 * Aggregates unresolved enforcement actions (not resolved or dismissed by end of period).
 */
export async function aggregateUnresolvedEnforcementActions(
  tenantId: string,
  siteId: string,
  periodEnd: string
): Promise<UnresolvedEnforcementSummary> {
  const tableName = getTableName('EnforcementActions');

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK <= :end',
        FilterExpression: '#status IN (:pending, :inProgress, :escalated)',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
          ':end': periodEnd,
          ':pending': 'pending',
          ':inProgress': 'in_progress',
          ':escalated': 'escalated',
        },
      })
    );

    const items = result.Items ?? [];
    const actions: EnforcementActionSummaryItem[] = items.map((item) => ({
      enforcement_action_id: item['enforcement_action_id'] as string,
      action_type: item['action_type'] as string,
      status: item['status'] as string,
      created_at: item['created_at'] as string,
      worker_id: item['worker_id'] as string | undefined,
      finding_id: item['finding_id'] as string | undefined,
    }));

    return { count: actions.length, actions };
  } catch (error) {
    console.error('Error aggregating enforcement actions:', error);
    return { count: 0, actions: [] };
  }
}

/**
 * Aggregates certification compliance status for workers at the site.
 */
export async function aggregateCertificationCompliance(
  tenantId: string,
  siteId: string
): Promise<CertificationComplianceItem[]> {
  const tableName = getTableName('Certifications');

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
        },
      })
    );

    const items = result.Items ?? [];
    return items.map((item) => {
      const status = item['status'] as CertificationStatus;
      let complianceStatus: 'compliant' | 'non_compliant' | 'expired';

      if (status === CertificationStatus.EXPIRED) {
        complianceStatus = 'expired';
      } else if (status === CertificationStatus.VALIDATED) {
        complianceStatus = 'compliant';
      } else {
        complianceStatus = 'non_compliant';
      }

      return {
        worker_id: item['worker_id'] as string,
        worker_name: (item['worker_name'] as string) ?? 'Unknown',
        certification_type: item['certification_type'] as string,
        status,
        compliance_status: complianceStatus,
        expiry_date: item['expiry_date'] as string | undefined,
      };
    });
  } catch (error) {
    console.error('Error aggregating certification compliance:', error);
    return [];
  }
}

/**
 * Gets active PolicyVersions during the reporting period.
 * Requirement 13.3.
 */
export async function getActivePolicyVersions(
  tenantId: string,
  siteId: string,
  periodStart: string,
  periodEnd: string
): Promise<PolicyVersionReference[]> {
  const tableName = getTableName('PolicyVersions');

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK <= :end',
        FilterExpression: 'effective_from <= :periodEnd AND (attribute_not_exists(effective_to) OR effective_to >= :periodStart)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
          ':end': periodEnd,
          ':periodEnd': periodEnd,
          ':periodStart': periodStart,
        },
      })
    );

    const items = result.Items ?? [];
    return items.map((item) => ({
      policy_id: item['policy_id'] as string,
      policy_version_id: item['policy_version_id'] as string,
      version_number: item['version_number'] as number,
      effective_from: item['effective_from'] as string,
      policy_name: item['policy_name'] as string | undefined,
    }));
  } catch (error) {
    console.error('Error getting active policy versions:', error);
    return [];
  }
}

/**
 * Generates an AI narrative summarizing the compliance data.
 */
export function generateAINarrative(
  accessDecisions: AccessDecisionCounts,
  findings: FindingCounts,
  unresolvedEnforcement: UnresolvedEnforcementSummary,
  certCompliance: CertificationComplianceItem[],
  noActivity: boolean
): AINarrative {
  if (noActivity) {
    return {
      summary_text: 'No activity was recorded for this site during the reporting period.',
      key_observations: ['No access requests processed', 'No findings generated'],
      regulatory_highlights: [],
      risk_trend: 'stable',
      recommended_focus_areas: [],
    };
  }

  const keyObservations: string[] = [];
  const regulatoryHighlights: string[] = [];
  const recommendedFocusAreas: string[] = [];

  // Access decision observations
  if (accessDecisions.denied > 0) {
    keyObservations.push(
      `${accessDecisions.denied} access request(s) denied out of ${accessDecisions.total} total`
    );
  }
  if (accessDecisions.conditional > 0) {
    keyObservations.push(
      `${accessDecisions.conditional} conditional access grant(s) requiring follow-up`
    );
  }

  // Finding observations
  if (findings.confirmed > 0) {
    keyObservations.push(`${findings.confirmed} safety finding(s) confirmed`);
    regulatoryHighlights.push('Confirmed findings require corrective action tracking');
  }
  if (findings.pending_review > 0) {
    keyObservations.push(`${findings.pending_review} finding(s) awaiting review`);
    recommendedFocusAreas.push('Review pending safety findings');
  }

  // Enforcement observations
  if (unresolvedEnforcement.count > 0) {
    keyObservations.push(
      `${unresolvedEnforcement.count} unresolved enforcement action(s)`
    );
    recommendedFocusAreas.push('Resolve outstanding enforcement actions');
  }

  // Certification observations
  const expiredCerts = certCompliance.filter((c) => c.compliance_status === 'expired');
  const nonCompliant = certCompliance.filter((c) => c.compliance_status === 'non_compliant');
  if (expiredCerts.length > 0) {
    keyObservations.push(`${expiredCerts.length} expired certification(s) detected`);
    recommendedFocusAreas.push('Follow up on expired certifications');
  }
  if (nonCompliant.length > 0) {
    regulatoryHighlights.push(
      `${nonCompliant.length} worker(s) with non-compliant certification status`
    );
  }

  // Determine risk trend
  let riskTrend: 'improving' | 'stable' | 'worsening' = 'stable';
  const riskIndicators =
    accessDecisions.denied + findings.confirmed + unresolvedEnforcement.count + expiredCerts.length;
  if (riskIndicators > 5) {
    riskTrend = 'worsening';
  } else if (riskIndicators === 0) {
    riskTrend = 'improving';
  }

  // Generate summary text
  const summaryParts: string[] = [];
  summaryParts.push(
    `Site processed ${accessDecisions.total} access request(s) with ${accessDecisions.allowed} approved.`
  );
  if (findings.total > 0) {
    summaryParts.push(`${findings.total} safety finding(s) were generated during the period.`);
  }
  if (unresolvedEnforcement.count > 0) {
    summaryParts.push(
      `${unresolvedEnforcement.count} enforcement action(s) remain unresolved.`
    );
  }

  return {
    summary_text: summaryParts.join(' '),
    key_observations: keyObservations,
    regulatory_highlights: regulatoryHighlights,
    risk_trend: riskTrend,
    recommended_focus_areas: recommendedFocusAreas,
  };
}

/**
 * Stores the generated summary in DynamoDB.
 */
async function storeSummary(summary: DailyComplianceSummary): Promise<void> {
  const tableName = getTableName('DailyComplianceSummaries');

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `TENANT#${summary.tenant_id}#SITE#${summary.site_id}`,
        SK: `SUMMARY#${summary.summary_id}`,
        GSI1PK: `TENANT#${summary.tenant_id}#SITE#${summary.site_id}`,
        GSI1SK: summary.reporting_period_start,
        ...summary,
      },
    })
  );
}

/**
 * Generates a worker compliance summary.
 */
export async function generateWorkerComplianceSummary(
  tenantId: string,
  workerId: string
): Promise<WorkerComplianceSummary | null> {
  const workersTable = getTableName('Workers');
  const certsTable = getTableName('Certifications');
  const decisionsTable = getTableName('DecisionRecords');

  try {
    // Get worker info
    const workerResult = await docClient.send(
      new QueryCommand({
        TableName: workersTable,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': `WORKER#${workerId}`,
        },
      })
    );

    const worker = workerResult.Items?.[0];
    if (!worker) return null;

    // Get certifications
    const certResult = await docClient.send(
      new QueryCommand({
        TableName: certsTable,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `WORKER#${workerId}`,
        },
      })
    );

    const certItems = certResult.Items ?? [];
    const certifications: WorkerCertificationSummary[] = certItems.map((item) => {
      const expiryDate = item['expiry_date'] as string | undefined;
      let daysUntilExpiry: number | undefined;
      if (expiryDate) {
        const diff = new Date(expiryDate).getTime() - Date.now();
        daysUntilExpiry = Math.ceil(diff / (1000 * 60 * 60 * 24));
      }
      return {
        certification_id: item['certification_id'] as string,
        certification_type: item['certification_type'] as string,
        status: item['status'] as CertificationStatus,
        expiry_date: expiryDate,
        days_until_expiry: daysUntilExpiry,
      };
    });

    // Get recent access decisions (last 10)
    const decisionResult = await docClient.send(
      new QueryCommand({
        TableName: decisionsTable,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#WORKER#${workerId}`,
        },
        ScanIndexForward: false,
        Limit: 10,
      })
    );

    const decisionItems = decisionResult.Items ?? [];
    const recentDecisions: RecentAccessDecision[] = decisionItems.map((item) => ({
      decision_id: item['decision_id'] as string,
      site_id: item['site_id'] as string,
      result: item['decision'] as DecisionResult,
      timestamp: item['timestamp'] as string,
      reasons: item['reasons'] as string[] | undefined,
    }));

    // Determine overall status
    const hasExpired = certifications.some((c) => c.status === CertificationStatus.EXPIRED);
    const hasNonCompliant = certifications.some(
      (c) => c.status === CertificationStatus.PENDING || c.status === CertificationStatus.REJECTED
    );

    let overallStatus: 'compliant' | 'non_compliant' | 'expired';
    if (hasExpired) {
      overallStatus = 'expired';
    } else if (hasNonCompliant) {
      overallStatus = 'non_compliant';
    } else {
      overallStatus = 'compliant';
    }

    // Count active enforcement actions
    const enforcementTable = getTableName('EnforcementActions');
    const enforcementResult = await docClient.send(
      new QueryCommand({
        TableName: enforcementTable,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        FilterExpression: '#status IN (:pending, :inProgress)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#WORKER#${workerId}`,
          ':pending': 'pending',
          ':inProgress': 'in_progress',
        },
      })
    );

    return {
      worker_id: workerId,
      tenant_id: tenantId,
      worker_name: (worker['legal_name'] as string) ?? 'Unknown',
      overall_status: overallStatus,
      certifications,
      recent_access_decisions: recentDecisions,
      active_enforcement_actions: enforcementResult.Items?.length ?? 0,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error generating worker compliance summary:', error);
    return null;
  }
}
