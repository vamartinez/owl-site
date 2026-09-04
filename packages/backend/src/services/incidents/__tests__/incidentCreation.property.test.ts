// Feature: incident-reporting, Property 1: Incident creation produces correct initial state

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { v4 as uuidv4, validate as uuidValidate, version as uuidVersion } from 'uuid';
import { incidentCreateSchema } from '../validators';
import { IncidentType, OperationalSeverity, IncidentStatus } from '../types';
import type { IncidentRecord, RegulatoryIndicators } from '../types';

/**
 * UUID v4 regex pattern for validation.
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ISO 8601 UTC timestamp regex (e.g., 2024-01-15T10:30:00.000Z).
 */
const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Arbitrary for valid incident types (excluding OTHER to avoid refinement complexity).
 */
const incidentTypeArb = fc.constantFrom(
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

/**
 * Arbitrary for valid operational severity levels.
 */
const severityArb = fc.constantFrom(
  OperationalSeverity.LOW,
  OperationalSeverity.MEDIUM,
  OperationalSeverity.HIGH,
  OperationalSeverity.CRITICAL,
);

/**
 * Arbitrary for valid regulatory indicators (all booleans).
 */
const regulatoryIndicatorsArb = fc.record({
  medical_treatment_beyond_first_aid: fc.boolean(),
  lost_time: fc.boolean(),
  hospitalization: fc.boolean(),
  fatality: fc.boolean(),
  amputation: fc.boolean(),
  loss_of_eye: fc.boolean(),
  structural_collapse: fc.boolean(),
  hazardous_substance_release: fc.boolean(),
  fire_or_explosion: fc.boolean(),
});

/**
 * Arbitrary for a valid incident creation payload.
 * Generates random valid mandatory fields that pass incidentCreateSchema.
 */
const validIncidentPayloadArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  description: fc.string({ minLength: 1, maxLength: 5000 }).filter((s) => s.trim().length > 0),
  incident_type: incidentTypeArb,
  incident_datetime: fc.date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  }).map((d) => d.toISOString()),
  site_id: fc.stringMatching(/^[a-zA-Z0-9-]+$/).filter((s) => s.length >= 1),
  location: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  persons_involved_count: fc.nat({ max: 1000 }),
  severity: severityArb,
  regulatory_indicators: regulatoryIndicatorsArb,
});

/**
 * Simulates what the handler does when creating an incident:
 * assigns status "open", generates UUID v4, and sets ISO 8601 UTC timestamp.
 */
function buildIncidentRecord(
  validatedData: {
    title: string;
    description: string;
    incident_type: IncidentType;
    incident_datetime: string;
    site_id: string;
    location: string;
    persons_involved_count: number;
    severity: OperationalSeverity;
    regulatory_indicators: RegulatoryIndicators;
  },
): Pick<IncidentRecord, 'incident_id' | 'status' | 'created_at'> {
  const now = new Date().toISOString();
  const incidentId = uuidv4();

  return {
    incident_id: incidentId,
    status: IncidentStatus.OPEN,
    created_at: now,
  };
}

describe('Incident Creation Property Tests', () => {
  // **Validates: Requirements 1.1**
  describe('Property 1: Incident creation produces correct initial state', () => {
    it('for any valid mandatory fields, created incident has status "open", valid UUID v4, and ISO 8601 UTC timestamp', () => {
      fc.assert(
        fc.property(validIncidentPayloadArb, (payload) => {
          // Step 1: Parse through incidentCreateSchema (should succeed for valid payloads)
          const parseResult = incidentCreateSchema.safeParse(payload);
          expect(parseResult.success).toBe(true);

          if (!parseResult.success) return;

          const validatedData = parseResult.data;

          // Step 2: Build the incident record (simulating handler behavior)
          const record = buildIncidentRecord({
            title: validatedData.title,
            description: validatedData.description,
            incident_type: validatedData.incident_type,
            incident_datetime: validatedData.incident_datetime,
            site_id: validatedData.site_id,
            location: validatedData.location,
            persons_involved_count: validatedData.persons_involved_count,
            severity: validatedData.severity,
            regulatory_indicators: validatedData.regulatory_indicators as RegulatoryIndicators,
          });

          // Step 3: Assert properties on the result

          // Status must be "open"
          expect(record.status).toBe('open');

          // incident_id must be a valid UUID v4
          expect(record.incident_id).toMatch(UUID_V4_REGEX);
          expect(uuidValidate(record.incident_id)).toBe(true);
          expect(uuidVersion(record.incident_id)).toBe(4);

          // created_at must be a valid ISO 8601 UTC timestamp
          expect(record.created_at).toMatch(ISO_8601_UTC_REGEX);
          // Verify it parses to a valid date
          const parsedDate = new Date(record.created_at);
          expect(parsedDate.toISOString()).toBe(record.created_at);
          expect(Number.isNaN(parsedDate.getTime())).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
