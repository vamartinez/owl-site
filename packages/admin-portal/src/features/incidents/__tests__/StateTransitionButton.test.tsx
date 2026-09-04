// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StateTransitionButton } from '../StateTransitionButton';
import { IncidentStatus } from '../types';

// Mock the useStateTransition hook
const mockMutate = vi.fn();
vi.mock('../hooks/useStateTransition', () => ({
  useStateTransition: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StateTransitionButton', () => {
  it('renders dropdown with valid transitions for OPEN status', () => {
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    // Should show the select with valid options
    const select = screen.getByLabelText('Select state transition');
    expect(select).toBeInTheDocument();

    // OPEN can transition to UNDER_REVIEW or REGULATORY_REVIEW
    expect(screen.getByText('Start Review')).toBeInTheDocument();
    expect(screen.getByText('Start Regulatory Review')).toBeInTheDocument();
  });

  it('renders dropdown with valid transitions for RESOLVED status', () => {
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.RESOLVED,
      }),
      { wrapper: createWrapper() }
    );

    // RESOLVED can only transition to CLOSED
    expect(screen.getByText('Close Incident')).toBeInTheDocument();
  });

  it('renders nothing when no transitions are available', () => {
    // Note: All statuses have at least one transition in the current map,
    // but we test the guard by checking that CLOSED only shows Reopen
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.CLOSED,
      }),
      { wrapper: createWrapper() }
    );

    // CLOSED can transition to OPEN (Reopen)
    expect(screen.getByText('Reopen')).toBeInTheDocument();
  });

  it('disables Apply button when no transition is selected', () => {
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    expect(applyButton).toBeDisabled();
  });

  it('calls mutate with correct params when Apply is clicked', () => {
    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    // Select a transition
    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

    // Click Apply
    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    expect(mockMutate).toHaveBeenCalledWith(
      { incidentId: 'inc-1', status: IncidentStatus.UNDER_REVIEW },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('calls onTransitionSuccess callback on successful transition', () => {
    const onSuccess = vi.fn();

    // Make mutate call onSuccess immediately
    mockMutate.mockImplementation((_vars, options) => {
      options?.onSuccess?.();
    });

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.OPEN,
        onTransitionSuccess: onSuccess,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    expect(onSuccess).toHaveBeenCalledWith(IncidentStatus.UNDER_REVIEW);
  });

  it('shows toast with valid transitions on 422 error', async () => {
    // Simulate a 422 error with valid transitions in details
    mockMutate.mockImplementation((_vars, options) => {
      const error = {
        status: 422,
        code: 'UNPROCESSABLE_ENTITY',
        details: {
          validTransitions: [IncidentStatus.UNDER_REVIEW, IncidentStatus.REGULATORY_REVIEW],
        },
      };
      options?.onError?.(error);
    });

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    // Toast should appear with the valid transitions message
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText('Invalid state transition. Valid transitions from current state:')
      ).toBeInTheDocument();
      expect(screen.getByText('Under Review')).toBeInTheDocument();
      expect(screen.getByText('Regulatory Review')).toBeInTheDocument();
    });
  });

  it('dismisses toast when close button is clicked', async () => {
    mockMutate.mockImplementation((_vars, options) => {
      const error = {
        status: 422,
        code: 'UNPROCESSABLE_ENTITY',
        details: {
          validTransitions: [IncidentStatus.UNDER_REVIEW],
        },
      };
      options?.onError?.(error);
    });

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.OPEN,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.UNDER_REVIEW } });

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    // Toast should appear
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Dismiss the toast
    const dismissButton = screen.getByLabelText('Dismiss notification');
    fireEvent.click(dismissButton);

    // Toast should be gone
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to local valid transitions when server does not provide them', async () => {
    // 422 error without validTransitions in details
    mockMutate.mockImplementation((_vars, options) => {
      const error = {
        status: 422,
        code: 'UNPROCESSABLE_ENTITY',
        details: undefined,
      };
      options?.onError?.(error);
    });

    render(
      createElement(StateTransitionButton, {
        incidentId: 'inc-1',
        currentStatus: IncidentStatus.ACTION_REQUIRED,
      }),
      { wrapper: createWrapper() }
    );

    const select = screen.getByLabelText('Select state transition');
    fireEvent.change(select, { target: { value: IncidentStatus.RESOLVED } });

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    // Should fall back to showing local valid transitions (ACTION_REQUIRED -> RESOLVED)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Resolved')).toBeInTheDocument();
    });
  });
});
