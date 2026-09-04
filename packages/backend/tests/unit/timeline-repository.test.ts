/**
 * Unit tests for the Timeline Repository.
 * Verifies append-only behavior: only PutItem and Query operations are used.
 *
 * Requirements: 15.1, 15.2, 15.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn((input: unknown) => ({ __type: 'PutCommand', input })),
    QueryCommand: vi.fn((input: unknown) => ({ __type: 'QueryCommand', input })),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

describe('timeline-repository', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  describe('appendEvent', () => {
    it('stores a timeline event with correct PK and SK', async () => {
      mockSend.mockResolvedValueOnce({});

      const { appendEvent } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const event = {
        event_id: 'evt-001',
        incident_id: 'inc-123',
        tenant_id: 'tenant-abc',
        event_type: 'creation',
        actor_id: 'user-1',
        actor_name: 'John Doe',
        data: { status: 'open' },
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = await appendEvent(event);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('dev-IncidentTimeline');
      expect(command.input.Item.PK).toBe('INCIDENT#inc-123');
      expect(command.input.Item.SK).toBe('EVENT#2024-01-15T10:30:00.000Z#evt-001');
      expect(command.input.Item.event_id).toBe('evt-001');
      expect(command.input.Item.incident_id).toBe('inc-123');
      expect(command.input.Item.tenant_id).toBe('tenant-abc');
      expect(command.input.Item.event_type).toBe('creation');
      expect(command.input.Item.actor_id).toBe('user-1');
      expect(command.input.Item.actor_name).toBe('John Doe');
      expect(command.input.Item.data).toEqual({ status: 'open' });
      expect(result).toEqual(event);
    });

    it('returns the event after successful append', async () => {
      mockSend.mockResolvedValueOnce({});

      const { appendEvent } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const event = {
        event_id: 'evt-002',
        incident_id: 'inc-456',
        tenant_id: 'tenant-xyz',
        event_type: 'state_change',
        actor_id: 'user-2',
        actor_name: 'Jane Smith',
        data: { from: 'open', to: 'under_review' },
        timestamp: '2024-01-15T11:00:00.000Z',
      };

      const result = await appendEvent(event);
      expect(result).toEqual(event);
    });
  });

  describe('getTimeline', () => {
    it('queries events for an incident in chronological order', async () => {
      const mockEvents = [
        {
          event_id: 'evt-001',
          incident_id: 'inc-123',
          tenant_id: 'tenant-abc',
          event_type: 'creation',
          actor_id: 'user-1',
          actor_name: 'John Doe',
          data: {},
          timestamp: '2024-01-15T10:00:00.000Z',
        },
        {
          event_id: 'evt-002',
          incident_id: 'inc-123',
          tenant_id: 'tenant-abc',
          event_type: 'state_change',
          actor_id: 'user-1',
          actor_name: 'John Doe',
          data: { from: 'open', to: 'under_review' },
          timestamp: '2024-01-15T11:00:00.000Z',
        },
      ];

      mockSend.mockResolvedValueOnce({ Items: mockEvents });

      const { getTimeline } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const result = await getTimeline('inc-123');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('dev-IncidentTimeline');
      expect(command.input.KeyConditionExpression).toBe(
        '#pk = :pk AND begins_with(#sk, :skPrefix)'
      );
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('INCIDENT#inc-123');
      expect(command.input.ExpressionAttributeValues[':skPrefix']).toBe('EVENT#');
      expect(command.input.ScanIndexForward).toBe(true);
      expect(result.events).toEqual(mockEvents);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns empty array when no events exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTimeline } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const result = await getTimeline('inc-nonexistent');

      expect(result.events).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('supports pagination with limit and cursor', async () => {
      const lastKey = { PK: 'INCIDENT#inc-123', SK: 'EVENT#2024-01-15T10:00:00.000Z#evt-001' };
      const cursor = Buffer.from(JSON.stringify(lastKey)).toString('base64');

      mockSend.mockResolvedValueOnce({
        Items: [
          {
            event_id: 'evt-002',
            incident_id: 'inc-123',
            tenant_id: 'tenant-abc',
            event_type: 'state_change',
            actor_id: 'user-1',
            actor_name: 'John Doe',
            data: {},
            timestamp: '2024-01-15T11:00:00.000Z',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const { getTimeline } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const result = await getTimeline('inc-123', { limit: 10, cursor });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Limit).toBe(10);
      expect(command.input.ExclusiveStartKey).toEqual(lastKey);
      expect(result.events).toHaveLength(1);
    });

    it('returns nextCursor when more results are available', async () => {
      const lastEvaluatedKey = {
        PK: 'INCIDENT#inc-123',
        SK: 'EVENT#2024-01-15T12:00:00.000Z#evt-003',
      };

      mockSend.mockResolvedValueOnce({
        Items: [
          {
            event_id: 'evt-001',
            incident_id: 'inc-123',
            tenant_id: 'tenant-abc',
            event_type: 'creation',
            actor_id: 'user-1',
            actor_name: 'John Doe',
            data: {},
            timestamp: '2024-01-15T10:00:00.000Z',
          },
        ],
        LastEvaluatedKey: lastEvaluatedKey,
      });

      const { getTimeline } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const result = await getTimeline('inc-123', { limit: 1 });

      expect(result.nextCursor).toBeDefined();
      const decodedCursor = JSON.parse(
        Buffer.from(result.nextCursor!, 'base64').toString()
      );
      expect(decodedCursor).toEqual(lastEvaluatedKey);
    });

    it('uses default limit of 100 when not specified', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const { getTimeline } = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      await getTimeline('inc-123');

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Limit).toBe(100);
    });
  });

  describe('append-only enforcement', () => {
    it('module does not export any update or delete functions', async () => {
      const timelineRepo = await import(
        '../../src/services/incidents/timeline-repository.js'
      );

      const exportedKeys = Object.keys(timelineRepo);
      expect(exportedKeys).toContain('appendEvent');
      expect(exportedKeys).toContain('getTimeline');

      // Verify no update/delete operations are exposed
      const forbiddenPatterns = ['update', 'delete', 'remove', 'modify', 'edit'];
      for (const key of exportedKeys) {
        for (const pattern of forbiddenPatterns) {
          expect(key.toLowerCase()).not.toContain(pattern);
        }
      }
    });
  });
});
