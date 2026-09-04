// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IncidentDetailPage } from '../IncidentDetailPage';
import {
  type Incident,
  IncidentStatus,
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
} from '../types';

// Mock hooks
vi.mock('../hooks/useIncident', () => ({
  useIncident: vi.fn(),
}));

vi.mock('../hooks/useStateTransition', () => ({
  useStateTransition: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../hooks/useIncidentTimeline', () => ({
  useIncidentTimeline: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useRegulatoryData', () => ({
  useRegulatoryData: () => ({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSaveRegulatoryData: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../hooks/useIncidentComments', () => ({
  useIncidentComments: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAddComment: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../hooks/useEvidenceUpload', () => ({
  useEvidenceUpload: () => ({
    attachments: [],
    isLoading: false,
    upload: vi.fn(),
    isUploading: false,
  }),
}));

// Mock the API client for mutations
vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
  },
  ApiClientError: class extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

// Mock auth store
vi.mock('@/store/auth-store', () => ({
  useAuthStore: vi.fn((selector) =>
    selector({
      user: { userId: 'user-1', name: 'Test User', tenantId: 'tenant-1', role: 'cso' },
      role: 'cso',
    })
  ),
}));

import { useIncident } from '../hooks/useIncident';

const mockedUseIncident = vi.mocked(useIncident);

function createWrapper(incidentId = 'inc-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [`/incidents/${incidentId}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/incidents/:id', element: children })
        )
      )
    );
}

const mockIncident: Incident = {
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  site_id: 'site-1',
  title: 'Fall from scaffolding',
  description: 'Worker fell from scaffolding on level 3',
  incident_type: IncidentType.INJURY,
  incident_datetime: '2024-06-15T14:30:00.000Z',
  report_datetime: '2024-06-15T15:00:00.000Z',
  location: 'Building A, Level 3',
  persons_involved_count: 1,
  reporting_user_id: 'user-1',
  reporting_user_name: 'John Smith',
  severity: OperationalSeverity.HIGH,
  regulatory_flag: RegulatoryFlag.POTENTIALLY_REPORTABLE,
  status: IncidentStatus.OPEN,
  external_report_status: ExternalReportStatus.NOT_REPORTABLE,
  regulatory_indicators: {
    medical_treatment_beyond_first_aid: true,
    lost_time: true,
    hospitalization: false,
    fatality: false,
    amputation: false,
    loss_of_eye: false,
    structural_collapse: false,
    hazardous_substance_release: false,
    fire_or_explosion: false,
  },
  jurisdiction: 'british_columbia',
  created_at: '2024-06-15T15:00:00.000Z',
  updated_at: '2024-06-15T15:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock HTMLDialogElement methods not available in jsdom
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('IncidentDetailPage', () => {
  describe('Loading state', () => {
    it('displays loading state while incident is being fetched', () => {
      mockedUseIncident.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByText('Loading Incident...')).toBeInTheDocument();
      const pulseElements = document.querySelectorAll('.animate-pulse');
      expect(pulseElements.length).toBeGreaterThan(0);
    });
  });

  describe('Error state', () => {
    it('displays error with retry button when fetch fails', () => {
      const mockRefetch = vi.fn();
      mockedUseIncident.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { message: 'Not found', status: 404 },
        refetch: mockRefetch,
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByText('Failed to load incident')).toBeInTheDocument();
    });
  });

  describe('Tab navigation', () => {
    beforeEach(() => {
      mockedUseIncident.mockReturnValue({
        data: mockIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);
    });

    it('renders all tab buttons', () => {
      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Regulatory' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Evidence' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Comments' })).toBeInTheDocument();
    });

    it('shows Details tab as active by default', () => {
      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      expect(detailsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to Timeline tab when clicked', () => {
      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      const timelineTab = screen.getByRole('tab', { name: 'Timeline' });
      fireEvent.click(timelineTab);

      expect(timelineTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute(
        'aria-selected',
        'false'
      );
    });

    it('switches to Regulatory tab when clicked', () => {
      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      const regulatoryTab = screen.getByRole('tab', { name: 'Regulatory' });
      fireEvent.click(regulatoryTab);

      expect(regulatoryTab).toHaveAttribute('aria-selected', 'true');
    });

    it('renders tabpanel with correct aria attributes', () => {
      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      const tabpanel = screen.getByRole('tabpanel');
      expect(tabpanel).toHaveAttribute('id', 'panel-details');
      expect(tabpanel).toHaveAttribute('aria-labelledby', 'tab-details');
    });
  });

  describe('Closure dialog', () => {
    it('shows Close Incident button when status is Resolved', () => {
      const resolvedIncident = { ...mockIncident, status: IncidentStatus.RESOLVED };
      mockedUseIncident.mockReturnValue({
        data: resolvedIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByRole('button', { name: /close incident/i })).toBeInTheDocument();
    });

    it('does not show Close Incident button when status is not Resolved', () => {
      mockedUseIncident.mockReturnValue({
        data: mockIncident, // status is OPEN
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.queryByRole('button', { name: /close incident/i })).not.toBeInTheDocument();
    });

    it('opens closure dialog when Close Incident button is clicked', () => {
      const resolvedIncident = { ...mockIncident, status: IncidentStatus.RESOLVED };
      mockedUseIncident.mockReturnValue({
        data: resolvedIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      // Click the header "Close Incident" button
      const closeButtons = screen.getAllByRole('button', { name: /close incident/i });
      fireEvent.click(closeButtons[0]!);

      // Dialog content should now be visible
      expect(
        screen.getByText(/document the resolution and actions taken/i)
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/resolution notes/i)).toBeInTheDocument();
    });
  });

  describe('Reopen dialog', () => {
    it('shows Reopen Incident button when status is Closed', () => {
      const closedIncident = { ...mockIncident, status: IncidentStatus.CLOSED };
      mockedUseIncident.mockReturnValue({
        data: closedIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByRole('button', { name: /reopen incident/i })).toBeInTheDocument();
    });

    it('does not show Reopen Incident button when status is not Closed', () => {
      mockedUseIncident.mockReturnValue({
        data: mockIncident, // status is OPEN
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.queryByRole('button', { name: /reopen incident/i })).not.toBeInTheDocument();
    });

    it('opens reopen dialog when Reopen Incident button is clicked', () => {
      const closedIncident = { ...mockIncident, status: IncidentStatus.CLOSED };
      mockedUseIncident.mockReturnValue({
        data: closedIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      // Click the header "Reopen Incident" button
      const reopenButtons = screen.getAllByRole('button', { name: /reopen incident/i });
      fireEvent.click(reopenButtons[0]!);

      // Dialog content should now be visible
      expect(
        screen.getByText(/provide a justification for reopening/i)
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/justification/i)).toBeInTheDocument();
    });
  });

  describe('Incident header', () => {
    it('displays incident status, type, severity, and regulatory flag', () => {
      mockedUseIncident.mockReturnValue({
        data: mockIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Injury')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('Potentially Reportable')).toBeInTheDocument();
    });

    it('shows External Report Pending badge when applicable', () => {
      const pendingIncident = {
        ...mockIncident,
        external_report_status: ExternalReportStatus.EXTERNAL_REPORT_PENDING,
      };
      mockedUseIncident.mockReturnValue({
        data: pendingIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      // May appear in both header badge and details panel
      expect(screen.getAllByText('External Report Pending').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('State transition button', () => {
    it('shows state transition button when incident is not closed', () => {
      mockedUseIncident.mockReturnValue({
        data: mockIncident, // status is OPEN
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.getByLabelText('Select state transition')).toBeInTheDocument();
    });

    it('hides state transition button when incident is closed', () => {
      const closedIncident = { ...mockIncident, status: IncidentStatus.CLOSED };
      mockedUseIncident.mockReturnValue({
        data: closedIncident,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentDetailPage), { wrapper: createWrapper() });

      expect(screen.queryByLabelText('Select state transition')).not.toBeInTheDocument();
    });
  });
});
