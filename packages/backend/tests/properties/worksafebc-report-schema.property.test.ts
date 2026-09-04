/**
 * Property tests for the Reporte_Cumplimiento schema/parser/pretty-printer.
 *
 * Property 10 (12.2): round-trip is byte-identical — the flagship property.
 * Property 11 (12.3): parser reports every violation with field/kind/value.
 *
 * Validates: Requirements 8.3, 8.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseReporteCumplimiento,
  prettyPrintReporteCumplimiento,
  type ParseResult,
} from '../../src/services/report-validation/report-schema.js';
import {
  MAX_FINDINGS,
  MAX_RECOMMENDATIONS,
  MAX_EXECUTIVE_SUMMARY_CHARS,
  MAX_FINDING_DESCRIPTION_CHARS,
  MAX_RECOMMENDATION_CHARS,
  type ReporteCumplimiento,
} from '../../src/services/report-validation/worksafebc-types.js';

// A generator of valid ReporteCumplimiento objects respecting every cap.
const severityArb = fc.constantFrom('critica', 'alta', 'media', 'baja');

const brechaArb = fc.record({
  finding_id: fc.uuid(),
  type: fc.constant('brecha' as const),
  severity: severityArb,
  description: fc.string({ maxLength: MAX_FINDING_DESCRIPTION_CHARS }),
  regulatory_basis: fc.string(),
  regulation_part: fc.string(),
  evidence_excerpt: fc.option(fc.string(), { nil: null }),
});

const conformeArb = fc.record({
  finding_id: fc.uuid(),
  type: fc.constant('conforme' as const),
  severity: fc.constant(null),
  description: fc.string({ maxLength: MAX_FINDING_DESCRIPTION_CHARS }),
  regulatory_basis: fc.string(),
  regulation_part: fc.string(),
  evidence_excerpt: fc.option(fc.string(), { nil: null }),
});

const reportArb: fc.Arbitrary<ReporteCumplimiento> = fc.record({
  compliance_level: fc.constantFrom(
    'conforme',
    'parcialmente_conforme',
    'no_conforme',
    'no_evaluable'
  ),
  executive_summary: fc.string({ maxLength: MAX_EXECUTIVE_SUMMARY_CHARS }),
  findings: fc.array(fc.oneof(brechaArb, conformeArb), { maxLength: MAX_FINDINGS }),
  recommendations: fc.array(fc.string({ maxLength: MAX_RECOMMENDATION_CHARS }), {
    maxLength: MAX_RECOMMENDATIONS,
  }),
  category: fc.constantFrom(
    'plan_seguridad',
    'procedimiento_trabajo_seguro',
    'evaluacion_riesgo',
    'formulario_contratista',
    'otro'
  ),
  ai_model_version: fc.string(),
  regulatory_kb_version_id: fc.string(),
  generated_at: fc.date().map((d) => d.toISOString()),
}) as fc.Arbitrary<ReporteCumplimiento>;

describe('Property 10: pretty-print round-trip is byte-identical', () => {
  it('prettyPrint(parse(prettyPrint(x))) === prettyPrint(x)', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const once = prettyPrintReporteCumplimiento(report);
        const parsed: ParseResult = parseReporteCumplimiento(once);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          const twice = prettyPrintReporteCumplimiento(parsed.report);
          expect(twice).toBe(once); // byte-identical
        }
      }),
      { numRuns: 300 }
    );
  });

  it('a valid report always parses back successfully', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const res = parseReporteCumplimiento(prettyPrintReporteCumplimiento(report));
        expect(res.ok).toBe(true);
      })
    );
  });
});

describe('Property 11: parser reports violations with precise diagnostics', () => {
  it('rejects non-JSON input as malformed', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        (garbage) => {
          const res = parseReporteCumplimiento(garbage);
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.errors[0]?.kind).toBe('malformed');
          }
        }
      )
    );
  });

  it('names the missing field when a required key is absent', () => {
    fc.assert(
      fc.property(
        reportArb,
        fc.constantFrom(
          'compliance_level',
          'executive_summary',
          'findings',
          'recommendations',
          'category'
        ),
        (report, keyToDrop) => {
          const obj = { ...report } as Record<string, unknown>;
          delete obj[keyToDrop];
          const res = parseReporteCumplimiento(JSON.stringify(obj));
          expect(res.ok).toBe(false);
          if (!res.ok) {
            const hit = res.errors.find((e) => e.field === keyToDrop);
            expect(hit).toBeDefined();
            expect(hit?.kind).toBe('missing');
          }
        }
      )
    );
  });

  it('flags out-of-range when a string exceeds its cap', () => {
    const base: ReporteCumplimiento = {
      compliance_level: 'conforme',
      executive_summary: 'x'.repeat(MAX_EXECUTIVE_SUMMARY_CHARS + 1),
      findings: [],
      recommendations: [],
      category: 'otro',
      ai_model_version: 'v1',
      regulatory_kb_version_id: '000001',
      generated_at: new Date().toISOString(),
    };
    const res = parseReporteCumplimiento(JSON.stringify(base));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const hit = res.errors.find((e) => e.field === 'executive_summary');
      expect(hit?.kind).toBe('out_of_range');
    }
  });
});
