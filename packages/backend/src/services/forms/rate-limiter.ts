/**
 * Rate Limiter Module for Forms Service.
 * Implements sliding window rate limiting using the existing RateLimits DynamoDB table.
 *
 * Key behaviors:
 * - Uses atomic DynamoDB operations (UpdateCommand with ADD) for thread-safe counting
 * - Sliding window: 10 requests per IP per form per 5-minute window
 * - Returns { allowed: true } when under limit
 * - Returns { allowed: false, retryAfterSeconds } when limit exceeded
 * - TTL (expiresAt) auto-cleans expired records
 *
 * Requirements: 15.1, 15.2
 */

import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './types.js';

const RATE_LIMITS_TABLE = 'RateLimits';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Checks and enforces rate limiting for a form submission.
 *
 * Uses a sliding window approach:
 * 1. If no record exists or the window has expired, starts a new window with count=1
 * 2. If within the current window, atomically increments the counter
 * 3. If count exceeds max requests, rejects with retry_after_seconds
 *
 * @param formId - The form being submitted to
 * @param ipAddress - The IP address of the submitter
 * @returns RateLimitResult indicating whether the request is allowed
 */
export async function checkRateLimit(
  formId: string,
  ipAddress: string
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowSeconds = Math.floor(RATE_LIMIT_WINDOW_MS / 1000);
  const pk = `RATELIMIT#FORM#${formId}`;
  const sk = `IP#${ipAddress}`;
  const tableName = getTableName(RATE_LIMITS_TABLE);

  // First, try to get the existing record to check if the window is still active
  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
    })
  );

  const item = existing.Item;

  if (item && item.window_start) {
    const windowStart = new Date(item.window_start).getTime();
    const windowEnd = windowStart + RATE_LIMIT_WINDOW_MS;

    if (now < windowEnd) {
      // Window is still active — check if already at limit
      const currentCount = (item.count as number) || 0;

      if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
        // Already at limit, calculate retry time
        const retryAfterSeconds = Math.ceil((windowEnd - now) / 1000);
        return { allowed: false, retryAfterSeconds };
      }

      // Atomically increment the counter
      const result = await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: pk, SK: sk },
          UpdateExpression: 'ADD #count :inc',
          ConditionExpression: '#window_start = :window_start',
          ExpressionAttributeNames: {
            '#count': 'count',
            '#window_start': 'window_start',
          },
          ExpressionAttributeValues: {
            ':inc': 1,
            ':window_start': item.window_start,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const newCount = result.Attributes?.count as number;

      if (newCount > RATE_LIMIT_MAX_REQUESTS) {
        // Race condition: another request incremented past the limit
        const retryAfterSeconds = Math.ceil((windowEnd - now) / 1000);
        return { allowed: false, retryAfterSeconds };
      }

      return { allowed: true };
    }
  }

  // No record or window expired — start a new window
  const windowStart = new Date(now).toISOString();
  const expiresAt = Math.floor(now / 1000) + windowSeconds;

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      UpdateExpression:
        'SET #count = :one, #window_start = :window_start, #expiresAt = :expiresAt',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#window_start': 'window_start',
        '#expiresAt': 'expiresAt',
      },
      ExpressionAttributeValues: {
        ':one': 1,
        ':window_start': windowStart,
        ':expiresAt': expiresAt,
      },
    })
  );

  return { allowed: true };
}
