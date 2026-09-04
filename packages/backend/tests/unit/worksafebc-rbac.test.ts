/**
 * WorkSafeBC upload RBAC (Property 2 / Requirement 1.1, 1.7).
 * worksafebc:upload is granted to the 5 permitted roles and denied to the rest.
 */

import { describe, it, expect } from 'vitest';
import { hasPermission } from '../../src/shared/rbac.js';
import { Role } from '../../src/shared/types/common.js';

const GRANTED = [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN, Role.SUPERVISOR, Role.CSO];
const DENIED = [Role.GATE_OPERATOR, Role.WORKER];

describe('worksafebc:upload RBAC', () => {
  for (const role of GRANTED) {
    it(`grants worksafebc:upload to ${role}`, () => {
      expect(hasPermission(role, 'worksafebc:upload')).toBe(true);
    });
  }
  for (const role of DENIED) {
    it(`denies worksafebc:upload to ${role}`, () => {
      expect(hasPermission(role, 'worksafebc:upload')).toBe(false);
    });
  }
});
