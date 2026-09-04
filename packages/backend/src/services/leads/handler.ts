/**
 * Lead Capture Service Lambda Handler.
 * Handles the public POST /leads endpoint for the landing page contact form.
 *
 * This endpoint does NOT require authentication — it is public-facing.
 *
 * Validation:
 * - company_name: required, max 200 characters
 * - contact_name: required, max 150 characters
 * - email: required, valid email format
 * - phone: optional, E.164 format
 * - message: required, max 1000 characters
 *
 * Requirements: 16.3, 16.4, 16.5
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import {
  createSuccessResponse,
  badRequest,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { e164PhoneSchema, emailSchema } from '../../shared/validators.js';
import type { LeadCapture } from './types.js';
import { LeadStatus } from './types.js';

// --- Zod Schema ---

export const createLeadSchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(1, 'company_name is required')
    .max(200, 'company_name must be at most 200 characters'),
  contact_name: z
    .string()
    .trim()
    .min(1, 'contact_name is required')
    .max(150, 'contact_name must be at most 150 characters'),
  email: emailSchema,
  phone: e164PhoneSchema.optional(),
  message: z
    .string()
    .trim()
    .min(1, 'message is required')
    .max(1000, 'message must be at most 1000 characters'),
});

const LEAD_CAPTURES_TABLE = 'LeadCaptures';

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;

    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return createSuccessResponse(200, {});
    }

    // Only POST /leads is supported
    if (httpMethod === 'POST' && (resource === '/leads' || !resource)) {
      return handleCreateLead(event);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Lead capture handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handler ---

/**
 * POST /leads
 * Validates lead form data and stores in LeadCaptures table.
 * No authentication required — public endpoint.
 */
async function handleCreateLead(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createLeadSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const input = validation.data;
  const now = new Date().toISOString();
  const leadId = uuidv4();

  const lead: LeadCapture = {
    lead_id: leadId,
    company_name: input.company_name,
    contact_name: input.contact_name,
    email: input.email,
    phone: input.phone,
    message: input.message,
    source: 'landing_page',
    created_at: now,
    status: LeadStatus.NEW,
  };

  await storeLead(lead);

  return createSuccessResponse(201, {
    success: true,
    lead_id: leadId,
    message: 'Thank you for your interest. We will be in touch shortly.',
  });
}

/**
 * Stores a lead capture in DynamoDB.
 */
export async function storeLead(lead: LeadCapture): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(LEAD_CAPTURES_TABLE),
      Item: {
        PK: `LEAD#${lead.lead_id}`,
        SK: 'METADATA',
        GSI1PK: 'LEADS',
        GSI1SK: lead.created_at,
        ...lead,
      },
    })
  );
}

// --- Helper Functions ---

function parseBody(event: ApiGatewayEvent): Record<string, unknown> | null {
  const body = (event as Record<string, unknown>)['body'];
  if (!body) return null;

  try {
    if (typeof body === 'string') {
      return JSON.parse(body) as Record<string, unknown>;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
