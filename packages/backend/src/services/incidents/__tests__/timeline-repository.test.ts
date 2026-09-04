import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TimelineEventType } from '../types';
import type { TimelineEvent } from '../types';

// Mock the dynamo-client module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (baseName: string) => `dev-${baseName}`,
}));

import { docClient } from '../../../shared/dynamo-client.js';
import { appendEvent, getTimeline } from '../timeline-repository';

const mockSend = vi.mocked(docClient.send);

function buildTimelineEvent(overrides?: Partial<TimelineEvent>): TimelineEvent {
  return {
    event_id: 'evt-001',
    incident_id: 'inc-001',
    tenant_id: 'tenant-abc',
    event_type: TimelineEventType.CREATION,
    actor_id: 'user-001',
    actor_name: 'John Doe',
    data: { status: 'open' },
    timestamp: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('Timeline Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('appendEvent', () => {
    it('sends a PutCommand with correct PK and chronological SK', async () => {
      mockSend.mockResolvedValueOnce({} as never);
      const event = buildTimelineEvent();

      const result = await appendEvent(event);

      expect(result).toEqual(event);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.TableName).toBe('dev-IncidentTimeline');
      expect(command.input.Item).toMatchObject({
        PK: 'INCIDENT#inc-001',
        SK: 'EVENT#2024-01-15T10:00:00.000Z#evt-001',
      });
    });

    it('constructs SK with timestamp prefix to maintain chronological ordering', async () => {
      mockSend.mockResolvedValueOnce({} as never);
      const event = buildTimelineEvent({
        event_id: 'evt-abc',
        timestamp: '2024-06-20T14:30:00.000Z',
      });

      await appendEvent(event);

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.Item!['SK']).toBe('EVENT#2024-06-20T14:30:00.000Z#evt-abc');
    });

    it('includes all event fields in the stored item', async () => {
      mockSend.mockResolvedValueOnce({} as never);
      const event = buildTimelineEvent({
        event_type: TimelineEventType.STATE_CHANGE,
        data: { from: 'open', to: 'under_review' },
      });

      await appendEvent(event);

      const command = mockSend.mock.calls[0][0] as PutCommand;
      const item = command.input.Item!;
      expect(item['event_id']).toBe('evt-001');
      expect(item['incident_id']).toBe('inc-001');
      expect(item['tenant_id']).toBe('tenant-abc');
      expect(item['event_type']).toBe(TimelineEventType.STATE_CHANGE);
      expect(item['actor_id']).toBe('user-001');
      expect(item['actor_name']).toBe('John Doe');
      expect(item['data']).toEqual({ from: 'open', to: 'under_review' });
      expect(item['timestamp']).toBe('2024-01-15T10:00:00.000Z');
    });

    it('ensures later timestamps produce lexicographically greater sort keys', async () => {
      mockSend.mockResolvedValue({} as never);

      const earlyEvent = buildTimelineEvent({
        event_id: 'evt-001',
        timestamp: '2024-01-15T10:00:00.000Z',
      });
      const laterEvent = buildTimelineEvent({
        event_id: 'evt-002',
        timestamp: '2024-01-15T10:05:00.000Z',
      });

      await appendEvent(earlyEvent);
      await appendEvent(laterEvent);

      const earlyCommand = mockSend.mock.calls[0][0] as PutCommand;
      const laterCommand = mockSend.mock.calls[1][0] as PutCommand;

      const earlySK = earlyCommand.input.Item!['SK'] as string;
      const laterSK = laterCommand.input.Item!['SK'] as string;

      // Lexicographic comparison ensures chronological ordering
      expect(earlySK < laterSK).toBe(true);
    });

    it('maintains ascending order for events within the same second using event_id', async () => {
      mockSend.mockResolvedValue({} as never);

      const eventA = buildTimelineEvent({
        event_id: 'evt-aaa',
        timestamp: '2024-01-15T10:00:00.000Z',
      });
      const eventB = buildTimelineEvent({
        event_id: 'evt-bbb',
        timestamp: '2024-01-15T10:00:00.000Z',
      });

      await appendEvent(eventA);
      await appendEvent(eventB);

      const commandA = mockSend.mock.calls[0][0] as PutCommand;
      const commandB = mockSend.mock.calls[1][0] as PutCommand;

      const skA = commandA.input.Item!['SK'] as string;
      const skB = commandB.input.Item!['SK'] as string;

      // Same timestamp, but event_id differentiates order
      expect(skA).toBe('EVENT#2024-01-15T10:00:00.000Z#evt-aaa');
      expect(skB).toBe('EVENT#2024-01-15T10:00:00.000Z#evt-bbb');
      expect(skA < skB).toBe(true);
    });

    it('returns the event unchanged after persisting', async () => {
      mockSend.mockResolvedValueOnce({} as never);
      const event = buildTimelineEvent({
        event_type: TimelineEventType.COMMENT_ADDED,
        data: { comment_id: 'cmt-001' },
      });

      const result = await appendEvent(event);

      expect(result).toStrictEqual(event);
    });
  });

  describe('getTimeline', () => {
    it('queries with correct PK and SK prefix for chronological order', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await getTimeline('inc-001');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.TableName).toBe('dev-IncidentTimeline');
      expect(command.input.KeyConditionExpression).toBe(
        '#pk = :pk AND begins_with(#sk, :skPrefix)'
      );
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':pk': 'INCIDENT#inc-001',
        ':skPrefix': 'EVENT#',
      });
      expect(command.input.ScanIndexForward).toBe(true);
    });

    it('returns events in chronological order (ScanIndexForward: true)', async () => {
      const events: TimelineEvent[] = [
        buildTimelineEvent({ event_id: 'evt-001', timestamp: '2024-01-15T10:00:00.000Z' }),
        buildTimelineEvent({ event_id: 'evt-002', timestamp: '2024-01-15T10:05:00.000Z' }),
        buildTimelineEvent({ event_id: 'evt-003', timestamp: '2024-01-15T10:10:00.000Z' }),
      ];
      mockSend.mockResolvedValueOnce({ Items: events } as never);

      const result = await getTimeline('inc-001');

      expect(result.events).toEqual(events);
      expect(result.events[0].timestamp < result.events[1].timestamp).toBe(true);
      expect(result.events[1].timestamp < result.events[2].timestamp).toBe(true);
    });

    it('applies default limit of 100', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await getTimeline('inc-001');

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.Limit).toBe(100);
    });

    it('applies custom limit when specified', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await getTimeline('inc-001', { limit: 25 });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.Limit).toBe(25);
    });

    it('supports pagination with cursor', async () => {
      const lastKey = { PK: 'INCIDENT#inc-001', SK: 'EVENT#2024-01-15T10:00:00.000Z#evt-001' };
      const cursor = Buffer.from(JSON.stringify(lastKey)).toString('base64');
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await getTimeline('inc-001', { cursor });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.ExclusiveStartKey).toEqual(lastKey);
    });

    it('returns nextCursor when LastEvaluatedKey is present', async () => {
      const lastKey = { PK: 'INCIDENT#inc-001', SK: 'EVENT#2024-01-15T10:05:00.000Z#evt-002' };
      mockSend.mockResolvedValueOnce({
        Items: [buildTimelineEvent()],
        LastEvaluatedKey: lastKey,
      } as never);

      const result = await getTimeline('inc-001');

      expect(result.nextCursor).toBe(
        Buffer.from(JSON.stringify(lastKey)).toString('base64')
      );
    });

    it('returns undefined nextCursor when no LastEvaluatedKey', async () => {
      mockSend.mockResolvedValueOnce({ Items: [buildTimelineEvent()] } as never);

      const result = await getTimeline('inc-001');

      expect(result.nextCursor).toBeUndefined();
    });

    it('returns empty events array when no items found', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined } as never);

      const result = await getTimeline('inc-001');

      expect(result.events).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });
  });
});
