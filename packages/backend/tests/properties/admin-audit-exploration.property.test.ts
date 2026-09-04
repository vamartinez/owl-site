/**
 * Bug Condition Exploration Tests 1e, 1f, 1g — Backend Defects
 *
 * Tests for:
 * - 1e: Reports 403 for Platform Admin (role resolution mismatch)
 * - 1f: Users & Roles Empty (missing endpoint)
 * - 1g: Check-In Log Missing Details (backend not resolving names)
 *
 * **Validates: Requirements 1.5, 1.6, 1.7**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Role } from '../../src/shared/types/common.js';
import { hasPermission } from '../../src/shared/rbac.js';
import { extractUserFromClaims } from '../../src/shared/auth-middleware.js';

// ---------------------------------------------------------------------------
// Mocks for report-validation handler
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

vi.mock('@aws-sdk/client-bedrock-agent', () => ({
  BedrockAgentClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  StartIngestionJobCommand: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  DeleteCommand: vi.fn(),
}));

vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: vi.fn().mockResolvedValue({ Items: [] }) },
  getTableName: (name: string) => `dev-${name}`,
}));

vi.mock('../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}));

vi.mock('../../src/services/report-validation/upload-manager.js', () => ({
  createReport: vi.fn(),
  uploadNewVersion: vi.fn(),
  getVersionHistory: vi.fn(),
}));

vi.mock('../../src/services/report-validation/text-extractor.js', () => ({
  extractText: vi.fn(),
}));

vi.mock('../../src/services/report-validation/validation-engine.js', () => ({
  runValidation: vi.fn(),
}));

vi.mock('../../src/services/report-validation/kb-manager.js', () => ({
  uploadKBDocument: vi.fn(),
  deleteKBDocument: vi.fn(),
  listKBDocuments: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks for identity handler (Cognito)
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Users: [
        {
          Username: 'user-admin-001',
          Attributes: [
            { Name: 'sub', Value: 'user-admin-001' },
            { Name: 'email', Value: 'admin@example.com' },
            { Name: 'name', Value: 'Admin User' },
            { Name: 'custom:role', Value: 'platform_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-abc' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date('2024-01-01T00:00:00Z'),
          UserLastModifiedDate: new Date('2024-06-01T00:00:00Z'),
        },
      ],
      PaginationToken: undefined,
    }),
  })),
  ListUsersCommand: vi.fn((input) => ({ input })),
}));

// ---------------------------------------------------------------------------
// Mocks for access handler
// ---------------------------------------------------------------------------
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn(),
}));

vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateDecision: vi.fn(),
}));

vi.mock('../../src/services/access/token-manager.js', () => ({
  generateToken: vi.fn(),
  getToken: vi.fn(),
  validateToken: vi.fn(),
  markTokenUsed: vi.fn(),
  revokeToken: vi.fn(),
  isTokenExpired: vi.fn(),
}));

vi.mock('../../src/services/access/scan-session.js', () => ({
  recordScanSession: vi.fn(),
  detectReplay: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEventWithRole(role: Role): Record<string, unknown> {
  return {
    headers: {
      Authorization: 'Bearer valid-token',
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:tenant_id': 'tenant-abc',
          'custom:role': role,
          email: 'admin@example.com',
        },
      },
    },
    httpMethod: 'GET',
    resource: '/report-validation/reports',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
  };
}

/**
 * Arbitrary: Roles that have 'reports:read' permission
 */
const arbRoleWithReportsRead = fc.constantFrom(
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO
);

/**
 * Arbitrary: Generate different claim formats that could represent platform_admin
 * This tests the extractUserFromClaims function with various Cognito claim shapes
 */
const arbPlatformAdminClaims = fc.oneof(
  // Standard: custom:role set
  fc.record({
    sub: fc.uuid(),
    'custom:tenant_id': fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
    'custom:role': fc.constant('platform_admin'),
    email: fc.emailAddress(),
  }),
  // Cognito groups as array (API Gateway v2 format)
  fc.record({
    sub: fc.uuid(),
    'custom:tenant_id': fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
    'cognito:groups': fc.constant(['platform_admin']),
    email: fc.emailAddress(),
  }),
  // Cognito groups as comma-separated string (API Gateway v1 may do this)
  fc.record({
    sub: fc.uuid(),
    'custom:tenant_id': fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
    'cognito:groups': fc.constant('platform_admin'),
    email: fc.emailAddress(),
  })
);

// ---------------------------------------------------------------------------
// Test 1e: Reports 403 for Platform Admin
// ---------------------------------------------------------------------------

describe('Bug Condition Exploration 1e — Reports 403 for Platform Admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property: For any user with a role that has 'reports:read' permission,
   * the report-validation handler SHALL NOT return 403.
   *
   * Bug Condition: platform_admin users get 403 even though RBAC matrix
   * includes reports:read for their role.
   */
  it('roles with reports:read should NOT receive 403 from report-validation handler', async () => {
    await fc.assert(
      fc.asyncProperty(arbRoleWithReportsRead, async (role) => {
        vi.clearAllMocks();

        // First verify the RBAC matrix is correct (sanity check)
        expect(hasPermission(role, 'reports:read')).toBe(true);

        // Now call the actual handler
        const { handler } = await import(
          '../../src/services/report-validation/handler.js'
        );

        const event = buildEventWithRole(role);
        const response = await handler(event as any);

        // Should NOT be 403
        expect(response.statusCode).not.toBe(403);
      }),
      { numRuns: 10 }
    );
  });

  /**
   * Property: extractUserFromClaims resolves platform_admin role correctly
   * from various claim formats.
   */
  it('extractUserFromClaims should resolve platform_admin from different claim formats', () => {
    fc.assert(
      fc.property(arbPlatformAdminClaims, (claims) => {
        const user = extractUserFromClaims(claims as any);

        // Should resolve to platform_admin
        expect(user).not.toBeNull();
        expect(user!.role).toBe('platform_admin');
      }),
      { numRuns: 30 }
    );
  });
});

// ---------------------------------------------------------------------------
// Test 1f: Users & Roles Empty
// ---------------------------------------------------------------------------

describe('Bug Condition Exploration 1f — Users & Roles Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property: GET /admin/users as an authenticated platform_admin should
   * NOT return 404 or "Unsupported route". It should return a valid response
   * with at least the authenticated user in the list.
   *
   * Bug Condition: No backend endpoint exists for /admin/users, so the request
   * returns 400 "Unsupported route" or 404.
   */
  it('GET /admin/users should not return 404/400 unsupported route', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(Role.PLATFORM_ADMIN, Role.TENANT_ADMIN),
        async (role) => {
          vi.clearAllMocks();

          // The /admin/users route is handled by the IDENTITY handler, not report-validation
          const { handler } = await import(
            '../../src/services/identity/handler.js'
          );

          const event = {
            headers: { Authorization: 'Bearer valid-token' },
            requestContext: {
              authorizer: {
                claims: {
                  sub: 'user-admin-001',
                  'custom:tenant_id': 'tenant-abc',
                  'custom:role': role,
                  email: 'admin@example.com',
                },
              },
            },
            httpMethod: 'GET',
            resource: '/admin/users',
            pathParameters: null,
            queryStringParameters: null,
            body: null,
          };

          const response = await handler(event as any);

          // Bug condition: returns 400 "Unsupported route" because no handler exists
          // Expected: should return 200 with user list
          expect(response.statusCode).not.toBe(400);
          expect(response.statusCode).not.toBe(404);
          expect(response.statusCode).not.toBe(501);

          if (response.statusCode === 200) {
            const body = JSON.parse(response.body);
            expect(body.users).toBeDefined();
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});

// ---------------------------------------------------------------------------
// Test 1g: Check-In Log Missing Details
// ---------------------------------------------------------------------------

describe('Bug Condition Exploration 1g — Check-In Log Missing Details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property: Each entry in the recent check-ins response should have:
   * - workerName (not undefined/empty)
   * - site (not undefined/empty)
   * - For denied entries: denialReason (not undefined)
   *
   * Bug Condition: Backend returns entries with only decision + timestamp,
   * missing workerName, site, and denialReason.
   */
  it('recent check-in entries should have workerName and site populated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(Role.PLATFORM_ADMIN, Role.SITE_ADMIN, Role.GATE_OPERATOR),
        async (role) => {
          vi.clearAllMocks();

          // Mock DynamoDB to return check-in records (simulating what the backend stores)
          const dynamoModule = await import('../../src/shared/dynamo-client.js');
          const docClient = dynamoModule.docClient as unknown as { send: ReturnType<typeof vi.fn> };

          // Simulate the sequential DynamoDB calls:
          // 1st call: ScanSessions query returns raw records with worker_id/site_id
          // 2nd+ calls: Worker/Site/Decision lookups resolve names
          docClient.send
            .mockResolvedValueOnce({
              Items: [
                {
                  session_id: 'checkin-001',
                  worker_id: 'worker-123',
                  site_id: 'site-456',
                  result: 'denied',
                  timestamp: '2024-03-15T14:32:00Z',
                  decision_ref: 'decision-abc',
                },
                {
                  session_id: 'checkin-002',
                  worker_id: 'worker-789',
                  site_id: 'site-456',
                  result: 'allowed',
                  timestamp: '2024-03-15T14:30:00Z',
                },
              ],
            })
            // Worker lookups
            .mockResolvedValueOnce({ Item: { legal_name: 'Alice Johnson' } })
            .mockResolvedValueOnce({ Item: { legal_name: 'Bob Williams' } })
            // Site lookups
            .mockResolvedValueOnce({ Item: { name: 'Site Beta' } })
            // Decision record lookup for denied entry
            .mockResolvedValueOnce({ Items: [{ reasons: ['Missing OSHA-30 certification'] }] });

          // Call the actual access handler
          const { handler } = await import('../../src/services/access/handler.js');

          const event = {
            headers: { Authorization: 'Bearer valid-token' },
            requestContext: {
              authorizer: {
                claims: {
                  sub: 'user-gate-001',
                  'custom:tenant_id': 'tenant-abc',
                  'custom:role': role,
                  email: 'gate@example.com',
                },
              },
            },
            httpMethod: 'GET',
            resource: '/site-access/recent-checkins',
            pathParameters: null,
            queryStringParameters: null,
            body: null,
          };

          const response = await handler(event as any);

          // Should return 200 (or 403 for roles without access:read_decisions)
          if (response.statusCode === 200) {
            const body = JSON.parse(response.body);
            expect(body.checkIns).toBeDefined();

            for (const entry of body.checkIns) {
              // Expected: workerName should be populated
              expect(entry.workerName).toBeDefined();
              expect(entry.workerName).not.toBe('');

              // Expected: site should be populated
              expect(entry.site).toBeDefined();
              expect(entry.site).not.toBe('');

              // For denied entries: denial reason should be present
              if (entry.decision === 'denied') {
                expect(entry.denialReason).toBeDefined();
              }
            }
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});
