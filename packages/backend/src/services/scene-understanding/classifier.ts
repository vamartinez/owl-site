/**
 * Scene Understanding Layer — Core classification logic.
 * Sends detection results to Ollama Cloud (gpt-oss:120b-cloud, text),
 * classifies scene into defined types, produces scene description,
 * activity label, risk context, and confidence score.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient } from '../../shared/ollama-client.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { SceneType } from '../../shared/types/common.js';
import type {
  SceneClassification,
  BedrockSceneResponse,
  SceneInterpretationRecord,
  RiskContext,
} from './types.js';
import {
  SCENE_CONFIDENCE_THRESHOLD,
  SCENE_OLLAMA_MODEL_CONFIG,
  VALID_SCENE_TYPES,
  MAX_SCENE_DESCRIPTION_LENGTH,
  SceneInterpretationStatus,
} from './types.js';

const logger = createLogger('scene-understanding');

/**
 * Detection result structure from the DetectionResults table.
 */
interface StoredDetection {
  type: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface DetectionRecord {
  detection_id: string;
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  model_version: string;
  detections: StoredDetection[];
  detection_count: number;
}

/**
 * Construction-relevant detection categories that indicate construction activity.
 * Used to determine if any construction objects were detected (Requirement 7.6).
 */
const CONSTRUCTION_RELEVANT_CATEGORIES = new Set([
  'helmet',
  'vest',
  'harness',
  'ladder',
  'scaffold',
  'trench_excavation_edge',
  'roof_edge',
  'machinery_proximity',
  'blocked_exit_clutter',
]);

/**
 * Builds the scene classification system prompt.
 * Requirement 7.2: Classify into defined scene types.
 * Requirement 7.3: Produce scene_description, activity_label, risk_context, confidence.
 */
export function buildSceneClassificationPrompt(): string {
  return `You are a construction site scene understanding system. Given a list of detected objects from a construction site image, classify the work scene and provide operational context.

Classify the scene into ONE of the following scene types:
- work_at_height: Workers operating at elevated positions (scaffolds, elevated platforms, steel structures)
- roofing: Workers on or near roof surfaces performing roofing activities
- excavation: Work involving trenches, excavation edges, or below-grade operations
- framing: Structural framing activities (wood or steel frame construction)
- ladder_access: Workers using ladders for access or work at height
- material_handling_near_equipment: Workers handling materials near mobile equipment or machinery

For the classification, provide:
1. "scene_type": One of the scene types listed above (exactly as written)
2. "scene_description": A concise description of the observed work activity (maximum 200 characters)
3. "activity_label": The scene type that best matches the activity
4. "risk_context": An object with:
   - "primary_hazard": The main safety hazard identified in this scene
   - "exposed_personnel_count": Estimated number of workers exposed to the hazard
5. "confidence": Your confidence in the classification (0.0 to 1.0)
6. "has_construction_objects": Whether the detections contain recognized construction-relevant objects (true/false)

Respond ONLY with valid JSON in this exact format:
{
  "scene_type": "work_at_height",
  "scene_description": "Two workers on scaffold platform without visible harness attachment",
  "activity_label": "work_at_height",
  "risk_context": {
    "primary_hazard": "Fall from height - unprotected scaffold edge",
    "exposed_personnel_count": 2
  },
  "confidence": 0.85,
  "has_construction_objects": true
}

If no construction-relevant objects are detected in the input, respond with:
{
  "scene_type": "unclassified",
  "scene_description": "No construction activity detected",
  "activity_label": "none",
  "risk_context": null,
  "confidence": 0.0,
  "has_construction_objects": false
}

Important:
- scene_description must not exceed 200 characters
- confidence must be between 0.0 and 1.0
- Only use scene_type values from the provided list or "unclassified"
- risk_context should be null only when no construction objects are detected
- Be precise about exposed_personnel_count based on the detection evidence`;
}

/**
 * Builds the user message with detection results for scene classification.
 */
export function buildClassificationUserMessage(detections: StoredDetection[]): string {
  if (detections.length === 0) {
    return 'No objects were detected in the image. Classify the scene based on this empty detection set.';
  }

  const detectionSummary = detections.map((d, i) => 
    `${i + 1}. ${d.type} (confidence: ${d.confidence.toFixed(2)}, location: x=${d.boundingBox.x.toFixed(2)}, y=${d.boundingBox.y.toFixed(2)}, w=${d.boundingBox.width.toFixed(2)}, h=${d.boundingBox.height.toFixed(2)})`
  ).join('\n');

  return `The following objects were detected in a construction site image:

${detectionSummary}

Based on these detections, classify the work scene, describe the activity, identify the primary hazard and exposed personnel, and provide your confidence score.`;
}

/**
 * Determines if any construction-relevant objects are present in the detections.
 * Requirement 7.6: If no recognized construction objects → "no construction activity detected".
 */
export function hasConstructionObjects(detections: StoredDetection[]): boolean {
  return detections.some(d => CONSTRUCTION_RELEVANT_CATEGORIES.has(d.type));
}

/**
 * Parses the Bedrock model response into a structured scene response.
 * Handles JSON extraction from potential markdown code blocks.
 */
export function parseBedrockSceneResponse(responseBody: string): BedrockSceneResponse {
  let jsonStr = responseBody.trim();

  // Handle markdown code block wrapping
  if (jsonStr.startsWith('```')) {
    const lines = jsonStr.split('\n');
    const startIdx = 1;
    const endIdx = lines[lines.length - 1]?.trim() === '```' ? lines.length - 1 : lines.length;
    jsonStr = lines.slice(startIdx, endIdx).join('\n').trim();
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid response format: not an object');
  }

  if (typeof parsed.scene_type !== 'string') {
    throw new Error('Invalid response format: missing or invalid scene_type');
  }

  if (typeof parsed.confidence !== 'number') {
    throw new Error('Invalid response format: missing or invalid confidence');
  }

  return parsed as BedrockSceneResponse;
}

/**
 * Validates and normalizes the scene classification from the model response.
 * Applies business rules for confidence threshold and construction object detection.
 *
 * Requirement 7.5: If confidence < 0.5, label "unclassified" with best candidate.
 * Requirement 7.6: If no construction objects, return "no construction activity detected".
 */
export function normalizeClassification(
  response: BedrockSceneResponse,
  detections: StoredDetection[]
): SceneClassification {
  const constructionObjectsPresent = hasConstructionObjects(detections);

  // Requirement 7.6: No construction objects detected
  if (!constructionObjectsPresent || !response.has_construction_objects) {
    return {
      scene_type: SceneType.UNCLASSIFIED,
      scene_description: 'No construction activity detected',
      activity_label: 'none',
      risk_context: null,
      confidence: 0.0,
    };
  }

  // Validate and clamp confidence
  const confidence = Math.max(0, Math.min(1, response.confidence));

  // Validate scene_type
  const isValidSceneType = VALID_SCENE_TYPES.includes(response.scene_type);
  const resolvedSceneType = isValidSceneType
    ? (response.scene_type as SceneType)
    : SceneType.UNCLASSIFIED;

  // Truncate scene_description to max 200 chars
  const sceneDescription = (response.scene_description ?? '').slice(
    0,
    MAX_SCENE_DESCRIPTION_LENGTH
  );

  // Validate risk_context
  const riskContext: RiskContext | null = response.risk_context
    ? {
        primary_hazard: String(response.risk_context.primary_hazard ?? ''),
        exposed_personnel_count: Math.max(
          0,
          Math.round(response.risk_context.exposed_personnel_count ?? 0)
        ),
      }
    : null;

  // Requirement 7.5: If confidence < 0.5, label "unclassified" with best candidate
  if (confidence < SCENE_CONFIDENCE_THRESHOLD) {
    return {
      scene_type: SceneType.UNCLASSIFIED,
      scene_description: sceneDescription || 'Scene could not be classified with sufficient confidence',
      activity_label: 'unclassified',
      risk_context: riskContext,
      confidence,
      best_candidate: {
        scene_type: resolvedSceneType !== SceneType.UNCLASSIFIED
          ? resolvedSceneType
          : SceneType.WORK_AT_HEIGHT, // fallback if model returned invalid type
        confidence,
      },
    };
  }

  return {
    scene_type: resolvedSceneType,
    scene_description: sceneDescription,
    activity_label: response.activity_label ?? resolvedSceneType,
    risk_context: riskContext,
    confidence,
  };
}

/**
 * Fetches detection results from DynamoDB for the given inspection and detection ID.
 */
export async function fetchDetectionResults(
  inspectionId: string,
  detectionId: string
): Promise<DetectionRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('DetectionResults'),
      Key: {
        PK: `INSPECTION#${inspectionId}`,
        SK: `DETECTION#${detectionId}`,
      },
    })
  );

  if (!result.Item) return null;

  return result.Item as unknown as DetectionRecord;
}

/**
 * Invokes Ollama Cloud (gpt-oss:120b-cloud, text) for scene classification.
 * Transport-only migration; prompt and parser unchanged.
 * Requirement 7.4: Record model version used.
 */
export async function invokeBedrockClassification(
  detections: StoredDetection[]
): Promise<{ response: BedrockSceneResponse; modelVersion: string }> {
  const systemPrompt = buildSceneClassificationPrompt();
  const userMessage = buildClassificationUserMessage(detections);

  const client = await getOllamaClient();
  const response = await client.chat({
    model: SCENE_OLLAMA_MODEL_CONFIG.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    stream: false,
    options: {
      temperature: SCENE_OLLAMA_MODEL_CONFIG.temperature,
      num_predict: SCENE_OLLAMA_MODEL_CONFIG.maxTokens,
    },
  });

  const textContent = response.message?.content;

  if (!textContent) {
    throw new Error('No text content in Ollama response');
  }

  // Parse the structured JSON response (parser unchanged)
  const parsed = parseBedrockSceneResponse(textContent);

  // Model version from the response or config
  const modelVersion = response.model ?? SCENE_OLLAMA_MODEL_CONFIG.modelId;

  return { response: parsed, modelVersion };
}

/**
 * Stores scene interpretation results in the SceneInterpretations DynamoDB table.
 * Requirement 7.4: Record model_version used for each scene interpretation.
 */
export async function storeSceneInterpretation(
  record: SceneInterpretationRecord
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName('SceneInterpretations'),
      Item: {
        PK: `INSPECTION#${record.inspection_id}`,
        SK: `SCENE#${record.interpretation_id}`,
        GSI1PK: `TENANT#${record.tenant_id}`,
        GSI1SK: `SCENE#${record.processed_at}`,
        ...record,
      },
    })
  );
}

/**
 * Main scene classification pipeline: fetch detections, invoke Bedrock, normalize, store.
 * Requirement 7.1: Classify within 5 seconds of receiving detection results.
 */
export async function classifyScene(params: {
  inspectionId: string;
  detectionId: string;
  mediaAssetId: string;
  tenantId: string;
  siteId: string;
}): Promise<SceneInterpretationRecord> {
  const { inspectionId, detectionId, mediaAssetId, tenantId, siteId } = params;
  const startTime = Date.now();
  const interpretationId = uuidv4();

  const log = logger.child({
    correlation_id: inspectionId,
    tenant_id: tenantId,
  });

  try {
    // Fetch detection results from DynamoDB
    const detectionRecord = await fetchDetectionResults(inspectionId, detectionId);

    if (!detectionRecord) {
      throw new Error(`Detection results not found: ${detectionId}`);
    }

    const detections = detectionRecord.detections ?? [];

    log.info('Starting scene classification', {
      detectionId,
      detectionCount: detections.length,
    });

    // Check if there are any construction-relevant objects (Requirement 7.6)
    if (!hasConstructionObjects(detections)) {
      log.info('No construction objects detected, skipping Bedrock call');

      const processingDuration = Date.now() - startTime;

      const record: SceneInterpretationRecord = {
        interpretation_id: interpretationId,
        inspection_id: inspectionId,
        detection_id: detectionId,
        media_asset_id: mediaAssetId,
        tenant_id: tenantId,
        site_id: siteId,
        model_version: SCENE_OLLAMA_MODEL_CONFIG.modelId,
        scene_type: SceneType.UNCLASSIFIED,
        scene_description: 'No construction activity detected',
        activity_label: 'none',
        risk_context: null,
        confidence: 0.0,
        processed_at: new Date().toISOString(),
        processing_duration_ms: processingDuration,
        status: SceneInterpretationStatus.COMPLETED,
      };

      await storeSceneInterpretation(record);
      return record;
    }

    // Invoke Bedrock for scene classification
    const { response, modelVersion } = await invokeBedrockClassification(detections);

    // Normalize and apply business rules
    const classification = normalizeClassification(response, detections);

    const processingDuration = Date.now() - startTime;

    log.info('Scene classification completed', {
      sceneType: classification.scene_type,
      confidence: classification.confidence,
      modelVersion,
      durationMs: processingDuration,
    });

    // Build interpretation record
    const record: SceneInterpretationRecord = {
      interpretation_id: interpretationId,
      inspection_id: inspectionId,
      detection_id: detectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      model_version: modelVersion,
      scene_type: classification.scene_type,
      scene_description: classification.scene_description,
      activity_label: classification.activity_label,
      risk_context: classification.risk_context,
      confidence: classification.confidence,
      best_candidate: classification.best_candidate,
      processed_at: new Date().toISOString(),
      processing_duration_ms: processingDuration,
      status: SceneInterpretationStatus.COMPLETED,
    };

    // Store results in DynamoDB
    await storeSceneInterpretation(record);

    return record;
  } catch (error) {
    const processingDuration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown classification error';

    log.error('Scene classification failed', {
      error: errorMessage,
      durationMs: processingDuration,
    });

    // Record failure
    const failedRecord: SceneInterpretationRecord = {
      interpretation_id: interpretationId,
      inspection_id: inspectionId,
      detection_id: detectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      model_version: SCENE_OLLAMA_MODEL_CONFIG.modelId,
      scene_type: SceneType.UNCLASSIFIED,
      scene_description: '',
      activity_label: '',
      risk_context: null,
      confidence: 0.0,
      processed_at: new Date().toISOString(),
      processing_duration_ms: processingDuration,
      status: SceneInterpretationStatus.FAILED,
      error_message: errorMessage,
    };

    await storeSceneInterpretation(failedRecord);

    throw error;
  }
}
