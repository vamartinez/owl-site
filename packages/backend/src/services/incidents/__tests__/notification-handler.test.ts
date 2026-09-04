/**
 * Tests for the notification handler and incident event publisher.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handler,
  parseIncomingEvent,
  determineRecipients,
} from '../notification-handler.js';
import { OperationalSeverity, RegulatoryFlag } from '../types.js';

// Mock AWS SDK SNS client
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ MessageId: 'mock-message-id' }),
  })),
  PublishCommand: vi.fn().mockImplementation((params) => params),
}));

// Mock timeline-repository
vi.mock('../timeline-repository.js', () => ({
  appendEvent: vi.fn().mockResolvedValue({}),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

describe('notification-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NOTIFICATION_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789:notifications';
  });

  describe('parseIncomingEvent', () => {
    it('parses a direct event with event_type and payload', () => {
      const event = {
        event_type: 'incident.created',
        source_service: 'incident-service',
        tenant_id: 'tenant-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload: { incident_id: 'inc-1', severity: 'critical' },
        correlation_id: 'corr-1',
      };

      const result = parseIncomingEvent(event);
      expect(result).not.toBeNull();
      expect(result!.event_type).toBe('incident.created');
      expect(result!.tenant_id).toBe('tenant-1');
      expect(result!.payload['incident_id']).toBe('inc-1');
    });

    it('parses an SNS-wrapped event', () => {
      const event = {
        Records: [
          {
            Sns: {
              Message: JSON.stringify({
                event_type: 'incident.created',
                source_service: 'incident-service',
                tenant_id: 'tenant-2',
                timestamp: '2024-01-01T00:00:00.000Z',
                payload: { incident_id: 'inc-2', severity: 'critical' },
              }),
            },
          },
        ],
      };

      const result = parseIncomingEvent(event);
      expect(result).not.toBeNull();
      expect(result!.event_type).toBe('incident.created');
      expect(result!.tenant_id).toBe('tenant-2');
      expect(result!.payload['incident_id']).toBe('inc-2');
    });

    it('parses an EventBridge event wrapper', () => {
      const event = {
        'detail-type': 'incident.created',
        source: 'incident-service',
        time: '2024-01-01T00:00:00.000Z',
        detail: {
          tenant_id: 'tenant-3',
          incident_id: 'inc-3',
          severity: 'critical',
        },
      };

      const result = parseIncomingEvent(event);
      expect(result).not.toBeNull();
      expect(result!.event_type).toBe('incident.created');
      expect(result!.tenant_id).toBe('tenant-3');
    });

    it('returns null for unrecognized event format', () => {
      const result = parseIncomingEvent({ random: 'data' });
      expect(result).toBeNull();
    });

    it('returns null for null/undefined input', () => {
      expect(parseIncomingEvent(null)).toBeNull();
      expect(parseIncomingEvent(undefined)).toBeNull();
    });
  });

  describe('determineRecipients', () => {
    it('returns supervisor + CSO for incident.created with Critical severity', () => {
      const recipients = determineRecipients('incident.created', {
        severity: OperationalSeverity.CRITICAL,
        incident_id: 'inc-1',
      });

      expect(recipients).toHaveLength(2);
      expect(recipients[0]!.role).toBe('supervisor');
      expect(recipients[1]!.role).toBe('cso');
    });

    it('returns empty for incident.created with non-Critical severity', () => {
      const recipients = determineRecipients('incident.created', {
        severity: OperationalSeverity.HIGH,
        incident_id: 'inc-1',
      });

      expect(recipients).toHaveLength(0);
    });

    it('returns empty for incident.created with Low severity', () => {
      const recipients = determineRecipients('incident.created', {
        severity: OperationalSeverity.LOW,
        incident_id: 'inc-1',
      });

      expect(recipients).toHaveLength(0);
    });

    it('returns CSO + tenant_admin for regulatory.immediate_notification', () => {
      const recipients = determineRecipients('regulatory.immediate_notification', {
        incident_id: 'inc-1',
        authority: 'OSHA',
        deadline_hours: 8,
      });

      expect(recipients).toHaveLength(2);
      expect(recipients[0]!.role).toBe('cso');
      expect(recipients[1]!.role).toBe('tenant_admin');
      expect(recipients[0]!.reason).toContain('OSHA');
      expect(recipients[0]!.reason).toContain('8h');
    });

    it('returns CSO + tenant_admin for incident.updated with immediately_reportable flag', () => {
      const recipients = determineRecipients('incident.updated', {
        incident_id: 'inc-1',
        regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
      });

      expect(recipients).toHaveLength(2);
      expect(recipients[0]!.role).toBe('cso');
      expect(recipients[1]!.role).toBe('tenant_admin');
    });

    it('returns CSO + tenant_admin for incident.updated with potentially_reportable flag', () => {
      const recipients = determineRecipients('incident.updated', {
        incident_id: 'inc-1',
        regulatory_flag: RegulatoryFlag.POTENTIALLY_REPORTABLE,
      });

      expect(recipients).toHaveLength(2);
      expect(recipients[0]!.role).toBe('cso');
      expect(recipients[1]!.role).toBe('tenant_admin');
    });

    it('returns empty for incident.updated with internal_only flag', () => {
      const recipients = determineRecipients('incident.updated', {
        incident_id: 'inc-1',
        regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
      });

      expect(recipients).toHaveLength(0);
    });

    it('returns empty for unknown event type', () => {
      const recipients = determineRecipients('unknown.event', {
        incident_id: 'inc-1',
      });

      expect(recipients).toHaveLength(0);
    });
  });

  describe('handler', () => {
    it('processes incident.created with Critical severity and sends notifications', async () => {
      const event = {
        event_type: 'incident.created',
        source_service: 'incident-service',
        tenant_id: 'tenant-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload: {
          incident_id: 'inc-1',
          site_id: 'site-1',
          title: 'Critical incident',
          severity: OperationalSeverity.CRITICAL,
          regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
        },
      };

      const result = await handler(event);

      expect(result.event_type).toBe('incident.created');
      expect(result.incident_id).toBe('inc-1');
      expect(result.recipients).toHaveLength(2);
      expect(result.notifications_sent).toBe(2);
      expect(result.timeline_recorded).toBe(true);
    });

    it('skips notifications for non-Critical incident.created', async () => {
      const event = {
        event_type: 'incident.created',
        source_service: 'incident-service',
        tenant_id: 'tenant-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload: {
          incident_id: 'inc-2',
          site_id: 'site-1',
          title: 'Low severity incident',
          severity: OperationalSeverity.LOW,
          regulatory_flag: RegulatoryFlag.INTERNAL_ONLY,
        },
      };

      const result = await handler(event);

      expect(result.event_type).toBe('incident.created');
      expect(result.recipients).toHaveLength(0);
      expect(result.notifications_sent).toBe(0);
      expect(result.timeline_recorded).toBe(false);
    });

    it('processes regulatory.immediate_notification and notifies CSO + tenant_admin', async () => {
      const event = {
        event_type: 'regulatory.immediate_notification',
        source_service: 'incident-service',
        tenant_id: 'tenant-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        payload: {
          incident_id: 'inc-3',
          site_id: 'site-1',
          title: 'Fatality incident',
          severity: OperationalSeverity.CRITICAL,
          regulatory_flag: RegulatoryFlag.IMMEDIATELY_REPORTABLE,
          authority: 'OSHA',
          deadline_hours: 8,
        },
      };

      const result = await handler(event);

      expect(result.event_type).toBe('regulatory.immediate_notification');
      expect(result.incident_id).toBe('inc-3');
      expect(result.recipients).toHaveLength(2);
      expect(result.recipients[0]!.role).toBe('cso');
      expect(result.recipients[1]!.role).toBe('tenant_admin');
      expect(result.notifications_sent).toBe(2);
      expect(result.timeline_recorded).toBe(true);
    });

    it('handles unparseable events gracefully', async () => {
      const result = await handler({ random: 'garbage' });

      expect(result.event_type).toBe('unknown');
      expect(result.incident_id).toBe('unknown');
      expect(result.recipients).toHaveLength(0);
      expect(result.notifications_sent).toBe(0);
      expect(result.timeline_recorded).toBe(false);
    });
  });
});
