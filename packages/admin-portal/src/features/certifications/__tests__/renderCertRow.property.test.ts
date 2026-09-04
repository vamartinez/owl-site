// Feature: worker-certification-upload, Property 1: Certification display completeness
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fc from 'fast-check';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CertificationType, CertificationStatus } from '../types';
import type { Certification } from '../types';
import { CertificationList } from '../CertificationList';

// Mock the useCertifications hook so we can inject arbitrary certification data
vi.mock('../hooks/useCertifications', () => ({
  useCertifications: vi.fn(),
}));

// Mock useRBAC to avoid permission-related rendering issues
vi.mock('@/hooks/useRBAC', () => ({
  useRBAC: () => ({ hasPermission: () => true }),
}));

import { useCertifications } from '../hooks/useCertifications';

const mockedUseCertifications = vi.mocked(useCertifications);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Creates a wrapper with QueryClientProvider for rendering components that use TanStack Query.
 */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

/**
 * Replicates the formatting logic from CertificationList.tsx
 * to determine expected display values.
 */
function formatCertificationType(type: string): string {
  const specialCases: Record<string, string> = {
    whmis_2015: 'WHMIS 2015',
    site_ready_bc: 'SiteReadyBC',
  };

  if (specialCases[type]) {
    return specialCases[type];
  }

  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Arbitrary: generates a valid CertificationType enum value.
 */
const certificationTypeArbitrary = fc.constantFrom(
  CertificationType.WHMIS_2015,
  CertificationType.FALL_PROTECTION,
  CertificationType.SITE_READY_BC,
  CertificationType.FIRST_AID
);

/**
 * Arbitrary: generates a valid CertificationStatus enum value.
 */
const certificationStatusArbitrary = fc.constantFrom(
  CertificationStatus.PENDING,
  CertificationStatus.VALIDATED,
  CertificationStatus.REJECTED,
  CertificationStatus.EXPIRED
);

/**
 * Arbitrary: generates a non-empty issuer string (alphanumeric to avoid rendering issues).
 */
const issuerArbitrary = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,49}$/);

/**
 * Arbitrary: generates a valid ISO date string within a reasonable range.
 */
const isoDateArbitrary = fc
  .date({
    min: new Date('2020-01-01'),
    max: new Date('2030-12-31'),
  })
  .map((d) => d.toISOString());

/**
 * Arbitrary: generates a valid Certification object with all required fields.
 */
const certificationArbitrary: fc.Arbitrary<Certification> = fc.record({
  certification_id: fc.uuid(),
  worker_id: fc.uuid(),
  tenant_id: fc.uuid(),
  certification_type: certificationTypeArbitrary,
  issuer: issuerArbitrary,
  issue_date: isoDateArbitrary,
  expiry_date: isoDateArbitrary,
  validation_status: certificationStatusArbitrary,
  created_at: isoDateArbitrary,
  updated_at: isoDateArbitrary,
});

describe('Certification Display Completeness - Property-Based Tests', () => {
  // **Validates: Requirements 1.2**
  it('Property 1: Certification display completeness — rendered row contains type, issuer, issue_date, expiry_date, and validation_status', () => {
    fc.assert(
      fc.property(certificationArbitrary, (certification) => {
        // Mock the hook to return our generated certification
        mockedUseCertifications.mockReturnValue({
          data: [certification],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        } as any);

        const { container } = render(
          createElement(CertificationList, { workerId: 'test-worker-id' }),
          { wrapper: createWrapper() }
        );

        // Compute expected display values
        const expectedType = formatCertificationType(certification.certification_type);
        const expectedIssuer = certification.issuer;
        const expectedIssueDate = formatDate(certification.issue_date);
        const expectedExpiryDate = formatDate(certification.expiry_date);
        const expectedStatus = formatStatus(certification.validation_status);

        const bodyText = container.textContent ?? '';

        // Verify all required fields are present in the rendered output
        expect(bodyText).toContain(expectedType);
        expect(bodyText).toContain(expectedIssuer);
        expect(bodyText).toContain(expectedIssueDate);
        expect(bodyText).toContain(expectedExpiryDate);
        expect(bodyText).toContain(expectedStatus);

        cleanup();
      }),
      { numRuns: 100 }
    );
  });
});
