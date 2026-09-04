/**
 * TypeScript interfaces for all platform events published via the Event Bus.
 */

export interface PlatformEvent {
  event_id: string;
  event_type: string;
  source_service: string;
  tenant_id: string;
  timestamp: string; // ISO 8601 UTC
  payload: Record<string, unknown>;
  correlation_id: string;
  version: string;
}

// --- Worker Events ---

export interface WorkerCreatedPayload {
  worker_id: string;
  tenant_id: string;
  legal_name: string;
  phone: string;
  language_preference: string;
}

export interface WorkerUpdatedPayload {
  worker_id: string;
  tenant_id: string;
  updated_fields: string[];
}

// --- Certification Events ---

export interface CertificationUploadedPayload {
  certification_id: string;
  worker_id: string;
  tenant_id: string;
  certification_type: string;
  expiry_date: string;
}

export interface CertificationValidatedPayload {
  certification_id: string;
  worker_id: string;
  tenant_id: string;
  certification_type: string;
  validated_by: string;
}

export interface CertificationExpiredPayload {
  certification_id: string;
  worker_id: string;
  tenant_id: string;
  certification_type: string;
  expiry_date: string;
}

// --- Policy Events ---

export interface SitePolicyPublishedPayload {
  policy_id: string;
  policy_version_id: string;
  tenant_id: string;
  site_id: string;
  effective_from: string;
  published_by: string;
}

// --- Access Events ---

export interface AccessRequestedPayload {
  access_request_id: string;
  worker_id: string;
  site_id: string;
  tenant_id: string;
  token_type: string;
}

export interface AccessDecisionGeneratedPayload {
  decision_id: string;
  worker_id: string;
  site_id: string;
  tenant_id: string;
  decision_result: string;
  policy_version_used: string;
}

// --- Inspection & AI Events ---

export interface InspectionUploadedPayload {
  inspection_id: string;
  site_id: string;
  tenant_id: string;
  media_asset_id: string;
  uploaded_by: string;
}

export interface DetectionCompletedPayload {
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  detection_count: number;
  model_version: string;
}

export interface SceneClassifiedPayload {
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  scene_type: string;
  confidence: number;
  model_version: string;
}

export interface FindingGeneratedPayload {
  finding_id: string;
  inspection_id: string;
  site_id: string;
  tenant_id: string;
  severity: string;
  initial_status: string;
}

export interface FindingReviewedPayload {
  finding_id: string;
  tenant_id: string;
  reviewer_id: string;
  new_status: string;
  reason?: string;
}

// --- Reporting Events ---

export interface DailyComplianceSummaryRequestedPayload {
  site_id: string;
  tenant_id: string;
  reporting_period_start: string;
  reporting_period_end: string;
  timezone: string;
}

export interface DailyComplianceSummaryGeneratedPayload {
  summary_id: string;
  site_id: string;
  tenant_id: string;
  reporting_period_start: string;
  reporting_period_end: string;
  generated_at: string;
}

// --- Event Type Constants ---

export const EventTypes = {
  WORKER_CREATED: 'WorkerCreated',
  WORKER_UPDATED: 'WorkerUpdated',
  CERTIFICATION_UPLOADED: 'CertificationUploaded',
  CERTIFICATION_VALIDATED: 'CertificationValidated',
  CERTIFICATION_EXPIRED: 'CertificationExpired',
  SITE_POLICY_PUBLISHED: 'SitePolicyPublished',
  ACCESS_REQUESTED: 'AccessRequested',
  ACCESS_DECISION_GENERATED: 'AccessDecisionGenerated',
  INSPECTION_UPLOADED: 'InspectionUploaded',
  DETECTION_COMPLETED: 'DetectionCompleted',
  SCENE_CLASSIFIED: 'SceneClassified',
  FINDING_GENERATED: 'FindingGenerated',
  FINDING_REVIEWED: 'FindingReviewed',
  DAILY_COMPLIANCE_SUMMARY_REQUESTED: 'DailyComplianceSummaryRequested',
  DAILY_COMPLIANCE_SUMMARY_GENERATED: 'DailyComplianceSummaryGenerated',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
