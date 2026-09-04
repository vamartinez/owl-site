/**
 * Unit tests for the shared per-site compliance helper.
 *
 * Verifies compliancePercent, activeWorkers, and contractor are derived from a
 * site's scan sessions the same way the reporting service's daily-compliance
 * `bySite` loop computes them.
 *
 * Validates: Requirements 3.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  resetDynamoMock,
  getMockSend,
} from '../../../tests/helpers/mock-dynamo';

vi.mock('../dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

import { computeSiteCompliance } from '../site-compliance.js';

const TENANT = 'tenant-abc';
const SITE = 'site-1';

function sessionsQueryKey() {
  return JSON.stringify({
    TableName: 'test-ScanSessions',
    IndexName: undefined,
    ExpressionAttributeValues: {
      ':pk': `TENANT#${TENANT}`,
      ':siteId': SITE,
    },
  });
}

describe('computeSiteCompliance', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 100% compliance and 0 active workers when there are no sessions', async () => {
    setupDynamoMock({ queryResponses: new Map([[sessionsQueryKey(), []]]) });

    const result = await computeSiteCompliance(TENANT, SITE);

    expect(result.compliancePercent).toBe(100);
    expect(result.activeWorkers).toBe(0);
    expect(result.contractor).toBeNull();
  });

  it('computes compliancePercent as allowed / total sessions rounded', async () => {
    const sessions = [
      { worker_id: 'w1', result: 'allowed' },
      { worker_id: 'w2', result: 'allowed' },
      { worker_id: 'w3', result: 'denied' },
    ];
    setupDynamoMock({ queryResponses: new Map([[sessionsQueryKey(), sessions]]) });

    const result = await computeSiteCompliance(TENANT, SITE);

    // 2 allowed / 3 total = 67%
    expect(result.compliancePercent).toBe(67);
  });

  it('counts distinct workers as activeWorkers (no double-counting)', async () => {
    const sessions = [
      { worker_id: 'w1', result: 'allowed' },
      { worker_id: 'w1', result: 'allowed' },
      { worker_id: 'w2', result: 'denied' },
    ];
    setupDynamoMock({ queryResponses: new Map([[sessionsQueryKey(), sessions]]) });

    const result = await computeSiteCompliance(TENANT, SITE);

    expect(result.activeWorkers).toBe(2);
  });

  it('sources contractor from the site record when present', async () => {
    setupDynamoMock({ queryResponses: new Map([[sessionsQueryKey(), []]]) });

    const result = await computeSiteCompliance(TENANT, SITE, {
      contractor: 'Acme Builders',
    });

    expect(result.contractor).toBe('Acme Builders');
  });

  it('falls back to contractor_name and then null', async () => {
    setupDynamoMock({ queryResponses: new Map([[sessionsQueryKey(), []]]) });

    const named = await computeSiteCompliance(TENANT, SITE, {
      contractor_name: 'Beta Contracting',
    });
    expect(named.contractor).toBe('Beta Contracting');

    const none = await computeSiteCompliance(TENANT, SITE, {});
    expect(none.contractor).toBeNull();
  });
});
