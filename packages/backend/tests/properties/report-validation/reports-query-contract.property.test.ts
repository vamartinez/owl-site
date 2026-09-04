// Feature: production-readiness-audit, Property: Reports query-param contract (frontend/backend)

/**
 * Property-based test for the report-list query-param contract between the
 * Admin Portal's `useReports` hook and the backend's `listReportsQuerySchema`.
 *
 * This guards against the exact frontend/backend contract-drift bug fixed by
 * Task 3 of the production-readiness-audit spec: `useReports.ts` was sending
 * `sort_by=created_at|latest_validation_date` and `page`/`page_size`, none of
 * which `listReportsQuerySchema` accepts, so `GET /report-validation/reports`
 * returned 400 on every load.
 *
 * Property: For ANY valid set of hook inputs, the query params that
 * `useReports.ts` derives from them SHALL always pass
 * `listReportsQuerySchema.safeParse(...)`.
 *
 * **Validates: Requirements 2.2, 2.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  listReportsQuerySchema,
  type ReportStatus,
} from '../../../src/services/report-validation/types.js';

// ─── Source of truth ───────────────────────────────────────────────────────────
//
// The shape below MUST mirror the param-building logic in
// `packages/admin-portal/src/features/report-validation/hooks/useReports.ts`.
// That hook lives in the admin-portal package and cannot be imported into the
// backend vitest suite, so its query-param construction is replicated here
// faithfully. If the hook changes how it builds query params, update BOTH the
// hook and `buildQueryParams` below — this test is what keeps them in sync.

/** Mirrors `UseReportsParams` from useReports.ts. */
interface UseReportsParams {
  cursor?: string;
  limit?: number;
  status?: ReportStatus;
  sort_by?: 'upload_date' | 'validation_date';
  sort_order?: 'asc' | 'desc';
}

/**
 * Faithful copy of the `queryParams` construction in useReports.ts
 * (the body of `useReports`, which destructures params with defaults
 * `limit = 20`, `sort_by = 'upload_date'`, `sort_order = 'desc'` and emits a
 * `Record<string, string>`). API Gateway hands the backend schema exactly this
 * string-valued query object, which is why the assertion parses strings.
 */
function buildQueryParams(params: UseReportsParams = {}): Record<string, string> {
  const { cursor, limit = 20, status, sort_by = 'upload_date', sort_order = 'desc' } = params;

  const queryParams: Record<string, string> = {
    limit: String(limit),
    sort_by,
    sort_order,
  };

  if (cursor) {
    queryParams.cursor = cursor;
  }

  if (status) {
    queryParams.status = status;
  }

  return queryParams;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────────

const ALL_STATUSES: ReportStatus[] = ['draft', 'validating', 'validated', 'submitted'];

/**
 * Arbitrary for valid hook inputs. Every field is constrained to the input
 * space the UI can actually produce:
 *  - `limit` is 1–100 (the hook's page-size control is bounded by the same
 *    range the backend `paginationQuerySchema` enforces).
 *  - `cursor` is a non-empty opaque token (the hook only sets `cursor` when
 *    truthy, so empty/whitespace-only strings are not part of the input space).
 *  - `status`, `sort_by`, `sort_order` are the enum values the UI exposes.
 *  - each optional field can also be omitted, exercising the hook's defaults.
 */
const arbHookInputs: fc.Arbitrary<UseReportsParams> = fc.record(
  {
    cursor: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
    limit: fc.integer({ min: 1, max: 100 }),
    status: fc.constantFrom<ReportStatus>(...ALL_STATUSES),
    sort_by: fc.constantFrom<'upload_date' | 'validation_date'>('upload_date', 'validation_date'),
    sort_order: fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
  },
  { requiredKeys: [] },
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Reports Query-Param Contract Property Tests', () => {
  // **Validates: Requirements 2.2, 2.3**
  describe('useReports params always satisfy listReportsQuerySchema', () => {
    it('for any valid hook inputs, the derived query params pass safeParse', () => {
      fc.assert(
        fc.property(arbHookInputs, (inputs) => {
          const queryParams = buildQueryParams(inputs);
          const result = listReportsQuerySchema.safeParse(queryParams);
          expect(result.success).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('the hook defaults (empty input) satisfy the schema', () => {
      const result = listReportsQuerySchema.safeParse(buildQueryParams());
      expect(result.success).toBe(true);
    });

    it('sort_by only ever emits values the schema accepts', () => {
      fc.assert(
        fc.property(arbHookInputs, (inputs) => {
          const { sort_by } = buildQueryParams(inputs);
          expect(['upload_date', 'validation_date']).toContain(sort_by);
        }),
        { numRuns: 200 },
      );
    });

    it('pagination is cursor-based: params never include page/page_size', () => {
      fc.assert(
        fc.property(arbHookInputs, (inputs) => {
          const queryParams = buildQueryParams(inputs);
          expect(queryParams).not.toHaveProperty('page');
          expect(queryParams).not.toHaveProperty('page_size');
          // limit is always present and parses to a valid bounded integer
          const parsed = listReportsQuerySchema.safeParse(queryParams);
          expect(parsed.success).toBe(true);
          if (parsed.success) {
            expect(parsed.data.limit).toBeGreaterThanOrEqual(1);
            expect(parsed.data.limit).toBeLessThanOrEqual(100);
          }
        }),
        { numRuns: 200 },
      );
    });
  });
});
