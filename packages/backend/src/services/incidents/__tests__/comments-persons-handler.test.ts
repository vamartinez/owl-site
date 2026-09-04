/**
 * Unit tests for comments and persons involved endpoints (Task 2.7).
 *
 * Tests:
 * - POST /incidents/{id}/comments (validation, storage, audit)
 * - GET /incidents/{id}/comments (chronological order)
 * - POST /incidents/{id}/persons (validation, storage, audit)
 * - DELETE /incidents/{id}/persons/{personId} (existence check, deletion, audit)
 *
 * Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 14.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { IncidentRecord } from '../types';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
  InvolvementType,
  TimelineEventType,
} from '../types';

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

import { docClient } from '../../../shared/dynamo-client.js';
import { getIncident } from '../incident-repository.js';
import { appendEvent } from '../timeline-repository.js';
import { authenticateRequest } from '../../../shared/auth-middleware.js';
import { handler } from '../handler';

const mockSend = vi.mocked(docClient.send);
const mockGetIncident = vi.mocked(getIncident);
const mockAppendEvent = vi.mocked(appendEvent);
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

function buildEvent(httpMethod: string, resource: string, body?: unknown, pathParameters?: Record<string, string>) {
  return {
    httpMethod,
    resource,
    body: body ? JSON.stringify(body) : null,
    pathParameters: pathParameters ?? null,
    queryStringParameters: null,
    headers: { Authorization: 'Bearer test-token' },
  };
}

const mockUser = {
  user_id: 'user-001',
  tenant_id: 'tenant-abc',
  email: 'john@example.com',
  role: 'tenant_admin' as const,
  assigned_sites: ['site-xyz'],
};

describe('Comments and Persons Involved Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockReturnValue({ user: mockUser } as any);
  });

  // ─── POST /incidents/{id}/comments ──────────────────────────────────────────

  describe('POST /incidents/{id}/comments', () => {
    it('creates a comment with valid content and returns 201', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never); // PutCommand for comment
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: 'This is a valid comment' },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(201);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.comment).toMatchObject({
        comment_id: 'mock-uuid-001',
        incident_id: 'inc-001',
        tenant_id: 'tenant-abc',
        author_id: 'user-001',
        author_name: 'john@example.com',
        content: 'This is a valid comment',
      });
      expect(responseBody.comment.created_at).toBeDefined();
    });

    it('trims whitespace from comment content', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: '  Trimmed comment  ' },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(201);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.comment.content).toBe('Trimmed comment');
    });

    it('rejects empty comment content with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: '' },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.message).toBe('Validation failed');
    });

    it('rejects whitespace-only comment content with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: '   \t\n  ' },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
    });

    it('rejects comment exceeding 5000 characters with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: 'x'.repeat(5001) },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when incident does not exist', async () => {
      mockGetIncident.mockResolvedValueOnce(undefined);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: 'A comment' },
        { id: 'nonexistent' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(404);
    });

    it('stores comment in DynamoDB with correct SK pattern', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: 'Test comment' },
        { id: 'inc-001' }
      );

      await handler(event as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Item).toMatchObject({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001#COMMENT#mock-uuid-001',
      });
    });

    it('appends COMMENT_ADDED timeline event', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/comments',
        { content: 'Audit test comment' },
        { id: 'inc-001' }
      );

      await handler(event as any);

      expect(mockAppendEvent).toHaveBeenCalledTimes(1);
      const timelineEvent = mockAppendEvent.mock.calls[0][0];
      expect(timelineEvent.event_type).toBe(TimelineEventType.COMMENT_ADDED);
      expect(timelineEvent.incident_id).toBe('inc-001');
      expect(timelineEvent.data).toMatchObject({
        comment_id: 'mock-uuid-001',
      });
    });
  });

  // ─── GET /incidents/{id}/comments ───────────────────────────────────────────

  describe('GET /incidents/{id}/comments', () => {
    it('returns comments in chronological order with 200', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      const comments = [
        { comment_id: 'c1', content: 'First', created_at: '2024-01-15T10:00:00Z' },
        { comment_id: 'c2', content: 'Second', created_at: '2024-01-15T11:00:00Z' },
      ];
      mockSend.mockResolvedValueOnce({ Items: comments } as never);

      const event = buildEvent(
        'GET',
        '/incidents/{id}/comments',
        undefined,
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.comments).toHaveLength(2);
      expect(responseBody.comments[0].comment_id).toBe('c1');
      expect(responseBody.comments[1].comment_id).toBe('c2');
    });

    it('queries with correct SK prefix and ScanIndexForward true', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      const event = buildEvent(
        'GET',
        '/incidents/{id}/comments',
        undefined,
        { id: 'inc-001' }
      );

      await handler(event as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':pk': 'TENANT#tenant-abc',
        ':skPrefix': 'INCIDENT#inc-001#COMMENT#',
      });
      expect(command.input.ScanIndexForward).toBe(true);
    });

    it('returns 404 when incident does not exist', async () => {
      mockGetIncident.mockResolvedValueOnce(undefined);

      const event = buildEvent(
        'GET',
        '/incidents/{id}/comments',
        undefined,
        { id: 'nonexistent' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(404);
    });

    it('returns empty array when no comments exist', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      const event = buildEvent(
        'GET',
        '/incidents/{id}/comments',
        undefined,
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.comments).toEqual([]);
    });
  });

  // ─── POST /incidents/{id}/persons ───────────────────────────────────────────

  describe('POST /incidents/{id}/persons', () => {
    it('creates a person with valid data and returns 201', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never); // PutCommand for person
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: InvolvementType.WITNESS,
          organization: 'Acme Corp',
        },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(201);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.person).toMatchObject({
        person_id: 'mock-uuid-001',
        incident_id: 'inc-001',
        tenant_id: 'tenant-abc',
        full_name: 'Jane Smith',
        involvement_type: InvolvementType.WITNESS,
        organization: 'Acme Corp',
      });
    });

    it('accepts optional worker_id field', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: InvolvementType.INJURED_WORKER,
          organization: 'Acme Corp',
          worker_id: 'worker-123',
        },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(201);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.person.worker_id).toBe('worker-123');
    });

    it('rejects missing full_name with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          involvement_type: InvolvementType.WITNESS,
          organization: 'Acme Corp',
        },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing involvement_type with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          organization: 'Acme Corp',
        },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing organization with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: InvolvementType.WITNESS,
        },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
    });

    it('rejects invalid involvement_type with 400', async () => {
      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: 'invalid_type',
          organization: 'Acme Corp',
        },
        { id: 'inc-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when incident does not exist', async () => {
      mockGetIncident.mockResolvedValueOnce(undefined);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: InvolvementType.WITNESS,
          organization: 'Acme Corp',
        },
        { id: 'nonexistent' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(404);
    });

    it('stores person in DynamoDB with correct SK pattern', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: InvolvementType.WITNESS,
          organization: 'Acme Corp',
        },
        { id: 'inc-001' }
      );

      await handler(event as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Item).toMatchObject({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001#PERSON#mock-uuid-001',
      });
    });

    it('appends PERSON_ADDED timeline event', async () => {
      mockGetIncident.mockResolvedValueOnce(buildIncident());
      mockSend.mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'POST',
        '/incidents/{id}/persons',
        {
          full_name: 'Jane Smith',
          involvement_type: InvolvementType.WITNESS,
          organization: 'Acme Corp',
        },
        { id: 'inc-001' }
      );

      await handler(event as any);

      expect(mockAppendEvent).toHaveBeenCalledTimes(1);
      const timelineEvent = mockAppendEvent.mock.calls[0][0];
      expect(timelineEvent.event_type).toBe(TimelineEventType.PERSON_ADDED);
      expect(timelineEvent.data).toMatchObject({
        person_id: 'mock-uuid-001',
        full_name: 'Jane Smith',
        involvement_type: InvolvementType.WITNESS,
        organization: 'Acme Corp',
      });
    });
  });

  // ─── DELETE /incidents/{id}/persons/{personId} ──────────────────────────────

  describe('DELETE /incidents/{id}/persons/{personId}', () => {
    it('deletes an existing person and returns 200', async () => {
      const personRecord = {
        person_id: 'person-001',
        incident_id: 'inc-001',
        tenant_id: 'tenant-abc',
        full_name: 'Jane Smith',
        involvement_type: InvolvementType.WITNESS,
        organization: 'Acme Corp',
      };
      mockSend
        .mockResolvedValueOnce({ Item: personRecord } as never) // GetCommand
        .mockResolvedValueOnce({} as never); // DeleteCommand
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'DELETE',
        '/incidents/{id}/persons/{personId}',
        undefined,
        { id: 'inc-001', personId: 'person-001' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.message).toBe('Person removed successfully');
    });

    it('returns 404 when person does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined } as never);

      const event = buildEvent(
        'DELETE',
        '/incidents/{id}/persons/{personId}',
        undefined,
        { id: 'inc-001', personId: 'nonexistent' }
      );

      const response = await handler(event as any);

      expect(response.statusCode).toBe(404);
    });

    it('verifies person with correct key before deleting', async () => {
      const personRecord = {
        person_id: 'person-001',
        full_name: 'Jane Smith',
        involvement_type: InvolvementType.WITNESS,
        organization: 'Acme Corp',
      };
      mockSend
        .mockResolvedValueOnce({ Item: personRecord } as never)
        .mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'DELETE',
        '/incidents/{id}/persons/{personId}',
        undefined,
        { id: 'inc-001', personId: 'person-001' }
      );

      await handler(event as any);

      // First call: GetCommand to verify existence
      const getCommand = mockSend.mock.calls[0][0] as GetCommand;
      expect(getCommand.input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001#PERSON#person-001',
      });

      // Second call: DeleteCommand
      const deleteCommand = mockSend.mock.calls[1][0] as DeleteCommand;
      expect(deleteCommand.input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001#PERSON#person-001',
      });
    });

    it('appends PERSON_REMOVED timeline event', async () => {
      const personRecord = {
        person_id: 'person-001',
        full_name: 'Jane Smith',
        involvement_type: InvolvementType.WITNESS,
        organization: 'Acme Corp',
      };
      mockSend
        .mockResolvedValueOnce({ Item: personRecord } as never)
        .mockResolvedValueOnce({} as never);
      mockAppendEvent.mockResolvedValueOnce({} as never);

      const event = buildEvent(
        'DELETE',
        '/incidents/{id}/persons/{personId}',
        undefined,
        { id: 'inc-001', personId: 'person-001' }
      );

      await handler(event as any);

      expect(mockAppendEvent).toHaveBeenCalledTimes(1);
      const timelineEvent = mockAppendEvent.mock.calls[0][0];
      expect(timelineEvent.event_type).toBe(TimelineEventType.PERSON_REMOVED);
      expect(timelineEvent.data).toMatchObject({
        person_id: 'person-001',
        full_name: 'Jane Smith',
        involvement_type: InvolvementType.WITNESS,
        organization: 'Acme Corp',
      });
    });
  });
});
