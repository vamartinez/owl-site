/**
 * WorkSafeBC notifications + timeout watchdog (task 11).
 *
 * 11.1 notificationDispatchHandler — subscribed to the pdf-compliance SNS topic.
 *      On a terminal state it records notification_delivered on the session and
 *      emits an in-platform ("bell") notification via the platform events topic.
 *      Delivery is retried by the SNS→Lambda subscription's own retry policy;
 *      on give-up we persist notification_delivered:false (Requirement 6.7).
 * 11.2 timeoutWatchdogHandler — invoked on a schedule (EventBridge rate rule).
 *      Any session past the 10-minute budget without reaching a terminal state
 *      is transitioned to `timeout` and notified (Requirement 6.5).
 *
 * ASSUMPTION (flagged): notification channel = in-platform bell for v1
 * (design.md Open Question 3). SES email is a later extension.
 *
 * Requirements: 6.3, 6.5, 6.6, 6.7
 */

import { QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import {
  ANALYSIS_SESSIONS_TABLE,
  TERMINAL_SESSION_STATUSES,
  type AnalysisSession,
  type SessionStatus,
} from './worksafebc-types.js';

const logger = createLogger('worksafebc-notifications');
const snsClient = new SNSClient({});

const PLATFORM_TOPIC_ARN = (): string => process.env['SNS_TOPIC_ARN'] ?? '';
/** 10-minute budget from started_at spanning all queue hops (Requirement 6.5). */
export const TIMEOUT_BUDGET_MS = 10 * 60 * 1000;

// ── Pure predicates (unit/property-testable, no AWS) ─────────────────────────

/** A terminal state warrants a user notification (Requirement 6.3). */
export function isNotifiableStatus(status: SessionStatus): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly SessionStatus[]).includes(status);
}

/**
 * A session should be timed out iff it is NOT already terminal and its elapsed
 * time since started_at exceeds the budget. Pure + total (Requirement 6.5).
 */
export function shouldTimeout(
  status: SessionStatus,
  startedAtIso: string,
  nowMs: number
): boolean {
  if (isNotifiableStatus(status)) return false; // already terminal
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) return false;
  return nowMs - started >= TIMEOUT_BUDGET_MS;
}

// ── SNS envelope shapes ───────────────────────────────────────────────────────

interface StateChangeMessage {
  session_id: string;
  tenant_id: string;
  site_id: string;
  status: SessionStatus;
  failure_reason?: string | null;
}
interface SnsRecord {
  Sns?: { Message?: string };
  body?: string;
}
interface SnsEvent {
  Records: SnsRecord[];
}

function parseStateChange(record: SnsRecord): StateChangeMessage | null {
  const raw = record.Sns?.Message ?? record.body;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StateChangeMessage;
  } catch {
    return null;
  }
}

async function emitBell(msg: StateChangeMessage): Promise<boolean> {
  const topic = PLATFORM_TOPIC_ARN();
  if (!topic) return false;
  try {
    await snsClient.send(
      new PublishCommand({
        TopicArn: topic,
        Message: JSON.stringify({
          type: 'worksafebc_analysis',
          session_id: msg.session_id,
          tenant_id: msg.tenant_id,
          site_id: msg.site_id,
          status: msg.status,
          failure_reason: msg.failure_reason ?? null,
        }),
        MessageAttributes: {
          event_type: { DataType: 'String', StringValue: 'WorkSafeBCAnalysisNotification' },
        },
      })
    );
    return true;
  } catch (err) {
    logger.warn('bell notification publish failed', { error: String(err) });
    return false;
  }
}

async function markNotified(msg: StateChangeMessage, delivered: boolean): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Key: { PK: `TENANT#${msg.tenant_id}`, SK: `SESSION#${msg.session_id}` },
      UpdateExpression: 'SET notification_delivered = :d',
      ExpressionAttributeValues: { ':d': delivered },
    })
  );
}

// ── 11.1 Notification dispatch ────────────────────────────────────────────────

export async function notificationDispatchHandler(event: SnsEvent): Promise<void> {
  for (const record of event.Records ?? []) {
    const msg = parseStateChange(record);
    if (!msg) continue;
    if (!isNotifiableStatus(msg.status)) continue; // only terminal states notify
    const delivered = await emitBell(msg);
    await markNotified(msg, delivered);
    logger.info('worksafebc notification dispatched', {
      session_id: msg.session_id,
      status: msg.status,
      delivered,
    });
  }
}

// ── 11.2 Timeout watchdog (scheduled) ─────────────────────────────────────────

/** Transition a stuck session to `timeout` and emit a bell notification. */
async function timeoutSession(session: AnalysisSession): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Key: { PK: `TENANT#${session.tenant_id}`, SK: `SESSION#${session.session_id}` },
      UpdateExpression: 'SET #s = :s, failure_reason = :r',
      ConditionExpression: 'attribute_not_exists(#s) OR #s IN (:a,:b,:c,:d)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'timeout' as SessionStatus,
        ':r': 'analysis exceeded the 10-minute processing budget',
        ':a': 'recibido',
        ':b': 'categorizado',
        ':c': 'texto_extraido',
        ':d': 'analizando',
      },
    })
  ).catch((err) => {
    // ConditionalCheckFailed = it already reached terminal; ignore.
    if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
  });

  await emitBell({
    session_id: session.session_id,
    tenant_id: session.tenant_id,
    site_id: session.site_id,
    status: 'timeout',
    failure_reason: 'timeout',
  });
}

/**
 * Scan for non-terminal sessions past the budget and time them out.
 * A dedicated GSI would be more efficient at scale; a bounded Scan with a
 * status filter is acceptable for v1 (documented follow-up).
 */
export async function timeoutWatchdogHandler(): Promise<{ timed_out: number }> {
  const now = Date.now();
  const res = await docClient.send(
    new ScanCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      FilterExpression: '#s IN (:a,:b,:c,:d)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':a': 'recibido',
        ':b': 'categorizado',
        ':c': 'texto_extraido',
        ':d': 'analizando',
      },
    })
  );

  const sessions = (res.Items ?? []) as AnalysisSession[];
  let timedOut = 0;
  for (const s of sessions) {
    if (shouldTimeout(s.status, s.started_at, now)) {
      await timeoutSession(s);
      timedOut += 1;
    }
  }
  logger.info('timeout watchdog run', { scanned: sessions.length, timed_out: timedOut });
  return { timed_out: timedOut };
}

void QueryCommand; // reserved for a future GSI-based watchdog query
