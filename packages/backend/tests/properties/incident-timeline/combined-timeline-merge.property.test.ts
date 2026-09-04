// Feature: incident-timeline, Property 13: Merge cronológico de vista combinada

/**
 * Property-based test for chronological merge of the combined timeline view.
 *
 * Property 13: For any pair of arrays (audit trail events, linked documents),
 * the combined view SHALL produce an array ordered chronologically where each
 * consecutive pair (a, b) satisfies `a.timestamp >= b.timestamp` (descending order).
 * The length of the result SHALL be the sum of both input lengths.
 *
 * **Validates: Requirements 7.1**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ─── Types for combined timeline ──────────────────────────────────────────────

interface AuditTrailEvent {
  type: 'event';
  id: string;
  timestamp: string; // ISO 8601
  event_type: string;
}

interface LinkedDocumentEntry {
  type: 'document';
  id: string;
  timestamp: string; // ISO 8601 (response_submitted_at)
  form_name: string;
}

type CombinedTimelineItem = AuditTrailEvent | LinkedDocumentEntry;

// ─── Pure logic under test ────────────────────────────────────────────────────

/**
 * Merges audit trail events and linked documents into a unified timeline
 * sorted in descending chronological order by timestamp.
 * This replicates the merge logic intended for CombinedTimelineView.tsx.
 */
function mergeCombinedTimeline(
  auditEvents: AuditTrailEvent[],
  linkedDocuments: LinkedDocumentEntry[]
): CombinedTimelineItem[] {
  const combined: CombinedTimelineItem[] = [...auditEvents, ...linkedDocuments];
  return combined.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid ISO 8601 date string within a reasonable range */
const arbISODate = fc
  .integer({ min: 1609459200000, max: 1767225600000 }) // 2021-01-01 to 2025-12-31
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for an audit trail event */
const arbAuditTrailEvent: fc.Arbitrary<AuditTrailEvent> = fc.record({
  type: fc.constant('event' as const),
  id: fc.uuid(),
  timestamp: arbISODate,
  event_type: fc.constantFrom(
    'creation',
    'state_change',
    'severity_change',
    'comment_added',
    'attachment_added',
    'document_linked',
    'document_unlinked'
  ),
});

/** Arbitrary for a linked document entry */
const arbLinkedDocumentEntry: fc.Arbitrary<LinkedDocumentEntry> = fc.record({
  type: fc.constant('document' as const),
  id: fc.uuid(),
  timestamp: arbISODate,
  form_name: fc.string({ minLength: 1, maxLength: 80 }),
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 13: Chronological merge of combined timeline view', () => {
  // **Validates: Requirements 7.1**
  it('combined view SHALL produce an array where each consecutive pair (a, b) satisfies a.timestamp >= b.timestamp (descending order)', () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditTrailEvent, { minLength: 0, maxLength: 30 }),
        fc.array(arbLinkedDocumentEntry, { minLength: 0, maxLength: 30 }),
        (auditEvents, linkedDocuments) => {
          const merged = mergeCombinedTimeline(auditEvents, linkedDocuments);

          // Verify descending order: each consecutive pair must satisfy a >= b
          for (let i = 0; i < merged.length - 1; i++) {
            const aTime = new Date(merged[i].timestamp).getTime();
            const bTime = new Date(merged[i + 1].timestamp).getTime();
            expect(aTime).toBeGreaterThanOrEqual(bTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.1**
  it('the length of the result SHALL be the sum of both input lengths', () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditTrailEvent, { minLength: 0, maxLength: 30 }),
        fc.array(arbLinkedDocumentEntry, { minLength: 0, maxLength: 30 }),
        (auditEvents, linkedDocuments) => {
          const merged = mergeCombinedTimeline(auditEvents, linkedDocuments);

          expect(merged.length).toBe(auditEvents.length + linkedDocuments.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.1**
  it('all items from both inputs SHALL be present in the merged result', () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditTrailEvent, { minLength: 1, maxLength: 30 }),
        fc.array(arbLinkedDocumentEntry, { minLength: 1, maxLength: 30 }),
        (auditEvents, linkedDocuments) => {
          const merged = mergeCombinedTimeline(auditEvents, linkedDocuments);

          const mergedIds = new Set(merged.map((item) => item.id));

          // All audit trail event IDs must be present
          for (const event of auditEvents) {
            expect(mergedIds.has(event.id)).toBe(true);
          }

          // All linked document IDs must be present
          for (const doc of linkedDocuments) {
            expect(mergedIds.has(doc.id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.1**
  it('merge is stable with respect to item types: both event and document types are preserved', () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditTrailEvent, { minLength: 1, maxLength: 25 }),
        fc.array(arbLinkedDocumentEntry, { minLength: 1, maxLength: 25 }),
        (auditEvents, linkedDocuments) => {
          const merged = mergeCombinedTimeline(auditEvents, linkedDocuments);

          const eventCount = merged.filter((item) => item.type === 'event').length;
          const documentCount = merged.filter((item) => item.type === 'document').length;

          expect(eventCount).toBe(auditEvents.length);
          expect(documentCount).toBe(linkedDocuments.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.1**
  it('when one input is empty, the result SHALL equal the other input sorted descending', () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditTrailEvent, { minLength: 1, maxLength: 50 }),
        (auditEvents) => {
          const merged = mergeCombinedTimeline(auditEvents, []);

          expect(merged.length).toBe(auditEvents.length);

          // Should still be sorted descending
          for (let i = 0; i < merged.length - 1; i++) {
            const aTime = new Date(merged[i].timestamp).getTime();
            const bTime = new Date(merged[i + 1].timestamp).getTime();
            expect(aTime).toBeGreaterThanOrEqual(bTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.1**
  it('when both inputs are empty, the result SHALL be an empty array', () => {
    const merged = mergeCombinedTimeline([], []);
    expect(merged.length).toBe(0);
  });
});
