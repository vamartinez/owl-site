// @vitest-environment jsdom
/**
 * Integration test: Closure and reopen flows with validation.
 * Tests: Close from Resolved state, reopen from Closed state, validation enforcement.
 *
 * Requirements: 19.1, 20.1
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IncidentDetailPage } from '../../IncidentDetailPage';
import {
  IncidentStatus,
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
  type Incident,
} from '../../types';

// ─── Mock apiClient ──────────────────────────────────────────────────────────

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown>;
    constructor(status: number, code: string, details?: Record<string, unknown>) {
      super(`API Error [${status}]: ${code}`);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        isAuthenticated: true,
        role: 'tenant_admin',
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    {
      getState: () => ({
        isAuthenticated: true,
        role: 'tenant_admin',
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    }
  ),
}));

// Mock the Modal component since jsdom doesn't support dialog.showModal()
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) => {
    if (!open) return null;
    return createElement('div', { role: 'dialog', 'aria-label': title },
      createElement('h2', null, title),
      children,
      createElement('button', { onClick: onClose, 'aria-label': 'Close' }, '×')
    );
  },
}));

// Mock react-router-dom to provide useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock sub-components that make their own API calls
vi.mock('../../TimelineView', () => ({
  TimelineView: () => createElement('div', { 'data-testid': 'timeline-view' }, 'Timeline'),
}));

vi.mock('../../EvidenceUpload', () => ({
  EvidenceUpload: () => createElement('div', { 'data-testid': 'evidence-upload' }, 'Evidence'),
}));

vi.mock('../../PersonsInvolvedPanel', () => ({
  PersonsInvolvedPanel: () => createElement('div', { 'data-testid': 'persons-panel' }, 'Persons'),
}));

vi.mock('../../CommentsSection', () => ({
  CommentsSection: () => createElement('div', { 'data-testid': 'comments-section' }, 'Comments'),
}));

vi.mock('../../RegulatoryDataForm', () => ({
  RegulatoryDataForm: () => createElement('div', { 'data-testid': 'regulatory-form' }, 'Regulatory'),
}));

vi.mock('../../ExportPanel', () => ({
  ExportPanel: () => createElement('div', { 'data-testid': 'export-panel' }, 'Export'),
}));

vi.mock('../../RegulatoryAlertBanner', () => ({
  RegulatoryAlertBanner: () => createElement('div', { 'data-testid': 'alert-banner' }, 'Alert'),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createWrapper(initialRoute = '/incidents/inc-001') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [initialRoute] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/incidents/:id', element: children })
        )
      )
    );
}

function createMockIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    incident_id: 'inc-001',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Test Incident for Closure',
    description: 'A test incident that needs to be closed.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-03-15T08:30:00.000Z',
    report_datetime: '2024-03-15T09:00:00.000Z',
    location: 'Building A',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'John Doe',
    severity: OperationalSeverity.MEDIUM,
    regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
    status: IncidentStatus.RESOLVED,
    external_report_status: ExternalReportStatus.NOT_REPORTABLE,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'british_columbia',
    created_at: '2024-03-15T09:00:00.000Z',
    updated_at: '2024-03-15T09:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Closure and Reopen Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('Closure Flow', () => {
    it('shows Close Incident button only when status is Resolved', async () => {
      const resolvedIncident = createMockIncident({ status: IncidentStatus.RESOLVED });
      mockGet.mockResolvedValue(resolvedIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close Incident' })).toBeInTheDocument();
      });

      // Should NOT show Reopen button
      expect(screen.queryByRole('button', { name: 'Reopen Incident' })).not.toBeInTheDocument();
    });

    it('opens closure dialog and submits with valid resolution notes', async () => {
      const resolvedIncident = createMockIncident({ status: IncidentStatus.RESOLVED });
      mockGet.mockResolvedValue(resolvedIncident);

      const closedIncident = createMockIncident({ status: IncidentStatus.CLOSED });
      mockPost.mockResolvedValueOnce(closedIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      // Wait for page to load
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close Incident' })).toBeInTheDocument();
      });

      // Open closure dialog
      fireEvent.click(screen.getByRole('button', { name: 'Close Incident' }));

      // Dialog should appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByLabelText('Resolution Notes')).toBeInTheDocument();
      });

      // Fill in resolution notes (>= 20 chars)
      const notesInput = screen.getByLabelText('Resolution Notes');
      fireEvent.change(notesInput, {
        target: { value: 'Incident resolved after corrective actions were implemented and verified.' },
      });

      // Submit the closure form - find the submit button inside the dialog
      const dialog = screen.getByRole('dialog');
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/incidents/inc-001/close',
          { resolution_notes: 'Incident resolved after corrective actions were implemented and verified.' }
        );
      });
    });

    it('rejects closure with resolution notes shorter than 20 characters', async () => {
      const resolvedIncident = createMockIncident({ status: IncidentStatus.RESOLVED });
      mockGet.mockResolvedValue(resolvedIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close Incident' })).toBeInTheDocument();
      });

      // Open closure dialog
      fireEvent.click(screen.getByRole('button', { name: 'Close Incident' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Resolution Notes')).toBeInTheDocument();
      });

      // Enter short resolution notes (< 20 chars)
      const notesInput = screen.getByLabelText('Resolution Notes');
      fireEvent.change(notesInput, { target: { value: 'Too short' } });

      // Try to submit
      const dialog = screen.getByRole('dialog');
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLElement;
      fireEvent.click(submitButton);

      // Should show validation error
      await waitFor(() => {
        expect(screen.getByText('Resolution notes must be at least 20 characters')).toBeInTheDocument();
      });

      // API should NOT have been called
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('does not show Close button when status is not Resolved', async () => {
      const openIncident = createMockIncident({ status: IncidentStatus.OPEN });
      mockGet.mockResolvedValue(openIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Test Incident for Closure' })).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: 'Close Incident' })).not.toBeInTheDocument();
    });
  });

  describe('Reopen Flow', () => {
    it('shows Reopen button only when status is Closed', async () => {
      const closedIncident = createMockIncident({ status: IncidentStatus.CLOSED });
      mockGet.mockResolvedValue(closedIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reopen Incident' })).toBeInTheDocument();
      });

      // Should NOT show Close button
      expect(screen.queryByRole('button', { name: 'Close Incident' })).not.toBeInTheDocument();
    });

    it('opens reopen dialog and submits with valid justification', async () => {
      const closedIncident = createMockIncident({ status: IncidentStatus.CLOSED });
      mockGet.mockResolvedValue(closedIncident);

      const reopenedIncident = createMockIncident({ status: IncidentStatus.OPEN });
      mockPost.mockResolvedValueOnce(reopenedIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reopen Incident' })).toBeInTheDocument();
      });

      // Open reopen dialog
      fireEvent.click(screen.getByRole('button', { name: 'Reopen Incident' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Justification')).toBeInTheDocument();
      });

      // Fill in justification (>= 20 chars)
      const justificationInput = screen.getByLabelText('Justification');
      fireEvent.change(justificationInput, {
        target: { value: 'New evidence discovered that requires further investigation of the incident.' },
      });

      // Submit - find the submit button inside the dialog
      const dialog = screen.getByRole('dialog');
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/incidents/inc-001/reopen',
          { justification: 'New evidence discovered that requires further investigation of the incident.' }
        );
      });
    });

    it('rejects reopen with justification shorter than 20 characters', async () => {
      const closedIncident = createMockIncident({ status: IncidentStatus.CLOSED });
      mockGet.mockResolvedValue(closedIncident);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reopen Incident' })).toBeInTheDocument();
      });

      // Open reopen dialog
      fireEvent.click(screen.getByRole('button', { name: 'Reopen Incident' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Justification')).toBeInTheDocument();
      });

      // Enter short justification
      fireEvent.change(screen.getByLabelText('Justification'), {
        target: { value: 'Short reason' },
      });

      // Try to submit
      const dialog = screen.getByRole('dialog');
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLElement;
      fireEvent.click(submitButton);

      // Should show validation error
      await waitFor(() => {
        expect(screen.getByText('Reopening justification must be at least 20 characters')).toBeInTheDocument();
      });

      // API should NOT have been called
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});
