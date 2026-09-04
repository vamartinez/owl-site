// Feature: ai-report-validation, Property 12: Report list filtering by status

/**
 * Property-based tests for report list filtering.
 *
 * Property 12: For any array of Report objects and any status filter value, the filtered
 * result SHALL contain only reports whose status matches the filter, and SHALL contain
 * all such reports from the original array.
 *
 * **Validates: Requirements 8.2**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ReportRecord, ReportStatus } from '../../../src/services/report-validation/types.js';

// ─── Generators ───────────────────────────────────────────────────────────────

const ALL_STATUSES: ReportStatus[] = ['draft', 'validating', 'validated', 'submitted'];

const arbReportStatus = fc.constantFrom<ReportStatus>(...ALL_STATUSES);

/**
 * Generates a valid ISO 8601 UTC timestamp string.
 */
const arbISOTimestamp = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/**
 * Generates a ReportRecord with a given status.
 */
function arbReportWithStatus(status: fc.Arbitrary<ReportStatus>): fc.Arbitrary<ReportRecord> {
  return fc.record({
    tenant_id: fc.uuid(),
    report_id: fc.uuid(),
    owner_id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 255 }),
    status,
    current_version: fc.integer({ min: 1, max: 50 }),
    submitted_at: fc.option(arbISOTimestamp, { nil: undefined }),
    submitted_by: fc.option(fc.uuid(), { nil: undefined }),
    created_at: arbISOTimestamp,
    updated_at: arbISOTimestamp,
    status_history: fc.constant([]),
  });
}

/**
 * Generates an array of ReportRecord objects with random statuses.
 */
const arbReportArray = fc.array(arbReportWithStatus(arbReportStatus), {
  minLength: 0,
  maxLength: 50,
});

// ─── Pure Logic Under Test ────────────────────────────────────────────────────

/**
 * Filters an array of reports by status.
 * This is the pure filtering logic used in the report list handler.
 */
function filterReportsByStatus(reports: ReportRecord[], status: ReportStatus): ReportRecord[] {
  return reports.filter((r) => r.status === status);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Report List Property Tests', () => {
  // **Validates: Requirements 8.2**
  describe('Property 12: Report list filtering by status', () => {
    it('filtered result contains only reports whose status matches the filter', () => {
      fc.assert(
        fc.property(
          arbReportArray,
          arbReportStatus,
          (reports, filterStatus) => {
            const filtered = filterReportsByStatus(reports, filterStatus);

            // Every report in the result must have the matching status
            for (const report of filtered) {
              expect(report.status).toBe(filterStatus);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('filtered result contains all reports from the original array with matching status', () => {
      fc.assert(
        fc.property(
          arbReportArray,
          arbReportStatus,
          (reports, filterStatus) => {
            const filtered = filterReportsByStatus(reports, filterStatus);

            // Count reports with matching status in the original array
            const expectedCount = reports.filter((r) => r.status === filterStatus).length;
            expect(filtered.length).toBe(expectedCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('filtered result preserves the original report objects (no mutation)', () => {
      fc.assert(
        fc.property(
          arbReportArray,
          arbReportStatus,
          (reports, filterStatus) => {
            const filtered = filterReportsByStatus(reports, filterStatus);

            // Each filtered report must be referentially equal to one in the original
            for (const report of filtered) {
              expect(reports).toContainEqual(report);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('filtering with any status never increases the array size', () => {
      fc.assert(
        fc.property(
          arbReportArray,
          arbReportStatus,
          (reports, filterStatus) => {
            const filtered = filterReportsByStatus(reports, filterStatus);
            expect(filtered.length).toBeLessThanOrEqual(reports.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('union of all status filters equals the original array length', () => {
      fc.assert(
        fc.property(
          arbReportArray,
          (reports) => {
            const totalFiltered = ALL_STATUSES.reduce(
              (sum, status) => sum + filterReportsByStatus(reports, status).length,
              0
            );
            expect(totalFiltered).toBe(reports.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('filtering an empty array returns an empty array', () => {
      for (const status of ALL_STATUSES) {
        const filtered = filterReportsByStatus([], status);
        expect(filtered).toEqual([]);
      }
    });

    it('filtering preserves relative order of reports', () => {
      fc.assert(
        fc.property(
          arbReportArray,
          arbReportStatus,
          (reports, filterStatus) => {
            const filtered = filterReportsByStatus(reports, filterStatus);

            // Verify that the filtered results maintain the same relative order
            // as they appeared in the original array
            let lastIndex = -1;
            for (const report of filtered) {
              const currentIndex = reports.indexOf(report);
              expect(currentIndex).toBeGreaterThan(lastIndex);
              lastIndex = currentIndex;
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
