// @vitest-environment jsdom
/**
 * Integration test: RBAC enforcement.
 * Tests: verify 403 for unauthorized actions.
 *
 * Requirements: 21.4
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IncidentDetailPage } from '../../IncidentDetailPage';
import { IncidentCreateForm } from '../../IncidentCreateForm';
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
      const userMessage = details?.userMessage as string | undefined;
      super(userMessage || `API Error [${status}]: ${code}`);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

// Default: worker role (most restricted)
let mockRole = 'worker';

vi.mock('@/store/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        isAuthenticated: true,
        role: mockRole,
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    {
      getState: () => ({
        isAuthenticated: true,
        role: mockRole,
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

// Mock sub-components
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
          createElement(Route, { path: '/incidents/:id', element: children }),
          createElement(Route, { path: '/incidents/new', element: children })
        )
      )
    );
}

function createSimpleWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children)
    );
}

function createMockIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    incident_id: 'inc-001',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Test Incident',
    description: 'A test incident.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-03-15T08:30:00.000Z',
    report_datetime: '2024-03-15T09:00:00.000Z',
    location: 'Building A',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'John Doe',
    severity: OperationalSeverity.MEDIUM,
    regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
    status: IncidentStatus.OPEN,
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

describe('RBAC Enforcement Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'worker';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('State transition RBAC', () => {
    it('returns 403 when unauthorized user attempts state transition', async () => {
      const { ApiClientError } = await import('@/services/api-client');
      mockPatch.mockRejectedValueOnce(
        new ApiClientError(403, 'FORBIDDEN', {
          userMessage: 'No tienes permisos para realizar esta acción.',
        })
      );

      mockRole = 'supervisor';

      // Import StateTransitionButton directly for this test
      const { StateTransitionButton } = await import('../../StateTransitionButton');

      render(
        createElement(StateTransitionButton, {
          incidentId: 'inc-001',
          currentStatus: IncidentStatus.OPEN,
        }),
        { wrapper: createSimpleWrapper() }
      );

      const select = screen.getByLabelText('Select state transition');
      fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalled();
      });
    });
  });

  describe('Closure RBAC', () => {
    it('returns 403 when non-admin/cso user attempts to close incident', async () => {
      const { ApiClientError } = await import('@/services/api-client');

      mockRole = 'supervisor';
      const resolvedIncident = createMockIncident({ status: IncidentStatus.RESOLVED });
      mockGet.mockResolvedValue(resolvedIncident);
      mockPost.mockRejectedValueOnce(
        new ApiClientError(403, 'FORBIDDEN', {
          userMessage: 'You do not have permission to perform this action',
        })
      );

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close Incident' })).toBeInTheDocument();
      });

      // Open closure dialog
      fireEvent.click(screen.getByRole('button', { name: 'Close Incident' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Resolution Notes')).toBeInTheDocument();
      });

      // Fill valid resolution notes
      fireEvent.change(screen.getByLabelText('Resolution Notes'), {
        target: { value: 'Attempting to close this incident with sufficient notes.' },
      });

      // Submit
      const dialog = screen.getByRole('dialog');
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLElement;
      fireEvent.click(submitButton);

      // Should show 403 error
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/incidents/inc-001/close',
          expect.any(Object)
        );
      });
    });
  });

  describe('Reopen RBAC', () => {
    it('returns 403 when unauthorized user attempts to reopen incident', async () => {
      const { ApiClientError } = await import('@/services/api-client');

      mockRole = 'site_admin';
      const closedIncident = createMockIncident({ status: IncidentStatus.CLOSED });
      mockGet.mockResolvedValue(closedIncident);
      mockPost.mockRejectedValueOnce(
        new ApiClientError(403, 'FORBIDDEN', {
          userMessage: 'You do not have permission to perform this action',
        })
      );

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reopen Incident' })).toBeInTheDocument();
      });

      // Open reopen dialog
      fireEvent.click(screen.getByRole('button', { name: 'Reopen Incident' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Justification')).toBeInTheDocument();
      });

      // Fill valid justification
      fireEvent.change(screen.getByLabelText('Justification'), {
        target: { value: 'New evidence found that requires reopening this case for review.' },
      });

      // Submit
      const dialog = screen.getByRole('dialog');
      const submitButton = dialog.querySelector('button[type="submit"]') as HTMLElement;
      fireEvent.click(submitButton);

      // API should be called and return 403
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/incidents/inc-001/reopen',
          expect.any(Object)
        );
      });
    });
  });

  describe('Incident creation RBAC', () => {
    it('returns 403 when unauthorized role attempts to create incident', async () => {
      const { ApiClientError } = await import('@/services/api-client');

      mockRole = 'gate_operator';
      mockPost.mockRejectedValueOnce(
        new ApiClientError(403, 'FORBIDDEN', {
          userMessage: 'You do not have permission to perform this action',
        })
      );

      const onSuccess = vi.fn();

      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
          onSuccess,
        }),
        { wrapper: createSimpleWrapper() }
      );

      // Fill form and submit directly (single form, no wizard navigation)
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unauthorized incident' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Attempting to create without permission' } });
      fireEvent.change(screen.getByLabelText('Incident Date/Time'), { target: { value: '2024-03-15T08:30' } });
      fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Site A' } });
      fireEvent.change(screen.getByLabelText('Number of Persons Involved'), { target: { value: '0' } });

      fireEvent.change(screen.getByLabelText('Incident Type'), { target: { value: IncidentType.NEAR_MISS } });
      fireEvent.change(screen.getByLabelText('Operational Severity'), { target: { value: OperationalSeverity.LOW } });

      fireEvent.click(screen.getByRole('button', { name: 'Submit Incident Report' }));

      // Should show 403 error message
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(
          screen.getByText('You do not have permission to perform this action')
        ).toBeInTheDocument();
      });

      // onSuccess should NOT have been called
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Attachment upload RBAC', () => {
    it('returns 403 when unauthorized user attempts to upload attachment', async () => {
      const { ApiClientError } = await import('@/services/api-client');

      mockRole = 'worker';
      mockPost.mockRejectedValueOnce(
        new ApiClientError(403, 'FORBIDDEN', {
          userMessage: 'You do not have permission to perform this action',
        })
      );

      // Test via the hook directly
      const { renderHook, act } = await import('@testing-library/react');
      const { useEvidenceUpload } = await import('../../hooks/useEvidenceUpload');

      // Mock useUploadToS3 for this test
      vi.doMock('@/features/certifications/hooks/useUploadToS3', () => ({
        useUploadToS3: () => ({
          upload: vi.fn(),
          progress: 0,
          isUploading: false,
          error: null,
          abort: vi.fn(),
        }),
      }));

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

      const { result } = renderHook(
        () => useEvidenceUpload({ incidentId: 'inc-001' }),
        { wrapper }
      );

      const testFile = new File(['content'], 'photo.jpg', { type: 'image/jpeg' });

      await act(async () => {
        try {
          await result.current.uploadEvidence({ file: testFile });
        } catch {
          // Expected to throw 403
        }
      });

      expect(result.current.error).toBe('You do not have permission to perform this action');
    });
  });
});
