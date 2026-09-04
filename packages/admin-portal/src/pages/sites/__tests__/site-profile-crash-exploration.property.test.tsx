// @vitest-environment jsdom
/**
 * Bug Condition Exploration Test 1b — Site Profile Crash
 *
 * Tests that SiteProfile renders without crashing when requiredCerts
 * or recentActivity is undefined in the API response.
 *
 * **Validates: Requirements 1.2**
 */
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import fc from 'fast-check';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SiteProfile from '../SiteProfile';

// Mock useApiQuery to return controlled data
const mockUseApiQuery = vi.fn();

vi.mock('@/hooks/useApi', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useInvalidateQueries: vi.fn(() => vi.fn()),
}));

/**
 * Arbitrary: Generate a site record that triggers the crash condition.
 * Either requiredCerts or recentActivity (or both) is undefined.
 */
const arbCrashSiteData = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  address: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  city: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  status: fc.constantFrom('active', 'inactive', 'setup'),
  contractor: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  activeWorkers: fc.nat({ max: 100 }),
  compliancePercent: fc.nat({ max: 100 }),
  // Bug condition: both are undefined
  requiredCerts: fc.constant(undefined),
  recentActivity: fc.constant(undefined),
});

/**
 * Also test when only one is undefined
 */
const arbCrashSiteDataPartial = fc.oneof(
  // requiredCerts undefined, recentActivity present
  fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    address: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    city: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    status: fc.constantFrom('active', 'inactive', 'setup'),
    contractor: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    activeWorkers: fc.nat({ max: 100 }),
    compliancePercent: fc.nat({ max: 100 }),
    requiredCerts: fc.constant(undefined),
    recentActivity: fc.constant([{ id: '1', description: 'Test', timestamp: '2024-01-01T00:00:00Z' }]),
  }),
  // recentActivity undefined, requiredCerts present
  fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    address: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    city: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    status: fc.constantFrom('active', 'inactive', 'setup'),
    contractor: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    activeWorkers: fc.nat({ max: 100 }),
    compliancePercent: fc.nat({ max: 100 }),
    requiredCerts: fc.constant(['OSHA-30', 'First Aid']),
    recentActivity: fc.constant(undefined),
  })
);

function renderSiteProfile(siteData: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  mockUseApiQuery.mockReturnValue({
    data: siteData,
    isLoading: false,
    error: null,
  });

  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [`/sites/${siteData.id}`] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/sites/:id',
            element: createElement(SiteProfile),
          })
        )
      )
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Bug Condition Exploration 1b — Site Profile Crash', () => {
  /**
   * Property: For any site record where requiredCerts or recentActivity is undefined,
   * SiteProfile SHALL render without throwing a TypeError.
   *
   * Bug Condition: The component calls .length on undefined, causing a crash.
   */
  it('SiteProfile should NOT throw TypeError when requiredCerts and recentActivity are undefined', () => {
    fc.assert(
      fc.property(arbCrashSiteData, (siteData) => {
        cleanup();
        vi.clearAllMocks();

        let threwException = false;
        let rendered = false;

        try {
          const { container } = renderSiteProfile(siteData);
          rendered = container.innerHTML.length > 0;
        } catch (error) {
          threwException = true;
        }

        // Expected behavior: no exception, page renders content
        expect(threwException).toBe(false);
        expect(rendered).toBe(true);
      }),
      { numRuns: 20 }
    );
  });

  it('SiteProfile should NOT throw when only one field is undefined', () => {
    fc.assert(
      fc.property(arbCrashSiteDataPartial, (siteData) => {
        cleanup();
        vi.clearAllMocks();

        let threwException = false;

        try {
          renderSiteProfile(siteData);
        } catch (error) {
          threwException = true;
        }

        expect(threwException).toBe(false);
      }),
      { numRuns: 20 }
    );
  });
});
