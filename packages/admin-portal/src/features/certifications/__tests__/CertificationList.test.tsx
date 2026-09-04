// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CertificationList } from '../CertificationList';
import {
  CertificationType,
  CertificationStatus,
  type Certification,
} from '../types';

// Mock hooks
vi.mock('../hooks/useCertifications', () => ({
  useCertifications: vi.fn(),
}));

vi.mock('@/hooks/useRBAC', () => ({
  useRBAC: () => ({ hasPermission: () => true }),
}));

vi.mock('../hooks/useUpdateCertification', () => ({
  useUpdateCertification: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

import { useCertifications } from '../hooks/useCertifications';

const mockedUseCertifications = vi.mocked(useCertifications);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockCertification: Certification = {
  certification_id: 'cert-1',
  worker_id: 'worker-1',
  tenant_id: 'tenant-1',
  certification_type: CertificationType.WHMIS_2015,
  issuer: 'Safety Training Inc',
  issue_date: '2024-01-15T00:00:00.000Z',
  expiry_date: '2025-06-15T00:00:00.000Z',
  validation_status: CertificationStatus.VALIDATED,
  created_at: '2024-01-15T00:00:00.000Z',
  updated_at: '2024-01-15T00:00:00.000Z',
};

const mockCertificationPending: Certification = {
  ...mockCertification,
  certification_id: 'cert-2',
  certification_type: CertificationType.FALL_PROTECTION,
  issuer: 'Heights Safety Corp',
  validation_status: CertificationStatus.PENDING,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CertificationList', () => {
  it('displays loading skeleton while certifications are loading', () => {
    mockedUseCertifications.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(CertificationList, { workerId: 'worker-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByTestId('certification-list-loading')).toBeInTheDocument();
  });

  it('displays error state with retry button when API request fails', () => {
    const mockRefetch = vi.fn();
    mockedUseCertifications.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
      refetch: mockRefetch,
    } as any);

    render(
      createElement(CertificationList, { workerId: 'worker-1' }),
      { wrapper: createWrapper() }
    );

    // Should show error title
    expect(screen.getByText('Failed to load certifications')).toBeInTheDocument();
    // Should show error message
    expect(screen.getByText('Network error')).toBeInTheDocument();

    // Should have a retry button
    const retryButton = screen.getByText('Reintentar');
    expect(retryButton).toBeInTheDocument();

    // Clicking retry should call refetch
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('displays empty state when no certifications exist', () => {
    mockedUseCertifications.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(CertificationList, { workerId: 'worker-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('No certifications found')).toBeInTheDocument();
  });

  it('renders certification rows with type, issuer, dates, and status', () => {
    mockedUseCertifications.mockReturnValue({
      data: [mockCertification, mockCertificationPending],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(CertificationList, { workerId: 'worker-1' }),
      { wrapper: createWrapper() }
    );

    // Check first certification row
    expect(screen.getByText('WHMIS 2015')).toBeInTheDocument();
    expect(screen.getByText('Safety Training Inc')).toBeInTheDocument();
    expect(screen.getByText('Validated')).toBeInTheDocument();

    // Check second certification row
    expect(screen.getByText('Fall Protection')).toBeInTheDocument();
    expect(screen.getByText('Heights Safety Corp')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders Re-upload button for rejected certifications', () => {
    const rejectedCert: Certification = {
      ...mockCertification,
      validation_status: CertificationStatus.REJECTED,
      rejection_reason: 'Document is blurry',
    };

    mockedUseCertifications.mockReturnValue({
      data: [rejectedCert],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    const onReupload = vi.fn();

    render(
      createElement(CertificationList, { workerId: 'worker-1', onReupload }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Re-upload')).toBeInTheDocument();
  });

  it('calls onReupload callback when Re-upload button is clicked', () => {
    const rejectedCert: Certification = {
      ...mockCertification,
      validation_status: CertificationStatus.REJECTED,
      rejection_reason: 'Document is blurry',
    };

    mockedUseCertifications.mockReturnValue({
      data: [rejectedCert],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    const onReupload = vi.fn();

    render(
      createElement(CertificationList, { workerId: 'worker-1', onReupload }),
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('Re-upload'));
    expect(onReupload).toHaveBeenCalledWith(rejectedCert);
  });
});
