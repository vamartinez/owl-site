// Feature: document-explorer, Property 2: Breadcrumb path completeness

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { formatBreadcrumbSegments } from '../../utils';

describe('Property 2: Breadcrumb path completeness', () => {
  // **Validates: Requirements 1.3**

  it('formatBreadcrumbSegments produces array of length path.length + 1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        (path) => {
          const segments = formatBreadcrumbSegments(path);

          // Length should be path.length + 1 (root segment + one per path element)
          expect(segments.length).toBe(path.length + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('first segment is always the root "Documents" with empty path', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        (path) => {
          const segments = formatBreadcrumbSegments(path);

          expect(segments[0]!.label).toBe('Documents');
          expect(segments[0]!.path).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each segment matches path ancestors (segment[i].path is path.slice(0, i))', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        (path) => {
          const segments = formatBreadcrumbSegments(path);

          // Each non-root segment should have label equal to path[i-1]
          // and path equal to path.slice(0, i)
          for (let i = 1; i < segments.length; i++) {
            expect(segments[i]!.label).toBe(path[i - 1]);
            expect(segments[i]!.path).toEqual(path.slice(0, i));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
