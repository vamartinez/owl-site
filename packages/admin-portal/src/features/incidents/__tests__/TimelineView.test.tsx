// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimelineView } from '../TimelineView';
import { TimelineEventType, type TimelineEvent } from '../types';

// Mock the hook
vi.mock('../hooks/useIncidentTimeline', () => ({
  useIncidentTimeline: vi.fn(),
}));

import { useIncidentTimeline } from '../hooks/useIncidentTimeline';

const mockedUseIncidentTimeline = vi.mocked(useIncidentTimeline);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockCreationEvent: TimelineEvent = {
  event_id: 'evt-1',
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  event_type: TimelineEventType.CREATION,
  actor_id: 'user-1',
  actor_name: 'John Smith',
  data: { title: 'Fall from scaffolding' },
  timestamp: '2024-06-15T14:30:00.000Z',
};

const mockStateChangeEvent: TimelineEvent = {
  event_id: 'evt-2',
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  event_type: TimelineEventType.STATE_CHANGE,
  actor_id: 'user-2',
  actor_name: 'Jane Doe',
  data: { previous_state: 'open', new_state: 'under_review' },
  timestamp: '2024-06-15T15:00:00.000Z',
};

const mockSeverityChangeEvent: TimelineEvent = {
  event_id: 'evt-3',
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  event_type: TimelineEventType.SEVERITY_CHANGE,
  actor_id: 'user-2',
  actor_name: 'Jane Doe',
  data: { previous_severity: 'medium', new_severity: 'high' },
  timestamp: '2024-06-15T15:30:00.000Z',
};

const mockAttachmentEvent: TimelineEvent = {
  event_id: 'evt-4',
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  event_type: TimelineEventType.ATTACHMENT_ADDED,
  actor_id: 'user-1',
  actor_name: 'John Smith',
  data: { file_name: 'photo_evidence.jpg', mime_type: 'image/jpeg' },
  timestamp: '2024-06-15T16:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TimelineView', () => {
  it('displays loading skeleton while timeline is loading', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Timeline')).toBeInTheDocument();
    // Loading skeletons should be present (animated pulse divs)
    const pulseElements = document.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('displays error state with retry button when API request fails', () => {
    const mockRefetch = vi.fn();
    mockedUseIncidentTimeline.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Network error'),
      refetch: mockRefetch,
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Failed to load timeline')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();

    const retryButton = screen.getByText('Reintentar');
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('displays empty state when no events exist', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('No timeline events yet.')).toBeInTheDocument();
  });

  it('renders timeline events with actor name and event type badge', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [mockCreationEvent, mockStateChangeEvent],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    // Actor names
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();

    // Event type badges
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('State Change')).toBeInTheDocument();
  });

  it('renders change data formatted based on event type', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [mockStateChangeEvent, mockSeverityChangeEvent, mockAttachmentEvent],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    // State change: previous → new
    expect(screen.getByText('open → under review')).toBeInTheDocument();

    // Severity change
    expect(screen.getByText('Severity: medium → high')).toBeInTheDocument();

    // Attachment
    expect(screen.getByText('File: photo_evidence.jpg (image/jpeg)')).toBeInTheDocument();
  });

  it('renders UTC timestamps for each event', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [mockCreationEvent],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    // Should contain UTC in the timestamp display
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('renders creation event with title from data', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [mockCreationEvent],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      createElement(TimelineView, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Fall from scaffolding')).toBeInTheDocument();
  });
});
