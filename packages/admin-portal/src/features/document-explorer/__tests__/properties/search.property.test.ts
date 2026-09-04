// Feature: document-explorer, Property 8: Case-insensitive partial name matching
// Feature: document-explorer, Property 9: Search trigger minimum length gate

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { matchesSearchTerm, isSearchTermValid } from '../../utils';

describe('Property 8: Case-insensitive partial name matching', () => {
  // **Validates: Requirements 4.1**

  it('returns true for any contiguous substring of the document name regardless of case', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.length > 0),
        fc.nat(),
        fc.nat(),
        (documentName, startOffset, lengthOffset) => {
          // Extract a valid substring from the document name
          const start = startOffset % documentName.length;
          const maxLen = documentName.length - start;
          const len = maxLen === 0 ? 1 : (lengthOffset % maxLen) + 1;
          const substring = documentName.slice(start, start + len);

          // Randomize case of the substring
          const randomCaseSubstring = substring
            .split('')
            .map((ch) => (Math.random() > 0.5 ? ch.toUpperCase() : ch.toLowerCase()))
            .join('');

          expect(matchesSearchTerm(documentName, randomCaseSubstring)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns true when document name and search term differ only in case', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (name) => {
          expect(matchesSearchTerm(name, name.toUpperCase())).toBe(true);
          expect(matchesSearchTerm(name, name.toLowerCase())).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false for strings that are not substrings of the document name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-z]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[0-9]+$/.test(s)),
        (documentName, nonSubstring) => {
          // A purely numeric string cannot be a substring of a purely lowercase alpha string
          expect(matchesSearchTerm(documentName, nonSubstring)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 9: Search trigger minimum length gate', () => {
  // **Validates: Requirements 4.2, 4.7**

  it('returns true if and only if trimmed length is >= 2', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (term) => {
        const trimmedLength = term.trim().length;
        const result = isSearchTermValid(term);

        if (trimmedLength >= 2) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns false for strings with only whitespace regardless of length', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 20 }).map((n) => ' '.repeat(n)),
        (whitespaceOnly) => {
          // Trimmed length is 0, always less than 2
          expect(isSearchTermValid(whitespaceOnly)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns true for non-whitespace strings of length >= 2', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2, maxLength: 50 }).filter((s) => s.trim().length >= 2),
        (validTerm) => {
          expect(isSearchTermValid(validTerm)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false for single non-whitespace character with surrounding whitespace', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10 }),
        fc.char().filter((c) => c.trim().length === 1),
        fc.nat({ max: 10 }),
        (leadingSpaces, char, trailingSpaces) => {
          const term = ' '.repeat(leadingSpaces) + char + ' '.repeat(trailingSpaces);
          expect(isSearchTermValid(term)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
