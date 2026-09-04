/**
 * Property-based tests for option label formatting.
 *
 * **Validates: Requirements 2.3, 3.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatWorkerLabel } from '../useWorkerSearch';
import { formatSiteLabel, type Site } from '../useSiteSearch';
import type { ApiWorkerListItem } from '@/types/api-contracts';

/**
 * Arbitrary for generating a Site object with non-empty name and address.
 */
const arbSite: fc.Arbitrary<Site> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  address: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  timezone: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  status: fc.option(fc.constantFrom('active', 'inactive'), { nil: undefined }),
  created_at: fc.option(
    fc.date().map((d) => d.toISOString()),
    { nil: undefined }
  ),
});

/**
 * Arbitrary for generating an ApiWorkerListItem with legal_name (always present)
 * and optional preferred_name.
 */
const arbWorkerWithPreferredName: fc.Arbitrary<ApiWorkerListItem> = fc.record({
  worker_id: fc.uuid(),
  legal_name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  preferred_name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  phone: fc.string({ minLength: 10, maxLength: 15 }),
  language_preference: fc.constantFrom('en', 'es', 'pa'),
  created_at: fc.date().map((d) => d.toISOString()),
});

const arbWorkerWithoutPreferredName: fc.Arbitrary<ApiWorkerListItem> = fc.record({
  worker_id: fc.uuid(),
  legal_name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  phone: fc.string({ minLength: 10, maxLength: 15 }),
  language_preference: fc.constantFrom('en', 'es', 'pa'),
  created_at: fc.date().map((d) => d.toISOString()),
});

const arbWorker: fc.Arbitrary<ApiWorkerListItem> = fc.oneof(
  arbWorkerWithPreferredName,
  arbWorkerWithoutPreferredName
);

describe('Option Label Formatting Property Tests', () => {
  /**
   * Property 7: Site option rendering completeness
   *
   * For any site object with a `name` and `address`, the rendered option label
   * SHALL contain both the site name and the site address.
   *
   * **Validates: Requirements 2.3**
   */
  describe('Property 7: Site option rendering completeness', () => {
    it('label contains both the site name and the site address', () => {
      fc.assert(
        fc.property(arbSite, (site) => {
          const label = formatSiteLabel(site);

          expect(label).toContain(site.name);
          expect(label).toContain(site.address);
        }),
        { numRuns: 200 }
      );
    });
  });

  /**
   * Property 8: Worker option rendering completeness
   *
   * For any worker object, the rendered option label SHALL contain the `legal_name`,
   * and when `preferred_name` is present, the label SHALL also contain the `preferred_name`.
   *
   * **Validates: Requirements 3.3**
   */
  describe('Property 8: Worker option rendering completeness', () => {
    it('label always contains the legal_name', () => {
      fc.assert(
        fc.property(arbWorker, (worker) => {
          const label = formatWorkerLabel(worker);

          expect(label).toContain(worker.legal_name);
        }),
        { numRuns: 200 }
      );
    });

    it('label contains preferred_name when it is present', () => {
      fc.assert(
        fc.property(arbWorkerWithPreferredName, (worker) => {
          const label = formatWorkerLabel(worker);

          expect(label).toContain(worker.legal_name);
          expect(label).toContain(worker.preferred_name);
        }),
        { numRuns: 200 }
      );
    });

    it('label equals legal_name exactly when preferred_name is absent', () => {
      fc.assert(
        fc.property(arbWorkerWithoutPreferredName, (worker) => {
          const label = formatWorkerLabel(worker);

          expect(label).toBe(worker.legal_name);
        }),
        { numRuns: 200 }
      );
    });
  });
});
