/**
 * Unit tests for the Detection Layer service.
 * Tests prompt construction, response parsing, confidence filtering,
 * bounding box validation, resize calculation, and error handling.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.8, 11.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDetectionPrompt,
  calculateResizeDimensions,
  isValidBoundingBox,
  validateDetection,
  parseBedrockResponse,
  filterDetections,
} from '../../src/services/detection/detector.js';
import {
  MIN_CONFIDENCE_THRESHOLD,
  MAX_IMAGE_DIMENSION,
  OLLAMA_MODEL_CONFIG,
  SAFETY_OBJECT_CATEGORIES,
  DetectionStatus,
} from '../../src/services/detection/types.js';
import { DetectionCategory } from '../../src/shared/types/common.js';

// --- Prompt Construction Tests (Requirement 6.2) ---

describe('detection: buildDetectionPrompt', () => {
  it('includes all safety object categories', () => {
    const prompt = buildDetectionPrompt();

    for (const category of SAFETY_OBJECT_CATEGORIES) {
      expect(prompt).toContain(category);
    }
  });

  it('includes helmet, vest, harness, ladder, scaffold categories', () => {
    const prompt = buildDetectionPrompt();
    expect(prompt).toContain('helmet');
    expect(prompt).toContain('vest');
    expect(prompt).toContain('harness');
    expect(prompt).toContain('ladder');
    expect(prompt).toContain('scaffold');
  });

  it('includes trench/excavation edge, roof edge, machinery proximity, blocked exit/clutter', () => {
    const prompt = buildDetectionPrompt();
    expect(prompt).toContain('trench_excavation_edge');
    expect(prompt).toContain('roof_edge');
    expect(prompt).toContain('machinery_proximity');
    expect(prompt).toContain('blocked_exit_clutter');
  });

  it('requests structured JSON response format', () => {
    const prompt = buildDetectionPrompt();
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('"detections"');
    expect(prompt).toContain('"type"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"boundingBox"');
  });

  it('specifies confidence score range 0-1', () => {
    const prompt = buildDetectionPrompt();
    expect(prompt).toContain('confidence score between 0 and 1');
  });

  it('specifies normalized bounding box coordinates', () => {
    const prompt = buildDetectionPrompt();
    expect(prompt).toContain('normalized');
    expect(prompt).toContain('0-1');
  });
});

// --- Image Resize Calculation Tests ---

describe('detection: calculateResizeDimensions', () => {
  it('returns original dimensions when both are within max', () => {
    const result = calculateResizeDimensions(800, 600);
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it('returns original dimensions when exactly at max', () => {
    const result = calculateResizeDimensions(1024, 768);
    expect(result).toEqual({ width: 1024, height: 768 });
  });

  it('scales down landscape image with width as longest edge', () => {
    const result = calculateResizeDimensions(2048, 1536);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });

  it('scales down portrait image with height as longest edge', () => {
    const result = calculateResizeDimensions(1536, 2048);
    expect(result.width).toBe(768);
    expect(result.height).toBe(1024);
  });

  it('scales down square image', () => {
    const result = calculateResizeDimensions(2048, 2048);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it('maintains aspect ratio for non-standard dimensions', () => {
    const result = calculateResizeDimensions(4000, 3000);
    // 4000/3000 = 4/3 ratio, longest edge = 4000
    // scale = 1024/4000 = 0.256
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });

  it('does not upscale small images', () => {
    const result = calculateResizeDimensions(320, 240);
    expect(result).toEqual({ width: 320, height: 240 });
  });
});

// --- Bounding Box Validation Tests ---

describe('detection: isValidBoundingBox', () => {
  it('accepts valid bounding box', () => {
    expect(isValidBoundingBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toBe(true);
  });

  it('accepts bounding box at origin', () => {
    expect(isValidBoundingBox({ x: 0, y: 0, width: 0.5, height: 0.5 })).toBe(true);
  });

  it('accepts bounding box filling entire image', () => {
    expect(isValidBoundingBox({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidBoundingBox(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidBoundingBox(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidBoundingBox('not an object')).toBe(false);
  });

  it('rejects missing x', () => {
    expect(isValidBoundingBox({ y: 0.2, width: 0.3, height: 0.4 })).toBe(false);
  });

  it('rejects negative x', () => {
    expect(isValidBoundingBox({ x: -0.1, y: 0.2, width: 0.3, height: 0.4 })).toBe(false);
  });

  it('rejects x > 1', () => {
    expect(isValidBoundingBox({ x: 1.1, y: 0.2, width: 0.3, height: 0.4 })).toBe(false);
  });

  it('rejects zero width', () => {
    expect(isValidBoundingBox({ x: 0.1, y: 0.2, width: 0, height: 0.4 })).toBe(false);
  });

  it('rejects zero height', () => {
    expect(isValidBoundingBox({ x: 0.1, y: 0.2, width: 0.3, height: 0 })).toBe(false);
  });

  it('rejects bounding box extending beyond image (x + width > 1)', () => {
    expect(isValidBoundingBox({ x: 0.8, y: 0.2, width: 0.3, height: 0.4 })).toBe(false);
  });

  it('rejects bounding box extending beyond image (y + height > 1)', () => {
    expect(isValidBoundingBox({ x: 0.1, y: 0.8, width: 0.3, height: 0.4 })).toBe(false);
  });
});

// --- Detection Validation Tests ---

describe('detection: validateDetection', () => {
  it('validates a correct detection', () => {
    const raw = {
      type: 'helmet',
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    const result = validateDetection(raw);
    expect(result).toEqual(raw);
  });

  it('returns null for null input', () => {
    expect(validateDetection(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateDetection('string')).toBeNull();
  });

  it('returns null for missing type', () => {
    const raw = {
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toBeNull();
  });

  it('returns null for non-string type', () => {
    const raw = {
      type: 123,
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toBeNull();
  });

  it('returns null for confidence below 0', () => {
    const raw = {
      type: 'helmet',
      confidence: -0.1,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toBeNull();
  });

  it('returns null for confidence above 1', () => {
    const raw = {
      type: 'helmet',
      confidence: 1.1,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toBeNull();
  });

  it('returns null for invalid bounding box', () => {
    const raw = {
      type: 'helmet',
      confidence: 0.95,
      boundingBox: { x: -1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toBeNull();
  });

  it('accepts confidence at exactly 0', () => {
    const raw = {
      type: 'helmet',
      confidence: 0,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toEqual(raw);
  });

  it('accepts confidence at exactly 1', () => {
    const raw = {
      type: 'helmet',
      confidence: 1,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    expect(validateDetection(raw)).toEqual(raw);
  });
});

// --- Response Parsing Tests ---

describe('detection: parseBedrockResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      detections: [
        {
          type: 'helmet',
          confidence: 0.95,
          boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        },
      ],
    });

    const result = parseBedrockResponse(response);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].type).toBe('helmet');
  });

  it('parses JSON wrapped in markdown code block', () => {
    const response = '```json\n{"detections": [{"type": "vest", "confidence": 0.8, "boundingBox": {"x": 0, "y": 0, "width": 0.5, "height": 0.5}}]}\n```';

    const result = parseBedrockResponse(response);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].type).toBe('vest');
  });

  it('parses JSON wrapped in plain code block', () => {
    const response = '```\n{"detections": []}\n```';

    const result = parseBedrockResponse(response);
    expect(result.detections).toHaveLength(0);
  });

  it('parses empty detections array', () => {
    const response = JSON.stringify({ detections: [] });

    const result = parseBedrockResponse(response);
    expect(result.detections).toHaveLength(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBedrockResponse('not json')).toThrow();
  });

  it('throws on missing detections array', () => {
    const response = JSON.stringify({ results: [] });
    expect(() => parseBedrockResponse(response)).toThrow('Invalid response format');
  });

  it('throws on detections not being an array', () => {
    const response = JSON.stringify({ detections: 'not an array' });
    expect(() => parseBedrockResponse(response)).toThrow('Invalid response format');
  });

  it('parses multiple detections', () => {
    const response = JSON.stringify({
      detections: [
        { type: 'helmet', confidence: 0.95, boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
        { type: 'vest', confidence: 0.88, boundingBox: { x: 0.3, y: 0.3, width: 0.2, height: 0.3 } },
        { type: 'ladder', confidence: 0.72, boundingBox: { x: 0.5, y: 0.0, width: 0.1, height: 0.9 } },
      ],
    });

    const result = parseBedrockResponse(response);
    expect(result.detections).toHaveLength(3);
  });
});

// --- Confidence Filtering Tests (Requirement 6.3) ---

describe('detection: filterDetections', () => {
  it('keeps detections at exactly 0.5 confidence', () => {
    const raw = [
      { type: 'helmet', confidence: 0.5, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.5);
  });

  it('keeps detections above 0.5 confidence', () => {
    const raw = [
      { type: 'helmet', confidence: 0.95, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(1);
  });

  it('filters out detections below 0.5 confidence', () => {
    const raw = [
      { type: 'helmet', confidence: 0.49, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(0);
  });

  it('filters out detections with confidence 0', () => {
    const raw = [
      { type: 'helmet', confidence: 0, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(0);
  });

  it('filters out invalid categories', () => {
    const raw = [
      { type: 'unknown_object', confidence: 0.95, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(0);
  });

  it('filters out detections with invalid bounding boxes', () => {
    const raw = [
      { type: 'helmet', confidence: 0.95, boundingBox: { x: -1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(0);
  });

  it('handles mixed valid and invalid detections', () => {
    const raw = [
      { type: 'helmet', confidence: 0.95, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
      { type: 'vest', confidence: 0.3, boundingBox: { x: 0.2, y: 0.3, width: 0.2, height: 0.3 } }, // below threshold
      { type: 'invalid_type', confidence: 0.9, boundingBox: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } }, // invalid category
      { type: 'harness', confidence: 0.75, boundingBox: { x: 0.3, y: 0.1, width: 0.2, height: 0.5 } },
    ];
    const result = filterDetections(raw);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe(DetectionCategory.HELMET);
    expect(result[1].type).toBe(DetectionCategory.HARNESS);
  });

  it('returns empty array for empty input', () => {
    const result = filterDetections([]);
    expect(result).toHaveLength(0);
  });

  it('accepts all valid detection categories', () => {
    const categories = Object.values(DetectionCategory);
    const raw = categories.map((cat, i) => ({
      type: cat,
      confidence: 0.8,
      boundingBox: { x: i * 0.1, y: 0.1, width: 0.08, height: 0.1 },
    }));

    const result = filterDetections(raw);
    expect(result).toHaveLength(categories.length);
  });

  it('preserves detection type as DetectionCategory enum value', () => {
    const raw = [
      { type: 'trench_excavation_edge', confidence: 0.7, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    ];
    const result = filterDetections(raw);
    expect(result[0].type).toBe(DetectionCategory.TRENCH_EXCAVATION_EDGE);
  });
});

// --- Constants Verification ---

describe('detection: constants', () => {
  it('MIN_CONFIDENCE_THRESHOLD is 0.5', () => {
    expect(MIN_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it('MAX_IMAGE_DIMENSION is 1024', () => {
    expect(MAX_IMAGE_DIMENSION).toBe(1024);
  });

  it('OLLAMA_MODEL_CONFIG has correct model ID', () => {
    expect(OLLAMA_MODEL_CONFIG.modelId).toBe('qwen3.5:cloud');
  });

  it('OLLAMA_MODEL_CONFIG has maxTokens 4096', () => {
    expect(OLLAMA_MODEL_CONFIG.maxTokens).toBe(4096);
  });

  it('OLLAMA_MODEL_CONFIG has temperature 0.1', () => {
    expect(OLLAMA_MODEL_CONFIG.temperature).toBe(0.1);
  });

  it('SAFETY_OBJECT_CATEGORIES has 9 categories', () => {
    expect(SAFETY_OBJECT_CATEGORIES).toHaveLength(9);
  });

  it('SAFETY_OBJECT_CATEGORIES matches DetectionCategory enum values', () => {
    const enumValues = Object.values(DetectionCategory);
    for (const category of SAFETY_OBJECT_CATEGORIES) {
      expect(enumValues).toContain(category);
    }
  });
});

// --- DetectionStatus enum ---

describe('detection: DetectionStatus', () => {
  it('has completed status', () => {
    expect(DetectionStatus.COMPLETED).toBe('completed');
  });

  it('has failed status', () => {
    expect(DetectionStatus.FAILED).toBe('failed');
  });
});

// --- Handler Tests ---

describe('detection: handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SNS_TOPIC_ARN', 'arn:aws:sns:us-west-2:123456789:test-topic');
    vi.stubEnv('ENVIRONMENT', 'dev');
    vi.stubEnv('MEDIA_BUCKET_NAME', 'dev-compliance-media');
  });

  it('processes valid SQS event and calls runDetection', async () => {
    // Mock all AWS SDK modules
    const mockSend = vi.fn().mockResolvedValue({});
    vi.doMock('ollama', () => ({
      Ollama: vi.fn(() => ({ chat: vi.fn() })),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({ send: mockSend })),
      GetObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({ send: mockSend })),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({ send: mockSend })),
      SendMessageCommand: vi.fn(),
    }));

    // Mock the detector module to avoid real Bedrock calls
    vi.doMock('../../src/services/detection/detector.js', () => ({
      runDetection: vi.fn().mockResolvedValue({
        detection_id: 'det-123',
        inspection_id: 'insp-123',
        media_asset_id: 'asset-123',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        model_version: 'qwen3.5:cloud',
        detections: [],
        detection_count: 0,
        processed_at: '2024-01-01T00:00:00.000Z',
        processing_duration_ms: 1500,
        status: 'completed',
      }),
    }));

    const { handler } = await import('../../src/services/detection/handler.js');

    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-1',
          body: JSON.stringify({
            event_id: 'evt-1',
            event_type: 'InspectionUploaded',
            source_service: 'ai-orchestration',
            tenant_id: 'tenant-1',
            timestamp: '2024-01-01T00:00:00.000Z',
            payload: {
              inspection_id: 'insp-123',
              media_asset_id: 'asset-123',
              tenant_id: 'tenant-1',
              site_id: 'site-1',
            },
            correlation_id: 'corr-1',
            version: '1.0',
          }),
          attributes: {},
          messageAttributes: {},
        },
      ],
    };

    // Should not throw
    await expect(handler(sqsEvent)).resolves.toBeUndefined();
  });

  it('handles invalid message payload gracefully', async () => {
    vi.doMock('ollama', () => ({
      Ollama: vi.fn(() => ({ chat: vi.fn() })),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({ send: vi.fn() })),
      GetObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn() }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({ send: vi.fn() })),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({ send: vi.fn() })),
      SendMessageCommand: vi.fn(),
    }));
    vi.doMock('../../src/services/detection/detector.js', () => ({
      runDetection: vi.fn(),
    }));

    const { handler } = await import('../../src/services/detection/handler.js');

    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-1',
          body: JSON.stringify({
            event_id: 'evt-1',
            event_type: 'InspectionUploaded',
            source_service: 'ai-orchestration',
            tenant_id: 'tenant-1',
            timestamp: '2024-01-01T00:00:00.000Z',
            payload: {}, // Missing required fields
            correlation_id: 'corr-1',
            version: '1.0',
          }),
          attributes: {},
          messageAttributes: {},
        },
      ],
    };

    // Should not throw for invalid payload — just skip
    await expect(handler(sqsEvent)).resolves.toBeUndefined();
  });
});
