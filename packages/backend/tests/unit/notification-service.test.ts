/**
 * Unit tests for the Notification Service.
 * Tests template rendering, channel dispatch logic, and SQS handler routing.
 *
 * Requirements: 10.3, 11.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationChannel } from '../../src/shared/types/common.js';
import { EventTypes } from '../../src/shared/types/events.js';

// --- Mocks ---

const mockSend = vi.fn();
const mockSesSend = vi.fn();
const mockSnsSend = vi.fn();

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Get' })),
  QueryCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
}));

vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (name: string) => `dev-${name}`,
}));

vi.mock('../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSesSend(...args),
  })),
  SendEmailCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'SendEmail' })),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSnsSend(...args),
  })),
  PublishCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Publish' })),
}));

// Import after mocks
import { getTemplate, renderTemplate } from '../../src/services/notification/templates.js';
import { NotificationTemplateType, NotificationPriority } from '../../src/services/notification/types.js';
import type { NotificationRequest } from '../../src/services/notification/types.js';
import { handler, dispatchNotification, notifyEnforcementAction } from '../../src/services/notification/handler.js';
import { sendEmail } from '../../src/services/notification/channels/email.js';
import { sendSms } from '../../src/services/notification/channels/sms.js';
import { sendPush } from '../../src/services/notification/channels/push.js';

// --- Template Tests ---

describe('notification-service: templates', () => {
  describe('getTemplate', () => {
    it('returns template for cert_expiry_30_days', () => {
      const template = getTemplate(NotificationTemplateType.CERT_EXPIRY_30_DAYS);
      expect(template.subject).toContain('30 Days');
      expect(template.body).toContain('30 days');
      expect(template.sms_body).toContain('30 days');
    });

    it('returns template for cert_expiry_14_days', () => {
      const template = getTemplate(NotificationTemplateType.CERT_EXPIRY_14_DAYS);
      expect(template.subject).toContain('14 Days');
      expect(template.body).toContain('14 days');
      expect(template.sms_body).toContain('14 days');
    });

    it('returns template for cert_expiry_7_days', () => {
      const template = getTemplate(NotificationTemplateType.CERT_EXPIRY_7_DAYS);
      expect(template.subject).toContain('7 Days');
      expect(template.body).toContain('7 days');
      expect(template.sms_body).toContain('7 days');
    });

    it('returns template for enforcement_action_created', () => {
      const template = getTemplate(NotificationTemplateType.ENFORCEMENT_ACTION_CREATED);
      expect(template.subject).toContain('Enforcement Action');
      expect(template.body).toContain('enforcement action');
      expect(template.sms_body).toContain('ENFORCEMENT');
    });

    it('returns template for escalation', () => {
      const template = getTemplate(NotificationTemplateType.ESCALATION);
      expect(template.subject).toContain('Escalation');
      expect(template.body).toContain('escalated');
      expect(template.sms_body).toContain('ESCALATION');
    });

    it('returns template for access_decision_denied', () => {
      const template = getTemplate(NotificationTemplateType.ACCESS_DECISION_DENIED);
      expect(template.subject).toContain('Denied');
      expect(template.body).toContain('denied');
    });

    it('returns template for override_request_created', () => {
      const template = getTemplate(NotificationTemplateType.OVERRIDE_REQUEST_CREATED);
      expect(template.subject).toContain('Override Request');
    });

    it('throws for unknown template type', () => {
      expect(() => getTemplate('unknown' as NotificationTemplateType)).toThrow(
        'Unknown notification template type'
      );
    });
  });

  describe('renderTemplate', () => {
    it('replaces all placeholders with provided data', () => {
      const template = getTemplate(NotificationTemplateType.CERT_EXPIRY_30_DAYS);
      const rendered = renderTemplate(template, {
        worker_name: 'John Doe',
        certification_type: 'WHMIS 2015',
        expiry_date: '2024-07-15',
        site_name: 'Downtown Tower',
      });

      expect(rendered.subject).toContain('WHMIS 2015');
      expect(rendered.body).toContain('John Doe');
      expect(rendered.body).toContain('2024-07-15');
      expect(rendered.body).toContain('Downtown Tower');
      expect(rendered.sms_body).toContain('WHMIS 2015');
      expect(rendered.sms_body).toContain('2024-07-15');
    });

    it('leaves unmatched placeholders as-is', () => {
      const template = getTemplate(NotificationTemplateType.CERT_EXPIRY_30_DAYS);
      const rendered = renderTemplate(template, {
        worker_name: 'Jane',
        // Missing certification_type, expiry_date, site_name
      });

      expect(rendered.body).toContain('Jane');
      expect(rendered.body).toContain('{{certification_type}}');
      expect(rendered.body).toContain('{{expiry_date}}');
    });

    it('renders enforcement action template with all fields', () => {
      const template = getTemplate(NotificationTemplateType.ENFORCEMENT_ACTION_CREATED);
      const rendered = renderTemplate(template, {
        action_type: 'deny entry',
        worker_name: 'Bob Smith',
        worker_id: 'worker-123',
        site_name: 'Harbor Project',
        timestamp: '2024-06-15T10:30:00Z',
      });

      expect(rendered.subject).toContain('deny entry');
      expect(rendered.body).toContain('Bob Smith');
      expect(rendered.body).toContain('worker-123');
      expect(rendered.body).toContain('Harbor Project');
      expect(rendered.sms_body).toContain('Bob Smith');
      expect(rendered.sms_body).toContain('Harbor Project');
    });
  });
});

// --- Channel Tests ---

describe('notification-service: email channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends email via SES and returns success', async () => {
    mockSesSend.mockResolvedValueOnce({ MessageId: 'ses-msg-123' });

    const result = await sendEmail({
      to: 'worker@example.com',
      subject: 'Test Subject',
      body: 'Test body content',
      correlation_id: 'corr-1',
    });

    expect(result.success).toBe(true);
    expect(result.message_id).toBe('ses-msg-123');
  });

  it('returns failure when SES throws', async () => {
    mockSesSend.mockRejectedValueOnce(new Error('SES rate limit exceeded'));

    const result = await sendEmail({
      to: 'worker@example.com',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SES rate limit exceeded');
  });
});

describe('notification-service: sms channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends SMS via SNS and returns success', async () => {
    mockSnsSend.mockResolvedValueOnce({ MessageId: 'sns-msg-456' });

    const result = await sendSms({
      phoneNumber: '+16045551234',
      message: 'Your cert expires soon',
      correlation_id: 'corr-2',
    });

    expect(result.success).toBe(true);
    expect(result.message_id).toBe('sns-msg-456');
  });

  it('returns failure when SNS throws', async () => {
    mockSnsSend.mockRejectedValueOnce(new Error('Invalid phone number'));

    const result = await sendSms({
      phoneNumber: 'invalid',
      message: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid phone number');
  });
});

describe('notification-service: push channel', () => {
  it('returns not-implemented result', async () => {
    const result = await sendPush({
      device_token: 'token-abc',
      title: 'Test',
      body: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });
});

// --- Dispatch Tests ---

describe('notification-service: dispatchNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches email notification when channel is EMAIL', async () => {
    mockSesSend.mockResolvedValueOnce({ MessageId: 'ses-1' });

    const request: NotificationRequest = {
      notification_id: 'notif-1',
      tenant_id: 'tenant-1',
      recipient_id: 'worker-1',
      recipient_email: 'worker@test.com',
      recipient_phone: '+16045551234',
      channel: NotificationChannel.EMAIL,
      template_type: NotificationTemplateType.CERT_EXPIRY_30_DAYS,
      template_data: {
        worker_name: 'John',
        certification_type: 'WHMIS',
        expiry_date: '2024-07-15',
        site_name: 'Site A',
      },
      priority: NotificationPriority.MEDIUM,
      created_at: '2024-06-15T10:00:00Z',
    };

    const results = await dispatchNotification(request);

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe(NotificationChannel.EMAIL);
    expect(results[0].status).toBe('sent');
    expect(results[0].message_id).toBe('ses-1');
  });

  it('dispatches SMS notification when channel is SMS', async () => {
    mockSnsSend.mockResolvedValueOnce({ MessageId: 'sns-1' });

    const request: NotificationRequest = {
      notification_id: 'notif-2',
      tenant_id: 'tenant-1',
      recipient_id: 'worker-1',
      recipient_email: 'worker@test.com',
      recipient_phone: '+16045551234',
      channel: NotificationChannel.SMS,
      template_type: NotificationTemplateType.ACCESS_DECISION_DENIED,
      template_data: {
        worker_name: 'Jane',
        site_name: 'Site B',
        decision_id: 'dec-123',
        reasons: 'Missing WHMIS certification',
      },
      priority: NotificationPriority.HIGH,
      created_at: '2024-06-15T10:00:00Z',
    };

    const results = await dispatchNotification(request);

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe(NotificationChannel.SMS);
    expect(results[0].status).toBe('sent');
  });

  it('falls back to SMS when email is not available', async () => {
    mockSnsSend.mockResolvedValueOnce({ MessageId: 'sns-fallback' });

    const request: NotificationRequest = {
      notification_id: 'notif-3',
      tenant_id: 'tenant-1',
      recipient_id: 'worker-1',
      recipient_email: undefined,
      recipient_phone: '+16045551234',
      channel: NotificationChannel.EMAIL,
      template_type: NotificationTemplateType.CERT_EXPIRY_7_DAYS,
      template_data: {
        worker_name: 'Bob',
        certification_type: 'Fall Protection',
        expiry_date: '2024-06-22',
        site_name: 'Site C',
      },
      priority: NotificationPriority.HIGH,
      created_at: '2024-06-15T10:00:00Z',
    };

    const results = await dispatchNotification(request);

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe(NotificationChannel.SMS);
    expect(results[0].status).toBe('sent');
  });

  it('falls back to email when phone is not available', async () => {
    mockSesSend.mockResolvedValueOnce({ MessageId: 'ses-fallback' });

    const request: NotificationRequest = {
      notification_id: 'notif-4',
      tenant_id: 'tenant-1',
      recipient_id: 'worker-1',
      recipient_email: 'worker@test.com',
      recipient_phone: undefined,
      channel: NotificationChannel.SMS,
      template_type: NotificationTemplateType.ENFORCEMENT_ACTION_CREATED,
      template_data: {
        action_type: 'deny entry',
        worker_name: 'Alice',
        worker_id: 'w-1',
        site_name: 'Site D',
        timestamp: '2024-06-15T10:00:00Z',
      },
      priority: NotificationPriority.URGENT,
      created_at: '2024-06-15T10:00:00Z',
    };

    const results = await dispatchNotification(request);

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe(NotificationChannel.EMAIL);
    expect(results[0].status).toBe('sent');
  });

  it('returns failed status when delivery fails', async () => {
    mockSesSend.mockRejectedValueOnce(new Error('SES error'));

    const request: NotificationRequest = {
      notification_id: 'notif-5',
      tenant_id: 'tenant-1',
      recipient_id: 'worker-1',
      recipient_email: 'worker@test.com',
      channel: NotificationChannel.EMAIL,
      template_type: NotificationTemplateType.ACCESS_DECISION_ALLOWED,
      template_data: {
        worker_name: 'Test',
        site_name: 'Site',
        decision_id: 'dec-1',
        timestamp: '2024-06-15T10:00:00Z',
      },
      priority: NotificationPriority.LOW,
      created_at: '2024-06-15T10:00:00Z',
    };

    const results = await dispatchNotification(request);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('SES error');
  });
});

// --- Enforcement Notification Tests ---

describe('notification-service: notifyEnforcementAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies responsible party via email for enforcement action', async () => {
    // Mock getWorkerContact for responsible party
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'TENANT#tenant-1',
        SK: 'WORKER#supervisor-1',
        legal_name: 'Supervisor Smith',
        preferred_name: 'Smith',
        email: 'smith@company.com',
        phone: '+16045559999',
        preferred_channel: NotificationChannel.EMAIL,
      },
    });
    // Mock getWorkerContact for worker
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'TENANT#tenant-1',
        SK: 'WORKER#worker-1',
        legal_name: 'Worker Jones',
        preferred_name: 'Jones',
      },
    });
    // Mock getSiteInfo
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'TENANT#tenant-1',
        SK: 'SITE#site-1',
        name: 'Downtown Tower',
      },
    });
    // Mock SES send
    mockSesSend.mockResolvedValueOnce({ MessageId: 'ses-enforce-1' });

    const results = await notifyEnforcementAction(
      'tenant-1',
      'enforce-action-1',
      'deny_entry',
      'supervisor-1',
      'worker-1',
      'site-1',
      'corr-123'
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('sent');
    expect(results[0].channel).toBe(NotificationChannel.EMAIL);
  });

  it('returns empty array when responsible party not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const results = await notifyEnforcementAction(
      'tenant-1',
      'enforce-action-2',
      'escalate_to_cso',
      'unknown-user',
      'worker-1',
      'site-1'
    );

    expect(results).toHaveLength(0);
  });
});

// --- Handler Tests ---

describe('notification-service: handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes CertificationExpired event and sends notification', async () => {
    // Mock getWorkerContact
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'TENANT#tenant-1',
        SK: 'WORKER#worker-1',
        legal_name: 'John Doe',
        preferred_name: 'John',
        email: 'john@example.com',
        phone: '+16045551234',
        preferred_channel: NotificationChannel.EMAIL,
      },
    });
    // Mock SES send
    mockSesSend.mockResolvedValueOnce({ MessageId: 'ses-cert-1' });

    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-1',
          body: JSON.stringify({
            event_id: 'evt-1',
            event_type: EventTypes.CERTIFICATION_EXPIRED,
            source_service: 'cert-expiry-checker',
            tenant_id: 'tenant-1',
            timestamp: '2024-06-15T00:00:00Z',
            payload: {
              worker_id: 'worker-1',
              certification_type: 'WHMIS 2015',
              expiry_date: '2024-06-22',
              days_until_expiry: 7,
            },
            correlation_id: 'corr-1',
            version: '1.0',
          }),
          receiptHandle: 'handle-1',
          attributes: {} as Record<string, string>,
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-west-2:123:notification-queue',
          awsRegion: 'us-west-2',
        },
      ],
    };

    await handler(sqsEvent);

    // Should have called getWorkerContact
    expect(mockSend).toHaveBeenCalled();
    // Should have sent email
    expect(mockSesSend).toHaveBeenCalled();
  });

  it('processes AccessDecisionGenerated event for denied decision', async () => {
    // Mock getWorkerContact for worker
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'TENANT#tenant-1',
        SK: 'WORKER#worker-1',
        legal_name: 'Jane Worker',
        phone: '+16045551111',
        preferred_channel: NotificationChannel.SMS,
      },
    });
    // Mock getSiteInfo
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'TENANT#tenant-1',
        SK: 'SITE#site-1',
        name: 'Harbor Site',
      },
    });
    // Mock SNS send for SMS
    mockSnsSend.mockResolvedValueOnce({ MessageId: 'sns-access-1' });

    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-2',
          body: JSON.stringify({
            event_id: 'evt-2',
            event_type: EventTypes.ACCESS_DECISION_GENERATED,
            source_service: 'decision-engine',
            tenant_id: 'tenant-1',
            timestamp: '2024-06-15T08:30:00Z',
            payload: {
              decision_id: 'dec-1',
              worker_id: 'worker-1',
              site_id: 'site-1',
              decision_result: 'denied',
              reasons: ['Missing WHMIS certification', 'Fall protection expired'],
            },
            correlation_id: 'corr-2',
            version: '1.0',
          }),
          receiptHandle: 'handle-2',
          attributes: {} as Record<string, string>,
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-west-2:123:notification-queue',
          awsRegion: 'us-west-2',
        },
      ],
    };

    await handler(sqsEvent);

    expect(mockSend).toHaveBeenCalled();
    expect(mockSnsSend).toHaveBeenCalled();
  });

  it('handles unknown event types gracefully', async () => {
    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-3',
          body: JSON.stringify({
            event_id: 'evt-3',
            event_type: 'UnknownEventType',
            source_service: 'some-service',
            tenant_id: 'tenant-1',
            timestamp: '2024-06-15T10:00:00Z',
            payload: {},
            correlation_id: 'corr-3',
            version: '1.0',
          }),
          receiptHandle: 'handle-3',
          attributes: {} as Record<string, string>,
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-west-2:123:notification-queue',
          awsRegion: 'us-west-2',
        },
      ],
    };

    // Should not throw
    await expect(handler(sqsEvent)).resolves.toBeUndefined();
  });

  it('continues processing remaining records when one fails', async () => {
    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-4',
          body: 'invalid json {{{',
          receiptHandle: 'handle-4',
          attributes: {} as Record<string, string>,
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-west-2:123:notification-queue',
          awsRegion: 'us-west-2',
        },
        {
          messageId: 'msg-5',
          body: JSON.stringify({
            event_id: 'evt-5',
            event_type: 'UnknownEventType',
            source_service: 'test',
            tenant_id: 'tenant-1',
            timestamp: '2024-06-15T10:00:00Z',
            payload: {},
            correlation_id: 'corr-5',
            version: '1.0',
          }),
          receiptHandle: 'handle-5',
          attributes: {} as Record<string, string>,
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-west-2:123:notification-queue',
          awsRegion: 'us-west-2',
        },
      ],
    };

    // Should not throw even with invalid JSON in first record
    await expect(handler(sqsEvent)).resolves.toBeUndefined();
  });

  it('handles worker not found for cert expiry notification', async () => {
    // Mock getWorkerContact returns null
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-6',
          body: JSON.stringify({
            event_id: 'evt-6',
            event_type: EventTypes.CERTIFICATION_EXPIRED,
            source_service: 'cert-expiry-checker',
            tenant_id: 'tenant-1',
            timestamp: '2024-06-15T00:00:00Z',
            payload: {
              worker_id: 'nonexistent-worker',
              certification_type: 'WHMIS 2015',
              expiry_date: '2024-06-22',
              days_until_expiry: 7,
            },
            correlation_id: 'corr-6',
            version: '1.0',
          }),
          receiptHandle: 'handle-6',
          attributes: {} as Record<string, string>,
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-west-2:123:notification-queue',
          awsRegion: 'us-west-2',
        },
      ],
    };

    // Should not throw
    await expect(handler(sqsEvent)).resolves.toBeUndefined();
    // Should not attempt to send any notification
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(mockSnsSend).not.toHaveBeenCalled();
  });
});
