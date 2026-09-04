import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTablePrefix, getTableName } from '../../src/shared/dynamo-client.js';
import { buildPlatformEvent } from '../../src/shared/event-publisher.js';
import { createLogger } from '../../src/shared/logger.js';
import {
  createErrorResponse,
  createSuccessResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError,
} from '../../src/shared/error-handler.js';
import { extractUserFromClaims, authenticateRequest } from '../../src/shared/auth-middleware.js';
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  enforcePermission,
  enforceTenantIsolation,
  getPermissionsForRole,
} from '../../src/shared/rbac.js';
import {
  e164PhoneSchema,
  uuidSchema,
  iso8601TimestampSchema,
  iso8601DateSchema,
  paginationSchema,
  boundedString,
  confidenceScoreSchema,
} from '../../src/shared/validators.js';
import { Role } from '../../src/shared/types/common.js';

// --- DynamoDB Client Tests ---

describe('dynamo-client', () => {
  const originalEnv = process.env['ENVIRONMENT'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['ENVIRONMENT'] = originalEnv;
    } else {
      delete process.env['ENVIRONMENT'];
    }
  });

  it('returns dev- prefix when ENVIRONMENT is dev', () => {
    process.env['ENVIRONMENT'] = 'dev';
    expect(getTablePrefix()).toBe('dev-');
  });

  it('returns empty prefix when ENVIRONMENT is prod', () => {
    process.env['ENVIRONMENT'] = 'prod';
    expect(getTablePrefix()).toBe('');
  });

  it('defaults to dev- prefix when ENVIRONMENT is not set', () => {
    delete process.env['ENVIRONMENT'];
    expect(getTablePrefix()).toBe('dev-');
  });

  it('returns full table name with prefix', () => {
    process.env['ENVIRONMENT'] = 'dev';
    expect(getTableName('Workers')).toBe('dev-Workers');
  });

  it('returns table name without prefix in prod', () => {
    process.env['ENVIRONMENT'] = 'prod';
    expect(getTableName('Workers')).toBe('Workers');
  });
});

// --- Event Publisher Tests ---

describe('event-publisher', () => {
  it('builds a PlatformEvent with all required fields', () => {
    const event = buildPlatformEvent({
      event_type: 'WorkerCreated',
      source_service: 'identity-service',
      tenant_id: 'tenant-123',
      payload: { worker_id: 'w-1' },
    });

    expect(event.event_id).toBeDefined();
    expect(event.event_type).toBe('WorkerCreated');
    expect(event.source_service).toBe('identity-service');
    expect(event.tenant_id).toBe('tenant-123');
    expect(event.timestamp).toBeDefined();
    expect(event.payload).toEqual({ worker_id: 'w-1' });
    expect(event.correlation_id).toBeDefined();
    expect(event.version).toBe('1.0');
  });

  it('uses provided correlation_id and version', () => {
    const event = buildPlatformEvent({
      event_type: 'CertificationExpired',
      source_service: 'identity-service',
      tenant_id: 'tenant-456',
      payload: {},
      correlation_id: 'corr-abc',
      version: '2.0',
    });

    expect(event.correlation_id).toBe('corr-abc');
    expect(event.version).toBe('2.0');
  });

  it('generates unique event_id for each call', () => {
    const event1 = buildPlatformEvent({
      event_type: 'Test',
      source_service: 'test',
      tenant_id: 't1',
      payload: {},
    });
    const event2 = buildPlatformEvent({
      event_type: 'Test',
      source_service: 'test',
      tenant_id: 't1',
      payload: {},
    });

    expect(event1.event_id).not.toBe(event2.event_id);
  });

  it('produces a valid ISO 8601 timestamp', () => {
    const event = buildPlatformEvent({
      event_type: 'Test',
      source_service: 'test',
      tenant_id: 't1',
      payload: {},
    });

    expect(() => new Date(event.timestamp)).not.toThrow();
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });
});

// --- Logger Tests ---

describe('logger', () => {
  it('creates a logger with service context', () => {
    const logger = createLogger('decision-engine');
    expect(logger).toBeDefined();
  });

  it('creates a child logger with merged context', () => {
    const logger = createLogger('identity-service', { tenant_id: 't1' });
    const child = logger.child({ correlation_id: 'corr-123' });
    expect(child).toBeDefined();
  });
});

// --- Error Handler Tests ---

describe('error-handler', () => {
  it('creates a structured error response', () => {
    const response = createErrorResponse(400, 'BAD_REQUEST', 'Invalid input', { field: 'name' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toBe('Invalid input');
    expect(body.request_id).toBeDefined();
    expect(body.timestamp).toBeDefined();
    expect(body.details).toEqual({ field: 'name' });
  });

  it('creates a success response', () => {
    const response = createSuccessResponse(200, { id: '123', name: 'Test' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.id).toBe('123');
    expect(body.name).toBe('Test');
  });

  it('badRequest returns 400', () => {
    expect(badRequest('Missing field').statusCode).toBe(400);
  });

  it('unauthorized returns 401', () => {
    expect(unauthorized().statusCode).toBe(401);
  });

  it('forbidden returns 403', () => {
    expect(forbidden().statusCode).toBe(403);
  });

  it('notFound returns 404', () => {
    expect(notFound().statusCode).toBe(404);
  });

  it('conflict returns 409', () => {
    expect(conflict('Version conflict').statusCode).toBe(409);
  });

  it('internalError returns 500', () => {
    expect(internalError().statusCode).toBe(500);
  });

  it('includes CORS headers', () => {
    const response = badRequest('test');
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(response.headers['Content-Type']).toBe('application/json');
  });
});

// --- Auth Middleware Tests ---

describe('auth-middleware', () => {
  describe('extractUserFromClaims', () => {
    it('extracts user from valid claims', () => {
      const claims = {
        sub: 'user-123',
        'custom:tenant_id': 'tenant-456',
        'custom:role': 'site_admin',
        email: 'user@example.com',
        'custom:assigned_sites': 'site-1,site-2',
      };

      const user = extractUserFromClaims(claims);
      expect(user).not.toBeNull();
      expect(user!.user_id).toBe('user-123');
      expect(user!.tenant_id).toBe('tenant-456');
      expect(user!.role).toBe('site_admin');
      expect(user!.email).toBe('user@example.com');
      expect(user!.assigned_sites).toEqual(['site-1', 'site-2']);
    });

    it('returns null when sub is missing', () => {
      const claims = {
        'custom:tenant_id': 'tenant-456',
        'custom:role': 'worker',
      };
      expect(extractUserFromClaims(claims)).toBeNull();
    });

    it('defaults tenant_id to "default" when tenant_id is missing', () => {
      const claims = {
        sub: 'user-123',
        'custom:role': 'worker',
      };
      const user = extractUserFromClaims(claims);
      expect(user).not.toBeNull();
      expect(user!.tenant_id).toBe('default');
      expect(user!.role).toBe('worker');
    });

    it('defaults role to "worker" when role is missing', () => {
      const claims = {
        sub: 'user-123',
        'custom:tenant_id': 'tenant-456',
      };
      const user = extractUserFromClaims(claims);
      expect(user).not.toBeNull();
      expect(user!.tenant_id).toBe('tenant-456');
      expect(user!.role).toBe('worker');
    });
  });

  describe('authenticateRequest', () => {
    it('extracts user from Cognito authorizer claims', () => {
      const event = {
        headers: {},
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-abc',
              'custom:tenant_id': 'tenant-xyz',
              'custom:role': 'supervisor',
            },
          },
        },
      };

      const result = authenticateRequest(event);
      expect('user' in result).toBe(true);
      if ('user' in result) {
        expect(result.user.user_id).toBe('user-abc');
        expect(result.user.role).toBe('supervisor');
      }
    });

    it('returns error when no auth header and no authorizer claims', () => {
      const event = { headers: {} };
      const result = authenticateRequest(event);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.statusCode).toBe(401);
      }
    });
  });
});

// --- RBAC Tests ---

describe('rbac', () => {
  it('platform_admin has all permissions', () => {
    expect(hasPermission(Role.PLATFORM_ADMIN, 'workers:create')).toBe(true);
    expect(hasPermission(Role.PLATFORM_ADMIN, 'users:manage')).toBe(true);
    expect(hasPermission(Role.PLATFORM_ADMIN, 'audit:read')).toBe(true);
  });

  it('worker has limited permissions', () => {
    expect(hasPermission(Role.WORKER, 'workers:read_own')).toBe(true);
    expect(hasPermission(Role.WORKER, 'certifications:upload')).toBe(true);
    expect(hasPermission(Role.WORKER, 'access:request')).toBe(true);
    expect(hasPermission(Role.WORKER, 'workers:create')).toBe(false);
    expect(hasPermission(Role.WORKER, 'users:manage')).toBe(false);
  });

  it('gate_operator can scan and request access', () => {
    expect(hasPermission(Role.GATE_OPERATOR, 'access:request')).toBe(true);
    expect(hasPermission(Role.GATE_OPERATOR, 'access:scan')).toBe(true);
    expect(hasPermission(Role.GATE_OPERATOR, 'access:override')).toBe(false);
  });

  it('cso can override access', () => {
    expect(hasPermission(Role.CSO, 'access:override')).toBe(true);
  });

  it('hasAllPermissions checks all', () => {
    expect(hasAllPermissions(Role.SUPERVISOR, ['workers:read', 'findings:read'])).toBe(true);
    expect(hasAllPermissions(Role.WORKER, ['workers:read_own', 'users:manage'])).toBe(false);
  });

  it('hasAnyPermission checks any', () => {
    expect(hasAnyPermission(Role.WORKER, ['users:manage', 'access:request'])).toBe(true);
    expect(hasAnyPermission(Role.WORKER, ['users:manage', 'sites:create'])).toBe(false);
  });

  it('enforcePermission returns null when authorized', () => {
    const user = { user_id: 'u1', tenant_id: 't1', role: Role.SITE_ADMIN };
    expect(enforcePermission(user, 'sites:read')).toBeNull();
  });

  it('enforcePermission returns 403 when unauthorized', () => {
    const user = { user_id: 'u1', tenant_id: 't1', role: Role.WORKER };
    const result = enforcePermission(user, 'sites:create');
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(403);
  });

  it('enforceTenantIsolation allows same tenant', () => {
    const user = { user_id: 'u1', tenant_id: 't1', role: Role.TENANT_ADMIN };
    expect(enforceTenantIsolation(user, 't1')).toBeNull();
  });

  it('enforceTenantIsolation blocks different tenant', () => {
    const user = { user_id: 'u1', tenant_id: 't1', role: Role.TENANT_ADMIN };
    const result = enforceTenantIsolation(user, 't2');
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(403);
  });

  it('enforceTenantIsolation allows platform_admin to access any tenant', () => {
    const user = { user_id: 'u1', tenant_id: 't1', role: Role.PLATFORM_ADMIN };
    expect(enforceTenantIsolation(user, 't2')).toBeNull();
  });

  it('getPermissionsForRole returns permissions array', () => {
    const perms = getPermissionsForRole(Role.WORKER);
    expect(perms).toContain('workers:read_own');
    expect(perms).toContain('certifications:upload');
    expect(perms.length).toBeGreaterThan(0);
  });
});

// --- Validators Tests ---

describe('validators', () => {
  describe('e164PhoneSchema', () => {
    it('accepts valid E.164 numbers', () => {
      expect(e164PhoneSchema.safeParse('+14155552671').success).toBe(true);
      expect(e164PhoneSchema.safeParse('+442071234567').success).toBe(true);
      expect(e164PhoneSchema.safeParse('+12').success).toBe(true); // minimum: country code + 1 digit
    });

    it('rejects invalid phone numbers', () => {
      expect(e164PhoneSchema.safeParse('14155552671').success).toBe(false);
      expect(e164PhoneSchema.safeParse('+0123456789').success).toBe(false);
      expect(e164PhoneSchema.safeParse('').success).toBe(false);
      expect(e164PhoneSchema.safeParse('+1234567890123456').success).toBe(false); // 16 digits
    });
  });

  describe('uuidSchema', () => {
    it('accepts valid UUIDs', () => {
      expect(uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
    });

    it('rejects invalid UUIDs', () => {
      expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
      expect(uuidSchema.safeParse('').success).toBe(false);
    });
  });

  describe('iso8601TimestampSchema', () => {
    it('accepts valid ISO 8601 timestamps', () => {
      expect(iso8601TimestampSchema.safeParse('2024-01-15T10:30:00.000Z').success).toBe(true);
      expect(iso8601TimestampSchema.safeParse('2024-01-15T10:30:00Z').success).toBe(true);
    });

    it('rejects invalid timestamps', () => {
      expect(iso8601TimestampSchema.safeParse('2024-01-15').success).toBe(false);
      expect(iso8601TimestampSchema.safeParse('not-a-date').success).toBe(false);
    });
  });

  describe('iso8601DateSchema', () => {
    it('accepts valid dates', () => {
      expect(iso8601DateSchema.safeParse('2024-01-15').success).toBe(true);
      expect(iso8601DateSchema.safeParse('2023-12-31').success).toBe(true);
    });

    it('rejects invalid dates', () => {
      expect(iso8601DateSchema.safeParse('2024-13-01').success).toBe(false);
      expect(iso8601DateSchema.safeParse('01-15-2024').success).toBe(false);
      expect(iso8601DateSchema.safeParse('').success).toBe(false);
    });
  });

  describe('paginationSchema', () => {
    it('accepts valid pagination params', () => {
      const result = paginationSchema.safeParse({ limit: 50 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });

    it('applies default limit', () => {
      const result = paginationSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
      }
    });

    it('rejects limit > 100', () => {
      expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('rejects limit < 1', () => {
      expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false);
    });
  });

  describe('boundedString', () => {
    it('accepts strings within bounds', () => {
      const schema = boundedString(100, 'Name');
      expect(schema.safeParse('John Doe').success).toBe(true);
    });

    it('rejects empty strings', () => {
      const schema = boundedString(100, 'Name');
      expect(schema.safeParse('').success).toBe(false);
    });

    it('rejects strings exceeding max length', () => {
      const schema = boundedString(5, 'Code');
      expect(schema.safeParse('123456').success).toBe(false);
    });

    it('trims whitespace', () => {
      const schema = boundedString(10, 'Name');
      const result = schema.safeParse('  hi  ');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('hi');
      }
    });
  });

  describe('confidenceScoreSchema', () => {
    it('accepts values between 0 and 1', () => {
      expect(confidenceScoreSchema.safeParse(0).success).toBe(true);
      expect(confidenceScoreSchema.safeParse(0.5).success).toBe(true);
      expect(confidenceScoreSchema.safeParse(1).success).toBe(true);
    });

    it('rejects values outside range', () => {
      expect(confidenceScoreSchema.safeParse(-0.1).success).toBe(false);
      expect(confidenceScoreSchema.safeParse(1.1).success).toBe(false);
    });
  });
});
