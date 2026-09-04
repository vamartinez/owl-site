/**
 * Unit tests for Document Explorer handler route matching and auth.
 * Validates: Requirements 1.3, 2.1, 2.2, 2.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiGatewayEvent } from '../../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../../shared/error-handler.js';

// ─── Mock all route handler modules to isolate dispatch testing ───────────────

const mockHandleFolders = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"folders"}' });
const mockHandleSearch = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"search"}' });
const mockHandleMetadata = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"metadata"}' });
const mockHandlePreview = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"preview"}' });
const mockHandleDownload = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"download"}' });
const mockHandleDownloadStatus = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"downloadStatus"}' });
const mockHandleVerifyIntegrity = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"verifyIntegrity"}' });
const mockHandleGetPreferences = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"getPreferences"}' });
const mockHandleSetPreferences = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"setPreferences"}' });
const mockHandleAuditLog = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{"route":"auditLog"}' });

vi.mock('../folder-handler.js', () => ({
  handleFolders: (...args: unknown[]) => mockHandleFolders(...args),
}));
vi.mock('../search-handler.js', () => ({
  handleSearch: (...args: unknown[]) => mockHandleSearch(...args),
}));
vi.mock('../metadata-handler.js', () => ({
  handleMetadata: (...args: unknown[]) => mockHandleMetadata(...args),
}));
vi.mock('../preview-handler.js', () => ({
  handlePreview: (...args: unknown[]) => mockHandlePreview(...args),
}));
vi.mock('../download-handler.js', () => ({
  handleDownload: (...args: unknown[]) => mockHandleDownload(...args),
  handleDownloadStatus: (...args: unknown[]) => mockHandleDownloadStatus(...args),
}));
vi.mock('../integrity-handler.js', () => ({
  handleVerifyIntegrity: (...args: unknown[]) => mockHandleVerifyIntegrity(...args),
}));
vi.mock('../preferences-handler.js', () => ({
  handleGetPreferences: (...args: unknown[]) => mockHandleGetPreferences(...args),
  handleSetPreferences: (...args: unknown[]) => mockHandleSetPreferences(...args),
}));
vi.mock('../audit-handler.js', () => ({
  handleAuditLog: (...args: unknown[]) => mockHandleAuditLog(...args),
}));

// ─── Import handler after mocks ──────────────────────────────────────────────

import { handler } from '../handler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a fake JWT token with given claims (decoded without verification by auth-middleware).
 */
function createFakeJwt(payload: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

/**
 * Creates a valid event for an authenticated tenant_admin user.
 */
function createAuthenticatedEvent(
  httpMethod: string,
  path: string,
  options?: {
    role?: string;
    pathParameters?: Record<string, string> | null;
    body?: string | null;
    queryStringParameters?: Record<string, string>;
  },
): ApiGatewayEvent {
  const role = options?.role ?? 'tenant_admin';
  const token = createFakeJwt({
    sub: 'user-123',
    'custom:role': role,
    'custom:tenant_id': 'tenant-abc',
    'custom:assigned_sites': 'site-1,site-2',
  });

  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    httpMethod,
    resource: path,
    path,
    queryStringParameters: options?.queryStringParameters ?? {},
    pathParameters: options?.pathParameters ?? null,
    body: options?.body ?? null,
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Document Explorer Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Route Dispatch Tests ────────────────────────────────────────────────

  describe('Route dispatch', () => {
    it('GET /documents/folders dispatches to handleFolders', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/folders');
      const response = await handler(event);

      expect(mockHandleFolders).toHaveBeenCalledTimes(1);
      expect(mockHandleFolders).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ user_id: 'user-123', tenant_id: 'tenant-abc' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('GET /documents/search dispatches to handleSearch', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/search');
      const response = await handler(event);

      expect(mockHandleSearch).toHaveBeenCalledTimes(1);
      expect(mockHandleSearch).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('GET /documents/{id}/metadata dispatches to handleMetadata', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/doc-456/metadata', {
        pathParameters: { id: 'doc-456' },
      });
      const response = await handler(event);

      expect(mockHandleMetadata).toHaveBeenCalledTimes(1);
      expect(mockHandleMetadata).toHaveBeenCalledWith(
        'doc-456',
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('GET /documents/{id}/preview dispatches to handlePreview', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/doc-789/preview', {
        pathParameters: { id: 'doc-789' },
      });
      const response = await handler(event);

      expect(mockHandlePreview).toHaveBeenCalledTimes(1);
      expect(mockHandlePreview).toHaveBeenCalledWith(
        'doc-789',
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('POST /documents/download dispatches to handleDownload', async () => {
      const event = createAuthenticatedEvent('POST', '/documents/download');
      const response = await handler(event);

      expect(mockHandleDownload).toHaveBeenCalledTimes(1);
      expect(mockHandleDownload).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('GET /documents/download/{downloadId}/status dispatches to handleDownloadStatus', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/download/dl-001/status', {
        pathParameters: { downloadId: 'dl-001' },
      });
      const response = await handler(event);

      expect(mockHandleDownloadStatus).toHaveBeenCalledTimes(1);
      expect(mockHandleDownloadStatus).toHaveBeenCalledWith(
        'dl-001',
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('POST /documents/{id}/verify-integrity dispatches to handleVerifyIntegrity', async () => {
      const event = createAuthenticatedEvent('POST', '/documents/doc-111/verify-integrity', {
        pathParameters: { id: 'doc-111' },
      });
      const response = await handler(event);

      expect(mockHandleVerifyIntegrity).toHaveBeenCalledTimes(1);
      expect(mockHandleVerifyIntegrity).toHaveBeenCalledWith(
        'doc-111',
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('GET /documents/preferences/organization-mode dispatches to handleGetPreferences', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/preferences/organization-mode');
      const response = await handler(event);

      expect(mockHandleGetPreferences).toHaveBeenCalledTimes(1);
      expect(mockHandleGetPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('PUT /documents/preferences/organization-mode dispatches to handleSetPreferences', async () => {
      const event = createAuthenticatedEvent('PUT', '/documents/preferences/organization-mode');
      const response = await handler(event);

      expect(mockHandleSetPreferences).toHaveBeenCalledTimes(1);
      expect(mockHandleSetPreferences).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('POST /documents/audit-log dispatches to handleAuditLog', async () => {
      const event = createAuthenticatedEvent('POST', '/documents/audit-log');
      const response = await handler(event);

      expect(mockHandleAuditLog).toHaveBeenCalledTimes(1);
      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ user_id: 'user-123' }),
      );
      expect(response.statusCode).toBe(200);
    });

    it('unsupported route returns 400', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/unknown-route');
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.message).toBe('Unsupported route');
    });
  });

  // ─── CORS / OPTIONS Tests ───────────────────────────────────────────────

  describe('OPTIONS preflight', () => {
    it('OPTIONS request returns 200 with CORS headers', async () => {
      const event: ApiGatewayEvent = {
        headers: {},
        httpMethod: 'OPTIONS',
        resource: '/documents/folders',
        path: '/documents/folders',
        queryStringParameters: {},
        pathParameters: null,
        body: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(response.headers['Access-Control-Allow-Headers']).toContain('Authorization');
    });

    it('OPTIONS does not require authentication', async () => {
      const event: ApiGatewayEvent = {
        headers: {},
        httpMethod: 'OPTIONS',
        resource: '/documents/search',
        path: '/documents/search',
        queryStringParameters: {},
        pathParameters: null,
        body: null,
      };

      const response = await handler(event);

      // Should succeed without any auth header
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── Authentication Tests ──────────────────────────────────────────────

  describe('Authentication (401)', () => {
    it('request with no Authorization header returns 401', async () => {
      const event: ApiGatewayEvent = {
        headers: {},
        httpMethod: 'GET',
        resource: '/documents/folders',
        path: '/documents/folders',
        queryStringParameters: {},
        pathParameters: null,
        body: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('request with empty Authorization header returns 401', async () => {
      const event: ApiGatewayEvent = {
        headers: { Authorization: '' },
        httpMethod: 'GET',
        resource: '/documents/folders',
        path: '/documents/folders',
        queryStringParameters: {},
        pathParameters: null,
        body: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('request with invalid Bearer token returns 401', async () => {
      const event: ApiGatewayEvent = {
        headers: { Authorization: 'Bearer invalid-not-jwt' },
        httpMethod: 'GET',
        resource: '/documents/folders',
        path: '/documents/folders',
        queryStringParameters: {},
        pathParameters: null,
        body: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── Authorization Tests (403) ─────────────────────────────────────────

  describe('Authorization (403)', () => {
    it('request with gate_operator role returns 403', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/folders', {
        role: 'gate_operator',
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('Access denied');
    });

    it('request with worker role returns 403', async () => {
      const event = createAuthenticatedEvent('GET', '/documents/folders', {
        role: 'worker',
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('Access denied');
    });

    it('allowed roles do not receive 403', async () => {
      const allowedRoles = ['platform_admin', 'tenant_admin', 'site_admin', 'supervisor', 'cso'];

      for (const role of allowedRoles) {
        const event = createAuthenticatedEvent('GET', '/documents/folders', { role });
        const response = await handler(event);

        expect(response.statusCode).not.toBe(403);
      }
    });
  });
});
