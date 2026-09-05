// @vitest-environment jsdom
/**
 * Tests for the self check-in API client.
 *
 * Public calls (resolve/verify) use raw fetch — we mock global.fetch.
 * Admin calls go through the shared apiClient — we mock that module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the shared apiClient BEFORE importing the module under test.
vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/services/api-client';
import {
  resolveCheckinToken,
  verifyCheckin,
  getOrCreateSiteToken,
  regenerateSiteToken,
  sendSmsLink,
  PublicCheckinError,
} from '../api';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(apiClient.post).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Public: resolveCheckinToken ─────────────────────────────────────────────

describe('resolveCheckinToken', () => {
  it('resolves a valid token to site + identity requirement', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ site_name: 'Downtown Tower', requires_identity: true }),
    });

    const result = await resolveCheckinToken('tok-123');

    expect(result).toEqual({ site_name: 'Downtown Tower', requires_identity: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/public/check-in/tok-123'),
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  it('passes through the uniform invalid-token response (200 body)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: false, message: 'This check-in link is no longer valid' }),
    });

    const result = await resolveCheckinToken('bad');
    expect(result).toEqual({ valid: false, message: 'This check-in link is no longer valid' });
  });

  it('url-encodes the token', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await resolveCheckinToken('a/b c');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/public/check-in/a%2Fb%20c'),
      expect.anything()
    );
  });

  it('throws PublicCheckinError on a non-ok HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ code: 'INTERNAL_ERROR' })),
    });

    await expect(resolveCheckinToken('tok')).rejects.toMatchObject({
      name: 'PublicCheckinError',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('tolerates a non-JSON error body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve('<html>gateway</html>'),
    });

    await expect(resolveCheckinToken('tok')).rejects.toMatchObject({
      status: 502,
      code: 'UNKNOWN_ERROR',
    });
  });
});

// ─── Public: verifyCheckin ────────────────────────────────────────────────────

describe('verifyCheckin', () => {
  it('POSTs the identity challenge + anti-bot fields and returns the decision', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          verified: true,
          decision: 'allowed',
          reasons: ['All certifications valid'],
          required_actions: [],
        }),
    });

    const result = await verifyCheckin('tok-9', {
      phone_last4: '1234',
      legal_name: 'Jane Doe',
      page_load_ts: 1000,
      hp: undefined,
    });

    expect(result).toMatchObject({ verified: true, decision: 'allowed' });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain('/public/check-in/tok-9/verify');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      phone_last4: '1234',
      legal_name: 'Jane Doe',
      page_load_ts: 1000,
    });
  });

  it('passes through the uniform identity-failed response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: false, message: 'We could not verify your identity' }),
    });

    const result = await verifyCheckin('tok', { page_load_ts: 1 });
    expect(result).toEqual({ verified: false, message: 'We could not verify your identity' });
  });

  it('surfaces a 429 rate-limit as a PublicCheckinError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve(JSON.stringify({ code: 'RATE_LIMITED' })),
    });

    await expect(verifyCheckin('tok', { page_load_ts: 1 })).rejects.toBeInstanceOf(PublicCheckinError);
    await expect(verifyCheckin('tok', { page_load_ts: 1 }).catch((e) => e)).resolves; // no unhandled
  });
});

// ─── Admin: token + SMS ───────────────────────────────────────────────────────

describe('admin site token calls', () => {
  it('getOrCreateSiteToken POSTs the site token path', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      token: 't',
      public_url: 'https://app/check-in/t',
      created_at: '2026-09-04T00:00:00Z',
    });

    const res = await getOrCreateSiteToken('site-1');

    expect(apiClient.post).toHaveBeenCalledWith('/checkin/sites/site-1/token');
    expect(res.public_url).toContain('/check-in/t');
  });

  it('regenerateSiteToken POSTs the regenerate path', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      token: 't2',
      public_url: 'https://app/check-in/t2',
      created_at: '2026-09-04T00:00:00Z',
    });

    await regenerateSiteToken('site-1');
    expect(apiClient.post).toHaveBeenCalledWith('/checkin/sites/site-1/token/regenerate');
  });

  it('encodes the siteId in the path', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ token: 't', public_url: 'u', created_at: 'c' });
    await getOrCreateSiteToken('a b');
    expect(apiClient.post).toHaveBeenCalledWith('/checkin/sites/a%20b/token');
  });

  it('sendSmsLink POSTs worker_id + site_id', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ sent: true, expires_at: '2026-09-04T02:00:00Z' });

    const res = await sendSmsLink('worker-7', 'site-1');

    expect(apiClient.post).toHaveBeenCalledWith('/checkin/sms-link', {
      worker_id: 'worker-7',
      site_id: 'site-1',
    });
    expect(res.sent).toBe(true);
  });
});
