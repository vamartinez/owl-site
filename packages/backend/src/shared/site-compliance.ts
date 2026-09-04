/**
 * Shared per-site compliance computation.
 *
 * Extracted from the reporting service's `handleComplianceSummary` `bySite`
 * loop so the same calculation can be reused by any service (policy site
 * handlers, reporting, and future consumers) without duplicating the
 * ScanSessions query/aggregation logic.
 *
 * Follows the same cross-service sharing pattern as `getTableName`
 * (dynamo-client.ts) and `enforcePermission` (rbac.ts): a plain module under
 * `shared/` imported by each service.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './dynamo-client.js';

/**
 * Compliance metrics for a single site, derived from its scan sessions.
 */
export interface SiteCompliance {
  /** Number of distinct workers with at least one scan session at the site. */
  activeWorkers: number;
  /**
   * Percentage of scan sessions that resulted in an `allowed` decision.
   * Defaults to 100 when the site has no sessions (nothing has been denied).
   */
  compliancePercent: number;
  /** Assigned contractor name/id, when the site record carries one. */
  contractor: string | null;
}

/**
 * Computes per-site compliance the same way the reporting service's
 * daily-compliance-summary `bySite` loop does: from the site's scan sessions,
 * `compliancePercent = round(allowed / total * 100)` (100 when there are no
 * sessions). `activeWorkers` is the count of distinct workers seen in those
 * sessions.
 *
 * @param tenantId  The tenant that owns the site.
 * @param siteId    The site to compute compliance for.
 * @param siteItem  Optional raw site record; used to source a `contractor`
 *                  value if one is stored on the site.
 */
export async function computeSiteCompliance(
  tenantId: string,
  siteId: string,
  siteItem?: Record<string, unknown>
): Promise<SiteCompliance> {
  const sessionsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#siteId = :siteId',
      ExpressionAttributeNames: { '#siteId': 'site_id' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':siteId': siteId,
      },
      Limit: 100,
    })
  );

  const sessions = sessionsResult.Items ?? [];
  const totalSessions = sessions.length;
  const allowedSessions = sessions.filter(
    (s: Record<string, unknown>) => s['result'] === 'allowed'
  ).length;

  const compliancePercent =
    totalSessions > 0 ? Math.round((allowedSessions / totalSessions) * 100) : 100;

  const activeWorkers = new Set(
    sessions
      .map((s: Record<string, unknown>) => s['worker_id'] as string | undefined)
      .filter((id): id is string => Boolean(id))
  ).size;

  const contractor =
    (siteItem?.['contractor'] as string | undefined) ??
    (siteItem?.['contractor_name'] as string | undefined) ??
    null;

  return { activeWorkers, compliancePercent, contractor };
}
