// Feature: ai-report-validation, Property 3: Status transition validity
// Feature: ai-report-validation, Property 4: Available actions determined by status

/**
 * Property-based tests for report status machine.
 *
 * Property 3: For any pair of ReportStatus values (from, to), `isValidTransition(from, to)`
 * SHALL return true if and only if the pair is one of: (draft, validating), (draft, submitted),
 * (validating, validated), (validating, draft), (validated, draft), (validated, submitted).
 * All other pairs SHALL return false.
 *
 * Property 4: For any ReportStatus value, `getAvailableActions(status)` SHALL return:
 * - ['request_validation', 'submit'] for "draft"
 * - [] for "validating"
 * - ['upload_version', 'submit'] for "validated"
 * - [] for "submitted"
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 3.1, 6.1, 7.1, 7.3, 8.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ReportStatus } from '../../../src/services/report-validation/types.js';
import { isValidTransition } from '../../../src/services/report-validation/types.js';
import { getAvailableActions } from '../../../src/services/report-validation/utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STATUSES: ReportStatus[] = ['draft', 'validating', 'validated', 'submitted'];

/**
 * Exhaustive set of valid transitions as defined by the spec.
 * Requirement 2.2: allowed status transitions.
 */
const VALID_TRANSITION_PAIRS: [ReportStatus, ReportStatus][] = [
  ['draft', 'validating'],
  ['draft', 'submitted'],
  ['validating', 'validated'],
  ['validating', 'draft'],
  ['validated', 'draft'],
  ['validated', 'submitted'],
];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for any valid ReportStatus */
const arbReportStatus: fc.Arbitrary<ReportStatus> = fc.constantFrom(...ALL_STATUSES);

/** Arbitrary for a pair of ReportStatus values */
const arbStatusPair: fc.Arbitrary<[ReportStatus, ReportStatus]> = fc.tuple(
  arbReportStatus,
  arbReportStatus,
);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Checks if a (from, to) pair is in the valid transitions set.
 */
function isInValidSet(from: ReportStatus, to: ReportStatus): boolean {
  return VALID_TRANSITION_PAIRS.some(([f, t]) => f === from && t === to);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Report Status Machine Property Tests', () => {
  // **Validates: Requirements 2.2, 2.3**
  describe('Property 3: Status transition validity', () => {
    it('isValidTransition returns true if and only if the pair is in the allowed transitions set', () => {
      fc.assert(
        fc.property(arbStatusPair, ([from, to]) => {
          const result = isValidTransition(from, to);
          const expected = isInValidSet(from, to);

          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('all explicitly valid transitions return true', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_TRANSITION_PAIRS),
          ([from, to]) => {
            expect(isValidTransition(from, to)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('self-transitions are never valid for any status', () => {
      fc.assert(
        fc.property(arbReportStatus, (status) => {
          expect(isValidTransition(status, status)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('submitted is a terminal state with no valid outgoing transitions', () => {
      fc.assert(
        fc.property(arbReportStatus, (to) => {
          expect(isValidTransition('submitted', to)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 2.4, 3.1, 6.1, 7.1, 7.3, 8.3**
  describe('Property 4: Available actions determined by status', () => {
    it('getAvailableActions returns the correct action set for any status', () => {
      fc.assert(
        fc.property(arbReportStatus, (status) => {
          const actions = getAvailableActions(status);

          switch (status) {
            case 'draft':
              expect(actions).toEqual(['request_validation', 'submit']);
              break;
            case 'validating':
              expect(actions).toEqual([]);
              break;
            case 'validated':
              expect(actions).toEqual(['upload_version', 'submit']);
              break;
            case 'submitted':
              expect(actions).toEqual([]);
              break;
          }
        }),
        { numRuns: 100 },
      );
    });

    it('draft status always includes request_validation action', () => {
      fc.assert(
        fc.property(fc.constant('draft' as ReportStatus), (status) => {
          const actions = getAvailableActions(status);
          expect(actions).toContain('request_validation');
        }),
        { numRuns: 100 },
      );
    });

    it('validating and submitted statuses have no available actions', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('validating' as ReportStatus, 'submitted' as ReportStatus),
          (status) => {
            const actions = getAvailableActions(status);
            expect(actions).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('submit action is available only for draft and validated statuses', () => {
      fc.assert(
        fc.property(arbReportStatus, (status) => {
          const actions = getAvailableActions(status);
          const hasSubmit = actions.includes('submit');

          if (status === 'draft' || status === 'validated') {
            expect(hasSubmit).toBe(true);
          } else {
            expect(hasSubmit).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
