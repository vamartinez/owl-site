/**
 * TypeScript interfaces for the Notification Service.
 *
 * Requirements: 10.3, 11.1
 */

import { NotificationChannel } from '../../shared/types/common.js';

export interface NotificationRequest {
  notification_id: string;
  tenant_id: string;
  recipient_id: string;
  recipient_email?: string;
  recipient_phone?: string;
  channel: NotificationChannel;
  template_type: NotificationTemplateType;
  template_data: Record<string, string>;
  priority: NotificationPriority;
  correlation_id?: string;
  created_at: string;
}

export enum NotificationTemplateType {
  CERT_EXPIRY_30_DAYS = 'cert_expiry_30_days',
  CERT_EXPIRY_14_DAYS = 'cert_expiry_14_days',
  CERT_EXPIRY_7_DAYS = 'cert_expiry_7_days',
  ACCESS_DECISION_ALLOWED = 'access_decision_allowed',
  ACCESS_DECISION_DENIED = 'access_decision_denied',
  ACCESS_DECISION_CONDITIONAL = 'access_decision_conditional',
  ENFORCEMENT_ACTION_CREATED = 'enforcement_action_created',
  OVERRIDE_REQUEST_CREATED = 'override_request_created',
  OVERRIDE_REQUEST_APPROVED = 'override_request_approved',
  OVERRIDE_REQUEST_REJECTED = 'override_request_rejected',
  ESCALATION = 'escalation',
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export interface NotificationTemplate {
  subject: string;
  body: string;
  sms_body: string;
}

export interface NotificationResult {
  notification_id: string;
  channel: NotificationChannel;
  status: 'sent' | 'failed';
  message_id?: string;
  error?: string;
  sent_at: string;
}

export interface ChannelDeliveryResult {
  success: boolean;
  message_id?: string;
  error?: string;
}
