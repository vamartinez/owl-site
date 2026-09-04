/**
 * Policy Service Lambda Handler.
 * Handles policy CRUD operations and version management.
 *
 * Endpoints:
 * - POST /policies — Create a new policy
 * - GET /policies/{id} — Get policy with versions
 * - POST /policies/{id}/versions — Publish a new version
 * - GET /policies/{id}/versions/{versionId} — Get a specific version
 * - PATCH /policies/{id}/versions/{versionId} — Update a version (enforces immutability)
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { computeSiteCompliance } from '../../shared/site-compliance.js';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission, enforceTenantIsolation } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  conflict,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { boundedString, iso8601DateSchema } from '../../shared/validators.js';
import type { Policy, PolicyVersion, CreatePolicyInput, CreatePolicyVersionInput } from './types.js';
import {
  createPolicyVersion,
  getVersionsForPolicy,
  getVersionById,
  validateVersionMutable,
  updatePolicyVersion,
  getActiveVersionForDate,
} from './version-manager.js';
import { getEffectivePolicies } from './effective-policies.js';

// --- Zod Schemas ---

const createPolicySchema = z.object({
  name: boundedString(200, 'Policy name'),
  description: boundedString(2000, 'Description'),
  site_id: z.string().uuid('site_id must be a valid UUID'),
  jurisdiction: boundedString(100, 'Jurisdiction'),
  owner_type: z.enum(['platform', 'tenant', 'site', 'project']),
  owner_id: z.string().uuid('owner_id must be a valid UUID'),
});

const policyRuleSchema = z.object({
  rule_id: z.string().min(1),
  rule_type: z.string().min(1),
  description: z.string().max(500),
  conditions: z.record(z.unknown()),
  actions: z.record(z.unknown()),
});

const createVersionSchema = z.object({
  effective_from: iso8601DateSchema,
  effective_to: iso8601DateSchema.optional(),
  rules: z.array(policyRuleSchema).min(1, 'At least one rule is required'),
  change_summary: boundedString(1000, 'Change summary'),
});

const updateVersionSchema = z.object({
  change_summary: boundedString(1000, 'Change summary').optional(),
  effective_to: iso8601DateSchema.optional(),
});

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const path = (event as Record<string, unknown>)['path'] as string;
    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;

    // Log for debugging route matching
    console.log('Policy handler invoked:', JSON.stringify({ httpMethod, resource, path }));

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'POST' && resource === '/policies') {
      return handleCreatePolicy(event, user);
    }

    // --- Sites routes ---
    if (httpMethod === 'POST' && resource === '/sites') {
      return handleCreateSite(event, user);
    }

    if (httpMethod === 'GET' && resource === '/sites') {
      return handleListSites(event, user);
    }

    if (httpMethod === 'GET' && resource === '/sites/{id}') {
      const siteId = pathParameters?.['id'];
      if (!siteId) return badRequest('Site ID is required');
      return handleGetSite(siteId, user);
    }

    if (httpMethod === 'GET' && resource === '/sites/{id}/effective-policies') {
      const siteId = pathParameters?.['id'];
      if (!siteId) return badRequest('Site ID is required');
      return handleGetEffectivePolicies(siteId, user);
    }

    if (httpMethod === 'PATCH' && resource === '/sites/{id}') {
      const siteId = pathParameters?.['id'];
      if (!siteId) return badRequest('Site ID is required');
      return handleUpdateSite(event, siteId, user);
    }

    // --- Policies routes ---
    if (httpMethod === 'GET' && resource === '/policies') {
      return handleListPolicies(user);
    }

    if (httpMethod === 'GET' && resource === '/policies/{id}') {
      const policyId = pathParameters?.['id'];
      if (!policyId) return badRequest('Policy ID is required');
      return handleGetPolicy(policyId, user);
    }

    if (httpMethod === 'POST' && resource === '/policies/{id}/versions') {
      const policyId = pathParameters?.['id'];
      if (!policyId) return badRequest('Policy ID is required');
      return handleCreateVersion(event, policyId, user);
    }

    if (httpMethod === 'GET' && resource === '/policies/{id}/versions/{versionId}') {
      const policyId = pathParameters?.['id'];
      const versionId = pathParameters?.['versionId'];
      if (!policyId) return badRequest('Policy ID is required');
      if (!versionId) return badRequest('Version ID is required');
      return handleGetVersion(policyId, versionId, user);
    }

    if (httpMethod === 'PATCH' && resource === '/policies/{id}/versions/{versionId}') {
      const policyId = pathParameters?.['id'];
      const versionId = pathParameters?.['versionId'];
      if (!policyId) return badRequest('Policy ID is required');
      if (!versionId) return badRequest('Version ID is required');
      return handleUpdateVersion(event, policyId, versionId, user);
    }

    return badRequest(`Unsupported route: ${httpMethod} ${resource} (path: ${path})`);
  } catch (error) {
    console.error('Policy handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

async function handleCreatePolicy(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:create');
  if (permError) return permError;

  // Parse and validate body
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createPolicySchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const input: CreatePolicyInput = validation.data;
  const policyId = uuidv4();
  const now = new Date().toISOString();

  const policy: Policy = {
    policy_id: policyId,
    tenant_id: user.tenant_id,
    site_id: input.site_id,
    name: input.name,
    description: input.description,
    jurisdiction: input.jurisdiction,
    owner_type: input.owner_type,
    owner_id: input.owner_id,
    current_version_number: 0,
    created_at: now,
    created_by: user.user_id,
    updated_at: now,
  };

  // Store policy record in DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: getTableName('Policies'),
      Item: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `POLICY#${policyId}`,
        GSI1PK: `SITE#${input.site_id}`,
        ...policy,
      },
    })
  );

  // Create an accompanying draft version record (Requirement 3.2)
  const draftVersionId = uuidv4();
  await docClient.send(
    new PutCommand({
      TableName: getTableName('PolicyVersions'),
      Item: {
        PK: `POLICY#${policyId}`,
        SK: `VERSION#${draftVersionId}`,
        GSI1PK: `TENANT#${user.tenant_id}`,
        GSI1SK: `POLICY#${policyId}#VERSION#000001`,
        policy_version_id: draftVersionId,
        policy_id: policyId,
        tenant_id: user.tenant_id,
        version_number: 1,
        status: 'draft',
        rules: [],
        rule_snapshot_json: '[]',
        change_summary: 'Initial draft',
        published_by: user.user_id,
        published_at: now,
        is_active: false,
        used_in_decisions: false,
        created_at: now,
      },
    })
  );

  return createSuccessResponse(201, { policy });
}

async function handleGetPolicy(
  policyId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:read');
  if (permError) return permError;

  // Query the policy
  const policy = await getPolicyById(policyId, user.tenant_id);
  if (!policy) {
    return notFound('Policy not found');
  }

  // Enforce tenant isolation
  const tenantError = enforceTenantIsolation(
    user as Parameters<typeof enforceTenantIsolation>[0],
    policy.tenant_id
  );
  if (tenantError) return tenantError;

  // Get versions
  const versions = await getVersionsForPolicy(policyId);

  return createSuccessResponse(200, {
    policy: { ...policy, versions },
  });
}

async function handleCreateVersion(
  event: ApiGatewayEvent,
  policyId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:publish');
  if (permError) return permError;

  // Get the policy
  const policy = await getPolicyById(policyId, user.tenant_id);
  if (!policy) {
    return notFound('Policy not found');
  }

  // Enforce tenant isolation
  const tenantError = enforceTenantIsolation(
    user as Parameters<typeof enforceTenantIsolation>[0],
    policy.tenant_id
  );
  if (tenantError) return tenantError;

  // Parse and validate body
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createVersionSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const input: CreatePolicyVersionInput = validation.data;

  // Create the version (includes overlap validation, sequential numbering, event publishing)
  const result = await createPolicyVersion(policy, input, user.user_id);

  if (result.error) {
    if (result.conflict) {
      return conflict(result.error, {
        conflicting_version_id: result.conflict.conflicting_version_id,
        conflicting_version_number: result.conflict.conflicting_version_number,
        conflicting_effective_from: result.conflict.conflicting_effective_from,
        conflicting_effective_to: result.conflict.conflicting_effective_to,
      });
    }
    return badRequest(result.error);
  }

  return createSuccessResponse(201, { version: result.version });
}

async function handleGetVersion(
  policyId: string,
  versionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:read');
  if (permError) return permError;

  // Get the policy to verify tenant
  const policy = await getPolicyById(policyId, user.tenant_id);
  if (!policy) {
    return notFound('Policy not found');
  }

  // Enforce tenant isolation
  const tenantError = enforceTenantIsolation(
    user as Parameters<typeof enforceTenantIsolation>[0],
    policy.tenant_id
  );
  if (tenantError) return tenantError;

  // Get the version
  const version = await getVersionById(policyId, versionId);
  if (!version) {
    return notFound('Policy version not found');
  }

  // Check immutability status
  const immutabilityError = await validateVersionMutable(versionId);

  return createSuccessResponse(200, {
    version,
    is_immutable: immutabilityError !== null,
    immutability_reason: immutabilityError,
  });
}

/**
 * PATCH /policies/{id}/versions/{versionId}
 * Updates a policy version's metadata. Enforces immutability (Req 2.7).
 */
async function handleUpdateVersion(
  event: ApiGatewayEvent,
  policyId: string,
  versionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:update');
  if (permError) return permError;

  // Get the policy to verify tenant
  const policy = await getPolicyById(policyId, user.tenant_id);
  if (!policy) {
    return notFound('Policy not found');
  }

  // Enforce tenant isolation
  const tenantError = enforceTenantIsolation(
    user as Parameters<typeof enforceTenantIsolation>[0],
    policy.tenant_id
  );
  if (tenantError) return tenantError;

  // Parse and validate body
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = updateVersionSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const updates = validation.data;

  if (!updates.change_summary && !updates.effective_to) {
    return badRequest('At least one field to update is required (change_summary or effective_to)');
  }

  // Attempt update (includes immutability check)
  const result = await updatePolicyVersion(policyId, versionId, updates);

  if (result.error) {
    // Check if it's an immutability error
    if (result.error.includes('immutable')) {
      return conflict(result.error);
    }
    return badRequest(result.error);
  }

  return createSuccessResponse(200, { version: result.version });
}

// --- Helper Functions ---

async function handleListPolicies(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:read');
  if (permError) return permError;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Policies'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':prefix': 'POLICY#',
      },
    })
  );

  const policies = (result.Items ?? []).map((item) => {
    const record = item as Record<string, unknown>;
    return {
      policy_id: record['policy_id'],
      tenant_id: record['tenant_id'],
      site_id: record['site_id'],
      name: record['name'],
      description: record['description'],
      jurisdiction: record['jurisdiction'],
      owner_type: record['owner_type'],
      owner_id: record['owner_id'],
      current_version_number: record['current_version_number'],
      created_at: record['created_at'],
      updated_at: record['updated_at'],
    };
  });

  return createSuccessResponse(200, { policies, total: policies.length });
}

async function handleGetEffectivePolicies(
  siteId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:read');
  if (permError) return permError;

  const policies = await getEffectivePolicies(siteId, user.tenant_id);
  return createSuccessResponse(200, { policies, total: policies.length });
}

async function getPolicyById(policyId: string, tenantId: string): Promise<Policy | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Policies'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `POLICY#${policyId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0] as Record<string, unknown>;
  return {
    policy_id: item['policy_id'] as string,
    tenant_id: item['tenant_id'] as string,
    site_id: item['site_id'] as string,
    name: item['name'] as string,
    description: item['description'] as string,
    jurisdiction: item['jurisdiction'] as string,
    owner_type: item['owner_type'] as Policy['owner_type'],
    owner_id: item['owner_id'] as string,
    current_version_number: item['current_version_number'] as number,
    created_at: item['created_at'] as string,
    created_by: item['created_by'] as string,
    updated_at: item['updated_at'] as string,
  };
}

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

// --- Site Handlers ---

async function handleCreateSite(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:create');
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const name = body['name'] as string;
  const address = body['address'] as string;
  const timezone = (body['timezone'] as string) || 'America/Vancouver';

  if (!name) return badRequest('Site name is required');

  const { v4: uuidv4 } = await import('uuid');
  const siteId = uuidv4();
  const now = new Date().toISOString();

  const site = {
    site_id: siteId,
    tenant_id: user.tenant_id,
    name,
    address: address || '',
    timezone,
    status: 'active',
    created_at: now,
    updated_at: now,
    created_by: user.user_id,
  };

  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  await docClient.send(
    new PutCommand({
      TableName: getTableName('Sites'),
      Item: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `SITE#${siteId}`,
        GSI1PK: `TENANT#${user.tenant_id}`,
        GSI1SK: `SITE#${now}`,
        ...site,
      },
    })
  );

  return createSuccessResponse(201, { site });
}

/**
 * Maps a raw DynamoDB site item to the flat, client-facing shape used by both
 * the sites list and the site detail endpoints. Only whitelisted fields are
 * returned, so internal attributes (PK/SK/GSI keys) never leak to the client.
 */
function mapSiteRecord(item: Record<string, unknown>): {
  id: string;
  name: string | undefined;
  address: string | undefined;
  timezone: unknown;
  status: unknown;
  created_at: unknown;
} {
  return {
    id: item['site_id'] as string,
    name: item['name'] as string | undefined,
    address: item['address'] as string | undefined,
    timezone: item['timezone'],
    status: item['status'],
    created_at: item['created_at'],
  };
}

async function handleListSites(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:read');
  if (permError) return permError;

  const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;
  const search = queryStringParameters?.['search'];

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Sites'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':prefix': 'SITE#',
      },
    })
  );

  let sites = await Promise.all(
    (result.Items ?? []).map(async (item) => {
      const record = item as Record<string, unknown>;
      const mapped = mapSiteRecord(record);
      const { activeWorkers, compliancePercent, contractor } = await computeSiteCompliance(
        user.tenant_id,
        mapped.id,
        record
      );
      return { ...mapped, activeWorkers, compliancePercent, contractor };
    })
  );

  const { filterSites } = await import('../../shared/search-filters.js');
  sites = filterSites(sites, search);

  return createSuccessResponse(200, { sites, total: sites.length });
}

async function handleGetSite(
  siteId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:read');
  if (permError) return permError;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Sites'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':sk': `SITE#${siteId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return notFound('Site not found');
  }

  const record = result.Items[0] as Record<string, unknown>;
  const mapped = mapSiteRecord(record);
  const { activeWorkers, compliancePercent, contractor } = await computeSiteCompliance(
    user.tenant_id,
    mapped.id,
    record
  );

  return createSuccessResponse(200, { ...mapped, activeWorkers, compliancePercent, contractor });
}

async function handleUpdateSite(
  event: ApiGatewayEvent,
  siteId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'policies:update');
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const updates: string[] = [];
  const values: Record<string, unknown> = {};

  if (body['name']) { updates.push('#n = :name'); values[':name'] = body['name']; }
  if (body['address']) { updates.push('address = :addr'); values[':addr'] = body['address']; }
  if (body['timezone']) { updates.push('timezone = :tz'); values[':tz'] = body['timezone']; }
  if (body['status']) { updates.push('#s = :status'); values[':status'] = body['status']; }
  values[':now'] = new Date().toISOString();
  updates.push('updated_at = :now');

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Sites'),
      Key: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `SITE#${siteId}`,
      },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: values,
      ...(body['name'] || body['status'] ? {
        ExpressionAttributeNames: {
          ...(body['name'] ? { '#n': 'name' } : {}),
          ...(body['status'] ? { '#s': 'status' } : {}),
        },
      } : {}),
    })
  );

  return createSuccessResponse(200, { message: 'Site updated' });
}
