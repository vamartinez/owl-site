// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { FolderTree } from '../FolderTree';
import type { FolderContentsResponse, FolderNode } from '../types';

// Mock hooks
const mockUseFolders = vi.fn();
vi.mock('../hooks/useFolders', () => ({
  useFolders: () => mockUseFolders(),
}));

const mockNavigateTo = vi.fn();
vi.mock('../store', () => ({
  useDocExplorerStore: (selector: (state: unknown) => unknown) => {
    const state = {
      currentPath: ['Reports'],
      navigateTo: mockNavigateTo,
    };
    return selector(state);
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeFolderNode(overrides: Partial<FolderNode> = {}): FolderNode {
  return {
    id: 'folder-1',
    name: 'Site A',
    path: ['Reports', 'Site A'],
    childFolderCount: 2,
    documentCount: 15,
    lastUpdated: '2024-03-15T10:30:00Z',
    ...overrides,
  };
}

function makeFolderContents(
  folders: FolderNode[] = [],
  documents: FolderContentsResponse['documents'] = [],
): Partial<FolderContentsResponse> {
  return {
    currentPath: ['Reports'],
    folders,
    documents,
    totalDocuments: documents.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  };
}

describe('FolderTree', () => {
  describe('loading state', () => {
    beforeEach(() => {
      mockUseFolders.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('displays loading skeleton while fetching', () => {
      render(<FolderTree />);

      expect(screen.getByTestId('folder-tree-loading')).toBeInTheDocument();
    });

    it('renders animated placeholder elements', () => {
      render(<FolderTree />);

      const skeleton = screen.getByTestId('folder-tree-loading');
      expect(skeleton).toHaveClass('animate-pulse');
    });
  });

  describe('error state', () => {
    const mockRefetch = vi.fn();

    beforeEach(() => {
      mockUseFolders.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network error'),
        refetch: mockRefetch,
      });
    });

    it('displays an error message when fetch fails', () => {
      render(<FolderTree />);

      expect(screen.getByText('Failed to load folders')).toBeInTheDocument();
    });

    it('displays a retry button', () => {
      render(<FolderTree />);

      expect(screen.getByText('Reintentar')).toBeInTheDocument();
    });

    it('calls refetch when retry button is clicked', () => {
      render(<FolderTree />);

      fireEvent.click(screen.getByText('Reintentar'));

      expect(mockRefetch).toHaveBeenCalledOnce();
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockUseFolders.mockReturnValue({
        data: makeFolderContents([], []),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('displays empty state when no folders or documents exist', () => {
      render(<FolderTree />);

      expect(
        screen.getByText('No documents are available in this location'),
      ).toBeInTheDocument();
    });
  });

  describe('folder list rendering', () => {
    const folders: FolderNode[] = [
      makeFolderNode({ id: '1', name: 'Site A', documentCount: 15, lastUpdated: '2024-03-15T10:30:00Z' }),
      makeFolderNode({ id: '2', name: 'Site B', documentCount: 3, lastUpdated: '2024-02-20T08:00:00Z' }),
    ];

    beforeEach(() => {
      mockUseFolders.mockReturnValue({
        data: makeFolderContents(folders),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('renders folder names', () => {
      render(<FolderTree />);

      expect(screen.getByText('Site A')).toBeInTheDocument();
      expect(screen.getByText('Site B')).toBeInTheDocument();
    });

    it('renders document count badge per folder', () => {
      render(<FolderTree />);

      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders last-updated timestamp per folder', () => {
      render(<FolderTree />);

      expect(screen.getByText('Mar 15, 2024')).toBeInTheDocument();
      expect(screen.getByText('Feb 20, 2024')).toBeInTheDocument();
    });

    it('has accessible folder navigation landmark', () => {
      render(<FolderTree />);

      expect(screen.getByRole('navigation', { name: /folder navigation/i })).toBeInTheDocument();
    });
  });

  describe('folder click navigation', () => {
    const folders: FolderNode[] = [
      makeFolderNode({ id: '1', name: 'Site A' }),
    ];

    beforeEach(() => {
      mockUseFolders.mockReturnValue({
        data: makeFolderContents(folders),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('calls navigateTo with appended folder name on click', () => {
      render(<FolderTree />);

      fireEvent.click(screen.getByRole('button', { name: /open folder site a/i }));

      expect(mockNavigateTo).toHaveBeenCalledWith(['Reports', 'Site A']);
    });
  });
});
