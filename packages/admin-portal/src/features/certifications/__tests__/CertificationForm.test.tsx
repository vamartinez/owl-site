// @vitest-environment jsdom
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CertificationForm } from '../CertificationForm';
import {
  CertificationType,
  CertificationStatus,
  type Certification,
} from '../types';

// Mock the Modal component to avoid dialog.showModal() issues in jsdom
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, onClose, title, children }: any) => {
    if (!open) return null;
    return createElement('div', { 'data-testid': 'modal', role: 'dialog' },
      createElement('h2', null, title),
      createElement('button', { onClick: onClose, 'aria-label': 'Close' }, '×'),
      children
    );
  },
}));

// Mock hooks
const mockCreateCertification = vi.fn();
const mockResetCreate = vi.fn();

vi.mock('../hooks/useCreateCertification', () => ({
  useCreateCertification: () => ({
    createCertification: mockCreateCertification,
    isLoading: false,
    error: null,
    uploadProgress: 0,
    isUploading: false,
    reset: mockResetCreate,
  }),
}));

vi.mock('../hooks/useUpdateCertification', () => ({
  useUpdateCertification: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('../hooks/useUploadToS3', () => ({
  useUploadToS3: () => ({
    upload: vi.fn(),
    progress: 0,
    isUploading: false,
    error: null,
    abort: vi.fn(),
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const existingCertification: Certification = {
  certification_id: 'cert-1',
  worker_id: 'worker-1',
  tenant_id: 'tenant-1',
  certification_type: CertificationType.FALL_PROTECTION,
  issuer: 'Heights Safety Corp',
  issue_date: '2024-03-01',
  expiry_date: '2025-03-01',
  validation_status: CertificationStatus.REJECTED,
  rejection_reason: 'Document is blurry',
  created_at: '2024-03-01T00:00:00.000Z',
  updated_at: '2024-03-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CertificationForm', () => {
  it('renders all form fields when open', () => {
    render(
      createElement(CertificationForm, {
        workerId: 'worker-1',
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: createWrapper() }
    );

    // Title
    expect(screen.getByText('Add Certification')).toBeInTheDocument();

    // Certification type select
    expect(screen.getByText('Certification Type')).toBeInTheDocument();

    // Issuer input
    expect(screen.getByLabelText('Issuer')).toBeInTheDocument();

    // Date inputs
    expect(screen.getByLabelText('Issue Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Expiry Date')).toBeInTheDocument();

    // File input
    expect(screen.getByText('Document File')).toBeInTheDocument();

    // Submit and Cancel buttons
    expect(screen.getByText('Submit')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders nothing when modal is closed', () => {
    const { container } = render(
      createElement(CertificationForm, {
        workerId: 'worker-1',
        open: false,
        onClose: vi.fn(),
      }),
      { wrapper: createWrapper() }
    );

    // Modal should not render when open is false
    expect(container.querySelector('dialog')).not.toBeInTheDocument();
  });

  it('pre-fills metadata fields in re-upload mode', () => {
    render(
      createElement(CertificationForm, {
        workerId: 'worker-1',
        open: true,
        onClose: vi.fn(),
        existingCertification,
      }),
      { wrapper: createWrapper() }
    );

    // Title should indicate re-upload mode
    expect(screen.getByText('Re-upload Certification')).toBeInTheDocument();

    // Issuer should be pre-filled
    const issuerInput = screen.getByLabelText('Issuer') as HTMLInputElement;
    expect(issuerInput.value).toBe('Heights Safety Corp');

    // Issue date should be pre-filled
    const issueDateInput = screen.getByLabelText('Issue Date') as HTMLInputElement;
    expect(issueDateInput.value).toBe('2024-03-01');

    // Expiry date should be pre-filled
    const expiryDateInput = screen.getByLabelText('Expiry Date') as HTMLInputElement;
    expect(expiryDateInput.value).toBe('2025-03-01');

    // Submit button should say "Re-upload"
    expect(screen.getByText('Re-upload')).toBeInTheDocument();
  });

  it('disables metadata fields in re-upload mode', () => {
    render(
      createElement(CertificationForm, {
        workerId: 'worker-1',
        open: true,
        onClose: vi.fn(),
        existingCertification,
      }),
      { wrapper: createWrapper() }
    );

    // Metadata fields should be disabled in re-upload mode
    const issuerInput = screen.getByLabelText('Issuer') as HTMLInputElement;
    expect(issuerInput).toBeDisabled();

    const issueDateInput = screen.getByLabelText('Issue Date') as HTMLInputElement;
    expect(issueDateInput).toBeDisabled();

    const expiryDateInput = screen.getByLabelText('Expiry Date') as HTMLInputElement;
    expect(expiryDateInput).toBeDisabled();
  });

  it('shows validation errors when form is submitted empty', async () => {
    render(
      createElement(CertificationForm, {
        workerId: 'worker-1',
        open: true,
        onClose: vi.fn(),
      }),
      { wrapper: createWrapper() }
    );

    // Submit the form without filling any fields
    fireEvent.click(screen.getByText('Submit'));

    // Should show validation errors
    await waitFor(() => {
      // At least one error should appear (issuer required, dates required, file required)
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('calls onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();

    render(
      createElement(CertificationForm, {
        workerId: 'worker-1',
        open: true,
        onClose,
      }),
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
