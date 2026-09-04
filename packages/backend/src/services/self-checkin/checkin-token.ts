/**
 * Check-in token lifecycle module.
 *
 * Site tokens (persistent) and SMS magic-link tokens (single-use, short-lived)
 * both live in CheckinTokens and are resolved by the public UUID via the
 * GSI1 `TOKEN#{token}` index — the same shape contractor-forms-qr uses.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 2.3, 2.6, 4.1, 4.2, 4.4, 7.5
 */

import { v4 as uuidv4 } from 'uuid';
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import {
  CHECKIN_TOKENS_TABLE,
  SMS_TOKEN_TTL_MS,
  type CheckinToken,
} from './types.js';

function itemToToken(item: Record<string, unknown>): CheckinToken {
  return {
    token_id: item['token_id'] as string,
    token: item['token'] as string,
    token_kind: item['token_kind'] as CheckinToken['token_kind'],
    tenant_id: item['tenant_id'] as string,
    site_id: item['site_id'] as string,
    worker_id: item['worker_id'] as string | undefined,
    status: item['status'] as CheckinToken['status'],
    created_by: item['created_by'] as string,
    created_at: item['created_at'] as string,
    expires_at: item['expires_at'] as string | undefined,
    consumed_at: item['consumed_at'] as string | undefined,
    ttl: item['ttl'] as number | undefined,
  };
}

function tokenItem(t: CheckinToken): Record<string, unknown> {
  const item: Record<string, unknown> = {
    PK: `TENANT#${t.tenant_id}`,
    SK: `CHECKIN_TOKEN#${t.token_id}`,
    GSI1PK: `TOKEN#${t.token}`,
    GSI1SK: `CHECKIN_TOKEN#${t.token_id}`,
    GSI2PK: `SITE#${t.site_id}`,
    GSI2SK: `CHECKIN_TOKEN#${t.token_kind}`,
    ...t,
  };
  return item;
}

/**
 * Find the existing ACTIVE persistent site token for a site, if any.
 */
async function findActiveSiteToken(
  siteId: string
): Promise<CheckinToken | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(CHECKIN_TOKENS_TABLE),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :site AND GSI2SK = :kind',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':site': `SITE#${siteId}`,
        ':kind': 'CHECKIN_TOKEN#site_persistent',
        ':active': 'active',
      },
    })
  );
  const item = res.Items?.[0];
  return item ? itemToToken(item as Record<string, unknown>) : null;
}

/**
 * Generate (or reuse) the persistent site check-in token.
 * Returns the existing active token if one exists (Requirement 1.3), else
 * creates a new one bound to site + tenant.
 */
export async function getOrCreateSiteToken(params: {
  tenantId: string;
  siteId: string;
  createdBy: string;
}): Promise<CheckinToken> {
  const existing = await findActiveSiteToken(params.siteId);
  if (existing) return existing;

  const token: CheckinToken = {
    token_id: uuidv4(),
    token: uuidv4(),
    token_kind: 'site_persistent',
    tenant_id: params.tenantId,
    site_id: params.siteId,
    status: 'active',
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(CHECKIN_TOKENS_TABLE),
      Item: tokenItem(token),
    })
  );
  return token;
}

/**
 * Regenerate the site token: invalidate the previous active token and issue a
 * new one, so previously printed QR codes stop resolving (Requirement 1.4).
 */
export async function regenerateSiteToken(params: {
  tenantId: string;
  siteId: string;
  createdBy: string;
}): Promise<CheckinToken> {
  const existing = await findActiveSiteToken(params.siteId);
  if (existing) {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(CHECKIN_TOKENS_TABLE),
        Key: {
          PK: `TENANT#${existing.tenant_id}`,
          SK: `CHECKIN_TOKEN#${existing.token_id}`,
        },
        UpdateExpression: 'SET #status = :invalid',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':invalid': 'invalidated' },
      })
    );
  }

  const token: CheckinToken = {
    token_id: uuidv4(),
    token: uuidv4(),
    token_kind: 'site_persistent',
    tenant_id: params.tenantId,
    site_id: params.siteId,
    status: 'active',
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
  };
  await docClient.send(
    new PutCommand({
      TableName: getTableName(CHECKIN_TOKENS_TABLE),
      Item: tokenItem(token),
    })
  );
  return token;
}

/**
 * Generate a single-use SMS magic-link token bound to worker + site + tenant.
 */
export async function createSmsToken(params: {
  tenantId: string;
  siteId: string;
  workerId: string;
  createdBy: string;
}): Promise<CheckinToken> {
  const now = Date.now();
  const expiresAt = new Date(now + SMS_TOKEN_TTL_MS).toISOString();
  const token: CheckinToken = {
    token_id: uuidv4(),
    token: uuidv4(),
    token_kind: 'sms_magic_link',
    tenant_id: params.tenantId,
    site_id: params.siteId,
    worker_id: params.workerId,
    status: 'active',
    created_by: params.createdBy,
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt,
    ttl: Math.floor((now + SMS_TOKEN_TTL_MS) / 1000),
  };
  await docClient.send(
    new PutCommand({
      TableName: getTableName(CHECKIN_TOKENS_TABLE),
      Item: tokenItem(token),
    })
  );
  return token;
}

/**
 * Resolve a public token via the GSI1 `TOKEN#{token}` index.
 *
 * Returns the token ONLY when it is valid:
 *  - status === 'active'
 *  - for SMS tokens: not consumed and expires_at in the future
 * Every other case (unknown, invalidated, consumed, expired) returns null so
 * the caller emits a single uniform "not valid" response (Requirements 2.3,
 * 7.5). Resolution is inherently scoped to the token's bound tenant + site.
 */
export async function resolveToken(token: string): Promise<CheckinToken | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(CHECKIN_TOKENS_TABLE),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :tok',
      ExpressionAttributeValues: { ':tok': `TOKEN#${token}` },
      Limit: 1,
    })
  );
  const item = res.Items?.[0];
  if (!item) return null;

  const resolved = itemToToken(item as Record<string, unknown>);
  if (resolved.status !== 'active') return null;

  if (resolved.token_kind === 'sms_magic_link') {
    if (!resolved.expires_at || new Date(resolved.expires_at).getTime() <= Date.now()) {
      return null;
    }
  }

  return resolved;
}

/**
 * Consume a single-use SMS token: set status = 'consumed' + consumed_at.
 * Uses a conditional write so a token can only be consumed once, even under a
 * race (Requirement 4.4). Returns true on success, false if already consumed.
 */
export async function consumeToken(t: CheckinToken): Promise<boolean> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(CHECKIN_TOKENS_TABLE),
        Key: {
          PK: `TENANT#${t.tenant_id}`,
          SK: `CHECKIN_TOKEN#${t.token_id}`,
        },
        UpdateExpression: 'SET #status = :consumed, consumed_at = :now',
        ConditionExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':consumed': 'consumed',
          ':active': 'active',
          ':now': new Date().toISOString(),
        },
      })
    );
    return true;
  } catch {
    // ConditionalCheckFailed → already consumed/invalidated.
    return false;
  }
}
