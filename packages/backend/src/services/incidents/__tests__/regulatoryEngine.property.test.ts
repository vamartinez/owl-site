// Feature: incident-reporting, Properties 6, 7, 13, 14: Regulatory Engine property tests

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateRegulatory, computeDeadline } from '../regulatory-engine';
import { RegulatoryFlag, RegulatoryIndicators } from '../types';

/**
 * Helper: creates a RegulatoryIndicators object with all fields false by default.
 */
function makeIndicators(overrides: Partial<RegulatoryIndicators> = {}): RegulatoryIndicators {
  return {
    medical_treatment_beyond_first_aid: false,
    lost_time: false,
    hospitalization: false,
    fatality: false,
    amputation: false,
    loss_of_eye: false,
    structural_collapse: false,
    hazardous_substance_release: false,
    fire_or_explosion: false,
    ...overrides,
  };
}

/**
 * Arbitrary: generates a random US state jurisdiction string (starts with "us_").
 */
const usJurisdictionArb = fc.stringMatching(/^us_[a-z]{2,20}$/);

/**
 * Arbitrary: generates a valid ISO 8601 datetime string.
 * Constrains to reasonable date range to avoid edge cases with Date overflow.
 */
const isoDatetimeArb = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2099-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/**
 * Arbitrary: generates a positive number of hours for deadline computation.
 */
const positiveHoursArb = fc.integer({ min: 1, max: 8760 }); // up to 1 year

/**
 * Arbitrary: generates a RegulatoryIndicators object with all fields as random booleans.
 */
const indicatorsArb = fc.record({
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

describe('Regulatory Engine Property Tests', () => {
  // **Validates: Requirements 6.1, 6.2, 6.5**
  describe('Property 6: OSHA rules', () => {
    it('fatality → 8h deadline + immediately_reportable', () => {
      fc.assert(
        fc.property(usJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ fatality: true }),
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          // Flag must be immediately_reportable
          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          // Must contain an 8h deadline from OSHA
          const deadline8h = result.deadlines.find(
            (d) => d.authority === 'OSHA' && d.deadline_hours === 8
          );
          expect(deadline8h).toBeDefined();
          expect(deadline8h!.deadline_from).toBe('incident_time');

          // Applied rules must include fatality rule
          expect(result.applied_rules).toContain('OSHA_fatality_8h');
        }),
        { numRuns: 100 },
      );
    });

    it('hospitalization → 24h deadline + immediately_reportable', () => {
      fc.assert(
        fc.property(usJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ hospitalization: true }),
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const deadline24h = result.deadlines.find(
            (d) => d.authority === 'OSHA' && d.deadline_hours === 24
          );
          expect(deadline24h).toBeDefined();
          expect(deadline24h!.deadline_from).toBe('employer_knowledge');

          expect(result.applied_rules).toContain('OSHA_severe_injury_24h');
        }),
        { numRuns: 100 },
      );
    });

    it('amputation → 24h deadline + immediately_reportable', () => {
      fc.assert(
        fc.property(usJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ amputation: true }),
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const deadline24h = result.deadlines.find(
            (d) => d.authority === 'OSHA' && d.deadline_hours === 24
          );
          expect(deadline24h).toBeDefined();
          expect(deadline24h!.deadline_from).toBe('employer_knowledge');

          expect(result.applied_rules).toContain('OSHA_severe_injury_24h');
        }),
        { numRuns: 100 },
      );
    });

    it('loss_of_eye → 24h deadline + immediately_reportable', () => {
      fc.assert(
        fc.property(usJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ loss_of_eye: true }),
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const deadline24h = result.deadlines.find(
            (d) => d.authority === 'OSHA' && d.deadline_hours === 24
          );
          expect(deadline24h).toBeDefined();

          expect(result.applied_rules).toContain('OSHA_severe_injury_24h');
        }),
        { numRuns: 100 },
      );
    });

    it('medical_treatment_beyond_first_aid → osha_recordable', () => {
      fc.assert(
        fc.property(usJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ medical_treatment_beyond_first_aid: true }),
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          expect(result.applied_rules).toContain('OSHA_recordable');

          // Should have an informational suggestion about OSHA Form 300
          const recordableSuggestion = result.suggestions.find(
            (s) => s.urgency === 'informational' && s.authority === 'OSHA'
          );
          expect(recordableSuggestion).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });

    it('lost_time → osha_recordable', () => {
      fc.assert(
        fc.property(usJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ lost_time: true }),
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          expect(result.applied_rules).toContain('OSHA_recordable');

          const recordableSuggestion = result.suggestions.find(
            (s) => s.urgency === 'informational' && s.authority === 'OSHA'
          );
          expect(recordableSuggestion).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 6.3, 6.4**
  describe('Property 7: WorkSafeBC rules', () => {
    it('fatality → immediate (0h deadline) + immediately_reportable', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ fatality: true }),
            jurisdiction: 'british_columbia',
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const immediateDeadline = result.deadlines.find(
            (d) => d.authority === 'WorkSafeBC' && d.deadline_hours === 0
          );
          expect(immediateDeadline).toBeDefined();
          expect(immediateDeadline!.deadline_from).toBe('incident_time');

          expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
        }),
        { numRuns: 100 },
      );
    });

    it('structural_collapse → immediate (0h deadline) + immediately_reportable', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ structural_collapse: true }),
            jurisdiction: 'british_columbia',
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const immediateDeadline = result.deadlines.find(
            (d) => d.authority === 'WorkSafeBC' && d.deadline_hours === 0
          );
          expect(immediateDeadline).toBeDefined();

          expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
        }),
        { numRuns: 100 },
      );
    });

    it('hazardous_substance_release → immediate (0h deadline) + immediately_reportable', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ hazardous_substance_release: true }),
            jurisdiction: 'british_columbia',
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const immediateDeadline = result.deadlines.find(
            (d) => d.authority === 'WorkSafeBC' && d.deadline_hours === 0
          );
          expect(immediateDeadline).toBeDefined();

          expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
        }),
        { numRuns: 100 },
      );
    });

    it('fire_or_explosion → immediate (0h deadline) + immediately_reportable', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ fire_or_explosion: true }),
            jurisdiction: 'british_columbia',
            incident_datetime: incidentDatetime,
          });

          expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);

          const immediateDeadline = result.deadlines.find(
            (d) => d.authority === 'WorkSafeBC' && d.deadline_hours === 0
          );
          expect(immediateDeadline).toBeDefined();

          expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
        }),
        { numRuns: 100 },
      );
    });

    it('medical_treatment_beyond_first_aid → 72h deadline', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ medical_treatment_beyond_first_aid: true }),
            jurisdiction: 'british_columbia',
            incident_datetime: incidentDatetime,
          });

          const deadline72h = result.deadlines.find(
            (d) => d.authority === 'WorkSafeBC' && d.deadline_hours === 72
          );
          expect(deadline72h).toBeDefined();
          expect(deadline72h!.deadline_from).toBe('incident_time');

          expect(result.applied_rules).toContain('WorkSafeBC_employer_report_72h');
        }),
        { numRuns: 100 },
      );
    });

    it('lost_time → 72h deadline', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators({ lost_time: true }),
            jurisdiction: 'british_columbia',
            incident_datetime: incidentDatetime,
          });

          const deadline72h = result.deadlines.find(
            (d) => d.authority === 'WorkSafeBC' && d.deadline_hours === 72
          );
          expect(deadline72h).toBeDefined();

          expect(result.applied_rules).toContain('WorkSafeBC_employer_report_72h');
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  describe('Property 13: No indicators active → internal_only, empty deadlines, osha_recordable=false', () => {
    it('all indicators false with any jurisdiction → internal_only, no deadlines, no osha_recordable', () => {
      const anyJurisdictionArb = fc.oneof(
        usJurisdictionArb,
        fc.constant('british_columbia'),
        fc.stringMatching(/^[a-z_]{3,20}$/)
      );

      fc.assert(
        fc.property(anyJurisdictionArb, isoDatetimeArb, (jurisdiction, incidentDatetime) => {
          const result = evaluateRegulatory({
            indicators: makeIndicators(), // all false
            jurisdiction,
            incident_datetime: incidentDatetime,
          });

          // Flag must be internal_only
          expect(result.regulatory_flag).toBe(RegulatoryFlag.INTERNAL_ONLY);

          // No deadlines
          expect(result.deadlines).toHaveLength(0);

          // No OSHA recordable rule applied
          expect(result.applied_rules).not.toContain('OSHA_recordable');

          // No suggestions
          expect(result.suggestions).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 6.1, 6.2, 6.3**
  describe('Property 14: Deadline computation correctness', () => {
    it('computeDeadline returns timestamp exactly N hours after reference', () => {
      fc.assert(
        fc.property(isoDatetimeArb, positiveHoursArb, (referenceTime, hours) => {
          const result = computeDeadline(referenceTime, hours);

          const referenceMs = new Date(referenceTime).getTime();
          const resultMs = new Date(result).getTime();
          const expectedMs = referenceMs + hours * 60 * 60 * 1000;

          // The result must be exactly N hours after the reference
          expect(resultMs).toBe(expectedMs);

          // The result must be a valid ISO 8601 string
          expect(new Date(result).toISOString()).toBe(result);
        }),
        { numRuns: 100 },
      );
    });

    it('computeDeadline with 0 hours returns the same timestamp', () => {
      fc.assert(
        fc.property(isoDatetimeArb, (referenceTime) => {
          const result = computeDeadline(referenceTime, 0);

          const referenceMs = new Date(referenceTime).getTime();
          const resultMs = new Date(result).getTime();

          expect(resultMs).toBe(referenceMs);
        }),
        { numRuns: 100 },
      );
    });
  });
});
