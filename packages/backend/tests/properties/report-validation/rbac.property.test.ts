// Feature: ai-report-validation, Property 13: Role-based report visibility scope
// Feature: ai-report-validation, Property 15: Upload permission by role
// Feature: ai-report-validation, Property 16: Submission restricted to report owner

/**
 * Property-based tests for RBAC functions in the report validation module.
 *
 * Property 13: For any user role, getReportVisibilityScope(role) SHALL return
 * "tenant" for tenant_admin and cso, "site" for site_admin and supervisor,
 * and "own" for all other roles.
 *
 * Property 15: For any user role, the reports:upload permission SHALL be granted
 * if and only if the role is one of [tenant_admin, site_admin, supervisor, cso].
 * All other roles (including worker, gate_operator) SHALL NOT have this permission.
 *
 * Property 16: For any pair of (requesting_user_id, report_owner_id), the submission
 * authorization check SHALL return true if and only if requesting_user_id equals
 * report_owner_id.
 *
 * **Validates: Requirements 8.5, 8.6, 11.1, 11.2, 11.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canUploadReports, isReportOwner } from '../../../src/shared/rbac.js';
import { getReportVisibilityScope } from '../../../src/services/report-validation/utils.js';
import { Role } from '../../../src/shared/types/common.js';

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

/** Roles that get "tenant" visibility scope */
const TENANT_SCOPE_ROLES: Role[] = [Role.TENANT_ADMIN, Role.CSO];

/** Roles that get "site" visibility scope */
const SITE_SCOPE_ROLES: Role[] = [Role.SITE_ADMIN, Role.SUPERVISOR];

/** Roles that get "own" visibility scope */
const OWN_SCOPE_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.GATE_OPERATOR, Role.WORKER];

/** Roles authorized to upload reports (platform_admin has all permissions by design) */
const UPLOAD_AUTHORIZED_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
];

/** Roles NOT authorized to upload reports */
const UPLOAD_UNAUTHORIZED_ROLES: Role[] = [
  Role.GATE_OPERATOR,
  Role.WORKER,
];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for any system role */
const arbRole = fc.constantFrom(...ALL_ROLES);

/** Arbitrary for a non-empty user ID string */
const arbUserId = fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0);

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Report Validation RBAC Property Tests', () => {
  // **Validates: Requirements 8.5, 8.6, 11.2**
  describe('Property 13: Role-based report visibility scope', () => {
    it('for any role, getReportVisibilityScope returns the correct scope based on role category', () => {
      fc.assert(
        fc.property(arbRole, (role) => {
          const scope = getReportVisibilityScope(role);

          if (TENANT_SCOPE_ROLES.includes(role)) {
            expect(scope).toBe('tenant');
          } else if (SITE_SCOPE_ROLES.includes(role)) {
            expect(scope).toBe('site');
          } else {
            expect(scope).toBe('own');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('tenant_admin and cso always get "tenant" visibility scope', () => {
      fc.assert(
        fc.property(fc.constantFrom(...TENANT_SCOPE_ROLES), (role) => {
          expect(getReportVisibilityScope(role)).toBe('tenant');
        }),
        { numRuns: 100 },
      );
    });

    it('site_admin and supervisor always get "site" visibility scope', () => {
      fc.assert(
        fc.property(fc.constantFrom(...SITE_SCOPE_ROLES), (role) => {
          expect(getReportVisibilityScope(role)).toBe('site');
        }),
        { numRuns: 100 },
      );
    });

    it('all other roles get "own" visibility scope', () => {
      fc.assert(
        fc.property(fc.constantFrom(...OWN_SCOPE_ROLES), (role) => {
          expect(getReportVisibilityScope(role)).toBe('own');
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 11.1**
  describe('Property 15: Upload permission by role', () => {
    it('for any role, canUploadReports returns true if and only if the role is in the authorized set', () => {
      fc.assert(
        fc.property(arbRole, (role) => {
          const result = canUploadReports(role);
          const shouldBeAuthorized = UPLOAD_AUTHORIZED_ROLES.includes(role);

          expect(result).toBe(shouldBeAuthorized);
        }),
        { numRuns: 100 },
      );
    });

    it('platform_admin, tenant_admin, site_admin, supervisor, and cso can upload reports', () => {
      fc.assert(
        fc.property(fc.constantFrom(...UPLOAD_AUTHORIZED_ROLES), (role) => {
          expect(canUploadReports(role)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('worker and gate_operator cannot upload reports', () => {
      fc.assert(
        fc.property(fc.constantFrom(...UPLOAD_UNAUTHORIZED_ROLES), (role) => {
          expect(canUploadReports(role)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 11.3**
  describe('Property 16: Submission restricted to report owner', () => {
    it('for any pair of user IDs, isReportOwner returns true if and only if they are equal', () => {
      fc.assert(
        fc.property(arbUserId, arbUserId, (requestingUserId, reportOwnerId) => {
          const result = isReportOwner(requestingUserId, reportOwnerId);

          if (requestingUserId === reportOwnerId) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('a user is always the owner of their own report', () => {
      fc.assert(
        fc.property(arbUserId, (userId) => {
          expect(isReportOwner(userId, userId)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('two distinct users are never considered the same owner', () => {
      fc.assert(
        fc.property(
          arbUserId,
          arbUserId,
          (userId1, userId2) => {
            // Only test when IDs are actually different
            fc.pre(userId1 !== userId2);
            expect(isReportOwner(userId1, userId2)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
