/**
 * Unit tests for closure, reopening, and timeline endpoints (Task 2.9).
 *
 * Tests:
 * - POST /incidents/{id}/close (role restriction, validation, status check, audit)
 * - POST /incidents/{id}/reopen (validation, status check, audit)
 * - GET /incidents/{id}/timeline (pagination, chronological order)
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 20.1, 20.2, 20.3, 21.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncidentRecord } from '../types';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
  TimelineEventType,
} from '../types';
import { Role } from '../../../shared/types/common.js';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-001'),
}));

// Mock the dynamo-client module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (baseName: string) => `dev-${baseName}`,
}));

// Mock the incident-repository
vi.mock('../incident-repository.js', () => ({
  createIncident: vi.fn(),
  getIncident: vi.fn(),
  updateIncident: vi.fn(),
  listIncidents: vi.fn(),
  listBySite: vi.fn(),
}));

// Mock the timeline-repository
vi.mock('../timeline-repository.js', () => ({
  appendEvent: vi.fn(),
  getTimeline: vi.fn(),
}));

// Mock the regulatory-engine
vi.mock('../regulatory-engine.js', () => ({
  evaluateRegulatory: vi.fn(),
}));

// Mock the state-machine
vi.mock('../state-machine.js', () => ({
  isValidTransition: vi.fn(),
  getValidTransitions: vi.fn(),
}));

// Mock the event-publisher
vi.mock('../event-publisher.js', () => ({
  publishIncidentCreated: vi.fn(),
  publishIncidentUpdated: vi.fn(),
  publishRegulatoryImmediateNotification: vi.fn(),
}));

// Mock the shared event-publisher
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn(),
}));

// Mock the deadline-scheduler
vi.mock('../deadline-scheduler.js', () => ({
  createDeadlineSchedule: vi.fn(),
}));

// Mock auth-middleware
vi.mock('../../../shared/auth-middleware.js', () => ({
  authenticateRequest: vi.fn(),
}));

import { getIncident, updateIncident } from '../incident-repository.js';
import { appendEvent, getTimeline } from '../timeline-repository.js';
import { authenticateRequest } from '../../../shared/auth-middleware.js';
import { handler } from '../handler';

const mockGetIncident = vi.mocked(getIncident);
const mockUpdateIncident = vi.mocked(updateIncident);
const mockAppendEvent = vi.mocked(appendEvent);
const mockGetTimeline = vi.mocked(getTimeline);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

function buildIncident(overrides?: Partial<IncidentRecord>): IncidentRecord {
  return {
    incident_id: 'inc-001',
    tenant_id: 'tenant-abc',
    site_id: 'site-xyz',
    title: 'Test Incident',
    description: 'A test incident description',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-01-15T10:00:00Z',
    report_datetime: '2024-01-15T10:30:00Z',
    location: 'Building A, Floor 2',
    persons_involved_count: 1,
    reporting_user_id: 'user-001',
    reporting_user_name: 'John Doe',
    severity: OperationalSeverity.MEDIUM,
    regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
    status: IncidentStatus.OPEN,
    external_report_status: ExternalReportStatus.NOT_REPORTABLE,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'british_columbia',
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

function buildEvent(overrides?: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    resource: '/incidents/{id}/close',
    pathParameters: { id: 'inc-001' },
    queryStringParameters: null,
    body: JSON.stringify({ resolution_notes: 'This incident has been fully resolved and all actions completed.' }),
    ...overrides,
  };
}

function authenticateAs(role: Role) {
  mockAuthenticateRequest.mockReturnValue({
    user: {
      user_id: 'user-001',
      tenant_id: 'tenant-abc',
      email: 'user@example.com',
      role,
      assigned_sites: ['site-xyz'],
    },
  });
}

describe('Closure, Reopening, and Timeline Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({} as any);
  });

  describe('POST /incidents/{id}/close', () => {
    it('closes a resolved incident with valid resolution notes and returns 200', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.RESOLVED });
      mockGetIncident.mockResolvedValue(incident);
      const updatedIncident = { ...incident, status: IncidentStatus.CLOSED };
      mockUpdateIncident.mockResolvedValue(updatedIncident);

      const response = await handler(buildEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.incident.status).toBe('closed');
    });

    it('restricts closure to tenant_admin and cso roles (Req 21.2)', async () => {
      authenticateAs(Role.SUPERVISOR);
      const response = await handler(buildEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(body.message).toContain('permission');
    });

    it('allows cso role to close incidents', async () => {
      authenticateAs(Role.CSO);
      const incident = buildIncident({ status: IncidentStatus.RESOLVED });
      mockGetIncident.mockResolvedValue(incident);
      const updatedIncident = { ...incident, status: IncidentStatus.CLOSED };
      mockUpdateIncident.mockResolvedValue(updatedIncident);

      const response = await handler(buildEvent());
      expect(response.statusCode).toBe(200);
    });

    it('rejects closure when resolution_notes is less than 20 chars (Req 19.2)', async () => {
      authenticateAs(Role.TENANT_ADMIN);

      const response = await handler(buildEvent({
        body: JSON.stringify({ resolution_notes: 'Too short' }),
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.message).toContain('Validation failed');
    });

    it('rejects closure when resolution_notes is whitespace-padded below 20 chars (Req 19.1)', async () => {
      authenticateAs(Role.TENANT_ADMIN);

      const response = await handler(buildEvent({
        body: JSON.stringify({ resolution_notes: '   short   ' }),
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
    });

    it('returns 422 when incident is not in Resolved status (Req 19.1)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.OPEN });
      mockGetIncident.mockResolvedValue(incident);

      const response = await handler(buildEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(422);
      expect(body.message).toContain('must be in Resolved state');
    });

    it('returns 404 when incident does not exist', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(null);

      const response = await handler(buildEvent());
      expect(response.statusCode).toBe(404);
    });

    it('updates incident with closure data (Req 19.3)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.RESOLVED });
      mockGetIncident.mockResolvedValue(incident);
      mockUpdateIncident.mockResolvedValue({ ...incident, status: IncidentStatus.CLOSED });

      await handler(buildEvent());

      expect(mockUpdateIncident).toHaveBeenCalledWith(
        'tenant-abc',
        'inc-001',
        expect.objectContaining({
          status: IncidentStatus.CLOSED,
          resolution_notes: 'This incident has been fully resolved and all actions completed.',
          closed_by: 'user-001',
        })
      );
      // closure_date should be set
      const updateCall = mockUpdateIncident.mock.calls[0]![2];
      expect(updateCall).toHaveProperty('closure_date');
    });

    it('appends CLOSURE timeline event (Req 19.3)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.RESOLVED });
      mockGetIncident.mockResolvedValue(incident);
      mockUpdateIncident.mockResolvedValue({ ...incident, status: IncidentStatus.CLOSED });

      await handler(buildEvent());

      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: TimelineEventType.CLOSURE,
          incident_id: 'inc-001',
          tenant_id: 'tenant-abc',
          actor_id: 'user-001',
          data: expect.objectContaining({
            resolution_notes: 'This incident has been fully resolved and all actions completed.',
            previous_state: IncidentStatus.RESOLVED,
            new_state: IncidentStatus.CLOSED,
          }),
        })
      );
    });

    it('rejects site_admin role from closing incidents (Req 21.2)', async () => {
      authenticateAs(Role.SITE_ADMIN);
      const response = await handler(buildEvent());
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /incidents/{id}/reopen', () => {
    function buildReopenEvent(overrides?: Record<string, unknown>) {
      return {
        httpMethod: 'POST',
        resource: '/incidents/{id}/reopen',
        pathParameters: { id: 'inc-001' },
        queryStringParameters: null,
        body: JSON.stringify({ justification: 'New evidence has been discovered that requires further investigation.' }),
        ...overrides,
      };
    }

    it('reopens a closed incident with valid justification and returns 200', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.CLOSED });
      mockGetIncident.mockResolvedValue(incident);
      const updatedIncident = { ...incident, status: IncidentStatus.OPEN };
      mockUpdateIncident.mockResolvedValue(updatedIncident);

      const response = await handler(buildReopenEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.incident.status).toBe('open');
    });

    it('rejects reopening when justification is less than 20 chars (Req 20.3)', async () => {
      authenticateAs(Role.TENANT_ADMIN);

      const response = await handler(buildReopenEvent({
        body: JSON.stringify({ justification: 'Too short' }),
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.message).toContain('Validation failed');
    });

    it('rejects reopening when justification is whitespace-padded below 20 chars (Req 20.1)', async () => {
      authenticateAs(Role.TENANT_ADMIN);

      const response = await handler(buildReopenEvent({
        body: JSON.stringify({ justification: '   short text   ' }),
      }));

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(400);
    });

    it('returns 422 when incident is not in Closed status (Req 20.1)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.RESOLVED });
      mockGetIncident.mockResolvedValue(incident);

      const response = await handler(buildReopenEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(422);
      expect(body.message).toContain('must be in Closed state');
    });

    it('returns 404 when incident does not exist', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(null);

      const response = await handler(buildReopenEvent());
      expect(response.statusCode).toBe(404);
    });

    it('updates incident to Open status with reopen_justification (Req 20.2)', async () => {
      authenticateAs(Role.CSO);
      const incident = buildIncident({ status: IncidentStatus.CLOSED });
      mockGetIncident.mockResolvedValue(incident);
      mockUpdateIncident.mockResolvedValue({ ...incident, status: IncidentStatus.OPEN });

      await handler(buildReopenEvent());

      expect(mockUpdateIncident).toHaveBeenCalledWith(
        'tenant-abc',
        'inc-001',
        expect.objectContaining({
          status: IncidentStatus.OPEN,
          reopen_justification: 'New evidence has been discovered that requires further investigation.',
        })
      );
    });

    it('appends REOPENING timeline event (Req 20.2)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident({ status: IncidentStatus.CLOSED });
      mockGetIncident.mockResolvedValue(incident);
      mockUpdateIncident.mockResolvedValue({ ...incident, status: IncidentStatus.OPEN });

      await handler(buildReopenEvent());

      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: TimelineEventType.REOPENING,
          incident_id: 'inc-001',
          tenant_id: 'tenant-abc',
          actor_id: 'user-001',
          data: expect.objectContaining({
            justification: 'New evidence has been discovered that requires further investigation.',
            previous_state: IncidentStatus.CLOSED,
            new_state: IncidentStatus.OPEN,
          }),
        })
      );
    });

    it('allows any authenticated role to reopen (no role restriction on reopen)', async () => {
      authenticateAs(Role.SUPERVISOR);
      const incident = buildIncident({ status: IncidentStatus.CLOSED });
      mockGetIncident.mockResolvedValue(incident);
      mockUpdateIncident.mockResolvedValue({ ...incident, status: IncidentStatus.OPEN });

      const response = await handler(buildReopenEvent());
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /incidents/{id}/timeline', () => {
    function buildTimelineEvent(overrides?: Record<string, unknown>) {
      return {
        httpMethod: 'GET',
        resource: '/incidents/{id}/timeline',
        pathParameters: { id: 'inc-001' },
        queryStringParameters: null,
        body: null,
        ...overrides,
      };
    }

    it('returns timeline events in chronological order with 200', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident();
      mockGetIncident.mockResolvedValue(incident);
      mockGetTimeline.mockResolvedValue({
        events: [
          {
            event_id: 'evt-001',
            incident_id: 'inc-001',
            tenant_id: 'tenant-abc',
            event_type: TimelineEventType.CREATION,
            actor_id: 'user-001',
            actor_name: 'user@example.com',
            data: {},
            timestamp: '2024-01-15T10:30:00Z',
          },
          {
            event_id: 'evt-002',
            incident_id: 'inc-001',
            tenant_id: 'tenant-abc',
            event_type: TimelineEventType.STATE_CHANGE,
            actor_id: 'user-001',
            actor_name: 'user@example.com',
            data: { previous_state: 'open', new_state: 'under_review' },
            timestamp: '2024-01-15T11:00:00Z',
          },
        ],
        nextCursor: undefined,
      });

      const response = await handler(buildTimelineEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.events).toHaveLength(2);
      expect(body.events[0].event_type).toBe('creation');
      expect(body.count).toBe(2);
      expect(body.next_cursor).toBeNull();
    });

    it('returns 404 when incident does not exist', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(null);

      const response = await handler(buildTimelineEvent());
      expect(response.statusCode).toBe(404);
    });

    it('passes pagination parameters to getTimeline', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident();
      mockGetIncident.mockResolvedValue(incident);
      mockGetTimeline.mockResolvedValue({ events: [], nextCursor: undefined });

      await handler(buildTimelineEvent({
        queryStringParameters: { limit: '10', cursor: 'abc123' },
      }));

      expect(mockGetTimeline).toHaveBeenCalledWith('inc-001', {
        limit: 10,
        cursor: 'abc123',
      });
    });

    it('returns next_cursor when more events are available', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const incident = buildIncident();
      mockGetIncident.mockResolvedValue(incident);
      mockGetTimeline.mockResolvedValue({
        events: [{
          event_id: 'evt-001',
          incident_id: 'inc-001',
          tenant_id: 'tenant-abc',
          event_type: TimelineEventType.CREATION,
          actor_id: 'user-001',
          actor_name: 'user@example.com',
          data: {},
          timestamp: '2024-01-15T10:30:00Z',
        }],
        nextCursor: 'next-page-cursor',
      });

      const response = await handler(buildTimelineEvent());
      const body = JSON.parse(response.body);

      expect(body.next_cursor).toBe('next-page-cursor');
    });

    it('restricts access for site-scoped roles to assigned sites', async () => {
      mockAuthenticateRequest.mockReturnValue({
        user: {
          user_id: 'user-002',
          tenant_id: 'tenant-abc',
          email: 'siteadmin@example.com',
          role: Role.SITE_ADMIN,
          assigned_sites: ['site-other'],
        },
      });
      const incident = buildIncident({ site_id: 'site-xyz' });
      mockGetIncident.mockResolvedValue(incident);

      const response = await handler(buildTimelineEvent());
      expect(response.statusCode).toBe(403);
    });
  });
});
