// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ValidationPanel } from '../ValidationPanel';
import { CertificationStatus, CertificationType, type Certification } from '../types';

// Mock useRBAC
const mockHasPermission = vi.fn();
vi.mock('@/hooks/useRBAC', () => ({
  useRBAC: () => ({
    hasPermission: mockHasPermission,
  }),
}));

// Mock useUpdateCertification
const mockMutate = vi.fn();
vi.mock('../hooks/useUpdateCertification', () => ({
  useUpdateCertification: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

function makeCertification(overrides: Partial<Certification> = {}): Certification {
  return {
    certification_id: 'cert-123',
    worker_id: 'worker-456',
    tenant_id: 'tenant-789',
    certification_type: CertificationType.WHMIS_2015,
    issuer: 'Safety Corp',
    issue_date: '2024-01-01',
    expiry_date: '2025-01-01',
    validation_status: CertificationStatus.PENDING,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ValidationPanel', () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(true);
  });

  describe('Permission gating (Requirement 3.7)', () => {
    it('hides Validate and Reject buttons when user lacks certifications.validate permission', () => {
      mockHasPermission.mockReturnValue(false);

      const { container } = render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', { name: /validate/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
    });

    it('shows Validate and Reject buttons when user has certifications.validate permission', () => {
      render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });
  });

  describe('Status-based rendering (Requirement 3.1)', () => {
    it('renders nothing when certification is validated', () => {
      const { container } = render(
        <ValidationPanel
          certification={makeCertification({ validation_status: CertificationStatus.VALIDATED })}
          workerId="worker-456"
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when certification is rejected', () => {
      const { container } = render(
        <ValidationPanel
          certification={makeCertification({ validation_status: CertificationStatus.REJECTED })}
          workerId="worker-456"
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when certification is expired', () => {
      const { container } = render(
        <ValidationPanel
          certification={makeCertification({ validation_status: CertificationStatus.EXPIRED })}
          workerId="worker-456"
        />
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('Validate action (Requirement 3.2)', () => {
    it('calls mutate with validated status when Validate is clicked', () => {
      render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      fireEvent.click(screen.getByRole('button', { name: /validate/i }));

      expect(mockMutate).toHaveBeenCalledWith({
        certId: 'cert-123',
        validation_status: CertificationStatus.VALIDATED,
      });
    });
  });

  describe('Reject action (Requirement 3.3)', () => {
    it('shows rejection reason input when Reject is clicked', () => {
      render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      fireEvent.click(screen.getByRole('button', { name: /reject/i }));

      expect(screen.getByLabelText(/rejection reason/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /submit rejection/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('shows validation error when rejection reason is too short', () => {
      render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      fireEvent.click(screen.getByRole('button', { name: /reject/i }));

      const input = screen.getByLabelText(/rejection reason/i);
      fireEvent.change(input, { target: { value: 'short' } });
      fireEvent.click(screen.getByRole('button', { name: /submit rejection/i }));

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('calls mutate with rejected status and reason when valid reason is submitted', () => {
      render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      fireEvent.click(screen.getByRole('button', { name: /reject/i }));

      const input = screen.getByLabelText(/rejection reason/i);
      fireEvent.change(input, { target: { value: 'This document is blurry and unreadable' } });
      fireEvent.click(screen.getByRole('button', { name: /submit rejection/i }));

      expect(mockMutate).toHaveBeenCalledWith({
        certId: 'cert-123',
        validation_status: CertificationStatus.REJECTED,
        rejection_reason: 'This document is blurry and unreadable',
      });
    });

    it('hides rejection input and clears state when Cancel is clicked', () => {
      render(
        <ValidationPanel certification={makeCertification()} workerId="worker-456" />
      );

      fireEvent.click(screen.getByRole('button', { name: /reject/i }));

      const input = screen.getByLabelText(/rejection reason/i);
      fireEvent.change(input, { target: { value: 'some text' } });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      // Should go back to showing Validate/Reject buttons
      expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/rejection reason/i)).not.toBeInTheDocument();
    });
  });
});
