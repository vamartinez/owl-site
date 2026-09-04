// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersonsInvolvedPanel } from '../PersonsInvolvedPanel';
import { InvolvementType } from '../types';

// Mock the apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/services/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
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

const MOCK_PERSONS = [
  {
    person_id: 'p-1',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    full_name: 'John Doe',
    involvement_type: InvolvementType.INJURED_WORKER,
    organization: 'Acme Corp',
    worker_id: 'W-123',
  },
  {
    person_id: 'p-2',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    full_name: 'Jane Smith',
    involvement_type: InvolvementType.WITNESS,
    organization: 'BuildCo',
  },
];

describe('PersonsInvolvedPanel', () => {
  it('renders loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // Never resolves

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    // Should show loading skeleton
    expect(screen.getByText('Persons Involved')).toBeInTheDocument();
  });

  it('renders persons list after loading', async () => {
    mockGet.mockResolvedValue({ persons: MOCK_PERSONS });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    // Check involvement type labels
    expect(screen.getByText('Injured/Affected Worker')).toBeInTheDocument();
    expect(screen.getByText('Witness')).toBeInTheDocument();

    // Check organizations
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('BuildCo')).toBeInTheDocument();

    // Check worker_id display
    expect(screen.getByText('ID: W-123')).toBeInTheDocument();
  });

  it('renders empty state when no persons exist', async () => {
    mockGet.mockResolvedValue({ persons: [] });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(
        screen.getByText('No persons have been added to this incident yet.')
      ).toBeInTheDocument();
    });
  });

  it('shows add person form when Add Person button is clicked', async () => {
    mockGet.mockResolvedValue({ persons: [] });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));

    // Form fields should appear
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Involvement Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toBeInTheDocument();
    expect(screen.getByLabelText('Worker ID (Optional)')).toBeInTheDocument();
  });

  it('validates mandatory fields on form submission', async () => {
    mockGet.mockResolvedValue({ persons: [] });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));

    // Submit without filling fields
    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));

    await waitFor(() => {
      expect(screen.getByText('Full name is required')).toBeInTheDocument();
      expect(screen.getByText('Organization is required')).toBeInTheDocument();
    });
  });

  it('submits form with valid data', async () => {
    mockGet.mockResolvedValue({ persons: [] });
    mockPost.mockResolvedValue({
      person_id: 'p-new',
      incident_id: 'inc-1',
      tenant_id: 'tenant-1',
      full_name: 'New Person',
      involvement_type: InvolvementType.SUPERVISOR_PRESENT,
      organization: 'SafetyCo',
    });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));

    // Fill in the form
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'New Person' },
    });
    fireEvent.change(screen.getByLabelText('Involvement Type'), {
      target: { value: InvolvementType.SUPERVISOR_PRESENT },
    });
    fireEvent.change(screen.getByLabelText('Organization'), {
      target: { value: 'SafetyCo' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/incidents/inc-1/persons',
        {
          full_name: 'New Person',
          involvement_type: InvolvementType.SUPERVISOR_PRESENT,
          organization: 'SafetyCo',
          worker_id: undefined,
        }
      );
    });
  });

  it('calls delete API when remove button is clicked', async () => {
    mockGet.mockResolvedValue({ persons: MOCK_PERSONS });
    mockDelete.mockResolvedValue(undefined);

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Click remove button for John Doe
    const removeButton = screen.getByLabelText('Remove John Doe');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/incidents/inc-1/persons/p-1');
    });
  });

  it('hides add/remove controls in readOnly mode', async () => {
    mockGet.mockResolvedValue({ persons: MOCK_PERSONS });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1', readOnly: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Add Person button should not be present
    expect(screen.queryByRole('button', { name: 'Add Person' })).not.toBeInTheDocument();

    // Remove buttons should not be present
    expect(screen.queryByLabelText('Remove John Doe')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Jane Smith')).not.toBeInTheDocument();
  });

  it('hides form when Cancel is clicked', async () => {
    mockGet.mockResolvedValue({ persons: [] });

    render(
      createElement(PersonsInvolvedPanel, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Form should be hidden
    expect(screen.queryByLabelText('Full Name')).not.toBeInTheDocument();
  });
});
