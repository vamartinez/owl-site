// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { IntegrityVerification } from '../IntegrityVerification';

// Mock hooks
const mockMutate = vi.fn();
const mockUseIntegrityVerify = vi.fn();

vi.mock('../hooks/useIntegrityVerify', () => ({
  useIntegrityVerify: () => mockUseIntegrityVerify(),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ShieldCheck: ({ className }: { className?: string }) => (
    <span data-testid="icon-shield-check" className={className} />
  ),
  ShieldAlert: ({ className }: { className?: string }) => (
    <span data-testid="icon-shield-alert" className={className} />
  ),
  Loader2: ({ className }: { className?: string }) => (
    <span data-testid="icon-loader" className={className} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('IntegrityVerification', () => {
  const documentId = 'doc-abc-123';

  describe('idle state', () => {
    beforeEach(() => {
      mockUseIntegrityVerify.mockReturnValue({
        mutate: mockMutate,
        data: undefined,
        isPending: false,
        isError: false,
      });
    });

    it('renders the Verify Integrity button', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('verify-integrity-button')).toBeInTheDocument();
      expect(screen.getByText('Verify Integrity')).toBeInTheDocument();
    });

    it('calls mutate with documentId when button is clicked', () => {
      render(<IntegrityVerification documentId={documentId} />);

      fireEvent.click(screen.getByTestId('verify-integrity-button'));

      expect(mockMutate).toHaveBeenCalledWith(documentId);
    });

    it('does not show result or error initially', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.queryByTestId('integrity-result')).not.toBeInTheDocument();
      expect(screen.queryByTestId('integrity-error')).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    beforeEach(() => {
      mockUseIntegrityVerify.mockReturnValue({
        mutate: mockMutate,
        data: undefined,
        isPending: true,
        isError: false,
      });
    });

    it('displays a spinner icon while verifying', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
    });

    it('shows "Verifying…" text', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByText('Verifying…')).toBeInTheDocument();
    });

    it('disables the button while pending', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('verify-integrity-button')).toBeDisabled();
    });
  });

  describe('success state - hashes match', () => {
    const matchData = {
      documentId: 'doc-abc-123',
      storedHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      computedHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      match: true,
      verifiedAt: '2024-03-15T10:30:00Z',
    };

    beforeEach(() => {
      mockUseIntegrityVerify.mockReturnValue({
        mutate: mockMutate,
        data: matchData,
        isPending: false,
        isError: false,
      });
    });

    it('displays the stored hash', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('stored-hash')).toHaveTextContent(matchData.storedHash);
    });

    it('displays the computed hash', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('computed-hash')).toHaveTextContent(matchData.computedHash);
    });

    it('shows "Hashes match" with green shield icon', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByText('Hashes match')).toBeInTheDocument();
      const matchStatus = screen.getByTestId('match-status');
      expect(matchStatus.querySelector('[data-testid="icon-shield-check"]')).toBeInTheDocument();
    });

    it('displays the verifiedAt timestamp', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('verified-at')).toHaveTextContent('2024-03-15T10:30:00Z');
    });
  });

  describe('success state - hashes do not match', () => {
    const mismatchData = {
      documentId: 'doc-abc-123',
      storedHash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222',
      computedHash: 'xxxx9999yyyy8888zzzz7777wwww6666vvvv5555uuuu4444xxxx9999yyyy8888',
      match: false,
      verifiedAt: '2024-03-15T11:00:00Z',
    };

    beforeEach(() => {
      mockUseIntegrityVerify.mockReturnValue({
        mutate: mockMutate,
        data: mismatchData,
        isPending: false,
        isError: false,
      });
    });

    it('shows "Hashes do not match" with red shield icon', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByText('Hashes do not match')).toBeInTheDocument();
      const matchStatus = screen.getByTestId('match-status');
      expect(matchStatus.querySelector('[data-testid="icon-shield-alert"]')).toBeInTheDocument();
    });

    it('displays different stored and computed hashes', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('stored-hash')).toHaveTextContent(mismatchData.storedHash);
      expect(screen.getByTestId('computed-hash')).toHaveTextContent(mismatchData.computedHash);
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      mockUseIntegrityVerify.mockReturnValue({
        mutate: mockMutate,
        data: undefined,
        isPending: false,
        isError: true,
      });
    });

    it('displays "Verification unavailable" error message', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.getByTestId('integrity-error')).toHaveTextContent(
        'Verification unavailable',
      );
    });

    it('does not display result panel on error', () => {
      render(<IntegrityVerification documentId={documentId} />);

      expect(screen.queryByTestId('integrity-result')).not.toBeInTheDocument();
    });
  });
});
