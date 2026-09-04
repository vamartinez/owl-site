/**
 * Scheduled Lambda: Daily Summary Trigger
 *
 * Runs at end of day and publishes DailyComplianceSummaryRequested events
 * for each active site, using the site's configured timezone to determine
 * the reporting period (midnight-to-midnight in site timezone).
 *
 * Requirements: 13.1
 */

import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../shared/dynamo-client.js';
import { publishEvent } from '../shared/event-publisher.js';
import { createLogger } from '../shared/logger.js';
import { EventTypes } from '../shared/types/events.js';

const SOURCE_SERVICE = 'daily-summary-trigger';
const logger = createLogger(SOURCE_SERVICE);

/**
 * Represents a site item as stored in DynamoDB.
 */
export interface SiteItem {
  PK: string; // TENANT#{tenantId}
  SK: string; // SITE#{siteId}
  site_id: string;
  tenant_id: string;
  site_name: string;
  timezone: string; // IANA timezone (e.g., 'America/Vancouver')
  status: string; // 'active' | 'inactive'
  [key: string]: unknown;
}

/**
 * Calculates the reporting period (midnight-to-midnight) for a given timezone.
 * Returns the start and end of the previous day in the site's timezone as UTC ISO strings.
 */
export function calculateReportingPeriod(timezone: string, now?: Date): {
  reporting_period_start: string;
  reporting_period_end: string;
} {
  const currentTime = now ?? new Date();

  // Get the current date in the site's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(currentTime);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2024';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';

  // The reporting period is the day that just ended (yesterday in site timezone)
  const todayInSiteTz = new Date(`${year}-${month}-${day}T00:00:00`);
  const yesterdayInSiteTz = new Date(todayInSiteTz.getTime() - 24 * 60 * 60 * 1000);

  const yesterdayYear = yesterdayInSiteTz.getFullYear();
  const yesterdayMonth = String(yesterdayInSiteTz.getMonth() + 1).padStart(2, '0');
  const yesterdayDay = String(yesterdayInSiteTz.getDate()).padStart(2, '0');

  // Convert midnight-to-midnight in site timezone to UTC
  // We use the timezone offset to calculate the UTC equivalent
  const startLocal = `${yesterdayYear}-${yesterdayMonth}-${yesterdayDay}T00:00:00`;
  const endLocal = `${year}-${month}-${day}T00:00:00`;

  // Get UTC offset for the timezone at the start and end times
  const startUtc = localToUtc(startLocal, timezone);
  const endUtc = localToUtc(endLocal, timezone);

  return {
    reporting_period_start: startUtc,
    reporting_period_end: endUtc,
  };
}

/**
 * Converts a local datetime string to UTC ISO string using timezone offset calculation.
 */
export function localToUtc(localDatetime: string, timezone: string): string {
  // Create a date object and use Intl to find the offset
  const date = new Date(localDatetime + 'Z'); // Treat as UTC initially
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });

  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);

  // Offset in milliseconds (positive means timezone is ahead of UTC)
  const offsetMs = tzDate.getTime() - utcDate.getTime();

  // Subtract offset to get UTC time from local time
  const localDate = new Date(localDatetime);
  const utcTime = new Date(localDate.getTime() - offsetMs);

  return utcTime.toISOString();
}

/**
 * Retrieves all active sites from the Sites table.
 */
export async function getActiveSites(): Promise<SiteItem[]> {
  const activeSites: SiteItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName('Sites'),
        FilterExpression: '#status = :active AND begins_with(#sk, :sitePrefix)',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':active': 'active',
          ':sitePrefix': 'SITE#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      activeSites.push(...(result.Items as SiteItem[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return activeSites;
}

/**
 * Publishes a DailyComplianceSummaryRequested event for a site.
 */
export async function publishDailySummaryRequest(
  site: SiteItem,
  reportingPeriod: { reporting_period_start: string; reporting_period_end: string }
): Promise<void> {
  await publishEvent({
    event_type: EventTypes.DAILY_COMPLIANCE_SUMMARY_REQUESTED,
    source_service: SOURCE_SERVICE,
    tenant_id: site.tenant_id,
    payload: {
      site_id: site.site_id,
      tenant_id: site.tenant_id,
      reporting_period_start: reportingPeriod.reporting_period_start,
      reporting_period_end: reportingPeriod.reporting_period_end,
      timezone: site.timezone,
    },
  });
}

/**
 * Main handler for the scheduled daily summary trigger Lambda.
 * Triggered by EventBridge at a regular interval (e.g., every hour)
 * to check which sites have reached end-of-day in their timezone.
 */
export async function handler(): Promise<{
  statusCode: number;
  body: string;
}> {
  const now = new Date();
  logger.info('Running daily summary trigger', { timestamp: now.toISOString() });

  let totalPublished = 0;
  let totalErrors = 0;

  try {
    const activeSites = await getActiveSites();
    logger.info('Active sites found', { count: activeSites.length });

    for (const site of activeSites) {
      try {
        const timezone = site.timezone || 'America/Vancouver';
        const reportingPeriod = calculateReportingPeriod(timezone, now);

        await publishDailySummaryRequest(site, reportingPeriod);
        totalPublished++;

        logger.info('Published daily summary request', {
          site_id: site.site_id,
          tenant_id: site.tenant_id,
          timezone,
          reporting_period_start: reportingPeriod.reporting_period_start,
          reporting_period_end: reportingPeriod.reporting_period_end,
        });
      } catch (error) {
        totalErrors++;
        logger.error('Error publishing summary request for site', {
          site_id: site.site_id,
          tenant_id: site.tenant_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      timestamp: now.toISOString(),
      total_sites: activeSites.length,
      total_published: totalPublished,
      total_errors: totalErrors,
    };

    logger.info('Daily summary trigger completed', summary);

    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (error) {
    logger.error('Fatal error in daily summary trigger', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Daily summary trigger failed',
        timestamp: now.toISOString(),
      }),
    };
  }
}
