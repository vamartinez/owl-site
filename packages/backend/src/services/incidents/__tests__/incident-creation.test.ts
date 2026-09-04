/**
 * Unit tests for the incident creation repository.
 * Validates: Requirements 9.1
 *
 * Verifies:
 * - Record is stored with correct partition key (TENANT#{tenant_id})
 * - Status is set to OPEN
 * - Generated UUID ID is used as incident_id
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';

// Mock the dynamo-client module to use our test mock
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

import { createIncident } from '../incident-repository.js';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
} from '../types.js';
import type { IncidentRecord } from '../types.js';

/**
 * Helper to build a valid IncidentRecord for testing.
 * Mimics what the handler constructs before calling createIncident.
 */
function buildIncidentRecord(overrides?: Partial<IncidentRecord>): IncidentRecord {
  return {
    incident_id: 'generated-uuid-001',
    tenant_id: 'tenant-acme',
    site_id: 'site-main',
    title: 'Slip and Fall',
    description: 'Worker slipped on wet floor in warehouse',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-03-10T08:30:00Z',
    report_datetime: '2024-03-10T09:00:00Z',
    location: 'Warehouse B, Aisle 3',
    persons_involved_count: 1,
    reporting_user_id: 'user-supervisor-1',
    reporting_user_name: 'supervisor@acme.com',
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
    created_at: '2024-03-10T09:00:00Z',
    updated_at: '2024-03-10T09:00:00Z',
    ...overrides,
  };
}

describe('Incident Creation Repository', () => {
  const putCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    resetDynamoMock();
    putCapture.length = 0;
    setupDynamoMock({ putCapture });
  });

  describe('partition key with tenant prefix', () => {
    it('stores PK as TENANT#{tenant_id}', async () => {
      const incident = buildIncidentRecord({ tenant_id: 'tenant-acme' });

      await createIncident(incident);

      const calls = getDynamoCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('PutCommand');

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.PK).toBe('TENANT#tenant-acme');
    });

    it('stores SK as INCIDENT#{incident_id}', async () => {
      const incident = buildIncidentRecord({ incident_id: 'inc-uuid-123' });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.SK).toBe('INCIDENT#inc-uuid-123');
    });

    it('uses different tenant prefix for different tenants', async () => {
      const incident = buildIncidentRecord({ tenant_id: 'tenant-globex' });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.PK).toBe('TENANT#tenant-globex');
    });

    it('populates GSI partition keys with tenant prefix', async () => {
      const incident = buildIncidentRecord({
        tenant_id: 'tenant-acme',
        site_id: 'site-north',
        status: IncidentStatus.OPEN,
        regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
      });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.GSI1PK).toBe('TENANT#tenant-acme#SITE#site-north');
      expect(item.GSI2PK).toBe('TENANT#tenant-acme#STATUS#open');
      expect(item.GSI3PK).toBe('TENANT#tenant-acme#REGFLAG#internal_only');
    });
  });

  describe('status OPEN on creation', () => {
    it('persists the incident with status OPEN', async () => {
      const incident = buildIncidentRecord({ status: IncidentStatus.OPEN });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.status).toBe('open');
    });

    it('includes status OPEN in GSI2PK for status-based queries', async () => {
      const incident = buildIncidentRecord({
        tenant_id: 'tenant-acme',
        status: IncidentStatus.OPEN,
      });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.GSI2PK).toBe('TENANT#tenant-acme#STATUS#open');
    });
  });

  describe('generated ID', () => {
    it('stores incident_id in the record', async () => {
      const incident = buildIncidentRecord({ incident_id: 'uuid-abc-123' });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.incident_id).toBe('uuid-abc-123');
    });

    it('uses incident_id in the sort key (SK)', async () => {
      const incident = buildIncidentRecord({ incident_id: 'uuid-def-456' });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.SK).toBe('INCIDENT#uuid-def-456');
    });

    it('returns the created incident record with the same ID', async () => {
      const incident = buildIncidentRecord({ incident_id: 'uuid-ghi-789' });

      const result = await createIncident(incident);

      expect(result.incident_id).toBe('uuid-ghi-789');
    });
  });

  describe('DynamoDB command construction', () => {
    it('sends PutCommand to the Incidents table', async () => {
      const incident = buildIncidentRecord();

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      expect(input.TableName).toBe('test-Incidents');
    });

    it('sets ConditionExpression to prevent overwrites', async () => {
      const incident = buildIncidentRecord();

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      expect(input.ConditionExpression).toBe(
        'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      );
    });

    it('spreads all incident fields into the Item', async () => {
      const incident = buildIncidentRecord();

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      // All incident fields should be present
      expect(item.title).toBe('Slip and Fall');
      expect(item.description).toBe('Worker slipped on wet floor in warehouse');
      expect(item.incident_type).toBe('injury');
      expect(item.severity).toBe('medium');
      expect(item.tenant_id).toBe('tenant-acme');
      expect(item.site_id).toBe('site-main');
      expect(item.created_at).toBe('2024-03-10T09:00:00Z');
      expect(item.updated_at).toBe('2024-03-10T09:00:00Z');
    });

    it('populates GSI sort keys with created_at timestamp', async () => {
      const incident = buildIncidentRecord({
        created_at: '2024-03-10T09:00:00Z',
      });

      await createIncident(incident);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;
      expect(item.GSI1SK).toBe('2024-03-10T09:00:00Z');
      expect(item.GSI2SK).toBe('2024-03-10T09:00:00Z');
      expect(item.GSI3SK).toBe('2024-03-10T09:00:00Z');
    });
  });

  describe('return value', () => {
    it('returns the incident record unchanged', async () => {
      const incident = buildIncidentRecord();

      const result = await createIncident(incident);

      expect(result).toEqual(incident);
    });
  });
});
