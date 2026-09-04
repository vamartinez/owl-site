/**
 * Hardcoded notification templates for the MVP.
 *
 * Templates cover:
 * - Certification expiry warnings (30/14/7 days)
 * - Access decisions (allowed, denied, conditional)
 * - Enforcement actions
 * - Override requests (created, approved, rejected)
 * - Escalations
 *
 * Template data placeholders use {{key}} syntax and are replaced at render time.
 *
 * Requirements: 10.3, 11.1
 */

import { NotificationTemplateType } from './types.js';
import type { NotificationTemplate } from './types.js';

const TEMPLATES: Record<NotificationTemplateType, NotificationTemplate> = {
  // --- Certification Expiry Warnings ---

  [NotificationTemplateType.CERT_EXPIRY_30_DAYS]: {
    subject: 'Certification Expiring in 30 Days: {{certification_type}}',
    body: 'Hello {{worker_name}},\n\nYour {{certification_type}} certification will expire on {{expiry_date}}. You have 30 days to renew it to maintain site access eligibility.\n\nPlease upload your renewed certification as soon as possible.\n\nSite: {{site_name}}',
    sms_body:
      'Your {{certification_type}} cert expires in 30 days ({{expiry_date}}). Renew to keep site access.',
  },

  [NotificationTemplateType.CERT_EXPIRY_14_DAYS]: {
    subject: 'Urgent: Certification Expiring in 14 Days — {{certification_type}}',
    body: 'Hello {{worker_name}},\n\nYour {{certification_type}} certification will expire on {{expiry_date}}. You have 14 days remaining. Failure to renew may result in denied site access.\n\nPlease upload your renewed certification immediately.\n\nSite: {{site_name}}',
    sms_body:
      'URGENT: Your {{certification_type}} cert expires in 14 days ({{expiry_date}}). Renew now to avoid access denial.',
  },

  [NotificationTemplateType.CERT_EXPIRY_7_DAYS]: {
    subject: 'Critical: Certification Expiring in 7 Days — {{certification_type}}',
    body: 'Hello {{worker_name}},\n\nYour {{certification_type}} certification will expire on {{expiry_date}}. You have only 7 days remaining. Site access will be denied once the certification expires.\n\nImmediate action required.\n\nSite: {{site_name}}',
    sms_body:
      'CRITICAL: Your {{certification_type}} cert expires in 7 days ({{expiry_date}}). Access will be denied after expiry.',
  },

  // --- Access Decisions ---

  [NotificationTemplateType.ACCESS_DECISION_ALLOWED]: {
    subject: 'Access Granted — {{site_name}}',
    body: 'Hello {{worker_name}},\n\nYour access to {{site_name}} has been granted.\n\nDecision ID: {{decision_id}}\nTimestamp: {{timestamp}}',
    sms_body: 'Access GRANTED to {{site_name}}. Decision: {{decision_id}}.',
  },

  [NotificationTemplateType.ACCESS_DECISION_DENIED]: {
    subject: 'Access Denied — {{site_name}}',
    body: 'Hello {{worker_name}},\n\nYour access to {{site_name}} has been denied.\n\nReasons:\n{{reasons}}\n\nPlease address the above requirements and try again.\n\nDecision ID: {{decision_id}}',
    sms_body:
      'Access DENIED to {{site_name}}. Reason: {{reasons}}. Contact your supervisor.',
  },

  [NotificationTemplateType.ACCESS_DECISION_CONDITIONAL]: {
    subject: 'Conditional Access — {{site_name}}',
    body: 'Hello {{worker_name}},\n\nYour access to {{site_name}} is conditional.\n\nConditions:\n{{reasons}}\n\nPlease fulfill the conditions by the specified deadline.\n\nDecision ID: {{decision_id}}',
    sms_body:
      'CONDITIONAL access to {{site_name}}. Conditions: {{reasons}}. Fulfill by deadline.',
  },

  // --- Enforcement Actions ---

  [NotificationTemplateType.ENFORCEMENT_ACTION_CREATED]: {
    subject: 'Enforcement Action Required — {{action_type}}',
    body: 'An enforcement action has been created requiring your attention.\n\nAction Type: {{action_type}}\nWorker: {{worker_name}} ({{worker_id}})\nSite: {{site_name}}\nCreated: {{timestamp}}\n\nPlease take appropriate action immediately.',
    sms_body:
      'ENFORCEMENT: {{action_type}} for worker {{worker_name}} at {{site_name}}. Immediate action required.',
  },

  // --- Override Requests ---

  [NotificationTemplateType.OVERRIDE_REQUEST_CREATED]: {
    subject: 'Override Request Submitted — Decision {{decision_id}}',
    body: 'An override request has been submitted for your review.\n\nDecision ID: {{decision_id}}\nRequester: {{requester_name}}\nReason: {{reason}}\n\nPlease review and approve or reject this request.',
    sms_body:
      'Override request for decision {{decision_id}} by {{requester_name}}. Review required.',
  },

  [NotificationTemplateType.OVERRIDE_REQUEST_APPROVED]: {
    subject: 'Override Request Approved — Decision {{decision_id}}',
    body: 'Your override request has been approved.\n\nDecision ID: {{decision_id}}\nApproved by: {{approver_name}}\nExpires: {{expiration_date}}\n\nThe override is now active.',
    sms_body:
      'Override APPROVED for decision {{decision_id}}. Expires: {{expiration_date}}.',
  },

  [NotificationTemplateType.OVERRIDE_REQUEST_REJECTED]: {
    subject: 'Override Request Rejected — Decision {{decision_id}}',
    body: 'Your override request has been rejected.\n\nDecision ID: {{decision_id}}\nRejected by: {{approver_name}}\n\nPlease contact your site administrator for further assistance.',
    sms_body:
      'Override REJECTED for decision {{decision_id}}. Contact site admin.',
  },

  // --- Escalations ---

  [NotificationTemplateType.ESCALATION]: {
    subject: 'Escalation: Unresolved Enforcement Action — {{action_type}}',
    body: 'An enforcement action has been escalated due to non-resolution within the required timeframe.\n\nOriginal Action: {{original_action_type}}\nEscalated To: {{action_type}}\nWorker: {{worker_name}} ({{worker_id}})\nSite: {{site_name}}\nOriginal Created: {{original_timestamp}}\nEscalated: {{timestamp}}\n\nImmediate attention required.',
    sms_body:
      'ESCALATION: {{action_type}} for {{worker_name}} at {{site_name}}. Unresolved >30min. Immediate action needed.',
  },
};

/**
 * Retrieves a notification template by type.
 */
export function getTemplate(templateType: NotificationTemplateType): NotificationTemplate {
  const template = TEMPLATES[templateType];
  if (!template) {
    throw new Error(`Unknown notification template type: ${templateType}`);
  }
  return template;
}

/**
 * Renders a template by replacing {{key}} placeholders with provided data values.
 */
export function renderTemplate(
  template: NotificationTemplate,
  data: Record<string, string>
): NotificationTemplate {
  return {
    subject: replacePlaceholders(template.subject, data),
    body: replacePlaceholders(template.body, data),
    sms_body: replacePlaceholders(template.sms_body, data),
  };
}

/**
 * Replaces all {{key}} placeholders in a string with corresponding data values.
 * Unmatched placeholders are left as-is.
 */
function replacePlaceholders(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return data[key] ?? match;
  });
}
