// Feature: contractor-forms-qr, Property 4: Validación de metadatos del formulario

/**
 * Property-based tests for form creation metadata validation.
 *
 * Property 4: For any string as form name, the system must accept it if and only if
 * it has between 3 and 200 characters and contains at least one non-space character.
 * For any string as description, the system must accept it if and only if it has
 * max 1000 characters.
 *
 * **Validates: Requirements 1.2, 1.3, 1.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateName, validateDescription } from '../../src/services/forms/form.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid form names: 3-200 chars with at least one non-space character */
const arbValidName = fc
  .tuple(
    fc.stringOf(fc.char(), { minLength: 3, maxLength: 200 }),
    fc.integer({ min: 0, max: 199 }),
  )
  .map(([base, insertPos]) => {
    // Ensure at least one non-space character
    if (base.trim().length === 0) {
      // Replace a character with a non-space
      const pos = Math.min(insertPos, base.length - 1);
      return base.substring(0, pos) + 'a' + base.substring(pos + 1);
    }
    return base;
  })
  .filter((name) => name.length >= 3 && name.length <= 200 && name.trim().length > 0);

/** Arbitrary for names that are too short (less than 3 characters) */
const arbTooShortName = fc.stringOf(fc.char(), { minLength: 0, maxLength: 2 });

/** Arbitrary for names that are too long (more than 200 characters) */
const arbTooLongName = fc.stringOf(fc.char(), { minLength: 201, maxLength: 400 });

/** Arbitrary for names that are only spaces (3-200 chars but all whitespace) */
const arbOnlySpacesName = fc
  .stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 3, maxLength: 200 });

/** Arbitrary for valid descriptions: 0-1000 characters */
const arbValidDescription = fc.string({ minLength: 0, maxLength: 1000 });

/** Arbitrary for invalid descriptions: more than 1000 characters */
const arbTooLongDescription = fc.string({ minLength: 1001, maxLength: 2000 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Forms Creation Property Tests', () => {
  // **Validates: Requirements 1.2, 1.3, 1.4**
  describe('Property 4: Validación de metadatos del formulario', () => {
    describe('Form name validation', () => {
      it('accepts any string with 3-200 characters that contains at least one non-space character', () => {
        fc.assert(
          fc.property(arbValidName, (name) => {
            const errors = validateName(name);
            expect(errors).toHaveLength(0);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects any string with fewer than 3 characters', () => {
        fc.assert(
          fc.property(arbTooShortName, (name) => {
            const errors = validateName(name);
            // Should have at least one error about length (or about being only spaces if empty)
            expect(errors.length).toBeGreaterThan(0);
            const hasLengthError = errors.some(
              (e) => e.field === 'name' && e.message.includes('3 caracteres'),
            );
            const hasEmptyError = errors.some(
              (e) => e.field === 'name' && e.message.includes('no-espacio'),
            );
            // Either too short or empty (all spaces)
            expect(hasLengthError || hasEmptyError).toBe(true);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects any string with more than 200 characters', () => {
        fc.assert(
          fc.property(arbTooLongName, (name) => {
            const errors = validateName(name);
            expect(errors.length).toBeGreaterThan(0);
            const hasLengthError = errors.some(
              (e) => e.field === 'name' && e.message.includes('200 caracteres'),
            );
            expect(hasLengthError).toBe(true);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects any string of 3-200 characters that contains only whitespace', () => {
        fc.assert(
          fc.property(arbOnlySpacesName, (name) => {
            const errors = validateName(name);
            expect(errors.length).toBeGreaterThan(0);
            const hasNonSpaceError = errors.some(
              (e) => e.field === 'name' && e.message.includes('no-espacio'),
            );
            expect(hasNonSpaceError).toBe(true);
          }),
          { numRuns: 100 },
        );
      });

      it('for any arbitrary string, accepts if and only if length is 3-200 and has non-space content', () => {
        fc.assert(
          fc.property(fc.string({ minLength: 0, maxLength: 400 }), (name) => {
            const errors = validateName(name);
            const isValidLength = name.length >= 3 && name.length <= 200;
            const hasNonSpace = name.trim().length > 0;
            const shouldBeValid = isValidLength && hasNonSpace;

            if (shouldBeValid) {
              expect(errors).toHaveLength(0);
            } else {
              expect(errors.length).toBeGreaterThan(0);
            }
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('Form description validation', () => {
      it('accepts any string with 1000 characters or fewer', () => {
        fc.assert(
          fc.property(arbValidDescription, (description) => {
            const errors = validateDescription(description);
            expect(errors).toHaveLength(0);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects any string with more than 1000 characters', () => {
        fc.assert(
          fc.property(arbTooLongDescription, (description) => {
            const errors = validateDescription(description);
            expect(errors.length).toBeGreaterThan(0);
            const hasLengthError = errors.some(
              (e) => e.field === 'description' && e.message.includes('1000 caracteres'),
            );
            expect(hasLengthError).toBe(true);
          }),
          { numRuns: 100 },
        );
      });

      it('for any arbitrary string, accepts if and only if length is at most 1000 characters', () => {
        fc.assert(
          fc.property(fc.string({ minLength: 0, maxLength: 2000 }), (description) => {
            const errors = validateDescription(description);
            const shouldBeValid = description.length <= 1000;

            if (shouldBeValid) {
              expect(errors).toHaveLength(0);
            } else {
              expect(errors.length).toBeGreaterThan(0);
            }
          }),
          { numRuns: 100 },
        );
      });
    });
  });
});
