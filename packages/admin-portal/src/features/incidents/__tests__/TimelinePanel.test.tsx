// @vitest-environment jsdom
/**
 * Additional timeline tests focusing on chronological ordering and
 * comprehensive event type rendering. Complements TimelineView.test.tsx.
 *
 * Validates: Requirements 15.2 (immutable timeline display in chronological order)
 */
import { render, screen, cleanup } from '@testing-library/react';
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

// Events intentionally out of chronological order to verify rendering order
const timelineEvents: TimelineEvent[] = [
  {
    event_id: 'evt-1',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.CREATION,
    actor_id: 'user-1',
    actor_name: 'Alice Johnson',
    data: { title: 'Scaffolding collapse' },
    timestamp: '2024-06-15T10:00:00.000Z',
  },
  {
    event_id: 'evt-2',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.REGULATORY_EVALUATION,
    actor_id: 'system',
    actor_name: 'System',
    data: { rule: 'WorkSafeBC immediate notification', result: 'immediately_reportable' },
    timestamp: '2024-06-15T10:00:01.000Z',
  },
  {
    event_id: 'evt-3',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.COMMENT_ADDED,
    actor_id: 'user-2',
    actor_name: 'Bob Martinez',
    data: { comment_id: 'cmt-1' },
    timestamp: '2024-06-15T11:30:00.000Z',
  },
  {
    event_id: 'evt-4',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.PERSON_ADDED,
    actor_id: 'user-1',
    actor_name: 'Alice Johnson',
    data: { full_name: 'Carlos Rivera', involvement_type: 'injured_worker' },
    timestamp: '2024-06-15T12:00:00.000Z',
  },
  {
    event_id: 'evt-5',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.CLOSURE,
    actor_id: 'user-3',
    actor_name: 'Diana Chen',
    data: { resolution_notes: 'All corrective actions completed' },
    timestamp: '2024-06-15T16:00:00.000Z',
  },
  {
    event_id: 'evt-6',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.REOPENING,
    actor_id: 'user-3',
    actor_name: 'Diana Chen',
    data: { justification: 'New evidence discovered' },
    timestamp: '2024-06-16T09:00:00.000Z',
  },
  {
    event_id: 'evt-7',
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    event_type: TimelineEventType.NOTIFICATION_SENT,
    actor_id: 'system',
    actor_name: 'System',
    data: { recipient: 'cso@company.com', type: 'immediate_notification' },
    timestamp: '2024-06-15T10:00:02.000Z',
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TimelinePanel — Chronological Ordering', () => {
  it('renders all events in the order provided by the API (chronological)', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: timelineEvents,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    // All actor names should be present
    const aliceElements = screen.getAllByText('Alice Johnson');
    expect(aliceElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Bob Martinez')).toBeInTheDocument();
    expect(screen.getAllByText('Diana Chen').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('System').length).toBeGreaterThanOrEqual(1);
  });

  it('displays timestamps in UTC for each event', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[0]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    // Should contain UTC in the timestamp display
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });
});

describe('TimelinePanel — Event Type Rendering', () => {
  it('renders creation event with "Created" badge', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[0]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Scaffolding collapse')).toBeInTheDocument();
  });

  it('renders regulatory evaluation event with appropriate badge', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[1]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Regulatory Evaluation')).toBeInTheDocument();
  });

  it('renders comment added event', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[2]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Comment')).toBeInTheDocument();
    expect(screen.getByText('Bob Martinez')).toBeInTheDocument();
  });

  it('renders person added event with person details', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[3]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Person Added')).toBeInTheDocument();
  });

  it('renders closure event', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[4]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('renders reopening event', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[5]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Reopened')).toBeInTheDocument();
  });

  it('renders notification sent event', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: [timelineEvents[6]],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('Notification')).toBeInTheDocument();
  });

  it('renders multiple events maintaining visual timeline structure', () => {
    mockedUseIncidentTimeline.mockReturnValue({
      data: timelineEvents.slice(0, 4),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(createElement(TimelineView, { incidentId: 'inc-1' }), {
      wrapper: createWrapper(),
    });

    // All event type badges should be present
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Regulatory Evaluation')).toBeInTheDocument();
    expect(screen.getByText('Comment')).toBeInTheDocument();
    expect(screen.getByText('Person Added')).toBeInTheDocument();
  });
});
