// @vitest-environment jsdom
/**
 * Preservation Property Tests for Admin Portal Audit Fixes
 *
 * These tests capture BASELINE behavior of the UNFIXED code for NON-BUGGY inputs.
 * They verify behaviors that MUST be preserved after the bugfixes are applied.
 *
 * Test 2a — Site Profile renders correctly with valid data
 * Test 2b — Compliance column displays valid percentages correctly
 * Test 2d — Contractors header count correct when total matches array
 * Test 2e — Check-in allowed entries display correctly
 * Test 2f — Unaffected pages function normally
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fc from 'fast-check';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: vi.fn(() => ({ id: 'test-site-1' })),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement('a', { href: to }, children),
}));

// SiteProfile renders SiteCheckinQR, which calls the shared apiClient via
// react-query — mock it so the mutation never hits the network in these tests.
vi.mock('@/services/api-client', () => ({
  apiClient: { post: vi.fn(() => new Promise(() => {})), get: vi.fn() },
}));

/** SiteProfile now mounts SiteCheckinQR, which needs a QueryClientProvider. */
function renderSiteProfile(SiteProfile: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(QueryClientProvider, { client }, createElement(SiteProfile))
  );
}

// Mock useApi hooks
const mockUseApiQuery = vi.fn();
vi.mock('@/hooks/useApi', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useInvalidateQueries: () => vi.fn(),
}));

// Mock useErrorHandler
vi.mock('@/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ error: null, setError: vi.fn(), clearError: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a non-empty array of certification names (strings).
 * These represent valid requiredCerts arrays (non-buggy inputs).
 */
const arbCertName = fc.constantFrom(
  'OSHA-30', 'First Aid', 'WHMIS', 'Fall Protection', 'Confined Space',
  'Site Ready BC', 'CPR-C', 'H2S Alive', 'Ground Disturbance', 'Scaffold User'
);

const arbRequiredCerts = fc.array(arbCertName, { minLength: 1, maxLength: 5 })
  .map((arr) => [...new Set(arr)]); // ensure unique

/**
 * Generates a non-empty array of recent activity items.
 * These represent valid recentActivity arrays (non-buggy inputs).
 */
const arbActivityDescription = fc.constantFrom(
  'Worker check-in completed', 'Safety inspection passed',
  'New certification uploaded', 'Policy updated', 'Incident reported',
  'Contractor added', 'Compliance review scheduled', 'Site audit completed'
);

const arbRecentActivity = fc
  .array(
    fc.record({
      id: fc.uuid(),
      description: arbActivityDescription,
      timestamp: fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()),
    }),
    { minLength: 1, maxLength: 8 }
  );

/**
 * Generates a valid site name from realistic options.
 */
const arbSiteName = fc.constantFrom(
  'Downtown Tower', 'Riverside Mall', 'Highway Bridge Phase 2',
  'Airport Terminal B', 'Harbor District', 'Central Park West',
  'North Industrial', 'Eastside Complex', 'Mountain View Plaza'
);

const arbContractorName = fc.constantFrom(
  'ACME Corp', 'BuildRight Inc', 'SafeWork Ltd', 'ProBuild Co',
  'Vertex Construction', 'Pacific Builders', 'Summit Engineering'
);

/**
 * Generates a valid SiteDetail object with all fields populated (non-buggy input).
 */
const arbValidSiteDetail = fc.record({
  id: fc.uuid(),
  name: arbSiteName,
  address: fc.constantFrom('123 Main St', '456 Oak Ave', '789 Industrial Blvd', '101 Harbor Dr'),
  city: fc.constantFrom('Vancouver', 'Toronto', 'Calgary', 'Montreal'),
  status: fc.constantFrom('active' as const, 'inactive' as const, 'setup' as const),
  contractor: arbContractorName,
  activeWorkers: fc.integer({ min: 1, max: 500 }),
  compliancePercent: fc.integer({ min: 0, max: 100 }),
  requiredCerts: arbRequiredCerts,
  recentActivity: arbRecentActivity,
});

/**
 * Generates a valid compliancePercent (integer 0-100).
 * This represents the non-buggy case where the value IS defined.
 */
const arbValidCompliancePercent = fc.integer({ min: 0, max: 100 });

/**
 * Generates a valid contractor item with realistic names.
 */
const arbContractor = fc.record({
  contractor_id: fc.uuid(),
  company_name: fc.constantFrom('ACME Corp', 'BuildRight Inc', 'SafeWork Ltd', 'ProBuild Co', 'Vertex Construction'),
  contact_name: fc.constantFrom('John Smith', 'Maria Garcia', 'James Chen', 'Sarah Johnson', 'David Kim'),
  contact_email: fc.emailAddress(),
  contact_phone: fc.option(fc.constant('+16045551234'), { nil: undefined }),
  status: fc.constantFrom('active' as const, 'suspended' as const, 'pending' as const),
  total_workers: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  compliance_percent: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
});

/**
 * Generates a valid check-in entry with status "allowed" and populated fields.
 * Uses realistic worker/site names that don't have normalization issues.
 */
const arbWorkerName = fc.constantFrom(
  'Carlos Rodriguez', 'Mike Thompson', 'Ana Martinez', 'Wei Chen',
  'James Wilson', 'Pedro Sanchez', 'Lisa Park', 'David Brown'
);

const arbSiteNameCheckin = fc.constantFrom(
  'Downtown Tower', 'Riverside Mall', 'Highway Bridge',
  'Airport Terminal B', 'Harbor District', 'Central Park West'
);

const arbAllowedCheckIn = fc.record({
  id: fc.uuid(),
  workerName: arbWorkerName,
  decision: fc.constant('allowed' as const),
  timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()),
  site: arbSiteNameCheckin,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Preservation Property Tests — Admin Portal Audit Fixes', () => {
  /**
   * Test 2a — Site Profile renders correctly with valid data
   *
   * Observation: SiteProfile renders correctly when requiredCerts is a valid array
   * and recentActivity is a valid array. Badges are shown for certs, activity list
   * shows timestamps.
   *
   * Property: For all site records where requiredCerts IS defined AND recentActivity
   * IS defined, the page renders badges for certs and activity list.
   *
   * **Validates: Requirements 3.2**
   */
  describe('Test 2a — Site Profile renders correctly with valid data', () => {
    it('renders certification badges when requiredCerts is a populated array', async () => {
      const { default: SiteProfile } = await import('../sites/SiteProfile');

      fc.assert(
        fc.property(arbValidSiteDetail, (siteData) => {
          cleanup();
          mockUseApiQuery.mockReturnValue({ data: siteData, isLoading: false });

          renderSiteProfile(SiteProfile);

          // Should render all cert badges
          for (const cert of siteData.requiredCerts) {
            const badge = screen.getByText(cert);
            expect(badge).toBeInTheDocument();
          }
        }),
        { numRuns: 30 }
      );
    });

    it('renders recent activity list with descriptions when recentActivity is populated', async () => {
      const { default: SiteProfile } = await import('../sites/SiteProfile');

      fc.assert(
        fc.property(arbValidSiteDetail, (siteData) => {
          cleanup();
          mockUseApiQuery.mockReturnValue({ data: siteData, isLoading: false });

          const { container } = renderSiteProfile(SiteProfile);

          // Should render activity descriptions (first 5) somewhere in the page
          const displayedActivities = siteData.recentActivity.slice(0, 5);
          const pageText = container.textContent || '';
          for (const activity of displayedActivities) {
            expect(pageText).toContain(activity.description);
          }
        }),
        { numRuns: 30 }
      );
    });

    it('renders site name and compliance percentage', async () => {
      const { default: SiteProfile } = await import('../sites/SiteProfile');

      fc.assert(
        fc.property(arbValidSiteDetail, (siteData) => {
          cleanup();
          mockUseApiQuery.mockReturnValue({ data: siteData, isLoading: false });

          const { container } = renderSiteProfile(SiteProfile);

          // Should render site name in the h1
          expect(screen.getByText(siteData.name)).toBeInTheDocument();
          // Should render compliance percent somewhere in the page
          const complianceText = container.textContent;
          expect(complianceText).toContain(`${siteData.compliancePercent}%`);
        }),
        { numRuns: 30 }
      );
    });
  });

  /**
   * Test 2b — Compliance column displays valid percentages correctly
   *
   * Observation: SiteList renders `75%` in a warning Badge for compliancePercent: 75,
   * `95%` in success Badge for compliancePercent: 95.
   *
   * Property: For all sites where compliancePercent is a valid number (0-100),
   * the cell renders `{pct}%` with correct Badge variant:
   *   - success >= 90
   *   - warning >= 70 (and < 90)
   *   - danger < 70
   *
   * **Validates: Requirements 3.3**
   */
  describe('Test 2b — Compliance column displays valid percentages correctly', () => {
    it('renders percentage text with correct Badge variant based on value', async () => {
      const { default: SiteList } = await import('../sites/SiteList');

      fc.assert(
        fc.property(arbValidCompliancePercent, (pct) => {
          cleanup();

          const site = {
            id: 'site-1',
            name: 'Test Site',
            address: '123 Main St',
            activeWorkers: 10,
            compliancePercent: pct,
            status: 'active' as const,
            contractor: 'ACME Corp',
          };

          mockUseApiQuery.mockReturnValue({
            data: { sites: [site], total: 1 },
            isLoading: false,
          });

          render(createElement(SiteList));

          // Should render the percentage text
          const badgeEl = screen.getByText(`${pct}%`);
          expect(badgeEl).toBeInTheDocument();

          // Verify the badge has correct variant class based on the percentage value
          if (pct >= 90) {
            expect(badgeEl).toHaveClass('bg-green-100');
          } else if (pct >= 70) {
            expect(badgeEl).toHaveClass('bg-yellow-100');
          } else {
            expect(badgeEl).toHaveClass('bg-red-100');
          }
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Test 2d — Contractors header count correct when total matches array
   *
   * Observation: When backend returns { contractors: [4 items], total: 4 },
   * header shows "4 contractors registered".
   *
   * Property: For all responses where total equals contractors.length,
   * header count equals total.
   *
   * **Validates: Requirements 3.5**
   */
  describe('Test 2d — Contractors header count correct when total matches array', () => {
    it('displays correct header count when total matches contractors array length', async () => {
      const { default: ContractorList } = await import('../contractors/ContractorList');

      fc.assert(
        fc.property(
          fc.array(arbContractor, { minLength: 1, maxLength: 8 }),
          (contractors) => {
            cleanup();
            const total = contractors.length;

            mockUseApiQuery.mockReturnValue({
              data: { contractors, total },
              isLoading: false,
            });

            render(createElement(ContractorList));

            // Header should show the correct count
            const headerText = screen.getByText(`${total} contractors registered`);
            expect(headerText).toBeInTheDocument();
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  /**
   * Test 2e — Check-in allowed entries display correctly
   *
   * Observation: Allowed check-in entries display worker name, site name,
   * and a timestamp.
   *
   * Property: For all check-in entries with status = "allowed" that have
   * worker/site names populated, the display format shows worker name and site.
   *
   * **Validates: Requirements 3.6**
   */
  describe('Test 2e — Check-in allowed entries display correctly', () => {
    it('displays worker name and site name for allowed check-in entries', async () => {
      const { default: CheckIn } = await import('../site-access/CheckIn');

      fc.assert(
        fc.property(
          fc.array(arbAllowedCheckIn, { minLength: 1, maxLength: 5 }),
          (checkIns) => {
            cleanup();
            mockUseApiQuery.mockReturnValue({
              data: { checkIns },
              isLoading: false,
            });

            const { container } = render(createElement(CheckIn));
            const pageText = container.textContent || '';

            // Each allowed entry should show worker name and site
            for (const entry of checkIns) {
              expect(pageText).toContain(entry.workerName);
              expect(pageText).toContain(entry.site);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Test 2f — Unaffected pages function normally
   *
   * Observation: Pages not affected by the 7 bugs render without errors.
   * Since we can't easily mount full routing here, we verify that the main
   * pages that use useApiQuery render gracefully with loading/empty states.
   *
   * Property: Pages NOT listed in the 7 bugs produce no regressions.
   * We test that SiteList, ContractorList, and CheckIn all render loading states
   * without throwing.
   *
   * **Validates: Requirements 3.5**
   */
  describe('Test 2f — Unaffected pages function normally', () => {
    it('SiteList renders loading state without errors', async () => {
      const { default: SiteList } = await import('../sites/SiteList');

      mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
      const { container } = render(createElement(SiteList));
      expect(container).toBeTruthy();
      // Should have Sites header
      expect(screen.getByText('Sites')).toBeInTheDocument();
    });

    it('ContractorList renders loading state without errors', async () => {
      const { default: ContractorList } = await import('../contractors/ContractorList');

      mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
      const { container } = render(createElement(ContractorList));
      expect(container).toBeTruthy();
      expect(screen.getByText('Contractors')).toBeInTheDocument();
    });

    it('CheckIn renders empty state without errors', async () => {
      const { default: CheckIn } = await import('../site-access/CheckIn');

      mockUseApiQuery.mockReturnValue({ data: { checkIns: [] }, isLoading: false });
      const { container } = render(createElement(CheckIn));
      expect(container).toBeTruthy();
      expect(screen.getByText('Site Check-In')).toBeInTheDocument();
    });

    it('SiteProfile renders loading state without errors', async () => {
      const { default: SiteProfile } = await import('../sites/SiteProfile');

      mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
      const { container } = renderSiteProfile(SiteProfile);
      expect(container).toBeTruthy();
      // Loading state shows skeleton animation
    });

    it('SiteProfile renders "not found" when data is null', async () => {
      const { default: SiteProfile } = await import('../sites/SiteProfile');

      mockUseApiQuery.mockReturnValue({ data: null, isLoading: false });
      const { container } = renderSiteProfile(SiteProfile);
      expect(container).toBeTruthy();
      expect(screen.getByText('Site not found')).toBeInTheDocument();
    });
  });
});
