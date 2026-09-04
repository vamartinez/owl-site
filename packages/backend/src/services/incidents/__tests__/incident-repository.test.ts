import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { IncidentRecord } from '../types';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
} from '../types';

// Mock the dynamo-client module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (baseName: string) => `dev-${baseName}`,
}));

import { docClient } from '../../../shared/dynamo-client.js';
import {
  createIncident,
  getIncident,
  updateIncident,
  listByTenant,
  listBySite,
  listByStatus,
  listByRegulatoryFlag,
  listIncidents,
  incrementLinkedDocumentsCount,
  decrementLinkedDocumentsCount,
} from '../incident-repository';

const mockSend = vi.mocked(docClient.send);

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

describe('Incident Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createIncident', () => {
    it('sends a PutCommand with correct keys and GSI attributes', async () => {
      mockSend.mockResolvedValueOnce({} as never);
      const incident = buildIncident();

      const result = await createIncident(incident);

      expect(result).toEqual(incident);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Item).toMatchObject({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001',
        GSI1PK: 'TENANT#tenant-abc#SITE#site-xyz',
        GSI1SK: '2024-01-15T10:30:00Z',
        GSI2PK: 'TENANT#tenant-abc#STATUS#open',
        GSI2SK: '2024-01-15T10:30:00Z',
        GSI3PK: 'TENANT#tenant-abc#REGFLAG#internal_only',
        GSI3SK: '2024-01-15T10:30:00Z',
      });
      expect(command.input.ConditionExpression).toBe(
        'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      );
    });
  });

  describe('getIncident', () => {
    it('sends a GetCommand with tenant-scoped key', async () => {
      const incident = buildIncident();
      mockSend.mockResolvedValueOnce({ Item: incident } as never);

      const result = await getIncident('tenant-abc', 'inc-001');

      expect(result).toEqual(incident);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const command = mockSend.mock.calls[0][0] as GetCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001',
      });
    });

    it('returns undefined when incident is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined } as never);

      const result = await getIncident('tenant-abc', 'nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('updateIncident', () => {
    it('sends an UpdateCommand with dynamic expression for provided fields', async () => {
      const updatedRecord = buildIncident({ title: 'Updated Title' });
      mockSend.mockResolvedValueOnce({ Attributes: updatedRecord } as never);

      const result = await updateIncident('tenant-abc', 'inc-001', {
        title: 'Updated Title',
      });

      expect(result).toEqual(updatedRecord);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001',
      });
      expect(command.input.ConditionExpression).toBe(
        'attribute_exists(PK) AND attribute_exists(SK)'
      );
      expect(command.input.ReturnValues).toBe('ALL_NEW');
    });

    it('recalculates GSI2PK when status changes', async () => {
      const updatedRecord = buildIncident({ status: IncidentStatus.UNDER_REVIEW });
      mockSend.mockResolvedValueOnce({ Attributes: updatedRecord } as never);

      await updateIncident('tenant-abc', 'inc-001', {
        status: IncidentStatus.UNDER_REVIEW,
      });

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      const updateExpr = command.input.UpdateExpression as string;
      expect(updateExpr).toContain('#gsi2pk = :gsi2pk');

      const values = command.input.ExpressionAttributeValues!;
      expect(values[':gsi2pk']).toBe('TENANT#tenant-abc#STATUS#under_review');
    });

    it('recalculates GSI3PK when regulatory_flag changes', async () => {
      const updatedRecord = buildIncident({
        regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
      });
      mockSend.mockResolvedValueOnce({ Attributes: updatedRecord } as never);

      await updateIncident('tenant-abc', 'inc-001', {
        regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
      });

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      const values = command.input.ExpressionAttributeValues!;
      expect(values[':gsi3pk']).toBe('TENANT#tenant-abc#REGFLAG#immediately_reportable');
    });

    it('recalculates GSI1PK when site_id changes', async () => {
      const updatedRecord = buildIncident({ site_id: 'site-new' });
      mockSend.mockResolvedValueOnce({ Attributes: updatedRecord } as never);

      await updateIncident('tenant-abc', 'inc-001', {
        site_id: 'site-new',
      });

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      const values = command.input.ExpressionAttributeValues!;
      expect(values[':gsi1pk']).toBe('TENANT#tenant-abc#SITE#site-new');
    });
  });

  describe('listByTenant', () => {
    it('queries the primary table with tenant PK', async () => {
      const incidents = [buildIncident()];
      mockSend.mockResolvedValueOnce({ Items: incidents } as never);

      const result = await listByTenant('tenant-abc');

      expect(result.incidents).toEqual(incidents);
      expect(result.nextCursor).toBeUndefined();

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':pk': 'TENANT#tenant-abc',
        ':skPrefix': 'INCIDENT#',
      });
      expect(command.input.ScanIndexForward).toBe(false);
    });

    it('supports pagination with cursor', async () => {
      const lastKey = { PK: 'TENANT#tenant-abc', SK: 'INCIDENT#inc-001' };
      const cursor = Buffer.from(JSON.stringify(lastKey)).toString('base64');
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listByTenant('tenant-abc', { cursor });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.ExclusiveStartKey).toEqual(lastKey);
    });

    it('returns nextCursor when LastEvaluatedKey is present', async () => {
      const lastKey = { PK: 'TENANT#tenant-abc', SK: 'INCIDENT#inc-002' };
      mockSend.mockResolvedValueOnce({
        Items: [buildIncident()],
        LastEvaluatedKey: lastKey,
      } as never);

      const result = await listByTenant('tenant-abc');

      expect(result.nextCursor).toBe(
        Buffer.from(JSON.stringify(lastKey)).toString('base64')
      );
    });
  });

  describe('listBySite', () => {
    it('queries GSI1 with tenant and site in partition key', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listBySite('tenant-abc', 'site-xyz');

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI1');
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':gsi1pk': 'TENANT#tenant-abc#SITE#site-xyz',
      });
    });
  });

  describe('listByStatus', () => {
    it('queries GSI2 with tenant and status in partition key', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listByStatus('tenant-abc', 'open');

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI2');
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':gsi2pk': 'TENANT#tenant-abc#STATUS#open',
      });
    });
  });

  describe('listByRegulatoryFlag', () => {
    it('queries GSI3 with tenant and regulatory flag in partition key', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listByRegulatoryFlag('tenant-abc', 'immediately_reportable');

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI3');
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':gsi3pk': 'TENANT#tenant-abc#REGFLAG#immediately_reportable',
      });
    });
  });

  describe('listIncidents (unified)', () => {
    it('dispatches to listBySite when siteId filter is provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listIncidents('tenant-abc', { siteId: 'site-xyz' });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI1');
    });

    it('dispatches to listByStatus when status filter is provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listIncidents('tenant-abc', { status: 'open' });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI2');
    });

    it('dispatches to listByRegulatoryFlag when regulatoryFlag filter is provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listIncidents('tenant-abc', { regulatoryFlag: 'internal_only' });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI3');
    });

    it('falls back to listByTenant when no filters are provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listIncidents('tenant-abc');

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBeUndefined();
      expect(command.input.ExpressionAttributeValues).toMatchObject({
        ':pk': 'TENANT#tenant-abc',
      });
    });

    it('prioritizes siteId over status and regulatoryFlag', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] } as never);

      await listIncidents('tenant-abc', {
        siteId: 'site-xyz',
        status: 'open',
        regulatoryFlag: 'internal_only',
      });

      const command = mockSend.mock.calls[0][0] as QueryCommand;
      expect(command.input.IndexName).toBe('GSI1');
    });
  });

  describe('incrementLinkedDocumentsCount', () => {
    it('sends an UpdateCommand with ADD expression to increment count by 1', async () => {
      mockSend.mockResolvedValueOnce({} as never);

      await incrementLinkedDocumentsCount('tenant-abc', 'inc-001');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001',
      });
      expect(command.input.UpdateExpression).toBe('ADD #count :one');
      expect(command.input.ExpressionAttributeNames).toEqual({
        '#count': 'linked_documents_count',
      });
      expect(command.input.ExpressionAttributeValues).toEqual({
        ':one': 1,
      });
      expect(command.input.ConditionExpression).toBe(
        'attribute_exists(PK) AND attribute_exists(SK)'
      );
    });
  });

  describe('decrementLinkedDocumentsCount', () => {
    it('sends an UpdateCommand with ADD expression to decrement count by 1', async () => {
      mockSend.mockResolvedValueOnce({} as never);

      await decrementLinkedDocumentsCount('tenant-abc', 'inc-001');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.TableName).toBe('dev-Incidents');
      expect(command.input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'INCIDENT#inc-001',
      });
      expect(command.input.UpdateExpression).toBe('ADD #count :negOne');
      expect(command.input.ExpressionAttributeNames).toEqual({
        '#count': 'linked_documents_count',
      });
      expect(command.input.ExpressionAttributeValues).toEqual({
        ':negOne': -1,
        ':zero': 0,
      });
      expect(command.input.ConditionExpression).toBe(
        'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(#count) OR #count > :zero)'
      );
    });

    it('handles ConditionalCheckFailedException gracefully when count is already 0', async () => {
      const error = new Error('The conditional request failed');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      // Should not throw
      await expect(
        decrementLinkedDocumentsCount('tenant-abc', 'inc-001')
      ).resolves.toBeUndefined();
    });

    it('rethrows non-ConditionalCheckFailedException errors', async () => {
      const error = new Error('Service unavailable');
      error.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValueOnce(error);

      await expect(
        decrementLinkedDocumentsCount('tenant-abc', 'inc-001')
      ).rejects.toThrow('Service unavailable');
    });
  });
});
