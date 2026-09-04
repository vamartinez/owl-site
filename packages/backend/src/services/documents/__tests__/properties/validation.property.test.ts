// Feature: document-explorer-backend, Properties 6, 9, 13: Validation schema property tests

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  searchRequestSchema,
  downloadRequestSchema,
  auditLogRequestSchema,
} from '../../schemas';

// ─── Property 6: Search minimum length validation ────────────────────────────

describe('Property 6: Search minimum length validation', () => {
  // **Validates: Requirements 4.2**

  it('strings with trimmed length < 2 are rejected by searchRequestSchema', () => {
    // Generate strings whose trimmed length is 0 or 1
    const shortQueryArb = fc
      .string({ minLength: 0, maxLength: 50 })
      .filter((s) => s.trim().length < 2);

    fc.assert(
      fc.property(shortQueryArb, (query) => {
        const result = searchRequestSchema.safeParse({ q: query });
        expect(result.success).toBe(false);

        if (!result.success) {
          const qErrors = result.error.issues.filter(
            (issue) => issue.path[0] === 'q',
          );
          expect(qErrors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('strings with trimmed length >= 2 are accepted by searchRequestSchema', () => {
    // Generate strings that have at least 2 non-whitespace characters after trimming
    const validQueryArb = fc
      .string({ minLength: 2, maxLength: 200 })
      .filter((s) => s.trim().length >= 2);

    fc.assert(
      fc.property(validQueryArb, (query) => {
        const result = searchRequestSchema.safeParse({ q: query });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('whitespace-padded strings with inner content >= 2 chars are accepted', () => {
    // Generate strings with leading/trailing whitespace but valid inner content
    const paddedValidArb = fc
      .tuple(
        fc.string({ minLength: 2, maxLength: 100 }).filter((s) => s.trim().length >= 2),
        fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 10 }),
        fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 10 }),
      )
      .map(([inner, leading, trailing]) => leading + inner + trailing)
      .filter((s) => s.trim().length >= 2);

    fc.assert(
      fc.property(paddedValidArb, (query) => {
        const result = searchRequestSchema.safeParse({ q: query });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Download batch validation (count bounds) ────────────────────

describe('Property 9: Download batch validation (count bounds)', () => {
  // **Validates: Requirements 7.3**

  it('empty arrays are rejected', () => {
    const result = downloadRequestSchema.safeParse({ documentIds: [] });
    expect(result.success).toBe(false);
  });

  it('arrays with more than 50 UUIDs are rejected', () => {
    const oversizedArrayArb = fc
      .integer({ min: 51, max: 150 })
      .chain((count) =>
        fc.array(fc.uuid(), { minLength: count, maxLength: count }),
      );

    fc.assert(
      fc.property(oversizedArrayArb, (documentIds) => {
        const result = downloadRequestSchema.safeParse({ documentIds });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('arrays with 1 to 50 valid UUIDs are accepted', () => {
    const validArrayArb = fc
      .integer({ min: 1, max: 50 })
      .chain((count) =>
        fc.array(fc.uuid(), { minLength: count, maxLength: count }),
      );

    fc.assert(
      fc.property(validArrayArb, (documentIds) => {
        const result = downloadRequestSchema.safeParse({ documentIds });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('arrays containing non-UUID strings are rejected regardless of length', () => {
    const invalidUuidArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => !s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));

    const arrayWithInvalidArb = fc
      .tuple(
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        invalidUuidArb,
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
      )
      .map(([before, invalid, after]) => [...before, invalid, ...after]);

    fc.assert(
      fc.property(arrayWithInvalidArb, (documentIds) => {
        const result = downloadRequestSchema.safeParse({ documentIds });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13: Audit log event validation ─────────────────────────────────

describe('Property 13: Audit log event validation', () => {
  // **Validates: Requirements 10.3, 10.4**

  const VALID_EVENT_TYPES = ['download_single', 'download_batch'] as const;

  it('valid event types with non-empty UUID arrays and non-empty userId are accepted', () => {
    const validAuditArb = fc.record({
      eventType: fc.constantFrom(...VALID_EVENT_TYPES),
      documentIds: fc
        .integer({ min: 1, max: 20 })
        .chain((count) => fc.array(fc.uuid(), { minLength: count, maxLength: count })),
      userId: fc.string({ minLength: 1, maxLength: 100 }),
    });

    fc.assert(
      fc.property(validAuditArb, (payload) => {
        const result = auditLogRequestSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid event types are rejected', () => {
    const invalidEventTypeArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => !VALID_EVENT_TYPES.includes(s as (typeof VALID_EVENT_TYPES)[number]));

    const invalidAuditArb = fc.record({
      eventType: invalidEventTypeArb,
      documentIds: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
      userId: fc.string({ minLength: 1, maxLength: 50 }),
    });

    fc.assert(
      fc.property(invalidAuditArb, (payload) => {
        const result = auditLogRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('empty documentIds arrays are rejected', () => {
    const emptyDocsArb = fc.record({
      eventType: fc.constantFrom(...VALID_EVENT_TYPES),
      documentIds: fc.constant([] as string[]),
      userId: fc.string({ minLength: 1, maxLength: 50 }),
    });

    fc.assert(
      fc.property(emptyDocsArb, (payload) => {
        const result = auditLogRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('documentIds with non-UUID strings are rejected', () => {
    const nonUuidArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => !s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));

    const invalidDocsArb = fc.record({
      eventType: fc.constantFrom(...VALID_EVENT_TYPES),
      documentIds: fc.array(nonUuidArb, { minLength: 1, maxLength: 5 }),
      userId: fc.string({ minLength: 1, maxLength: 50 }),
    });

    fc.assert(
      fc.property(invalidDocsArb, (payload) => {
        const result = auditLogRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('empty userId is rejected', () => {
    const emptyUserArb = fc.record({
      eventType: fc.constantFrom(...VALID_EVENT_TYPES),
      documentIds: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
      userId: fc.constant(''),
    });

    fc.assert(
      fc.property(emptyUserArb, (payload) => {
        const result = auditLogRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
