// Feature: contractor-forms-qr, Property 1: Autorización por rol

/**
 * Property-based tests for RBAC authorization in the forms module.
 *
 * Property 1: For any user role and any forms operation requiring authorization,
 * the operation must succeed only if the role is in the permitted set
 * (tenant_admin and site_admin for create/edit/publish/export;
 * supervisor and cso additionally for read responses).
 *
 * **Validates: Requirements 1.5, 3.7, 4.4, 5.5, 6.7, 7.1, 12.4, 13.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hasPermission, enforcePermission } from '../../src/shared/rbac.js';
import { Role } from '../../src/shared/types/common.js';
import type { Permission } from '../../src/shared/rbac.js';
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

/** Forms permissions and their authorized roles */
interface PermissionSpec {
  permission: Permission;
  description: string;
  authorizedRoles: Role[];
}

/**
 * Permission specifications based on the design document:
 * - platform_admin, tenant_admin, site_admin → all forms permissions
 * - supervisor, cso → forms:read, forms:read_responses
 * - gate_operator, worker → none
 */
const FORMS_PERMISSION_SPECS: PermissionSpec[] = [
  {
    permission: 'forms:create',
    description: 'Create form / Duplicate form',
    authorizedRoles: [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN],
  },
  {
    permission: 'forms:read',
    description: 'List/Get forms',
    authorizedRoles: [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN, Role.SUPERVISOR, Role.CSO],
  },
  {
    permission: 'forms:update',
    description: 'Edit draft form',
    authorizedRoles: [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN],
  },
  {
    permission: 'forms:publish',
    description: 'Publish / Unpublish form',
    authorizedRoles: [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN],
  },
  {
    permission: 'forms:read_responses',
    description: 'List/Get form responses',
    authorizedRoles: [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN, Role.SUPERVISOR, Role.CSO],
  },
  {
    permission: 'forms:export',
    description: 'Export responses CSV',
    authorizedRoles: [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN],
  },
];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for any system role */
const arbRole = fc.constantFrom(...ALL_ROLES);

/** Arbitrary for any forms permission spec */
const arbPermissionSpec = fc.constantFrom(...FORMS_PERMISSION_SPECS);

/** Arbitrary for a user ID */
const arbUserId = fc.uuid();

/** Arbitrary for a tenant ID */
const arbTenantId = fc.uuid();

/** Helper to create an AuthenticatedUser for testing */
function createUser(role: Role, userId: string, tenantId: string): AuthenticatedUser {
  return {
    user_id: userId,
    tenant_id: tenantId,
    role,
  };
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Forms RBAC Property Tests', () => {
  // **Validates: Requirements 1.5, 3.7, 4.4, 5.5, 6.7, 7.1, 12.4, 13.4**
  describe('Property 1: Autorización por rol', () => {
    it('for any role and any forms permission, hasPermission returns true only if the role is in the authorized set', () => {
      fc.assert(
        fc.property(arbRole, arbPermissionSpec, (role, spec) => {
          const result = hasPermission(role, spec.permission);
          const shouldBeAuthorized = spec.authorizedRoles.includes(role);

          if (shouldBeAuthorized) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('for any authorized role and any forms operation, enforcePermission returns null (no error)', () => {
      fc.assert(
        fc.property(
          arbPermissionSpec,
          arbUserId,
          arbTenantId,
          fc.integer({ min: 0, max: FORMS_PERMISSION_SPECS.length - 1 }),
          (spec, userId, tenantId) => {
            // Pick a random authorized role for this permission
            const authorizedRole = fc.sample(
              fc.constantFrom(...spec.authorizedRoles),
              1,
            )[0]!;
            const user = createUser(authorizedRole, userId, tenantId);
            const result = enforcePermission(user, spec.permission);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any unauthorized role and any forms operation, enforcePermission returns a 403 error', () => {
      fc.assert(
        fc.property(
          arbPermissionSpec,
          arbUserId,
          arbTenantId,
          (spec, userId, tenantId) => {
            const unauthorizedRoles = ALL_ROLES.filter(
              (r) => !spec.authorizedRoles.includes(r),
            );

            // Skip if there are no unauthorized roles for this permission
            if (unauthorizedRoles.length === 0) return;

            const unauthorizedRole = fc.sample(
              fc.constantFrom(...unauthorizedRoles),
              1,
            )[0]!;
            const user = createUser(unauthorizedRole, userId, tenantId);
            const result = enforcePermission(user, spec.permission);

            expect(result).not.toBeNull();
            expect(result!.statusCode).toBe(403);

            const body = JSON.parse(result!.body);
            expect(body.code).toBe('FORBIDDEN');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('tenant_admin and site_admin can create, edit, publish, and export forms', () => {
      const adminRoles = [Role.TENANT_ADMIN, Role.SITE_ADMIN];
      const adminPermissions: Permission[] = [
        'forms:create',
        'forms:update',
        'forms:publish',
        'forms:export',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...adminRoles),
          fc.constantFrom(...adminPermissions),
          arbUserId,
          arbTenantId,
          (role, permission, userId, tenantId) => {
            const user = createUser(role, userId, tenantId);
            const result = enforcePermission(user, permission);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('supervisor and cso can read responses but cannot create, edit, publish, or export', () => {
      const readOnlyRoles = [Role.SUPERVISOR, Role.CSO];
      const readPermissions: Permission[] = ['forms:read', 'forms:read_responses'];
      const writePermissions: Permission[] = [
        'forms:create',
        'forms:update',
        'forms:publish',
        'forms:export',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...readOnlyRoles),
          fc.constantFrom(...readPermissions),
          arbUserId,
          arbTenantId,
          (role, permission, userId, tenantId) => {
            const user = createUser(role, userId, tenantId);
            const result = enforcePermission(user, permission);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );

      fc.assert(
        fc.property(
          fc.constantFrom(...readOnlyRoles),
          fc.constantFrom(...writePermissions),
          arbUserId,
          arbTenantId,
          (role, permission, userId, tenantId) => {
            const user = createUser(role, userId, tenantId);
            const result = enforcePermission(user, permission);
            expect(result).not.toBeNull();
            expect(result!.statusCode).toBe(403);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('gate_operator and worker have no forms permissions at all', () => {
      const noAccessRoles = [Role.GATE_OPERATOR, Role.WORKER];
      const allFormsPermissions: Permission[] = [
        'forms:create',
        'forms:read',
        'forms:update',
        'forms:publish',
        'forms:read_responses',
        'forms:export',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...noAccessRoles),
          fc.constantFrom(...allFormsPermissions),
          arbUserId,
          arbTenantId,
          (role, permission, userId, tenantId) => {
            const user = createUser(role, userId, tenantId);
            const result = enforcePermission(user, permission);
            expect(result).not.toBeNull();
            expect(result!.statusCode).toBe(403);

            const body = JSON.parse(result!.body);
            expect(body.code).toBe('FORBIDDEN');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
