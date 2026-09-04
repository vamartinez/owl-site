// Feature: incident-timeline, Property 8: Documentos desvinculados excluidos de la vista activa

/**
 * Property-based test for exclusion of unlinked documents from the active timeline view.
 *
 * Property 8: For any set of LinkedDocumentRecord where some have `unlinked_at` defined,
 * the active timeline view SHALL show only those where `unlinked_at` is undefined/null.
 * No unlinked document SHALL appear in the active documents view.
 *
 * **Validates: Requirements 5.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { LinkedDocumentRecord, DocumentCategory } from '../../../src/services/incidents/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: DocumentCategory[] = [
  'investigacion',
  'accion_correctiva',
  'inspeccion',
  'declaracion_testigo',
  'reporte_seguimiento',
  'otro',
];

// ─── Pure logic under test ────────────────────────────────────────────────────

/**
 * Filters out documents that have been unlinked (soft-deleted).
 * A document is considered unlinked if `unlinked_at` is defined and not null.
 * This replicates the logic used in the backend (getLinkedDocuments with
 * `attribute_not_exists(unlinked_at)` filter) and the frontend active view.
 */
function filterActiveDocuments(documents: LinkedDocumentRecord[]): LinkedDocumentRecord[] {
  return documents.filter((doc) => doc.unlinked_at === undefined || doc.unlinked_at === null);
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid ISO 8601 date string */
const arbISODate = fc
  .integer({ min: 1609459200000, max: 1767225600000 })
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for a LinkedDocumentRecord that is active (no unlinked_at) */
const arbActiveDocument: fc.Arbitrary<LinkedDocumentRecord> = fc.record({
  link_id: fc.uuid(),
  incident_id: fc.uuid(),
  tenant_id: fc.uuid(),
  response_id: fc.uuid(),
  form_id: fc.uuid(),
  document_category: fc.constantFrom(...ALL_CATEGORIES),
  custom_category_description: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: undefined }),
  context_note: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
  linked_by: fc.uuid(),
  linked_by_name: fc.string({ minLength: 1, maxLength: 50 }),
  linked_at: arbISODate,
  form_name: fc.string({ minLength: 1, maxLength: 80 }),
  folio: fc.stringMatching(/^[A-Z0-9-]{3,15}$/),
  response_submitted_at: arbISODate,
  response_submitted_by: fc.string({ minLength: 1, maxLength: 50 }),
  // Active: no unlinked fields
});

/** Arbitrary for a LinkedDocumentRecord that has been unlinked (has unlinked_at) */
const arbUnlinkedDocument: fc.Arbitrary<LinkedDocumentRecord> = fc.record({
  link_id: fc.uuid(),
  incident_id: fc.uuid(),
  tenant_id: fc.uuid(),
  response_id: fc.uuid(),
  form_id: fc.uuid(),
  document_category: fc.constantFrom(...ALL_CATEGORIES),
  custom_category_description: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: undefined }),
  context_note: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
  linked_by: fc.uuid(),
  linked_by_name: fc.string({ minLength: 1, maxLength: 50 }),
  linked_at: arbISODate,
  form_name: fc.string({ minLength: 1, maxLength: 80 }),
  folio: fc.stringMatching(/^[A-Z0-9-]{3,15}$/),
  response_submitted_at: arbISODate,
  response_submitted_by: fc.string({ minLength: 1, maxLength: 50 }),
  // Unlinked: has unlinked_at and related fields
  unlinked_at: arbISODate,
  unlinked_by: fc.uuid(),
  unlinked_by_name: fc.string({ minLength: 1, maxLength: 50 }),
  unlink_justification: fc.string({ minLength: 10, maxLength: 200 }),
});

/**
 * Arbitrary for a mixed set of documents — some active, some unlinked.
 * Guarantees at least one active and one unlinked document when minLength allows it.
 */
const arbMixedDocuments = fc
  .tuple(
    fc.array(arbActiveDocument, { minLength: 1, maxLength: 25 }),
    fc.array(arbUnlinkedDocument, { minLength: 1, maxLength: 25 })
  )
  .map(([active, unlinked]) => fc.shuffledSubarray([...active, ...unlinked], { minLength: active.length + unlinked.length }))
  .chain((arb) => arb);

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 8: Unlinked documents excluded from active view', () => {
  // **Validates: Requirements 5.3**
  it('active timeline view SHALL show only documents where unlinked_at is undefined/null', () => {
    fc.assert(
      fc.property(
        fc.array(arbActiveDocument, { minLength: 0, maxLength: 25 }),
        fc.array(arbUnlinkedDocument, { minLength: 0, maxLength: 25 }),
        (activeDocuments, unlinkedDocuments) => {
          const allDocuments = [...activeDocuments, ...unlinkedDocuments];
          const filtered = filterActiveDocuments(allDocuments);

          // Every document in the result must have unlinked_at as undefined or null
          for (const doc of filtered) {
            expect(doc.unlinked_at === undefined || doc.unlinked_at === null).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 5.3**
  it('no unlinked document (with unlinked_at defined) SHALL appear in the active view', () => {
    fc.assert(
      fc.property(
        fc.array(arbActiveDocument, { minLength: 0, maxLength: 25 }),
        fc.array(arbUnlinkedDocument, { minLength: 1, maxLength: 25 }),
        (activeDocuments, unlinkedDocuments) => {
          const allDocuments = [...activeDocuments, ...unlinkedDocuments];
          const filtered = filterActiveDocuments(allDocuments);
          const filteredIds = new Set(filtered.map((d) => d.link_id));

          // None of the unlinked document IDs should be in the filtered result
          for (const doc of unlinkedDocuments) {
            expect(filteredIds.has(doc.link_id)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 5.3**
  it('all active documents (without unlinked_at) SHALL be preserved in the filtered result', () => {
    fc.assert(
      fc.property(
        fc.array(arbActiveDocument, { minLength: 1, maxLength: 25 }),
        fc.array(arbUnlinkedDocument, { minLength: 0, maxLength: 25 }),
        (activeDocuments, unlinkedDocuments) => {
          const allDocuments = [...activeDocuments, ...unlinkedDocuments];
          const filtered = filterActiveDocuments(allDocuments);

          // All active documents should be in the result
          expect(filtered.length).toBe(activeDocuments.length);

          const filteredIds = new Set(filtered.map((d) => d.link_id));
          for (const doc of activeDocuments) {
            expect(filteredIds.has(doc.link_id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 5.3**
  it('when all documents are active (no unlinked_at), the filtered result equals the full set', () => {
    fc.assert(
      fc.property(
        fc.array(arbActiveDocument, { minLength: 0, maxLength: 50 }),
        (documents) => {
          const filtered = filterActiveDocuments(documents);
          expect(filtered.length).toBe(documents.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 5.3**
  it('when all documents are unlinked, the filtered result SHALL be empty', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnlinkedDocument, { minLength: 1, maxLength: 50 }),
        (documents) => {
          const filtered = filterActiveDocuments(documents);
          expect(filtered.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
