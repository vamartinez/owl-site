/**
 * Self Check-In token lifecycle unit tests.
 *
 * Tasks 3.5, 13.1: active/invalidated/expired/consumed resolve outcomes,
 * site-token reuse (existing active token returned, not duplicated),
 * regeneration invalidating the previous token, single-use consumption.
 *
 * Requirements: 1.3, 1.4, 2.3, 4.4, 7.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (n: string) => `dev-${n}`,
}));

import {
  getOrCreateSiteToken,
  regenerateSiteToken,
  resolveToken,
  createSmsToken,
  consumeToken,
} from '../../src/services/self-checkin/checkin-token.js';
import type { CheckinToken } from '../../src/services/self-checkin/types.js';

function siteToken(overrides: Partial<CheckinToken> = {}): CheckinToken {
  return {
    token_id: 'tid-1',
    token: 'pub-1',
    token_kind: 'site_persistent',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    status: 'active',
    created_by: 'admin-1',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockSend.mockReset();
});

describe('getOrCreateSiteToken', () => {
  it('reuses the existing active site token instead of creating a duplicate', async () => {
    // GSI2 query returns an existing active token.
    mockSend.mockResolvedValueOnce({ Items: [siteToken()] });
    const t = await getOrCreateSiteToken({ tenantId: 'tenant-1', siteId: 'site-1', createdBy: 'admin-1' });
    expect(t.token).toBe('pub-1');
    // Only the query happened — no PutCommand for a new token.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('creates a new token when none is active', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }); // no existing
    mockSend.mockResolvedValueOnce({}); // put
    const t = await getOrCreateSiteToken({ tenantId: 'tenant-1', siteId: 'site-1', createdBy: 'admin-1' });
    expect(t.token_kind).toBe('site_persistent');
    expect(t.status).toBe('active');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('regenerateSiteToken', () => {
  it('invalidates the previous active token and issues a new one', async () => {
    mockSend.mockResolvedValueOnce({ Items: [siteToken()] }); // find active
    mockSend.mockResolvedValueOnce({}); // update -> invalidated
    mockSend.mockResolvedValueOnce({}); // put new
    const t = await regenerateSiteToken({ tenantId: 'tenant-1', siteId: 'site-1', createdBy: 'admin-1' });
    expect(t.token).not.toBe('pub-1'); // fresh token
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

describe('resolveToken', () => {
  it('resolves an active site token', async () => {
    mockSend.mockResolvedValueOnce({ Items: [siteToken()] });
    const t = await resolveToken('pub-1');
    expect(t?.token).toBe('pub-1');
  });

  it('returns null for an unknown token', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    expect(await resolveToken('nope')).toBeNull();
  });

  it('returns null for an invalidated token', async () => {
    mockSend.mockResolvedValueOnce({ Items: [siteToken({ status: 'invalidated' })] });
    expect(await resolveToken('pub-1')).toBeNull();
  });

  it('returns null for a consumed token', async () => {
    mockSend.mockResolvedValueOnce({ Items: [siteToken({ status: 'consumed' })] });
    expect(await resolveToken('pub-1')).toBeNull();
  });

  it('returns null for an expired SMS token', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        siteToken({
          token_kind: 'sms_magic_link',
          worker_id: 'w-1',
          status: 'active',
          expires_at: '2000-01-01T00:00:00.000Z', // past
        }),
      ],
    });
    expect(await resolveToken('pub-1')).toBeNull();
  });

  it('resolves a valid, unexpired SMS token', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockSend.mockResolvedValueOnce({
      Items: [
        siteToken({ token_kind: 'sms_magic_link', worker_id: 'w-1', status: 'active', expires_at: future }),
      ],
    });
    const t = await resolveToken('pub-1');
    expect(t?.token_kind).toBe('sms_magic_link');
    expect(t?.worker_id).toBe('w-1');
  });
});

describe('createSmsToken', () => {
  it('creates a single-use token bound to worker + site with expiry and ttl', async () => {
    mockSend.mockResolvedValueOnce({});
    const t = await createSmsToken({ tenantId: 'tenant-1', siteId: 'site-1', workerId: 'w-1', createdBy: 'admin-1' });
    expect(t.token_kind).toBe('sms_magic_link');
    expect(t.worker_id).toBe('w-1');
    expect(t.expires_at).toBeDefined();
    expect(typeof t.ttl).toBe('number');
  });
});

describe('consumeToken', () => {
  it('returns true when the conditional consume succeeds', async () => {
    mockSend.mockResolvedValueOnce({});
    const ok = await consumeToken(siteToken({ token_kind: 'sms_magic_link', worker_id: 'w-1' }));
    expect(ok).toBe(true);
  });

  it('returns false when the token is already consumed (conditional check fails)', async () => {
    mockSend.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));
    const ok = await consumeToken(siteToken({ token_kind: 'sms_magic_link', worker_id: 'w-1' }));
    expect(ok).toBe(false);
  });
});
