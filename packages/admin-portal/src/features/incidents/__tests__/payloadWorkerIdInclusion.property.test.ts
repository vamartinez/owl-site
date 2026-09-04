// Feature: incident-worker-site-search, Property 14: Payload conditional worker_id inclusion
// **Validates: Requirements 6.3, 6.4**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildCreateIncidentPayload } from '../buildCreateIncidentPayload';
import { IncidentType, OperationalSeverity } from '../types';
import type { IncidentCreateFormData } from '../schemas';

/**
 * Arbitrary for non-OTHER incident types to avoid the schema refinement
 * requiring other_type_description.
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
 * Arbitrary for valid form data representing a validated incident creation form.
 * worker_id is parameterized to test both present and absent cases.
 */
function validFormDataArb(workerIdArb: fc.Arbitrary<string | undefined>): fc.Arbitrary<IncidentCreateFormData> {
  return fc.record({
    title: fc.string({ minLength: 1, maxLength: 200 }),
    description: fc.string({ minLength: 1, maxLength: 5000 }),
    incident_type: nonOtherIncidentTypeArb,
    incident_datetime: fc.constant('2024-06-15T10:00:00Z'),
    site_id: fc.string({ minLength: 1, maxLength: 100 }),
    worker_id: workerIdArb,
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
  }) as fc.Arbitrary<IncidentCreateFormData>;
}

describe('Property 14: Payload conditional worker_id inclusion', () => {
  it('includes worker_id in payload when worker_id is a non-empty string', () => {
    fc.assert(
      fc.property(
        validFormDataArb(fc.string({ minLength: 1, maxLength: 50 })),
        (formData) => {
          const payload = buildCreateIncidentPayload(formData);

          // worker_id should be present in the payload
          expect('worker_id' in payload).toBe(true);
          expect(payload.worker_id).toBe(formData.worker_id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('omits worker_id from payload when worker_id is undefined', () => {
    fc.assert(
      fc.property(
        validFormDataArb(fc.constant(undefined)),
        (formData) => {
          const payload = buildCreateIncidentPayload(formData);

          // worker_id should NOT be present in the payload
          expect('worker_id' in payload).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('omits worker_id from payload when worker_id is an empty string', () => {
    fc.assert(
      fc.property(
        validFormDataArb(fc.constant('')),
        (formData) => {
          const payload = buildCreateIncidentPayload(formData);

          // worker_id should NOT be present in the payload
          expect('worker_id' in payload).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('biconditional: worker_id is in payload if and only if it is a non-empty string in form data', () => {
    // Mix both non-empty strings and empty/undefined values
    const workerIdArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.constant(''),
      fc.constant(undefined),
    );

    fc.assert(
      fc.property(
        validFormDataArb(workerIdArb),
        (formData) => {
          const payload = buildCreateIncidentPayload(formData);

          const workerWasSelected =
            formData.worker_id !== undefined && formData.worker_id.length > 0;

          if (workerWasSelected) {
            // worker_id SHOULD be in payload
            expect('worker_id' in payload).toBe(true);
            expect(payload.worker_id).toBe(formData.worker_id);
          } else {
            // worker_id SHOULD NOT be in payload
            expect('worker_id' in payload).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
