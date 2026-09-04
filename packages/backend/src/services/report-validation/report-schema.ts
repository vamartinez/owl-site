/**
 * WorkSafeBC Reporte_Cumplimiento — standalone JSON schema, parser, and
 * pretty-printer. PURE module: no AWS SDK imports, independently testable.
 *
 * Implements Requirement 8:
 *  - 8.1: schema matches the report field list + all caps
 *  - 8.2: parse completes within 5s for inputs up to 10MB (bounded work only)
 *  - 8.3: every violation reported with field name, kind, and offending value
 *  - 8.4: reject non-JSON or >10MB input immediately, before schema validation
 *  - 8.5: pretty-print = 2-space indent, alphabetically-sorted keys, UTF-8
 *  - 8.6: prettyPrint(parse(prettyPrint(x))) is byte-identical to prettyPrint(x)
 */

import { z } from 'zod';
import {
  MAX_FINDINGS,
  MAX_RECOMMENDATIONS,
  MAX_EXECUTIVE_SUMMARY_CHARS,
  MAX_FINDING_DESCRIPTION_CHARS,
  MAX_RECOMMENDATION_CHARS,
  MAX_REPORT_JSON_BYTES,
  DOCUMENT_CATEGORIES,
  FINDING_SEVERITIES,
  type ReporteCumplimiento,
} from './worksafebc-types.js';

// ---------------------------------------------------------------------------
// Zod schema (Requirement 8.1)
// ---------------------------------------------------------------------------

const severitySchema = z.enum(
  FINDING_SEVERITIES as unknown as [string, ...string[]]
);

const hallazgoSchema = z
  .object({
    finding_id: z.string().min(1),
    type: z.enum(['brecha', 'conforme']),
    severity: severitySchema.nullable(),
    description: z.string().max(MAX_FINDING_DESCRIPTION_CHARS),
    regulatory_basis: z.string(),
    regulation_part: z.string(),
    evidence_excerpt: z.string().nullable(),
  })
  .strict()
  // A 'brecha' must carry a severity; a 'conforme' must not.
  .refine((f) => (f.type === 'brecha' ? f.severity !== null : f.severity === null), {
    message: "severity must be set for 'brecha' findings and null for 'conforme'",
    path: ['severity'],
  });

export const ReporteCumplimientoSchema = z
  .object({
    compliance_level: z.enum([
      'conforme',
      'parcialmente_conforme',
      'no_conforme',
      'no_evaluable',
    ]),
    executive_summary: z.string().max(MAX_EXECUTIVE_SUMMARY_CHARS),
    findings: z.array(hallazgoSchema).max(MAX_FINDINGS),
    recommendations: z
      .array(z.string().max(MAX_RECOMMENDATION_CHARS))
      .max(MAX_RECOMMENDATIONS),
    category: z.enum(DOCUMENT_CATEGORIES as unknown as [string, ...string[]]),
    ai_model_version: z.string(),
    regulatory_kb_version_id: z.string(),
    generated_at: z.string(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Parser (Requirements 8.2, 8.3, 8.4)
// ---------------------------------------------------------------------------

export interface SchemaError {
  field: string; // dot-path to the offending field
  kind: 'missing' | 'wrong_type' | 'out_of_range' | 'invalid_value' | 'malformed';
  value?: unknown; // offending value where available
  message: string;
}

export type ParseResult =
  | { ok: true; report: ReporteCumplimiento }
  | { ok: false; errors: SchemaError[] };

/** Map a Zod issue to our field/kind/value diagnostic (Requirement 8.3). */
function toSchemaError(issue: z.ZodIssue): SchemaError {
  const field = issue.path.length ? issue.path.join('.') : '(root)';
  let kind: SchemaError['kind'] = 'invalid_value';
  switch (issue.code) {
    case 'invalid_type':
      kind = issue.received === 'undefined' ? 'missing' : 'wrong_type';
      break;
    case 'too_big':
    case 'too_small':
      kind = 'out_of_range';
      break;
    case 'unrecognized_keys':
      kind = 'invalid_value';
      break;
    default:
      kind = 'invalid_value';
  }
  const err: SchemaError = { field, kind, message: issue.message };
  if ('received' in issue && issue.received !== undefined) {
    err.value = issue.received;
  }
  return err;
}

/**
 * Parse + validate a serialized Reporte_Cumplimiento.
 * Rejects non-JSON or oversized input BEFORE schema validation (8.4).
 */
export function parseReporteCumplimiento(json: string): ParseResult {
  // 8.4: size guard first — measure UTF-8 byte length, not char length.
  const byteLen =
    typeof Buffer !== 'undefined'
      ? Buffer.byteLength(json, 'utf8')
      : new TextEncoder().encode(json).length;
  if (byteLen > MAX_REPORT_JSON_BYTES) {
    return {
      ok: false,
      errors: [
        {
          field: '(root)',
          kind: 'malformed',
          message: `input exceeds ${MAX_REPORT_JSON_BYTES} bytes`,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      errors: [{ field: '(root)', kind: 'malformed', message: 'input is not valid JSON' }],
    };
  }

  const result = ReporteCumplimientoSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map(toSchemaError) };
  }
  return { ok: true, report: result.data as ReporteCumplimiento };
}

// ---------------------------------------------------------------------------
// Pretty-printer (Requirements 8.5, 8.6)
// ---------------------------------------------------------------------------

/**
 * Recursively sort object keys alphabetically. Arrays keep their order
 * (finding/recommendation order is semantically meaningful and preserved).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic serialization: 2-space indent, alphabetically-sorted keys,
 * UTF-8. Byte-stable so the round-trip property (8.6) holds.
 */
export function prettyPrintReporteCumplimiento(report: ReporteCumplimiento): string {
  return JSON.stringify(sortKeysDeep(report), null, 2);
}
