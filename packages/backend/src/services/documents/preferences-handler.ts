/**
 * Preferences Handler for the Document Explorer service.
 * GET /documents/preferences/organization-mode — Retrieves user's org mode preference.
 * PUT /documents/preferences/organization-mode — Updates user's org mode preference.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createSuccessResponse, badRequest, internalError } from '../../shared/error-handler.js';
import { setPreferencesSchema } from './schemas.js';
import type { OrganizationMode } from './types.js';

const TABLE_NAME = getTableName('UserPreferences');
const DEFAULT_MODE: OrganizationMode = 'category_site_year_month';

/**
 * Handles GET /documents/preferences/organization-mode requests.
 * Queries the UserPreferences table for the user's document explorer preference.
 * Returns the default mode if no preference is stored.
 */
export async function handleGetPreferences(
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${user.user_id}`,
          SK: 'PREF#document_explorer',
        },
      })
    );

    const mode = (result.Item?.['mode'] as OrganizationMode) || DEFAULT_MODE;

    return createSuccessResponse(200, { mode });
  } catch (error) {
    return internalError('Failed to retrieve preferences');
  }
}

/**
 * Handles PUT /documents/preferences/organization-mode requests.
 * Validates the request body and persists the user's org mode preference.
 */
export async function handleSetPreferences(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Parse and validate request body
  const body = parseBody(event);
  if (!body) {
    return badRequest('Request body is required');
  }

  const validation = setPreferencesSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Invalid preferences', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { mode } = validation.data;

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${user.user_id}`,
          SK: 'PREF#document_explorer',
          mode,
          updatedAt: new Date().toISOString(),
        },
      })
    );

    return createSuccessResponse(200, { mode });
  } catch (error) {
    return internalError('Failed to save preferences');
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

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
