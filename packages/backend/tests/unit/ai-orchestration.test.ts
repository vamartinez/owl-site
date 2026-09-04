/**
 * Unit tests for the AI Orchestration Service.
 * Tests image validation, inspection creation schemas, and handler routing.
 *
 * Requirements: 6.5, 6.6, 6.7, 11.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateImageMetadata } from '../../src/services/ai-orchestration/pipeline.js';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  MIN_IMAGE_WIDTH,
  MIN_IMAGE_HEIGHT,
  ImageValidationError,
  InspectionStatus,
  MediaAssetStatus,
} from '../../src/services/ai-orchestration/types.js';

// --- Image Validation Tests (Requirements 6.6, 6.7) ---

describe('ai-orchestration: validateImageMetadata', () => {
  describe('format validation', () => {
    it('accepts JPEG images', () => {
      const result = validateImageMetadata('image/jpeg', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBeNull();
    });

    it('accepts PNG images', () => {
      const result = validateImageMetadata('image/png', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBeNull();
    });

    it('rejects GIF images with specific error', () => {
      const result = validateImageMetadata('image/gif', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });

    it('rejects BMP images with specific error', () => {
      const result = validateImageMetadata('image/bmp', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });

    it('rejects WebP images with specific error', () => {
      const result = validateImageMetadata('image/webp', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });

    it('rejects TIFF images with specific error', () => {
      const result = validateImageMetadata('image/tiff', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });

    it('rejects PDF documents', () => {
      const result = validateImageMetadata('application/pdf', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });

    it('rejects empty content type', () => {
      const result = validateImageMetadata('', 5 * 1024 * 1024, 1920, 1080);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });
  });

  describe('file size validation', () => {
    it('accepts file at exactly 25 MB', () => {
      const result = validateImageMetadata('image/jpeg', MAX_IMAGE_SIZE, 1920, 1080);
      expect(result).toBeNull();
    });

    it('accepts file below 25 MB', () => {
      const result = validateImageMetadata('image/jpeg', 10 * 1024 * 1024, 1920, 1080);
      expect(result).toBeNull();
    });

    it('rejects file exceeding 25 MB with specific error', () => {
      const result = validateImageMetadata('image/jpeg', MAX_IMAGE_SIZE + 1, 1920, 1080);
      expect(result).toBe(ImageValidationError.EXCEEDS_MAX_SIZE);
    });

    it('accepts very small file (1 byte)', () => {
      const result = validateImageMetadata('image/png', 1, 640, 480);
      expect(result).toBeNull();
    });
  });

  describe('resolution validation', () => {
    it('accepts image at exactly 640×480', () => {
      const result = validateImageMetadata('image/jpeg', 1024, 640, 480);
      expect(result).toBeNull();
    });

    it('accepts image above minimum resolution', () => {
      const result = validateImageMetadata('image/jpeg', 1024, 1920, 1080);
      expect(result).toBeNull();
    });

    it('rejects image with width below 640', () => {
      const result = validateImageMetadata('image/jpeg', 1024, 639, 480);
      expect(result).toBe(ImageValidationError.BELOW_MIN_RESOLUTION);
    });

    it('rejects image with height below 480', () => {
      const result = validateImageMetadata('image/jpeg', 1024, 640, 479);
      expect(result).toBe(ImageValidationError.BELOW_MIN_RESOLUTION);
    });

    it('rejects image with both dimensions below minimum', () => {
      const result = validateImageMetadata('image/jpeg', 1024, 320, 240);
      expect(result).toBe(ImageValidationError.BELOW_MIN_RESOLUTION);
    });

    it('accepts large resolution image', () => {
      const result = validateImageMetadata('image/png', 1024, 4096, 3072);
      expect(result).toBeNull();
    });
  });

  describe('validation priority (format checked first, then size, then resolution)', () => {
    it('reports format error even when size and resolution are also invalid', () => {
      const result = validateImageMetadata('image/gif', MAX_IMAGE_SIZE + 1, 100, 100);
      expect(result).toBe(ImageValidationError.UNSUPPORTED_FORMAT);
    });

    it('reports size error when format is valid but size and resolution are invalid', () => {
      const result = validateImageMetadata('image/jpeg', MAX_IMAGE_SIZE + 1, 100, 100);
      expect(result).toBe(ImageValidationError.EXCEEDS_MAX_SIZE);
    });

    it('reports resolution error when format and size are valid but resolution is invalid', () => {
      const result = validateImageMetadata('image/jpeg', 1024, 100, 100);
      expect(result).toBe(ImageValidationError.BELOW_MIN_RESOLUTION);
    });
  });
});

// --- Constants Verification ---

describe('ai-orchestration: constants', () => {
  it('ALLOWED_IMAGE_TYPES includes only JPEG and PNG', () => {
    expect(ALLOWED_IMAGE_TYPES).toContain('image/jpeg');
    expect(ALLOWED_IMAGE_TYPES).toContain('image/png');
    expect(ALLOWED_IMAGE_TYPES).toHaveLength(2);
  });

  it('MAX_IMAGE_SIZE is 25 MB', () => {
    expect(MAX_IMAGE_SIZE).toBe(25 * 1024 * 1024);
  });

  it('MIN_IMAGE_WIDTH is 640', () => {
    expect(MIN_IMAGE_WIDTH).toBe(640);
  });

  it('MIN_IMAGE_HEIGHT is 480', () => {
    expect(MIN_IMAGE_HEIGHT).toBe(480);
  });
});

// --- InspectionStatus enum ---

describe('ai-orchestration: InspectionStatus', () => {
  it('has all expected statuses', () => {
    expect(InspectionStatus.CREATED).toBe('created');
    expect(InspectionStatus.MEDIA_UPLOADED).toBe('media_uploaded');
    expect(InspectionStatus.ANALYZING).toBe('analyzing');
    expect(InspectionStatus.COMPLETED).toBe('completed');
    expect(InspectionStatus.FAILED).toBe('failed');
  });
});

// --- MediaAssetStatus enum ---

describe('ai-orchestration: MediaAssetStatus', () => {
  it('has all expected statuses', () => {
    expect(MediaAssetStatus.PENDING_UPLOAD).toBe('pending_upload');
    expect(MediaAssetStatus.UPLOADED).toBe('uploaded');
    expect(MediaAssetStatus.PROCESSING).toBe('processing');
    expect(MediaAssetStatus.PROCESSED).toBe('processed');
    expect(MediaAssetStatus.FAILED).toBe('failed');
  });
});

// --- Handler Routing Tests ---

describe('ai-orchestration: handler routing', () => {
  // We test the handler's routing logic by importing it and calling with mock events.
  // AWS SDK calls are mocked to avoid real infrastructure dependencies.

  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 400 for unsupported routes', async () => {
    // Mock AWS SDK modules
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/unknown',
      pathParameters: null,
      headers: {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJjdXN0b206dGVuYW50X2lkIjoidGVuYW50LTEiLCJjdXN0b206cm9sZSI6InN1cGVydmlzb3IifQ.fake',
      },
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'supervisor',
          },
        },
      },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Unsupported route');
  });

  it('returns 401 for unauthenticated requests', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections',
      pathParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });

  it('returns 400 when POST /inspections has no body', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections',
      pathParameters: null,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'supervisor',
          },
        },
      },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Request body is required');
  });

  it('returns 400 when POST /inspections has invalid body', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections',
      pathParameters: null,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'supervisor',
          },
        },
      },
      body: JSON.stringify({ site_id: 'not-a-uuid' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Validation failed');
  });

  it('returns 422 when POST /inspections/{id}/media has unsupported format', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections/{id}/media',
      pathParameters: { id: '550e8400-e29b-41d4-a716-446655440000' },
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'supervisor',
          },
        },
      },
      body: JSON.stringify({
        file_name: 'photo.gif',
        content_type: 'image/gif',
        file_size: 1024,
        width: 1920,
        height: 1080,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('format not supported');
  });

  it('returns 422 when POST /inspections/{id}/media exceeds max size', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections/{id}/media',
      pathParameters: { id: '550e8400-e29b-41d4-a716-446655440000' },
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'supervisor',
          },
        },
      },
      body: JSON.stringify({
        file_name: 'photo.jpg',
        content_type: 'image/jpeg',
        file_size: 26 * 1024 * 1024,
        width: 1920,
        height: 1080,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('25 MB');
  });

  it('returns 422 when POST /inspections/{id}/media has resolution below minimum', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections/{id}/media',
      pathParameters: { id: '550e8400-e29b-41d4-a716-446655440000' },
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'supervisor',
          },
        },
      },
      body: JSON.stringify({
        file_name: 'photo.jpg',
        content_type: 'image/jpeg',
        file_size: 1024,
        width: 320,
        height: 240,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('640×480');
  });

  it('returns 403 when worker role tries to create inspection', async () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const { handler } = await import('../../src/services/ai-orchestration/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/inspections',
      pathParameters: null,
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-1',
            'custom:tenant_id': 'tenant-1',
            'custom:role': 'worker',
          },
        },
      },
      body: JSON.stringify({
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        trade: 'electrical',
        project_phase: 'framing',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });
});
