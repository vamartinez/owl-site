/**
 * Worker CRUD operations for the Identity Service.
 * Handles creation, retrieval, and update of worker identity records.
 */

import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { LanguagePreference } from '../../shared/types/common.js';
import { e164PhoneSchema, boundedNameString, optionalBoundedNameString } from '../../shared/validators.js';
import type { WorkerIdentity, CreateWorkerInput, UpdateWorkerInput } from './types.js';

const WORKERS_TABLE = 'Workers';

/**
 * Zod schema for creating a worker.
 */
export const createWorkerSchema = z.object({
  legal_name: boundedNameString(150, 'Legal name'),
  preferred_name: optionalBoundedNameString(100, 'Preferred name'),
  phone: e164PhoneSchema,
  language_preference: z.nativeEnum(LanguagePreference),
  email: z.string().email('Must be a valid email address').optional(),
});

/**
 * Zod schema for updating a worker.
 */
export const updateWorkerSchema = z.object({
  legal_name: optionalBoundedNameString(150, 'Legal name'),
  preferred_name: optionalBoundedNameString(100, 'Preferred name'),
  phone: e164PhoneSchema.optional(),
  language_preference: z.nativeEnum(LanguagePreference).optional(),
  email: z.string().email('Must be a valid email address').optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' }
);

/**
 * Creates a new worker identity record.
 */
export async function createWorker(
  tenantId: string,
  input: CreateWorkerInput
): Promise<WorkerIdentity> {
  const now = new Date().toISOString();
  const workerId = uuidv4();

  const worker: WorkerIdentity = {
    worker_id: workerId,
    tenant_id: tenantId,
    legal_name: input.legal_name,
    preferred_name: input.preferred_name,
    phone: input.phone,
    language_preference: input.language_preference,
    email: input.email,
    qr_identity_reference: uuidv4(),
    status: 'active',
    created_at: now,
    updated_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(WORKERS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `WORKER#${workerId}`,
        GSI1PK: `TENANT#${tenantId}`,
        GSI1SK: `WORKER#${now}`,
        ...worker,
      },
    })
  );

  // Publish WorkerCreated event
  await publishEvent({
    event_type: EventTypes.WORKER_CREATED,
    source_service: 'identity-service',
    tenant_id: tenantId,
    payload: {
      worker_id: workerId,
      tenant_id: tenantId,
      legal_name: input.legal_name,
      phone: input.phone,
      language_preference: input.language_preference,
    },
  });

  return worker;
}

/**
 * Retrieves a worker by ID and tenant.
 */
export async function getWorker(
  tenantId: string,
  workerId: string
): Promise<WorkerIdentity | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(WORKERS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `WORKER#${workerId}`,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as WorkerIdentity;
}

/**
 * Updates a worker identity record.
 */
export async function updateWorker(
  tenantId: string,
  workerId: string,
  input: UpdateWorkerInput
): Promise<WorkerIdentity | null> {
  // First verify the worker exists
  const existing = await getWorker(tenantId, workerId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const updateExpressions: string[] = ['#updated_at = :updated_at'];
  const expressionAttributeNames: Record<string, string> = {
    '#updated_at': 'updated_at',
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ':updated_at': now,
  };

  if (input.legal_name !== undefined) {
    updateExpressions.push('#legal_name = :legal_name');
    expressionAttributeNames['#legal_name'] = 'legal_name';
    expressionAttributeValues[':legal_name'] = input.legal_name;
  }

  if (input.preferred_name !== undefined) {
    updateExpressions.push('#preferred_name = :preferred_name');
    expressionAttributeNames['#preferred_name'] = 'preferred_name';
    expressionAttributeValues[':preferred_name'] = input.preferred_name;
  }

  if (input.phone !== undefined) {
    updateExpressions.push('#phone = :phone');
    expressionAttributeNames['#phone'] = 'phone';
    expressionAttributeValues[':phone'] = input.phone;
  }

  if (input.language_preference !== undefined) {
    updateExpressions.push('#language_preference = :language_preference');
    expressionAttributeNames['#language_preference'] = 'language_preference';
    expressionAttributeValues[':language_preference'] = input.language_preference;
  }

  if (input.email !== undefined) {
    updateExpressions.push('#email = :email');
    expressionAttributeNames['#email'] = 'email';
    expressionAttributeValues[':email'] = input.email;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(WORKERS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `WORKER#${workerId}`,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes as WorkerIdentity;
}
