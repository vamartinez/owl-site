/**
 * Identity verification for the self check-in QR flow.
 *
 * Challenge: last 4 digits of the worker's registered phone + legal name.
 * (The design's original phone+DOB challenge was changed to phone+legal_name
 * because the WorkerIdentity model has no date_of_birth field; both phone and
 * legal_name already exist.) Matching is scoped to the token's tenant and must
 * resolve EXACTLY ONE worker. Zero matches and multi-matches both return the
 * identical generic result — the response never reveals which field matched.
 *
 * No Cognito session, token, or user account is ever created for the worker.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.7
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { sanitizeInput } from '../forms/sanitizer.js';

const WORKERS_TABLE = 'Workers';

export interface IdentityChallenge {
  phone_last4: string;
  legal_name: string;
}

export interface IdentityResult {
  verified: boolean;
  worker_id?: string;
}

/**
 * Normalize a name for tolerant comparison: strip HTML/control via sanitizeInput,
 * lowercase, remove diacritics, collapse whitespace.
 */
function normalizeName(raw: string): string {
  return sanitizeInput(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep only digits, then take the last 4. */
function lastFourDigits(raw: string): string {
  const digits = sanitizeInput(raw).replace(/\D/g, '');
  return digits.slice(-4);
}

/**
 * Verify a worker by last-4-phone + legal name, scoped to one tenant.
 *
 * Returns `{ verified: true, worker_id }` only on an exact single match.
 * Returns `{ verified: false }` for BOTH zero matches and multiple matches, so
 * the caller emits one uniform "could not verify" response (Requirement 3.3).
 */
export async function verifyIdentity(
  tenantId: string,
  challenge: IdentityChallenge
): Promise<IdentityResult> {
  const wantLast4 = lastFourDigits(challenge.phone_last4);
  const wantName = normalizeName(challenge.legal_name);

  // A malformed challenge (not 4 digits, or empty name) can never match.
  if (wantLast4.length !== 4 || wantName.length === 0) {
    return { verified: false };
  }

  // Query all active workers in the tenant, then match in-memory. The tenant
  // partition is bounded; matching on a hashed/last-4 GSI is a future
  // optimization but not required for correctness or non-disclosure.
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(WORKERS_TABLE),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :wprefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':wprefix': 'WORKER#',
      },
    })
  );

  const items = (res.Items ?? []) as Array<Record<string, unknown>>;

  const matches = items.filter((w) => {
    const phone = typeof w['phone'] === 'string' ? (w['phone'] as string) : '';
    const legalName = typeof w['legal_name'] === 'string' ? (w['legal_name'] as string) : '';
    const status = w['status'];
    if (status && status !== 'active') return false;
    return lastFourDigits(phone) === wantLast4 && normalizeName(legalName) === wantName;
  });

  // Exactly one match → verified. Zero or many → uniform failure.
  if (matches.length === 1) {
    const workerId = matches[0]['worker_id'] as string;
    return { verified: true, worker_id: workerId };
  }

  return { verified: false };
}
