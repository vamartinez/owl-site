// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Report, ValidationResult } from '../types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportId: 'report-001' }),
}));

const mockUseReport = vi.fn();
const mockValidate = vi.fn();
const mockSubmit = vi.fn();
const mockUseValidationPolling = vi.fn();

vi.mock('../hooks', () => ({
  useReport: (id: string) => mockUseReport(id),
  useValidateReport: () => ({
    validate: mockValidate,
    isLoading: false,
    error: null,
    reset: vi.fn(),
  }),
  useSubmitReport: () => ({
    submit: mockSubmit,
    isLoading: false,
    error: null,
    reset: vi.fn(),
  }),
  useValidationPolling: (...args: unknown[]) => mockUseValidationPolling(...args),
}));

vi.mock('../ValidationResultsPanel', () => ({
  ValidationResultsPanel: ({ validationResult }: any) => (
    <div data-testid="validation-results-panel">
      {validationResult ? `Score: ${validationResult.score}` : 'No results'}
    </div>
  ),
}));

vi.mock('../VersionHistoryPanel', () => ({
  VersionHistoryPanel: () => <div data-testid="version-history-panel">Version History</div>,
}));

vi.mock('../ComplianceScoreBadge', () => ({
  ComplianceScoreBadge: ({ score }: any) => <span data-testid="score-badge">{score ?? 'N/A'}</span>,
}));

vi.mock('../ReportUploadForm', () => ({
  ReportUploadForm: ({ open, onClose }: any) =>
    open ? <div data-testid="upload-form-modal"><button onClick={onClose}>Close modal</button></div> : null,
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ title }: any) => <div>{title}</div>,
}));

vi.mock('@/components/ui/ErrorDisplay', () => ({
  ErrorDisplay: ({ title, onRetry }: any) => (
    <div data-testid="error-display">
      <p>{title}</p>
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

import { ReportDetailPage } from '../ReportDetailPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    report_id: 'report-001',
    tenant_id: 'tenant-001',
    owner_id: 'user-001',
    title: 'Safety Report Q1',
    status: 'draft',
    current_version: 1,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function makeValidationResult(): ValidationResult {
  return {
    validation_id: 'val-001',
    report_id: 'report-001',
    version: 1,
    status: 'completed',
    score: 85,
    summary: 'Good compliance.',
    findings: [],
    requested_at: '2024-01-15T10:00:00Z',
    completed_at: '2024-01-15T10:01:00Z',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockValidate.mockClear();
  mockSubmit.mockClear();
  mockUseValidationPolling.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ReportDetailPage', () => {
  describe('shows correct actions per status', () => {
    it('shows "Request Validation" and "Submit" for draft status', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'draft' }), latest_validation: undefined },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByText('Request Validation')).toBeInTheDocument();
      expect(screen.getByText('Submit')).toBeInTheDocument();
      expect(screen.queryByText('Upload New Version')).not.toBeInTheDocument();
    });

    it('shows no actions for validating status', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'validating' }), latest_validation: undefined },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.queryByText('Request Validation')).not.toBeInTheDocument();
      expect(screen.queryByText('Upload New Version')).not.toBeInTheDocument();
      // "Submit" button shouldn't be shown either
      const pageActions = screen.getByTestId('page-actions');
      expect(pageActions.querySelectorAll('button').length).toBe(0);
    });

    it('shows "Upload New Version" and "Submit" for validated status', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'validated' }), latest_validation: makeValidationResult() },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByText('Upload New Version')).toBeInTheDocument();
      expect(screen.getByText('Submit')).toBeInTheDocument();
      expect(screen.queryByText('Request Validation')).not.toBeInTheDocument();
    });

    it('shows no actions for submitted status', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'submitted' }), latest_validation: makeValidationResult() },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.queryByText('Request Validation')).not.toBeInTheDocument();
      expect(screen.queryByText('Upload New Version')).not.toBeInTheDocument();
      const pageActions = screen.getByTestId('page-actions');
      expect(pageActions.querySelectorAll('button').length).toBe(0);
    });
  });

  describe('integrates panels', () => {
    it('renders ValidationResultsPanel when validation result exists', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'validated' }), latest_validation: makeValidationResult() },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByTestId('validation-results-panel')).toBeInTheDocument();
      expect(screen.getByText('Score: 85')).toBeInTheDocument();
    });

    it('renders VersionHistoryPanel', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'draft' }), latest_validation: undefined },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByTestId('version-history-panel')).toBeInTheDocument();
    });

    it('shows validation in progress state when status is validating', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'validating' }), latest_validation: undefined },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByText('Validation in Progress')).toBeInTheDocument();
    });
  });

  describe('loading and error states', () => {
    it('shows loading spinner when data is loading', () => {
      mockUseReport.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByText('Report Details')).toBeInTheDocument();
    });

    it('shows error display when fetch fails', () => {
      mockUseReport.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: 'Not found',
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      expect(screen.getByTestId('error-display')).toBeInTheDocument();
      expect(screen.getByText('Failed to load report')).toBeInTheDocument();
    });
  });

  describe('upload modal', () => {
    it('opens upload modal when "Upload New Version" is clicked', () => {
      mockUseReport.mockReturnValue({
        data: { report: makeReport({ status: 'validated' }), latest_validation: makeValidationResult() },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportDetailPage />);

      fireEvent.click(screen.getByText('Upload New Version'));
      expect(screen.getByTestId('upload-form-modal')).toBeInTheDocument();
    });
  });
});
