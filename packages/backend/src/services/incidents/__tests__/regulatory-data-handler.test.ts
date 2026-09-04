/**
 * Unit tests for regulatory data endpoints (Task 5.1).
 *
 * Tests:
 * - POST /incidents/{id}/regulatory-data (save OSHA/WorkSafeBC form data)
 * - GET /incidents/{id}/regulatory-data (retrieve regulatory form data)
 * - GET /incidents/{id}/worksafebc-summary (WorkSafeBC emergency summary)
 *
 * Requirements: 8.1, 8.3, 9.1, 9.2, 9.3, 10.1, 10.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncidentRecord } from '../types';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
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

import { getIncident } from '../incident-repository.js';
import { authenticateRequest } from '../../../shared/auth-middleware.js';
import { docClient } from '../../../shared/dynamo-client.js';
import { handler } from '../handler';

const mockGetIncident = vi.mocked(getIncident);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);
const mockSend = vi.mocked(docClient.send);

function buildIncident(overrides?: Partial<IncidentRecord>): IncidentRecord {
  return {
    incident_id: 'inc-001',
    tenant_id: 'tenant-abc',
    site_id: 'site-xyz',
    title: 'Test Incident',
    description: 'A worker fell from scaffolding on the second floor of Building A.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-01-15T10:00:00Z',
    report_datetime: '2024-01-15T10:30:00Z',
    location: 'Building A, Floor 2',
    persons_involved_count: 2,
    reporting_user_id: 'user-001',
    reporting_user_name: 'John Doe',
    severity: OperationalSeverity.HIGH,
    regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
    status: IncidentStatus.OPEN,
    external_report_status: ExternalReportStatus.EXTERNAL_REPORT_PENDING,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: true,
      lost_time: true,
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

describe('Regulatory Data Endpoints (Task 5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
  });

  describe('POST /incidents/{id}/regulatory-data', () => {
    function buildPostEvent(body: Record<string, unknown>) {
      return {
        httpMethod: 'POST',
        resource: '/incidents/{id}/regulatory-data',
        pathParameters: { id: 'inc-001' },
        queryStringParameters: null,
        body: JSON.stringify(body),
      };
    }

    it('saves worksafebc_employer draft data and returns 201', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({});

      const response = await handler(buildPostEvent({
        type: 'worksafebc_employer',
        data: {
          employer_name: 'Acme Construction',
          employer_phone: '604-555-1234',
          is_complete: false,
        },
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.type).toBe('worksafebc_employer');
      expect(body.is_complete).toBe(false);
      expect(body.incident_id).toBe('inc-001');
    });

    it('saves osha_300 draft data and returns 201', async () => {
      authenticateAs(Role.CSO);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({});

      const response = await handler(buildPostEvent({
        type: 'osha_300',
        data: {
          case_identifier: 'OSHA-2024-001',
          worker_name: 'Jane Smith',
          is_complete: false,
        },
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.type).toBe('osha_300');
      expect(body.is_complete).toBe(false);
    });

    it('allows draft saves without full validation (Req 9.3, 10.4)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({});

      // Only partial data, is_complete=false — should succeed
      const response = await handler(buildPostEvent({
        type: 'worksafebc_employer',
        data: {
          employer_name: 'Acme Construction',
          is_complete: false,
        },
      }));

      expect(response.statusCode).toBe(201);
    });

    it('rejects marking as complete when required fields are missing (Req 9.2)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());

      const response = await handler(buildPostEvent({
        type: 'worksafebc_employer',
        data: {
          employer_name: 'Acme Construction',
          is_complete: true,
        },
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.message).toContain('missing required fields');
      expect(body.details.missing_fields).toContain('employer_address');
      expect(body.details.missing_fields).toContain('employer_phone');
    });

    it('accepts complete worksafebc_employer data when all required fields present (Req 9.2)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({});

      const response = await handler(buildPostEvent({
        type: 'worksafebc_employer',
        data: {
          employer_name: 'Acme Construction',
          employer_address: '123 Main St, Vancouver, BC',
          employer_phone: '604-555-1234',
          worksafebc_account_number: 'WS-12345',
          worker_name: 'Jane Smith',
          worker_address: '456 Oak Ave, Vancouver, BC',
          worker_date_of_birth: '1985-03-15',
          worker_occupation: 'Carpenter',
          worker_hire_date: '2020-06-01',
          incident_description: 'Worker fell from scaffolding',
          body_part_affected: 'Left arm',
          nature_of_injury: 'Fracture',
          days_shifts_lost: 5,
          is_complete: true,
        },
      }));
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.is_complete).toBe(true);
    });

    it('returns 400 for invalid type', async () => {
      authenticateAs(Role.TENANT_ADMIN);

      const response = await handler(buildPostEvent({
        type: 'invalid_type',
        data: { is_complete: false },
      }));

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when incident does not exist', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(undefined);

      const response = await handler(buildPostEvent({
        type: 'worksafebc_employer',
        data: { employer_name: 'Test', is_complete: false },
      }));

      expect(response.statusCode).toBe(404);
    });

    it('stores data in IncidentRegulatoryData table with correct keys', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({});

      await handler(buildPostEvent({
        type: 'osha_300',
        data: { case_identifier: 'OSHA-001', is_complete: false },
      }));

      // The PutCommand should have been called with correct PK/SK
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'dev-IncidentRegulatoryData',
            Item: expect.objectContaining({
              PK: 'INCIDENT#inc-001',
              SK: 'REGDATA#osha_300',
              incident_id: 'inc-001',
              tenant_id: 'tenant-abc',
              type: 'osha_300',
            }),
          }),
        })
      );
    });
  });

  describe('GET /incidents/{id}/regulatory-data', () => {
    function buildGetEvent() {
      return {
        httpMethod: 'GET',
        resource: '/incidents/{id}/regulatory-data',
        pathParameters: { id: 'inc-001' },
        queryStringParameters: null,
        body: null,
      };
    }

    it('returns all regulatory data records for an incident', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({
        Items: [
          {
            PK: 'INCIDENT#inc-001',
            SK: 'REGDATA#worksafebc_employer',
            incident_id: 'inc-001',
            type: 'worksafebc_employer',
            data: { employer_name: 'Acme Construction' },
            is_complete: false,
            last_updated: '2024-01-15T12:00:00Z',
            updated_by: 'user-001',
          },
          {
            PK: 'INCIDENT#inc-001',
            SK: 'REGDATA#osha_300',
            incident_id: 'inc-001',
            type: 'osha_300',
            data: { case_identifier: 'OSHA-001' },
            is_complete: false,
            last_updated: '2024-01-15T13:00:00Z',
            updated_by: 'user-001',
          },
        ],
      });

      const response = await handler(buildGetEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.regulatory_data).toHaveLength(2);
      expect(body.regulatory_data[0].type).toBe('worksafebc_employer');
      expect(body.regulatory_data[1].type).toBe('osha_300');
    });

    it('returns empty array when no regulatory data exists', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());
      mockSend.mockResolvedValue({ Items: [] });

      const response = await handler(buildGetEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.regulatory_data).toHaveLength(0);
    });

    it('returns 404 when incident does not exist', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(undefined);

      const response = await handler(buildGetEvent());
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /incidents/{id}/worksafebc-summary', () => {
    function buildSummaryEvent() {
      return {
        httpMethod: 'GET',
        resource: '/incidents/{id}/worksafebc-summary',
        pathParameters: { id: 'inc-001' },
        queryStringParameters: null,
        body: null,
      };
    }

    it('returns summary with data from incident and regulatory data (Req 8.1)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());

      // First call: GetCommand for worksafebc_emergency regulatory data
      // Second call: QueryCommand for persons involved
      mockSend
        .mockResolvedValueOnce({
          Item: {
            PK: 'INCIDENT#inc-001',
            SK: 'REGDATA#worksafebc_emergency',
            data: {
              employer_contact_name: 'Bob Manager',
              employer_contact_phone: '604-555-9999',
            },
          },
        })
        .mockResolvedValueOnce({
          Items: [
            { full_name: 'Jane Smith', involvement_type: 'injured_worker' },
            { full_name: 'Tom Witness', involvement_type: 'witness' },
          ],
        });

      const response = await handler(buildSummaryEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.incident_id).toBe('inc-001');
      expect(body.summary.employer_contact_name).toBe('Bob Manager');
      expect(body.summary.employer_contact_phone).toBe('604-555-9999');
      expect(body.summary.incident_location).toBe('Building A, Floor 2');
      expect(body.summary.incident_datetime).toBe('2024-01-15T10:00:00Z');
      expect(body.summary.workers_involved_count).toBe(2);
      expect(body.summary.worker_names).toEqual(['Jane Smith', 'Tom Witness']);
      expect(body.summary.brief_description).toBe(
        'A worker fell from scaffolding on the second floor of Building A.'
      );
      expect(body.missing_fields).toHaveLength(0);
      expect(body.is_complete).toBe(true);
    });

    it('indicates missing fields when data is incomplete (Req 8.3)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());

      // No regulatory data exists
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Items: [] });

      const response = await handler(buildSummaryEvent());
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.missing_fields).toContain('employer_contact_name');
      expect(body.missing_fields).toContain('employer_contact_phone');
      expect(body.missing_fields).toContain('worker_names');
      expect(body.is_complete).toBe(false);
    });

    it('truncates description to 500 characters (Req 8.1)', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      const longDescription = 'A'.repeat(1000);
      mockGetIncident.mockResolvedValue(buildIncident({ description: longDescription }));

      mockSend
        .mockResolvedValueOnce({
          Item: {
            PK: 'INCIDENT#inc-001',
            SK: 'REGDATA#worksafebc_emergency',
            data: {
              employer_contact_name: 'Bob',
              employer_contact_phone: '604-555-9999',
            },
          },
        })
        .mockResolvedValueOnce({
          Items: [{ full_name: 'Jane Smith' }],
        });

      const response = await handler(buildSummaryEvent());
      const body = JSON.parse(response.body);

      expect(body.summary.brief_description.length).toBe(500);
    });

    it('returns 404 when incident does not exist', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(undefined);

      const response = await handler(buildSummaryEvent());
      expect(response.statusCode).toBe(404);
    });

    it('uses worker names from persons involved over regulatory data', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());

      mockSend
        .mockResolvedValueOnce({
          Item: {
            PK: 'INCIDENT#inc-001',
            SK: 'REGDATA#worksafebc_emergency',
            data: {
              employer_contact_name: 'Bob',
              employer_contact_phone: '604-555-9999',
              worker_names: ['Old Name'],
            },
          },
        })
        .mockResolvedValueOnce({
          Items: [{ full_name: 'Current Worker Name' }],
        });

      const response = await handler(buildSummaryEvent());
      const body = JSON.parse(response.body);

      // Should prefer persons involved over regulatory data worker_names
      expect(body.summary.worker_names).toEqual(['Current Worker Name']);
    });

    it('falls back to regulatory data worker_names when no persons involved', async () => {
      authenticateAs(Role.TENANT_ADMIN);
      mockGetIncident.mockResolvedValue(buildIncident());

      mockSend
        .mockResolvedValueOnce({
          Item: {
            PK: 'INCIDENT#inc-001',
            SK: 'REGDATA#worksafebc_emergency',
            data: {
              employer_contact_name: 'Bob',
              employer_contact_phone: '604-555-9999',
              worker_names: ['Fallback Name'],
            },
          },
        })
        .mockResolvedValueOnce({ Items: [] });

      const response = await handler(buildSummaryEvent());
      const body = JSON.parse(response.body);

      expect(body.summary.worker_names).toEqual(['Fallback Name']);
    });
  });
});
