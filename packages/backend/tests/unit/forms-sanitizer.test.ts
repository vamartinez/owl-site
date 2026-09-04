/**
 * Unit tests for the Forms Sanitizer Module.
 * Tests input sanitization (HTML removal, SQL escaping, control char removal, whitespace normalization)
 * and bot detection (User-Agent, Origin/Referer, rapid submission, honeypot).
 *
 * Requirements: 11.7, 15.3, 15.5
 */

import { describe, it, expect } from 'vitest';
import { sanitizeInput, sanitizeFormAnswers, detectBot } from '../../src/services/forms/sanitizer.js';

describe('forms: sanitizer module', () => {
  describe('sanitizeInput', () => {
    it('removes HTML tags from input', () => {
      expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert(\\"xss\\")');
      expect(sanitizeInput('<b>bold</b> text')).toBe('bold text');
      expect(sanitizeInput('<img src="x" onerror="alert(1)">')).toBe('');
      expect(sanitizeInput('Hello <a href="http://evil.com">click</a> world')).toBe('Hello click world');
    });

    it('escapes SQL special characters', () => {
      expect(sanitizeInput("O'Reilly")).toBe("O''Reilly");
      expect(sanitizeInput('value"test')).toBe('value\\"test');
      expect(sanitizeInput('DROP TABLE;')).toBe('DROP TABLE\\;');
      expect(sanitizeInput('1 -- comment')).toBe('1 \\-\\- comment');
    });

    it('removes control sequences except \\n, \\r, \\t', () => {
      // Null byte and other control chars should be removed
      expect(sanitizeInput('hello\x00world')).toBe('helloworld');
      expect(sanitizeInput('test\x01\x02\x03value')).toBe('testvalue');
      expect(sanitizeInput('line\x0Ebreak')).toBe('linebreak');

      // \n, \r, \t should be preserved
      expect(sanitizeInput('line1\nline2')).toBe('line1\nline2');
      expect(sanitizeInput('col1\tcol2')).toBe('col1\tcol2');
      expect(sanitizeInput('text\r\nmore')).toBe('text\r\nmore');
    });

    it('normalizes whitespace (collapses multiple spaces, trims)', () => {
      expect(sanitizeInput('  hello   world  ')).toBe('hello world');
      expect(sanitizeInput('multiple     spaces')).toBe('multiple spaces');
      expect(sanitizeInput('   leading')).toBe('leading');
      expect(sanitizeInput('trailing   ')).toBe('trailing');
    });

    it('preserves safe content unchanged (except trim)', () => {
      expect(sanitizeInput('Juan Pérez')).toBe('Juan Pérez');
      expect(sanitizeInput('Empresa ABC 123')).toBe('Empresa ABC 123');
      expect(sanitizeInput('correo@ejemplo.com')).toBe('correo@ejemplo.com');
    });

    it('handles empty string', () => {
      expect(sanitizeInput('')).toBe('');
    });

    it('handles combined attack patterns', () => {
      const malicious = `<script>alert('xss')</script>; DROP TABLE users--`;
      const result = sanitizeInput(malicious);
      // Should not contain HTML tags
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      // SQL chars should be escaped
      expect(result).not.toMatch(/(?<!\\);/);
      expect(result).not.toMatch(/(?<!\\-)--/);
    });
  });

  describe('sanitizeFormAnswers', () => {
    it('sanitizes all string values in answers', () => {
      const answers = {
        field1: '<b>bold</b> text',
        field2: "O'Reilly",
        field3: 'clean value',
      };

      const result = sanitizeFormAnswers(answers);

      expect(result.field1).toBe('bold text');
      expect(result.field2).toBe("O''Reilly");
      expect(result.field3).toBe('clean value');
    });

    it('passes non-string values through unchanged', () => {
      const answers = {
        text_field: 'hello',
        number_field: 42,
        boolean_field: true,
        null_field: null,
      };

      const result = sanitizeFormAnswers(answers);

      expect(result.number_field).toBe(42);
      expect(result.boolean_field).toBe(true);
      expect(result.null_field).toBeNull();
    });

    it('sanitizes string items in arrays', () => {
      const answers = {
        multi_select: ['<b>Option A</b>', 'Option B', "Option C's"],
      };

      const result = sanitizeFormAnswers(answers);

      expect(result.multi_select).toEqual(['Option A', 'Option B', "Option C''s"]);
    });

    it('handles empty answers object', () => {
      expect(sanitizeFormAnswers({})).toEqual({});
    });
  });

  describe('detectBot', () => {
    it('detects bot when honeypot field is filled', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
        referer: 'https://example.com/forms/abc',
        honeypotValue: 'spam content',
      });

      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('honeypot_filled');
    });

    it('does not flag when honeypot is empty string', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
        referer: 'https://example.com/forms/abc',
        honeypotValue: '',
      });

      expect(result.isBot).toBe(false);
    });

    it('detects bot when User-Agent is missing', () => {
      const result = detectBot({
        origin: 'https://example.com',
        referer: 'https://example.com/forms/abc',
      });

      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('missing_user_agent');
    });

    it('detects bot when User-Agent is empty/whitespace', () => {
      const result = detectBot({
        userAgent: '   ',
        origin: 'https://example.com',
        referer: 'https://example.com/forms/abc',
      });

      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('missing_user_agent');
    });

    it('detects bot when both Origin and Referer are missing', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
      });

      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('missing_origin_and_referer');
    });

    it('does not flag when only Origin is present', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
      });

      expect(result.isBot).toBe(false);
    });

    it('does not flag when only Referer is present', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        referer: 'https://example.com/forms/abc',
      });

      expect(result.isBot).toBe(false);
    });

    it('detects rapid submission (< 2 seconds from page load)', () => {
      const pageLoad = Date.now();
      const submission = pageLoad + 1500; // 1.5 seconds

      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
        pageLoadTimestamp: pageLoad,
        submissionTimestamp: submission,
      });

      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('rapid_submission');
    });

    it('does not flag submission at exactly 2 seconds', () => {
      const pageLoad = Date.now();
      const submission = pageLoad + 2000; // exactly 2 seconds

      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
        pageLoadTimestamp: pageLoad,
        submissionTimestamp: submission,
      });

      expect(result.isBot).toBe(false);
    });

    it('does not flag submission after 2 seconds', () => {
      const pageLoad = Date.now();
      const submission = pageLoad + 5000; // 5 seconds

      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
        pageLoadTimestamp: pageLoad,
        submissionTimestamp: submission,
      });

      expect(result.isBot).toBe(false);
    });

    it('returns isBot: false for legitimate request', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        origin: 'https://app.sytedocs.com',
        referer: 'https://app.sytedocs.com/forms/abc-123',
        honeypotValue: '',
        pageLoadTimestamp: Date.now() - 30000,
        submissionTimestamp: Date.now(),
      });

      expect(result.isBot).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('prioritizes honeypot check over other checks', () => {
      // Even with valid headers, honeypot filled = bot
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
        referer: 'https://example.com/forms/abc',
        honeypotValue: 'filled by bot',
        pageLoadTimestamp: Date.now() - 30000,
        submissionTimestamp: Date.now(),
      });

      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('honeypot_filled');
    });

    it('skips timing check when timestamps are not provided', () => {
      const result = detectBot({
        userAgent: 'Mozilla/5.0',
        origin: 'https://example.com',
      });

      expect(result.isBot).toBe(false);
    });
  });
});
