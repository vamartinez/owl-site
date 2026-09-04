// @vitest-environment jsdom
/**
 * Tests for the RegulatoryDataForm component focusing on:
 * - Legal disclaimer display (Requirement 24.3)
 * - Deadline rendering and regulatory data display
 * - Tab navigation between OSHA and WorkSafeBC forms
 *
 * Validates: Requirements 22.1, 24.3
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegulatoryDataForm } from '../RegulatoryDataForm';
import {
  type Incident,
  IncidentStatus,
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
} from '../types';

// Mock hooks
vi.mock('../hooks/useRegulatoryData', () => ({
  useRegulatoryData: vi.fn(),
  useSaveRegulatoryData: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

import { useRegulatoryData } from '../hooks/useRegulatoryData';

const mockedUseRegulatoryData = vi.mocked(useRegulatoryData);

const SESSION_STORAGE_KEY = 'incident_legal_disclaimer_acknowledged';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockIncident: Incident = {
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  site_id: 'site-1',
  title: 'Worker injury on site',
  description: 'Worker sustained injury during construction',
  incident_type: IncidentType.INJURY,
  incident_datetime: '2024-06-15T14:30:00.000Z',
  report_datetime: '2024-06-15T15:00:00.000Z',
  location: 'Building A',
  persons_involved_count: 1,
  reporting_user_id: 'user-1',
  reporting_user_name: 'John Smith',
  severity: OperationalSeverity.HIGH,
  regulatory_flag: RegulatoryFlag.POTENTIALLY_REPORTABLE,
  status: IncidentStatus.UNDER_REVIEW,
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

beforeEach(() => {
  // Pre-acknowledge disclaimer so it doesn't block tests
  sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('RegulatoryEvalPanel — Disclaimer Display', () => {
  it('shows blocking disclaimer overlay when not yet acknowledged', () => {
    sessionStorage.clear(); // Remove pre-acknowledgment

    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    // Should show the blocking dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Legal Disclaimer')).toBeInTheDocument();
    expect(
      screen.getByText(/regulatory suggestions provided by this system are operational support/i)
    ).toBeInTheDocument();
    expect(screen.getByText('I understand and acknowledge')).toBeInTheDocument();
  });

  it('dismisses disclaimer overlay after acknowledgment', () => {
    sessionStorage.clear();

    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('I understand and acknowledge'));

    // Dialog should be gone
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Inline disclaimer should now be visible
    expect(
      screen.getByText(/regulatory suggestions provided by this system are operational support/i)
    ).toBeInTheDocument();
  });

  it('shows inline disclaimer when already acknowledged in session', () => {
    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    // No blocking dialog
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Inline disclaimer visible
    expect(
      screen.getByText(/regulatory suggestions provided by this system are operational support/i)
    ).toBeInTheDocument();
  });
});

describe('RegulatoryEvalPanel — Tab Navigation', () => {
  beforeEach(() => {
    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
  });

  it('renders OSHA and WorkSafeBC tabs', () => {
    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByRole('tab', { name: /osha/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /worksafebc/i })).toBeInTheDocument();
  });

  it('shows OSHA tab as active by default', () => {
    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    const oshaTab = screen.getByRole('tab', { name: /osha/i });
    expect(oshaTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to WorkSafeBC tab when clicked', () => {
    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    const worksafebcTab = screen.getByRole('tab', { name: /worksafebc/i });
    fireEvent.click(worksafebcTab);

    expect(worksafebcTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /osha/i })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('renders OSHA form fields in the OSHA tab panel', () => {
    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('OSHA Form 300/301 Data')).toBeInTheDocument();
    expect(screen.getByLabelText(/case identifier/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/worker name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
  });

  it('renders WorkSafeBC form fields when WorkSafeBC tab is active', () => {
    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByRole('tab', { name: /worksafebc/i }));

    expect(screen.getByText('WorkSafeBC Employer Report')).toBeInTheDocument();
    expect(screen.getByLabelText(/employer name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/worksafebc account number/i)).toBeInTheDocument();
  });
});

describe('RegulatoryEvalPanel — Missing Fields and Deadline Rendering', () => {
  it('shows missing fields count badge when form is incomplete', () => {
    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    // OSHA form has 8 required fields, all empty by default
    expect(screen.getByText(/fields missing/i)).toBeInTheDocument();
  });

  it('shows "Complete" badge when all required fields are filled', () => {
    mockedUseRegulatoryData.mockReturnValue({
      data: {
        osha_300: {
          case_identifier: '2024-001',
          worker_name: 'John Doe',
          job_title: 'Carpenter',
          incident_date: '2024-06-15',
          location_within_site: 'Building A',
          injury_illness_description: 'Laceration to left hand',
          case_outcome: 'days_away_from_work',
          days_away_from_work: 5,
          days_restricted_work: 0,
          recordability: 'days_away',
          is_complete: true,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('shows loading skeleton while regulatory data is loading', () => {
    mockedUseRegulatoryData.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    const pulseElements = document.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('renders Save Draft button in OSHA tab', () => {
    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument();
  });

  it('renders OSHA recordability classification selector', () => {
    mockedUseRegulatoryData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(
      createElement(RegulatoryDataForm, { incident: mockIncident }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('OSHA Recordability Classification')).toBeInTheDocument();
    expect(screen.getByLabelText(/recordability/i)).toBeInTheDocument();
  });
});
