// @vitest-environment jsdom
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ValidationProgress } from '../ValidationProgress';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ValidationProgress', () => {
  const now = new Date('2024-01-15T10:00:00Z').getTime();

  describe('shows stages', () => {
    it('renders all 4 stages', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.getByText('Document Extraction')).toBeInTheDocument();
      expect(screen.getByText('Knowledge Base Query')).toBeInTheDocument();
      expect(screen.getByText('Compliance Analysis')).toBeInTheDocument();
      expect(screen.getByText('Result Generation')).toBeInTheDocument();
    });

    it('renders a progress indicator', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('elapsed time', () => {
    it('displays elapsed time starting from 0s', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.getByText('0s')).toBeInTheDocument();
    });

    it('updates elapsed time each second', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      // Advance system time and trigger the interval
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // After 3 seconds, elapsed should show 3s
      expect(screen.getByText('3s')).toBeInTheDocument();
    });

    it('formats elapsed time with minutes when >= 60s', () => {
      vi.setSystemTime(now + 65000);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.getByText('1m 5s')).toBeInTheDocument();
    });
  });

  describe('estimated time', () => {
    it('shows estimated time of 30s for 1-5 page documents', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" pageCount={3} />);

      expect(screen.getByText(/Estimated time: ~30s/)).toBeInTheDocument();
    });

    it('shows estimated time of 60s for 6-20 page documents', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" pageCount={15} />);

      expect(screen.getByText(/Estimated time: ~60s/)).toBeInTheDocument();
    });

    it('shows estimated time of 90s for 21+ page documents', () => {
      vi.setSystemTime(now);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" pageCount={50} />);

      expect(screen.getByText(/Estimated time: ~90s/)).toBeInTheDocument();
    });
  });

  describe('handles timeout', () => {
    it('shows timeout message after 5 minutes', () => {
      vi.setSystemTime(now + 5 * 60 * 1000);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.getByText('Validation Timed Out')).toBeInTheDocument();
    });

    it('shows retry button on timeout when onRetry is provided', () => {
      vi.setSystemTime(now + 5 * 60 * 1000);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" onRetry={vi.fn()} />);

      expect(screen.getByRole('button', { name: /Retry Validation/ })).toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', () => {
      vi.setSystemTime(now + 5 * 60 * 1000);
      const onRetry = vi.fn();
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" onRetry={onRetry} />);

      fireEvent.click(screen.getByRole('button', { name: /Retry Validation/ }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not show retry button when onRetry is not provided', () => {
      vi.setSystemTime(now + 5 * 60 * 1000);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.queryByRole('button', { name: /Retry Validation/ })).not.toBeInTheDocument();
    });
  });

  describe('restores state on navigation return', () => {
    it('calculates elapsed time from requestedAt when component mounts', () => {
      // Simulate mounting 20 seconds after the request was made
      vi.setSystemTime(now + 20000);
      render(<ValidationProgress requestedAt="2024-01-15T10:00:00Z" />);

      expect(screen.getByText('20s')).toBeInTheDocument();
    });
  });
});
