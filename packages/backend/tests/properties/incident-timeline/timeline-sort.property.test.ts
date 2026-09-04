// Feature: incident-timeline, Property 6: Orden cronológico descendente de la línea de tiempo

/**
 * Property-based test for descending chronological order in the document timeline.
 *
 * Property 6: For any array of active linked documents, when presented in timeline view,
 * the order SHALL be descending by `response_submitted_at`. For every consecutive pair (a, b),
 * `a.response_submitted_at >= b.response_submitted_at`.
 *
 * **Validates: Requirements 3.1**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { LinkedDocumentRecord, DocumentCategory } from '../../../src/services/incidents/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES: DocumentCategory[] = [
  'investigacion',
  'accion_correctiva',
  'inspeccion',
  'declaracion_testigo',
  'reporte_seguimiento',
  'otro',
];

// ─── Pure logic under test ────────────────────────────────────────────────────

/**
 * Sorts linked documents in descending order by response_submitted_at.
 * This replicates the logic used in DocumentTimelineView.tsx (useMemo sorting).
 */
function sortTimelineDescending(documents: LinkedDocumentRecord[]): LinkedDocumentRecord[] {
  return [...documents].sort(
    (a, b) =>
      new Date(b.response_submitted_at).getTime() -
      new Date(a.response_submitted_at).getTime()
  );
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid ISO 8601 date string within a reasonable range */
const arbISODate = fc
  .integer({ min: 1609459200000, max: 1767225600000 }) // 2021-01-01 to 2025-12-31
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for a LinkedDocumentRecord (active — no unlinked_at) */
const arbLinkedDocumentRecord: fc.Arbitrary<LinkedDocumentRecord> = fc.record({
  link_id: fc.uuid(),
  incident_id: fc.uuid(),
  tenant_id: fc.uuid(),
  response_id: fc.uuid(),
  form_id: fc.uuid(),
  document_category: fc.constantFrom(...VALID_CATEGORIES),
  custom_category_description: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: undefined }),
  context_note: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
  linked_by: fc.uuid(),
  linked_by_name: fc.string({ minLength: 1, maxLength: 50 }),
  linked_at: arbISODate,
  form_name: fc.string({ minLength: 1, maxLength: 80 }),
  folio: fc.stringMatching(/^[A-Z0-9-]{3,15}$/),
  response_submitted_at: arbISODate,
  response_submitted_by: fc.string({ minLength: 1, maxLength: 50 }),
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 6: Descending chronological order of timeline', () => {
  // **Validates: Requirements 3.1**
  it('sorted documents SHALL have every consecutive pair (a, b) where a.response_submitted_at >= b.response_submitted_at', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 50 }),
        (documents) => {
          const sorted = sortTimelineDescending(documents);

          // Verify descending order: each consecutive pair must satisfy a >= b
          for (let i = 0; i < sorted.length - 1; i++) {
            const aTime = new Date(sorted[i].response_submitted_at).getTime();
            const bTime = new Date(sorted[i + 1].response_submitted_at).getTime();
            expect(aTime).toBeGreaterThanOrEqual(bTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 3.1**
  it('sorted output SHALL contain exactly the same elements as the input (no loss or duplication)', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 50 }),
        (documents) => {
          const sorted = sortTimelineDescending(documents);

          // Same length
          expect(sorted.length).toBe(documents.length);

          // Same set of link_ids
          const inputIds = documents.map((d) => d.link_id).sort();
          const sortedIds = sorted.map((d) => d.link_id).sort();
          expect(sortedIds).toEqual(inputIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 3.1**
  it('sorting is idempotent: sorting an already-sorted array produces the same order', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 30 }),
        (documents) => {
          const sorted1 = sortTimelineDescending(documents);
          const sorted2 = sortTimelineDescending(sorted1);

          // Same order of link_ids
          const ids1 = sorted1.map((d) => d.link_id);
          const ids2 = sorted2.map((d) => d.link_id);
          expect(ids2).toEqual(ids1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
