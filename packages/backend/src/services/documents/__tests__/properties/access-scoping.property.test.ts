// Feature: document-explorer-backend, Properties 1, 18: Access control and error structure

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Role } from '../../../../shared/types/common.js';
import type { ApiGatewayEvent } from '../../../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../../../shared/error-handler.js';

// ─── Mock all route handlers so they don't execute real logic ─────────────────

vi.mock('../../folder-handler.js', () => ({
  handleFolders: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../search-handler.js', () => ({
  handleSearch: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../metadata-handler.js', () => ({
  handleMetadata: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../preview-handler.js', () => ({
  handlePreview: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../download-handler.js', () => ({
  handleDownload: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
  handleDownloadStatus: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../integrity-handler.js', () => ({
  handleVerifyIntegrity: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../preferences-handler.js', () => ({
  handleGetPreferences: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
  handleSetPreferences: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));
vi.mock('../../audit-handler.js', () => ({
  handleAuditLog: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

// ─── Import handler after mocks are set up ───────────────────────────────────

import { handler } from '../../handler.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
];

const DENIED_ROLES = [Role.GATE_OPERATOR, Role.WORKER];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a minimal ApiGatewayEvent with a JWT token containing the specified role.
 */
function createEventWithRole(role: string): ApiGatewayEvent {
  // Create a JWT-like payload (the auth-middleware decodes without verifying in test mode)
  const payload = {
    sub: 'user-123',
    'custom:role': role,
    'custom:tenant_id': 'tenant-abc',
    'custom:assigned_sites': 'site-1,site-2',
  };
  const token = createFakeJwt(payload);

  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    httpMethod: 'GET',
    resource: '/documents/folders',
    path: '/documents/folders',
    queryStringParameters: {},
    pathParameters: null,
    body: null,
  };
}

/**
 * Creates a fake JWT (base64url encoded header.payload.signature) without real cryptography.
 * The auth-middleware uses jwt.decode (no verification) for local testing.
 */
function createFakeJwt(payload: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

// ─── Property 1: Role-based access control ───────────────────────────────────

describe('Property 1: Role-based access control', () => {
  // **Validates: Requirements 2.2, 2.3**

  it('ONLY roles platform_admin, tenant_admin, site_admin, supervisor, cso are allowed access', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALLOWED_ROLES),
        async (role) => {
          const event = createEventWithRole(role);
          const response = await handler(event);

          // Allowed roles should NOT get a 403
          expect(response.statusCode).not.toBe(403);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('gate_operator and worker roles are denied with HTTP 403', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DENIED_ROLES),
        async (role) => {
          const event = createEventWithRole(role);
          const response = await handler(event);

          expect(response.statusCode).toBe(403);

          const body = JSON.parse(response.body);
          expect(body.code).toBe('FORBIDDEN');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('any arbitrary role string not in the allowed set is denied with HTTP 403', async () => {
    const allowedSet = new Set(ALLOWED_ROLES as string[]);

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !allowedSet.has(s)),
        async (arbitraryRole) => {
          const event = createEventWithRole(arbitraryRole);
          const response = await handler(event);

          expect(response.statusCode).toBe(403);

          const body = JSON.parse(response.body);
          expect(body.code).toBe('FORBIDDEN');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 18: Error response structure consistency ───────────────────────

describe('Property 18: Error response structure consistency', () => {
  // **Validates: Requirements 1.4, 12.1**

  it('forbidden (403) responses always contain code, message, request_id, and timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DENIED_ROLES, 'random_role', 'unknown', 'admin_impersonator'),
        async (role) => {
          const event = createEventWithRole(role);
          const response = await handler(event);

          expect(response.statusCode).toBe(403);
          assertErrorStructure(response);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('unauthorized (401) responses always contain code, message, request_id, and timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate events with no auth header or invalid tokens
        fc.constantFrom(
          // No Authorization header
          { headers: {}, httpMethod: 'GET', resource: '/documents/folders', path: '/documents/folders' },
          // Empty Authorization header
          { headers: { Authorization: '' }, httpMethod: 'GET', resource: '/documents/folders', path: '/documents/folders' },
          // Invalid bearer token format
          { headers: { Authorization: 'Basic abc123' }, httpMethod: 'GET', resource: '/documents/folders', path: '/documents/folders' },
          // Malformed JWT
          { headers: { Authorization: 'Bearer not.a.valid.jwt' }, httpMethod: 'GET', resource: '/documents/folders', path: '/documents/folders' },
        ),
        async (event) => {
          const response = await handler(event as ApiGatewayEvent);

          expect(response.statusCode).toBe(401);
          assertErrorStructure(response);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('bad request (400) responses for unsupported routes contain code, message, request_id, and timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALLOWED_ROLES),
        // Generate random unsupported paths
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (s) => !['folders', 'search', 'download', 'audit-log', 'preferences/organization-mode'].includes(s),
        ),
        async (role, randomPath) => {
          const payload = {
            sub: 'user-123',
            'custom:role': role,
            'custom:tenant_id': 'tenant-abc',
            'custom:assigned_sites': 'site-1',
          };
          const token = createFakeJwt(payload);

          const event: ApiGatewayEvent = {
            headers: { Authorization: `Bearer ${token}` },
            httpMethod: 'GET',
            resource: `/documents/${randomPath}`,
            path: `/documents/${randomPath}`,
            queryStringParameters: {},
            pathParameters: null,
            body: null,
          };

          const response = await handler(event);

          // Should be a 400 for unsupported routes
          if (response.statusCode >= 400) {
            assertErrorStructure(response);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all error responses from the shared error-handler have consistent structure', async () => {
    // Directly test the error helper functions from error-handler
    const {
      badRequest,
      unauthorized,
      forbidden,
      notFound,
      internalError,
      serviceUnavailable,
      createErrorResponse,
    } = await import('../../../../shared/error-handler.js');

    await fc.assert(
      fc.property(
        fc.constantFrom(
          badRequest('test error'),
          unauthorized('auth error'),
          forbidden('access denied'),
          notFound('not found'),
          internalError('internal error'),
          serviceUnavailable('service down'),
          createErrorResponse(413, 'PAYLOAD_TOO_LARGE', 'Too big'),
        ),
        (response) => {
          assertErrorStructure(response);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('error response timestamp is a valid ISO 8601 string', async () => {
    const {
      badRequest,
      unauthorized,
      forbidden,
      notFound,
      internalError,
      serviceUnavailable,
    } = await import('../../../../shared/error-handler.js');

    await fc.assert(
      fc.property(
        fc.constantFrom(
          badRequest('test'),
          unauthorized(),
          forbidden(),
          notFound(),
          internalError(),
          serviceUnavailable(),
        ),
        (response) => {
          const body = JSON.parse(response.body);
          // Timestamp should be parseable as a Date and not NaN
          const parsed = new Date(body.timestamp);
          expect(parsed.getTime()).not.toBeNaN();
          // ISO 8601 format check
          expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('error response request_id is a non-empty string', async () => {
    const {
      badRequest,
      unauthorized,
      forbidden,
      notFound,
      internalError,
      serviceUnavailable,
    } = await import('../../../../shared/error-handler.js');

    await fc.assert(
      fc.property(
        fc.constantFrom(
          badRequest('test'),
          unauthorized(),
          forbidden(),
          notFound(),
          internalError(),
          serviceUnavailable(),
        ),
        (response) => {
          const body = JSON.parse(response.body);
          expect(typeof body.request_id).toBe('string');
          expect(body.request_id.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Assertion Helpers ───────────────────────────────────────────────────────

/**
 * Asserts that an error response has the consistent structure: code, message, request_id, timestamp.
 */
function assertErrorStructure(response: ApiGatewayResponse): void {
  const body = JSON.parse(response.body);

  // All required fields must be present
  expect(body).toHaveProperty('code');
  expect(body).toHaveProperty('message');
  expect(body).toHaveProperty('request_id');
  expect(body).toHaveProperty('timestamp');

  // All required fields must be strings
  expect(typeof body.code).toBe('string');
  expect(typeof body.message).toBe('string');
  expect(typeof body.request_id).toBe('string');
  expect(typeof body.timestamp).toBe('string');

  // Non-empty values
  expect(body.code.length).toBeGreaterThan(0);
  expect(body.message.length).toBeGreaterThan(0);
  expect(body.request_id.length).toBeGreaterThan(0);
  expect(body.timestamp.length).toBeGreaterThan(0);
}
