// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DisclaimerModal } from '../DisclaimerModal';

// Mock the useDisclaimerAck hook
const mockAcknowledge = vi.fn();
vi.mock('../hooks/useDisclaimerAck', () => ({
  useDisclaimerAck: () => ({
    hasAcknowledged: false,
    acknowledge: mockAcknowledge,
    reset: vi.fn(),
  }),
}));

// Mock HTMLDialogElement methods for jsdom
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  mockAcknowledge.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('DisclaimerModal', () => {
  const defaultProps = {
    open: true,
    onAcknowledge: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onAcknowledge.mockClear();
    defaultProps.onCancel.mockClear();
  });

  it('renders disclaimer text when open', () => {
    render(<DisclaimerModal {...defaultProps} />);
    expect(
      screen.getByText(/This AI-generated compliance analysis is provided as advisory support only/)
    ).toBeInTheDocument();
  });

  it('renders the modal title', () => {
    render(<DisclaimerModal {...defaultProps} />);
    expect(screen.getByText('AI Validation Disclaimer')).toBeInTheDocument();
  });

  it('renders acknowledgment checkbox unchecked by default', () => {
    render(<DisclaimerModal {...defaultProps} />);
    const checkbox = screen.getByRole('checkbox', { hidden: true });
    expect(checkbox).not.toBeChecked();
  });

  it('disables "Acknowledge & Continue" button when checkbox is not checked', () => {
    render(<DisclaimerModal {...defaultProps} />);
    const button = screen.getByRole('button', { name: /Acknowledge & Continue/i, hidden: true });
    expect(button).toBeDisabled();
  });

  it('enables "Acknowledge & Continue" button when checkbox is checked', () => {
    render(<DisclaimerModal {...defaultProps} />);
    const checkbox = screen.getByRole('checkbox', { hidden: true });
    fireEvent.click(checkbox);
    const button = screen.getByRole('button', { name: /Acknowledge & Continue/i, hidden: true });
    expect(button).not.toBeDisabled();
  });

  it('calls onAcknowledge and acknowledge() when user checks and clicks continue', () => {
    render(<DisclaimerModal {...defaultProps} />);
    const checkbox = screen.getByRole('checkbox', { hidden: true });
    fireEvent.click(checkbox);
    const button = screen.getByRole('button', { name: /Acknowledge & Continue/i, hidden: true });
    fireEvent.click(button);
    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('does not call onAcknowledge when checkbox is not checked and button is clicked', () => {
    render(<DisclaimerModal {...defaultProps} />);
    const button = screen.getByRole('button', { name: /Acknowledge & Continue/i, hidden: true });
    fireEvent.click(button);
    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(defaultProps.onAcknowledge).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    render(<DisclaimerModal {...defaultProps} />);
    const cancelButton = screen.getByRole('button', { name: /^Cancel$/i, hidden: true });
    fireEvent.click(cancelButton);
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    render(<DisclaimerModal {...defaultProps} open={false} />);
    expect(
      screen.queryByText(/This AI-generated compliance analysis/)
    ).not.toBeInTheDocument();
  });

  it('displays the acknowledgment label text', () => {
    render(<DisclaimerModal {...defaultProps} />);
    expect(
      screen.getByText(/I understand that this AI analysis is advisory only/)
    ).toBeInTheDocument();
  });
});
