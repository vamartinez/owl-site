// Feature: document-explorer-backend, Properties 12, 14: Preferences and Audit property tests

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { setPreferencesSchema, organizationModeSchema } from '../../schemas';
import { computeAuditTtl } from '../../audit-handler';

// ─── Property 12: Organization mode preference round trip ────────────────────

describe('Property 12: Organization mode preference round trip', () => {
  // **Validates: Requirements 9.2**

  const VALID_MODES = ['category_site_year_month', 'category_year_month_site'] as const;

  it('setting a valid mode and parsing it back returns the same value (round trip)', () => {
    const modeArb = fc.constantFrom(...VALID_MODES);

    fc.assert(
      fc.property(modeArb, (mode) => {
        // Simulate: PUT sets a mode value, GET reads it back
        // The schema validates the mode on PUT, and the stored value is returned on GET
        const putValidation = setPreferencesSchema.safeParse({ mode });
        expect(putValidation.success).toBe(true);

        if (putValidation.success) {
          // The value stored should be exactly what was validated
          const storedMode = putValidation.data.mode;

          // On GET, the mode is returned as-is from the database
          // Verify it matches the original input
          expect(storedMode).toBe(mode);

          // Verify the stored value still passes organizationModeSchema validation
          const getValidation = organizationModeSchema.safeParse(storedMode);
          expect(getValidation.success).toBe(true);
          if (getValidation.success) {
            expect(getValidation.data).toBe(mode);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('invalid mode values are rejected by setPreferencesSchema', () => {
    const invalidModeArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((s) => !VALID_MODES.includes(s as (typeof VALID_MODES)[number]));

    fc.assert(
      fc.property(invalidModeArb, (mode) => {
        const result = setPreferencesSchema.safeParse({ mode });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('round trip preserves identity for any valid mode across multiple cycles', () => {
    const modeArb = fc.constantFrom(...VALID_MODES);
    const cyclesArb = fc.integer({ min: 1, max: 10 });

    fc.assert(
      fc.property(modeArb, cyclesArb, (mode, cycles) => {
        let currentMode = mode;
        for (let i = 0; i < cycles; i++) {
          // Simulate PUT (validate + store)
          const putResult = setPreferencesSchema.safeParse({ mode: currentMode });
          expect(putResult.success).toBe(true);
          if (putResult.success) {
            currentMode = putResult.data.mode;
          }
        }
        // After any number of round trips, the mode should still be the original
        expect(currentMode).toBe(mode);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 14: Audit log TTL minimum retention ────────────────────────────

describe('Property 14: Audit log TTL minimum retention', () => {
  // **Validates: Requirements 10.2**

  const SECONDS_IN_365_DAYS = 365 * 24 * 60 * 60;

  it('TTL is always at least 365 days from creation timestamp', () => {
    // Generate arbitrary creation timestamps (epoch milliseconds)
    // Range: 2020-01-01 to 2030-01-01
    const timestampArb = fc.integer({
      min: 1577836800000, // 2020-01-01T00:00:00Z
      max: 1893456000000, // 2030-01-01T00:00:00Z
    });

    fc.assert(
      fc.property(timestampArb, (nowMs) => {
        const ttl = computeAuditTtl(nowMs);
        const creationEpochSec = Math.floor(nowMs / 1000);

        // TTL must be at least creation_epoch_seconds + 365 days in seconds
        expect(ttl).toBeGreaterThanOrEqual(creationEpochSec + SECONDS_IN_365_DAYS);
      }),
      { numRuns: 100 },
    );
  });

  it('TTL computation is deterministic for a given timestamp', () => {
    const timestampArb = fc.integer({
      min: 1577836800000,
      max: 1893456000000,
    });

    fc.assert(
      fc.property(timestampArb, (nowMs) => {
        const ttl1 = computeAuditTtl(nowMs);
        const ttl2 = computeAuditTtl(nowMs);
        expect(ttl1).toBe(ttl2);
      }),
      { numRuns: 100 },
    );
  });

  it('TTL is exactly creation_epoch_seconds + 365*24*60*60', () => {
    const timestampArb = fc.integer({
      min: 1577836800000,
      max: 1893456000000,
    });

    fc.assert(
      fc.property(timestampArb, (nowMs) => {
        const ttl = computeAuditTtl(nowMs);
        const expected = Math.floor(nowMs / 1000) + SECONDS_IN_365_DAYS;
        expect(ttl).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
