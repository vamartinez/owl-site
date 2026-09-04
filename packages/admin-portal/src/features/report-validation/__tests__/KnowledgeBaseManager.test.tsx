// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { KBContextDocument } from '../types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseKBDocuments = vi.fn();
const mockCreateDocument = vi.fn();
const mockDeleteDocument = vi.fn();
let mockRole: string | null = 'tenant_admin';

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (state: any) => any) => selector({ role: mockRole }),
}));

vi.mock('../hooks', () => ({
  useKBDocuments: () => mockUseKBDocuments(),
  useCreateKBDocument: () => ({
    createDocument: mockCreateDocument,
    isLoading: false,
    error: null,
    uploadProgress: 0,
    isUploading: false,
    reset: vi.fn(),
  }),
  useDeleteKBDocument: () => ({
    deleteDocument: mockDeleteDocument,
    isLoading: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('@/components/layout/PageContainer', () => ({
  PageContainer: ({ children, title, description, actions }: any) => (
    <div data-testid="page-container">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant }: any) => <span data-variant={variant}>{children}</span>,
}));

vi.mock('@/components/ui/Select', () => ({
  Select: ({ label, options, value, onChange, placeholder, disabled }: any) => (
    <div>
      <label>{label}</label>
      <select value={value} onChange={onChange} disabled={disabled} aria-label={label}>
        <option value="">{placeholder}</option>
        {options.map((opt: any) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, onClose, title, children, size }: any) =>
    open ? (
      <div data-testid={`modal-${title.toLowerCase().replace(/\s+/g, '-')}`} role="dialog">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Close modal">Close</button>
        {children}
      </div>
    ) : null,
}));

vi.mock('@/components/ui/ErrorDisplay', () => ({
  ErrorDisplay: ({ title, onRetry }: any) => (
    <div data-testid="error-display">
      <p>{title}</p>
      <button onClick={onRetry}>Retry</button>
    </div>
  ),
}));

// Mock HTMLDialogElement
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { KnowledgeBaseManager } from '../KnowledgeBaseManager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<KBContextDocument> = {}): KBContextDocument {
  return {
    document_id: `doc-${Math.random().toString(36).slice(2)}`,
    file_name: 'worksafebc-regulations.pdf',
    file_size: 2 * 1024 * 1024,
    category: 'worksafebc',
    sync_status: 'indexed',
    uploaded_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRole = 'tenant_admin';
  mockCreateDocument.mockClear();
  mockDeleteDocument.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('KnowledgeBaseManager', () => {
  describe('access control', () => {
    it('denies access for non-tenant_admin roles', () => {
      mockRole = 'site_admin';
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.getByText('Access Denied')).toBeInTheDocument();
      expect(screen.getByText(/Only tenant administrators can manage/)).toBeInTheDocument();
    });

    it('allows access for tenant_admin', () => {
      mockRole = 'tenant_admin';
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [makeDocument()] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
      expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
    });

    it('allows access for platform_admin', () => {
      mockRole = 'platform_admin';
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    });
  });

  describe('document list', () => {
    it('displays document list with file name, category, and sync status', () => {
      const doc = makeDocument({
        file_name: 'bc-building-code-2024.pdf',
        category: 'bc-building-code',
        sync_status: 'indexed',
      });
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [doc] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.getByText('bc-building-code-2024.pdf')).toBeInTheDocument();
      expect(screen.getByText('BC Building Code')).toBeInTheDocument();
      expect(screen.getByText('Indexed')).toBeInTheDocument();
    });

    it('shows sync status badges with correct variants', () => {
      const docs = [
        makeDocument({ document_id: 'doc-1', sync_status: 'indexed' }),
        makeDocument({ document_id: 'doc-2', sync_status: 'pending', file_name: 'pending-doc.pdf' }),
        makeDocument({ document_id: 'doc-3', sync_status: 'error', file_name: 'error-doc.pdf' }),
      ];
      mockUseKBDocuments.mockReturnValue({
        data: { documents: docs },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.getByText('Indexed')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('shows empty state when no documents exist', () => {
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.getByText('No context documents')).toBeInTheDocument();
      expect(screen.getByText(/Upload regulatory and standards documents/)).toBeInTheDocument();
    });
  });

  describe('upload document', () => {
    it('opens upload modal when "Upload Document" button is clicked', () => {
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [makeDocument()] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      fireEvent.click(screen.getByText('Upload Document'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Upload Context Document')).toBeInTheDocument();
    });

    it('shows category selection in upload form', () => {
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      fireEvent.click(screen.getByText('Upload First Document'));

      expect(screen.getByLabelText('Category')).toBeInTheDocument();
    });
  });

  describe('delete document', () => {
    it('shows delete confirmation modal when delete button is clicked', () => {
      const doc = makeDocument({ file_name: 'to-delete.pdf' });
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [doc] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      const deleteButton = screen.getByRole('button', { name: /Delete to-delete.pdf/ });
      fireEvent.click(deleteButton);

      expect(screen.getByText('Delete Document')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    });

    it('calls deleteDocument when delete is confirmed', async () => {
      mockDeleteDocument.mockResolvedValue(undefined);
      const doc = makeDocument({ document_id: 'doc-to-delete', file_name: 'to-delete.pdf' });
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [doc] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      // Click delete icon
      const deleteButton = screen.getByRole('button', { name: /Delete to-delete.pdf/ });
      fireEvent.click(deleteButton);

      // Confirm deletion
      const confirmButton = screen.getByRole('button', { name: /^Delete$/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockDeleteDocument).toHaveBeenCalledWith('doc-to-delete');
      });
    });

    it('cancels deletion when Cancel is clicked', () => {
      const doc = makeDocument({ file_name: 'keep-this.pdf' });
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [doc] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      // Open delete confirmation
      const deleteButton = screen.getByRole('button', { name: /Delete keep-this.pdf/ });
      fireEvent.click(deleteButton);

      // Cancel
      const cancelButton = screen.getByRole('button', { name: /^Cancel$/i });
      fireEvent.click(cancelButton);

      expect(mockDeleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('error state', () => {
    it('shows error display when documents fail to load', () => {
      mockUseKBDocuments.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: 'Failed to fetch',
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      expect(screen.getByTestId('error-display')).toBeInTheDocument();
      expect(screen.getByText('Failed to load documents')).toBeInTheDocument();
    });

    it('calls refetch when retry is clicked', () => {
      const refetch = vi.fn();
      mockUseKBDocuments.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: 'Failed to fetch',
        refetch,
      });

      render(<KnowledgeBaseManager />);

      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('file constraints validation', () => {
    it('shows accepted formats in the upload form', () => {
      mockUseKBDocuments.mockReturnValue({
        data: { documents: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<KnowledgeBaseManager />);

      fireEvent.click(screen.getByText('Upload First Document'));

      expect(screen.getByText(/Accepted formats: PDF, .docx/)).toBeInTheDocument();
      expect(screen.getByText(/Maximum size: 50 MB/)).toBeInTheDocument();
    });
  });
});
