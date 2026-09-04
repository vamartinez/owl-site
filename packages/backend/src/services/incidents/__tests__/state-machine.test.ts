import { describe, it, expect } from 'vitest';
import { IncidentStatus } from '../types';
import {
  VALID_TRANSITIONS,
  isValidTransition,
  getValidTransitions,
} from '../state-machine';

describe('Incident State Machine', () => {
  describe('VALID_TRANSITIONS map', () => {
    it('defines transitions for all IncidentStatus values', () => {
      const allStatuses = Object.values(IncidentStatus);
      for (const status of allStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
      }
    });
  });

  describe('isValidTransition', () => {
    describe('from OPEN', () => {
      it('allows transition to UNDER_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.OPEN, IncidentStatus.UNDER_REVIEW)).toBe(true);
      });

      it('allows transition to REGULATORY_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.OPEN, IncidentStatus.REGULATORY_REVIEW)).toBe(true);
      });

      it('rejects transition to ACTION_REQUIRED', () => {
        expect(isValidTransition(IncidentStatus.OPEN, IncidentStatus.ACTION_REQUIRED)).toBe(false);
      });

      it('rejects transition to RESOLVED', () => {
        expect(isValidTransition(IncidentStatus.OPEN, IncidentStatus.RESOLVED)).toBe(false);
      });

      it('rejects transition to CLOSED', () => {
        expect(isValidTransition(IncidentStatus.OPEN, IncidentStatus.CLOSED)).toBe(false);
      });

      it('rejects self-transition to OPEN', () => {
        expect(isValidTransition(IncidentStatus.OPEN, IncidentStatus.OPEN)).toBe(false);
      });
    });

    describe('from UNDER_REVIEW', () => {
      it('allows transition to ACTION_REQUIRED', () => {
        expect(isValidTransition(IncidentStatus.UNDER_REVIEW, IncidentStatus.ACTION_REQUIRED)).toBe(true);
      });

      it('allows transition to RESOLVED', () => {
        expect(isValidTransition(IncidentStatus.UNDER_REVIEW, IncidentStatus.RESOLVED)).toBe(true);
      });

      it('rejects transition to OPEN', () => {
        expect(isValidTransition(IncidentStatus.UNDER_REVIEW, IncidentStatus.OPEN)).toBe(false);
      });

      it('rejects transition to REGULATORY_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.UNDER_REVIEW, IncidentStatus.REGULATORY_REVIEW)).toBe(false);
      });

      it('rejects transition to CLOSED', () => {
        expect(isValidTransition(IncidentStatus.UNDER_REVIEW, IncidentStatus.CLOSED)).toBe(false);
      });

      it('rejects self-transition to UNDER_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.UNDER_REVIEW, IncidentStatus.UNDER_REVIEW)).toBe(false);
      });
    });

    describe('from REGULATORY_REVIEW', () => {
      it('allows transition to ACTION_REQUIRED', () => {
        expect(isValidTransition(IncidentStatus.REGULATORY_REVIEW, IncidentStatus.ACTION_REQUIRED)).toBe(true);
      });

      it('allows transition to RESOLVED', () => {
        expect(isValidTransition(IncidentStatus.REGULATORY_REVIEW, IncidentStatus.RESOLVED)).toBe(true);
      });

      it('rejects transition to OPEN', () => {
        expect(isValidTransition(IncidentStatus.REGULATORY_REVIEW, IncidentStatus.OPEN)).toBe(false);
      });

      it('rejects transition to UNDER_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.REGULATORY_REVIEW, IncidentStatus.UNDER_REVIEW)).toBe(false);
      });

      it('rejects transition to CLOSED', () => {
        expect(isValidTransition(IncidentStatus.REGULATORY_REVIEW, IncidentStatus.CLOSED)).toBe(false);
      });

      it('rejects self-transition to REGULATORY_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.REGULATORY_REVIEW, IncidentStatus.REGULATORY_REVIEW)).toBe(false);
      });
    });

    describe('from ACTION_REQUIRED', () => {
      it('allows transition to RESOLVED', () => {
        expect(isValidTransition(IncidentStatus.ACTION_REQUIRED, IncidentStatus.RESOLVED)).toBe(true);
      });

      it('rejects transition to OPEN', () => {
        expect(isValidTransition(IncidentStatus.ACTION_REQUIRED, IncidentStatus.OPEN)).toBe(false);
      });

      it('rejects transition to UNDER_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.ACTION_REQUIRED, IncidentStatus.UNDER_REVIEW)).toBe(false);
      });

      it('rejects transition to REGULATORY_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.ACTION_REQUIRED, IncidentStatus.REGULATORY_REVIEW)).toBe(false);
      });

      it('rejects transition to CLOSED', () => {
        expect(isValidTransition(IncidentStatus.ACTION_REQUIRED, IncidentStatus.CLOSED)).toBe(false);
      });

      it('rejects self-transition to ACTION_REQUIRED', () => {
        expect(isValidTransition(IncidentStatus.ACTION_REQUIRED, IncidentStatus.ACTION_REQUIRED)).toBe(false);
      });
    });

    describe('from RESOLVED', () => {
      it('allows transition to CLOSED', () => {
        expect(isValidTransition(IncidentStatus.RESOLVED, IncidentStatus.CLOSED)).toBe(true);
      });

      it('rejects transition to OPEN', () => {
        expect(isValidTransition(IncidentStatus.RESOLVED, IncidentStatus.OPEN)).toBe(false);
      });

      it('rejects transition to UNDER_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.RESOLVED, IncidentStatus.UNDER_REVIEW)).toBe(false);
      });

      it('rejects transition to ACTION_REQUIRED', () => {
        expect(isValidTransition(IncidentStatus.RESOLVED, IncidentStatus.ACTION_REQUIRED)).toBe(false);
      });

      it('rejects self-transition to RESOLVED', () => {
        expect(isValidTransition(IncidentStatus.RESOLVED, IncidentStatus.RESOLVED)).toBe(false);
      });
    });

    describe('from CLOSED', () => {
      it('allows reopening transition to OPEN', () => {
        expect(isValidTransition(IncidentStatus.CLOSED, IncidentStatus.OPEN)).toBe(true);
      });

      it('rejects transition to UNDER_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.CLOSED, IncidentStatus.UNDER_REVIEW)).toBe(false);
      });

      it('rejects transition to REGULATORY_REVIEW', () => {
        expect(isValidTransition(IncidentStatus.CLOSED, IncidentStatus.REGULATORY_REVIEW)).toBe(false);
      });

      it('rejects transition to ACTION_REQUIRED', () => {
        expect(isValidTransition(IncidentStatus.CLOSED, IncidentStatus.ACTION_REQUIRED)).toBe(false);
      });

      it('rejects transition to RESOLVED', () => {
        expect(isValidTransition(IncidentStatus.CLOSED, IncidentStatus.RESOLVED)).toBe(false);
      });

      it('rejects self-transition to CLOSED', () => {
        expect(isValidTransition(IncidentStatus.CLOSED, IncidentStatus.CLOSED)).toBe(false);
      });
    });

    it('returns false for an unknown source state', () => {
      expect(isValidTransition('unknown_state' as IncidentStatus, IncidentStatus.OPEN)).toBe(false);
    });

    it('returns false for an unknown target state', () => {
      expect(isValidTransition(IncidentStatus.OPEN, 'unknown_state' as IncidentStatus)).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('returns [UNDER_REVIEW, REGULATORY_REVIEW] for OPEN', () => {
      expect(getValidTransitions(IncidentStatus.OPEN)).toEqual([
        IncidentStatus.UNDER_REVIEW,
        IncidentStatus.REGULATORY_REVIEW,
      ]);
    });

    it('returns [ACTION_REQUIRED, RESOLVED] for UNDER_REVIEW', () => {
      expect(getValidTransitions(IncidentStatus.UNDER_REVIEW)).toEqual([
        IncidentStatus.ACTION_REQUIRED,
        IncidentStatus.RESOLVED,
      ]);
    });

    it('returns [ACTION_REQUIRED, RESOLVED] for REGULATORY_REVIEW', () => {
      expect(getValidTransitions(IncidentStatus.REGULATORY_REVIEW)).toEqual([
        IncidentStatus.ACTION_REQUIRED,
        IncidentStatus.RESOLVED,
      ]);
    });

    it('returns [RESOLVED] for ACTION_REQUIRED', () => {
      expect(getValidTransitions(IncidentStatus.ACTION_REQUIRED)).toEqual([
        IncidentStatus.RESOLVED,
      ]);
    });

    it('returns [CLOSED] for RESOLVED', () => {
      expect(getValidTransitions(IncidentStatus.RESOLVED)).toEqual([
        IncidentStatus.CLOSED,
      ]);
    });

    it('returns [OPEN] for CLOSED (reopening)', () => {
      expect(getValidTransitions(IncidentStatus.CLOSED)).toEqual([
        IncidentStatus.OPEN,
      ]);
    });

    it('returns empty array for an unknown state', () => {
      expect(getValidTransitions('nonexistent' as IncidentStatus)).toEqual([]);
    });
  });
});
