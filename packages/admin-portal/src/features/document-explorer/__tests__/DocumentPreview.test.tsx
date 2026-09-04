// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DocumentPreview } from '../DocumentPreview';

// Mock hooks
const mockUseDocumentPreview = vi.fn();
vi.mock('../hooks/useDocumentPreview', () => ({
  useDocumentPreview: (opts: unknown) => mockUseDocumentPreview(opts),
}));

const mockStartDownload = vi.fn();
vi.mock('../hooks/useDocumentDownload', () => ({
  useDocumentDownload: () => ({
    startDownload: mockStartDownload,
  }),
}));

let mockPreviewDocumentId: string | null = 'doc-1';
const mockClosePreview = vi.fn();

vi.mock('../store', () => ({
  useDocExplorerStore: (selector: (state: unknown) => unknown) => {
    const state = {
      previewDocumentId: mockPreviewDocumentId,
      closePreview: mockClosePreview,
    };
    return selector(state);
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockPreviewDocumentId = 'doc-1';
});

describe('DocumentPreview', () => {
  describe('when no document is selected', () => {
    beforeEach(() => {
      mockPreviewDocumentId = null;
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: null,
        isLoading: false,
        isError: false,
      });
    });

    it('renders nothing when previewDocumentId is null', () => {
      const { container } = render(<DocumentPreview mimeType="application/pdf" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('loading state', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: null,
        isLoading: true,
        isError: false,
      });
    });

    it('displays loading indicator while fetching preview', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      expect(screen.getByTestId('preview-loading')).toBeInTheDocument();
    });
  });

  describe('PDF preview', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: 'https://s3.example.com/doc-1-preview.pdf',
        isLoading: false,
        isError: false,
      });
    });

    it('renders an iframe for PDF documents', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      const iframe = screen.getByTestId('preview-iframe');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute('src', 'https://s3.example.com/doc-1-preview.pdf');
    });

    it('sets accessible title on the iframe', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      const iframe = screen.getByTestId('preview-iframe');
      expect(iframe).toHaveAttribute('title', 'Document preview');
    });
  });

  describe('image preview (JPEG)', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: 'https://s3.example.com/photo.jpg',
        isLoading: false,
        isError: false,
      });
    });

    it('renders an img element for JPEG images', () => {
      render(<DocumentPreview mimeType="image/jpeg" />);
      const img = screen.getByTestId('preview-image');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://s3.example.com/photo.jpg');
    });

    it('provides alt text for the image', () => {
      render(<DocumentPreview mimeType="image/jpeg" />);
      const img = screen.getByTestId('preview-image');
      expect(img).toHaveAttribute('alt', 'Document preview');
    });
  });

  describe('image preview (PNG)', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: 'https://s3.example.com/diagram.png',
        isLoading: false,
        isError: false,
      });
    });

    it('renders an img element for PNG images', () => {
      render(<DocumentPreview mimeType="image/png" />);
      const img = screen.getByTestId('preview-image');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://s3.example.com/diagram.png');
    });
  });

  describe('non-previewable format', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: null,
        isLoading: false,
        isError: false,
      });
    });

    it('shows unavailable message for non-previewable formats', () => {
      render(<DocumentPreview mimeType="application/msword" />);
      expect(screen.getByTestId('preview-unavailable')).toBeInTheDocument();
      expect(
        screen.getByText('Preview unavailable for this format'),
      ).toBeInTheDocument();
    });

    it('provides download button as alternative', () => {
      render(<DocumentPreview mimeType="application/msword" />);
      expect(screen.getByTestId('preview-download-button')).toBeInTheDocument();
    });

    it('calls startDownload when download button is clicked', () => {
      render(<DocumentPreview mimeType="application/msword" />);
      fireEvent.click(screen.getByTestId('preview-download-button'));
      expect(mockStartDownload).toHaveBeenCalledWith([{ id: 'doc-1', fileSize: 0 }]);
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: null,
        isLoading: false,
        isError: true,
      });
    });

    it('shows unavailable message when preview fetch errors', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      expect(screen.getByTestId('preview-unavailable')).toBeInTheDocument();
    });
  });

  describe('close button', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: 'https://s3.example.com/doc.pdf',
        isLoading: false,
        isError: false,
      });
    });

    it('renders a close button', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      expect(screen.getByTestId('preview-close-button')).toBeInTheDocument();
    });

    it('calls closePreview when close button is clicked', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      fireEvent.click(screen.getByTestId('preview-close-button'));
      expect(mockClosePreview).toHaveBeenCalledOnce();
    });

    it('has accessible label on close button', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      expect(screen.getByRole('button', { name: /close preview/i })).toBeInTheDocument();
    });
  });

  describe('panel structure', () => {
    beforeEach(() => {
      mockUseDocumentPreview.mockReturnValue({
        previewUrl: 'https://s3.example.com/doc.pdf',
        isLoading: false,
        isError: false,
      });
    });

    it('renders the preview panel container', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      expect(screen.getByTestId('document-preview-panel')).toBeInTheDocument();
    });

    it('renders a resize handle', () => {
      render(<DocumentPreview mimeType="application/pdf" />);
      expect(screen.getByTestId('preview-resize-handle')).toBeInTheDocument();
    });
  });
});
