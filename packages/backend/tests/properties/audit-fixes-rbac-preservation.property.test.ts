/**
 * Preservation Property Test 2c — RBAC denies unauthorized roles correctly
 *
 * This test verifies that roles WITHOUT `reports:read` permission (worker, gate_operator)
 * continue to receive 403 after the audit fixes are applied.
 *
 * Observation (UNFIXED code):
 * - `worker` role receives 403 for `GET /report-validation/reports`
 * - `gate_operator` role receives 403 for `GET /report-validation/reports`
 * - hasPermission(worker, 'reports:read') === false
 * - hasPermission(gate_operator, 'reports:read') === false
 *
 * Property: For all roles where hasPermission(role, 'reports:read') = false,
 * enforcePermission returns a 403 response.
 *
 * **Validates: Requirements 3.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hasPermission, enforcePermission } from '../../src/shared/rbac.js';
import { Role } from '../../src/shared/types/common.js';
import type { AuthenticatedUser } from '../../src/shared/auth-middleware.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** All roles in the system */
const ALL_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
  Role.GATE_OPERATOR,
  Role.WORKER,
];

/** Roles that should NOT have reports:read permission */
const ROLES_WITHOUT_REPORTS_READ: Role[] = ALL_ROLES.filter(
  (role) => !hasPermission(role, 'reports:read')
);

/** Roles that SHOULD have reports:read permission */
const ROLES_WITH_REPORTS_READ: Role[] = ALL_ROLES.filter(
  (role) => hasPermission(role, 'reports:read')
);

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for roles without reports:read */
const arbUnauthorizedRole = fc.constantFrom(...ROLES_WITHOUT_REPORTS_READ);

/** Arbitrary for roles with reports:read */
const arbAuthorizedRole = fc.constantFrom(...ROLES_WITH_REPORTS_READ);

/** Arbitrary for user ID */
const arbUserId = fc.uuid();

/** Arbitrary for tenant ID */
const arbTenantId = fc.uuid();

/** Helper to create an AuthenticatedUser */
function createUser(role: Role, userId: string, tenantId: string): AuthenticatedUser {
  return {
    user_id: userId,
    tenant_id: tenantId,
    role,
  };
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Preservation Property Test 2c — RBAC denies unauthorized roles for reports:read', () => {
  /**
   * Property: For all roles where hasPermission(role, 'reports:read') = false,
   * enforcePermission returns a 403 Forbidden response.
   *
   * This ensures that after the fix (which addresses platform_admin getting incorrectly
   * denied), unauthorized roles (worker, gate_operator) STILL get denied.
   *
   * **Validates: Requirements 3.4**
   */
  it('unauthorized roles (worker, gate_operator) always receive 403 for reports:read', () => {
    fc.assert(
      fc.property(arbUnauthorizedRole, arbUserId, arbTenantId, (role, userId, tenantId) => {
        const user = createUser(role, userId, tenantId);
        const result = enforcePermission(user, 'reports:read');

        // Must return a 403 response
        expect(result).not.toBeNull();
        expect(result!.statusCode).toBe(403);

        const body = JSON.parse(result!.body);
        expect(body.code).toBe('FORBIDDEN');
      }),
      { numRuns: 100 }
    );
  });

  it('hasPermission returns false for worker and gate_operator with reports:read', () => {
    fc.assert(
      fc.property(arbUnauthorizedRole, (role) => {
        expect(hasPermission(role, 'reports:read')).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  it('confirms worker and gate_operator are specifically in the unauthorized set', () => {
    // Explicit observation: these two roles lack reports:read
    expect(ROLES_WITHOUT_REPORTS_READ).toContain(Role.WORKER);
    expect(ROLES_WITHOUT_REPORTS_READ).toContain(Role.GATE_OPERATOR);
  });

  it('authorized roles (platform_admin, tenant_admin, site_admin, supervisor, cso) have reports:read in the matrix', () => {
    fc.assert(
      fc.property(arbAuthorizedRole, (role) => {
        expect(hasPermission(role, 'reports:read')).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('enforcePermission returns null (authorized) for roles with reports:read', () => {
    fc.assert(
      fc.property(arbAuthorizedRole, arbUserId, arbTenantId, (role, userId, tenantId) => {
        const user = createUser(role, userId, tenantId);
        const result = enforcePermission(user, 'reports:read');

        // Must return null (authorized)
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
