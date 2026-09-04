/**
 * JWT validation middleware extracting tenant_id, user_id, and role from Cognito JWT claims.
 * Designed for use with AWS API Gateway Lambda proxy integration.
 */

import * as jwt from 'jsonwebtoken';
import type { Role } from './types/common.js';
import { unauthorized } from './error-handler.js';
import type { ApiGatewayResponse } from './error-handler.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth-middleware');

export interface AuthenticatedUser {
  user_id: string;
  tenant_id: string;
  role: Role;
  email?: string;
  assigned_sites?: string[];
}

export interface ApiGatewayEvent {
  headers: Record<string, string | undefined>;
  requestContext?: {
    requestId?: string;
    authorizer?: {
      claims?: Record<string, string>;
    };
  };
  [key: string]: unknown;
}

/**
 * Extracts the Bearer token from the Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1] ?? null;
}

/**
 * Extracts user information from Cognito JWT claims.
 * Supports both custom attributes (custom:role, custom:tenant_id) and
 * Cognito groups (cognito:groups) for role assignment.
 *
 * Role resolution order:
 * 1. `custom:role` claim (standard Cognito custom attribute)
 * 2. `cognito:groups` claim (array or comma-separated string from API Gateway v1/v2)
 * 3. Default to 'worker' if no role can be determined
 */
export function extractUserFromClaims(claims: Record<string, string | string[]>): AuthenticatedUser | null {
  const userId = claims['sub'] as string;

  if (!userId) {
    logger.debug('extractUserFromClaims: missing "sub" claim, returning null');
    return null;
  }

  // Role resolution with fallback chain
  let role = '';
  let roleSource = 'default';

  // 1. Try custom:role (trim whitespace for robustness against API Gateway formatting)
  const customRole = claims['custom:role'];
  if (customRole && typeof customRole === 'string' && customRole.trim()) {
    role = customRole.trim();
    roleSource = 'custom:role';
  }

  // 2. Fallback: check cognito:groups (API Gateway v1 may serialize as string, v2 as array)
  if (!role) {
    const groups = claims['cognito:groups'];
    if (Array.isArray(groups) && groups.length > 0) {
      role = (groups[0] || '').trim();
      roleSource = 'cognito:groups (array)';
    } else if (typeof groups === 'string' && groups.trim()) {
      // API Gateway v1 may serialize arrays as comma-separated strings
      // e.g., "platform_admin,tenant_admin" or "[platform_admin]"
      const cleaned = groups.replace(/[\[\]]/g, '').trim();
      role = cleaned.split(',')[0]?.trim() || '';
      roleSource = 'cognito:groups (string)';
    }
  }

  // 3. Default to worker if no role resolved
  if (!role) {
    role = 'worker';
    roleSource = 'default (no role claim found)';
  }

  // Tenant ID: try custom:tenant_id, fall back to a default
  const tenantId = ((claims['custom:tenant_id'] as string) || (claims['tenant_id'] as string) || 'default').trim();

  const assignedSites = claims['custom:assigned_sites'] as string | undefined;

  logger.debug('extractUserFromClaims: role resolved', {
    userId,
    role,
    roleSource,
    tenantId,
    hasCustomRole: !!claims['custom:role'],
    hasCognitoGroups: !!claims['cognito:groups'],
  });

  return {
    user_id: userId,
    tenant_id: tenantId,
    role: role as Role,
    email: claims['email'] as string,
    assigned_sites: assignedSites ? assignedSites.split(',') : undefined,
  };
}

/**
 * Authenticates a request by extracting user info from the API Gateway event.
 * Supports both Cognito Authorizer claims and direct JWT decoding (for testing).
 *
 * Returns the authenticated user or an error response.
 */
export function authenticateRequest(
  event: ApiGatewayEvent
): { user: AuthenticatedUser } | { error: ApiGatewayResponse } {
  // First, try to get claims from API Gateway Cognito Authorizer
  const authorizerClaims = event.requestContext?.authorizer?.claims;
  if (authorizerClaims) {
    const user = extractUserFromClaims(authorizerClaims);
    if (user) {
      return { user };
    }
    return { error: unauthorized('Invalid token claims: missing required fields') };
  }

  // Fallback: decode JWT directly (for local development/testing)
  const authHeader =
    event.headers['Authorization'] ?? event.headers['authorization'];
  const token = extractBearerToken(authHeader);

  if (!token) {
    return { error: unauthorized('Missing or invalid Authorization header') };
  }

  try {
    // In production, verification is done by API Gateway Cognito Authorizer.
    // Here we decode without verification for local dev/testing.
    const decoded = jwt.decode(token) as Record<string, string> | null;
    if (!decoded) {
      return { error: unauthorized('Invalid token') };
    }

    const user = extractUserFromClaims(decoded);
    if (!user) {
      return { error: unauthorized('Token missing required claims') };
    }

    return { user };
  } catch {
    return { error: unauthorized('Token validation failed') };
  }
}
