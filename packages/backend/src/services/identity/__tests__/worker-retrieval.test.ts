/**
 * Unit tests for the worker retrieval module (getWorker).
 * Validates: Requirements 1.2
 *
 * Tests that GetCommand is called with the correct key construction
 * and that the response is mapped to the expected WorkerIdentity shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo.js';

// Mock the dynamo-client module before importing the module under test
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher since it's imported by worker.ts
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getWorker } from '../worker.js';

describe('Worker Retrieval Module — getWorker', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  describe('GetCommand key construction', () => {
    it('calls GetCommand with correct PK and SK for given tenant and worker', async () => {
      const tenantId = 'tenant-abc';
      const workerId = 'worker-123';

      setupDynamoMock({ getResponses: new Map() });

      await getWorker(tenantId, workerId);

      const calls = getDynamoCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('GetCommand');
      expect(calls[0].input).toEqual({
        TableName: 'test-Workers',
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `WORKER#${workerId}`,
        },
      });
    });

    it('uses the correct table name from getTableName helper', async () => {
      setupDynamoMock({ getResponses: new Map() });

      await getWorker('any-tenant', 'any-worker');

      const calls = getDynamoCalls();
      expect(calls[0].input).toHaveProperty('TableName', 'test-Workers');
    });

    it('constructs PK with tenant prefix format TENANT#{tenantId}', async () => {
      const tenantId = 'org-99';
      setupDynamoMock({ getResponses: new Map() });

      await getWorker(tenantId, 'w-1');

      const calls = getDynamoCalls();
      const key = (calls[0].input as { Key: Record<string, string> }).Key;
      expect(key.PK).toBe('TENANT#org-99');
    });

    it('constructs SK with worker prefix format WORKER#{workerId}', async () => {
      const workerId = 'wkr-456';
      setupDynamoMock({ getResponses: new Map() });

      await getWorker('t-1', workerId);

      const calls = getDynamoCalls();
      const key = (calls[0].input as { Key: Record<string, string> }).Key;
      expect(key.SK).toBe('WORKER#wkr-456');
    });
  });

  describe('Response mapping to expected shape', () => {
    it('returns null when DynamoDB returns no Item', async () => {
      setupDynamoMock({ getResponses: new Map() });

      const result = await getWorker('tenant-1', 'nonexistent-worker');

      expect(result).toBeNull();
    });

    it('returns the full WorkerIdentity object when item exists', async () => {
      const storedItem = {
        PK: 'TENANT#tenant-1',
        SK: 'WORKER#w-1',
        worker_id: 'w-1',
        tenant_id: 'tenant-1',
        legal_name: 'Jane Doe',
        preferred_name: 'Jane',
        phone: '+14155551234',
        language_preference: 'en',
        email: 'jane@example.com',
        qr_identity_reference: 'qr-ref-abc',
        status: 'active',
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
      };

      const key = JSON.stringify({ PK: 'TENANT#tenant-1', SK: 'WORKER#w-1' });
      setupDynamoMock({ getResponses: new Map([[key, storedItem]]) });

      const result = await getWorker('tenant-1', 'w-1');

      expect(result).not.toBeNull();
      expect(result).toEqual(storedItem);
    });

    it('maps result with all required WorkerIdentity fields', async () => {
      const storedItem = {
        PK: 'TENANT#t-2',
        SK: 'WORKER#w-2',
        worker_id: 'w-2',
        tenant_id: 't-2',
        legal_name: 'Carlos Rivera',
        phone: '+525551234567',
        language_preference: 'es',
        status: 'active',
        created_at: '2024-03-01T08:30:00.000Z',
        updated_at: '2024-03-01T08:30:00.000Z',
      };

      const key = JSON.stringify({ PK: 'TENANT#t-2', SK: 'WORKER#w-2' });
      setupDynamoMock({ getResponses: new Map([[key, storedItem]]) });

      const result = await getWorker('t-2', 'w-2');

      expect(result).not.toBeNull();
      expect(result!.worker_id).toBe('w-2');
      expect(result!.tenant_id).toBe('t-2');
      expect(result!.legal_name).toBe('Carlos Rivera');
      expect(result!.phone).toBe('+525551234567');
      expect(result!.language_preference).toBe('es');
      expect(result!.status).toBe('active');
      expect(result!.created_at).toBe('2024-03-01T08:30:00.000Z');
      expect(result!.updated_at).toBe('2024-03-01T08:30:00.000Z');
    });

    it('preserves optional fields when present in the stored item', async () => {
      const storedItem = {
        PK: 'TENANT#t-3',
        SK: 'WORKER#w-3',
        worker_id: 'w-3',
        tenant_id: 't-3',
        legal_name: 'Maria Santos',
        preferred_name: 'Mari',
        phone: '+5511999887766',
        language_preference: 'pt',
        email: 'maria@company.com',
        qr_identity_reference: 'qr-xyz',
        status: 'inactive',
        created_at: '2024-02-20T12:00:00.000Z',
        updated_at: '2024-02-25T15:30:00.000Z',
      };

      const key = JSON.stringify({ PK: 'TENANT#t-3', SK: 'WORKER#w-3' });
      setupDynamoMock({ getResponses: new Map([[key, storedItem]]) });

      const result = await getWorker('t-3', 'w-3');

      expect(result!.preferred_name).toBe('Mari');
      expect(result!.email).toBe('maria@company.com');
      expect(result!.qr_identity_reference).toBe('qr-xyz');
    });

    it('returns result without optional fields when they are absent', async () => {
      const storedItem = {
        PK: 'TENANT#t-4',
        SK: 'WORKER#w-4',
        worker_id: 'w-4',
        tenant_id: 't-4',
        legal_name: 'John Smith',
        phone: '+12025551111',
        language_preference: 'en',
        status: 'active',
        created_at: '2024-04-01T00:00:00.000Z',
        updated_at: '2024-04-01T00:00:00.000Z',
      };

      const key = JSON.stringify({ PK: 'TENANT#t-4', SK: 'WORKER#w-4' });
      setupDynamoMock({ getResponses: new Map([[key, storedItem]]) });

      const result = await getWorker('t-4', 'w-4');

      expect(result).not.toBeNull();
      expect(result!.preferred_name).toBeUndefined();
      expect(result!.email).toBeUndefined();
    });
  });
});
