/**
 * Unit tests for worker name data-hygiene sanitization in the Identity Service.
 *
 * Verifies that `createWorkerSchema` / `updateWorkerSchema` trim surrounding
 * whitespace and strip a single pair of wrapping quote characters (straight and
 * curly) from `legal_name` / `preferred_name` before the value is persisted,
 * while preserving legitimate interior quotes and apostrophes (e.g. O'Brien).
 *
 * This is defensive data-quality hygiene (Bug 13 / bugfix condition 13:
 * legal_name must NOT match /^".*"$/ after the fix), NOT XSS sanitization.
 *
 * Requirements: 6.3
 */

import { describe, it, expect } from 'vitest';
import { createWorkerSchema, updateWorkerSchema } from '../worker.js';

const baseCreateInput = {
  phone: '+14155552671',
  language_preference: 'en',
};

/** Parses through createWorkerSchema and returns the sanitized legal_name. */
function parsedLegalName(rawLegalName: string): string {
  const result = createWorkerSchema.safeParse({ ...baseCreateInput, legal_name: rawLegalName });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('expected parse to succeed');
  return result.data.legal_name;
}

describe('worker name sanitization — createWorkerSchema.legal_name', () => {
  it('trims leading and trailing whitespace', () => {
    expect(parsedLegalName('  Jane Doe  ')).toBe('Jane Doe');
  });

  it('strips a single pair of wrapping straight double quotes', () => {
    expect(parsedLegalName('"Test"')).toBe('Test');
  });

  it('strips a single pair of wrapping straight single quotes', () => {
    expect(parsedLegalName("'Test'")).toBe('Test');
  });

  it('strips wrapping straight quotes even with surrounding whitespace', () => {
    expect(parsedLegalName('  "Jane Doe"  ')).toBe('Jane Doe');
  });

  it('strips a single pair of wrapping curly double quotes', () => {
    expect(parsedLegalName('\u201CTest\u201D')).toBe('Test');
  });

  it('strips a single pair of wrapping curly single quotes', () => {
    expect(parsedLegalName('\u2018Test\u2019')).toBe('Test');
  });

  it('does NOT strip a legitimate interior apostrophe (O\u2019Brien)', () => {
    expect(parsedLegalName("O'Brien")).toBe("O'Brien");
  });

  it('does NOT strip interior quotes (5\'10")', () => {
    expect(parsedLegalName('5\'10"')).toBe('5\'10"');
  });

  it('does NOT strip a mismatched leading/trailing quote pair', () => {
    // Opens with straight double quote but closes with a curly one -> not a pair.
    expect(parsedLegalName('"Test\u201D')).toBe('"Test\u201D');
  });

  it('only removes the outermost pair, preserving an inner quoted segment', () => {
    expect(parsedLegalName('"He said "hi""')).toBe('He said "hi"');
  });

  it('guarantees bug-condition 13: result never matches /^".*"$/', () => {
    expect(parsedLegalName('"Test"')).not.toMatch(/^".*"$/);
  });
});

describe('worker name sanitization — createWorkerSchema.preferred_name', () => {
  it('trims and strips wrapping quotes from preferred_name', () => {
    const result = createWorkerSchema.safeParse({
      ...baseCreateInput,
      legal_name: 'Jane Doe',
      preferred_name: '  "Janie"  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferred_name).toBe('Janie');
    }
  });

  it('preserves an interior apostrophe in preferred_name', () => {
    const result = createWorkerSchema.safeParse({
      ...baseCreateInput,
      legal_name: 'Jane Doe',
      preferred_name: "D'Angelo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferred_name).toBe("D'Angelo");
    }
  });
});

describe('worker name sanitization — updateWorkerSchema', () => {
  it('trims and strips wrapping quotes from legal_name on update', () => {
    const result = updateWorkerSchema.safeParse({ legal_name: '  "Updated Name"  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.legal_name).toBe('Updated Name');
      expect(result.data.legal_name).not.toMatch(/^".*"$/);
    }
  });

  it('preserves interior apostrophe on update', () => {
    const result = updateWorkerSchema.safeParse({ preferred_name: "O'Brien" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferred_name).toBe("O'Brien");
    }
  });
});
