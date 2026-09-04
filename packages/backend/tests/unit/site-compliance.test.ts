/**
 * Unit tests for the shared per-site compliance helper (`computeSiteCompliance`).
 *
 * This helper is the one reused by both `handleListSites` and `handleGetSite`
 * (policy service) to populate each site row's `activeWorkers`,
 * `compliancePercent`, and `contractor` fields (Requirement 6.1). These tests
 * cover the aggregation math over scan sessions plus the contractor sourcing
 * and empty-data defaults.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DynamoDB client before importing the module under test.
const mockSend = vi.fn();
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (name: string) => `dev-${name}`,
}));

import { computeSiteCompliance } from '../../src/shared/site-compliance.js';

/** Builds a mock ScanSessions query response. */
function sessionsResponse(items: Array<Record<string, unknown>>) {
  return { Items: items };
}

describe('computeSiteCompliance', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('counts distinct workers and computes allowed/total compliance percent', async () => {
    mockSend.mockResolvedValueOnce(
      sessionsResponse([
        { worker_id: 'w-1', result: 'allowed' },
        { worker_id: 'w-2', result: 'allowed' },
        { worker_id: 'w-1', result: 'denied' }, // same worker again -> still 2 distinct
        { worker_id: 'w-3', result: 'denied' },
      ])
    );

    const result = await computeSiteCompliance('tenant-1', 'site-1');

    // 3 distinct workers (w-1, w-2, w-3)
    expect(result.activeWorkers).toBe(3);
    // 2 allowed of 4 total -> 50%
    expect(result.compliancePercent).toBe(50);
    expect(result.contractor).toBeNull();
  });

  it('defaults to 100% compliance and 0 workers when the site has no sessions', async () => {
    mockSend.mockResolvedValueOnce(sessionsResponse([]));

    const result = await computeSiteCompliance('tenant-1', 'site-empty');

    expect(result.activeWorkers).toBe(0);
    expect(result.compliancePercent).toBe(100);
    expect(result.contractor).toBeNull();
  });

  it('rounds the compliance percentage to the nearest whole number', async () => {
    // 2 allowed of 3 total -> 66.67% -> rounds to 67
    mockSend.mockResolvedValueOnce(
      sessionsResponse([
        { worker_id: 'w-1', result: 'allowed' },
        { worker_id: 'w-2', result: 'allowed' },
        { worker_id: 'w-3', result: 'denied' },
      ])
    );

    const result = await computeSiteCompliance('tenant-1', 'site-round');

    expect(result.compliancePercent).toBe(67);
  });

  it('ignores sessions with no worker_id when counting distinct workers', async () => {
    mockSend.mockResolvedValueOnce(
      sessionsResponse([
        { worker_id: 'w-1', result: 'allowed' },
        { result: 'allowed' }, // missing worker_id -> not counted
        { worker_id: undefined, result: 'denied' },
      ])
    );

    const result = await computeSiteCompliance('tenant-1', 'site-partial');

    expect(result.activeWorkers).toBe(1);
  });

  it('sources contractor from the site record `contractor` field when present', async () => {
    mockSend.mockResolvedValueOnce(sessionsResponse([]));

    const result = await computeSiteCompliance('tenant-1', 'site-c', {
      contractor: 'Acme Construction Ltd',
    });

    expect(result.contractor).toBe('Acme Construction Ltd');
  });

  it('falls back to the site record `contractor_name` field when `contractor` is absent', async () => {
    mockSend.mockResolvedValueOnce(sessionsResponse([]));

    const result = await computeSiteCompliance('tenant-1', 'site-cn', {
      contractor_name: 'Beta Builders Inc',
    });

    expect(result.contractor).toBe('Beta Builders Inc');
  });

  it('treats an absent Items array as no sessions', async () => {
    mockSend.mockResolvedValueOnce({}); // no Items key

    const result = await computeSiteCompliance('tenant-1', 'site-noitems');

    expect(result.activeWorkers).toBe(0);
    expect(result.compliancePercent).toBe(100);
  });
});
