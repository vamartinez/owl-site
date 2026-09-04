/**
 * Access Token Manager.
 * Handles AccessToken generation, validation, expiry, revocation, and device binding.
 *
 * Business Rules:
 * - TTL max 10 minutes
 * - Token types: qr_session, sms_magic_link, gate_pass
 * - Expiry validation: reject expired tokens
 * - Revocation: reject within 5s of revocation request
 * - Device binding: token is bound to the device that created it
 *
 * Requirements: 4.5, 4.6, 4.7
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { TokenType } from '../../shared/types/common.js';
import type { AccessToken } from './types.js';

/** Maximum token TTL in milliseconds (10 minutes). */
const MAX_TTL_MS = 10 * 60 * 1000;

/**
 * Generates a new AccessToken with a TTL of max 10 minutes.
 * The token is bound to the specified device.
 */
export async function generateToken(
  tenantId: string,
  workerId: string,
  siteId: string,
  tokenType: TokenType,
  deviceId: string
): Promise<AccessToken> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_TTL_MS);

  const token: AccessToken = {
    token_id: uuidv4(),
    tenant_id: tenantId,
    worker_id: workerId,
    site_id: siteId,
    token_type: tokenType,
    device_id: deviceId,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    revoked: false,
    used: false,
  };

  // Store in DynamoDB with TTL for automatic cleanup
  const ttlEpoch = Math.floor(expiresAt.getTime() / 1000);

  await docClient.send(
    new PutCommand({
      TableName: getTableName('AccessTokens'),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `TOKEN#${token.token_id}`,
        GSI1PK: `WORKER#${workerId}`,
        GSI1SK: `TOKEN#${token.issued_at}`,
        ...token,
        ttl: ttlEpoch,
      },
    })
  );

  return token;
}

/**
 * Retrieves a token by ID.
 */
export async function getToken(
  tenantId: string,
  tokenId: string
): Promise<AccessToken | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('AccessTokens'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `TOKEN#${tokenId}`,
      },
    })
  );

  if (!result.Item) return null;

  return result.Item as unknown as AccessToken;
}

/**
 * Validates a token for use.
 * Returns an error message if the token is invalid, or null if valid.
 *
 * Checks:
 * 1. Token exists
 * 2. Token is not expired
 * 3. Token is not revoked
 * 4. Token has not already been used
 * 5. Device matches (device binding)
 */
export function validateToken(
  token: AccessToken,
  deviceId: string
): { valid: boolean; error?: string; replay_risk?: boolean } {
  const now = new Date();
  const expiresAt = new Date(token.expires_at);

  // Check expiry
  if (now >= expiresAt) {
    return { valid: false, error: 'Token has expired' };
  }

  // Check revocation
  if (token.revoked) {
    return { valid: false, error: 'Token has been revoked' };
  }

  // Check if already used (replay detection)
  if (token.used) {
    return { valid: false, error: 'Token has already been used', replay_risk: true };
  }

  // Check device binding — different device triggers replay risk
  if (token.device_id !== deviceId) {
    return { valid: false, error: 'Token presented from different device', replay_risk: true };
  }

  return { valid: true };
}

/**
 * Marks a token as used.
 */
export async function markTokenUsed(
  tenantId: string,
  tokenId: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('AccessTokens'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `TOKEN#${tokenId}`,
      },
      UpdateExpression: 'SET used = :used, used_at = :usedAt',
      ExpressionAttributeValues: {
        ':used': true,
        ':usedAt': new Date().toISOString(),
      },
    })
  );
}

/**
 * Revokes a token immediately.
 * The token will be rejected on any subsequent validation attempt.
 */
export async function revokeToken(
  tenantId: string,
  tokenId: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken(tenantId, tokenId);
  if (!token) {
    return { success: false, error: 'Token not found' };
  }

  if (token.revoked) {
    return { success: false, error: 'Token is already revoked' };
  }

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('AccessTokens'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `TOKEN#${tokenId}`,
      },
      UpdateExpression: 'SET revoked = :revoked, revoked_at = :revokedAt',
      ExpressionAttributeValues: {
        ':revoked': true,
        ':revokedAt': new Date().toISOString(),
      },
    })
  );

  return { success: true };
}

/**
 * Checks if a token is expired based on its expires_at timestamp.
 */
export function isTokenExpired(token: AccessToken): boolean {
  return new Date() >= new Date(token.expires_at);
}
