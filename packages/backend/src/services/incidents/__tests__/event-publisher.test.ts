/**
 * Tests for the incident event publisher module.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  publishIncidentCreated,
  publishIncidentUpdated,
  publishRegulatoryImmediateNotification,
} from '../event-publisher.js';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
} from '../types.js';
import type { IncidentRecord, RegulatoryDeadline } from '../types.js';

// Mock the shared event-publisher
const mockPublishToSns = vi.fn().mockResolvedValue({
  event_id: 'mock-event-id',
  event_type: 'test',
  source_service: 'incident-service',
  tenant_id: 'tenant-1',
  timestamp: '2024-01-01T00:00:00.000Z',
  payload: {},
  correlation_id: 'mock-corr-id',
  version: '1.0',
});

vi.mock('../../../shared/event-publisher.js', () => ({
  publishToSns: (...args: unknown[]) => mockPublishToSns(...args),
  buildPlatformEvent: vi.fn(),
}));

describe('incident event-publisher', () => {
  const mockIncident: IncidentRecord = {
    incident_id: 'inc-123',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Test Incident',
    description: 'A test incident for unit testing',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-01-01T10:00:00.000Z',
    report_datetime: '2024-01-01T10:30:00.000Z',
    location: 'Building A, Floor 2',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'John Doe',
    severity: OperationalSeverity.CRITICAL,
    regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
    status: IncidentStatus.OPEN,
    external_report_status: ExternalReportStatus.NOT_REPORTABLE,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: true,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'us_state',
    created_at: '2024-01-01T10:30:00.000Z',
    updated_at: '2024-01-01T10:30:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['INCIDENT_EVENT_BUS_NAME'] = 'arn:aws:sns:us-east-1:123456789:incident-events';
  });

  describe('publishIncidentCreated', () => {
    it('publishes an incident.created event with correct payload', async () => {
      await publishIncidentCreated(mockIncident);

      expect(mockPublishToSns).toHaveBeenCalledTimes(1);
      const [topicArn, params] = mockPublishToSns.mock.calls[0]!;

      expect(topicArn).toBe('arn:aws:sns:us-east-1:123456789:incident-events');
      expect(params.event_type).toBe('incident.created');
      expect(params.source_service).toBe('incident-service');
      expect(params.tenant_id).toBe('tenant-1');
      expect(params.payload.incident_id).toBe('inc-123');
      expect(params.payload.severity).toBe('critical');
      expect(params.payload.site_id).toBe('site-1');
      expect(params.payload.title).toBe('Test Incident');
    });

    it('throws when no topic ARN is configured', async () => {
      delete process.env['INCIDENT_EVENT_BUS_NAME'];
      delete process.env['SNS_TOPIC_ARN'];

      await expect(publishIncidentCreated(mockIncident)).rejects.toThrow(
        'INCIDENT_EVENT_BUS_NAME or SNS_TOPIC_ARN environment variable is not configured'
      );
    });

    it('falls back to SNS_TOPIC_ARN when INCIDENT_EVENT_BUS_NAME is not set', async () => {
      delete process.env['INCIDENT_EVENT_BUS_NAME'];
      process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789:default-topic';

      await publishIncidentCreated(mockIncident);

      const [topicArn] = mockPublishToSns.mock.calls[0]!;
      expect(topicArn).toBe('arn:aws:sns:us-east-1:123456789:default-topic');
    });
  });

  describe('publishIncidentUpdated', () => {
    it('publishes an incident.updated event with change type', async () => {
      await publishIncidentUpdated(mockIncident, 'severity_change');

      expect(mockPublishToSns).toHaveBeenCalledTimes(1);
      const [, params] = mockPublishToSns.mock.calls[0]!;

      expect(params.event_type).toBe('incident.updated');
      expect(params.source_service).toBe('incident-service');
      expect(params.tenant_id).toBe('tenant-1');
      expect(params.payload.incident_id).toBe('inc-123');
      expect(params.payload.change_type).toBe('severity_change');
    });

    it('includes regulatory flag in the payload', async () => {
      await publishIncidentUpdated(mockIncident, 'regulatory_flag_change');

      const [, params] = mockPublishToSns.mock.calls[0]!;
      expect(params.payload.regulatory_flag).toBe('immediately_reportable');
    });
  });

  describe('publishRegulatoryImmediateNotification', () => {
    const mockDeadline: RegulatoryDeadline = {
      authority: 'OSHA',
      deadline_hours: 8,
      deadline_from: 'incident_time',
      absolute_deadline: '2024-01-01T18:00:00.000Z',
      description: 'OSHA fatality notification within 8 hours',
    };

    it('publishes a regulatory.immediate_notification event', async () => {
      await publishRegulatoryImmediateNotification(mockIncident, mockDeadline);

      expect(mockPublishToSns).toHaveBeenCalledTimes(1);
      const [, params] = mockPublishToSns.mock.calls[0]!;

      expect(params.event_type).toBe('regulatory.immediate_notification');
      expect(params.source_service).toBe('incident-service');
      expect(params.tenant_id).toBe('tenant-1');
      expect(params.payload.incident_id).toBe('inc-123');
      expect(params.payload.authority).toBe('OSHA');
      expect(params.payload.deadline_hours).toBe(8);
      expect(params.payload.absolute_deadline).toBe('2024-01-01T18:00:00.000Z');
      expect(params.payload.description).toBe('OSHA fatality notification within 8 hours');
    });

    it('includes jurisdiction and site info in the payload', async () => {
      await publishRegulatoryImmediateNotification(mockIncident, mockDeadline);

      const [, params] = mockPublishToSns.mock.calls[0]!;
      expect(params.payload.jurisdiction).toBe('us_state');
      expect(params.payload.site_id).toBe('site-1');
      expect(params.payload.reporting_user_name).toBe('John Doe');
    });
  });
});
