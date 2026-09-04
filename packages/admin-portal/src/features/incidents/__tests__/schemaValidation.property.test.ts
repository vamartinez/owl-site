// Feature: incident-worker-site-search, Property 12: site_id required validation
// Feature: incident-worker-site-search, Property 13: worker_id optional validation

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { incidentCreateSchema } from '../schemas';
import { IncidentType, OperationalSeverity } from '../types';

/**
 * Generates valid base form data for the incidentCreateSchema.
 * Uses non-OTHER incident type to avoid the refinement requiring other_type_description.
 */
function validBaseFormData(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Incident Title',
    description: 'A valid description for the incident that meets the minimum length.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-06-15T10:00:00Z',
    site_id: 'site-abc-123',
    location: 'Building A, Floor 2',
    persons_involved_count: 1,
    severity: OperationalSeverity.LOW,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    ...overrides,
  };
}

/**
 * Arbitrary for non-OTHER incident types (avoids refinement complexity).
 */
const nonOtherIncidentTypeArb = fc.constantFrom(
  IncidentType.INJURY,
  IncidentType.ILLNESS,
  IncidentType.NEAR_MISS,
  IncidentType.UNSAFE_CONDITION,
  IncidentType.PROPERTY_DAMAGE,
  IncidentType.ENVIRONMENTAL,
  IncidentType.FIRE_EXPLOSION,
  IncidentType.STRUCTURAL_FAILURE,
  IncidentType.HAZARDOUS_SUBSTANCE,
  IncidentType.REGULATORY_NON_COMPLIANCE,
);

const severityArb = fc.constantFrom(
  OperationalSeverity.LOW,
  OperationalSeverity.MEDIUM,
  OperationalSeverity.HIGH,
  OperationalSeverity.CRITICAL,
);

/**
 * Arbitrary for valid form data with a customizable site_id.
 */
function validFormDataArb(siteIdArb: fc.Arbitrary<string>) {
  return fc.record({
    title: fc.string({ minLength: 1, maxLength: 200 }),
    description: fc.string({ minLength: 1, maxLength: 5000 }),
    incident_type: nonOtherIncidentTypeArb,
    incident_datetime: fc.constant('2024-06-15T10:00:00Z'),
    site_id: siteIdArb,
    location: fc.string({ minLength: 1, maxLength: 200 }),
    persons_involved_count: fc.integer({ min: 0, max: 1000 }),
    severity: severityArb,
    regulatory_indicators: fc.record({
      medical_treatment_beyond_first_aid: fc.boolean(),
      lost_time: fc.boolean(),
      hospitalization: fc.boolean(),
      fatality: fc.boolean(),
      amputation: fc.boolean(),
      loss_of_eye: fc.boolean(),
      structural_collapse: fc.boolean(),
      hazardous_substance_release: fc.boolean(),
      fire_or_explosion: fc.boolean(),
    }),
  });
}

describe('Schema Validation Property Tests', () => {
  // **Validates: Requirements 2.5, 6.2**
  describe('Property 12: site_id required validation', () => {
    it('rejects form data when site_id is an empty string', () => {
      fc.assert(
        fc.property(
          validFormDataArb(fc.constant('')),
          (formData) => {
            const result = incidentCreateSchema.safeParse(formData);
            expect(result.success).toBe(false);
            if (!result.success) {
              const siteIdErrors = result.error.issues.filter(
                (issue) => issue.path.includes('site_id'),
              );
              expect(siteIdErrors.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects form data when site_id is undefined', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }), // title
          fc.string({ minLength: 1, maxLength: 5000 }), // description
          nonOtherIncidentTypeArb,
          (title, description, incidentType) => {
            const formData = validBaseFormData({
              title,
              description,
              incident_type: incidentType,
              site_id: undefined,
            });
            // Remove site_id entirely to simulate omission
            delete (formData as Record<string, unknown>).site_id;

            const result = incidentCreateSchema.safeParse(formData);
            expect(result.success).toBe(false);
            if (!result.success) {
              const siteIdErrors = result.error.issues.filter(
                (issue) => issue.path.includes('site_id'),
              );
              expect(siteIdErrors.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('accepts form data when site_id is a non-empty string', () => {
      fc.assert(
        fc.property(
          validFormDataArb(fc.string({ minLength: 1, maxLength: 100 })),
          (formData) => {
            const result = incidentCreateSchema.safeParse(formData);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 3.5, 6.1**
  describe('Property 13: worker_id optional validation', () => {
    it('passes validation when worker_id is undefined', () => {
      fc.assert(
        fc.property(
          validFormDataArb(fc.string({ minLength: 1, maxLength: 100 })),
          (formData) => {
            const dataWithoutWorkerId = { ...formData, worker_id: undefined };
            const result = incidentCreateSchema.safeParse(dataWithoutWorkerId);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('passes validation when worker_id is omitted entirely', () => {
      fc.assert(
        fc.property(
          validFormDataArb(fc.string({ minLength: 1, maxLength: 100 })),
          (formData) => {
            // Ensure worker_id key is not present
            const { ...dataWithoutWorkerId } = formData;
            delete (dataWithoutWorkerId as Record<string, unknown>).worker_id;

            const result = incidentCreateSchema.safeParse(dataWithoutWorkerId);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('passes validation when worker_id is a valid string', () => {
      fc.assert(
        fc.property(
          validFormDataArb(fc.string({ minLength: 1, maxLength: 100 })),
          fc.string({ minLength: 1, maxLength: 50 }),
          (formData, workerId) => {
            const dataWithWorkerId = { ...formData, worker_id: workerId };
            const result = incidentCreateSchema.safeParse(dataWithWorkerId);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
