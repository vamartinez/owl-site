/**
 * Unit tests for the form creation module.
 * Validates: Requirements 7.1
 *
 * Verifies:
 * - Form record is stored with status DRAFT (borrador) and correct tenant key
 * - Generated UUID for form_id
 * - Timestamps (created_at, updated_at) are set correctly
 * - Partition key uses TENANT# prefix with the tenant ID
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// Mock the audit module to prevent real audit writes
vi.mock('../audit.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock the form-version module
vi.mock('../form-version.js', () => ({
  createFormVersion: vi.fn().mockResolvedValue({
    form_id: 'mock-form-id',
    version_number: 1,
    fields_snapshot: [],
    created_at: '2024-06-15T10:30:00.000Z',
    created_by: 'user-1',
  }),
}));

// Mock the logger
vi.mock('../../../shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock uuid to return predictable values
const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

vi.mock('uuid', () => ({
  v4: () => MOCK_UUID,
}));

import { createForm } from '../form.js';

describe('Form Creation Module', () => {
  const putCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    resetDynamoMock();
    putCapture.length = 0;
    // Setup mock with empty query responses (no duplicate names)
    setupDynamoMock({ putCapture, queryResponses: new Map() });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('form stored with status DRAFT and correct tenant key', () => {
    const validInput = {
      name: 'Safety Inspection Form',
      description: 'Daily site inspection checklist',
    };

    it('sends a PutCommand to the Forms table', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const calls = getDynamoCalls();
      // First call is QueryCommand (duplicate name check), second is PutCommand
      const putCalls = calls.filter((c) => c.command === 'PutCommand');
      expect(putCalls).toHaveLength(1);

      const input = putCalls[0].input as Record<string, unknown>;
      expect(input.TableName).toBe('test-Forms');
    });

    it('stores the form with status "borrador" (DRAFT)', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.status).toBe('borrador');
    });

    it('uses partition key prefixed with tenant ID (TENANT#<tenant_id>)', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.PK).toBe('TENANT#tenant-test');
    });

    it('constructs SK with FORM# prefix and generated UUID', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.SK).toBe(`FORM#${MOCK_UUID}`);
    });

    it('generates a UUID for form_id', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.form_id).toBe(MOCK_UUID);
      expect(item.form_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('generates created_at and updated_at timestamps', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.created_at).toBe('2024-06-15T10:30:00.000Z');
      expect(item.updated_at).toBe('2024-06-15T10:30:00.000Z');
      // Both should be equal on creation
      expect(item.created_at).toBe(item.updated_at);
    });

    it('stores the tenant_id in the form record', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.tenant_id).toBe('tenant-test');
    });

    it('stores the author_id from the requesting user', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.author_id).toBe('user-1');
    });

    it('stores the form name and description from input', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.name).toBe('Safety Inspection Form');
      expect(item.description).toBe('Daily site inspection checklist');
    });

    it('initializes fields as empty array', async () => {
      await createForm('tenant-test', 'user-1', validInput, '127.0.0.1');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.fields).toEqual([]);
    });
  });

  describe('tenant isolation on creation', () => {
    it('uses different tenant prefix in PK for different tenants', async () => {
      const input = { name: 'Checklist Form' };

      await createForm('acme-corp', 'user-42', input, '10.0.0.1');

      const putInput = putCapture[0] as Record<string, unknown>;
      const item = putInput.Item as Record<string, unknown>;

      expect(item.PK).toBe('TENANT#acme-corp');
      expect(item.tenant_id).toBe('acme-corp');
    });
  });

  describe('return value', () => {
    it('returns the created form with all fields', async () => {
      const input = {
        name: 'Exit Interview',
        description: 'Worker exit survey',
      };

      const result = await createForm('tenant-test', 'user-1', input, '127.0.0.1');

      expect(result).toMatchObject({
        form_id: MOCK_UUID,
        tenant_id: 'tenant-test',
        name: 'Exit Interview',
        description: 'Worker exit survey',
        status: 'borrador',
        fields: [],
        author_id: 'user-1',
        created_at: '2024-06-15T10:30:00.000Z',
        updated_at: '2024-06-15T10:30:00.000Z',
      });
    });

    it('handles optional description being undefined', async () => {
      const input = { name: 'Simple Form' };

      const result = await createForm('tenant-test', 'user-1', input, '127.0.0.1');

      expect(result.name).toBe('Simple Form');
      expect(result.description).toBeUndefined();
      expect(result.status).toBe('borrador');
    });
  });
});
