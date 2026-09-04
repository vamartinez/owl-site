/**
 * AI Orchestration Pipeline.
 * Handles media upload orchestration (S3 signed URL generation, metadata capture),
 * inspection creation, and publishing InspectionUploaded events to SQS AI queue.
 *
 * Requirements: 6.5, 6.6, 6.7, 11.3
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishToSqs } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  MIN_IMAGE_WIDTH,
  MIN_IMAGE_HEIGHT,
  InspectionStatus,
  MediaAssetStatus,
  ImageValidationError,
} from './types.js';
import type {
  Inspection,
  MediaAsset,
  MediaMetadata,
  CreateInspectionInput,
  UploadMediaInput,
  UploadMediaResponse,
  AllowedImageType,
} from './types.js';

const s3Client = new S3Client({});

const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

/**
 * Validates image metadata against acceptance criteria.
 * Requirement 6.6: JPEG/PNG only, max 25MB, min 640×480.
 * Requirement 6.7: Reject with specific error message.
 *
 * @returns null if valid, or an error message string if invalid.
 */
export function validateImageMetadata(
  contentType: string,
  fileSize: number,
  width: number,
  height: number
): string | null {
  // Check format
  if (!ALLOWED_IMAGE_TYPES.includes(contentType as AllowedImageType)) {
    return ImageValidationError.UNSUPPORTED_FORMAT;
  }

  // Check file size
  if (fileSize > MAX_IMAGE_SIZE) {
    return ImageValidationError.EXCEEDS_MAX_SIZE;
  }

  // Check resolution
  if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
    return ImageValidationError.BELOW_MIN_RESOLUTION;
  }

  return null;
}

/**
 * Creates a new inspection record.
 */
export async function createInspection(
  tenantId: string,
  userId: string,
  input: CreateInspectionInput
): Promise<Inspection> {
  const now = new Date().toISOString();
  const inspectionId = uuidv4();

  const inspection: Inspection = {
    inspection_id: inspectionId,
    tenant_id: tenantId,
    site_id: input.site_id,
    created_by: userId,
    trade: input.trade,
    project_phase: input.project_phase,
    status: InspectionStatus.CREATED,
    created_at: now,
    updated_at: now,
    media_count: 0,
    notes: input.notes,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('Inspections'),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `INSPECTION#${inspectionId}`,
        GSI1PK: `SITE#${input.site_id}`,
        GSI1SK: `INSPECTION#${now}`,
        ...inspection,
      },
    })
  );

  return inspection;
}

/**
 * Retrieves an inspection by ID.
 */
export async function getInspection(
  tenantId: string,
  inspectionId: string
): Promise<Inspection | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('Inspections'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INSPECTION#${inspectionId}`,
      },
    })
  );

  if (!result.Item) return null;
  return result.Item as unknown as Inspection;
}

/**
 * Generates a pre-signed S3 URL for media upload and creates a MediaAsset record.
 * Captures metadata: site_id, trade, project_phase, timestamp (Requirement 6.5).
 */
export async function uploadMedia(
  tenantId: string,
  userId: string,
  inspectionId: string,
  inspection: Inspection,
  input: UploadMediaInput
): Promise<UploadMediaResponse> {
  const now = new Date().toISOString();
  const assetId = uuidv4();
  const bucketName = process.env['MEDIA_BUCKET_NAME'] ?? `${process.env['ENVIRONMENT'] ?? 'dev'}-compliance-media`;

  // Construct S3 key
  const extension = input.content_type === 'image/jpeg' ? 'jpg' : 'png';
  const s3Key = `inspections/${tenantId}/${inspectionId}/${assetId}.${extension}`;

  // Generate pre-signed URL for upload
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    ContentType: input.content_type,
    ContentLength: input.file_size,
    Metadata: {
      'tenant-id': tenantId,
      'inspection-id': inspectionId,
      'asset-id': assetId,
      'site-id': inspection.site_id,
      trade: inspection.trade,
      'project-phase': inspection.project_phase,
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  });

  // Capture metadata (Requirement 6.5)
  const metadata: MediaMetadata = {
    site_id: inspection.site_id,
    trade: inspection.trade,
    project_phase: inspection.project_phase,
    timestamp: now,
  };

  // Create MediaAsset record
  const mediaAsset: MediaAsset = {
    asset_id: assetId,
    inspection_id: inspectionId,
    tenant_id: tenantId,
    site_id: inspection.site_id,
    file_name: input.file_name,
    content_type: input.content_type as AllowedImageType,
    file_size: input.file_size,
    width: input.width,
    height: input.height,
    s3_key: s3Key,
    upload_url: uploadUrl,
    status: MediaAssetStatus.PENDING_UPLOAD,
    uploaded_by: userId,
    uploaded_at: now,
    metadata,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('MediaAssets'),
      Item: {
        PK: `INSPECTION#${inspectionId}`,
        SK: `ASSET#${assetId}`,
        GSI1PK: `TENANT#${tenantId}`,
        GSI1SK: `ASSET#${now}`,
        ...mediaAsset,
      },
    })
  );

  // Update inspection media count and status
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Inspections'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INSPECTION#${inspectionId}`,
      },
      UpdateExpression: 'SET media_count = media_count + :inc, #status = :status, updated_at = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':status': InspectionStatus.MEDIA_UPLOADED,
        ':now': now,
      },
    })
  );

  return {
    asset_id: assetId,
    upload_url: uploadUrl,
    s3_key: s3Key,
    expires_in: SIGNED_URL_EXPIRY_SECONDS,
  };
}

/**
 * Triggers AI analysis for an inspection by publishing InspectionUploaded event to SQS AI queue.
 * Requirement 11.3: Initiate AI analysis pipeline within 5 seconds of event receipt.
 */
export async function triggerAnalysis(
  tenantId: string,
  userId: string,
  inspectionId: string,
  inspection: Inspection
): Promise<{ event_id: string }> {
  const queueUrl = process.env['AI_PIPELINE_QUEUE_URL'];
  if (!queueUrl) {
    throw new Error('AI_PIPELINE_QUEUE_URL environment variable is not configured');
  }

  // Update inspection status to analyzing
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Inspections'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INSPECTION#${inspectionId}`,
      },
      UpdateExpression: 'SET #status = :status, updated_at = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': InspectionStatus.ANALYZING,
        ':now': new Date().toISOString(),
      },
    })
  );

  // Publish InspectionUploaded event to SQS AI queue
  const event = await publishToSqs(queueUrl, {
    event_type: EventTypes.INSPECTION_UPLOADED,
    source_service: 'ai-orchestration',
    tenant_id: tenantId,
    payload: {
      inspection_id: inspectionId,
      site_id: inspection.site_id,
      tenant_id: tenantId,
      media_asset_id: inspectionId, // Will be resolved by detection layer
      uploaded_by: userId,
      trade: inspection.trade,
      project_phase: inspection.project_phase,
    },
  });

  return { event_id: event.event_id };
}
