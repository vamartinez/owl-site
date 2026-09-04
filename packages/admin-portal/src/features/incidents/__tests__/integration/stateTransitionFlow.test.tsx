// @vitest-environment jsdom
/**
 * Integration test: State transition flow.
 * Tests: Open → Under Review → Resolved → Closed lifecycle.
 *
 * Requirements: 5.2
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StateTransitionButton } from '../../StateTransitionButton';
import { IncidentStatus, type Incident } from '../../types';

// ─── Mock apiClient ──────────────────────────────────────────────────────────

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
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

function createMockIncident(status: IncidentStatus): Partial<Incident> {
  return {
    incident_id: 'inc-001',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Test Incident',
    status,
    updated_at: new Date().toISOString(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('State Transition Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('transitions from OPEN → UNDER_REVIEW successfully', async () => {
    mockPatch.mockResolvedValueOnce(createMockIncident(IncidentStatus.UNDER_REVIEW));

    const onSuccess = vi.fn();

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.OPEN,
        onTransitionSuccess: onSuccess,
      }),
      { wrapper: createWrapper() }
    );

    // Select "Start Review" transition
    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

    // Click Apply
    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        '/incidents/inc-001/state',
        expect.objectContaining({ status: IncidentStatus.UNDER_REVIEW, incidentId: 'inc-001' })
      );
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(IncidentStatus.UNDER_REVIEW);
    });
  });

  it('transitions from UNDER_REVIEW → RESOLVED successfully', async () => {
    mockPatch.mockResolvedValueOnce(createMockIncident(IncidentStatus.RESOLVED));

    const onSuccess = vi.fn();

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.UNDER_REVIEW,
        onTransitionSuccess: onSuccess,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.RESOLVED } });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        '/incidents/inc-001/state',
        expect.objectContaining({ status: IncidentStatus.RESOLVED })
      );
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(IncidentStatus.RESOLVED);
    });
  });

  it('transitions from RESOLVED → CLOSED successfully', async () => {
    mockPatch.mockResolvedValueOnce(createMockIncident(IncidentStatus.CLOSED));

    const onSuccess = vi.fn();

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.RESOLVED,
        onTransitionSuccess: onSuccess,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.CLOSED } });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        '/incidents/inc-001/state',
        expect.objectContaining({ status: IncidentStatus.CLOSED })
      );
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(IncidentStatus.CLOSED);
    });
  });

  it('shows only valid transitions for each state', () => {
    // OPEN: can go to UNDER_REVIEW or REGULATORY_REVIEW
    const { unmount: unmount1 } = render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Start Review')).toBeInTheDocument();
    expect(screen.getByText('Start Regulatory Review')).toBeInTheDocument();
    unmount1();
  });

  it('shows only RESOLVED transition for ACTION_REQUIRED state', () => {
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.ACTION_REQUIRED,
      }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Mark Resolved')).toBeInTheDocument();
    expect(screen.queryByText('Start Review')).not.toBeInTheDocument();
    expect(screen.queryByText('Close Incident')).not.toBeInTheDocument();
  });

  it('rejects invalid transition with 422 and shows valid transitions', async () => {
    const { ApiClientError } = await import('@/services/api-client');
    mockPatch.mockRejectedValueOnce(
      new ApiClientError(422, 'UNPROCESSABLE_ENTITY', {
        validTransitions: [IncidentStatus.UNDER_REVIEW, IncidentStatus.REGULATORY_REVIEW],
      })
    );

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText('Invalid state transition. Valid transitions from current state:')
      ).toBeInTheDocument();
    });
  });

  it('CLOSED state shows Reopen option', () => {
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-001',
        currentStatus: IncidentStatus.CLOSED,
      }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Reopen')).toBeInTheDocument();
  });
});
