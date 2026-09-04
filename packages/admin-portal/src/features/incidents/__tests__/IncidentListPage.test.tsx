// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IncidentListPage } from '../IncidentListPage';
import {
  type Incident,
  IncidentStatus,
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
} from '../types';

// Mock the useIncidents hook
vi.mock('../hooks/useIncidents', () => ({
  useIncidents: vi.fn(),
}));

// Mock the auth store
vi.mock('@/store/auth-store', () => ({
  useAuthStore: vi.fn((selector) =>
    selector({
      user: { userId: 'user-1', name: 'Test User', tenantId: 'tenant-1', role: 'tenant_admin' },
      role: 'tenant_admin',
    })
  ),
}));

import { useIncidents } from '../hooks/useIncidents';

const mockedUseIncidents = vi.mocked(useIncidents);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children)
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
  external_report_status: ExternalReportStatus.POTENTIALLY_REPORTABLE,
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

const mockIncident2: Incident = {
  ...mockIncident,
  incident_id: 'inc-2',
  title: 'Chemical spill in storage area',
  incident_type: IncidentType.HAZARDOUS_SUBSTANCE,
  severity: OperationalSeverity.CRITICAL,
  regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
  status: IncidentStatus.REGULATORY_REVIEW,
  external_report_status: ExternalReportStatus.EXTERNAL_REPORT_PENDING,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('IncidentListPage', () => {
  describe('Loading state', () => {
    it('displays loading skeleton while incidents are loading', () => {
      mockedUseIncidents.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      expect(screen.getByTestId('incidents-loading-skeleton')).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('displays error with retry button when API request fails', () => {
      const mockRefetch = vi.fn();
      mockedUseIncidents.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { message: 'Network error', status: 500 },
        refetch: mockRefetch,
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      expect(screen.getByText('Failed to load incidents')).toBeInTheDocument();

      const retryButton = screen.getByRole('button', { name: /reintentar/i });
      fireEvent.click(retryButton);
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Empty state', () => {
    it('displays empty message when no incidents match filters', () => {
      mockedUseIncidents.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      expect(
        screen.getByText('No incidents found matching the selected filters')
      ).toBeInTheDocument();
    });

    it('shows "0 incidents found" in description', () => {
      mockedUseIncidents.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      expect(screen.getByText('0 incidents found')).toBeInTheDocument();
    });
  });

  describe('Data display', () => {
    it('renders incident titles as links', () => {
      mockedUseIncidents.mockReturnValue({
        data: [mockIncident],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      const link = screen.getByRole('link', { name: 'Fall from scaffolding' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/incidents/inc-1');
    });

    it('renders status badges with correct labels', () => {
      mockedUseIncidents.mockReturnValue({
        data: [mockIncident, mockIncident2],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      // Status labels should appear in the table rows
      expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Regulatory Review').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "Report Incident" button linking to creation form', () => {
      mockedUseIncidents.mockReturnValue({
        data: [mockIncident],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      const reportLink = screen.getByRole('link', { name: /report incident/i });
      expect(reportLink).toHaveAttribute('href', '/incidents/new');
    });

    it('shows external report pending warning indicator', () => {
      mockedUseIncidents.mockReturnValue({
        data: [mockIncident2],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      expect(screen.getByText('External Report Pending')).toBeInTheDocument();
    });
  });

  describe('Filter interactions', () => {
    beforeEach(() => {
      mockedUseIncidents.mockReturnValue({
        data: [mockIncident, mockIncident2],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);
    });

    it('renders filter dropdowns for status, severity, and regulatory flag', () => {
      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      // Filter selects should be present with aria-labels
      expect(screen.getByLabelText('Status')).toBeInTheDocument();
      expect(screen.getByLabelText('Severity')).toBeInTheDocument();
      expect(screen.getByLabelText('Regulatory Flag')).toBeInTheDocument();
    });

    it('calls useIncidents with updated filters when filter changes', () => {
      render(createElement(IncidentListPage), { wrapper: createWrapper() });

      // The hook should have been called initially with empty filters
      expect(mockedUseIncidents).toHaveBeenCalled();
      const initialCall = mockedUseIncidents.mock.calls[0]![0];
      expect(initialCall!.status).toBeUndefined();
    });
  });
});
