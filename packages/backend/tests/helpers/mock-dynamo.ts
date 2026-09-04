/**
 * DynamoDB Mock Helper
 *
 * Provides utilities to mock @aws-sdk/lib-dynamodb interactions for testing.
 * Records all DynamoDB command invocations and returns configurable responses
 * for Get/Query operations, while capturing Put/Update/Delete inputs.
 */

import { vi } from 'vitest';

export interface DynamoMockConfig {
  /** Map of serialized key → item to return for GetCommand calls */
  getResponses?: Map<string, Record<string, unknown>>;
  /** Map of serialized query key → items array to return for QueryCommand calls */
  queryResponses?: Map<string, Record<string, unknown>[]>;
  /** Array to capture PutCommand inputs */
  putCapture?: Array<Record<string, unknown>>;
  /** Array to capture UpdateCommand inputs */
  updateCapture?: Array<Record<string, unknown>>;
  /** Array to capture DeleteCommand inputs */
  deleteCapture?: Array<Record<string, unknown>>;
}

interface DynamoCall {
  command: string;
  input: unknown;
}

let calls: DynamoCall[] = [];
let currentConfig: DynamoMockConfig = {};

/**
 * Creates the mock send function that intercepts DynamoDB DocumentClient commands.
 */
function createMockSend() {
  return vi.fn().mockImplementation((command: unknown) => {
    const commandObj = command as { constructor: { name: string }; input: Record<string, unknown> };
    const commandName = commandObj.constructor?.name ?? 'UnknownCommand';
    const input = commandObj.input ?? {};

    calls.push({ command: commandName, input });

    switch (commandName) {
      case 'GetCommand': {
        const key = JSON.stringify(input.Key ?? input.key ?? {});
        const item = currentConfig.getResponses?.get(key);
        return Promise.resolve({ Item: item ?? undefined });
      }

      case 'QueryCommand': {
        // Use a combination of TableName/IndexName + KeyConditionExpression values as the lookup key
        const queryKey = JSON.stringify({
          TableName: input.TableName,
          IndexName: input.IndexName,
          ExpressionAttributeValues: input.ExpressionAttributeValues,
        });
        const items = currentConfig.queryResponses?.get(queryKey);
        return Promise.resolve({ Items: items ?? [], Count: items?.length ?? 0 });
      }

      case 'PutCommand': {
        if (currentConfig.putCapture) {
          currentConfig.putCapture.push(input as Record<string, unknown>);
        }
        return Promise.resolve({});
      }

      case 'UpdateCommand': {
        if (currentConfig.updateCapture) {
          currentConfig.updateCapture.push(input as Record<string, unknown>);
        }
        return Promise.resolve({ Attributes: {} });
      }

      case 'DeleteCommand': {
        if (currentConfig.deleteCapture) {
          currentConfig.deleteCapture.push(input as Record<string, unknown>);
        }
        return Promise.resolve({});
      }

      case 'ScanCommand': {
        return Promise.resolve({ Items: [], Count: 0 });
      }

      default:
        return Promise.resolve({});
    }
  });
}

const mockSend = createMockSend();

/**
 * Sets up the DynamoDB mock by calling vi.mock on the shared dynamo-client module.
 * Must be called at the top level of test files (outside describe/it blocks) or
 * within a beforeEach/beforeAll block.
 *
 * @param config - Optional configuration for mock responses and captures
 */
export function setupDynamoMock(config?: DynamoMockConfig): void {
  currentConfig = config ?? {};
  calls = [];
  mockSend.mockClear();
}

/**
 * Returns all recorded DynamoDB command calls since the last setup/reset.
 */
export function getDynamoCalls(): DynamoCall[] {
  return [...calls];
}

/**
 * Resets the mock state: clears all recorded calls and configuration.
 * Also restores the default implementation in case it was overridden by mockReset/mockImplementation.
 */
export function resetDynamoMock(): void {
  calls = [];
  currentConfig = {};
  mockSend.mockReset();
  mockSend.mockImplementation((command: unknown) => {
    const commandObj = command as { constructor: { name: string }; input: Record<string, unknown> };
    const commandName = commandObj.constructor?.name ?? 'UnknownCommand';
    const input = commandObj.input ?? {};

    calls.push({ command: commandName, input });

    switch (commandName) {
      case 'GetCommand': {
        const key = JSON.stringify(input.Key ?? input.key ?? {});
        const item = currentConfig.getResponses?.get(key);
        return Promise.resolve({ Item: item ?? undefined });
      }

      case 'QueryCommand': {
        const queryKey = JSON.stringify({
          TableName: input.TableName,
          IndexName: input.IndexName,
          ExpressionAttributeValues: input.ExpressionAttributeValues,
        });
        const items = currentConfig.queryResponses?.get(queryKey);
        return Promise.resolve({ Items: items ?? [], Count: items?.length ?? 0 });
      }

      case 'PutCommand': {
        if (currentConfig.putCapture) {
          currentConfig.putCapture.push(input as Record<string, unknown>);
        }
        return Promise.resolve({});
      }

      case 'UpdateCommand': {
        if (currentConfig.updateCapture) {
          currentConfig.updateCapture.push(input as Record<string, unknown>);
        }
        return Promise.resolve({ Attributes: {} });
      }

      case 'DeleteCommand': {
        if (currentConfig.deleteCapture) {
          currentConfig.deleteCapture.push(input as Record<string, unknown>);
        }
        return Promise.resolve({});
      }

      case 'ScanCommand': {
        return Promise.resolve({ Items: [], Count: 0 });
      }

      default:
        return Promise.resolve({});
    }
  });
}

/**
 * Returns the mock send function for use with vi.mock.
 * This allows test files to wire up the mock:
 *
 * ```typescript
 * vi.mock('../../shared/dynamo-client.js', () => ({
 *   docClient: { send: getMockSend() },
 *   getTableName: (baseName: string) => `test-${baseName}`,
 * }));
 * ```
 */
export function getMockSend() {
  return mockSend;
}
