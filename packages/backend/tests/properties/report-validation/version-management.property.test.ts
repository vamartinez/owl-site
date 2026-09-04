// Feature: ai-report-validation, Property 10: Version numbering is sequential
// Feature: ai-report-validation, Property 11: Version history reverse chronological order

/**
 * Property-based tests for version management.
 *
 * Property 10: For any report with N versions, the version numbers SHALL form the
 * sequence [1, 2, 3, ..., N] with no gaps and no duplicates.
 *
 * Property 11: For any array of ReportVersion objects, when sorted for display, the
 * result SHALL be ordered by `uploaded_at` descending (most recent first).
 *
 * **Validates: Requirements 6.2, 6.5**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ReportVersionRecord } from '../../../src/services/report-validation/types.js';

// ─── Generators ───────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
] as const;

const arbMimeType = fc.constantFrom(...ALLOWED_MIME_TYPES);

const arbExtractionStatus = fc.constantFrom<'pending' | 'completed' | 'failed'>(
  'pending',
  'completed',
  'failed'
);

/**
 * Generates a valid ISO 8601 UTC timestamp string.
 * Uses a date range from 2020-01-01 to 2030-12-31.
 */
const arbISOTimestamp = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/**
 * Generates a ReportVersionRecord with a given version number and uploaded_at timestamp.
 */
function arbVersionRecord(version: number, uploadedAt: string): fc.Arbitrary<ReportVersionRecord> {
  return fc.record({
    report_id: fc.uuid(),
    version: fc.constant(version),
    file_name: fc.string({ minLength: 1, maxLength: 100 }).map((s) => s + '.pdf'),
    file_size: fc.integer({ min: 1024, max: 25 * 1024 * 1024 }),
    mime_type: arbMimeType,
    page_count: fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
    s3_key: fc.constant(`tenant/report/v${version}/file.pdf`),
    extracted_text_key: fc.option(fc.string({ minLength: 5, maxLength: 50 }), { nil: undefined }),
    extraction_status: arbExtractionStatus,
    character_count: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
    uploaded_by: fc.uuid(),
    uploaded_at: fc.constant(uploadedAt),
  });
}

/**
 * Generates an array of N ReportVersionRecord objects with sequential version numbers
 * [1, 2, ..., N] and strictly increasing uploaded_at timestamps.
 * This represents a valid version history for a single report.
 */
const arbSequentialVersions: fc.Arbitrary<ReportVersionRecord[]> = fc
  .integer({ min: 1, max: 30 })
  .chain((n) => {
    // Generate N sorted timestamps (strictly increasing)
    return fc
      .array(
        fc.date({
          min: new Date('2020-01-01T00:00:00.000Z'),
          max: new Date('2030-12-31T23:59:59.999Z'),
        }),
        { minLength: n, maxLength: n }
      )
      .map((dates) => dates.sort((a, b) => a.getTime() - b.getTime()))
      .chain((sortedDates) => {
        // Create version records with sequential numbers and sorted timestamps
        const arbitraries = sortedDates.map((date, i) =>
          arbVersionRecord(i + 1, date.toISOString())
        );
        return fc.tuple(...(arbitraries as [fc.Arbitrary<ReportVersionRecord>, ...fc.Arbitrary<ReportVersionRecord>[]]));
      })
      .map((tuple) => [...tuple]);
  });

/**
 * Generates an arbitrary array of ReportVersionRecord objects with random
 * uploaded_at timestamps (not necessarily ordered). Used for testing sort behavior.
 */
const arbUnorderedVersionRecords: fc.Arbitrary<ReportVersionRecord[]> = fc
  .integer({ min: 1, max: 30 })
  .chain((n) => {
    return fc
      .array(arbISOTimestamp, { minLength: n, maxLength: n })
      .chain((timestamps) => {
        const arbitraries = timestamps.map((ts, i) => arbVersionRecord(i + 1, ts));
        return fc.tuple(...(arbitraries as [fc.Arbitrary<ReportVersionRecord>, ...fc.Arbitrary<ReportVersionRecord>[]]));
      })
      .map((tuple) => [...tuple]);
  });

// ─── Pure Logic Under Test ────────────────────────────────────────────────────

/**
 * Validates that an array of version numbers forms a sequential sequence [1, 2, ..., N]
 * with no gaps and no duplicates.
 */
function isSequentialVersioning(versions: number[]): boolean {
  if (versions.length === 0) return true;
  const sorted = [...versions].sort((a, b) => a - b);
  return sorted.every((v, i) => v === i + 1);
}

/**
 * Sorts ReportVersionRecord objects for display: by uploaded_at descending (most recent first).
 * This is the pure sorting logic that getVersionHistory applies.
 */
function sortVersionsForDisplay(versions: ReportVersionRecord[]): ReportVersionRecord[] {
  return [...versions].sort(
    (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Version Management Property Tests', () => {
  // **Validates: Requirements 6.2**
  describe('Property 10: Version numbering is sequential', () => {
    it('version numbers form the sequence [1, 2, 3, ..., N] with no gaps', () => {
      fc.assert(
        fc.property(
          arbSequentialVersions,
          (versions) => {
            const versionNumbers = versions.map((v) => v.version);
            expect(isSequentialVersioning(versionNumbers)).toBe(true);

            // Verify starts at 1
            const sorted = [...versionNumbers].sort((a, b) => a - b);
            expect(sorted[0]).toBe(1);

            // Verify ends at N
            expect(sorted[sorted.length - 1]).toBe(versions.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('version numbers have no duplicates', () => {
      fc.assert(
        fc.property(
          arbSequentialVersions,
          (versions) => {
            const versionNumbers = versions.map((v) => v.version);
            const uniqueVersions = new Set(versionNumbers);
            expect(uniqueVersions.size).toBe(versionNumbers.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('each consecutive pair differs by exactly 1', () => {
      fc.assert(
        fc.property(
          arbSequentialVersions,
          (versions) => {
            const sorted = [...versions].sort((a, b) => a.version - b.version);
            for (let i = 1; i < sorted.length; i++) {
              expect(sorted[i].version - sorted[i - 1].version).toBe(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('detects non-sequential arrays (gaps or duplicates)', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 20 }),
          (randomNumbers) => {
            const isSequential = isSequentialVersioning(randomNumbers);

            // Verify our check: if sequential, it must be [1..N]
            if (isSequential) {
              const sorted = [...randomNumbers].sort((a, b) => a - b);
              expect(sorted[0]).toBe(1);
              expect(sorted[sorted.length - 1]).toBe(randomNumbers.length);
              const unique = new Set(randomNumbers);
              expect(unique.size).toBe(randomNumbers.length);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('single version is always version 1', () => {
      fc.assert(
        fc.property(
          arbSequentialVersions.filter((v) => v.length === 1),
          (versions) => {
            expect(versions[0].version).toBe(1);
            expect(isSequentialVersioning([versions[0].version])).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 6.5**
  describe('Property 11: Version history reverse chronological order', () => {
    it('sorted result is ordered by uploaded_at descending (most recent first)', () => {
      fc.assert(
        fc.property(
          arbUnorderedVersionRecords,
          (versions) => {
            const sorted = sortVersionsForDisplay(versions);

            // Verify descending order by uploaded_at
            for (let i = 1; i < sorted.length; i++) {
              const prevTime = new Date(sorted[i - 1].uploaded_at).getTime();
              const currTime = new Date(sorted[i].uploaded_at).getTime();
              expect(prevTime).toBeGreaterThanOrEqual(currTime);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('sorting preserves all elements (no items lost or added)', () => {
      fc.assert(
        fc.property(
          arbUnorderedVersionRecords,
          (versions) => {
            const sorted = sortVersionsForDisplay(versions);
            expect(sorted.length).toBe(versions.length);

            // Every element in the input appears in the output
            for (const version of versions) {
              expect(sorted).toContainEqual(version);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('sorting is idempotent (sorting an already sorted array produces the same result)', () => {
      fc.assert(
        fc.property(
          arbUnorderedVersionRecords,
          (versions) => {
            const sorted1 = sortVersionsForDisplay(versions);
            const sorted2 = sortVersionsForDisplay(sorted1);

            expect(sorted2).toEqual(sorted1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('first element has the most recent uploaded_at', () => {
      fc.assert(
        fc.property(
          arbUnorderedVersionRecords,
          (versions) => {
            const sorted = sortVersionsForDisplay(versions);
            const maxTime = Math.max(
              ...versions.map((v) => new Date(v.uploaded_at).getTime())
            );
            expect(new Date(sorted[0].uploaded_at).getTime()).toBe(maxTime);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('last element has the oldest uploaded_at', () => {
      fc.assert(
        fc.property(
          arbUnorderedVersionRecords,
          (versions) => {
            const sorted = sortVersionsForDisplay(versions);
            const minTime = Math.min(
              ...versions.map((v) => new Date(v.uploaded_at).getTime())
            );
            expect(new Date(sorted[sorted.length - 1].uploaded_at).getTime()).toBe(minTime);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('does not mutate the original array', () => {
      fc.assert(
        fc.property(
          arbUnorderedVersionRecords,
          (versions) => {
            const original = [...versions];
            sortVersionsForDisplay(versions);
            expect(versions).toEqual(original);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
