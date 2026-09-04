/**
 * Unit tests for the worker update module.
 * Validates: Requirements 1.3
 *
 * Verifies:
 * - UpdateCommand expression contains only provided fields
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
    event_type: 'worker.updated',
    source_service: 'identity-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'mock-correlation-id',
    version: '1.0',
  }),
}));

import { updateWorker } from '../worker.js';
import { LanguagePreference } from '../../../shared/types/common.js';
import type { UpdateWorkerInput } from '../types.js';

describe('Worker Update Module', () => {
  const tenantId = 'tenant-test';
  const workerId = 'worker-123';
  const updateCapture: Array<Record<string, unknown>> = [];

  // The existing worker record returned by the GetCommand (existence check)
  const existingWorker = {
    worker_id: workerId,
    tenant_id: tenantId,
    legal_name: 'Jane Doe',
    phone: '+14155551234',
    language_preference: 'en',
    status: 'active',
    created_at: '2024-06-01T00:00:00.000Z',
    updated_at: '2024-06-01T00:00:00.000Z',
  };

  beforeEach(() => {
    resetDynamoMock();
    updateCapture.length = 0;

    // Set up the GetCommand to return the existing worker (for existence check)
    const getKey = JSON.stringify({
      PK: `TENANT#${tenantId}`,
      SK: `WORKER#${workerId}`,
    });
    const getResponses = new Map([[getKey, existingWorker]]);

    setupDynamoMock({ getResponses, updateCapture });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('UpdateCommand expression contains only provided fields', () => {
    it('includes only legal_name when only legal_name is provided', async () => {
      const input: UpdateWorkerInput = { legal_name: 'John Smith' };

      await updateWorker(tenantId, workerId, input);

      const calls = getDynamoCalls();
      const updateCall = calls.find((c) => c.command === 'UpdateCommand');
      expect(updateCall).toBeDefined();

      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#legal_name');
      expect(expression).not.toContain('#preferred_name');
      expect(expression).not.toContain('#phone');
      expect(expression).not.toContain('#language_preference');
      expect(expression).not.toContain('#email');
    });

    it('includes only phone when only phone is provided', async () => {
      const input: UpdateWorkerInput = { phone: '+12025559999' };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#phone');
      expect(expression).not.toContain('#legal_name');
      expect(expression).not.toContain('#preferred_name');
      expect(expression).not.toContain('#language_preference');
      expect(expression).not.toContain('#email');
    });

    it('includes only email when only email is provided', async () => {
      const input: UpdateWorkerInput = { email: 'new@example.com' };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#email');
      expect(expression).not.toContain('#legal_name');
      expect(expression).not.toContain('#preferred_name');
      expect(expression).not.toContain('#phone');
      expect(expression).not.toContain('#language_preference');
    });

    it('includes only language_preference when only language_preference is provided', async () => {
      const input: UpdateWorkerInput = { language_preference: LanguagePreference.SPANISH };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#language_preference');
      expect(expression).not.toContain('#legal_name');
      expect(expression).not.toContain('#preferred_name');
      expect(expression).not.toContain('#phone');
      expect(expression).not.toContain('#email');
    });

    it('includes only preferred_name when only preferred_name is provided', async () => {
      const input: UpdateWorkerInput = { preferred_name: 'Johnny' };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#preferred_name');
      expect(expression).not.toContain('#legal_name');
      expect(expression).not.toContain('#phone');
      expect(expression).not.toContain('#language_preference');
      expect(expression).not.toContain('#email');
    });

    it('includes multiple fields when multiple are provided', async () => {
      const input: UpdateWorkerInput = {
        legal_name: 'Updated Name',
        phone: '+15551112222',
        email: 'updated@test.com',
      };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#legal_name');
      expect(expression).toContain('#phone');
      expect(expression).toContain('#email');
      expect(expression).not.toContain('#preferred_name');
      expect(expression).not.toContain('#language_preference');
    });

    it('includes all updatable fields when all are provided', async () => {
      const input: UpdateWorkerInput = {
        legal_name: 'Full Update',
        preferred_name: 'Full',
        phone: '+15551113333',
        language_preference: LanguagePreference.PUNJABI,
        email: 'full@test.com',
      };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#legal_name');
      expect(expression).toContain('#preferred_name');
      expect(expression).toContain('#phone');
      expect(expression).toContain('#language_preference');
      expect(expression).toContain('#email');
    });

    it('always includes updated_at in the expression', async () => {
      const input: UpdateWorkerInput = { legal_name: 'Test' };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const expression = updateInput.UpdateExpression as string;

      expect(expression).toContain('#updated_at');
    });

    it('sets the correct ExpressionAttributeValues for provided fields only', async () => {
      const input: UpdateWorkerInput = {
        legal_name: 'New Name',
        phone: '+12025554444',
      };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const values = updateInput.ExpressionAttributeValues as Record<string, unknown>;

      expect(values[':legal_name']).toBe('New Name');
      expect(values[':phone']).toBe('+12025554444');
      expect(values[':updated_at']).toBe('2024-06-15T10:30:00.000Z');
      // Should NOT have values for omitted fields
      expect(values[':preferred_name']).toBeUndefined();
      expect(values[':language_preference']).toBeUndefined();
      expect(values[':email']).toBeUndefined();
    });

    it('sets the correct ExpressionAttributeNames for provided fields only', async () => {
      const input: UpdateWorkerInput = {
        email: 'only-email@test.com',
      };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const names = updateInput.ExpressionAttributeNames as Record<string, string>;

      expect(names['#email']).toBe('email');
      expect(names['#updated_at']).toBe('updated_at');
      // Should NOT have names for omitted fields
      expect(names['#legal_name']).toBeUndefined();
      expect(names['#preferred_name']).toBeUndefined();
      expect(names['#phone']).toBeUndefined();
      expect(names['#language_preference']).toBeUndefined();
    });

    it('uses correct Key with tenant-prefixed PK and worker SK', async () => {
      const input: UpdateWorkerInput = { legal_name: 'Key Test' };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;
      const key = updateInput.Key as Record<string, string>;

      expect(key.PK).toBe(`TENANT#${tenantId}`);
      expect(key.SK).toBe(`WORKER#${workerId}`);
    });

    it('targets the correct table name', async () => {
      const input: UpdateWorkerInput = { legal_name: 'Table Test' };

      await updateWorker(tenantId, workerId, input);

      const updateCall = getDynamoCalls().find((c) => c.command === 'UpdateCommand');
      const updateInput = updateCall!.input as Record<string, unknown>;

      expect(updateInput.TableName).toBe('test-Workers');
    });

    it('returns null when worker does not exist', async () => {
      // Reset and set up without a matching get response
      resetDynamoMock();
      updateCapture.length = 0;
      setupDynamoMock({ updateCapture });

      const input: UpdateWorkerInput = { legal_name: 'Ghost' };
      const result = await updateWorker(tenantId, 'non-existent-id', input);

      expect(result).toBeNull();

      // Should NOT have issued an UpdateCommand
      const updateCalls = getDynamoCalls().filter((c) => c.command === 'UpdateCommand');
      expect(updateCalls).toHaveLength(0);
    });
  });
});
