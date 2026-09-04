/**
 * Comment & Person Repository: CRUD operations for incident comments
 * and involved persons stored in the Incidents DynamoDB table.
 *
 * Uses the same Incidents table with different SK patterns:
 * - Comments: PK = TENANT#{tenant_id}, SK = INCIDENT#{incident_id}#COMMENT#{comment_id}
 * - Persons: PK = TENANT#{tenant_id}, SK = INCIDENT#{incident_id}#PERSON#{person_id}
 *
 * Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 14.4
 */

import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { IncidentComment, InvolvedPerson } from './types.js';

const INCIDENTS_TABLE = 'Incidents';

// ─── Comments ────────────────────────────────────────────────────────────────

/**
 * Creates a new comment record in DynamoDB.
 *
 * @param comment - The full comment record to persist
 * @returns The created comment record
 */
export async function createComment(comment: IncidentComment): Promise<IncidentComment> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Item: {
        PK: `TENANT#${comment.tenant_id}`,
        SK: `INCIDENT#${comment.incident_id}#COMMENT#${comment.comment_id}`,
        ...comment,
      },
    })
  );

  return comment;
}

/**
 * Lists all comments for an incident in chronological order.
 * Tenant isolation is enforced by the partition key.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 * @returns Array of comments in chronological order (oldest first)
 */
export async function listComments(
  tenantId: string,
  incidentId: string
): Promise<IncidentComment[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':skPrefix': `INCIDENT#${incidentId}#COMMENT#`,
      },
      ScanIndexForward: true, // Chronological order (oldest first)
    })
  );

  return (result.Items ?? []) as IncidentComment[];
}

// ─── Persons Involved ────────────────────────────────────────────────────────

/**
 * Creates a new involved person record in DynamoDB.
 *
 * @param person - The full person record to persist
 * @returns The created person record
 */
export async function createPerson(person: InvolvedPerson): Promise<InvolvedPerson> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Item: {
        PK: `TENANT#${person.tenant_id}`,
        SK: `INCIDENT#${person.incident_id}#PERSON#${person.person_id}`,
        ...person,
      },
    })
  );

  return person;
}

/**
 * Retrieves a single involved person by tenant, incident, and person ID.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 * @param personId - The person identifier
 * @returns The person record, or undefined if not found
 */
export async function getPerson(
  tenantId: string,
  incidentId: string,
  personId: string
): Promise<InvolvedPerson | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INCIDENT#${incidentId}#PERSON#${personId}`,
      },
    })
  );

  return result.Item as InvolvedPerson | undefined;
}

/**
 * Deletes an involved person record from DynamoDB.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 * @param personId - The person identifier
 */
export async function deletePerson(
  tenantId: string,
  incidentId: string,
  personId: string
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INCIDENT#${incidentId}#PERSON#${personId}`,
      },
    })
  );
}
