// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DownloadProgressBar } from '../DownloadProgressBar';
import type { DownloadProgress } from '../types';

afterEach(() => {
  cleanup();
});

function createProgress(overrides: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    downloadId: 'test-dl-1',
    status: 'downloading',
    bytesDownloaded: 50 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    startedAt: Date.now() - 10000,
    estimatedRemainingMs: 10000,
    ...overrides,
  };
}

describe('DownloadProgressBar', () => {
  describe('timeout status', () => {
    it('displays timeout message', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'timeout' })} />);

      expect(screen.getByText('Download timed out')).toBeInTheDocument();
    });

    it('has an alert role', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'timeout' })} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('failed status', () => {
    it('displays failure message', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'failed' })} />);

      expect(screen.getByText('Download failed')).toBeInTheDocument();
    });

    it('displays the error message when provided', () => {
      render(
        <DownloadProgressBar
          progress={createProgress({ status: 'failed', errorMessage: 'Network error occurred' })}
        />,
      );

      expect(screen.getByText('Network error occurred')).toBeInTheDocument();
    });

    it('has an alert role', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'failed' })} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('complete status', () => {
    it('displays complete message', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'complete' })} />);

      expect(screen.getByText('Download complete')).toBeInTheDocument();
    });

    it('has a status role', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'complete' })} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('initiating status', () => {
    it('displays preparing message without percentage', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'initiating' })} />);

      expect(screen.getByText('Preparing download...')).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });
  });

  describe('packaging status', () => {
    it('displays preparing message without percentage', () => {
      render(<DownloadProgressBar progress={createProgress({ status: 'packaging' })} />);

      expect(screen.getByText('Preparing download...')).toBeInTheDocument();
    });
  });

  describe('downloading status', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:10.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders a progress bar with the correct percentage', () => {
      const progress = createProgress({
        bytesDownloaded: 50 * 1024 * 1024,
        totalBytes: 100 * 1024 * 1024,
        startedAt: new Date('2024-06-01T12:00:00.000Z').getTime(),
      });

      render(<DownloadProgressBar progress={progress} />);

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    });

    it('shows bytes downloaded and total bytes formatted', () => {
      const progress = createProgress({
        bytesDownloaded: 50 * 1024 * 1024,
        totalBytes: 100 * 1024 * 1024,
        startedAt: new Date('2024-06-01T12:00:00.000Z').getTime(),
      });

      render(<DownloadProgressBar progress={progress} />);

      expect(screen.getByText(/50\.0 MB/)).toBeInTheDocument();
      expect(screen.getByText(/100\.0 MB/)).toBeInTheDocument();
    });

    it('shows estimated time remaining in seconds', () => {
      const progress = createProgress({
        bytesDownloaded: 50 * 1024 * 1024,
        totalBytes: 100 * 1024 * 1024,
        startedAt: new Date('2024-06-01T12:00:00.000Z').getTime(),
      });

      render(<DownloadProgressBar progress={progress} />);

      expect(screen.getByText(/About \d+ seconds remaining/)).toBeInTheDocument();
    });

    it('shows estimated time remaining in minutes when more than 60 seconds', () => {
      // Slow download: 1MB downloaded in 10 seconds, 99MB remaining → ~990s → ~17min
      const progress = createProgress({
        bytesDownloaded: 1 * 1024 * 1024,
        totalBytes: 100 * 1024 * 1024,
        startedAt: new Date('2024-06-01T12:00:00.000Z').getTime(),
      });

      render(<DownloadProgressBar progress={progress} />);

      expect(screen.getByText(/About \d+ minutes remaining/)).toBeInTheDocument();
    });

    it('formats small file sizes in KB', () => {
      const progress = createProgress({
        bytesDownloaded: 512 * 1024,
        totalBytes: 1024 * 1024,
        startedAt: new Date('2024-06-01T12:00:00.000Z').getTime(),
      });

      render(<DownloadProgressBar progress={progress} />);

      expect(screen.getByText(/512\.0 KB/)).toBeInTheDocument();
    });

    it('has aria-valuemin and aria-valuemax on the progress bar', () => {
      const progress = createProgress({
        startedAt: new Date('2024-06-01T12:00:00.000Z').getTime(),
      });

      render(<DownloadProgressBar progress={progress} />);

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuemin', '0');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
    });
  });
});
