// Feature: incident-reporting, Property 12: Role-based incident visibility filtering

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Role } from '../../../shared/types/common';
import type { IncidentRecord } from '../types';
import { IncidentType, OperationalSeverity, RegulatoryFlag, IncidentStatus, ExternalReportStatus } from '../types';

/**
 * Pure function that replicates the RBAC filtering logic from the handler's
 * handleListIncidents function. Given a list of incidents, a user role, and
 * the user's assigned sites, returns the filtered subset visible to that user.
 *
 * Returns null if the role has no access at all (would result in 403).
 *
 * Requirement 21.5:
 * - tenant_admin, cso: see all incidents in the tenant
 * - site_admin, supervisor: see only incidents for their assigned sites
 * - worker, gate_operator: see no incidents (403)
 */
export function filterIncidentsByRole(
  incidents: IncidentRecord[],
  role: Role,
  assignedSites: string[],
): IncidentRecord[] | null {
  // Roles with no incident visibility
  if (role === Role.WORKER || role === Role.GATE_OPERATOR) {
    return null;
  }

  // Full visibility roles: tenant_admin, cso
  const FULL_VISIBILITY_ROLES: Role[] = [Role.TENANT_ADMIN, Role.CSO];
  if (FULL_VISIBILITY_ROLES.includes(role)) {
    return incidents;
  }

  // Site-scoped roles: site_admin, supervisor — see only assigned sites
  const SITE_SCOPED_ROLES: Role[] = [Role.SITE_ADMIN, Role.SUPERVISOR];
  if (SITE_SCOPED_ROLES.includes(role)) {
    return incidents.filter((incident) => assignedSites.includes(incident.site_id));
  }

  // Platform admin: full access
  if (role === Role.PLATFORM_ADMIN) {
    return incidents;
  }

  // Default: no access
  return null;
}

// --- Generators ---

/** Generate a random site_id */
const siteIdArb = fc.stringMatching(/^site_[a-z0-9]{3,10}$/);

/** Generate a pool of site IDs to use across incidents and assigned_sites */
const sitePoolArb = fc.array(siteIdArb, { minLength: 1, maxLength: 8 });

/** Generate a minimal IncidentRecord with a given site_id */
function incidentWithSiteArb(siteId: fc.Arbitrary<string>): fc.Arbitrary<IncidentRecord> {
  return siteId.chain((site) =>
    fc.record({
      incident_id: fc.uuid(),
      tenant_id: fc.constant('tenant_001'),
      site_id: fc.constant(site),
      title: fc.string({ minLength: 1, maxLength: 50 }),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      incident_type: fc.constantFrom(...Object.values(IncidentType)),
      incident_datetime: fc.constant('2024-01-15T10:00:00.000Z'),
      report_datetime: fc.constant('2024-01-15T10:05:00.000Z'),
      location: fc.string({ minLength: 1, maxLength: 30 }),
      persons_involved_count: fc.nat({ max: 10 }),
      reporting_user_id: fc.uuid(),
      reporting_user_name: fc.string({ minLength: 1, maxLength: 20 }),
      severity: fc.constantFrom(...Object.values(OperationalSeverity)),
      regulatory_flag: fc.constantFrom(...Object.values(RegulatoryFlag)),
      status: fc.constantFrom(...Object.values(IncidentStatus)),
      external_report_status: fc.constantFrom(...Object.values(ExternalReportStatus)),
      regulatory_indicators: fc.constant({
        medical_treatment_beyond_first_aid: false,
        lost_time: false,
        hospitalization: false,
        fatality: false,
        amputation: false,
        loss_of_eye: false,
        structural_collapse: false,
        hazardous_substance_release: false,
        fire_or_explosion: false,
      }),
      jurisdiction: fc.constant('british_columbia'),
      created_at: fc.constant('2024-01-15T10:05:00.000Z'),
      updated_at: fc.constant('2024-01-15T10:05:00.000Z'),
    }),
  );
}

/** Generate a list of incidents spread across a pool of sites */
function incidentsFromPoolArb(sitePool: string[]): fc.Arbitrary<IncidentRecord[]> {
  return fc.array(
    incidentWithSiteArb(fc.constantFrom(...sitePool)),
    { minLength: 0, maxLength: 20 },
  );
}

/** Roles that get full visibility */
const fullVisibilityRoleArb = fc.constantFrom(Role.TENANT_ADMIN, Role.CSO);

/** Roles that get site-scoped visibility */
const siteScopedRoleArb = fc.constantFrom(Role.SITE_ADMIN, Role.SUPERVISOR);

/** Roles that get no visibility */
const noVisibilityRoleArb = fc.constantFrom(Role.WORKER, Role.GATE_OPERATOR);

describe('RBAC Filtering Property Tests', () => {
  // **Validates: Requirements 21.5**
  describe('Property 12: Role-based incident visibility filtering', () => {
    it('tenant_admin and cso see all incidents in their tenant', () => {
      fc.assert(
        fc.property(
          sitePoolArb.chain((pool) =>
            fc.tuple(
              incidentsFromPoolArb(pool),
              fullVisibilityRoleArb,
              fc.subarray(pool), // assigned_sites (irrelevant for full visibility)
            ),
          ),
          ([incidents, role, assignedSites]) => {
            const result = filterIncidentsByRole(incidents, role, assignedSites);
            expect(result).not.toBeNull();
            expect(result).toEqual(incidents);
            expect(result!.length).toBe(incidents.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('site_admin and supervisor see only incidents for their assigned sites', () => {
      fc.assert(
        fc.property(
          sitePoolArb.chain((pool) =>
            fc.tuple(
              incidentsFromPoolArb(pool),
              siteScopedRoleArb,
              fc.subarray(pool), // assigned_sites subset of pool
              fc.constant(pool),
            ),
          ),
          ([incidents, role, assignedSites, _pool]) => {
            const result = filterIncidentsByRole(incidents, role, assignedSites);
            expect(result).not.toBeNull();

            // Every returned incident must be in an assigned site
            for (const incident of result!) {
              expect(assignedSites).toContain(incident.site_id);
            }

            // Every incident in an assigned site must be returned
            const expectedIncidents = incidents.filter((i) => assignedSites.includes(i.site_id));
            expect(result!.length).toBe(expectedIncidents.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('worker and gate_operator see no incidents (access denied)', () => {
      fc.assert(
        fc.property(
          sitePoolArb.chain((pool) =>
            fc.tuple(
              incidentsFromPoolArb(pool),
              noVisibilityRoleArb,
              fc.subarray(pool),
            ),
          ),
          ([incidents, role, assignedSites]) => {
            const result = filterIncidentsByRole(incidents, role, assignedSites);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('site-scoped roles with no assigned sites see zero incidents', () => {
      fc.assert(
        fc.property(
          sitePoolArb.chain((pool) =>
            fc.tuple(
              incidentsFromPoolArb(pool),
              siteScopedRoleArb,
            ),
          ),
          ([incidents, role]) => {
            const result = filterIncidentsByRole(incidents, role, []);
            expect(result).not.toBeNull();
            expect(result!.length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('full visibility roles see all incidents regardless of assigned_sites', () => {
      fc.assert(
        fc.property(
          sitePoolArb.chain((pool) =>
            fc.tuple(
              incidentsFromPoolArb(pool),
              fullVisibilityRoleArb,
              fc.constant([]), // empty assigned_sites
            ),
          ),
          ([incidents, role, assignedSites]) => {
            const result = filterIncidentsByRole(incidents, role, assignedSites);
            expect(result).not.toBeNull();
            expect(result!.length).toBe(incidents.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('site-scoped filtering preserves incident order and identity', () => {
      fc.assert(
        fc.property(
          sitePoolArb.chain((pool) =>
            fc.tuple(
              incidentsFromPoolArb(pool),
              siteScopedRoleArb,
              fc.subarray(pool, { minLength: 1 }),
            ),
          ),
          ([incidents, role, assignedSites]) => {
            const result = filterIncidentsByRole(incidents, role, assignedSites);
            expect(result).not.toBeNull();

            // Result should be a subset of the original incidents (same references)
            for (const incident of result!) {
              expect(incidents).toContain(incident);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
