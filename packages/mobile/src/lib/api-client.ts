/**
 * API client — mirrors the admin-portal api-client contract.
 *
 * Authenticated calls send `Authorization: <idToken>` + `X-Tenant-Id`, exactly
 * like the web portal. On 401 it tries a single refresh then logs out.
 *
 * Public check-in calls carry NO auth — the token in the URL path is the only
 * credential (backend public surface).
 */
import { config, assertApiConfigured } from './config';
import { useAuthStore } from '../store/auth-store';
import type {
  ResolveTokenResult,
  VerifyResult,
  VerifyRequest,
} from '../features/checkin/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(`API error [${status}]: ${code}`);
    this.name = 'ApiError';
  }
}

function base(): string {
  assertApiConfigured();
  return config.apiUrl.replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
  const state = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.tokens?.idToken) headers['Authorization'] = state.tokens.idToken;
  if (state.tenantId) headers['X-Tenant-Id'] = state.tenantId;
  return headers;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    const state = useAuthStore.getState();
    try {
      await state.refreshSession();
    } catch {
      await state.logout();
    }
    throw new ApiError(401, 'SESSION_EXPIRED');
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    try {
      const body = JSON.parse(await res.text());
      code = (body.code as string) || code;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${base()}${path}`, { headers: authHeaders() });
    return parse<T>(res);
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return parse<T>(res);
  },
};

// ─── Public check-in (no auth) ────────────────────────────────────────────────

async function parsePublic<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    try {
      const body = JSON.parse(await res.text());
      code = (body.code as string) || code;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, code);
  }
  return res.json() as Promise<T>;
}

/** GET /public/check-in/{token} — resolve a scanned token. */
export async function resolveCheckinToken(token: string): Promise<ResolveTokenResult> {
  const res = await fetch(`${base()}/public/check-in/${encodeURIComponent(token)}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return parsePublic<ResolveTokenResult>(res);
}

/** POST /public/check-in/{token}/verify — verify identity and get a decision. */
export async function verifyCheckin(
  token: string,
  body: VerifyRequest
): Promise<VerifyResult> {
  const res = await fetch(`${base()}/public/check-in/${encodeURIComponent(token)}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parsePublic<VerifyResult>(res);
}
