/**
 * Scene Understanding Layer domain types.
 * Defines SceneClassification, RiskContext, and related interfaces.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { SceneType } from '../../shared/types/common.js';

/**
 * Risk context identifying the primary hazard and exposed personnel.
 * Requirement 7.3: risk_context with primary hazard and exposed personnel count.
 */
export interface RiskContext {
  primary_hazard: string;
  exposed_personnel_count: number;
}

/**
 * Scene classification result from the AI model.
 * Requirement 7.3: scene_description, activity_label, risk_context, confidence.
 */
export interface SceneClassification {
  scene_type: SceneType;
  scene_description: string; // max 200 chars
  activity_label: string;
  risk_context: RiskContext | null; // null when no construction activity (Req 7.6)
  confidence: number; // 0.0-1.0
  best_candidate?: {
    scene_type: SceneType;
    confidence: number;
  };
}

/**
 * Raw response expected from the Bedrock Claude model for scene classification.
 */
export interface BedrockSceneResponse {
  scene_type: string;
  scene_description: string;
  activity_label: string;
  risk_context: {
    primary_hazard: string;
    exposed_personnel_count: number;
  } | null;
  confidence: number;
  has_construction_objects: boolean;
}

/**
 * Scene interpretation record stored in DynamoDB.
 * Requirement 7.4: Record model_version used for each scene interpretation.
 */
export interface SceneInterpretationRecord {
  interpretation_id: string;
  inspection_id: string;
  detection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  model_version: string;
  scene_type: SceneType;
  scene_description: string;
  activity_label: string;
  risk_context: RiskContext | null;
  confidence: number;
  best_candidate?: {
    scene_type: SceneType;
    confidence: number;
  };
  processed_at: string; // ISO 8601 UTC
  processing_duration_ms: number;
  status: SceneInterpretationStatus;
  error_message?: string;
}

/**
 * Scene interpretation processing status.
 */
export enum SceneInterpretationStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Minimum confidence threshold for scene classification.
 * Requirement 7.5: If confidence < 0.5, label "unclassified".
 */
export const SCENE_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Ollama Cloud model configuration for scene understanding (text).
 */
export const SCENE_OLLAMA_MODEL_CONFIG = {
  modelId: 'gpt-oss:120b-cloud',
  maxTokens: 4096,
  temperature: 0.1,
} as const;

/**
 * Valid scene types for classification.
 * Requirement 7.2: work_at_height, roofing, excavation, framing, ladder_access,
 * material_handling_near_equipment.
 */
export const VALID_SCENE_TYPES: readonly string[] = [
  'work_at_height',
  'roofing',
  'excavation',
  'framing',
  'ladder_access',
  'material_handling_near_equipment',
] as const;

/**
 * Maximum length for scene description.
 * Requirement 7.3: scene_description max 200 characters.
 */
export const MAX_SCENE_DESCRIPTION_LENGTH = 200;

/**
 * SQS message body for the scene understanding handler (from DetectionCompleted event).
 */
export interface SceneUnderstandingSqsMessage {
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  detection_id: string;
  detection_count: number;
  model_version: string;
}
