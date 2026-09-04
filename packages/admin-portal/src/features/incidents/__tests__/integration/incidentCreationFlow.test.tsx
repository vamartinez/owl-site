// @vitest-environment jsdom
/**
 * Integration test: Full incident creation flow.
 * Tests: form → POST → regulatory eval → navigate to detail.
 *
 * Requirements: 1.1, 5.2, 12.4, 19.1, 20.1, 21.4
 */
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IncidentCreateForm } from '../../IncidentCreateForm';
import {
  IncidentType,
  IncidentStatus,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
  type CreateIncidentResponse,
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

// Mock auth store
vi.mock('@/store/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        isAuthenticated: true,
        role: 'supervisor',
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    {
      getState: () => ({
        isAuthenticated: true,
        role: 'supervisor',
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    }
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createWrapper() {
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

const mockCreateResponse: CreateIncidentResponse = {
  incident: {
    incident_id: 'inc-uuid-001',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Worker fell from scaffolding',
    description: 'A worker fell from the second level scaffolding during morning shift.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-03-15T08:30:00.000Z',
    report_datetime: '2024-03-15T09:00:00.000Z',
    location: 'Building A, Level 2',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'John Doe',
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
    created_at: '2024-03-15T09:00:00.000Z',
    updated_at: '2024-03-15T09:00:00.000Z',
  },
  regulatory_result: {
    regulatory_flag: RegulatoryFlag.POTENTIALLY_REPORTABLE,
    suggestions: [
      {
        authority: 'WorkSafeBC',
        action: 'Submit employer report within 72 hours',
        urgency: 'within_deadline',
        deadline_hours: 72,
        rule_reference: 'WorkSafeBC OHS Regulation s.172',
      },
    ],
    deadlines: [
      {
        authority: 'WorkSafeBC',
        deadline_hours: 72,
        deadline_from: 'employer_knowledge',
        absolute_deadline: '2024-03-18T09:00:00.000Z',
        description: 'Employer report to WorkSafeBC',
      },
    ],
    applied_rules: ['worksafebc_medical_treatment_72h'],
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Incident Creation Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('completes full creation flow: form → POST → regulatory eval → callback', async () => {
    mockPost.mockResolvedValueOnce(mockCreateResponse);

    const onSuccess = vi.fn();

    render(
      createElement(IncidentCreateForm, {
        siteId: 'site-1',
        siteJurisdiction: 'british_columbia',
        onSuccess,
        onCancel: vi.fn(),
      }),
      { wrapper: createWrapper() }
    );

    // Single form: All fields visible at once
    expect(screen.getByText('Fill in the details below')).toBeInTheDocument();

    const titleInput = screen.getByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Worker fell from scaffolding' } });

    const descriptionInput = screen.getByLabelText('Description');
    fireEvent.change(descriptionInput, {
      target: { value: 'A worker fell from the second level scaffolding during morning shift.' },
    });

    const dateInput = screen.getByLabelText('Incident Date/Time');
    fireEvent.change(dateInput, { target: { value: '2024-03-15T08:30' } });

    const locationInput = screen.getByLabelText('Location');
    fireEvent.change(locationInput, { target: { value: 'Building A, Level 2' } });

    const personsInput = screen.getByLabelText('Number of Persons Involved');
    fireEvent.change(personsInput, { target: { value: '1' } });

    // Classification fields (visible in same form)
    const typeSelect = screen.getByLabelText('Incident Type');
    fireEvent.change(typeSelect, { target: { value: IncidentType.INJURY } });

    const severitySelect = screen.getByLabelText('Operational Severity');
    fireEvent.change(severitySelect, { target: { value: OperationalSeverity.HIGH } });

    // Regulatory Indicators (visible in same form)
    const medicalCheckbox = screen.getByLabelText('Medical treatment beyond first aid');
    fireEvent.click(medicalCheckbox);

    const lostTimeCheckbox = screen.getByLabelText('Lost time');
    fireEvent.click(lostTimeCheckbox);

    // Submit the form directly
    const submitButton = screen.getByRole('button', { name: 'Submit Incident Report' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/incidents',
        expect.objectContaining({
          title: 'Worker fell from scaffolding',
          incident_type: IncidentType.INJURY,
          severity: OperationalSeverity.HIGH,
          site_id: 'site-1',
          regulatory_indicators: expect.objectContaining({
            medical_treatment_beyond_first_aid: true,
            lost_time: true,
          }),
        })
      );
    });

    // Verify onSuccess callback is called with incident_id and regulatory result
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        incident_id: 'inc-uuid-001',
        regulatoryResult: mockCreateResponse.regulatory_result,
      });
    });
  });

  it('displays API validation errors inline when creation fails with 400', async () => {
    const { ApiClientError } = await import('@/services/api-client');
    mockPost.mockRejectedValueOnce(
      new ApiClientError(400, 'BAD_REQUEST', {
        userMessage: 'Title is required',
      })
    );

    render(
      createElement(IncidentCreateForm, {
        siteId: 'site-1',
        siteJurisdiction: 'british_columbia',
        onSuccess: vi.fn(),
      }),
      { wrapper: createWrapper() }
    );

    // Fill fields and submit directly (single form, no wizard)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Test description for the incident' } });
    fireEvent.change(screen.getByLabelText('Incident Date/Time'), { target: { value: '2024-03-15T08:30' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Site A' } });
    fireEvent.change(screen.getByLabelText('Number of Persons Involved'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Incident Type'), { target: { value: IncidentType.INJURY } });
    fireEvent.change(screen.getByLabelText('Operational Severity'), { target: { value: OperationalSeverity.LOW } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Incident Report' }));

    // Error should be displayed inline
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows jurisdiction selector when site has no configured jurisdiction', async () => {
    render(
      createElement(IncidentCreateForm, {
        siteId: 'site-1',
        onSuccess: vi.fn(),
      }),
      { wrapper: createWrapper() }
    );

    // With single form layout, jurisdiction field is visible immediately when no siteJurisdiction provided
    expect(screen.getByLabelText('Jurisdiction')).toBeInTheDocument();
  });
});
