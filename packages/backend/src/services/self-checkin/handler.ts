/**
 * Self Check-In Service handler.
 *
 * Routes by httpMethod + resource into two groups:
 *  - AUTHENTICATED (Cognito): site token generate/regenerate, send SMS link.
 *    Each goes through authenticateRequest → enforcePermission.
 *  - PUBLIC (no authorizer): token resolution + identity verify + decision.
 *    Gated by rate limiter + bot detection + sanitizer; no Cognito session.
 *
 * Requirements: 1.1, 1.5, 2.4, 3.4, 3.5, 3.7, 4.5, 6.2, 7.1-7.6
 */

import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  createErrorResponse,
  type ApiGatewayResponse,
} from '../../shared/error-handler.js';
import { createLogger } from '../../shared/logger.js';
import { checkRateLimit } from '../forms/rate-limiter.js';
import { detectBot } from '../forms/sanitizer.js';
import {
  getOrCreateSiteToken,
  regenerateSiteToken,
  resolveToken,
  consumeToken,
} from './checkin-token.js';
import { verifyIdentity } from './identity-verify.js';
import { evaluateCheckin } from './decision-integration.js';
import { sendSmsLink } from './sms-link.js';
import { logCheckinAudit } from './audit.js';
import type { CheckinOrigin, WorkerView } from './types.js';

const logger = createLogger('self-checkin-handler');

const UNIFORM_INVALID = { valid: false, message: 'This check-in link is no longer valid' };
const UNIFORM_IDENTITY_FAIL = { verified: false, message: 'We could not verify your identity' };

interface HandlerEvent extends ApiGatewayEvent {
  httpMethod: string;
  resource: string;
  path?: string;
  pathParameters?: Record<string, string> | null;
  body?: string | null;
}

function getClientIp(event: HandlerEvent): string {
  const ctx = (event as Record<string, unknown>)['requestContext'] as
    | { identity?: { sourceIp?: string } }
    | undefined;
  return ctx?.identity?.sourceIp ?? 'unknown';
}

function parseBody<T>(event: HandlerEvent): T {
  if (!event.body) return {} as T;
  try {
    return JSON.parse(event.body) as T;
  } catch {
    return {} as T;
  }
}

function rateLimited(retryAfterSeconds: number): ApiGatewayResponse {
  return createErrorResponse(429, 'RATE_LIMITED', 'Too many attempts. Please try again shortly.', {
    retry_after_seconds: retryAfterSeconds,
  });
}

// ─── Public flow ────────────────────────────────────────────────────────────

async function handleResolveToken(event: HandlerEvent, token: string): Promise<ApiGatewayResponse> {
  const ip = getClientIp(event);

  const rl = await checkRateLimit(`CHECKIN#${token}`, ip);
  if (!rl.allowed) return rateLimited(rl.retryAfterSeconds ?? 60);

  const resolved = await resolveToken(token);
  if (!resolved) {
    return createSuccessResponse(200, UNIFORM_INVALID);
  }

  await logCheckinAudit({
    action: 'token_resolved',
    origin_channel: resolved.token_kind === 'sms_magic_link' ? 'self_sms' : 'self_qr',
    token_ref: resolved.token_id,
    outcome: 'rejected', // resolution is not itself a decision
    ip_address: ip,
    timestamp: new Date().toISOString(),
    tenant_id: resolved.tenant_id,
    site_id: resolved.site_id,
  });

  // SMS tokens already identify the worker → no challenge required.
  const requiresIdentity = resolved.token_kind !== 'sms_magic_link';
  return createSuccessResponse(200, {
    site_name: resolved.site_id, // site name resolution is a later enrichment
    requires_identity: requiresIdentity,
  });
}

async function handleVerify(event: HandlerEvent, token: string): Promise<ApiGatewayResponse> {
  const ip = getClientIp(event);

  const rl = await checkRateLimit(`CHECKIN#${token}`, ip);
  if (!rl.allowed) return rateLimited(rl.retryAfterSeconds ?? 60);

  const body = parseBody<{
    phone_last4?: string;
    legal_name?: string;
    page_load_ts?: number;
    hp?: string;
  }>(event);

  // Bot detection (honeypot + rapid submission + headers).
  const bot = detectBot({
    userAgent: event.headers['User-Agent'] ?? event.headers['user-agent'],
    origin: event.headers['Origin'] ?? event.headers['origin'],
    referer: event.headers['Referer'] ?? event.headers['referer'],
    honeypotValue: body.hp,
    pageLoadTimestamp: body.page_load_ts,
    submissionTimestamp: Date.now(),
  });
  if (bot.isBot) {
    // Uniform response — no bot-specific disclosure (Requirement 7.5).
    return rateLimited(rl.retryAfterSeconds ?? 60);
  }

  const resolved = await resolveToken(token);
  if (!resolved) {
    return createSuccessResponse(200, UNIFORM_INVALID);
  }

  const origin: CheckinOrigin = resolved.token_kind === 'sms_magic_link' ? 'self_sms' : 'self_qr';

  let workerId: string;

  if (resolved.token_kind === 'sms_magic_link') {
    // SMS flow: token identifies the worker; consume it single-use.
    if (!resolved.worker_id) return createSuccessResponse(200, UNIFORM_INVALID);
    const consumed = await consumeToken(resolved);
    if (!consumed) return createSuccessResponse(200, UNIFORM_INVALID);
    workerId = resolved.worker_id;
  } else {
    // QR flow: last-4-phone + legal name challenge.
    const identity = await verifyIdentity(resolved.tenant_id, {
      phone_last4: body.phone_last4 ?? '',
      legal_name: body.legal_name ?? '',
    });
    if (!identity.verified || !identity.worker_id) {
      await logCheckinAudit({
        action: 'identity_failed',
        origin_channel: origin,
        token_ref: resolved.token_id,
        outcome: 'rejected',
        ip_address: ip,
        timestamp: new Date().toISOString(),
        tenant_id: resolved.tenant_id,
        site_id: resolved.site_id,
      });
      return createSuccessResponse(200, UNIFORM_IDENTITY_FAIL);
    }
    workerId = identity.worker_id;
  }

  const { view } = await evaluateCheckin({
    tenantId: resolved.tenant_id,
    workerId,
    siteId: resolved.site_id,
    tokenId: resolved.token_id,
    origin,
  });

  await logCheckinAudit({
    action: 'decision_returned',
    origin_channel: origin,
    token_ref: resolved.token_id,
    outcome: view.decision,
    ip_address: ip,
    timestamp: new Date().toISOString(),
    tenant_id: resolved.tenant_id,
    site_id: resolved.site_id,
  });

  const responseBody: { verified: true } & WorkerView = { verified: true, ...view };
  return createSuccessResponse(200, responseBody);
}

// ─── Authenticated flow ───────────────────────────────────────────────────────

async function handleSiteToken(
  event: HandlerEvent,
  siteId: string,
  regenerate: boolean
): Promise<ApiGatewayResponse> {
  const auth = authenticateRequest(event);
  if ('error' in auth) return auth.error;
  const perm = enforcePermission(auth.user, 'access:manage_checkin_token');
  if (perm) return perm;

  if (!siteId) return badRequest('siteId is required');

  const token = regenerate
    ? await regenerateSiteToken({ tenantId: auth.user.tenant_id, siteId, createdBy: auth.user.user_id })
    : await getOrCreateSiteToken({ tenantId: auth.user.tenant_id, siteId, createdBy: auth.user.user_id });

  const domain = (process.env['PUBLIC_APP_DOMAIN'] ?? '').replace(/\/+$/, '');
  return createSuccessResponse(200, {
    token: token.token,
    public_url: `${domain}/check-in/${token.token}`,
    created_at: token.created_at,
  });
}

async function handleSendSmsLink(event: HandlerEvent): Promise<ApiGatewayResponse> {
  const auth = authenticateRequest(event);
  if ('error' in auth) return auth.error;
  const perm = enforcePermission(auth.user, 'access:send_checkin_link');
  if (perm) return perm;

  const body = parseBody<{ worker_id?: string; site_id?: string }>(event);
  if (!body.worker_id || !body.site_id) return badRequest('worker_id and site_id are required');

  const ip = getClientIp(event);
  // SMS issuance rate limit per worker + IP.
  const rl = await checkRateLimit(`CHECKINSMS#${body.worker_id}`, ip);
  if (!rl.allowed) return rateLimited(rl.retryAfterSeconds ?? 60);

  const result = await sendSmsLink({
    tenantId: auth.user.tenant_id,
    siteId: body.site_id,
    workerId: body.worker_id,
    createdBy: auth.user.user_id,
  });

  if (!result.sent) {
    return createErrorResponse(502, 'SMS_DELIVERY_FAILED', result.error ?? 'SMS delivery failed', {
      sent: false,
    });
  }
  return createSuccessResponse(200, { sent: true, expires_at: result.expires_at });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handler(event: HandlerEvent): Promise<ApiGatewayResponse> {
  const { httpMethod } = event;
  // event.path carries the concrete request path (proxy routes). Fall back to
  // resource for direct (non-proxy) invocation in tests.
  const path = (event.path ?? event.resource ?? '').replace(/\/+$/, '');
  const proxy = event.pathParameters?.['proxy'] ?? '';

  try {
    // ── Public (no auth): /public/check-in/{token}[/verify] ──
    if (path.startsWith('/public/check-in/')) {
      const rest = path.slice('/public/check-in/'.length);
      const isVerify = rest.endsWith('/verify');
      const token = decodeURIComponent(isVerify ? rest.slice(0, -'/verify'.length) : rest);
      if (httpMethod === 'GET' && !isVerify) {
        return await handleResolveToken(event, token);
      }
      if (httpMethod === 'POST' && isVerify) {
        return await handleVerify(event, token);
      }
      return notFound('Route not found');
    }

    // ── Authenticated: /checkin/sms-link and /checkin/sites/{siteId}/token[/regenerate] ──
    if (path === '/checkin/sms-link' || proxy === 'sms-link') {
      return await handleSendSmsLink(event);
    }
    if (path.startsWith('/checkin/sites/')) {
      const seg = path.slice('/checkin/sites/'.length).split('/');
      const siteId = seg[0] ?? '';
      const regenerate = seg[seg.length - 1] === 'regenerate';
      return await handleSiteToken(event, siteId, regenerate);
    }

    return notFound('Route not found');
  } catch (err) {
    logger.error('Unhandled self-checkin error', {
      path,
      httpMethod,
      error: err instanceof Error ? err.message : String(err),
    });
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
