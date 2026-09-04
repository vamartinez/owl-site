// @vitest-environment jsdom
/**
 * Bug Condition Exploration Property Test
 *
 * Property 1: Bug Condition - Wizard Steps and Date Picker Modal Close
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 *
 * GOAL: Surface counterexamples demonstrating both bugs exist on unfixed code.
 *
 * Test 1 (Wizard Bug): Asserts IncidentCreateForm renders all fields inline
 *   without wizard step indicators, Next/Back navigation, or Review step.
 *   EXPECTED TO FAIL on unfixed code (proves wizard bug exists).
 *
 * Test 2 (Date Picker Bug): Asserts Modal does NOT call onClose when click
 *   target is the dialog element but coordinates are inside dialog bounds.
 *   EXPECTED TO FAIL on unfixed code (proves date picker bug exists).
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentCreateForm } from '../IncidentCreateForm';
import { Modal } from '@/components/ui/Modal';

// ─── Mocks ─────────────────────────────────────────────────────────────────

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
  formatSiteLabel: (site: { name: string; address: string }) =>
    `${site.name} — ${site.address}`,
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Bug Condition Exploration: Wizard Steps and Date Picker Modal Close', () => {
  describe('Test 1 (Wizard Bug): IncidentCreateForm renders as single page without wizard', () => {
    it('should NOT have a step indicator element', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() },
      );

      // Expected behavior: No step indicator navigation
      const stepIndicator = document.querySelector('[aria-label="Form steps"]');
      expect(stepIndicator).not.toBeInTheDocument();
    });

    it('should NOT have a "Next" button', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() },
      );

      // Expected behavior: No step navigation buttons
      expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
    });

    it('should NOT have a "Back" button', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() },
      );

      // Expected behavior: No Back button on initial render
      expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
    });

    it('should NOT have "Review & Submit" text', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() },
      );

      // Expected behavior: No review step
      expect(screen.queryByText(/review & submit/i)).not.toBeInTheDocument();
    });

    it('should have a submit button present on initial render', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() },
      );

      // Expected behavior: Submit button is directly accessible
      expect(
        screen.getByRole('button', { name: /submit incident report/i }),
      ).toBeInTheDocument();
    });

    it('should render all form fields simultaneously (title, incident_type select, regulatory indicator checkboxes)', () => {
      render(
        createElement(IncidentCreateForm, {
          siteId: 'site-1',
          siteJurisdiction: 'british_columbia',
        }),
        { wrapper: createWrapper() },
      );

      // Basic Info fields should be visible
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();

      // Classification fields should ALSO be visible (not hidden behind step 2)
      expect(screen.getByLabelText(/incident type/i)).toBeInTheDocument();

      // Regulatory indicator checkboxes should ALSO be visible (not hidden behind step 3)
      const regulatoryCheckbox = document.querySelector('[id^="indicator-"]');
      expect(regulatoryCheckbox).toBeInTheDocument();
    });
  });

  describe('Test 2 (Date Picker Bug): Modal does not close on inside-bounds click', () => {
    let mockOnClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnClose = vi.fn();

      // Mock HTMLDialogElement methods since jsdom doesn't support them
      HTMLDialogElement.prototype.showModal = vi.fn();
      HTMLDialogElement.prototype.close = vi.fn();
    });

    it('should NOT call onClose when click target is dialog but coordinates are inside dialog bounds', () => {
      const { container } = render(
        createElement(Modal, {
          open: true,
          onClose: mockOnClose,
          title: 'Test Modal',
          children: createElement('input', { type: 'date', 'aria-label': 'Date field' }),
        }),
      );

      const dialog = container.querySelector('dialog');
      expect(dialog).not.toBeNull();

      // Mock getBoundingClientRect for the dialog to simulate a dialog
      // positioned in the center of the viewport
      const dialogRect = {
        left: 100,
        right: 500,
        top: 100,
        bottom: 400,
        width: 400,
        height: 300,
        x: 100,
        y: 100,
        toJSON: () => {},
      };
      vi.spyOn(dialog!, 'getBoundingClientRect').mockReturnValue(dialogRect);

      // Simulate a click event where:
      // - e.target is the dialog element itself (simulating date picker popup behavior)
      // - Click coordinates are INSIDE the dialog bounds (300, 250 is inside 100-500, 100-400)
      // This simulates what happens when native date picker popup clicks bubble to dialog
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 250,
      });

      // Override target to be the dialog itself
      Object.defineProperty(clickEvent, 'target', {
        value: dialog,
        writable: false,
      });

      dialog!.dispatchEvent(clickEvent);

      // Expected behavior: onClose should NOT be called because click is inside dialog bounds
      // Bug behavior: onClose IS called because the handler only checks e.target === dialog
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
