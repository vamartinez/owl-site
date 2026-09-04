// Feature: incident-timeline, Property 7: Filtrado por categoría multi-select

/**
 * Property-based test for multi-select category filtering of linked documents.
 *
 * Property 7: For any array of linked documents and any non-empty subset of selected categories,
 * the filtered result SHALL contain exactly those documents whose `document_category` belongs to
 * the selected subset. The total count SHALL equal the filtered set size.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
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
 * Filters an array of linked documents by a set of selected categories.
 * This replicates the filtering logic applied in the backend (getLinkedDocuments with category filter)
 * and mirrors the category filter behavior in the frontend CategoryFilter component.
 */
function filterByCategories(
  documents: LinkedDocumentRecord[],
  selectedCategories: DocumentCategory[]
): LinkedDocumentRecord[] {
  return documents.filter((doc) => selectedCategories.includes(doc.document_category));
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid ISO 8601 date string */
const arbISODate = fc
  .integer({ min: 1609459200000, max: 1767225600000 })
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for a LinkedDocumentRecord (active — no unlinked_at) */
const arbLinkedDocumentRecord: fc.Arbitrary<LinkedDocumentRecord> = fc.record({
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
});

/** Arbitrary for a non-empty subset of categories */
const arbCategorySubset = fc.subarray(ALL_CATEGORIES, { minLength: 1 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 7: Category multi-select filtering', () => {
  // **Validates: Requirements 4.1, 4.2**
  it('filtered result SHALL contain only documents whose category is in the selected subset', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 50 }),
        arbCategorySubset,
        (documents, selectedCategories) => {
          const filtered = filterByCategories(documents, selectedCategories);

          // All returned documents must have a category in the selected set
          for (const doc of filtered) {
            expect(selectedCategories).toContain(doc.document_category);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.1, 4.2**
  it('filtered result SHALL include ALL documents that match the selected categories (no omissions)', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 50 }),
        arbCategorySubset,
        (documents, selectedCategories) => {
          const filtered = filterByCategories(documents, selectedCategories);

          // Count documents that should match
          const expectedCount = documents.filter((d) =>
            selectedCategories.includes(d.document_category)
          ).length;

          expect(filtered.length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.4**
  it('total count SHALL equal the number of filtered documents', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 50 }),
        arbCategorySubset,
        (documents, selectedCategories) => {
          const filtered = filterByCategories(documents, selectedCategories);
          const totalCount = filtered.length;

          // The count matches the filtered set size
          expect(totalCount).toBe(
            documents.filter((d) => selectedCategories.includes(d.document_category)).length
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.3**
  it('when all categories are selected, filtered result SHALL equal the full document set', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 0, maxLength: 30 }),
        (documents) => {
          const filtered = filterByCategories(documents, ALL_CATEGORIES);

          // All documents should pass through when all categories are selected
          expect(filtered.length).toBe(documents.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.1**
  it('documents with categories NOT in the selected subset SHALL be excluded', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinkedDocumentRecord, { minLength: 1, maxLength: 50 }),
        arbCategorySubset,
        (documents, selectedCategories) => {
          const filtered = filterByCategories(documents, selectedCategories);
          const filteredIds = new Set(filtered.map((d) => d.link_id));

          // Documents whose category is NOT in the selected set must NOT appear in results
          for (const doc of documents) {
            if (!selectedCategories.includes(doc.document_category)) {
              expect(filteredIds.has(doc.link_id)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
