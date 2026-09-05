/**
 * Admin Users module.
 * Lists Cognito User Pool users filtered by tenant_id for the Users & Roles page.
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  type UserType,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({});

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive' | 'invited';
  lastLogin: string | null;
  createdAt: string;
}

export interface ListAdminUsersResult {
  users: AdminUser[];
  total: number;
}

/**
 * Helper to extract a named attribute from a Cognito user's attribute list.
 */
function getAttribute(attributes: AttributeType[] | undefined, name: string): string | undefined {
  if (!attributes) return undefined;
  const attr = attributes.find((a) => a.Name === name);
  return attr?.Value;
}

/**
 * Resolves a user's role exactly like `auth-middleware.ts`'s
 * `extractUserFromClaims` does for JWT claims: the `custom:role` attribute
 * first, then Cognito Group membership, then a 'worker' default. Some users
 * are role-assigned via Groups rather than the custom attribute — without
 * this fallback they show correctly everywhere the role comes from the JWT
 * (e.g. the app header) but as "worker" here, where it was read from the
 * Cognito attribute alone.
 */
async function resolveUserRole(
  userPoolId: string,
  username: string | undefined,
  attributes: AttributeType[] | undefined
): Promise<string> {
  const customRole = getAttribute(attributes, 'custom:role');
  if (customRole) return customRole;

  if (!username) return 'worker';

  try {
    const response = await cognitoClient.send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
    );
    const firstGroup = response.Groups?.[0]?.GroupName;
    if (firstGroup) return firstGroup;
  } catch (err) {
    console.error('Failed to resolve Cognito groups for user', {
      username,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return 'worker';
}

/**
 * Maps a Cognito UserType to our AdminUser interface.
 */
function mapCognitoUser(cognitoUser: UserType, role: string): AdminUser {
  const attributes = cognitoUser.Attributes;
  const sub = getAttribute(attributes, 'sub') ?? cognitoUser.Username ?? '';
  const email = getAttribute(attributes, 'email') ?? '';
  const name = getAttribute(attributes, 'name') ?? getAttribute(attributes, 'preferred_name') ?? email;

  // Map Cognito UserStatus to our status
  let status: 'active' | 'inactive' | 'invited' = 'active';
  if (cognitoUser.UserStatus === 'FORCE_CHANGE_PASSWORD' || cognitoUser.UserStatus === 'UNCONFIRMED') {
    status = 'invited';
  } else if (cognitoUser.Enabled === false) {
    status = 'inactive';
  }

  return {
    id: sub,
    name,
    email,
    role,
    status,
    lastLogin: cognitoUser.UserLastModifiedDate?.toISOString() ?? null,
    createdAt: cognitoUser.UserCreateDate?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Lists users from the Cognito User Pool scoped to a tenant.
 *
 * NOTE: Cognito's ListUsers `Filter` parameter only supports a fixed set of
 * standard attributes (username, email, phone_number, name, given_name,
 * family_name, preferred_username, cognito:user_status, status, sub). Custom
 * attributes such as `custom:tenant_id` are NOT filterable via the API, so we
 * fetch the full paginated user list and filter by tenant in application code.
 * At the current user-pool scale this is fine; if a pool grows large this can
 * be revisited with a DynamoDB-backed tenant index synced from Cognito.
 */
export async function listAdminUsers(
  tenantId: string,
  search?: string
): Promise<ListAdminUsersResult> {
  const userPoolId = process.env['USER_POOL_ID'];
  if (!userPoolId) {
    console.error('USER_POOL_ID environment variable is not set');
    return { users: [], total: 0 };
  }

  let allUsers: UserType[] = [];
  let paginationToken: string | undefined;

  // Paginate through all results (Cognito returns max 60 per call)
  do {
    const command = new ListUsersCommand({
      UserPoolId: userPoolId,
      Limit: 60,
      PaginationToken: paginationToken,
    });

    const response = await cognitoClient.send(command);
    const users = response.Users ?? [];
    allUsers = allUsers.concat(users);
    paginationToken = response.PaginationToken;
  } while (paginationToken);

  // Filter by tenant in application code, since custom:tenant_id is not a
  // filterable attribute in Cognito's ListUsers API.
  const tenantUsers = allUsers.filter(
    (u) => getAttribute(u.Attributes, 'custom:tenant_id') === tenantId
  );

  // Map Cognito users to our AdminUser interface, resolving each user's role
  // (custom:role attribute, falling back to Cognito Group membership).
  let adminUsers = await Promise.all(
    tenantUsers.map(async (u) => {
      const role = await resolveUserRole(userPoolId, u.Username, u.Attributes);
      return mapCognitoUser(u, role);
    })
  );

  // Apply optional search filter (case-insensitive on name or email)
  if (search) {
    const lowerSearch = search.toLowerCase();
    adminUsers = adminUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(lowerSearch) ||
        u.email.toLowerCase().includes(lowerSearch)
    );
  }

  return { users: adminUsers, total: adminUsers.length };
}
