/**
 * Self Check-In RBAC assignment tests.
 *
 * ai/worker-self-checkin Task 2.3: assert access:manage_checkin_token and
 * access:send_checkin_link are granted to platform_admin, tenant_admin,
 * site_admin and denied to supervisor, cso, gate_operator, worker.
 *
 * Requirements: 1.5, 4.6
 */

import { describe, it, expect } from 'vitest';
import { hasPermission } from '../../src/shared/rbac.js';
import { Role } from '../../src/shared/types/common.js';

const CHECKIN_PERMS = ['access:manage_checkin_token', 'access:send_checkin_link'] as const;

const GRANTED = [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN];
const DENIED = [Role.SUPERVISOR, Role.CSO, Role.GATE_OPERATOR, Role.WORKER];

describe('self-checkin RBAC', () => {
  for (const perm of CHECKIN_PERMS) {
    for (const role of GRANTED) {
      it(`grants ${perm} to ${role}`, () => {
        expect(hasPermission(role, perm)).toBe(true);
      });
    }
    for (const role of DENIED) {
      it(`denies ${perm} to ${role}`, () => {
        expect(hasPermission(role, perm)).toBe(false);
      });
    }
  }
});
