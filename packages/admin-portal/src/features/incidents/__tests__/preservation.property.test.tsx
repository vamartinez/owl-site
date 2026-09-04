// @vitest-environment jsdom
/**
 * Preservation Property Tests for IncidentCreateForm — Validation & Camera Capture
 *
 * These tests capture the BASELINE behavior of form validation and camera capture
 * on UNFIXED code. They verify behaviors that MUST be preserved after the bugfix.
 *
 * **Validates: Requirements 3.1, 3.5, 3.6**
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentCreateForm } from '../IncidentCreateForm';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();
vi.mock('../hooks/useCreateIncident', () => ({
  useCreateIncident: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

vi.mock('../hooks/useSiteSearch', () => ({
  useSiteSearch: () => ({
    options: [],
    rawData: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
  formatSiteLabel: (site: { name: string; address: string }) => `${site.name} — ${site.address}`,
}));

vi.mock('../hooks/useWorkerSearch', () => ({
  useWorkerSearch: () => ({
    options: [],
    rawData: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  // Mock URL.createObjectURL for photo previews
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IncidentCreateForm Preservation Tests — Validation & Camera', () => {
  /**
   * Test 3: Form Zod validation still triggers on submit with invalid data,
   * displaying inline errors.
   *
   * On FIXED code (single-page form): The "Submit Incident Report" button triggers
   * full-form validation. Clicking submit with empty fields shows validation errors.
   * This test verifies that form validation errors ARE displayed for required fields.
   *
   * **Validates: Requirements 3.1**
   */
  describe('Test 3: Form validation displays inline errors for missing required fields', () => {
    it('shows Title validation error when Submit is clicked with empty title', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      // On fixed code, clicking "Submit Incident Report" triggers full-form validation
      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Title is required')).toBeInTheDocument();
      });
    });

    it('shows Description validation error when Submit is clicked with empty description', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Description is required')).toBeInTheDocument();
      });
    });

    it('shows Incident date/time validation error when Submit is clicked without date', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Incident date/time is required')).toBeInTheDocument();
      });
    });

    it('shows Location validation error when Submit is clicked without location', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Location is required')).toBeInTheDocument();
      });
    });

    it('validation errors prevent form submission', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      // Click Submit without filling any fields
      const submitButton = screen.getByRole('button', { name: /submit incident report/i });
      fireEvent.click(submitButton);

      // Should show validation errors (form not submitted)
      await waitFor(() => {
        expect(screen.getByText('Title is required')).toBeInTheDocument();
      });

      // The mutation should NOT have been called
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  /**
   * Test 4: Camera photo capture continues to work — simulate file selection,
   * verify photos added and previews render.
   *
   * On UNFIXED code: The camera capture input is on step 1 of the wizard and
   * works correctly, adding photos to state and rendering previews.
   *
   * **Validates: Requirements 3.5**
   */
  describe('Test 4: Camera photo capture works correctly', () => {
    it('renders the camera capture input with correct attributes', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const cameraInput = screen.getByLabelText(/capture photo from camera/i);
      expect(cameraInput).toBeInTheDocument();
      expect(cameraInput).toHaveAttribute('type', 'file');
      expect(cameraInput).toHaveAttribute('accept', 'image/*');
      expect(cameraInput).toHaveAttribute('capture', 'environment');
    });

    it('adds a photo when a file is selected via camera input', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const cameraInput = screen.getByLabelText(/capture photo from camera/i);

      // Create a mock File
      const mockFile = new File(['photo-data'], 'photo1.jpg', { type: 'image/jpeg' });

      // Simulate file selection
      fireEvent.change(cameraInput, {
        target: { files: [mockFile] },
      });

      // Verify photo preview appears
      await waitFor(() => {
        const preview = screen.getByAltText('Captured photo 1');
        expect(preview).toBeInTheDocument();
      });
    });

    it('adds multiple photos when multiple files are captured sequentially', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const cameraInput = screen.getByLabelText(/capture photo from camera/i);

      // Capture first photo
      const file1 = new File(['photo-1'], 'photo1.jpg', { type: 'image/jpeg' });
      fireEvent.change(cameraInput, { target: { files: [file1] } });

      await waitFor(() => {
        expect(screen.getByAltText('Captured photo 1')).toBeInTheDocument();
      });

      // Capture second photo
      const file2 = new File(['photo-2'], 'photo2.jpg', { type: 'image/jpeg' });
      fireEvent.change(cameraInput, { target: { files: [file2] } });

      await waitFor(() => {
        expect(screen.getByAltText('Captured photo 1')).toBeInTheDocument();
        expect(screen.getByAltText('Captured photo 2')).toBeInTheDocument();
      });
    });

    it('renders a remove button for each captured photo', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const cameraInput = screen.getByLabelText(/capture photo from camera/i);

      const file = new File(['photo-data'], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(cameraInput, { target: { files: [file] } });

      await waitFor(() => {
        const removeButton = screen.getByLabelText('Remove photo 1');
        expect(removeButton).toBeInTheDocument();
      });
    });

    it('removes a photo when remove button is clicked', async () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() }
      );

      const cameraInput = screen.getByLabelText(/capture photo from camera/i);

      const file = new File(['photo-data'], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(cameraInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByAltText('Captured photo 1')).toBeInTheDocument();
      });

      // Click remove button
      const removeButton = screen.getByLabelText('Remove photo 1');
      fireEvent.click(removeButton);

      // Photo should be removed
      await waitFor(() => {
        expect(screen.queryByAltText('Captured photo 1')).not.toBeInTheDocument();
      });
    });
  });
});
