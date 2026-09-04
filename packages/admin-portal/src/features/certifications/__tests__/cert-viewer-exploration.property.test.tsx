// @vitest-environment jsdom
/**
 * Bug Condition Exploration Test 1a — Certification Document Viewer
 *
 * Tests that clicking "View" on a certification with a valid `document_key`
 * triggers a backend call to fetch a signed URL (not rendering a hardcoded sample PDF).
 *
 * **Validates: Requirements 1.1**
 */
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import fc from 'fast-check';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CertificationList } from '../CertificationList';
import { CertificationType, CertificationStatus, type Certification } from '../types';

// Track API calls made for document URL fetching
const apiGetMock = vi.fn();

vi.mock('@/services/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock the useCertifications hook
const mockCertifications = vi.fn();

vi.mock('../hooks/useCertifications', () => ({
  useCertifications: (...args: unknown[]) => mockCertifications(...args),
}));

/**
 * Arbitrary: Generate a certification with a valid document_key
 */
const arbCertificationWithDocKey: fc.Arbitrary<Certification> = fc.record({
  certification_id: fc.uuid(),
  worker_id: fc.uuid(),
  tenant_id: fc.uuid(),
  certification_type: fc.constantFrom(...Object.values(CertificationType)),
  issuer: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
  issue_date: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }).map(d => d.toISOString().split('T')[0]),
  expiry_date: fc.date({ min: new Date('2025-01-01'), max: new Date('2028-12-31') }).map(d => d.toISOString().split('T')[0]),
  document_key: fc.string({ minLength: 5, maxLength: 30 }).filter(s => s.trim().length > 0).map(s => `certs/${s}.pdf`),
  validation_status: fc.constantFrom(...Object.values(CertificationStatus)),
  created_at: fc.constant('2024-01-01T00:00:00.000Z'),
  updated_at: fc.constant('2024-01-01T00:00:00.000Z'),
}) as unknown as fc.Arbitrary<Certification>;

function renderWithProviders(workerId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(QueryClientProvider, { client: queryClient },
      createElement(MemoryRouter, null,
        createElement(CertificationList, { workerId })
      )
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Mock dialog methods not available in jsdom
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('Bug Condition Exploration 1a — Certification Document Viewer', () => {
  /**
   * Property: For any certification with a valid document_key,
   * clicking "View" SHOULD trigger an API call to fetch the signed URL
   * from `/workers/{workerId}/certifications/{certId}/document-url`.
   *
   * Bug Condition: The system may render a hardcoded PDF without
   * making any backend call.
   */
  it('clicking View on cert with document_key should trigger API call for document URL', async () => {
    await fc.assert(
      fc.asyncProperty(arbCertificationWithDocKey, async (cert) => {
        cleanup();
        vi.clearAllMocks();

        const workerId = cert.worker_id;

        // Mock useCertifications to return our generated cert
        mockCertifications.mockReturnValue({
          data: [cert],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        });

        // Mock the document URL fetch to simulate a backend response
        apiGetMock.mockResolvedValue({
          url: 'https://s3.amazonaws.com/real-document-url',
          content_type: 'application/pdf',
        });

        renderWithProviders(workerId);

        // The "View" button should exist since document_key is present
        const viewButton = screen.queryByRole('button', { name: /view/i });
        expect(viewButton).not.toBeNull();

        if (viewButton) {
          fireEvent.click(viewButton);

          // Wait a tick for the query to be triggered
          await waitFor(() => {
            // The system SHOULD call the backend endpoint for the document URL
            const expectedEndpoint = `/workers/${workerId}/certifications/${cert.certification_id}/document-url`;
            expect(apiGetMock).toHaveBeenCalledWith(expectedEndpoint);
          }, { timeout: 1000 });
        }
      }),
      { numRuns: 5 }
    );
  });
});
