/**
 * Detection Layer domain types.
 * Defines DetectionResult, BoundingBox, and related interfaces.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.8
 */

import { DetectionCategory } from '../../shared/types/common.js';

/**
 * Bounding box representing the location of a detected object within the image.
 * Coordinates are normalized (0-1) relative to image dimensions.
 */
export interface BoundingBox {
  x: number; // Left edge (0-1)
  y: number; // Top edge (0-1)
  width: number; // Width (0-1)
  height: number; // Height (0-1)
}

/**
 * A single detection result from the AI model.
 * Requirement 6.8: category label, confidence score, bounding region.
 */
export interface DetectionResult {
  type: DetectionCategory;
  confidence: number; // 0-1
  boundingBox: BoundingBox;
}

/**
 * Raw detection from the Bedrock model response before filtering.
 */
export interface RawDetection {
  type: string;
  confidence: number;
  boundingBox: BoundingBox;
}

/**
 * Structured response expected from the Bedrock Claude model.
 */
export interface BedrockDetectionResponse {
  detections: RawDetection[];
}

/**
 * Detection run result stored in DynamoDB.
 */
export interface DetectionRecord {
  detection_id: string;
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  model_version: string;
  detections: DetectionResult[];
  detection_count: number;
  processed_at: string; // ISO 8601 UTC
  processing_duration_ms: number;
  status: DetectionStatus;
  error_message?: string;
}

/**
 * Detection processing status.
 */
export enum DetectionStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Minimum confidence threshold for surfacing detections.
 * Requirement 6.3: Only surface detections >= 0.5.
 */
export const MIN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Maximum image dimension (longest edge) for Bedrock processing.
 * Design: Images resized to max 1024px to reduce token usage.
 */
export const MAX_IMAGE_DIMENSION = 1024;

/**
 * Ollama Cloud model configuration for detection (vision).
 * Uses qwen3.5:cloud — the vision-capable cloud model — since detection
 * analyses construction-site images. Text services use gpt-oss:120b-cloud.
 */
export const OLLAMA_MODEL_CONFIG = {
  modelId: 'qwen3.5:cloud',
  maxTokens: 4096,
  temperature: 0.1,
} as const;

/**
 * Safety object categories for the detection system prompt.
 * Requirement 6.2: All categories the model should detect.
 */
export const SAFETY_OBJECT_CATEGORIES: readonly string[] = [
  'helmet',
  'vest',
  'harness',
  'ladder',
  'scaffold',
  'trench_excavation_edge',
  'roof_edge',
  'machinery_proximity',
  'blocked_exit_clutter',
] as const;

/**
 * SQS message body for the detection handler (from InspectionUploaded event).
 */
export interface DetectionSqsMessage {
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  s3_key?: string;
}
