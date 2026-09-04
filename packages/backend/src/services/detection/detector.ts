/**
 * Detection Layer — Core detection logic.
 * Resizes image, sends to Ollama Cloud (qwen3.5:cloud vision model),
 * parses structured JSON response, filters by confidence threshold,
 * and stores results in DetectionResults table.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.8
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient } from '../../shared/ollama-client.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { DetectionCategory } from '../../shared/types/common.js';
import type {
  DetectionResult,
  RawDetection,
  BedrockDetectionResponse,
  DetectionRecord,
  BoundingBox,
} from './types.js';
import {
  MIN_CONFIDENCE_THRESHOLD,
  MAX_IMAGE_DIMENSION,
  OLLAMA_MODEL_CONFIG,
  SAFETY_OBJECT_CATEGORIES,
  DetectionStatus,
} from './types.js';

const s3Client = new S3Client({});
const logger = createLogger('detection-layer');

/**
 * Valid detection category values for validation.
 */
const VALID_CATEGORIES = new Set<string>(Object.values(DetectionCategory));

/**
 * Builds the detection system prompt listing all safety object categories.
 * Requirement 6.2: Detect helmet, vest, harness, ladder, scaffold,
 * trench/excavation edge, roof edge, machinery proximity, blocked exit/clutter.
 */
export function buildDetectionPrompt(): string {
  return `You are a construction site safety detection system. Analyze the provided image and identify all safety-relevant objects and conditions.

Detect the following object categories:
${SAFETY_OBJECT_CATEGORIES.map((cat) => `- ${cat}`).join('\n')}

For each detected object, provide:
1. "type": The category label (must be one of the listed categories exactly)
2. "confidence": A confidence score between 0 and 1
3. "boundingBox": The bounding region with normalized coordinates (0-1):
   - "x": left edge position (0-1)
   - "y": top edge position (0-1)
   - "width": width of the bounding box (0-1)
   - "height": height of the bounding box (0-1)

Respond ONLY with valid JSON in this exact format:
{
  "detections": [
    {
      "type": "category_name",
      "confidence": 0.95,
      "boundingBox": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 }
    }
  ]
}

If no safety-relevant objects are detected, return: {"detections": []}

Important:
- Only use category names from the provided list
- Confidence scores must be between 0 and 1
- Bounding box coordinates must be normalized (0-1)
- Be thorough but accurate — do not hallucinate objects that are not clearly visible`;
}

/**
 * Calculates resize dimensions maintaining aspect ratio with max 1024px longest edge.
 * Design: Images resized to max 1024px (longest edge) before sending to Bedrock.
 */
export function calculateResizeDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);

  if (longestEdge <= MAX_IMAGE_DIMENSION) {
    return { width, height };
  }

  const scale = MAX_IMAGE_DIMENSION / longestEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Validates a bounding box has valid normalized coordinates.
 */
export function isValidBoundingBox(box: unknown): box is BoundingBox {
  if (!box || typeof box !== 'object') return false;
  const b = box as Record<string, unknown>;
  return (
    typeof b['x'] === 'number' &&
    typeof b['y'] === 'number' &&
    typeof b['width'] === 'number' &&
    typeof b['height'] === 'number' &&
    b['x'] >= 0 &&
    b['x'] <= 1 &&
    b['y'] >= 0 &&
    b['y'] <= 1 &&
    b['width'] > 0 &&
    b['width'] <= 1 &&
    b['height'] > 0 &&
    b['height'] <= 1 &&
    (b['x'] as number) + (b['width'] as number) <= 1.01 && // small tolerance for floating point
    (b['y'] as number) + (b['height'] as number) <= 1.01
  );
}

/**
 * Validates and normalizes a raw detection from the model response.
 * Returns null if the detection is invalid.
 */
export function validateDetection(raw: unknown): RawDetection | null {
  if (!raw || typeof raw !== 'object') return null;

  const detection = raw as Record<string, unknown>;
  const type = detection['type'];
  const confidence = detection['confidence'];
  const boundingBox = detection['boundingBox'];

  if (typeof type !== 'string') return null;
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return null;
  if (!isValidBoundingBox(boundingBox)) return null;

  return {
    type,
    confidence,
    boundingBox: boundingBox as BoundingBox,
  };
}

/**
 * Parses the Bedrock model response into structured detection results.
 * Handles JSON extraction from potential markdown code blocks.
 */
export function parseBedrockResponse(responseBody: string): BedrockDetectionResponse {
  let jsonStr = responseBody.trim();

  // Handle markdown code block wrapping
  if (jsonStr.startsWith('```')) {
    const lines = jsonStr.split('\n');
    // Remove first line (```json or ```) and last line (```)
    const startIdx = 1;
    const endIdx = lines[lines.length - 1]?.trim() === '```' ? lines.length - 1 : lines.length;
    jsonStr = lines.slice(startIdx, endIdx).join('\n').trim();
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.detections)) {
    throw new Error('Invalid response format: missing detections array');
  }

  return parsed as BedrockDetectionResponse;
}

/**
 * Filters raw detections: validates category, applies confidence threshold.
 * Requirement 6.3: Only surface detections with confidence >= 0.5.
 */
export function filterDetections(rawDetections: RawDetection[]): DetectionResult[] {
  const results: DetectionResult[] = [];

  for (const raw of rawDetections) {
    // Validate the detection structure
    const validated = validateDetection(raw);
    if (!validated) continue;

    // Check if category is valid
    if (!VALID_CATEGORIES.has(validated.type)) continue;

    // Apply confidence threshold (Requirement 6.3)
    if (validated.confidence < MIN_CONFIDENCE_THRESHOLD) continue;

    results.push({
      type: validated.type as DetectionCategory,
      confidence: validated.confidence,
      boundingBox: validated.boundingBox,
    });
  }

  return results;
}

/**
 * Fetches image from S3 and returns as base64-encoded string.
 */
export async function fetchImageFromS3(s3Key: string): Promise<{
  base64: string;
  contentType: string;
}> {
  const bucketName =
    process.env['MEDIA_BUCKET_NAME'] ??
    `${process.env['ENVIRONMENT'] ?? 'dev'}-compliance-media`;

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    })
  );

  const bodyBytes = await response.Body!.transformToByteArray();
  const base64 = Buffer.from(bodyBytes).toString('base64');
  const contentType = response.ContentType ?? 'image/jpeg';

  return { base64, contentType };
}

/**
 * Invokes Ollama Cloud (qwen3.5:cloud vision) with the image for detection.
 * Transport-only migration from Bedrock: prompt, parser, threshold, and the
 * output contract are unchanged. Requirement 6.4: Record model version used.
 */
export async function invokeBedrockDetection(
  imageBase64: string,
  mediaType: string
): Promise<{ detections: DetectionResult[]; modelVersion: string }> {
  // mediaType is retained for interface parity; Ollama infers the image type
  // from the base64 payload itself, so it is not sent as a separate field.
  void mediaType;

  const systemPrompt = buildDetectionPrompt();
  const client = await getOllamaClient();

  const response = await client.chat({
    model: OLLAMA_MODEL_CONFIG.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          'Analyze this construction site image and detect all safety-relevant objects. Return the results as structured JSON.',
        // Ollama's native image transport: base64 payloads on the message.
        images: [imageBase64],
      },
    ],
    stream: false,
    options: {
      temperature: OLLAMA_MODEL_CONFIG.temperature,
      num_predict: OLLAMA_MODEL_CONFIG.maxTokens,
    },
  });

  const textContent = response.message?.content;

  if (!textContent) {
    throw new Error('No text content in Ollama response');
  }

  // Parse the structured JSON response (parser unchanged).
  const parsed = parseBedrockResponse(textContent);

  // Validate and filter detections (filter unchanged).
  const detections = filterDetections(parsed.detections);

  // Model version from the response or config (Requirement 6.4).
  const modelVersion = response.model ?? OLLAMA_MODEL_CONFIG.modelId;

  return { detections, modelVersion };
}

/**
 * Stores detection results in the DetectionResults DynamoDB table.
 * Requirement 6.4: Record model_version used for each detection result.
 */
export async function storeDetectionResults(
  record: DetectionRecord
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName('DetectionResults'),
      Item: {
        PK: `INSPECTION#${record.inspection_id}`,
        SK: `DETECTION#${record.detection_id}`,
        GSI1PK: `TENANT#${record.tenant_id}`,
        GSI1SK: `DETECTION#${record.processed_at}`,
        ...record,
      },
    })
  );
}

/**
 * Resolves the S3 key for a media asset from DynamoDB.
 */
async function resolveMediaAssetS3Key(
  inspectionId: string,
  mediaAssetId: string
): Promise<{ s3Key: string; siteId: string } | null> {
  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('MediaAssets'),
      Key: {
        PK: `INSPECTION#${inspectionId}`,
        SK: `ASSET#${mediaAssetId}`,
      },
    })
  );

  if (!result.Item) return null;

  return {
    s3Key: result.Item['s3_key'] as string,
    siteId: result.Item['site_id'] as string,
  };
}

/**
 * Main detection pipeline: fetch image, invoke Bedrock, filter results, store.
 * Requirement 6.1: Return detection results within 30 seconds.
 * Requirement 11.6: If pipeline fails, halt and record failure stage.
 */
export async function runDetection(params: {
  inspectionId: string;
  mediaAssetId: string;
  tenantId: string;
  siteId: string;
  s3Key?: string;
}): Promise<DetectionRecord> {
  const { inspectionId, mediaAssetId, tenantId, siteId } = params;
  const startTime = Date.now();
  const detectionId = uuidv4();

  const log = logger.child({
    correlation_id: inspectionId,
    tenant_id: tenantId,
  });

  try {
    // Resolve S3 key if not provided
    let s3Key = params.s3Key;
    if (!s3Key) {
      const resolved = await resolveMediaAssetS3Key(inspectionId, mediaAssetId);
      if (!resolved) {
        throw new Error(`Media asset not found: ${mediaAssetId}`);
      }
      s3Key = resolved.s3Key;
    }

    log.info('Starting detection', { s3Key, mediaAssetId });

    // Fetch image from S3
    const { base64, contentType } = await fetchImageFromS3(s3Key);

    log.info('Image fetched from S3', {
      contentType,
      sizeBytes: base64.length,
    });

    // Invoke Bedrock for detection
    const { detections, modelVersion } = await invokeBedrockDetection(
      base64,
      contentType
    );

    const processingDuration = Date.now() - startTime;

    log.info('Detection completed', {
      detectionCount: detections.length,
      modelVersion,
      durationMs: processingDuration,
    });

    // Build detection record
    const record: DetectionRecord = {
      detection_id: detectionId,
      inspection_id: inspectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      model_version: modelVersion,
      detections,
      detection_count: detections.length,
      processed_at: new Date().toISOString(),
      processing_duration_ms: processingDuration,
      status: DetectionStatus.COMPLETED,
    };

    // Store results in DynamoDB
    await storeDetectionResults(record);

    return record;
  } catch (error) {
    const processingDuration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown detection error';

    log.error('Detection failed', {
      error: errorMessage,
      durationMs: processingDuration,
    });

    // Record failure (Requirement 11.6)
    const failedRecord: DetectionRecord = {
      detection_id: detectionId,
      inspection_id: inspectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      model_version: OLLAMA_MODEL_CONFIG.modelId,
      detections: [],
      detection_count: 0,
      processed_at: new Date().toISOString(),
      processing_duration_ms: processingDuration,
      status: DetectionStatus.FAILED,
      error_message: errorMessage,
    };

    await storeDetectionResults(failedRecord);

    throw error;
  }
}
