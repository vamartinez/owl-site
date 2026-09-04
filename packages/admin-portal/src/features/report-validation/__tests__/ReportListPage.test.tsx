// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Report } from '../types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockUseReports = vi.fn();
vi.mock('../hooks', () => ({
  useReports: (params: unknown) => mockUseReports(params),
}));

// Mock DataTable to simplify rendering
vi.mock('@/components/data/DataTable', () => ({
  DataTable: ({ data, emptyMessage }: { data: unknown[]; emptyMessage: string }) => (
    <div data-testid="data-table">
      {data.length === 0 ? <p>{emptyMessage}</p> : <p>{data.length} items</p>}
    </div>
  ),
}));

vi.mock('@/components/data/Filters', () => ({
  Filters: ({ filters, activeFilters, onChange, onClear }: any) => (
    <div data-testid="filters">
      <select
        data-testid="status-filter"
        value={activeFilters.status || ''}
        onChange={(e) => onChange('status', e.target.value)}
      >
        <option value="">All</option>
        <option value="draft">Draft</option>
        <option value="validated">Validated</option>
      </select>
      <button onClick={onClear} data-testid="clear-filters">Clear</button>
    </div>
  ),
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/ErrorDisplay', () => ({
  ErrorDisplay: ({ error, title, onRetry }: any) => (
    <div data-testid="error-display">
      <p>{title}</p>
      <p>{error}</p>
      <button onClick={onRetry}>Retry</button>
    </div>
  ),
}));

vi.mock('@/components/layout/PageContainer', () => ({
  PageContainer: ({ children, title, actions }: any) => (
    <div data-testid="page-container">
      <h1>{title}</h1>
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { ReportListPage } from '../ReportListPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    report_id: 'report-001',
    tenant_id: 'tenant-001',
    owner_id: 'user-001',
    title: 'Safety Report Q1 2024',
    status: 'draft',
    current_version: 1,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function makeResponse(
  reports: Report[],
  pagination: Partial<{ total: number; page_size: number; next_cursor?: string }> = {}
) {
  return {
    reports,
    pagination: {
      total: pagination.total ?? reports.length,
      page_size: pagination.page_size ?? 20,
      next_cursor: pagination.next_cursor,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockNavigate.mockClear();
  mockUseReports.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ReportListPage', () => {
  describe('renders list', () => {
    it('renders the page title', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([makeReport()]),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('renders the data table with reports', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([makeReport(), makeReport({ report_id: 'report-002' })]),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
      expect(screen.getByText('2 items')).toBeInTheDocument();
    });

    it('renders upload report button', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([makeReport()]),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByText('Upload Report')).toBeInTheDocument();
    });
  });

  describe('filters work', () => {
    it('renders filter controls', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([makeReport()]),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByTestId('filters')).toBeInTheDocument();
    });

    it('passes status filter to useReports', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([], { total: 0 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);

      const statusFilter = screen.getByTestId('status-filter');
      fireEvent.change(statusFilter, { target: { value: 'draft' } });

      // After filter change, useReports should be called with new status
      expect(mockUseReports).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft' })
      );
    });
  });

  describe('empty state displays', () => {
    it('shows empty state when no reports and no filters', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([], { total: 0 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByText('No reports yet')).toBeInTheDocument();
      expect(screen.getByText(/Upload your first construction report/)).toBeInTheDocument();
    });

    it('shows upload button in empty state', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([], { total: 0 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByText('Upload Your First Report')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error display when fetch fails', () => {
      mockUseReports.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: 'Network error',
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByTestId('error-display')).toBeInTheDocument();
      expect(screen.getByText('Failed to load reports')).toBeInTheDocument();
    });

    it('calls refetch when retry is clicked', () => {
      const refetch = vi.fn();
      mockUseReports.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: 'Network error',
        refetch,
      });

      render(<ReportListPage />);
      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('pagination', () => {
    it('shows cursor pagination controls when there is a next page', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse(Array(20).fill(makeReport()), {
          total: 40,
          next_cursor: 'report-020',
        }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.getByLabelText('Next page')).toBeInTheDocument();
      expect(screen.getByLabelText('Previous page')).toBeInTheDocument();
    });

    it('does not show pagination controls when there is a single page', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([makeReport()], { total: 1 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument();
    });

    it('advances to the next page when Next is clicked, then requests with the cursor', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse(Array(20).fill(makeReport()), {
          total: 40,
          next_cursor: 'report-020',
        }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      fireEvent.click(screen.getByLabelText('Next page'));

      expect(mockUseReports).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'report-020' })
      );
      expect(screen.getByText('Page 2')).toBeInTheDocument();
    });

    it('sends upload_date sort and cursor-based limit by default', () => {
      mockUseReports.mockReturnValue({
        data: makeResponse([makeReport()], { total: 1 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportListPage />);
      expect(mockUseReports).toHaveBeenCalledWith(
        expect.objectContaining({ sort_by: 'upload_date', limit: 20, cursor: undefined })
      );
    });
  });
});
