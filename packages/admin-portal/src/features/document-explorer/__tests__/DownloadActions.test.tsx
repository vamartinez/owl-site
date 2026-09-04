// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DownloadActions } from '../DownloadActions';
import type { DocumentSummary, DownloadProgress } from '../types';

// Mock hooks
const mockStartDownload = vi.fn();
const mockReset = vi.fn();
vi.mock('../hooks/useDocumentDownload', () => ({
  useDocumentDownload: () => ({
    startDownload: mockStartDownload,
    isInitiating: false,
    error: null,
    reset: mockReset,
  }),
}));

let mockSelectedDocumentIds = new Set<string>();
let mockActiveDownload: DownloadProgress | null = null;

vi.mock('../store', () => ({
  useDocExplorerStore: (selector: (state: unknown) => unknown) => {
    const state = {
      selectedDocumentIds: mockSelectedDocumentIds,
      activeDownload: mockActiveDownload,
    };
    return selector(state);
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSelectedDocumentIds = new Set<string>();
  mockActiveDownload = null;
});

function makeDocument(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    name: 'Report.pdf',
    category: 'reports',
    mimeType: 'application/pdf',
    fileSize: 1048576,
    createdAt: '2024-03-15T10:30:00Z',
    siteName: 'Site Alpha',
    siteId: 'site-1',
    folderPath: ['Reports'],
    ...overrides,
  };
}

describe('DownloadActions', () => {
  describe('button states', () => {
    it('renders download button as disabled when no documents are selected', () => {
      const documents = [makeDocument()];
      render(<DownloadActions documents={documents} />);
      const button = screen.getByRole('button', { name: /download/i });
      expect(button).toBeDisabled();
    });

    it('renders download button as enabled when documents are selected', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      const button = screen.getByRole('button', { name: /download/i });
      expect(button).not.toBeDisabled();
    });

    it('shows "Download" label when 0 or 1 document is selected', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByRole('button', { name: /download/i })).toHaveTextContent('Download');
    });

    it('shows "Download (N)" label when multiple documents are selected', () => {
      mockSelectedDocumentIds = new Set(['doc-1', 'doc-2']);
      const documents = [
        makeDocument({ id: 'doc-1' }),
        makeDocument({ id: 'doc-2', name: 'Report2.pdf' }),
      ];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByRole('button', { name: /download \(2\)/i })).toBeInTheDocument();
    });

    it('calls startDownload when button is clicked', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      fireEvent.click(screen.getByRole('button', { name: /download/i }));
      expect(mockStartDownload).toHaveBeenCalledWith([documents[0]]);
    });
  });

  describe('validation errors', () => {
    it('shows size limit error when selected documents exceed 500 MB', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      const documents = [makeDocument({ id: 'doc-1', fileSize: 600 * 1024 * 1024 })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByRole('alert')).toHaveTextContent(/500 MB size limit/);
    });

    it('disables download button when validation error exists', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      const documents = [makeDocument({ id: 'doc-1', fileSize: 600 * 1024 * 1024 })];
      render(<DownloadActions documents={documents} />);
      const button = screen.getByRole('button', { name: /download/i });
      expect(button).toBeDisabled();
    });
  });

  describe('progress display', () => {
    it('renders progress bar during active download', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      mockActiveDownload = {
        downloadId: 'dl-1',
        status: 'downloading',
        bytesDownloaded: 524288,
        totalBytes: 1048576,
        startedAt: Date.now() - 5000,
        estimatedRemainingMs: 5000,
      };
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('disables download button during active download', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      mockActiveDownload = {
        downloadId: 'dl-1',
        status: 'downloading',
        bytesDownloaded: 524288,
        totalBytes: 1048576,
        startedAt: Date.now() - 5000,
        estimatedRemainingMs: 5000,
      };
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      const button = screen.getByRole('button', { name: /download/i });
      expect(button).toBeDisabled();
    });

    it('shows preparing state text during initiating', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      mockActiveDownload = {
        downloadId: 'dl-1',
        status: 'initiating',
        bytesDownloaded: 0,
        totalBytes: 1048576,
        startedAt: Date.now(),
        estimatedRemainingMs: null,
      };
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByText('Preparing download...')).toBeInTheDocument();
    });
  });

  describe('error state with retry', () => {
    beforeEach(() => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      mockActiveDownload = {
        downloadId: 'dl-1',
        status: 'failed',
        bytesDownloaded: 0,
        totalBytes: 1048576,
        startedAt: Date.now() - 10000,
        estimatedRemainingMs: null,
        errorMessage: 'Download failed on the server.',
      };
    });

    it('displays error message on failure', () => {
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByText('Download failed')).toBeInTheDocument();
    });

    it('renders retry button on failure', () => {
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('calls startDownload when retry is clicked', () => {
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(mockStartDownload).toHaveBeenCalledWith([documents[0]]);
    });

    it('renders dismiss button on failure', () => {
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('calls reset when dismiss button is clicked', () => {
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(mockReset).toHaveBeenCalledOnce();
    });
  });

  describe('timeout state', () => {
    it('displays timeout message', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      mockActiveDownload = {
        downloadId: 'dl-1',
        status: 'timeout',
        bytesDownloaded: 500000,
        totalBytes: 1048576,
        startedAt: Date.now() - 120000,
        estimatedRemainingMs: null,
        errorMessage: 'Download timed out after 120 seconds.',
      };
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByText('Download timed out')).toBeInTheDocument();
    });
  });

  describe('complete state', () => {
    it('displays complete message and dismiss button', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      mockActiveDownload = {
        downloadId: 'dl-1',
        status: 'complete',
        bytesDownloaded: 1048576,
        totalBytes: 1048576,
        startedAt: Date.now() - 5000,
        estimatedRemainingMs: 0,
      };
      const documents = [makeDocument({ id: 'doc-1' })];
      render(<DownloadActions documents={documents} />);
      expect(screen.getByText('Download complete')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });
  });
});
