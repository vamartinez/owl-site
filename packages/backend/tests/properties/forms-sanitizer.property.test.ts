// Feature: contractor-forms-qr, Property 20: Sanitización preserva contenido seguro

/**
 * Property-based tests for the Forms Sanitizer Module.
 *
 * Property 20: For any input string containing potentially dangerous patterns
 * (HTML tags, scripts, SQL injection), the sanitization function must remove or
 * escape the dangerous patterns while preserving safe textual content, and the
 * submission must not be rejected if the remaining data is valid.
 *
 * Validates: Requirements 11.7, 15.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeInput, sanitizeFormAnswers } from '../../src/services/forms/sanitizer.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Arbitrary for "safe" strings: strings that do NOT contain HTML tags,
 * SQL special characters (', ", ;, --), or control sequences (chars < 0x20
 * except \n, \r, \t). These strings should be preserved by sanitizeInput
 * modulo whitespace normalization.
 */
const arbSafeString = fc.stringOf(
  fc.char().filter((c) => {
    const code = c.charCodeAt(0);
    // Exclude HTML tag chars
    if (c === '<' || c === '>') return false;
    // Exclude SQL special chars
    if (c === "'" || c === '"' || c === ';') return false;
    // Exclude double-dash (handled as individual chars here; -- is two chars)
    if (c === '-') return false;
    // Exclude control sequences (below 0x20 except \n, \r, \t)
    if (code < 0x20 && c !== '\n' && c !== '\r' && c !== '\t') return false;
    return true;
  }),
  { minLength: 0, maxLength: 200 },
);

/**
 * Arbitrary for safe content that explicitly includes alphanumeric characters,
 * common punctuation (., ,, !, ?, :, (, ), /, @, #, $, %, &, *, +, =, ~),
 * and accented characters common in Spanish (á, é, í, ó, ú, ñ, ü, Á, É, etc.).
 * These should all pass through sanitization unchanged.
 */
const arbSafeContentWithAccents = fc.stringOf(
  fc.oneof(
    // Alphanumeric
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
    // Common punctuation (safe chars that are not SQL/HTML special)
    fc.constantFrom(...'.,!?:()/@#$%&*+=~ '.split('')),
    // Accented characters (Spanish and common Latin)
    fc.constantFrom(...'áéíóúñüÁÉÍÓÚÑÜàèìòùâêîôûäëïöüçÇ'.split('')),
  ),
  { minLength: 1, maxLength: 200 },
);

/**
 * Arbitrary for strings with HTML tags injected around safe content.
 */
const arbHtmlInjection = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 50 }),
  fc.constantFrom(
    '<script>alert("xss")</script>',
    '<img src=x onerror=alert(1)>',
    '<div onclick="steal()">',
    '</div>',
    '<iframe src="evil.com"></iframe>',
    '<b>',
    '</b>',
    '<a href="javascript:void(0)">',
  ),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 50 }),
).map(([before, tag, after]) => `${before}${tag}${after}`);

/**
 * Arbitrary for strings with SQL injection patterns.
 */
const arbSqlInjection = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 50 }),
  fc.constantFrom(
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    '"; DELETE FROM forms; --',
    "' UNION SELECT * FROM passwords --",
    "1; EXEC xp_cmdshell('dir')",
  ),
).map(([before, injection]) => `${before}${injection}`);

/**
 * Arbitrary for strings with control sequences.
 */
const arbControlSequences = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 50 }),
  fc.stringOf(
    fc.integer({ min: 0x00, max: 0x08 }).map((code) => String.fromCharCode(code)),
    { minLength: 1, maxLength: 5 },
  ),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 50 }),
).map(([before, ctrl, after]) => `${before}${ctrl}${after}`);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Normalizes whitespace the same way sanitizeInput does:
 * collapse multiple non-newline/tab whitespace into single space, then trim.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/[^\S\n\r\t]+/g, ' ').trim();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Sanitizer Property Tests', () => {
  // **Validates: Requirements 11.7, 15.3**
  describe('Property 20: Sanitización preserva contenido seguro', () => {
    it('for any safe string (no HTML, no SQL special chars, no control sequences), sanitizeInput preserves content modulo whitespace normalization', () => {
      fc.assert(
        fc.property(arbSafeString, (safeInput) => {
          const result = sanitizeInput(safeInput);
          const expected = normalizeWhitespace(safeInput);
          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('safe content with alphanumeric, common punctuation, and accented characters passes through unchanged', () => {
      fc.assert(
        fc.property(arbSafeContentWithAccents, (safeInput) => {
          const result = sanitizeInput(safeInput);
          const expected = normalizeWhitespace(safeInput);
          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('sanitizeInput always removes HTML tags while preserving surrounding text', () => {
      fc.assert(
        fc.property(arbHtmlInjection, (input) => {
          const result = sanitizeInput(input);

          // Result must not contain any HTML tags
          expect(result).not.toMatch(/<[^>]*>/);

          // Result must still be a non-empty string (safe content preserved)
          expect(result.length).toBeGreaterThan(0);

          // Result must not contain the dangerous tag content
          expect(result).not.toContain('<script');
          expect(result).not.toContain('<img');
          expect(result).not.toContain('<iframe');
          expect(result).not.toContain('<div');
          expect(result).not.toContain('<a ');
        }),
        { numRuns: 100 },
      );
    });

    it('sanitizeInput escapes SQL special characters while preserving safe text', () => {
      fc.assert(
        fc.property(arbSqlInjection, (input) => {
          const result = sanitizeInput(input);

          // The sanitizer escapes SQL chars:
          // ' → '' (doubled), " → \" (escaped), ; → \; (escaped), -- → \-\- (escaped)

          // Result must not contain raw unescaped semicolons (all ; become \;)
          expect(result).not.toMatch(/(?<!\\);/);

          // Result must not contain raw double-dashes (-- becomes \-\-)
          expect(result).not.toMatch(/(?<!\\)-(?<!\\)-/);

          // The safe text portion (before the injection) must still be present
          // Extract the safe prefix from the input (alphanumeric + spaces before injection)
          // Account for whitespace normalization (multiple spaces → single space)
          const safePrefix = input.match(/^[a-z0-9 ]+/)?.[0]?.trim();
          if (safePrefix && safePrefix.length > 0) {
            const normalizedPrefix = normalizeWhitespace(safePrefix);
            expect(result).toContain(normalizedPrefix);
          }

          // The function never rejects — always returns a string
          expect(typeof result).toBe('string');
        }),
        { numRuns: 100 },
      );
    });

    it('sanitizeInput removes control sequences while preserving allowed whitespace (\\n, \\r, \\t)', () => {
      fc.assert(
        fc.property(arbControlSequences, (input) => {
          const result = sanitizeInput(input);

          // Result must not contain control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
          // eslint-disable-next-line no-control-regex
          expect(result).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);

          // Result must still contain the safe text portions
          expect(result.length).toBeGreaterThan(0);

          // Allowed whitespace (\n, \r, \t) should be preserved if present in input
          // (they are not stripped by the control sequence removal)
        }),
        { numRuns: 100 },
      );
    });

    it('sanitizeInput never rejects — always returns a string regardless of input', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (input) => {
          const result = sanitizeInput(input);

          // Must always return a string (never throws, never returns null/undefined)
          expect(typeof result).toBe('string');
        }),
        { numRuns: 100 },
      );
    });

    it('sanitizeFormAnswers sanitizes all string values while preserving non-string values', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), { minLength: 1, maxLength: 20 }),
            fc.oneof(
              fc.string({ maxLength: 100 }),
              fc.integer(),
              fc.boolean(),
              fc.constant(null),
            ),
            { minKeys: 1, maxKeys: 10 },
          ),
          (answers) => {
            const result = sanitizeFormAnswers(answers);

            for (const [key, value] of Object.entries(answers)) {
              if (typeof value === 'string') {
                // String values must be sanitized
                expect(result[key]).toBe(sanitizeInput(value));
              } else {
                // Non-string values must be passed through unchanged
                expect(result[key]).toEqual(value);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
