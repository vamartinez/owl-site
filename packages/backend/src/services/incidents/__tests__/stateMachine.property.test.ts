// Feature: incident-reporting, Property 5: State transition validity is determined by the transition map

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IncidentStatus } from '../types';
import {
  VALID_TRANSITIONS,
  isValidTransition,
  getValidTransitions,
} from '../state-machine';

/**
 * All possible IncidentStatus values for use in generators.
 */
const ALL_STATUSES = Object.values(IncidentStatus);

/**
 * Arbitrary that produces any valid IncidentStatus.
 */
const statusArb = fc.constantFrom(...ALL_STATUSES);

describe('State Machine Property Tests', () => {
  // **Validates: Requirements 5.2, 5.4**
  describe('Property 5: State transition validity is determined by the transition map', () => {
    it('isValidTransition returns true iff the (from, to) pair is in VALID_TRANSITIONS', () => {
      fc.assert(
        fc.property(statusArb, statusArb, (from, to) => {
          const expected = VALID_TRANSITIONS[from]?.includes(to) ?? false;
          const result = isValidTransition(from, to);
          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('getValidTransitions returns exactly the allowed targets from VALID_TRANSITIONS', () => {
      fc.assert(
        fc.property(statusArb, (from) => {
          const expected = VALID_TRANSITIONS[from] ?? [];
          const result = getValidTransitions(from);
          expect(result).toEqual(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('isValidTransition returns false for pairs not in VALID_TRANSITIONS', () => {
      fc.assert(
        fc.property(statusArb, statusArb, (from, to) => {
          const isInMap = VALID_TRANSITIONS[from]?.includes(to) ?? false;
          if (!isInMap) {
            expect(isValidTransition(from, to)).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('isValidTransition returns true for pairs in VALID_TRANSITIONS', () => {
      fc.assert(
        fc.property(statusArb, (from) => {
          const validTargets = VALID_TRANSITIONS[from] ?? [];
          for (const to of validTargets) {
            expect(isValidTransition(from, to)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
