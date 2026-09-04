// @vitest-environment jsdom
/**
 * Bug Condition Exploration Test 1d — Contractors Header Count
 *
 * Tests that the Contractors list header count matches the actual number
 * of contractor rows displayed, not a disconnected `total` value.
 *
 * **Validates: Requirements 1.4**
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import fc from 'fast-check';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ContractorList from '../ContractorList';

// Mock useApiQuery to return controlled data
const mockUseApiQuery = vi.fn();

vi.mock('@/hooks/useApi', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useInvalidateQueries: vi.fn(() => vi.fn()),
}));

/**
 * Arbitrary: Generate contractor data where total is 0 or missing
 * but actual contractors array has items
 */
const arbContractor = fc.record({
  contractor_id: fc.uuid(),
  company_name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  contact_name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  contact_email: fc.emailAddress(),
  status: fc.constantFrom('active' as const, 'suspended' as const, 'pending' as const),
});

const arbContractorsWithBadTotal = fc
  .array(arbContractor, { minLength: 1, maxLength: 10 })
  .chain((contractors) =>
    fc.record({
      contractors: fc.constant(contractors),
      // total is 0 or doesn't match array length (the bug condition)
      total: fc.constantFrom(0),
    })
  );

function renderContractorList(data: { contractors: unknown[]; total: number }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  mockUseApiQuery.mockReturnValue({
    data,
    isLoading: false,
    error: null,
  });

  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(ContractorList))
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Bug Condition Exploration 1d — Contractors Header Count', () => {
  /**
   * Property: For any loaded state where contractors array has N items,
   * the header count SHALL show N (not 0 or some other disconnected value).
   *
   * Bug Condition: Header always shows `data?.total ?? 0` which is 0
   * when backend returns total: 0 regardless of array content.
   */
  it('header count should match actual contractors array length, not stale total', () => {
    fc.assert(
      fc.property(arbContractorsWithBadTotal, (data) => {
        cleanup();
        vi.clearAllMocks();

        renderContractorList(data);

        // The header text shows "{count} contractors registered"
        const actualCount = data.contractors.length;

        // Look for the header paragraph that shows the count
        const headerText = screen.getByText(/contractors registered/i);
        const displayedText = headerText.textContent || '';

        // Extract the number from "X contractors registered"
        const match = displayedText.match(/(\d+)\s*contractors registered/i);
        const displayedCount = match && match[1] ? parseInt(match[1], 10) : -1;

        // Expected: displayed count equals actual array length
        expect(displayedCount).toBe(actualCount);
      }),
      { numRuns: 20 }
    );
  });
});
