/**
 * Property-based tests for backend search filter logic.
 *
 * Property 9: Worker search filter correctness
 * Property 10: Site search filter correctness
 * Property 11: Search result limit
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterWorkers, filterSites } from '../../src/shared/search-filters.js';
import type { WorkerRecord, SiteRecord } from '../../src/shared/search-filters.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary worker record */
const arbWorker: fc.Arbitrary<WorkerRecord> = fc.record({
  worker_id: fc.uuid(),
  legal_name: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
  preferred_name: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
});

/** Arbitrary list of workers (up to 50 for reasonable test speed) */
const arbWorkers: fc.Arbitrary<WorkerRecord[]> = fc.array(arbWorker, { minLength: 0, maxLength: 50 });

/** Arbitrary site record */
const arbSite: fc.Arbitrary<SiteRecord> = fc.record({
  id: fc.uuid(),
  name: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
  address: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
});

/** Arbitrary list of sites (up to 50 for reasonable test speed) */
const arbSites: fc.Arbitrary<SiteRecord[]> = fc.array(arbSite, { minLength: 0, maxLength: 50 });

/** Arbitrary non-empty search string */
const arbSearchString: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 50 });

/** Arbitrary search string including empty */
const arbSearchStringOrEmpty: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 50 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 9: Worker search filter correctness', () => {
  it('returns only workers whose legal_name or preferred_name contains the search string (case-insensitive)', () => {
    fc.assert(
      fc.property(arbWorkers, arbSearchStringOrEmpty, (workers, search) => {
        const result = filterWorkers(workers, search || undefined);

        if (!search) {
          // When search is empty, all workers are returned
          expect(result).toEqual(workers);
        } else {
          const searchLower = search.toLowerCase();

          // Every returned worker must match
          for (const worker of result) {
            const legalMatch = worker.legal_name?.toLowerCase().includes(searchLower) ?? false;
            const preferredMatch = worker.preferred_name?.toLowerCase().includes(searchLower) ?? false;
            expect(legalMatch || preferredMatch).toBe(true);
          }

          // Every matching worker from the input (up to limit) must be in the result
          const allMatching = workers.filter((w) => {
            const legalMatch = w.legal_name?.toLowerCase().includes(searchLower) ?? false;
            const preferredMatch = w.preferred_name?.toLowerCase().includes(searchLower) ?? false;
            return legalMatch || preferredMatch;
          });
          const expectedSlice = allMatching.slice(0, 20);
          expect(result).toEqual(expectedSlice);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('when search is empty/undefined, all workers are returned', () => {
    fc.assert(
      fc.property(arbWorkers, (workers) => {
        const resultUndefined = filterWorkers(workers, undefined);
        const resultEmpty = filterWorkers(workers, '');

        expect(resultUndefined).toEqual(workers);
        expect(resultEmpty).toEqual(workers);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 10: Site search filter correctness', () => {
  it('returns only sites whose name or address contains the search string (case-insensitive)', () => {
    fc.assert(
      fc.property(arbSites, arbSearchStringOrEmpty, (sites, search) => {
        const result = filterSites(sites, search || undefined);

        if (!search) {
          // When search is empty, all sites are returned
          expect(result).toEqual(sites);
        } else {
          const searchLower = search.toLowerCase();

          // Every returned site must match
          for (const site of result) {
            const nameMatch = site.name?.toLowerCase().includes(searchLower) ?? false;
            const addressMatch = site.address?.toLowerCase().includes(searchLower) ?? false;
            expect(nameMatch || addressMatch).toBe(true);
          }

          // Every matching site from the input (up to limit) must be in the result
          const allMatching = sites.filter((s) => {
            const nameMatch = s.name?.toLowerCase().includes(searchLower) ?? false;
            const addressMatch = s.address?.toLowerCase().includes(searchLower) ?? false;
            return nameMatch || addressMatch;
          });
          const expectedSlice = allMatching.slice(0, 20);
          expect(result).toEqual(expectedSlice);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('when search is empty/undefined, all sites are returned', () => {
    fc.assert(
      fc.property(arbSites, (sites) => {
        const resultUndefined = filterSites(sites, undefined);
        const resultEmpty = filterSites(sites, '');

        expect(resultUndefined).toEqual(sites);
        expect(resultEmpty).toEqual(sites);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 11: Search result limit', () => {
  it('for any non-empty search string, worker results contain at most 20 items', () => {
    // Use a larger dataset to exercise the limit
    const arbManyWorkers = fc.array(arbWorker, { minLength: 0, maxLength: 100 });

    fc.assert(
      fc.property(arbManyWorkers, arbSearchString, (workers, search) => {
        const result = filterWorkers(workers, search);
        expect(result.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 200 },
    );
  });

  it('for any non-empty search string, site results contain at most 20 items', () => {
    // Use a larger dataset to exercise the limit
    const arbManySites = fc.array(arbSite, { minLength: 0, maxLength: 100 });

    fc.assert(
      fc.property(arbManySites, arbSearchString, (sites, search) => {
        const result = filterSites(sites, search);
        expect(result.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 200 },
    );
  });

  it('limit is exactly 20 when more than 20 items match', () => {
    // Generate workers that all have the same substring in their legal_name
    const searchTerm = 'test';
    const arbMatchingWorker: fc.Arbitrary<WorkerRecord> = fc.record({
      worker_id: fc.uuid(),
      legal_name: fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s}${searchTerm}${s}`),
      preferred_name: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
    });
    const arbManyMatchingWorkers = fc.array(arbMatchingWorker, { minLength: 21, maxLength: 50 });

    fc.assert(
      fc.property(arbManyMatchingWorkers, (workers) => {
        const result = filterWorkers(workers, searchTerm);
        expect(result.length).toBe(20);
      }),
      { numRuns: 50 },
    );
  });
});
