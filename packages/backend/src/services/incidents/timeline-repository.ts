/**
 * Timeline Repository: Append-only storage for incident audit trail events.
 *
 * This repository enforces immutability by exposing ONLY:
 * - appendEvent: Writes a new timeline event (PutItem)
 * - getTimeline: Queries events for an incident in chronological order (Query)
 *
 * NO update or delete operations are exposed. Once an event is recorded,
 * it cannot be modified or removed.
 *
 * Table: IncidentTimeline
 * PK: INCIDENT#{incident_id}
 * SK: EVENT#{timestamp}#{event_id}
 *
 * Requirements: 15.1, 15.2, 15.3
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { TimelineEvent } from './types.js';

const TIMELINE_TABLE = 'IncidentTimeline';

/**
 * Appends an immutable event to the incident timeline.
 * This is the only write operation permitted on the timeline table.
 *
 * @param event - The timeline event to record
 * @returns The recorded event
 */
export async function appendEvent(event: TimelineEvent): Promise<TimelineEvent> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(TIMELINE_TABLE),
      Item: {
        PK: `INCIDENT#${event.incident_id}`,
        SK: `EVENT#${event.timestamp}#${event.event_id}`,
        ...event,
      },
    })
  );

  return event;
}

/**
 * Retrieves the full timeline for an incident in chronological order.
 * Supports optional pagination via cursor.
 *
 * @param incidentId - The incident identifier
 * @param options - Optional pagination parameters
 * @returns Timeline events in chronological order with optional pagination cursor
 */
export async function getTimeline(
  incidentId: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<{ events: TimelineEvent[]; nextCursor?: string }> {
  const limit = options?.limit ?? 100;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(TIMELINE_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `INCIDENT#${incidentId}`,
        ':skPrefix': 'EVENT#',
      },
      Limit: limit,
      ScanIndexForward: true, // Chronological order (oldest first)
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const events = (result.Items ?? []) as TimelineEvent[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { events, nextCursor };
}
