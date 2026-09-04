// @vitest-environment jsdom
/**
 * Bug Condition Exploration Test 1c — Compliance Column Bare %
 *
 * Tests that the Sites list compliance column does NOT show a bare "%"
 * when compliancePercent is undefined.
 *
 * **Validates: Requirements 1.3**
 */
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import fc from 'fast-check';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SiteList from '../SiteList';

// Mock useApiQuery to return controlled data
const mockUseApiQuery = vi.fn();

vi.mock('@/hooks/useApi', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useInvalidateQueries: vi.fn(() => vi.fn()),
}));

/**
 * Arbitrary: Generate a site record with undefined compliancePercent
 */
const arbSiteWithUndefinedCompliance = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  address: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  activeWorkers: fc.nat({ max: 100 }),
  compliancePercent: fc.constantFrom(undefined, null),
  status: fc.constantFrom('active', 'inactive', 'setup'),
  contractor: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
});

function renderSiteList(sites: Record<string, unknown>[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  mockUseApiQuery.mockReturnValue({
    data: { sites, total: sites.length },
    isLoading: false,
    error: null,
  });

  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(SiteList))
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Bug Condition Exploration 1c — Compliance Column Bare %', () => {
  /**
   * Property: For any site where compliancePercent is undefined/null,
   * the compliance column SHALL NOT display a bare "%" character.
   * It should show "N/A" or equivalent.
   *
   * Bug Condition: The column renders `{undefined}%` → bare `%`.
   */
  it('compliance column should show "N/A" not bare "%" when compliancePercent is undefined', () => {
    fc.assert(
      fc.property(arbSiteWithUndefinedCompliance, (site) => {
        cleanup();
        vi.clearAllMocks();

        const { container } = renderSiteList([site]);

        // Get all table cells and check for bare "%"
        const cells = container.querySelectorAll('td');
        let foundBarePercent = false;

        cells.forEach((cell) => {
          const text = cell.textContent?.trim() || '';
          // A bare "%" means just "%" or "undefined%" or "null%"
          if (text === '%' || text === 'undefined%' || text === 'null%') {
            foundBarePercent = true;
          }
        });

        // Expected: no bare %, should show "N/A" instead
        expect(foundBarePercent).toBe(false);
      }),
      { numRuns: 20 }
    );
  });
});
