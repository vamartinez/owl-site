/**
 * Certification management for the Identity Service.
 * Handles certification upload, retrieval, status transitions, and S3 signed URL generation.
 */

import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { CertificationType, CertificationStatus } from '../../shared/types/common.js';
import { boundedString, iso8601DateSchema } from '../../shared/validators.js';
import type {
  Certification,
  CreateCertificationInput,
  UpdateCertificationInput,
} from './types.js';
import {
  VALID_STATUS_TRANSITIONS,
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_SIZE,
  SIGNED_URL_EXPIRY_SECONDS,
} from './types.js';

const CERTIFICATIONS_TABLE = 'Certifications';
const s3Client = new S3Client({});

/**
 * Zod schema for creating a certification.
 */
export const createCertificationSchema = z.object({
  certification_type: z.nativeEnum(CertificationType),
  issuer: boundedString(200, 'Issuer'),
  issue_date: iso8601DateSchema,
  expiry_date: iso8601DateSchema,
  document_content_type: z.string().optional(),
  document_size: z.number().optional(),
  document_filename: z.string().optional(),
}).refine(
  (data) => new Date(data.expiry_date) > new Date(data.issue_date),
  {
    message: 'Expiry date must be after the issue date',
    path: ['expiry_date'],
  }
);

/**
 * Zod schema for updating a certification (status transition).
 */
export const updateCertificationSchema = z.object({
  validation_status: z.nativeEnum(CertificationStatus).optional(),
  rejection_reason: z.string().max(500).optional(),
  validated_by: z.string().optional(),
});

/**
 * Validates document upload constraints (size and format).
 */
export function validateDocument(contentType?: string, size?: number): string | null {
  if (contentType && !ALLOWED_DOCUMENT_TYPES.includes(contentType)) {
    return `Document format must be one of: PDF, JPEG, or PNG. Received: ${contentType}`;
  }
  if (size !== undefined && size > MAX_DOCUMENT_SIZE) {
    return `Document size must not exceed 10 MB. Received: ${Math.round(size / (1024 * 1024))} MB`;
  }
  return null;
}

/**
 * Validates a certification status transition.
 */
export function validateStatusTransition(
  currentStatus: CertificationStatus,
  newStatus: CertificationStatus
): string | null {
  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowedTransitions.includes(newStatus)) {
    return `Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed transitions from '${currentStatus}': ${allowedTransitions.join(', ') || 'none'}`;
  }
  return null;
}

/**
 * Generates an S3 signed URL for document upload.
 */
export async function generateUploadUrl(
  tenantId: string,
  workerId: string,
  certificationId: string,
  contentType: string,
  filename: string
): Promise<{ upload_url: string; document_key: string }> {
  const bucketName = process.env['MEDIA_BUCKET_NAME'] ?? 'compliance-media-assets';
  const documentKey = `certifications/${tenantId}/${workerId}/${certificationId}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: documentKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  });

  return { upload_url: uploadUrl, document_key: documentKey };
}

/**
 * Infers the MIME content type from a document key's file extension.
 */
export function inferContentType(documentKey: string): string {
  const extension = documentKey.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Generates an S3 signed URL for reading a certification document.
 */
export async function generateReadUrl(
  documentKey: string
): Promise<{ read_url: string; content_type: string }> {
  const bucketName = process.env['MEDIA_BUCKET_NAME'] ?? 'compliance-media-assets';
  const contentType = inferContentType(documentKey);

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: documentKey,
    ResponseContentType: contentType,
  });

  const readUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  });

  return { read_url: readUrl, content_type: contentType };
}

/**
 * Creates a new certification record for a worker.
 */
export async function createCertification(
  tenantId: string,
  workerId: string,
  input: CreateCertificationInput
): Promise<{ certification: Certification; upload_url?: string }> {
  const now = new Date().toISOString();
  const certificationId = uuidv4();

  let documentKey: string | undefined;
  let uploadUrl: string | undefined;

  // Generate signed URL if document info is provided
  if (input.document_content_type && input.document_filename) {
    const urlResult = await generateUploadUrl(
      tenantId,
      workerId,
      certificationId,
      input.document_content_type,
      input.document_filename
    );
    documentKey = urlResult.document_key;
    uploadUrl = urlResult.upload_url;
  }

  const certification: Certification = {
    certification_id: certificationId,
    worker_id: workerId,
    tenant_id: tenantId,
    certification_type: input.certification_type,
    issuer: input.issuer,
    issue_date: input.issue_date,
    expiry_date: input.expiry_date,
    document_key: documentKey,
    validation_status: CertificationStatus.PENDING,
    created_at: now,
    updated_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(CERTIFICATIONS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}#WORKER#${workerId}`,
        SK: `CERT#${certificationId}`,
        GSI1PK: `TENANT#${tenantId}`,
        GSI1SK: `CERT#${input.expiry_date}#${certificationId}`,
        ...certification,
      },
    })
  );

  // Publish CertificationUploaded event
  await publishEvent({
    event_type: EventTypes.CERTIFICATION_UPLOADED,
    source_service: 'identity-service',
    tenant_id: tenantId,
    payload: {
      certification_id: certificationId,
      worker_id: workerId,
      tenant_id: tenantId,
      certification_type: input.certification_type,
      expiry_date: input.expiry_date,
    },
  });

  return { certification, upload_url: uploadUrl };
}

/**
 * Retrieves a certification by ID.
 */
export async function getCertification(
  tenantId: string,
  workerId: string,
  certificationId: string
): Promise<Certification | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(CERTIFICATIONS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}#WORKER#${workerId}`,
        SK: `CERT#${certificationId}`,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as Certification;
}

/**
 * Lists all certifications for a worker.
 */
export async function listCertifications(
  tenantId: string,
  workerId: string
): Promise<Certification[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(CERTIFICATIONS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#WORKER#${workerId}`,
        ':prefix': 'CERT#',
      },
    })
  );

  return (result.Items ?? []) as Certification[];
}

/**
 * Updates a certification's validation status.
 */
export async function updateCertification(
  tenantId: string,
  workerId: string,
  certificationId: string,
  input: UpdateCertificationInput
): Promise<Certification | null> {
  // Retrieve existing certification
  const existing = await getCertification(tenantId, workerId, certificationId);
  if (!existing) {
    return null;
  }

  // Validate status transition if status is being changed
  if (input.validation_status) {
    const transitionError = validateStatusTransition(
      existing.validation_status,
      input.validation_status
    );
    if (transitionError) {
      throw new Error(transitionError);
    }
  }

  const now = new Date().toISOString();
  const updateExpressions: string[] = ['#updated_at = :updated_at'];
  const expressionAttributeNames: Record<string, string> = {
    '#updated_at': 'updated_at',
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ':updated_at': now,
  };

  if (input.validation_status !== undefined) {
    updateExpressions.push('#validation_status = :validation_status');
    expressionAttributeNames['#validation_status'] = 'validation_status';
    expressionAttributeValues[':validation_status'] = input.validation_status;
  }

  if (input.rejection_reason !== undefined) {
    updateExpressions.push('#rejection_reason = :rejection_reason');
    expressionAttributeNames['#rejection_reason'] = 'rejection_reason';
    expressionAttributeValues[':rejection_reason'] = input.rejection_reason;
  }

  if (input.validated_by !== undefined) {
    updateExpressions.push('#validated_by = :validated_by');
    expressionAttributeNames['#validated_by'] = 'validated_by';
    expressionAttributeValues[':validated_by'] = input.validated_by;

    updateExpressions.push('#validated_at = :validated_at');
    expressionAttributeNames['#validated_at'] = 'validated_at';
    expressionAttributeValues[':validated_at'] = now;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(CERTIFICATIONS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}#WORKER#${workerId}`,
        SK: `CERT#${certificationId}`,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes as Certification;
}
