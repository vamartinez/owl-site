/**
 * WorkSafeBC notifications + watchdog tests (task 11).
 * Property (timeout enforcement): any non-terminal session past 10 min is
 * flagged by shouldTimeout; terminal sessions never are (Requirement 6.5).
 * Plus isNotifiableStatus correctness (Requirement 6.3).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  shouldTimeout,
  isNotifiableStatus,
  TIMEOUT_BUDGET_MS,
} from '../../src/services/report-validation/worksafebc-notifications.js';
import { TERMINAL_SESSION_STATUSES, type SessionStatus } from '../../src/services/report-validation/worksafebc-types.js';

const NON_TERMINAL: SessionStatus[] = ['recibido', 'categorizado', 'texto_extraido', 'analizando'];
const ALL: SessionStatus[] = [...NON_TERMINAL, ...(TERMINAL_SESSION_STATUSES as SessionStatus[])];

describe('isNotifiableStatus', () => {
  it('is true exactly for terminal statuses', () => {
    for (const s of ALL) {
      const expected = (TERMINAL_SESSION_STATUSES as readonly string[]).includes(s);
      expect(isNotifiableStatus(s)).toBe(expected);
    }
  });
});

describe('Property: timeout enforcement (Requirement 6.5)', () => {
  it('non-terminal + elapsed >= budget => should time out', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_TERMINAL),
        fc.integer({ min: TIMEOUT_BUDGET_MS, max: TIMEOUT_BUDGET_MS * 100 }),
        (status, elapsed) => {
          const started = new Date(Date.now() - elapsed).toISOString();
          expect(shouldTimeout(status, started, Date.now())).toBe(true);
        }
      )
    );
  });

  it('non-terminal + elapsed < budget => should NOT time out', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_TERMINAL),
        fc.integer({ min: 0, max: TIMEOUT_BUDGET_MS - 1 }),
        (status, elapsed) => {
          const started = new Date(Date.now() - elapsed).toISOString();
          expect(shouldTimeout(status, started, Date.now())).toBe(false);
        }
      )
    );
  });

  it('terminal statuses are never timed out, regardless of elapsed time', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(TERMINAL_SESSION_STATUSES as SessionStatus[])),
        fc.integer({ min: 0, max: TIMEOUT_BUDGET_MS * 100 }),
        (status, elapsed) => {
          const started = new Date(Date.now() - elapsed).toISOString();
          expect(shouldTimeout(status, started, Date.now())).toBe(false);
        }
      )
    );
  });

  it('a malformed started_at never throws and returns false', () => {
    expect(shouldTimeout('analizando', 'not-a-date', Date.now())).toBe(false);
  });
});
