/**
 * Knowledge Base Context Document Manager.
 * Handles KB context document upload with presigned URL generation, metadata storage,
 * Bedrock Knowledge Base sync triggers, document deletion, and listing with sync status.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand, DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import type {
  KBContextDocumentRecord,
  KBDocumentCategory,
  KBSyncStatus,
  UploadKBDocumentRequest,
} from './types.js';
import { ALLOWED_KB_MIME_TYPES, MAX_KB_FILE_SIZE } from './types.js';
import { buildKBDocumentS3Key } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KB_DOCUMENTS_TABLE = 'kb-context-documents';
const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes
const KB_DOCUMENTS_BUCKET = process.env['KB_DOCUMENTS_BUCKET'] ?? 'kb-context-documents';

const s3Client = new S3Client({});
const logger = createLogger('report-validation-kb-manager');

// ---------------------------------------------------------------------------
// File Validation
// ---------------------------------------------------------------------------

/**
 * Validates KB document file metadata (MIME type and size) before generating a presigned URL.
 * Returns null if valid, or an error message string if invalid.
 *
 * Requirements: 13.2, 13.8
 */
export function validateKBFileMetadata(mimeType: string, fileSize: number): string | null {
  if (!ALLOWED_KB_MIME_TYPES.includes(mimeType as (typeof ALLOWED_KB_MIME_TYPES)[number])) {
    return 'Unsupported file format. Accepted: PDF, .docx';
  }
  if (fileSize <= 0) {
    return 'File size must be greater than 0';
  }
  if (fileSize > MAX_KB_FILE_SIZE) {
    return 'File must not exceed 50 MB';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Presigned URL Generation
// ---------------------------------------------------------------------------

/**
 * Generates a presigned PUT URL for uploading a KB context document to S3.
 *
 * Requirement: 13.1 (dedicated S3 bucket for KB context documents)
 */
export async function generateKBPresignedUploadUrl(
  s3Key: string,
  contentType: string,
  fileSize: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: KB_DOCUMENTS_BUCKET,
    Key: s3Key,
    ContentType: contentType,
    ContentLength: fileSize,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  });

  return uploadUrl;
}

// ---------------------------------------------------------------------------
// Knowledge Base Sync Trigger
// ---------------------------------------------------------------------------

/**
 * Marks the corpus for re-index after an upload/delete.
 *
 * Provider migration: Bedrock's StartIngestionJob is gone. With the default
 * keyword-retrieval backend (retrieval.ts) there is no external index to sync,
 * so this returns a synthetic job id to preserve the callers' contract
 * (uploadKBDocument / deleteKBDocument treat a non-null return as "sync ok").
 *
 * EXTENSION POINT (ai-provider-migration Task 8.3): when a self-managed vector
 * store is finalized, replace this body with an embed/upsert (or delete) job
 * against that store and return its real job id.
 */
export async function triggerKBSync(): Promise<string | null> {
  const jobId = `local-reindex-${Date.now()}`;
  logger.info('KB re-index requested (local keyword-retrieval backend)', {
    ingestion_job_id: jobId,
  });
  return jobId;
}

// ---------------------------------------------------------------------------
// Document Upload
// ---------------------------------------------------------------------------

export interface UploadKBDocumentResult {
  document_id: string;
  upload_url: string;
  s3_key: string;
  sync_status: KBSyncStatus;
  uploaded_at: string;
}

/**
 * Uploads a new KB context document: validates metadata, generates presigned URL,
 * stores metadata in DynamoDB, and triggers Knowledge Base sync.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.8
 *
 * @param tenantId - The tenant the document belongs to
 * @param documentId - Pre-generated ULID for the document
 * @param uploadedBy - The Cognito user ID of the uploader (must be tenant_admin)
 * @param request - Validated file metadata (file_name, file_size, mime_type, category)
 */
export async function uploadKBDocument(
  tenantId: string,
  documentId: string,
  uploadedBy: string,
  request: UploadKBDocumentRequest
): Promise<{ result?: UploadKBDocumentResult; error?: string }> {
  // Validate file metadata
  const validationError = validateKBFileMetadata(request.mime_type, request.file_size);
  if (validationError) {
    return { error: validationError };
  }

  // Build S3 key using category prefix
  const s3Key = buildKBDocumentS3Key(request.category, documentId, request.file_name);
  const now = new Date().toISOString();

  // Generate presigned URL first — if this fails, no records are created
  let uploadUrl: string;
  try {
    uploadUrl = await generateKBPresignedUploadUrl(s3Key, request.mime_type, request.file_size);
  } catch (err) {
    logger.error('Failed to generate presigned URL for KB document', {
      document_id: documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Upload could not be completed. Please try again.' };
  }

  // Create metadata record in DynamoDB with sync_status "pending"
  const documentRecord: KBContextDocumentRecord = {
    tenant_id: tenantId,
    document_id: documentId,
    file_name: request.file_name,
    file_size: request.file_size,
    mime_type: request.mime_type,
    category: request.category,
    s3_key: s3Key,
    sync_status: 'pending',
    uploaded_by: uploadedBy,
    uploaded_at: now,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: getTableName(KB_DOCUMENTS_TABLE),
        Item: documentRecord,
      })
    );
  } catch (err) {
    logger.error('Failed to store KB document metadata in DynamoDB', {
      document_id: documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Upload could not be completed. Please try again.' };
  }

  // Trigger Knowledge Base sync — non-blocking, failures set sync_status to "error"
  const jobId = await triggerKBSync();
  if (!jobId) {
    // Sync trigger failed — update sync_status to "error"
    await updateSyncStatus(tenantId, documentId, 'error', 'Failed to trigger Knowledge Base sync');
  }

  logger.info('KB document uploaded', {
    document_id: documentId,
    tenant_id: tenantId,
    category: request.category,
    s3_key: s3Key,
    sync_triggered: !!jobId,
  });

  return {
    result: {
      document_id: documentId,
      upload_url: uploadUrl,
      s3_key: s3Key,
      sync_status: jobId ? 'pending' : 'error',
      uploaded_at: now,
    },
  };
}

// ---------------------------------------------------------------------------
// Document Deletion
// ---------------------------------------------------------------------------

export interface DeleteKBDocumentResult {
  document_id: string;
  deleted: boolean;
}

/**
 * Deletes a KB context document: removes from S3, removes metadata from DynamoDB,
 * and triggers a Knowledge Base re-sync.
 *
 * Requirement: 13.10
 *
 * @param tenantId - The tenant the document belongs to
 * @param documentId - The document ID to delete
 */
export async function deleteKBDocument(
  tenantId: string,
  documentId: string
): Promise<{ result?: DeleteKBDocumentResult; error?: string }> {
  // First, retrieve the document record to get the S3 key
  const document = await getKBDocument(tenantId, documentId);
  if (!document) {
    return { error: 'Document not found' };
  }

  // Remove from S3
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: KB_DOCUMENTS_BUCKET,
        Key: document.s3_key,
      })
    );
  } catch (err) {
    logger.error('Failed to delete KB document from S3', {
      document_id: documentId,
      s3_key: document.s3_key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Document could not be deleted. Please try again.' };
  }

  // Remove metadata from DynamoDB
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: getTableName(KB_DOCUMENTS_TABLE),
        Key: {
          tenant_id: tenantId,
          document_id: documentId,
        },
      })
    );
  } catch (err) {
    logger.error('Failed to delete KB document metadata from DynamoDB', {
      document_id: documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Document could not be deleted. Please try again.' };
  }

  // Trigger Knowledge Base re-sync to remove document from RAG index
  const jobId = await triggerKBSync();
  if (!jobId) {
    logger.warn('KB re-sync trigger failed after document deletion', {
      document_id: documentId,
    });
  }

  logger.info('KB document deleted', {
    document_id: documentId,
    tenant_id: tenantId,
    s3_key: document.s3_key,
    resync_triggered: !!jobId,
  });

  return {
    result: {
      document_id: documentId,
      deleted: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Document Listing
// ---------------------------------------------------------------------------

/**
 * Lists all KB context documents for a tenant with their sync status.
 *
 * Requirement: 13.7
 *
 * @param tenantId - The tenant to list documents for
 * @returns Array of KB context document records
 */
export async function listKBDocuments(tenantId: string): Promise<KBContextDocumentRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(KB_DOCUMENTS_TABLE),
      KeyConditionExpression: 'tenant_id = :tid',
      ExpressionAttributeValues: {
        ':tid': tenantId,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items as KBContextDocumentRecord[];
}

// ---------------------------------------------------------------------------
// Document Retrieval (Single)
// ---------------------------------------------------------------------------

/**
 * Retrieves a single KB context document record by tenant and document ID.
 *
 * @param tenantId - The tenant the document belongs to
 * @param documentId - The document ID to retrieve
 * @returns The document record, or null if not found
 */
export async function getKBDocument(
  tenantId: string,
  documentId: string
): Promise<KBContextDocumentRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(KB_DOCUMENTS_TABLE),
      KeyConditionExpression: 'tenant_id = :tid AND document_id = :did',
      ExpressionAttributeValues: {
        ':tid': tenantId,
        ':did': documentId,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as KBContextDocumentRecord;
}

// ---------------------------------------------------------------------------
// Sync Status Update
// ---------------------------------------------------------------------------

/**
 * Updates the sync_status (and optionally sync_error) for a KB context document.
 *
 * Requirement: 13.9 (set sync_status to "error" on failure)
 *
 * @param tenantId - The tenant the document belongs to
 * @param documentId - The document ID to update
 * @param syncStatus - The new sync status
 * @param syncError - Optional error message (set when status is "error")
 */
export async function updateSyncStatus(
  tenantId: string,
  documentId: string,
  syncStatus: KBSyncStatus,
  syncError?: string
): Promise<void> {
  const updateExprParts = ['sync_status = :ss'];
  const exprAttrValues: Record<string, unknown> = {
    ':ss': syncStatus,
  };

  if (syncError) {
    updateExprParts.push('sync_error = :se');
    exprAttrValues[':se'] = syncError;
  } else {
    // Remove sync_error if status is no longer "error"
    updateExprParts.push('sync_error = :se');
    exprAttrValues[':se'] = null;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(KB_DOCUMENTS_TABLE),
        Key: {
          tenant_id: tenantId,
          document_id: documentId,
        },
        UpdateExpression: `SET ${updateExprParts.join(', ')}`,
        ExpressionAttributeValues: exprAttrValues,
      })
    );

    logger.info('KB document sync status updated', {
      document_id: documentId,
      sync_status: syncStatus,
      sync_error: syncError,
    });
  } catch (err) {
    logger.error('Failed to update KB document sync status', {
      document_id: documentId,
      sync_status: syncStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
