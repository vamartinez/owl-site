// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DocumentMetadata } from '../DocumentMetadata';
import type { DocumentDetail, DocumentMetadataResponse } from '../types';

// Mock hooks
const mockUseDocumentMetadata = vi.fn();
vi.mock('../hooks/useDocumentMetadata', () => ({
  useDocumentMetadata: (id: string | null) => mockUseDocumentMetadata(id),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeDocumentDetail(overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc-123',
    name: 'Safety Report Q1.pdf',
    category: 'reports',
    mimeType: 'application/pdf',
    fileSize: 2048576,
    createdAt: '2024-03-15T10:30:00+00:00',
    siteName: 'Site Alpha',
    siteId: 'site-1',
    folderPath: ['Reports', 'Site Alpha', '2024', '03'],
    creatorUserId: 'user-456',
    creatorUserName: 'John Doe',
    tenantId: 'tenant-1',
    sha256Hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    downloadCount: 42,
    lastDownloadedAt: '2024-03-20T14:00:00+00:00',
    ...overrides,
  };
}

function makeMetadataResponse(
  docOverrides: Partial<DocumentDetail> = {},
): DocumentMetadataResponse {
  return {
    document: makeDocumentDetail(docOverrides),
    integrityStatus: 'verified',
    lastVerifiedAt: '2024-03-20T14:00:00+00:00',
  };
}

describe('DocumentMetadata', () => {
  describe('no document selected', () => {
    it('shows a prompt to select a document when documentId is null', () => {
      mockUseDocumentMetadata.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<DocumentMetadata documentId={null} />);

      expect(screen.getByTestId('document-metadata-empty')).toBeInTheDocument();
      expect(screen.getByText('Select a document to view its metadata')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    beforeEach(() => {
      mockUseDocumentMetadata.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('displays loading indicator while metadata is being fetched', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByTestId('document-metadata-loading')).toBeInTheDocument();
      expect(screen.getByText('Loading metadata…')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    const mockRefetch = vi.fn();

    beforeEach(() => {
      mockUseDocumentMetadata.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { message: 'Server error', status: 500 },
        refetch: mockRefetch,
      });
    });

    it('displays error message when fetch fails', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByTestId('document-metadata-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load document metadata')).toBeInTheDocument();
    });
  });

  describe('successful metadata display', () => {
    beforeEach(() => {
      mockUseDocumentMetadata.mockReturnValue({
        data: makeMetadataResponse(),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('displays the creation timestamp', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByText('2024-03-15T10:30:00+00:00')).toBeInTheDocument();
    });

    it('displays the creator user name', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('displays the site name', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByText('Site Alpha')).toBeInTheDocument();
    });

    it('displays the formatted document type', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('displays the SHA-256 hash truncated by default', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      const hashButton = screen.getByTestId('metadata-field-sha-256-hash')
        .querySelector('button');
      expect(hashButton).toBeInTheDocument();
      expect(hashButton!.textContent).toBe('a1b2c3d4e5f6a1b2…');
    });

    it('shows full hash when clicked', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      const hashButton = screen.getByTestId('metadata-field-sha-256-hash')
        .querySelector('button')!;

      fireEvent.click(hashButton);

      expect(hashButton.textContent).toBe(
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      );
    });

    it('displays the download count', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders the hash in monospace font', () => {
      render(<DocumentMetadata documentId="doc-123" />);

      const hashButton = screen.getByTestId('metadata-field-sha-256-hash')
        .querySelector('button');
      expect(hashButton).toHaveClass('font-mono');
    });
  });

  describe('partial unavailability', () => {
    it('shows "Unavailable" for null creatorUserName', () => {
      mockUseDocumentMetadata.mockReturnValue({
        data: makeMetadataResponse({ creatorUserName: null as unknown as string }),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<DocumentMetadata documentId="doc-123" />);

      const creatorField = screen.getByTestId('metadata-field-creator');
      expect(creatorField).toHaveTextContent('Unavailable');
    });

    it('shows "Unavailable" for null sha256Hash', () => {
      mockUseDocumentMetadata.mockReturnValue({
        data: makeMetadataResponse({ sha256Hash: null as unknown as string }),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<DocumentMetadata documentId="doc-123" />);

      const hashField = screen.getByTestId('metadata-field-sha-256-hash');
      expect(hashField).toHaveTextContent('Unavailable');
    });

    it('shows "Unavailable" for null siteName', () => {
      mockUseDocumentMetadata.mockReturnValue({
        data: makeMetadataResponse({ siteName: null as unknown as string }),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<DocumentMetadata documentId="doc-123" />);

      const siteField = screen.getByTestId('metadata-field-site');
      expect(siteField).toHaveTextContent('Unavailable');
    });

    it('displays available fields alongside unavailable ones', () => {
      mockUseDocumentMetadata.mockReturnValue({
        data: makeMetadataResponse({
          creatorUserName: null as unknown as string,
          sha256Hash: null as unknown as string,
        }),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<DocumentMetadata documentId="doc-123" />);

      // Available fields still show
      expect(screen.getByText('2024-03-15T10:30:00+00:00')).toBeInTheDocument();
      expect(screen.getByText('Site Alpha')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();

      // Unavailable fields show indicator
      const creatorField = screen.getByTestId('metadata-field-creator');
      expect(creatorField).toHaveTextContent('Unavailable');
      const hashField = screen.getByTestId('metadata-field-sha-256-hash');
      expect(hashField).toHaveTextContent('Unavailable');
    });
  });
});
