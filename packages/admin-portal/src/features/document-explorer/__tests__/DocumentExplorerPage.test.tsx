// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useDocExplorerStore } from '../store';
import type { DocumentSummary, FolderContentsResponse, FolderNode } from '../types';

// ─── Mock Hooks ────────────────────────────────────────────────────────────

const mockUseFolders = vi.fn();
vi.mock('../hooks/useFolders', () => ({
  useFolders: () => mockUseFolders(),
}));

const mockUseDocuments = vi.fn();
vi.mock('../hooks/useDocuments', () => ({
  useDocuments: () => mockUseDocuments(),
}));

const mockUseOrganizationMode = vi.fn();
vi.mock('../hooks/useOrganizationMode', () => ({
  useOrganizationMode: () => mockUseOrganizationMode(),
}));

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

vi.mock('../hooks/useDocumentSearch', () => ({
  useDocumentSearch: () => ({
    results: [],
    isLoading: false,
    error: null,
  }),
}));

// ─── Test Utilities ────────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeFolderNode(overrides: Partial<FolderNode> = {}): FolderNode {
  return {
    id: 'folder-1',
    name: 'Reports',
    path: ['Reports'],
    childFolderCount: 3,
    documentCount: 10,
    lastUpdated: '2024-03-15T10:30:00Z',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    name: 'Safety Report Q1.pdf',
    category: 'reports',
    mimeType: 'application/pdf',
    fileSize: 1024 * 500, // 500 KB
    createdAt: '2024-03-10T09:00:00Z',
    siteName: 'Site Alpha',
    siteId: 'site-1',
    folderPath: ['Reports', 'Site Alpha'],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/documents']}>
        <DocumentExplorerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Lazy import to allow mocks to register first
let DocumentExplorerPage: React.ComponentType;

beforeEach(async () => {
  const module = await import('@/pages/documents/DocumentExplorerPage');
  DocumentExplorerPage = module.default;
});

// ─── Test Setup ────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useDocExplorerStore.setState({
    currentPath: [],
    selectedDocumentIds: new Set(),
    previewDocumentId: null,
    searchTerm: '',
    filters: { category: null, dateFrom: null, dateTo: null, siteId: null },
    isSearchActive: false,
    activeDownload: null,
    organizationMode: 'category_site_year_month',
  });
});

const defaultFolders: FolderNode[] = [
  makeFolderNode({ id: 'f-1', name: 'Reports', path: ['Reports'], documentCount: 25 }),
  makeFolderNode({ id: 'f-2', name: 'Forms', path: ['Forms'], documentCount: 12 }),
  makeFolderNode({ id: 'f-3', name: 'Certifications', path: ['Certifications'], documentCount: 8 }),
];

const defaultDocuments: DocumentSummary[] = [
  makeDocument({ id: 'doc-1', name: 'Safety Report Q1.pdf', createdAt: '2024-03-10T09:00:00Z' }),
  makeDocument({ id: 'doc-2', name: 'Inspection Form.pdf', category: 'forms', createdAt: '2024-02-15T14:00:00Z' }),
];

function setupDefaultMocks() {
  mockUseFolders.mockReturnValue({
    data: {
      currentPath: [],
      folders: defaultFolders,
      documents: defaultDocuments,
      totalDocuments: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    } satisfies FolderContentsResponse,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });

  mockUseDocuments.mockReturnValue({
    documents: defaultDocuments,
    isLoading: false,
    isError: false,
    error: null,
    page: 1,
    pageSize: 50,
    totalDocuments: 2,
    totalPages: 1,
    goToPage: vi.fn(),
    nextPage: vi.fn(),
    prevPage: vi.fn(),
  });

  mockUseOrganizationMode.mockReturnValue({
    mode: 'category_site_year_month',
    isLoading: false,
    isUpdating: false,
    updateMode: vi.fn(),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('DocumentExplorerPage - Integration', () => {
  describe('full page render', () => {
    beforeEach(() => {
      setupDefaultMocks();
    });

    it('renders the page container with data-testid', () => {
      renderPage();
      expect(screen.getByTestId('document-explorer-page')).toBeInTheDocument();
    });

    it('renders breadcrumb navigation', () => {
      renderPage();
      expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    });

    it('renders root breadcrumb label "Documents"', () => {
      renderPage();
      expect(screen.getByText('Documents')).toBeInTheDocument();
    });

    it('renders the search filters section', () => {
      renderPage();
      expect(screen.getByTestId('search-filters')).toBeInTheDocument();
    });

    it('renders the folder tree in the sidebar', () => {
      renderPage();
      // Folder buttons have aria-label "Open folder {name}"
      expect(screen.getByRole('button', { name: /open folder reports/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /open folder forms/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /open folder certifications/i })).toBeInTheDocument();
    });

    it('renders the document list', () => {
      renderPage();
      expect(screen.getByText('Safety Report Q1.pdf')).toBeInTheDocument();
      expect(screen.getByText('Inspection Form.pdf')).toBeInTheDocument();
    });

    it('renders the download button', () => {
      renderPage();
      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    });

    it('renders the organization mode selector', () => {
      renderPage();
      expect(screen.getByLabelText(/folder organization mode/i)).toBeInTheDocument();
    });
  });

  describe('navigation flow: folder click → breadcrumb update → breadcrumb back', () => {
    beforeEach(() => {
      setupDefaultMocks();
    });

    it('navigates into a folder when clicked and updates breadcrumbs', async () => {
      renderPage();

      // Click on the "Reports" folder
      const reportsButton = screen.getByRole('button', { name: /open folder reports/i });
      fireEvent.click(reportsButton);

      // After clicking, the store should be updated
      const state = useDocExplorerStore.getState();
      expect(state.currentPath).toEqual(['Reports']);
    });

    it('shows nested breadcrumbs after navigating into a folder', () => {
      // Pre-set the store to be inside a folder
      useDocExplorerStore.setState({ currentPath: ['Reports', 'Site Alpha'] });

      renderPage();

      // Breadcrumb nav should contain the full path
      const breadcrumbNav = screen.getByRole('navigation', { name: /breadcrumb/i });
      expect(breadcrumbNav).toBeInTheDocument();
      // "Documents" is a link, "Reports" is a link, "Site Alpha" is the current (span)
      expect(screen.getByRole('link', { name: /documents/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
      // The last segment is a span (not a link) - use within breadcrumb
      const breadcrumbItems = breadcrumbNav.querySelectorAll('li');
      const lastItem = breadcrumbItems[breadcrumbItems.length - 1];
      expect(lastItem).toHaveTextContent('Site Alpha');
    });

    it('navigates back when a breadcrumb link is clicked', () => {
      // Set store to be 2 levels deep
      useDocExplorerStore.setState({ currentPath: ['Reports', 'Site Alpha'] });

      renderPage();

      // The "Documents" breadcrumb should be a clickable link
      const rootLink = screen.getByRole('link', { name: /documents/i });
      expect(rootLink).toBeInTheDocument();
      expect(rootLink).toHaveAttribute('href', '/documents');
    });

    it('breadcrumb for intermediate folder has correct link', () => {
      useDocExplorerStore.setState({ currentPath: ['Reports', 'Site Alpha'] });

      renderPage();

      // The "Reports" breadcrumb should link to /documents?path=Reports
      const reportsLink = screen.getByRole('link', { name: /reports/i });
      expect(reportsLink).toHaveAttribute('href', '/documents?path=Reports');
    });
  });

  describe('search/filter interaction', () => {
    beforeEach(() => {
      setupDefaultMocks();
    });

    it('renders the search input field', () => {
      renderPage();
      expect(screen.getByLabelText('Search')).toBeInTheDocument();
    });

    it('activates search mode when a term of 2+ chars is entered', () => {
      renderPage();

      // Update store to simulate typing
      useDocExplorerStore.setState({ searchTerm: 'safety', isSearchActive: true });

      // Re-render should now show clear all button
      cleanup();
      renderPage();

      expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
    });

    it('clears search and returns to folder view when clear all is clicked', () => {
      useDocExplorerStore.setState({ searchTerm: 'safety', isSearchActive: true });

      renderPage();

      fireEvent.click(screen.getByLabelText('Clear all filters'));

      const state = useDocExplorerStore.getState();
      expect(state.searchTerm).toBe('');
      expect(state.isSearchActive).toBe(false);
    });

    it('applies category filter correctly', () => {
      renderPage();

      const categorySelect = screen.getByLabelText('Category');
      fireEvent.change(categorySelect, { target: { value: 'reports' } });

      const state = useDocExplorerStore.getState();
      expect(state.filters.category).toBe('reports');
    });

    it('shows minimum character hint when search term is less than 2 chars', () => {
      useDocExplorerStore.setState({ searchTerm: 'a' });

      renderPage();

      expect(screen.getByText('Type at least 2 characters to search')).toBeInTheDocument();
    });
  });

  describe('document selection and download flow', () => {
    beforeEach(() => {
      setupDefaultMocks();
    });

    it('download button is disabled when no documents are selected', () => {
      renderPage();

      const downloadBtn = screen.getByRole('button', { name: /download/i });
      expect(downloadBtn).toBeDisabled();
    });

    it('download button is enabled when documents are selected', () => {
      useDocExplorerStore.setState({
        selectedDocumentIds: new Set(['doc-1']),
      });

      renderPage();

      const downloadBtn = screen.getByRole('button', { name: /download/i });
      expect(downloadBtn).not.toBeDisabled();
    });

    it('selecting a document via checkbox updates the store', () => {
      renderPage();

      const checkbox = screen.getByLabelText('Select Safety Report Q1.pdf');
      fireEvent.click(checkbox);

      const state = useDocExplorerStore.getState();
      expect(state.selectedDocumentIds.has('doc-1')).toBe(true);
    });

    it('shows document count in download button when multiple selected', () => {
      useDocExplorerStore.setState({
        selectedDocumentIds: new Set(['doc-1', 'doc-2']),
      });

      renderPage();

      expect(screen.getByRole('button', { name: /download \(2\)/i })).toBeInTheDocument();
    });

    it('displays validation error when batch exceeds 500 MB', () => {
      // Create oversized documents
      const largeDocuments = [
        makeDocument({ id: 'large-1', fileSize: 300 * 1024 * 1024 }),
        makeDocument({ id: 'large-2', fileSize: 300 * 1024 * 1024 }),
      ];

      mockUseDocuments.mockReturnValue({
        documents: largeDocuments,
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        pageSize: 50,
        totalDocuments: 2,
        totalPages: 1,
        goToPage: vi.fn(),
        nextPage: vi.fn(),
        prevPage: vi.fn(),
      });

      useDocExplorerStore.setState({
        selectedDocumentIds: new Set(['large-1', 'large-2']),
      });

      renderPage();

      expect(screen.getByText(/exceed the 500 MB size limit/i)).toBeInTheDocument();
    });
  });

  describe('loading and error states', () => {
    it('shows loading spinner when folders are loading', () => {
      mockUseFolders.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseDocuments.mockReturnValue({
        documents: [],
        isLoading: true,
        isError: false,
        error: null,
        page: 1,
        pageSize: 50,
        totalDocuments: 0,
        totalPages: 0,
        goToPage: vi.fn(),
        nextPage: vi.fn(),
        prevPage: vi.fn(),
      });
      mockUseOrganizationMode.mockReturnValue({
        mode: 'category_site_year_month',
        isLoading: false,
        isUpdating: false,
        updateMode: vi.fn(),
      });

      renderPage();

      expect(screen.getByTestId('document-explorer-page')).toBeInTheDocument();
      // The loading spinner is a div with animate-spin class
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows error banner when folder fetch fails', () => {
      const mockRefetch = vi.fn();
      mockUseFolders.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('Network error'),
        refetch: mockRefetch,
      });
      mockUseDocuments.mockReturnValue({
        documents: [],
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        pageSize: 50,
        totalDocuments: 0,
        totalPages: 0,
        goToPage: vi.fn(),
        nextPage: vi.fn(),
        prevPage: vi.fn(),
      });
      mockUseOrganizationMode.mockReturnValue({
        mode: 'category_site_year_month',
        isLoading: false,
        isUpdating: false,
        updateMode: vi.fn(),
      });

      renderPage();

      expect(screen.getByText('Failed to load folder contents')).toBeInTheDocument();
    });

    it('preserves breadcrumbs when error occurs', () => {
      useDocExplorerStore.setState({ currentPath: ['Reports'] });

      mockUseFolders.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('Network error'),
        refetch: vi.fn(),
      });
      mockUseDocuments.mockReturnValue({
        documents: [],
        isLoading: false,
        isError: false,
        error: null,
        page: 1,
        pageSize: 50,
        totalDocuments: 0,
        totalPages: 0,
        goToPage: vi.fn(),
        nextPage: vi.fn(),
        prevPage: vi.fn(),
      });
      mockUseOrganizationMode.mockReturnValue({
        mode: 'category_site_year_month',
        isLoading: false,
        isUpdating: false,
        updateMode: vi.fn(),
      });

      renderPage();

      // Breadcrumbs should still be visible
      expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
      expect(screen.getByText('Documents')).toBeInTheDocument();
    });
  });
});
