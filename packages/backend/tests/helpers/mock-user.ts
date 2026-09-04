/**
 * Authenticated user factory for generating mock Cognito authorizer claims.
 * Used across unit, E2E, and property-based tests.
 */

export interface MockUserOptions {
  user_id?: string;
  tenant_id?: string;
  role?: string;
  email?: string;
  assigned_sites?: string[];
}

/**
 * Creates a mock Cognito claims object with configurable fields.
 * Defaults produce a `tenant_admin` user for `tenant-test`.
 */
export function createMockClaims(options?: MockUserOptions): Record<string, string> {
  const {
    user_id = 'user-test-1',
    tenant_id = 'tenant-test',
    role = 'tenant_admin',
    email = 'admin@tenant-test.com',
    assigned_sites,
  } = options ?? {};

  const claims: Record<string, string> = {
    sub: user_id,
    'custom:role': role,
    'custom:tenant_id': tenant_id,
    email,
  };

  if (assigned_sites && assigned_sites.length > 0) {
    claims['custom:assigned_sites'] = assigned_sites.join(',');
  }

  return claims;
}
