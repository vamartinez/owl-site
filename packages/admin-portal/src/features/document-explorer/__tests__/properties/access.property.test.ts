// Feature: document-explorer, Property 11: Role-based access check

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canAccessDocumentExplorer } from '../../utils';

const ALLOWED_ROLES = ['platform_admin', 'tenant_admin', 'site_admin', 'supervisor', 'cso'];

describe('Property 11: Role-based access check', () => {
  // **Validates: Requirements 5.1, 5.3**

  it('returns true ONLY for the 5 allowed roles', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_ROLES), (role) => {
        expect(canAccessDocumentExplorer(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('returns false for any arbitrary role string not in the allowed set', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).filter((s) => !ALLOWED_ROLES.includes(s)),
        (role) => {
          expect(canAccessDocumentExplorer(role)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false for roles that are similar to allowed roles but not exact matches', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_ROLES),
        fc.constantFrom(' ', '_extra', 'X', '1', ' '),
        (allowedRole, suffix) => {
          const modifiedRole = allowedRole + suffix;
          if (!ALLOWED_ROLES.includes(modifiedRole)) {
            expect(canAccessDocumentExplorer(modifiedRole)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is case-sensitive — uppercase variants of allowed roles are rejected', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_ROLES), (role) => {
        const upperRole = role.toUpperCase();
        if (!ALLOWED_ROLES.includes(upperRole)) {
          expect(canAccessDocumentExplorer(upperRole)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns false for common disallowed roles', () => {
    const disallowedRoles = [
      'gate_operator',
      'worker',
      'admin',
      'user',
      'guest',
      'manager',
      'viewer',
      '',
    ];

    fc.assert(
      fc.property(fc.constantFrom(...disallowedRoles), (role) => {
        expect(canAccessDocumentExplorer(role)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
