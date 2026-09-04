/**
 * Zod schemas for common validations used across all backend services.
 * Provides reusable validators for E.164 phone, UUID, ISO 8601 timestamps, pagination, etc.
 */

import { z } from 'zod';

/**
 * E.164 phone number format: + followed by 1-15 digits.
 */
export const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g., +14155552671)');

/**
 * UUID v4 format.
 */
export const uuidSchema = z
  .string()
  .uuid('Must be a valid UUID');

/**
 * ISO 8601 UTC timestamp (e.g., 2024-01-15T10:30:00.000Z).
 */
export const iso8601TimestampSchema = z
  .string()
  .datetime({ message: 'Must be a valid ISO 8601 timestamp' });

/**
 * ISO 8601 date only (e.g., 2024-01-15).
 */
export const iso8601DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date in YYYY-MM-DD format')
  .refine((val) => !isNaN(Date.parse(val)), 'Must be a valid date');

/**
 * Pagination parameters for list endpoints.
 */
export const paginationSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
  cursor: z
    .string()
    .optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/**
 * Pagination from query string parameters (strings that need coercion).
 */
export const paginationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z
    .string()
    .optional(),
});

/**
 * Common ID parameter from path.
 */
export const idParamSchema = z.object({
  id: uuidSchema,
});

/**
 * Tenant ID validation.
 */
export const tenantIdSchema = uuidSchema;

/**
 * Email validation.
 */
export const emailSchema = z
  .string()
  .email('Must be a valid email address');

/**
 * Non-empty trimmed string with max length.
 */
export function boundedString(maxLength: number, fieldName?: string) {
  const name = fieldName ?? 'Field';
  return z
    .string()
    .trim()
    .min(1, `${name} is required`)
    .max(maxLength, `${name} must be at most ${maxLength} characters`);
}

/**
 * Trims surrounding whitespace and strips a single pair of matching wrapping
 * quote characters (straight `"` `'` or curly `“” ‘’`) from a free-text value.
 *
 * This is a data-hygiene helper, NOT XSS sanitization: it exists so a value
 * pasted from a JSON-like or quoted source (e.g. `"Test"`, quotes included) is
 * stored as `Test` rather than with the literal quote characters. Only one
 * outermost matching pair is removed, and only when the string both begins and
 * ends with a compatible quote. Interior quotes and apostrophes (e.g.
 * `O'Brien`, `5'10"`) are preserved.
 */
export function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  // Map each opening quote to the closing quote(s) that legitimately pair with it.
  const pairs: Record<string, string[]> = {
    '"': ['"'],
    "'": ["'"],
    '\u201C': ['\u201D'], // “ -> ”
    '\u2018': ['\u2019'], // ‘ -> ’
  };

  const first = trimmed[0]!;
  const last = trimmed[trimmed.length - 1]!;
  const closers = pairs[first];

  if (closers && closers.includes(last)) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

/**
 * A bounded free-text name field that also strips a single pair of wrapping
 * quote characters before validating length. Used for worker `legal_name` /
 * `preferred_name` so copy-pasted quoted values are stored cleanly.
 */
export function boundedNameString(maxLength: number, fieldName?: string) {
  const name = fieldName ?? 'Field';
  return z
    .string()
    .transform(stripWrappingQuotes)
    .pipe(
      z
        .string()
        .min(1, `${name} is required`)
        .max(maxLength, `${name} must be at most ${maxLength} characters`)
    );
}

/**
 * Optional variant of `boundedNameString`: strips wrapping quotes and enforces
 * a max length, but allows the field to be omitted entirely.
 *
 * A fully omitted field (`undefined`) is accepted. A value that is *explicitly*
 * provided but reduces to an empty string after trimming/quote-stripping is
 * rejected as required, matching the create-path behaviour — an explicit empty
 * string is a data-quality error, not a valid "unset" signal in this schema.
 */
export function optionalBoundedNameString(maxLength: number, fieldName?: string) {
  const name = fieldName ?? 'Field';
  return z
    .string()
    .transform(stripWrappingQuotes)
    .pipe(
      z
        .string()
        .min(1, `${name} is required`)
        .max(maxLength, `${name} must be at most ${maxLength} characters`)
    )
    .optional();
}

/**
 * Validates that a date string represents a future date.
 */
export const futureDateSchema = iso8601DateSchema.refine(
  (val) => new Date(val) > new Date(),
  'Date must be in the future'
);

/**
 * Validates file size in bytes.
 */
export function maxFileSizeSchema(maxBytes: number) {
  return z.number().max(maxBytes, `File size must not exceed ${Math.round(maxBytes / (1024 * 1024))} MB`);
}

/**
 * Validates allowed file MIME types.
 */
export function allowedMimeTypesSchema(allowedTypes: string[]) {
  return z.string().refine(
    (val) => allowedTypes.includes(val),
    `File type must be one of: ${allowedTypes.join(', ')}`
  );
}

/**
 * Confidence score between 0 and 1.
 */
export const confidenceScoreSchema = z
  .number()
  .min(0, 'Confidence must be at least 0')
  .max(1, 'Confidence must be at most 1');

/**
 * Severity level validation.
 */
export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);
