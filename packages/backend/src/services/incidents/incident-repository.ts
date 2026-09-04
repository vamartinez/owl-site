/**
 * Incident Repository: CRUD operations for the Incidents DynamoDB table.
 *
 * Implements tenant isolation in all queries by including tenant_id
 * in partition keys. Supports listing by site (GSI1), by status (GSI2),
 * and by regulatory flag (GSI3).
 *
 * Table: Incidents
 * PK: TENANT#{tenant_id}
 * SK: INCIDENT#{incident_id}
 * GSI1 (by site): GSI1PK = TENANT#{tenant_id}#SITE#{site_id}, GSI1SK = {created_at}
 * GSI2 (by status): GSI2PK = TENANT#{tenant_id}#STATUS#{status}, GSI2SK = {created_at}
 * GSI3 (by regulatory flag): GSI3PK = TENANT#{tenant_id}#REGFLAG#{regulatory_flag}, GSI3SK = {created_at}
 *
 * Requirements: 1.1, 3.4, 21.5
 */

import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { IncidentRecord } from './types.js';

const INCIDENTS_TABLE = 'Incidents';

/**
 * Creates a new incident record in DynamoDB with all GSI keys populated.
 *
 * @param incident - The full incident record to persist
 * @returns The created incident record
 */
export async function createIncident(incident: IncidentRecord): Promise<IncidentRecord> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Item: {
        PK: `TENANT#${incident.tenant_id}`,
        SK: `INCIDENT#${incident.incident_id}`,
        GSI1PK: `TENANT#${incident.tenant_id}#SITE#${incident.site_id}`,
        GSI1SK: incident.created_at,
        GSI2PK: `TENANT#${incident.tenant_id}#STATUS#${incident.status}`,
        GSI2SK: incident.created_at,
        GSI3PK: `TENANT#${incident.tenant_id}#REGFLAG#${incident.regulatory_flag}`,
        GSI3SK: incident.created_at,
        ...incident,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );

  return incident;
}

/**
 * Retrieves a single incident by tenant and incident ID.
 * Tenant isolation is enforced by requiring tenant_id in the partition key.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 * @returns The incident record, or undefined if not found
 */
export async function getIncident(
  tenantId: string,
  incidentId: string
): Promise<IncidentRecord | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INCIDENT#${incidentId}`,
      },
    })
  );

  return result.Item as IncidentRecord | undefined;
}

/**
 * Updates an existing incident record. Recalculates GSI keys when
 * status, site_id, or regulatory_flag change.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 * @param updates - Partial fields to update
 * @returns The updated incident record
 */
export async function updateIncident(
  tenantId: string,
  incidentId: string,
  updates: Partial<Omit<IncidentRecord, 'incident_id' | 'tenant_id' | 'created_at'>>
): Promise<IncidentRecord> {
  // Build update expression dynamically from provided fields
  const expressionParts: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {};

  // Always update updated_at
  const fieldsToUpdate = { ...updates, updated_at: new Date().toISOString() };

  let index = 0;
  for (const [key, value] of Object.entries(fieldsToUpdate)) {
    if (value === undefined) continue;
    const attrName = `#attr${index}`;
    const attrValue = `:val${index}`;
    expressionParts.push(`${attrName} = ${attrValue}`);
    expressionNames[attrName] = key;
    expressionValues[attrValue] = value;
    index++;
  }

  // Recalculate GSI keys if relevant fields changed
  if (updates.site_id !== undefined) {
    expressionParts.push('#gsi1pk = :gsi1pk');
    expressionNames['#gsi1pk'] = 'GSI1PK';
    expressionValues[':gsi1pk'] = `TENANT#${tenantId}#SITE#${updates.site_id}`;
  }

  if (updates.status !== undefined) {
    expressionParts.push('#gsi2pk = :gsi2pk');
    expressionNames['#gsi2pk'] = 'GSI2PK';
    expressionValues[':gsi2pk'] = `TENANT#${tenantId}#STATUS#${updates.status}`;
  }

  if (updates.regulatory_flag !== undefined) {
    expressionParts.push('#gsi3pk = :gsi3pk');
    expressionNames['#gsi3pk'] = 'GSI3PK';
    expressionValues[':gsi3pk'] = `TENANT#${tenantId}#REGFLAG#${updates.regulatory_flag}`;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INCIDENT#${incidentId}`,
      },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes as IncidentRecord;
}

/**
 * Pagination options for list queries.
 */
export interface ListOptions {
  limit?: number;
  cursor?: string;
}

/**
 * Paginated list result.
 */
export interface ListResult {
  incidents: IncidentRecord[];
  nextCursor?: string;
}

/**
 * Lists all incidents for a tenant (primary table query).
 * Tenant isolation is enforced by the partition key.
 *
 * @param tenantId - The tenant identifier
 * @param options - Optional pagination parameters
 * @returns Paginated list of incidents
 */
export async function listByTenant(
  tenantId: string,
  options?: ListOptions
): Promise<ListResult> {
  const limit = options?.limit ?? 50;

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
        ':skPrefix': 'INCIDENT#',
      },
      Limit: limit,
      ScanIndexForward: false, // Most recent first
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const incidents = (result.Items ?? []) as IncidentRecord[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { incidents, nextCursor };
}

/**
 * Lists incidents for a tenant filtered by site (GSI1).
 * Tenant isolation is enforced by including tenant_id in the GSI partition key.
 *
 * @param tenantId - The tenant identifier
 * @param siteId - The site identifier to filter by
 * @param options - Optional pagination parameters
 * @returns Paginated list of incidents for the site
 */
export async function listBySite(
  tenantId: string,
  siteId: string,
  options?: ListOptions
): Promise<ListResult> {
  const limit = options?.limit ?? 50;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :gsi1pk',
      ExpressionAttributeNames: {
        '#gsi1pk': 'GSI1PK',
      },
      ExpressionAttributeValues: {
        ':gsi1pk': `TENANT#${tenantId}#SITE#${siteId}`,
      },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const incidents = (result.Items ?? []) as IncidentRecord[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { incidents, nextCursor };
}

/**
 * Lists incidents for a tenant filtered by status (GSI2).
 * Tenant isolation is enforced by including tenant_id in the GSI partition key.
 *
 * @param tenantId - The tenant identifier
 * @param status - The incident status to filter by
 * @param options - Optional pagination parameters
 * @returns Paginated list of incidents with the given status
 */
export async function listByStatus(
  tenantId: string,
  status: string,
  options?: ListOptions
): Promise<ListResult> {
  const limit = options?.limit ?? 50;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      IndexName: 'GSI2',
      KeyConditionExpression: '#gsi2pk = :gsi2pk',
      ExpressionAttributeNames: {
        '#gsi2pk': 'GSI2PK',
      },
      ExpressionAttributeValues: {
        ':gsi2pk': `TENANT#${tenantId}#STATUS#${status}`,
      },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const incidents = (result.Items ?? []) as IncidentRecord[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { incidents, nextCursor };
}

/**
 * Lists incidents for a tenant filtered by regulatory flag (GSI3).
 * Tenant isolation is enforced by including tenant_id in the GSI partition key.
 *
 * @param tenantId - The tenant identifier
 * @param regulatoryFlag - The regulatory flag to filter by
 * @param options - Optional pagination parameters
 * @returns Paginated list of incidents with the given regulatory flag
 */
export async function listByRegulatoryFlag(
  tenantId: string,
  regulatoryFlag: string,
  options?: ListOptions
): Promise<ListResult> {
  const limit = options?.limit ?? 50;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      IndexName: 'GSI3',
      KeyConditionExpression: '#gsi3pk = :gsi3pk',
      ExpressionAttributeNames: {
        '#gsi3pk': 'GSI3PK',
      },
      ExpressionAttributeValues: {
        ':gsi3pk': `TENANT#${tenantId}#REGFLAG#${regulatoryFlag}`,
      },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const incidents = (result.Items ?? []) as IncidentRecord[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { incidents, nextCursor };
}

/**
 * Unified list function that dispatches to the appropriate query
 * based on the provided filter parameters.
 *
 * @param tenantId - The tenant identifier (required for tenant isolation)
 * @param filters - Optional filters for site, status, or regulatory flag
 * @param options - Optional pagination parameters
 * @returns Paginated list of incidents matching the filters
 */
export async function listIncidents(
  tenantId: string,
  filters?: {
    siteId?: string;
    status?: string;
    regulatoryFlag?: string;
  },
  options?: ListOptions
): Promise<ListResult> {
  if (filters?.siteId) {
    return listBySite(tenantId, filters.siteId, options);
  }

  if (filters?.status) {
    return listByStatus(tenantId, filters.status, options);
  }

  if (filters?.regulatoryFlag) {
    return listByRegulatoryFlag(tenantId, filters.regulatoryFlag, options);
  }

  return listByTenant(tenantId, options);
}

/**
 * Atomically increments the linked_documents_count for an incident.
 * Uses DynamoDB ADD expression which initializes the attribute to 0 if it doesn't exist.
 *
 * Requirements: 9.1, 9.3 — Update the denormalized count when a document is linked.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 */
export async function incrementLinkedDocumentsCount(
  tenantId: string,
  incidentId: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INCIDENT#${incidentId}`,
      },
      UpdateExpression: 'ADD #count :one',
      ExpressionAttributeNames: {
        '#count': 'linked_documents_count',
      },
      ExpressionAttributeValues: {
        ':one': 1,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );
}

/**
 * Atomically decrements the linked_documents_count for an incident.
 * Uses a condition expression to prevent the count from going below 0.
 * If the condition fails (count is already 0 or attribute doesn't exist),
 * the error is handled gracefully.
 *
 * Requirements: 9.2, 9.3 — Update the denormalized count when a document is unlinked.
 *
 * @param tenantId - The tenant identifier
 * @param incidentId - The incident identifier
 */
export async function decrementLinkedDocumentsCount(
  tenantId: string,
  incidentId: string
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(INCIDENTS_TABLE),
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `INCIDENT#${incidentId}`,
        },
        UpdateExpression: 'ADD #count :negOne',
        ExpressionAttributeNames: {
          '#count': 'linked_documents_count',
        },
        ExpressionAttributeValues: {
          ':negOne': -1,
          ':zero': 0,
        },
        ConditionExpression:
          'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(#count) OR #count > :zero)',
      })
    );
  } catch (error: unknown) {
    // ConditionalCheckFailedException means the count is already 0 — safe to ignore
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw error;
  }
}
