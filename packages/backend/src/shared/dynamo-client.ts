/**
 * DynamoDB Document Client initialization with environment-aware table prefix.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

/**
 * Returns the environment-aware table prefix.
 * In dev environment, tables are prefixed with "dev-".
 * In prod, no prefix is applied.
 */
export function getTablePrefix(): string {
  const environment = process.env['ENVIRONMENT'] ?? 'dev';
  return environment === 'prod' ? '' : `${environment}-`;
}

/**
 * Returns the full table name with the environment prefix applied.
 */
export function getTableName(baseName: string): string {
  return `${getTablePrefix()}${baseName}`;
}
