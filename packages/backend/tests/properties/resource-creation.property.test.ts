/**
 * Property 2: Resource creation invariants
 *
 * For any valid creation request (worker, site, certification, policy),
 * the persisted record SHALL always contain:
 * - A generated UUID identifier
 * - A `created_at` timestamp
 * - A partition key prefixed with the requesting tenant's ID
 *
 * **Validates: Requirements 1.4, 3.1, 5.1, 5.2, 5.3, 5.6, 7.1, 7.5, 9.1**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../helpers/mock-dynamo';

// ─── Module Mocks ─────────────────────────────────────────────────────────────

// Mock the dynamo-client module
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher to prevent real SNS calls
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({
    event_id: 'mock-event-id',
    event_type: 'test.event',
    source_service: 'test-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'mock-correlation-id',
    version: '1.0',
  }),
}));

// Mock S3 for certification creation
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { createWorker } from '../../src/services/identity/worker.js';
import { createCertification } from '../../src/services/identity/certification.js';
import { CertificationType, LanguagePreference } from '../../src/shared/types/common.js';
import type { CreateWorkerInput, CreateCertificationInput } from '../../src/services/identity/types.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

/** Arbitrary tenant ID: alphanumeric + dashes, 3-50 chars */
const arbTenantId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 3,
    maxLength: 50,
  })
  .filter((s) => !s.startsWith('-') && !s.endsWith('-') && s.length >= 3);

/** Arbitrary valid worker creation input */
const arbWorkerInput: fc.Arbitrary<CreateWorkerInput> = fc.record({
  legal_name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  phone: fc.constantFrom('+14155551234', '+12025550100', '+15551234567', '+442071234567'),
  language_preference: fc.constantFrom(
    LanguagePreference.ENGLISH,
    LanguagePreference.SPANISH,
    LanguagePreference.PUNJABI
  ),
});

/** Arbitrary valid certification creation input */
const arbCertificationInput: fc.Arbitrary<CreateCertificationInput> = fc.record({
  certification_type: fc.constantFrom(
    CertificationType.WHMIS_2015,
    CertificationType.FALL_PROTECTION,
    CertificationType.SITE_READY_BC,
    CertificationType.FIRST_AID
  ),
  issuer: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  issue_date: fc.constantFrom('2023-01-15', '2023-06-01', '2024-01-01', '2024-03-15'),
  expiry_date: fc.constantFrom('2025-01-15', '2025-06-01', '2026-01-01', '2026-03-15'),
});

/** Arbitrary valid site creation input */
const arbSiteInput = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  address: fc.string({ minLength: 0, maxLength: 200 }),
  timezone: fc.constantFrom('America/Vancouver', 'America/Toronto', 'America/New_York'),
});

/** Arbitrary valid policy creation input */
const arbPolicyInput = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  description: fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
  site_id: fc.uuid(),
  jurisdiction: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  owner_type: fc.constantFrom('platform', 'tenant', 'site', 'project'),
  owner_id: fc.uuid(),
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 2: Resource creation invariants', () => {
  let putCapture: Array<Record<string, unknown>>;

  beforeEach(() => {
    putCapture = [];
    resetDynamoMock();
    setupDynamoMock({ putCapture, queryResponses: new Map() });
  });

  afterEach(() => {
    resetDynamoMock();
  });

  describe('Worker creation invariants', () => {
    it('every worker creation produces UUID, created_at, and tenant-prefixed partition key', async () => {
      await fc.assert(
        fc.asyncProperty(arbTenantId, arbWorkerInput, async (tenantId, input) => {
          // Reset captures for this iteration
          putCapture.length = 0;

          const result = await createWorker(tenantId, input);

          // Verify UUID identifier is generated
          expect(result.worker_id).toMatch(UUID_REGEX);

          // Verify created_at timestamp exists and is ISO-8601
          expect(result.created_at).toMatch(ISO8601_REGEX);

          // Verify the DynamoDB item has a partition key prefixed with tenant ID
          expect(putCapture.length).toBeGreaterThan(0);
          const item = (putCapture[0] as { Item: Record<string, unknown> }).Item;
          expect(item.PK).toBe(`TENANT#${tenantId}`);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Certification creation invariants', () => {
    it('every certification creation produces UUID, created_at, and tenant-prefixed partition key', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTenantId,
          fc.uuid(),
          arbCertificationInput,
          async (tenantId, workerId, input) => {
            // Reset captures for this iteration
            putCapture.length = 0;

            const result = await createCertification(tenantId, workerId, input);

            // Verify UUID identifier is generated
            expect(result.certification.certification_id).toMatch(UUID_REGEX);

            // Verify created_at timestamp exists and is ISO-8601
            expect(result.certification.created_at).toMatch(ISO8601_REGEX);

            // Verify the DynamoDB item has a partition key prefixed with tenant ID
            expect(putCapture.length).toBeGreaterThan(0);
            const item = (putCapture[0] as { Item: Record<string, unknown> }).Item;
            expect((item.PK as string).startsWith(`TENANT#${tenantId}`)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Site creation invariants (via policy handler)', () => {
    it('every site creation produces UUID, created_at, and tenant-prefixed partition key', async () => {
      // Import the handler dynamically to test site creation through the handler
      const { handler } = await import('../../src/services/policy/handler.js');
      const { createMockEvent } = await import('../helpers/mock-event.js');

      await fc.assert(
        fc.asyncProperty(arbTenantId, arbSiteInput, async (tenantId, siteInput) => {
          // Reset captures for this iteration
          putCapture.length = 0;

          const event = createMockEvent({
            httpMethod: 'POST',
            resource: '/sites',
            body: siteInput,
            claims: {
              sub: 'user-test-1',
              'custom:role': 'tenant_admin',
              'custom:tenant_id': tenantId,
              email: 'admin@test.com',
            },
          });

          const response = await handler(event);
          const body = JSON.parse(response.body);

          // Should return 201 with created site
          expect(response.statusCode).toBe(201);

          const site = body.site;

          // Verify UUID identifier is generated
          expect(site.site_id).toMatch(UUID_REGEX);

          // Verify created_at timestamp exists and is ISO-8601
          expect(site.created_at).toMatch(ISO8601_REGEX);

          // Verify the DynamoDB item has a partition key prefixed with tenant ID
          expect(putCapture.length).toBeGreaterThan(0);
          const item = (putCapture[0] as { Item: Record<string, unknown> }).Item;
          expect(item.PK).toBe(`TENANT#${tenantId}`);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Policy creation invariants (via policy handler)', () => {
    it('every policy creation produces UUID, created_at, and tenant-prefixed partition key', async () => {
      const { handler } = await import('../../src/services/policy/handler.js');
      const { createMockEvent } = await import('../helpers/mock-event.js');

      await fc.assert(
        fc.asyncProperty(arbTenantId, arbPolicyInput, async (tenantId, policyInput) => {
          // Reset captures for this iteration
          putCapture.length = 0;

          const event = createMockEvent({
            httpMethod: 'POST',
            resource: '/policies',
            body: policyInput,
            claims: {
              sub: 'user-test-1',
              'custom:role': 'tenant_admin',
              'custom:tenant_id': tenantId,
              email: 'admin@test.com',
            },
          });

          const response = await handler(event);
          const body = JSON.parse(response.body);

          // Should return 201 with created policy
          expect(response.statusCode).toBe(201);

          const policy = body.policy;

          // Verify UUID identifier is generated
          expect(policy.policy_id).toMatch(UUID_REGEX);

          // Verify created_at timestamp exists and is ISO-8601
          expect(policy.created_at).toMatch(ISO8601_REGEX);

          // Verify the DynamoDB item has a partition key prefixed with tenant ID
          // First put is the policy record, second is the draft version
          expect(putCapture.length).toBeGreaterThanOrEqual(1);
          const item = (putCapture[0] as { Item: Record<string, unknown> }).Item;
          expect(item.PK).toBe(`TENANT#${tenantId}`);
        }),
        { numRuns: 100 },
      );
    });
  });
});
