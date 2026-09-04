/**
 * Regulatory Mapping Layer domain types.
 * Defines RegulatoryMapping, Finding, and related interfaces.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { Severity, FindingStatus } from '../../shared/types/common.js';

/**
 * Severity classification based on potential for human harm.
 * Requirement 8.4:
 * - critical: imminent risk of fatality or permanent injury
 * - high: risk of serious injury or repeated exposure
 * - medium: risk of minor injury or regulatory non-compliance without immediate harm
 * - low: procedural deviation with no direct injury risk
 */
export { Severity };

/**
 * A single regulatory mapping result for a detection.
 * Requirement 8.3: violation_flag, regulatory_basis, site_policy_basis, severity, suggested_corrective_action.
 */
export interface RegulatoryMappingResult {
  detection_type: string;
  detection_confidence: number;
  violation_flag: boolean;
  regulatory_basis: string | null; // specific regulation clause reference
  site_policy_basis: string | null; // specific policy clause reference
  severity: Severity | null; // null when no violation
  suggested_corrective_action: string | null; // max 500 chars
}

/**
 * Complete regulatory mapping output for an inspection.
 * Requirement 8.2: Include active PolicyVersion ID and jurisdiction ID.
 */
export interface RegulatoryMappingOutput {
  mapping_id: string;
  inspection_id: string;
  interpretation_id: string;
  detection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  policy_version_id: string;
  jurisdiction_id: string;
  mappings: RegulatoryMappingResult[];
  model_version: string;
  processed_at: string; // ISO 8601 UTC
  processing_duration_ms: number;
  status: RegulatoryMappingStatus;
  error_message?: string;
}

/**
 * Finding record stored in the Findings DynamoDB table.
 * Generated from regulatory mapping results with violations.
 */
export interface FindingRecord {
  finding_id: string;
  inspection_id: string;
  interpretation_id: string;
  detection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  policy_version_id: string;
  jurisdiction_id: string;
  severity: Severity;
  status: FindingStatus;
  violation_flag: boolean;
  regulatory_basis: string;
  site_policy_basis: string | null;
  suggested_corrective_action: string;
  scene_type: string;
  scene_description: string;
  detection_type: string;
  detection_confidence: number;
  model_version: string;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  reviewed_by?: string;
  reviewed_at?: string;
  dismissal_reason?: string;
}

/**
 * Regulatory mapping processing status.
 */
export enum RegulatoryMappingStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
  NO_VIOLATIONS = 'no_violations',
}

/**
 * Raw response expected from the Bedrock Claude model for regulatory mapping.
 */
export interface BedrockRegulatoryResponse {
  mappings: Array<{
    detection_type: string;
    violation_flag: boolean;
    regulatory_basis: string | null;
    site_policy_basis: string | null;
    severity: string | null;
    suggested_corrective_action: string | null;
  }>;
}

/**
 * SQS message body for the regulatory mapping handler (from SceneClassified event).
 */
export interface RegulatoryMappingSqsMessage {
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  detection_id: string;
  interpretation_id: string;
  scene_type: string;
  confidence: number;
  model_version: string;
}

/**
 * Input parameters for the regulatory mapping pipeline.
 */
export interface RegulatoryMappingInput {
  inspectionId: string;
  interpretationId: string;
  detectionId: string;
  mediaAssetId: string;
  tenantId: string;
  siteId: string;
  sceneType: string;
  sceneConfidence: number;
}

/**
 * WorkSafeBC regulation rule reference.
 */
export interface WorkSafeBCRule {
  rule_id: string;
  section: string;
  clause: string;
  title: string;
  description: string;
  applicable_detection_types: string[];
  applicable_scene_types: string[];
  default_severity: Severity;
  suggested_action: string;
}

/**
 * Ollama Cloud model configuration for regulatory mapping (text).
 */
export const REGULATORY_OLLAMA_MODEL_CONFIG = {
  modelId: 'gpt-oss:120b-cloud',
  maxTokens: 4096,
  temperature: 0.1,
} as const;

/**
 * Maximum length for suggested corrective action.
 * Requirement 8.3: suggested_corrective_action max 500 characters.
 */
export const MAX_CORRECTIVE_ACTION_LENGTH = 500;

/**
 * Default violation confidence threshold.
 * Detections at or above this threshold are considered for violation mapping.
 */
export const VIOLATION_CONFIDENCE_THRESHOLD = 0.5;

/**
 * WorkSafeBC jurisdiction identifier.
 * Requirement 8.5: WorkSafeBC as initial jurisdiction.
 */
export const WORKSAFE_BC_JURISDICTION_ID = 'worksafe-bc';

/**
 * Valid severity levels.
 * Requirement 8.4: critical, high, medium, low.
 */
export const VALID_SEVERITY_LEVELS: readonly string[] = [
  'critical',
  'high',
  'medium',
  'low',
] as const;
