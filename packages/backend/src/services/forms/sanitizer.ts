/**
 * Input sanitization and bot detection module for the Forms Service.
 *
 * Two concerns:
 * 1. Sanitization: strip HTML, escape SQL special chars, remove control sequences, normalize whitespace.
 *    Never rejects — always sanitizes and allows storage.
 * 2. Bot detection: validate headers, detect rapid submissions, honeypot field check.
 *
 * Requirements: 11.7, 15.3, 15.5
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum time (ms) between page load and submission to be considered human */
const MIN_SUBMISSION_TIME_MS = 2000;

// ─── Input Sanitization ───────────────────────────────────────────────────────

/**
 * Sanitizes a single string value by:
 * 1. Removing HTML tags (all `<...>` patterns)
 * 2. Escaping SQL special characters (', ", ;, --)
 * 3. Removing control sequences (chars below 0x20 except \n, \r, \t)
 * 4. Normalizing whitespace (collapse multiple spaces, trim)
 *
 * Does NOT reject — always returns a sanitized string.
 */
export function sanitizeInput(value: string): string {
  let result = value;

  // 1. Remove HTML tags
  result = result.replace(/<[^>]*>/g, '');

  // 2. Escape SQL special characters
  result = result
    .replace(/'/g, "''")
    .replace(/"/g, '\\"')
    .replace(/;/g, '\\;')
    .replace(/--/g, '\\-\\-');

  // 3. Remove control sequences (chars below 0x20 except \n \r \t)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 4. Normalize whitespace: collapse multiple spaces into one, then trim
  result = result.replace(/[^\S\n\r\t]+/g, ' ').trim();

  return result;
}

/**
 * Sanitizes all string values in a form answers record.
 * Non-string values are passed through unchanged.
 * Nested objects/arrays are not deeply sanitized — only top-level string values.
 */
export function sanitizeFormAnswers(
  answers: Record<string, unknown>
): Record<string, unknown> {
  // Object.create(null) instead of {} -- a field literally named "__proto__"
  // (a valid form field key, and exactly the kind of value a property-based
  // test explores) silently vanishes on a plain object: `sanitized[key] = v`
  // with key === '__proto__' invokes the inherited setter rather than
  // creating an own property, so a later read returns Object.prototype
  // instead of the sanitized value. A null-prototype object has no such
  // special-cased key.
  const sanitized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (Array.isArray(value)) {
      // Handle arrays (e.g., seleccion_multiple values)
      sanitized[key] = value.map((item) =>
        typeof item === 'string' ? sanitizeInput(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ─── Bot Detection ────────────────────────────────────────────────────────────

export interface BotDetectionParams {
  /** User-Agent header value */
  userAgent?: string;
  /** Origin header value */
  origin?: string;
  /** Referer header value */
  referer?: string;
  /** Value of the hidden honeypot field */
  honeypotValue?: string;
  /** Timestamp (epoch ms) when the page was loaded */
  pageLoadTimestamp?: number;
  /** Timestamp (epoch ms) when the form was submitted */
  submissionTimestamp?: number;
}

export interface BotDetectionResult {
  isBot: boolean;
  reason?: string;
}

/**
 * Detects bot-like behavior based on:
 * - Missing or empty User-Agent header
 * - Missing Origin and Referer headers simultaneously
 * - Rapid submission (< 2 seconds from page load)
 * - Honeypot field containing a value (bots fill hidden fields)
 *
 * Returns { isBot: true, reason } if bot detected, { isBot: false } otherwise.
 */
export function detectBot(params: BotDetectionParams): BotDetectionResult {
  const {
    userAgent,
    origin,
    referer,
    honeypotValue,
    pageLoadTimestamp,
    submissionTimestamp,
  } = params;

  // Check honeypot field — if filled, it's a bot
  if (honeypotValue !== undefined && honeypotValue !== null && honeypotValue !== '') {
    return { isBot: true, reason: 'honeypot_filled' };
  }

  // Check User-Agent presence
  if (!userAgent || userAgent.trim() === '') {
    return { isBot: true, reason: 'missing_user_agent' };
  }

  // Check Origin and Referer — both missing is suspicious
  if ((!origin || origin.trim() === '') && (!referer || referer.trim() === '')) {
    return { isBot: true, reason: 'missing_origin_and_referer' };
  }

  // Check rapid submission (< 2 seconds from page load)
  if (
    pageLoadTimestamp !== undefined &&
    submissionTimestamp !== undefined &&
    submissionTimestamp - pageLoadTimestamp < MIN_SUBMISSION_TIME_MS
  ) {
    return { isBot: true, reason: 'rapid_submission' };
  }

  return { isBot: false };
}
