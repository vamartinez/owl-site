/**
 * Form Version management for the Forms Service.
 * Handles creation of immutable version snapshots when forms are published.
 *
 * FormVersions table schema:
 * - PK: FORM#{form_id}
 * - SK: VERSION#{zero-padded version_number} (e.g., VERSION#0001)
 *
 * FormResponses table schema (for version association):
 * - PK: FORM#{form_id}
 * - SK: RESPONSE#{response_id}
 * - version_number: Number (associates response with version at time of submission)
 *
 * Requirements: 6.4, 14.1, 14.2, 14.3, 14.6
 */

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import type { FieldConfig, FormVersion } from './types.js';

const FORM_VERSIONS_TABLE = 'FormVersions';
const FORM_RESPONSES_TABLE = 'FormResponses';
const logger = createLogger('forms-version');

/**
 * Zero-pads a version number to 4 digits for lexicographic sorting.
 * e.g., 1 → "0001", 12 → "0012"
 */
export function padVersionNumber(version: number): string {
  return version.toString().padStart(4, '0');
}

/**
 * Gets the current highest version number for a form.
 * Returns 0 if no versions exist.
 */
export async function getCurrentVersionNumber(formId: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORM_VERSIONS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `FORM#${formId}`,
      },
      ScanIndexForward: false, // Descending order to get latest first
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return 0;
  }

  return (result.Items[0] as FormVersion).version_number;
}

/**
 * Creates a new immutable FormVersion snapshot.
 * Increments the version number sequentially.
 *
 * @param formId - The form's UUID
 * @param fieldsSnapshot - The immutable copy of the form's fields at publish time
 * @param createdBy - The user ID who triggered the publish
 * @returns The created FormVersion
 */
export async function createFormVersion(
  formId: string,
  fieldsSnapshot: FieldConfig[],
  createdBy: string
): Promise<FormVersion> {
  const currentVersion = await getCurrentVersionNumber(formId);
  const newVersionNumber = currentVersion + 1;
  const now = new Date().toISOString();

  const version: FormVersion = {
    form_id: formId,
    version_number: newVersionNumber,
    fields_snapshot: fieldsSnapshot,
    created_at: now,
    created_by: createdBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(FORM_VERSIONS_TABLE),
      Item: {
        PK: `FORM#${formId}`,
        SK: `VERSION#${padVersionNumber(newVersionNumber)}`,
        ...version,
      },
    })
  );

  logger.info('Form version created', {
    form_id: formId,
    version_number: newVersionNumber,
    created_by: createdBy,
  });

  return version;
}

/**
 * Retrieves a specific version of a form by form ID and version number.
 *
 * @param formId - The form's UUID
 * @param versionNumber - The version number to retrieve
 * @returns The FormVersion if found, null otherwise
 *
 * Requirements: 14.2, 14.4
 */
export async function getFormVersion(
  formId: string,
  versionNumber: number
): Promise<FormVersion | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(FORM_VERSIONS_TABLE),
      Key: {
        PK: `FORM#${formId}`,
        SK: `VERSION#${padVersionNumber(versionNumber)}`,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as FormVersion;
}

/**
 * Retrieves all versions for a form, ordered by version number ascending.
 *
 * @param formId - The form's UUID
 * @returns Array of FormVersion objects sorted by version_number ascending
 *
 * Requirements: 14.1, 14.3
 */
export async function getFormVersions(formId: string): Promise<FormVersion[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORM_VERSIONS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `FORM#${formId}`,
      },
      ScanIndexForward: true, // Ascending order by SK (VERSION#0001, VERSION#0002, ...)
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items as FormVersion[];
}

/**
 * Checks if a specific version of a form has any associated responses.
 * Queries the FormResponses table filtering by version_number.
 *
 * @param formId - The form's UUID
 * @param versionNumber - The version number to check
 * @returns true if at least one response exists for this version, false otherwise
 *
 * Requirements: 14.6
 */
export async function hasResponsesForVersion(
  formId: string,
  versionNumber: number
): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORM_RESPONSES_TABLE),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'version_number = :vn',
      ExpressionAttributeValues: {
        ':pk': `FORM#${formId}`,
        ':vn': versionNumber,
      },
      Limit: 1, // We only need to know if at least one exists
      Select: 'COUNT',
    })
  );

  return (result.Count ?? 0) > 0;
}

/**
 * Rejects modification or deletion of a version that has existing responses.
 * Throws an error if the version is immutable due to associated responses.
 *
 * This enforces Requirement 14.6: versions with responses cannot be modified or deleted.
 *
 * @param formId - The form's UUID
 * @param versionNumber - The version number to check
 * @throws Error if the version has associated responses
 *
 * Requirements: 14.6
 */
export async function rejectVersionModification(
  formId: string,
  versionNumber: number
): Promise<void> {
  const hasResponses = await hasResponsesForVersion(formId, versionNumber);

  if (hasResponses) {
    logger.warn('Attempted modification of immutable version', {
      form_id: formId,
      version_number: versionNumber,
    });

    throw new Error(
      `La versión ${versionNumber} del formulario no puede ser modificada ni eliminada porque tiene respuestas asociadas`
    );
  }
}
