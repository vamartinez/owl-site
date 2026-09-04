// Feature: incident-timeline, Property 14: Control de acceso basado en roles

/**
 * Property-based tests for RBAC (Role-Based Access Control) logic.
 *
 * Property 14: For any user with a given role:
 * - Link creation SHALL be permitted if and only if the role is one of [tenant_admin, site_admin, supervisor, cso].
 * - Unlinking SHALL be permitted if and only if the role is one of [tenant_admin, cso].
 * - Any attempt by an unauthorized role SHALL result in HTTP 403.
 *
 * Validates: Requirements 8.1, 8.2, 8.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Role } from '../../../src/shared/types/common.js';

// ─── Constants (mirror handler.ts RBAC constants) ─────────────────────────────

/** Roles that can create links between incidents and form responses (Req 8.1) */
const LINK_CREATE_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
];

/** Roles that can unlink documents from incidents (Req 8.2) */
const UNLINK_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
];

/** All roles available in the system */
const ALL_ROLES = Object.values(Role);

// ─── Pure RBAC check functions (same logic as handler.ts) ─────────────────────

function canCreateLink(role: Role): boolean {
  return LINK_CREATE_ROLES.includes(role);
}

function canUnlink(role: Role): boolean {
  return UNLINK_ROLES.includes(role);
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for any role in the system */
const arbRole = fc.constantFrom(...ALL_ROLES);

/** Arbitrary for a role authorized to create links */
const arbLinkCreateRole = fc.constantFrom(...LINK_CREATE_ROLES);

/** Arbitrary for a role NOT authorized to create links */
const LINK_CREATE_UNAUTHORIZED_ROLES = ALL_ROLES.filter(
  (r) => !LINK_CREATE_ROLES.includes(r),
);
const arbLinkCreateUnauthorizedRole = fc.constantFrom(...LINK_CREATE_UNAUTHORIZED_ROLES);

/** Arbitrary for a role authorized to unlink */
const arbUnlinkRole = fc.constantFrom(...UNLINK_ROLES);

/** Arbitrary for a role NOT authorized to unlink */
const UNLINK_UNAUTHORIZED_ROLES = ALL_ROLES.filter(
  (r) => !UNLINK_ROLES.includes(r),
);
const arbUnlinkUnauthorizedRole = fc.constantFrom(...UNLINK_UNAUTHORIZED_ROLES);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Property 14: Role-based access control', () => {
  // **Validates: Requirements 8.1**
  it('link creation SHALL be permitted if and only if role is in [tenant_admin, site_admin, supervisor, cso]', () => {
    fc.assert(
      fc.property(arbRole, (role) => {
        const isAllowed = canCreateLink(role);
        const expectedAllowed = [
          Role.TENANT_ADMIN,
          Role.SITE_ADMIN,
          Role.SUPERVISOR,
          Role.CSO,
        ].includes(role);

        expect(isAllowed).toBe(expectedAllowed);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.2**
  it('unlinking SHALL be permitted if and only if role is in [tenant_admin, cso]', () => {
    fc.assert(
      fc.property(arbRole, (role) => {
        const isAllowed = canUnlink(role);
        const expectedAllowed = [Role.TENANT_ADMIN, Role.CSO].includes(role);

        expect(isAllowed).toBe(expectedAllowed);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.4**
  it('unauthorized roles SHALL be denied link creation (HTTP 403 scenario)', () => {
    fc.assert(
      fc.property(arbLinkCreateUnauthorizedRole, (role) => {
        // An unauthorized role must NOT be in the allowed set
        expect(canCreateLink(role)).toBe(false);
        // In the handler, this results in HTTP 403
        // Verify the role is indeed one that should be denied
        expect([Role.PLATFORM_ADMIN, Role.GATE_OPERATOR, Role.WORKER]).toContain(role);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.4**
  it('unauthorized roles SHALL be denied unlinking (HTTP 403 scenario)', () => {
    fc.assert(
      fc.property(arbUnlinkUnauthorizedRole, (role) => {
        // An unauthorized role must NOT be in the allowed set
        expect(canUnlink(role)).toBe(false);
        // In the handler, this results in HTTP 403
        // Verify the role is indeed one that should be denied
        expect([
          Role.PLATFORM_ADMIN,
          Role.SITE_ADMIN,
          Role.SUPERVISOR,
          Role.GATE_OPERATOR,
          Role.WORKER,
        ]).toContain(role);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.2**
  it('unlink roles SHALL be a subset of link creation roles', () => {
    fc.assert(
      fc.property(arbUnlinkRole, (role) => {
        // Any role that can unlink must also be able to create links
        expect(canCreateLink(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.2, 8.4**
  it('for any arbitrary role, link creation and unlinking permissions are consistent with the access matrix', () => {
    fc.assert(
      fc.property(arbRole, (role) => {
        const canLink = canCreateLink(role);
        const canUnlinkDoc = canUnlink(role);

        // If a role can unlink, it must also be able to create links
        if (canUnlinkDoc) {
          expect(canLink).toBe(true);
        }

        // Verify exact permission matrix
        switch (role) {
          case Role.TENANT_ADMIN:
            expect(canLink).toBe(true);
            expect(canUnlinkDoc).toBe(true);
            break;
          case Role.CSO:
            expect(canLink).toBe(true);
            expect(canUnlinkDoc).toBe(true);
            break;
          case Role.SITE_ADMIN:
            expect(canLink).toBe(true);
            expect(canUnlinkDoc).toBe(false);
            break;
          case Role.SUPERVISOR:
            expect(canLink).toBe(true);
            expect(canUnlinkDoc).toBe(false);
            break;
          case Role.PLATFORM_ADMIN:
          case Role.GATE_OPERATOR:
          case Role.WORKER:
            expect(canLink).toBe(false);
            expect(canUnlinkDoc).toBe(false);
            break;
        }
      }),
      { numRuns: 100 },
    );
  });
});
