/**
 * Unit tests for the worker creation module.
 * Validates: Requirements 1.1, 1.4
 *
 * Verifies:
 * - DynamoDB PutCommand params for valid input
 * - Generated UUID, timestamps, and partition key with tenant prefix
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';

// Mock the dynamo-client module to use our test mock
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher to prevent real SNS calls
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({
    event_id: 'mock-event-id',
    event_type: 'worker.created',
    source_service: 'identity-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'mock-correlation-id',
    version: '1.0',
  }),
}));

// Mock uuid to return predictable values
const MOCK_UUID_WORKER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MOCK_UUID_QR = 'ffffffff-1111-2222-3333-444444444444';
let uuidCallCount = 0;

vi.mock('uuid', () => ({
  v4: () => {
    uuidCallCount++;
    // First call is for worker_id, second is for qr_identity_reference
    return uuidCallCount % 2 === 1 ? MOCK_UUID_WORKER : MOCK_UUID_QR;
  },
}));

import { createWorker } from '../worker.js';
import { LanguagePreference } from '../../../shared/types/common.js';
import type { CreateWorkerInput } from '../types.js';

describe('Worker Creation Module', () => {
  const putCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    resetDynamoMock();
    putCapture.length = 0;
    setupDynamoMock({ putCapture });
    uuidCallCount = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('DynamoDB PutCommand parameters for valid input', () => {
    const validInput: CreateWorkerInput = {
      legal_name: 'Jane Doe',
      phone: '+14155551234',
      language_preference: LanguagePreference.ENGLISH,
    };

    it('sends a PutCommand to the correct table', async () => {
      await createWorker('tenant-test', validInput);

      const calls = getDynamoCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('PutCommand');

      const input = calls[0].input as Record<string, unknown>;
      expect(input.TableName).toBe('test-Workers');
    });

    it('generates a UUID for worker_id', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.worker_id).toBe(MOCK_UUID_WORKER);
      // UUID format validation
      expect(item.worker_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('generates created_at and updated_at timestamps', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.created_at).toBe('2024-06-15T10:30:00.000Z');
      expect(item.updated_at).toBe('2024-06-15T10:30:00.000Z');
      // Both should be equal on creation
      expect(item.created_at).toBe(item.updated_at);
    });

    it('uses partition key prefixed with tenant ID (TENANT#<tenant_id>)', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.PK).toBe('TENANT#tenant-test');
    });

    it('constructs SK with WORKER# prefix and generated UUID', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.SK).toBe(`WORKER#${MOCK_UUID_WORKER}`);
    });

    it('includes GSI1PK with tenant prefix and GSI1SK with timestamp', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.GSI1PK).toBe('TENANT#tenant-test');
      expect(item.GSI1SK).toBe('WORKER#2024-06-15T10:30:00.000Z');
    });

    it('includes all input fields in the stored item', async () => {
      const fullInput: CreateWorkerInput = {
        legal_name: 'Jane Doe',
        preferred_name: 'Janie',
        phone: '+14155551234',
        language_preference: LanguagePreference.SPANISH,
        email: 'jane@example.com',
      };

      await createWorker('tenant-test', fullInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.legal_name).toBe('Jane Doe');
      expect(item.preferred_name).toBe('Janie');
      expect(item.phone).toBe('+14155551234');
      expect(item.language_preference).toBe('es');
      expect(item.email).toBe('jane@example.com');
    });

    it('sets status to active for new workers', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.status).toBe('active');
    });

    it('generates a qr_identity_reference UUID', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.qr_identity_reference).toBe(MOCK_UUID_QR);
      expect(item.qr_identity_reference).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('stores tenant_id in the item record', async () => {
      await createWorker('tenant-test', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.tenant_id).toBe('tenant-test');
    });
  });

  describe('return value', () => {
    const validInput: CreateWorkerInput = {
      legal_name: 'John Smith',
      phone: '+12025551234',
      language_preference: LanguagePreference.PUNJABI,
    };

    it('returns the created worker with all fields', async () => {
      const result = await createWorker('tenant-test', validInput);

      expect(result).toMatchObject({
        worker_id: MOCK_UUID_WORKER,
        tenant_id: 'tenant-test',
        legal_name: 'John Smith',
        phone: '+12025551234',
        language_preference: 'pa',
        status: 'active',
        created_at: '2024-06-15T10:30:00.000Z',
        updated_at: '2024-06-15T10:30:00.000Z',
        qr_identity_reference: MOCK_UUID_QR,
      });
    });
  });

  describe('tenant isolation on creation', () => {
    it('uses different tenant prefix in PK for different tenants', async () => {
      const input: CreateWorkerInput = {
        legal_name: 'Alice',
        phone: '+15551112222',
        language_preference: LanguagePreference.ENGLISH,
      };

      await createWorker('acme-corp', input);

      const putInput = putCapture[0] as Record<string, unknown>;
      const item = putInput.Item as Record<string, unknown>;

      expect(item.PK).toBe('TENANT#acme-corp');
      expect(item.GSI1PK).toBe('TENANT#acme-corp');
      expect(item.tenant_id).toBe('acme-corp');
    });
  });
});
