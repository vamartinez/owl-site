/**
 * SMS magic-link dispatch for self check-in.
 *
 * Generates a single-use sms_magic_link token (via checkin-token) bound to
 * worker + site + tenant, builds the public URL, and dispatches it through the
 * EXISTING notification-service SMS channel (sendSms / SNS). On a delivery
 * failure the caller reports `sent: false` and never claims the link was sent.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { sendSms } from '../notification/channels/sms.js';
import { createSmsToken } from './checkin-token.js';

const WORKERS_TABLE = 'Workers';
const logger = createLogger('self-checkin-sms-link');

export interface SendSmsLinkInput {
  tenantId: string;
  siteId: string;
  workerId: string;
  createdBy: string;
  correlationId?: string;
}

export interface SendSmsLinkResult {
  sent: boolean;
  expires_at?: string;
  error?: string;
}

/** Resolve the worker's E.164 phone number for the tenant. */
async function getWorkerPhone(
  tenantId: string,
  workerId: string
): Promise<string | null> {
  const res = await docClient.send(
    new GetCommand({
      TableName: getTableName(WORKERS_TABLE),
      Key: { PK: `TENANT#${tenantId}`, SK: `WORKER#${workerId}` },
    })
  );
  const phone = res.Item?.['phone'];
  return typeof phone === 'string' && phone.length > 0 ? phone : null;
}

/** Absolute public base URL for check-in links. */
function publicBaseUrl(): string {
  const domain = process.env['PUBLIC_APP_DOMAIN'] ?? '';
  return domain.replace(/\/+$/, '');
}

/**
 * Generate a single-use SMS token and dispatch the magic link.
 * Returns `{ sent: false }` (never a success) when SNS reports a delivery
 * failure, and does NOT leave a claim that the link was sent (Requirement 4.5).
 */
export async function sendSmsLink(
  input: SendSmsLinkInput
): Promise<SendSmsLinkResult> {
  const phone = await getWorkerPhone(input.tenantId, input.workerId);
  if (!phone) {
    return { sent: false, error: 'Worker has no registered phone number' };
  }

  const token = await createSmsToken({
    tenantId: input.tenantId,
    siteId: input.siteId,
    workerId: input.workerId,
    createdBy: input.createdBy,
  });

  const url = `${publicBaseUrl()}/check-in/${token.token}`;
  const message = `Site check-in: open this one-time link to check in. ${url}`;

  const delivery = await sendSms({
    phoneNumber: phone,
    message,
    correlation_id: input.correlationId,
  });

  if (!delivery.success) {
    logger.error('SMS check-in link delivery failed', {
      worker_id: input.workerId,
      site_id: input.siteId,
    });
    return { sent: false, error: 'SMS delivery failed' };
  }

  return { sent: true, expires_at: token.expires_at };
}
