// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SubmitConfirmDialog } from '../SubmitConfirmDialog';

// jsdom does not implement HTMLDialogElement methods
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('SubmitConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  describe('when open', () => {
    it('renders the dialog with warning message', () => {
      render(<SubmitConfirmDialog {...defaultProps} />);
      expect(
        screen.getByText(/has not been validated for compliance/)
      ).toBeInTheDocument();
    });

    it('displays "Confirm Submission" button', () => {
      render(<SubmitConfirmDialog {...defaultProps} />);
      expect(
        screen.getByRole('button', { name: 'Confirm Submission', hidden: true })
      ).toBeInTheDocument();
    });

    it('displays "Cancel" button', () => {
      render(<SubmitConfirmDialog {...defaultProps} />);
      expect(
        screen.getByRole('button', { name: 'Cancel', hidden: true })
      ).toBeInTheDocument();
    });

    it('displays the dialog title', () => {
      render(<SubmitConfirmDialog {...defaultProps} />);
      expect(screen.getByText('Submit Without Validation')).toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('calls onConfirm when "Confirm Submission" is clicked', () => {
      const onConfirm = vi.fn();
      render(<SubmitConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm Submission', hidden: true })
      );
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when "Cancel" is clicked', () => {
      const onCancel = vi.fn();
      render(<SubmitConfirmDialog {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel', hidden: true })
      );
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('when closed', () => {
    it('does not render dialog content when isOpen is false', () => {
      render(<SubmitConfirmDialog {...defaultProps} isOpen={false} />);
      expect(
        screen.queryByText(/has not been validated for compliance/)
      ).not.toBeInTheDocument();
    });
  });
});
