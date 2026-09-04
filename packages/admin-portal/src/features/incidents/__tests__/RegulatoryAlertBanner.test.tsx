// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegulatoryAlertBanner } from '../RegulatoryAlertBanner';
import {
  RegulatoryFlag,
  ExternalReportStatus,
  IncidentType,
  OperationalSeverity,
  IncidentStatus,
  type Incident,
} from '../types';

// Mock the auth store
vi.mock('@/store/auth-store', () => ({
  useAuthStore: vi.fn((selector) =>
    selector({
      user: { userId: 'user-1', name: 'Test User', tenantId: 'tenant-1', role: 'cso' },
      tokens: { idToken: 'test-token', accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000 },
      tenantId: 'tenant-1',
      role: 'cso',
      isAuthenticated: true,
    })
  ),
}));

// Mock the api-client
vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(`API Error [${status}]: ${code}`);
      this.status = status;
      this.code = code;
    }
  },
}));

import { apiClient } from '@/services/api-client';

const mockedApiClient = vi.mocked(apiClient);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function createMockIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    incident_id: 'inc-123',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Worker fall from height',
    description: 'A worker fell from scaffolding on the 3rd floor.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-06-15T10:00:00.000Z',
    report_datetime: '2024-06-15T10:30:00.000Z',
    location: 'Building A, 3rd floor',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'John Smith',
    severity: OperationalSeverity.CRITICAL,
    regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
    status: IncidentStatus.OPEN,
    external_report_status: ExternalReportStatus.EXTERNAL_REPORT_PENDING,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: true,
      lost_time: true,
      hospitalization: true,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'us_california',
    created_at: '2024-06-15T10:30:00.000Z',
    updated_at: '2024-06-15T10:30:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RegulatoryAlertBanner', () => {
  it('renders nothing when regulatory_flag is not immediately_reportable', () => {
    const incident = createMockIncident({
      regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
    });

    const { container } = render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when regulatory_flag is potentially_reportable', () => {
    const incident = createMockIncident({
      regulatory_flag: RegulatoryFlag.POTENTIALLY_REPORTABLE,
    });

    const { container } = render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders the banner when regulatory_flag is immediately_reportable', () => {
    const incident = createMockIncident();

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Immediate Regulatory Notification Required')).toBeInTheDocument();
  });

  it('displays the reason for the alert based on active indicators', () => {
    const incident = createMockIncident({
      regulatory_indicators: {
        medical_treatment_beyond_first_aid: false,
        lost_time: false,
        hospitalization: true,
        fatality: true,
        amputation: false,
        loss_of_eye: false,
        structural_collapse: false,
        hazardous_substance_release: false,
        fire_or_explosion: false,
      },
    });

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText(/Fatality reported/)).toBeInTheDocument();
    expect(screen.getByText(/Hospitalization/)).toBeInTheDocument();
  });

  it('displays OSHA jurisdiction for US state jurisdictions', () => {
    const incident = createMockIncident({ jurisdiction: 'us_california' });

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    // Badge and jurisdiction label
    const oshaElements = screen.getAllByText('OSHA');
    expect(oshaElements.length).toBeGreaterThanOrEqual(1);
  });

  it('displays WorkSafeBC jurisdiction for British Columbia', () => {
    const incident = createMockIncident({ jurisdiction: 'british_columbia' });

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    const wsbcElements = screen.getAllByText('WorkSafeBC');
    expect(wsbcElements.length).toBeGreaterThanOrEqual(1);
  });

  it('displays the detection time', () => {
    const incident = createMockIncident();

    render(
      createElement(RegulatoryAlertBanner, {
        incident,
        detectionTime: '2024-06-15T10:35:00.000Z',
      }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText(/Detected:/)).toBeInTheDocument();
  });

  it('displays external report status badge', () => {
    const incident = createMockIncident({
      external_report_status: ExternalReportStatus.EXTERNAL_REPORT_PENDING,
    });

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('External Report Pending')).toBeInTheDocument();
  });

  it('shows "Confirm Viewed" button when not yet confirmed', () => {
    const incident = createMockIncident();

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Confirm Viewed')).toBeInTheDocument();
  });

  it('does not show "Confirm Viewed" button when already confirmed', () => {
    const incident = createMockIncident();

    render(
      createElement(RegulatoryAlertBanner, {
        incident,
        confirmedByUser: 'Jane Doe',
        confirmedAt: '2024-06-15T11:00:00.000Z',
      }),
      { wrapper: createWrapper() }
    );

    expect(screen.queryByText('Confirm Viewed')).not.toBeInTheDocument();
    expect(screen.getByText(/Viewed by/)).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('calls API to record confirmation when "Confirm Viewed" is clicked', async () => {
    const incident = createMockIncident();
    mockedApiClient.post.mockResolvedValueOnce({
      confirmed_by: 'Test User',
      confirmed_at: '2024-06-15T11:05:00.000Z',
    });

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    const confirmButton = screen.getByText('Confirm Viewed');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/incidents/inc-123/regulatory-review-confirmation'
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Viewed by/)).toBeInTheDocument();
      expect(screen.getByText('Test User')).toBeInTheDocument();
    });
  });

  it('shows error message when confirmation API call fails', async () => {
    const incident = createMockIncident();
    mockedApiClient.post.mockRejectedValueOnce(new Error('Network error'));

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    const confirmButton = screen.getByText('Confirm Viewed');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to record confirmation. Please try again.')).toBeInTheDocument();
    });
  });

  it('displays reported status with success badge when reported to OSHA', () => {
    const incident = createMockIncident({
      external_report_status: ExternalReportStatus.REPORTED_OSHA,
    });

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Reported to OSHA')).toBeInTheDocument();
  });

  it('has role="alert" and aria-live="assertive" for accessibility', () => {
    const incident = createMockIncident();

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    const alertElement = screen.getByRole('alert');
    expect(alertElement).toHaveAttribute('aria-live', 'assertive');
  });

  it('shows not-yet-confirmed message when no confirmation exists', () => {
    const incident = createMockIncident();

    render(
      createElement(RegulatoryAlertBanner, { incident }),
      { wrapper: createWrapper() }
    );

    expect(
      screen.getByText(/Not yet confirmed — please review and confirm viewing this alert./)
    ).toBeInTheDocument();
  });
});
