// Feature: worker-certification-upload, Property 7: Action buttons determined by certification status
// Feature: worker-certification-upload, Property 8: RBAC permission gating

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getVisibleActions } from '../utils/getVisibleActions';
import { CertificationStatus } from '../types';

/**
 * All possible certification statuses for generating arbitrary inputs.
 */
const allStatuses = [
  CertificationStatus.PENDING,
  CertificationStatus.VALIDATED,
  CertificationStatus.REJECTED,
  CertificationStatus.EXPIRED,
] as const;

/**
 * Arbitrary: generates a random CertificationStatus.
 */
const statusArbitrary = fc.constantFrom(...allStatuses);

/**
 * Arbitrary: generates a random boolean representing whether the user
 * has the certifications.validate permission.
 */
const permissionArbitrary = fc.boolean();

/**
 * Roles that have the certifications.validate permission.
 */
const rolesWithValidatePermission = [
  'platform_admin',
  'tenant_admin',
  'site_admin',
] as const;

/**
 * Roles that do NOT have the certifications.validate permission.
 */
const rolesWithoutValidatePermission = [
  'supervisor',
  'cso',
  'gate_operator',
  'worker',
] as const;

/**
 * All user roles.
 */
const allRoles = [...rolesWithValidatePermission, ...rolesWithoutValidatePermission] as const;

/**
 * Arbitrary: generates a random user role.
 */
const roleArbitrary = fc.constantFrom(...allRoles);

describe('Action Buttons - Property-Based Tests', () => {
  // **Validates: Requirements 3.1, 6.1**
  it('Property 7: Action buttons determined by certification status — visible buttons match status rules', () => {
    fc.assert(
      fc.property(statusArbitrary, permissionArbitrary, (status, hasPermission) => {
        const actions = getVisibleActions(status, hasPermission);

        switch (status) {
          case CertificationStatus.PENDING:
            if (hasPermission) {
              expect(actions).toContain('validate');
              expect(actions).toContain('reject');
              expect(actions).not.toContain('re-upload');
              expect(actions).toHaveLength(2);
            } else {
              // Without permission, no validate/reject buttons shown
              expect(actions).not.toContain('validate');
              expect(actions).not.toContain('reject');
            }
            break;

          case CertificationStatus.REJECTED:
            expect(actions).toContain('re-upload');
            expect(actions).not.toContain('validate');
            expect(actions).not.toContain('reject');
            expect(actions).toHaveLength(1);
            break;

          case CertificationStatus.VALIDATED:
          case CertificationStatus.EXPIRED:
            expect(actions).toHaveLength(0);
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 3.7**
  it('Property 8: RBAC permission gating — Validate/Reject buttons visible iff role has certifications.validate permission', () => {
    fc.assert(
      fc.property(roleArbitrary, statusArbitrary, (role, status) => {
        const hasValidatePermission = rolesWithValidatePermission.includes(
          role as (typeof rolesWithValidatePermission)[number]
        );
        const actions = getVisibleActions(status, hasValidatePermission);

        if (hasValidatePermission) {
          // Roles with permission: Validate/Reject visible for pending certs
          if (status === CertificationStatus.PENDING) {
            expect(actions).toContain('validate');
            expect(actions).toContain('reject');
          }
        } else {
          // Roles without permission: Validate/Reject NEVER visible regardless of status
          expect(actions).not.toContain('validate');
          expect(actions).not.toContain('reject');
        }
      }),
      { numRuns: 100 }
    );
  });
});
