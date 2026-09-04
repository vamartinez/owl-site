// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DocumentList } from '../DocumentList';
import type { DocumentSummary } from '../types';

// Mock hooks
const mockUseDocuments = vi.fn();
vi.mock('../hooks/useDocuments', () => ({
  useDocuments: () => mockUseDocuments(),
}));

const mockToggleDocumentSelection = vi.fn();
const mockSelectAll = vi.fn();
const mockClearSelection = vi.fn();
const mockOpenPreview = vi.fn();
let mockSelectedDocumentIds = new Set<string>();

vi.mock('../store', () => ({
  useDocExplorerStore: (selector: (state: unknown) => unknown) => {
    const state = {
      selectedDocumentIds: mockSelectedDocumentIds,
      toggleDocumentSelection: mockToggleDocumentSelection,
      selectAll: mockSelectAll,
      clearSelection: mockClearSelection,
      openPreview: mockOpenPreview,
    };
    return selector(state);
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSelectedDocumentIds = new Set<string>();
});

function makeDocument(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    name: 'Safety Report Q1.pdf',
    category: 'reports',
    mimeType: 'application/pdf',
    fileSize: 1048576, // 1 MB
    createdAt: '2024-03-15T10:30:00Z',
    siteName: 'Site Alpha',
    siteId: 'site-1',
    folderPath: ['Reports', 'Site Alpha', '2024', '03'],
    ...overrides,
  };
}

describe('DocumentList', () => {
  describe('loading state', () => {
    beforeEach(() => {
      mockUseDocuments.mockReturnValue({
        documents: [],
        isLoading: true,
        isError: false,
        error: null,
        page: 1,
        totalPages: 0,
        goToPage: vi.fn(),
      });
    });

    it('displays loading skeleton while fetching', () => {
      render(<DocumentList />);
      expect(screen.getByTestId('document-list-loading')).toBeInTheDocument();
    });

    it('renders animated placeholder elements', () => {
      render(<DocumentList />);
      expect(screen.getByTestId('document-list-loading')).toHaveClass('animate-pulse');
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockUseDocuments.mockReturnValue({
        documents: [],
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        totalPages: 0,
        goToPage: vi.fn(),
      });
    });

    it('displays empty state message when no documents exist', () => {
      render(<DocumentList />);
      expect(screen.getByTestId('document-list-empty')).toBeInTheDocument();
      expect(screen.getByText('No documents')).toBeInTheDocument();
    });

    it('provides a descriptive message about the empty folder', () => {
      render(<DocumentList />);
      expect(
        screen.getByText('There are no documents available in this folder.'),
      ).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      mockUseDocuments.mockReturnValue({
        documents: [],
        isLoading: false,
        isError: true,
        error: new Error('Network error'),
        page: 1,
        totalPages: 0,
        goToPage: vi.fn(),
      });
    });

    it('displays error message when fetch fails', () => {
      render(<DocumentList />);
      expect(screen.getByText('Failed to load documents')).toBeInTheDocument();
    });
  });

  describe('document rows rendering', () => {
    const documents: DocumentSummary[] = [
      makeDocument({ id: 'doc-1', name: 'Safety Report Q1.pdf', category: 'reports', fileSize: 1048576, siteName: 'Site Alpha', createdAt: '2024-03-15T10:30:00Z' }),
      makeDocument({ id: 'doc-2', name: 'Incident Form.docx', category: 'incidents', fileSize: 2097152, siteName: 'Site Beta', createdAt: '2024-02-10T08:00:00Z' }),
    ];

    beforeEach(() => {
      mockUseDocuments.mockReturnValue({
        documents,
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        totalPages: 1,
        goToPage: vi.fn(),
      });
    });

    it('renders document names', () => {
      render(<DocumentList />);
      expect(screen.getByText('Safety Report Q1.pdf')).toBeInTheDocument();
      expect(screen.getByText('Incident Form.docx')).toBeInTheDocument();
    });

    it('renders document category as formatted label', () => {
      render(<DocumentList />);
      expect(screen.getByText('Reports')).toBeInTheDocument();
      expect(screen.getByText('Incidents')).toBeInTheDocument();
    });

    it('renders site name for each document', () => {
      render(<DocumentList />);
      expect(screen.getByText('Site Alpha')).toBeInTheDocument();
      expect(screen.getByText('Site Beta')).toBeInTheDocument();
    });

    it('renders formatted file size', () => {
      render(<DocumentList />);
      expect(screen.getByText('1.0 MB')).toBeInTheDocument();
      expect(screen.getByText('2.0 MB')).toBeInTheDocument();
    });

    it('renders creation date', () => {
      render(<DocumentList />);
      expect(screen.getByText('Mar 15, 2024')).toBeInTheDocument();
      expect(screen.getByText('Feb 10, 2024')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    const documents: DocumentSummary[] = [
      makeDocument({ id: 'doc-1', name: 'Report A.pdf' }),
      makeDocument({ id: 'doc-2', name: 'Report B.pdf' }),
    ];

    beforeEach(() => {
      mockUseDocuments.mockReturnValue({
        documents,
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        totalPages: 1,
        goToPage: vi.fn(),
      });
    });

    it('renders a checkbox for each document row', () => {
      render(<DocumentList />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /select/i });
      // 2 document checkboxes + 1 select-all
      expect(checkboxes.length).toBe(3);
    });

    it('calls toggleDocumentSelection when a row checkbox is clicked', () => {
      render(<DocumentList />);
      const checkbox = screen.getByRole('checkbox', { name: /select report a\.pdf/i });
      fireEvent.click(checkbox);
      expect(mockToggleDocumentSelection).toHaveBeenCalledWith('doc-1');
    });

    it('shows checkbox as checked when document is selected', () => {
      mockSelectedDocumentIds = new Set(['doc-1']);
      render(<DocumentList />);
      const checkbox = screen.getByRole('checkbox', { name: /select report a\.pdf/i });
      expect(checkbox).toBeChecked();
    });

    it('calls selectAll when select-all checkbox is clicked (none selected)', () => {
      render(<DocumentList />);
      const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
      fireEvent.click(selectAllCheckbox);
      expect(mockSelectAll).toHaveBeenCalledWith(['doc-1', 'doc-2']);
    });

    it('calls clearSelection when select-all is clicked (all selected)', () => {
      mockSelectedDocumentIds = new Set(['doc-1', 'doc-2']);
      render(<DocumentList />);
      const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
      fireEvent.click(selectAllCheckbox);
      expect(mockClearSelection).toHaveBeenCalled();
    });
  });

  describe('row click to preview', () => {
    const documents: DocumentSummary[] = [
      makeDocument({ id: 'doc-1', name: 'Report A.pdf' }),
    ];

    beforeEach(() => {
      mockUseDocuments.mockReturnValue({
        documents,
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        totalPages: 1,
        goToPage: vi.fn(),
      });
    });

    it('calls openPreview with document id when row is clicked', () => {
      render(<DocumentList />);
      fireEvent.click(screen.getByTestId('document-row-doc-1'));
      expect(mockOpenPreview).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('pagination', () => {
    it('does not render pagination when totalPages is 1', () => {
      mockUseDocuments.mockReturnValue({
        documents: [makeDocument()],
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        totalPages: 1,
        goToPage: vi.fn(),
      });
      render(<DocumentList />);
      // Pagination component should not be rendered
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
  });
});
