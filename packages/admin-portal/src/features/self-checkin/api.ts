/**
 * API client for the self check-in endpoints.
 *
 * Admin (authenticated) calls go through the shared apiClient (Cognito headers).
 * Public (no-auth) calls use raw fetch — the token in the path is the only
 * credential, exactly like the public-form surface.
 */

import { apiClient } from '@/services/api-client';
import type {
  SiteTokenResponse,
  SendSmsLinkResponse,
  ResolveTokenResult,
  VerifyResult,
  VerifyRequest,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// ─── Admin (authenticated) ──────────────────────────────────────────────────

/** POST /checkin/sites/{siteId}/token — get or create the site's persistent QR token. */
export function getOrCreateSiteToken(siteId: string): Promise<SiteTokenResponse> {
  return apiClient.post<SiteTokenResponse>(`/checkin/sites/${encodeURIComponent(siteId)}/token`);
}

/** POST /checkin/sites/{siteId}/token/regenerate — rotate the site QR token (invalidates the old one). */
export function regenerateSiteToken(siteId: string): Promise<SiteTokenResponse> {
  return apiClient.post<SiteTokenResponse>(
    `/checkin/sites/${encodeURIComponent(siteId)}/token/regenerate`
  );
}

/** POST /checkin/sms-link — send a one-time SMS magic link to a worker for a site. */
export function sendSmsLink(workerId: string, siteId: string): Promise<SendSmsLinkResponse> {
  return apiClient.post<SendSmsLinkResponse>('/checkin/sms-link', {
    worker_id: workerId,
    site_id: siteId,
  });
}

// ─── Public (no auth) ─────────────────────────────────────────────────────────

export class PublicCheckinError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(`Check-in error [${status}]: ${code}`);
    this.name = 'PublicCheckinError';
  }
}

async function parsePublic<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code = 'UNKNOWN_ERROR';
    try {
      const body = JSON.parse(await response.text());
      code = (body.code as string) || code;
    } catch {
      /* non-JSON error */
    }
    throw new PublicCheckinError(response.status, code);
  }
  return response.json() as Promise<T>;
}

/** GET /public/check-in/{token} — resolve a scanned/linked token. */
export async function resolveCheckinToken(token: string): Promise<ResolveTokenResult> {
  const response = await fetch(
    `${API_BASE_URL}/public/check-in/${encodeURIComponent(token)}`,
    { headers: { 'Content-Type': 'application/json' } }
  );
  return parsePublic<ResolveTokenResult>(response);
}

/** POST /public/check-in/{token}/verify — verify identity and get a decision. */
export async function verifyCheckin(
  token: string,
  body: VerifyRequest
): Promise<VerifyResult> {
  const response = await fetch(
    `${API_BASE_URL}/public/check-in/${encodeURIComponent(token)}/verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return parsePublic<VerifyResult>(response);
}
