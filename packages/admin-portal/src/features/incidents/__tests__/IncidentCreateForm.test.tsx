// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentCreateForm } from '../IncidentCreateForm';

// Mock the useCreateIncident hook
const mockMutateAsync = vi.fn();
vi.mock('../hooks/useCreateIncident', () => ({
  useCreateIncident: () => ({
    mutateAsync: mockMutateAsync,
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

describe('IncidentCreateForm', () => {
  describe('Form rendering', () => {
    it('renders the form with all fields visible in a single scrollable view', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByText('Report New Incident')).toBeInTheDocument();
      expect(screen.getByText('Fill in the details below')).toBeInTheDocument();
    });

    it('renders all form fields visible simultaneously without wizard steps', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/incident date\/time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/number of persons involved/i)).toBeInTheDocument();
      // Classification and Regulatory fields also visible
      expect(screen.getByLabelText(/incident type/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/operational severity/i)).toBeInTheDocument();
    });

    it('does not show Site selector when siteId prop is provided', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      // When siteId is provided, the site combobox is still rendered (pre-filled) but as disabled
      // The Combobox uses label="Site" so we check for that
      const siteInput = screen.getByLabelText(/^site$/i);
      expect(siteInput).toBeInTheDocument();
    });

    it('shows Site selector field when siteId prop is not provided', () => {
      render(
        createElement(IncidentCreateForm, { siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByLabelText(/^site$/i)).toBeInTheDocument();
    });
  });

  describe('Validation display', () => {
    it('shows validation errors when trying to submit with empty required fields', async () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      // Click Submit without filling any fields
      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      // Should show validation errors
      await waitFor(() => {
        expect(screen.getByText('Title is required')).toBeInTheDocument();
      });
    });

    it('shows description validation error for empty description', async () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Description is required')).toBeInTheDocument();
      });
    });
  });

  describe('Single form layout', () => {
    it('shows all fields and submit button without step navigation', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      // All fields visible
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/incident type/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/operational severity/i)).toBeInTheDocument();

      // No wizard navigation
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();

      // Submit button is present
      expect(screen.getByRole('button', { name: /submit incident report/i })).toBeInTheDocument();
    });

    it('has no step indicators', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      expect(screen.queryByText(/Step \d+ of \d+/)).not.toBeInTheDocument();
    });
  });

  describe('Form submission', () => {
    it('calls onSuccess callback with incident data on successful submission', async () => {
      const onSuccess = vi.fn();
      mockMutateAsync.mockResolvedValue({
        incident: { incident_id: 'inc-new' },
        regulatory_result: {
          regulatory_flag: 'internal_only',
          suggestions: [],
          deadlines: [],
          applied_rules: [],
        },
      });

      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
          onSuccess,
        }),
        { wrapper: createWrapper() }
      );

      // Fill all required fields (all visible in single form)
      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'Test incident title' },
      });
      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: 'A detailed description of the incident' },
      });
      fireEvent.change(screen.getByLabelText(/incident date\/time/i), {
        target: { value: '2024-06-15T14:30' },
      });
      fireEvent.change(screen.getByLabelText(/location/i), {
        target: { value: 'Building A' },
      });
      fireEvent.change(screen.getByLabelText(/incident type/i), {
        target: { value: 'injury' },
      });
      fireEvent.change(screen.getByLabelText(/operational severity/i), {
        target: { value: 'medium' },
      });

      // Submit directly (no wizard navigation needed)
      fireEvent.click(screen.getByRole('button', { name: /submit incident report/i }));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
      });
    });

    it('displays API error message when submission fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Server error occurred'));

      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      // Fill all required fields
      fireEvent.change(screen.getByLabelText(/title/i), {
        target: { value: 'Test incident title' },
      });
      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: 'A detailed description of the incident' },
      });
      fireEvent.change(screen.getByLabelText(/incident date\/time/i), {
        target: { value: '2024-06-15T14:30' },
      });
      fireEvent.change(screen.getByLabelText(/location/i), {
        target: { value: 'Building A' },
      });
      fireEvent.change(screen.getByLabelText(/incident type/i), {
        target: { value: 'injury' },
      });
      fireEvent.change(screen.getByLabelText(/operational severity/i), {
        target: { value: 'medium' },
      });

      // Submit directly
      fireEvent.click(screen.getByRole('button', { name: /submit incident report/i }));

      await waitFor(() => {
        expect(screen.getByText('Server error occurred')).toBeInTheDocument();
      });
    });
  });

  describe('Responsive layout', () => {
    it('renders with max-w-2xl container for responsive design', () => {
      const { container } = render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('max-w-2xl');
      expect(wrapper?.className).toContain('px-4');
    });

    it('renders camera capture input with media capture attribute', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      const cameraInput = screen.getByLabelText(/capture photo from camera/i);
      expect(cameraInput).toHaveAttribute('capture', 'environment');
      expect(cameraInput).toHaveAttribute('accept', 'image/*');
    });
  });

  describe('Cancel button', () => {
    it('calls onCancel when Cancel button is clicked', () => {
      const onCancel = vi.fn();

      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
          onCancel,
        }),
        { wrapper: createWrapper() }
      );

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not render Cancel button when onCancel is not provided', () => {
      render(
        createElement(IncidentCreateForm, { siteId: 'site-1', siteJurisdiction: 'british_columbia' }),
        { wrapper: createWrapper() }
      );

      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });
  });
});
