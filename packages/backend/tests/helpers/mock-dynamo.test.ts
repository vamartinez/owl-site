import { describe, it, expect, beforeEach } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from './mock-dynamo';

describe('DynamoDB Mock Helper', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  describe('setupDynamoMock', () => {
    it('initializes with empty state when no config provided', () => {
      setupDynamoMock();
      expect(getDynamoCalls()).toEqual([]);
    });

    it('clears previous calls on re-setup', async () => {
      setupDynamoMock();
      const send = getMockSend();
      await send({ constructor: { name: 'PutCommand' }, input: { Item: { id: '1' } } });
      expect(getDynamoCalls()).toHaveLength(1);

      setupDynamoMock();
      expect(getDynamoCalls()).toEqual([]);
    });
  });

  describe('GetCommand responses', () => {
    it('returns configured item for matching key', async () => {
      const item = { id: 'user-1', name: 'Alice' };
      const key = JSON.stringify({ PK: 'USER#1', SK: 'PROFILE' });
      const getResponses = new Map([[key, item]]);

      setupDynamoMock({ getResponses });
      const send = getMockSend();

      const result = await send({
        constructor: { name: 'GetCommand' },
        input: { Key: { PK: 'USER#1', SK: 'PROFILE' } },
      });

      expect(result.Item).toEqual(item);
    });

    it('returns undefined Item when key not in configured responses', async () => {
      setupDynamoMock({ getResponses: new Map() });
      const send = getMockSend();

      const result = await send({
        constructor: { name: 'GetCommand' },
        input: { Key: { PK: 'MISSING', SK: 'KEY' } },
      });

      expect(result.Item).toBeUndefined();
    });
  });

  describe('QueryCommand responses', () => {
    it('returns configured items for matching query key', async () => {
      const items = [{ id: '1' }, { id: '2' }];
      const queryKey = JSON.stringify({
        TableName: 'dev-Workers',
        IndexName: undefined,
        ExpressionAttributeValues: { ':pk': 'TENANT#abc' },
      });
      const queryResponses = new Map([[queryKey, items]]);

      setupDynamoMock({ queryResponses });
      const send = getMockSend();

      const result = await send({
        constructor: { name: 'QueryCommand' },
        input: {
          TableName: 'dev-Workers',
          ExpressionAttributeValues: { ':pk': 'TENANT#abc' },
        },
      });

      expect(result.Items).toEqual(items);
      expect(result.Count).toBe(2);
    });

    it('returns empty array when query key not configured', async () => {
      setupDynamoMock({ queryResponses: new Map() });
      const send = getMockSend();

      const result = await send({
        constructor: { name: 'QueryCommand' },
        input: { TableName: 'dev-Workers', ExpressionAttributeValues: {} },
      });

      expect(result.Items).toEqual([]);
      expect(result.Count).toBe(0);
    });
  });

  describe('PutCommand capture', () => {
    it('captures put inputs when putCapture is configured', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });
      const send = getMockSend();

      await send({
        constructor: { name: 'PutCommand' },
        input: { TableName: 'dev-Workers', Item: { id: 'w-1', name: 'Bob' } },
      });

      expect(putCapture).toHaveLength(1);
      expect(putCapture[0]).toEqual({
        TableName: 'dev-Workers',
        Item: { id: 'w-1', name: 'Bob' },
      });
    });

    it('does not throw when putCapture is not configured', async () => {
      setupDynamoMock();
      const send = getMockSend();

      await expect(
        send({
          constructor: { name: 'PutCommand' },
          input: { Item: { id: '1' } },
        })
      ).resolves.toEqual({});
    });
  });

  describe('UpdateCommand capture', () => {
    it('captures update inputs when updateCapture is configured', async () => {
      const updateCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ updateCapture });
      const send = getMockSend();

      await send({
        constructor: { name: 'UpdateCommand' },
        input: { TableName: 'dev-Workers', Key: { PK: 'T#1', SK: 'W#1' }, UpdateExpression: 'SET #name = :name' },
      });

      expect(updateCapture).toHaveLength(1);
      expect(updateCapture[0].UpdateExpression).toBe('SET #name = :name');
    });
  });

  describe('DeleteCommand capture', () => {
    it('captures delete inputs when deleteCapture is configured', async () => {
      const deleteCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ deleteCapture });
      const send = getMockSend();

      await send({
        constructor: { name: 'DeleteCommand' },
        input: { TableName: 'dev-Workers', Key: { PK: 'T#1', SK: 'W#1' } },
      });

      expect(deleteCapture).toHaveLength(1);
      expect(deleteCapture[0].Key).toEqual({ PK: 'T#1', SK: 'W#1' });
    });
  });

  describe('getDynamoCalls', () => {
    it('records all commands with their inputs', async () => {
      setupDynamoMock();
      const send = getMockSend();

      await send({ constructor: { name: 'GetCommand' }, input: { Key: { id: '1' } } });
      await send({ constructor: { name: 'PutCommand' }, input: { Item: { id: '2' } } });
      await send({ constructor: { name: 'QueryCommand' }, input: { TableName: 'T' } });

      const calls = getDynamoCalls();
      expect(calls).toHaveLength(3);
      expect(calls[0].command).toBe('GetCommand');
      expect(calls[1].command).toBe('PutCommand');
      expect(calls[2].command).toBe('QueryCommand');
    });

    it('returns a copy of calls (not a reference)', async () => {
      setupDynamoMock();
      const send = getMockSend();
      await send({ constructor: { name: 'PutCommand' }, input: {} });

      const calls1 = getDynamoCalls();
      const calls2 = getDynamoCalls();

      expect(calls1).toEqual(calls2);
      expect(calls1).not.toBe(calls2);
    });
  });

  describe('resetDynamoMock', () => {
    it('clears all recorded calls', async () => {
      setupDynamoMock();
      const send = getMockSend();
      await send({ constructor: { name: 'PutCommand' }, input: {} });
      expect(getDynamoCalls()).toHaveLength(1);

      resetDynamoMock();
      expect(getDynamoCalls()).toEqual([]);
    });

    it('clears configuration so subsequent calls get default responses', async () => {
      const getResponses = new Map([
        [JSON.stringify({ id: '1' }), { id: '1', name: 'found' }],
      ]);
      setupDynamoMock({ getResponses });
      resetDynamoMock();

      const send = getMockSend();
      const result = await send({
        constructor: { name: 'GetCommand' },
        input: { Key: { id: '1' } },
      });

      expect(result.Item).toBeUndefined();
    });
  });

  describe('ScanCommand', () => {
    it('returns empty items by default', async () => {
      setupDynamoMock();
      const send = getMockSend();

      const result = await send({
        constructor: { name: 'ScanCommand' },
        input: { TableName: 'dev-Workers' },
      });

      expect(result.Items).toEqual([]);
      expect(result.Count).toBe(0);
    });
  });

  describe('Unknown commands', () => {
    it('returns empty object for unknown command types', async () => {
      setupDynamoMock();
      const send = getMockSend();

      const result = await send({
        constructor: { name: 'BatchWriteCommand' },
        input: { RequestItems: {} },
      });

      expect(result).toEqual({});
    });

    it('still records the call', async () => {
      setupDynamoMock();
      const send = getMockSend();

      await send({ constructor: { name: 'BatchWriteCommand' }, input: { foo: 'bar' } });

      const calls = getDynamoCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('BatchWriteCommand');
    });
  });
});
