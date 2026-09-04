// Feature: ai-report-validation, Property 7: Validation result structure completeness

/**
 * Property-based tests for validation result structure completeness.
 *
 * Property 7: For any valid ComplianceFinding object, it SHALL contain non-empty values
 * for: finding_id, severity (one of critical/major/minor/informational), description
 * (≤500 chars), report_section, suggested_correction (≤500 chars), and at least one
 * RegulationReference.
 *
 * **Validates: Requirements 4.1, 4.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ComplianceFinding, FindingSeverity, RegulationReference } from '../../../src/services/report-validation/types.js';
import {
  MAX_FINDING_DESCRIPTION_LENGTH,
  MAX_SUGGESTED_CORRECTION_LENGTH,
} from '../../../src/services/report-validation/types.js';
import { parseValidationResponse } from '../../../src/services/report-validation/validation-engine.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SEVERITIES: FindingSeverity[] = ['critical', 'major', 'minor', 'informational'];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for any valid FindingSeverity */
const arbSeverity: fc.Arbitrary<FindingSeverity> = fc.constantFrom(...VALID_SEVERITIES);

/** Arbitrary for a non-empty string with bounded length */
const arbNonEmptyString = (maxLength: number) =>
  fc.string({ minLength: 1, maxLength });

/** Arbitrary for a RegulationReference */
const arbRegulationReference: fc.Arbitrary<RegulationReference> = fc.record({
  title: arbNonEmptyString(100),
  section: arbNonEmptyString(50),
  url: fc.option(fc.webUrl(), { nil: undefined }),
});

/** Arbitrary for a raw finding object that will be accepted by parseValidationResponse */
const arbRawFinding = fc.record({
  severity: arbSeverity,
  description: arbNonEmptyString(500),
  report_section: arbNonEmptyString(100),
  suggested_correction: arbNonEmptyString(500),
  regulation_references: fc.array(
    fc.record({
      title: arbNonEmptyString(100),
      section: arbNonEmptyString(50),
      url: fc.option(fc.webUrl(), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

/**
 * Arbitrary for a valid JSON response string containing findings.
 * Generates a response that parseValidationResponse can parse into ComplianceFinding[].
 */
const arbValidResponseWithFindings: fc.Arbitrary<string> = fc
  .record({
    summary: fc.string({ minLength: 1, maxLength: 200 }),
    findings: fc.array(arbRawFinding, { minLength: 1, maxLength: 10 }),
  })
  .map((data) => JSON.stringify(data));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Validation Result Structure Property Tests', () => {
  // **Validates: Requirements 4.1, 4.3**
  describe('Property 7: Validation result structure completeness', () => {
    it('every ComplianceFinding produced by parseValidationResponse has a non-empty finding_id', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            expect(finding.finding_id).toBeDefined();
            expect(typeof finding.finding_id).toBe('string');
            expect(finding.finding_id.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every ComplianceFinding has a valid severity (critical/major/minor/informational)', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            expect(VALID_SEVERITIES).toContain(finding.severity);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every ComplianceFinding has a non-empty description of at most 500 characters', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            expect(finding.description.length).toBeGreaterThan(0);
            expect(finding.description.length).toBeLessThanOrEqual(MAX_FINDING_DESCRIPTION_LENGTH);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every ComplianceFinding has a non-empty report_section', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            expect(finding.report_section).toBeDefined();
            expect(typeof finding.report_section).toBe('string');
            expect(finding.report_section.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every ComplianceFinding has a non-empty suggested_correction of at most 500 characters', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            expect(finding.suggested_correction.length).toBeGreaterThan(0);
            expect(finding.suggested_correction.length).toBeLessThanOrEqual(
              MAX_SUGGESTED_CORRECTION_LENGTH,
            );
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every ComplianceFinding has at least one RegulationReference', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            expect(finding.regulation_references).toBeDefined();
            expect(Array.isArray(finding.regulation_references)).toBe(true);
            expect(finding.regulation_references.length).toBeGreaterThanOrEqual(1);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every RegulationReference has non-empty title and section', () => {
      fc.assert(
        fc.property(arbValidResponseWithFindings, (responseText) => {
          const { findings } = parseValidationResponse(responseText);

          for (const finding of findings) {
            for (const ref of finding.regulation_references) {
              expect(ref.title.length).toBeGreaterThan(0);
              expect(ref.section.length).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('description is truncated to 500 chars when input exceeds the limit', () => {
      fc.assert(
        fc.property(
          fc.record({
            summary: fc.constant('Test summary'),
            findings: fc.array(
              fc.record({
                severity: arbSeverity,
                description: fc.string({ minLength: 501, maxLength: 1000 }),
                report_section: arbNonEmptyString(100),
                suggested_correction: arbNonEmptyString(500),
                regulation_references: fc.array(
                  fc.record({
                    title: arbNonEmptyString(100),
                    section: arbNonEmptyString(50),
                    url: fc.option(fc.webUrl(), { nil: undefined }),
                  }),
                  { minLength: 1, maxLength: 3 },
                ),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }).map((data) => JSON.stringify(data)),
          (responseText) => {
            const { findings } = parseValidationResponse(responseText);

            for (const finding of findings) {
              expect(finding.description.length).toBeLessThanOrEqual(MAX_FINDING_DESCRIPTION_LENGTH);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('suggested_correction is truncated to 500 chars when input exceeds the limit', () => {
      fc.assert(
        fc.property(
          fc.record({
            summary: fc.constant('Test summary'),
            findings: fc.array(
              fc.record({
                severity: arbSeverity,
                description: arbNonEmptyString(500),
                report_section: arbNonEmptyString(100),
                suggested_correction: fc.string({ minLength: 501, maxLength: 1000 }),
                regulation_references: fc.array(
                  fc.record({
                    title: arbNonEmptyString(100),
                    section: arbNonEmptyString(50),
                    url: fc.option(fc.webUrl(), { nil: undefined }),
                  }),
                  { minLength: 1, maxLength: 3 },
                ),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }).map((data) => JSON.stringify(data)),
          (responseText) => {
            const { findings } = parseValidationResponse(responseText);

            for (const finding of findings) {
              expect(finding.suggested_correction.length).toBeLessThanOrEqual(
                MAX_SUGGESTED_CORRECTION_LENGTH,
              );
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('findings with missing required fields are excluded from the result', () => {
      fc.assert(
        fc.property(
          fc.record({
            summary: fc.constant('Test summary'),
            findings: fc.array(
              fc.record({
                severity: arbSeverity,
                description: fc.constant(''), // empty description → should be excluded
                report_section: arbNonEmptyString(100),
                suggested_correction: arbNonEmptyString(500),
                regulation_references: fc.array(
                  fc.record({
                    title: arbNonEmptyString(100),
                    section: arbNonEmptyString(50),
                  }),
                  { minLength: 1, maxLength: 3 },
                ),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }).map((data) => JSON.stringify(data)),
          (responseText) => {
            const { findings } = parseValidationResponse(responseText);

            // All findings with empty description should be excluded
            expect(findings.length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('findings without regulation references are excluded from the result', () => {
      fc.assert(
        fc.property(
          fc.record({
            summary: fc.constant('Test summary'),
            findings: fc.array(
              fc.record({
                severity: arbSeverity,
                description: arbNonEmptyString(500),
                report_section: arbNonEmptyString(100),
                suggested_correction: arbNonEmptyString(500),
                regulation_references: fc.constant([]), // empty refs → should be excluded
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }).map((data) => JSON.stringify(data)),
          (responseText) => {
            const { findings } = parseValidationResponse(responseText);

            // All findings without regulation references should be excluded
            expect(findings.length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
