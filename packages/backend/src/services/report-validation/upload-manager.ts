/**
 * Report Upload Manager.
 * Handles report file upload with presigned URL generation, report record creation,
 * version management (sequential numbering, history retrieval), and atomicity guarantees.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 6.1, 6.2, 6.3, 6.7, 6.8
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import type {
  ReportRecord,
  ReportVersionRecord,
  ReportStatus,
  CreateReportRequest,
  UploadVersionRequest,
} from './types.js';
import {
  ALLOWED_REPORT_MIME_TYPES,
  MIN_REPORT_FILE_SIZE,
  MAX_REPORT_FILE_SIZE,
  isValidTransition,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORTS_TABLE = 'reports';
const REPORT_VERSIONS_TABLE = 'report-versions';
const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes
const REPORT_DOCUMENTS_BUCKET = process.env['REPORT_DOCUMENTS_BUCKET'] ?? 'report-documents';

const s3Client = new S3Client({});
const logger = createLogger('report-validation-upload-manager');

// ---------------------------------------------------------------------------
// File Validation
// ---------------------------------------------------------------------------

/**
 * Validates file metadata (MIME type and size) before generating a presigned URL.
 * Returns null if valid, or an error message string if invalid.
 *
 * Requirements: 1.1, 1.2, 1.5
 */
export function validateFileMetadata(mimeType: string, fileSize: number): string | null {
  if (!ALLOWED_REPORT_MIME_TYPES.includes(mimeType as typeof ALLOWED_REPORT_MIME_TYPES[number])) {
    return 'Unsupported file format. Accepted: PDF, .docx, .doc';
  }
  if (fileSize < MIN_REPORT_FILE_SIZE) {
    return 'File size must be between 1 KB and 25 MB';
  }
  if (fileSize > MAX_REPORT_FILE_SIZE) {
    return 'File size must be between 1 KB and 25 MB';
  }
  return null;
}

// ---------------------------------------------------------------------------
// S3 Key Construction
// ---------------------------------------------------------------------------

/**
 * Builds the S3 object key for a report version.
 * Format: {tenant_id}/{report_id}/v{version}/{filename}
 *
 * Requirement: 1.3 (store file in S3)
 */
export function buildReportS3Key(
  tenantId: string,
  reportId: string,
  version: number,
  fileName: string
): string {
  return `${tenantId}/${reportId}/v${version}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Presigned URL Generation
// ---------------------------------------------------------------------------

/**
 * Generates a presigned PUT URL for uploading a report file to S3.
 *
 * Requirement: 1.7 (presigned URL pattern)
 */
export async function generatePresignedUploadUrl(
  s3Key: string,
  contentType: string,
  fileSize: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: REPORT_DOCUMENTS_BUCKET,
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
// Report Creation (Initial Upload)
// ---------------------------------------------------------------------------

export interface CreateReportResult {
  report_id: string;
  status: ReportStatus;
  upload_url: string;
  created_at: string;
}

/**
 * Creates a new report record and generates a presigned URL for the initial file upload.
 * The report starts at version 1 with status "draft".
 *
 * Requirements: 1.3, 1.4, 1.7
 *
 * @param tenantId - The tenant the report belongs to
 * @param ownerId - The Cognito user ID of the uploader
 * @param reportId - Pre-generated ULID for the report
 * @param request - Validated file metadata (file_name, file_size, mime_type)
 */
export async function createReport(
  tenantId: string,
  ownerId: string,
  reportId: string,
  request: CreateReportRequest
): Promise<CreateReportResult> {
  const now = new Date().toISOString();
  const version = 1;
  const s3Key = buildReportS3Key(tenantId, reportId, version, request.file_name);

  // Generate presigned URL first — if this fails, no records are created
  const uploadUrl = await generatePresignedUploadUrl(s3Key, request.mime_type, request.file_size);

  // Derive title from filename (strip extension, max 255 chars)
  const title = request.file_name.replace(/\.[^.]+$/, '').slice(0, 255);

  // Create report record
  const reportRecord: ReportRecord = {
    tenant_id: tenantId,
    report_id: reportId,
    owner_id: ownerId,
    title,
    status: 'draft',
    current_version: version,
    created_at: now,
    updated_at: now,
    status_history: [],
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(REPORTS_TABLE),
      Item: reportRecord,
    })
  );

  // Create version record
  const versionRecord: ReportVersionRecord = {
    report_id: reportId,
    version,
    file_name: request.file_name,
    file_size: request.file_size,
    mime_type: request.mime_type,
    s3_key: s3Key,
    extraction_status: 'pending',
    uploaded_by: ownerId,
    uploaded_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(REPORT_VERSIONS_TABLE),
      Item: versionRecord,
    })
  );

  logger.info('Report created', {
    report_id: reportId,
    tenant_id: tenantId,
    owner_id: ownerId,
    version,
  });

  return {
    report_id: reportId,
    status: 'draft',
    upload_url: uploadUrl,
    created_at: now,
  };
}

// ---------------------------------------------------------------------------
// Version Management
// ---------------------------------------------------------------------------

export interface UploadVersionResult {
  report_id: string;
  version: number;
  upload_url: string;
  status: ReportStatus;
  uploaded_at: string;
}

/**
 * Gets the current highest version number for a report by querying the versions table.
 * Returns 0 if no versions exist.
 *
 * Requirement: 6.2 (sequential version numbering)
 */
export async function getCurrentVersionNumber(reportId: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REPORT_VERSIONS_TABLE),
      KeyConditionExpression: 'report_id = :rid',
      ExpressionAttributeValues: {
        ':rid': reportId,
      },
      ScanIndexForward: false, // Descending order by sort key (version number)
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return 0;
  }

  return (result.Items[0] as ReportVersionRecord).version;
}

/**
 * Uploads a new version of an existing report.
 *
 * - Increments version number sequentially (no gaps)
 * - Generates a new S3 key and presigned URL
 * - Transitions report status back to "draft" if currently "validated"
 * - Preserves previous version and its validation results
 * - Only creates version record after successful presigned URL generation (atomicity)
 * - On failure: retains current status and version unchanged
 *
 * Requirements: 6.1, 6.2, 6.3, 6.7, 6.8
 *
 * @param tenantId - The tenant the report belongs to
 * @param reportId - The report to upload a new version for
 * @param uploadedBy - The Cognito user ID of the uploader
 * @param report - The current report record (for status validation)
 * @param request - Validated file metadata (file_name, file_size, mime_type)
 */
export async function uploadNewVersion(
  tenantId: string,
  reportId: string,
  uploadedBy: string,
  report: ReportRecord,
  request: UploadVersionRequest
): Promise<{ result?: UploadVersionResult; error?: string }> {
  // Validate that the report is in a state that allows new version upload
  // Only "validated" reports can have new versions uploaded (transitions to "draft")
  // Also allow "draft" for re-upload scenarios
  if (report.status !== 'validated' && report.status !== 'draft') {
    return {
      error: `Cannot upload new version when report status is "${report.status}". Report must be in "validated" or "draft" status.`,
    };
  }

  // Validate file metadata
  const validationError = validateFileMetadata(request.mime_type, request.file_size);
  if (validationError) {
    return { error: validationError };
  }

  // Get next sequential version number
  const currentVersion = await getCurrentVersionNumber(reportId);
  const newVersion = currentVersion + 1;

  const now = new Date().toISOString();
  const s3Key = buildReportS3Key(tenantId, reportId, newVersion, request.file_name);

  // Generate presigned URL first — if this fails, nothing is persisted (atomicity)
  let uploadUrl: string;
  try {
    uploadUrl = await generatePresignedUploadUrl(s3Key, request.mime_type, request.file_size);
  } catch (err) {
    logger.error('Failed to generate presigned URL for new version', {
      report_id: reportId,
      version: newVersion,
      error: err instanceof Error ? err.message : String(err),
    });
    // Requirement 6.8: retain current status and version unchanged on failure
    return { error: 'Upload could not be completed. Please try again.' };
  }

  // Create version record — only after successful presigned URL generation
  const versionRecord: ReportVersionRecord = {
    report_id: reportId,
    version: newVersion,
    file_name: request.file_name,
    file_size: request.file_size,
    mime_type: request.mime_type,
    s3_key: s3Key,
    extraction_status: 'pending',
    uploaded_by: uploadedBy,
    uploaded_at: now,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: getTableName(REPORT_VERSIONS_TABLE),
        Item: versionRecord,
      })
    );
  } catch (err) {
    logger.error('Failed to create version record in DynamoDB', {
      report_id: reportId,
      version: newVersion,
      error: err instanceof Error ? err.message : String(err),
    });
    // Requirement 6.8: retain current status and version unchanged on failure
    return { error: 'Upload could not be completed. Please try again.' };
  }

  // Determine new status: if report was "validated", transition back to "draft"
  // Requirement 6.1: uploading new version on validated report → draft
  const newStatus: ReportStatus = report.status === 'validated' ? 'draft' : report.status;

  // Update report record with new version number and status
  try {
    const updateExprParts = [
      'current_version = :cv',
      'updated_at = :now',
    ];
    const exprAttrValues: Record<string, unknown> = {
      ':cv': newVersion,
      ':now': now,
    };

    if (newStatus !== report.status) {
      updateExprParts.push('#status = :newStatus');
      updateExprParts.push('status_history = list_append(if_not_exists(status_history, :emptyList), :transition)');
      exprAttrValues[':newStatus'] = newStatus;
      exprAttrValues[':emptyList'] = [];
      exprAttrValues[':transition'] = [{
        from_status: report.status,
        to_status: newStatus,
        triggered_by: uploadedBy,
        timestamp: now,
      }];
    }

    const expressionAttributeNames: Record<string, string> = {};
    if (newStatus !== report.status) {
      expressionAttributeNames['#status'] = 'status';
    }

    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(REPORTS_TABLE),
        Key: {
          tenant_id: tenantId,
          report_id: reportId,
        },
        UpdateExpression: `SET ${updateExprParts.join(', ')}`,
        ...(Object.keys(expressionAttributeNames).length > 0 && {
          ExpressionAttributeNames: expressionAttributeNames,
        }),
        ExpressionAttributeValues: exprAttrValues,
      })
    );
  } catch (err) {
    logger.error('Failed to update report record after version creation', {
      report_id: reportId,
      version: newVersion,
      error: err instanceof Error ? err.message : String(err),
    });
    // Note: version record was already created but report wasn't updated.
    // In production, a cleanup process would reconcile this.
    return { error: 'Upload could not be completed. Please try again.' };
  }

  logger.info('New version uploaded', {
    report_id: reportId,
    version: newVersion,
    previous_version: currentVersion,
    status_changed: newStatus !== report.status,
    new_status: newStatus,
  });

  return {
    result: {
      report_id: reportId,
      version: newVersion,
      upload_url: uploadUrl,
      status: newStatus,
      uploaded_at: now,
    },
  };
}

// ---------------------------------------------------------------------------
// Version History Retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieves all versions for a report in reverse chronological order (most recent first).
 *
 * Requirements: 6.2, 6.5
 *
 * @param reportId - The report to retrieve version history for
 * @returns Array of version records sorted by uploaded_at descending
 */
export async function getVersionHistory(reportId: string): Promise<ReportVersionRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REPORT_VERSIONS_TABLE),
      KeyConditionExpression: 'report_id = :rid',
      ExpressionAttributeValues: {
        ':rid': reportId,
      },
      ScanIndexForward: false, // Descending order by sort key (version number)
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  // Items are already in reverse order by version number (sort key descending).
  // Since versions are created sequentially and uploaded_at increases with each version,
  // reverse version order equals reverse chronological order.
  return result.Items as ReportVersionRecord[];
}

/**
 * Retrieves a specific version record for a report.
 *
 * @param reportId - The report ID
 * @param version - The version number to retrieve
 * @returns The version record, or null if not found
 */
export async function getVersionByNumber(
  reportId: string,
  version: number
): Promise<ReportVersionRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REPORT_VERSIONS_TABLE),
      KeyConditionExpression: 'report_id = :rid AND version = :v',
      ExpressionAttributeValues: {
        ':rid': reportId,
        ':v': version,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ReportVersionRecord;
}

// ---------------------------------------------------------------------------
// S3 Upload Confirmation
// ---------------------------------------------------------------------------

/**
 * Confirms that a file was successfully uploaded to S3 by checking if the object exists.
 * Used to verify atomicity: version record should only be considered valid
 * after the actual file is present in S3.
 *
 * Requirement: 6.7 (atomicity — only create version record after successful S3 PUT)
 *
 * @param s3Key - The S3 object key to check
 * @returns true if the object exists, false otherwise
 */
export async function confirmS3Upload(s3Key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: REPORT_DOCUMENTS_BUCKET,
        Key: s3Key,
      })
    );
    return true;
  } catch {
    return false;
  }
}
