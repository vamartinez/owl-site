/**
 * Policy Version Manager.
 * Handles version creation with sequential numbering, effective date range validation,
 * immutability enforcement, and change_summary recording.
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import type { Policy, PolicyVersion, CreatePolicyVersionInput } from './types.js';

/**
 * Gets the next sequential version number for a policy.
 * Queries existing versions and returns max + 1.
 */
export async function getNextVersionNumber(policyId: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `POLICY#${policyId}`,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return 1;
  }

  const latestVersion = result.Items[0] as Record<string, unknown>;
  return (latestVersion['version_number'] as number) + 1;
}

/**
 * Gets all versions for a policy.
 */
export async function getVersionsForPolicy(policyId: string): Promise<PolicyVersion[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `POLICY#${policyId}`,
      },
      ScanIndexForward: true,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map(mapItemToVersion);
}

/**
 * Gets a specific version by ID.
 */
export async function getVersionById(
  policyId: string,
  versionId: string
): Promise<PolicyVersion | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `POLICY#${policyId}`,
        ':sk': `VERSION#${versionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return mapItemToVersion(result.Items[0] as Record<string, unknown>);
}

/**
 * Checks if a version has been used in any decision records.
 */
export async function isVersionUsedInDecisions(versionId: string): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('DecisionRecords'),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `POLICYVERSION#${versionId}`,
      },
      Limit: 1,
    })
  );

  return (result.Items?.length ?? 0) > 0;
}

export interface DateOverlapConflict {
  conflicting_version_id: string;
  conflicting_version_number: number;
  conflicting_effective_from: string;
  conflicting_effective_to?: string;
}

/**
 * Checks for overlapping date ranges among existing versions for the same policy.
 * Returns the conflicting version details if an overlap is found, or null if no overlap.
 */
export function findDateOverlap(
  existingVersions: PolicyVersion[],
  newEffectiveFrom: string,
  newEffectiveTo?: string
): DateOverlapConflict | null {
  const newFrom = new Date(newEffectiveFrom);
  const newTo = newEffectiveTo ? new Date(newEffectiveTo) : null;

  for (const version of existingVersions) {
    const existingFrom = new Date(version.effective_from);
    const existingTo = version.effective_to ? new Date(version.effective_to) : null;

    // Check overlap:
    // Two ranges [A_start, A_end] and [B_start, B_end] overlap if:
    // A_start <= B_end AND B_start <= A_end
    // For open-ended ranges (no end date), treat as extending to infinity.

    const newStartBeforeExistingEnd =
      existingTo === null ? true : newFrom <= existingTo;
    const existingStartBeforeNewEnd =
      newTo === null ? true : existingFrom <= newTo;

    if (newStartBeforeExistingEnd && existingStartBeforeNewEnd) {
      return {
        conflicting_version_id: version.policy_version_id,
        conflicting_version_number: version.version_number,
        conflicting_effective_from: version.effective_from,
        conflicting_effective_to: version.effective_to,
      };
    }
  }

  return null;
}

/**
 * Creates a new policy version with all validations:
 * - Sequential version numbering
 * - Date range overlap rejection
 * - change_summary max 1000 characters
 * - Publishes SitePolicyPublished event
 */
export async function createPolicyVersion(
  policy: Policy,
  input: CreatePolicyVersionInput,
  publishedBy: string
): Promise<{ version?: PolicyVersion; error?: string; conflict?: DateOverlapConflict }> {
  // Validate change_summary length
  if (input.change_summary.length > 1000) {
    return { error: 'change_summary must be at most 1000 characters' };
  }

  // Validate change_summary is not empty
  if (input.change_summary.trim().length === 0) {
    return { error: 'change_summary is required' };
  }

  // Validate effective_from format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_from)) {
    return { error: 'effective_from must be in YYYY-MM-DD format' };
  }

  // Validate effective_to format if provided
  if (input.effective_to && !/^\d{4}-\d{2}-\d{2}$/.test(input.effective_to)) {
    return { error: 'effective_to must be in YYYY-MM-DD format' };
  }

  // Validate effective_to is after effective_from
  if (input.effective_to && input.effective_to <= input.effective_from) {
    return { error: 'effective_to must be after effective_from' };
  }

  // Get existing versions to check for overlaps
  const existingVersions = await getVersionsForPolicy(policy.policy_id);

  // Check for date range overlaps
  const overlap = findDateOverlap(existingVersions, input.effective_from, input.effective_to);
  if (overlap) {
    return {
      error: `Date range overlaps with version ${overlap.conflicting_version_number} (effective from ${overlap.conflicting_effective_from}${overlap.conflicting_effective_to ? ` to ${overlap.conflicting_effective_to}` : ' onwards'})`,
      conflict: overlap,
    };
  }

  // Get next sequential version number
  const versionNumber = await getNextVersionNumber(policy.policy_id);

  // Create the version
  const versionId = uuidv4();
  const now = new Date().toISOString();
  const ruleSnapshotJson = JSON.stringify(input.rules);

  const version: PolicyVersion = {
    policy_version_id: versionId,
    policy_id: policy.policy_id,
    tenant_id: policy.tenant_id,
    version_number: versionNumber,
    effective_from: input.effective_from,
    effective_to: input.effective_to,
    rules: input.rules,
    rule_snapshot_json: ruleSnapshotJson,
    change_summary: input.change_summary,
    published_by: publishedBy,
    published_at: now,
    is_active: true,
    used_in_decisions: false,
  };

  // Store in DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: getTableName('PolicyVersions'),
      Item: {
        PK: `POLICY#${policy.policy_id}`,
        SK: `VERSION#${versionId}`,
        GSI1PK: `TENANT#${policy.tenant_id}`,
        GSI1SK: `POLICY#${policy.policy_id}#VERSION#${String(versionNumber).padStart(6, '0')}`,
        ...version,
      },
    })
  );

  // Update the policy's current_version_number
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Policies'),
      Key: {
        PK: `TENANT#${policy.tenant_id}`,
        SK: `POLICY#${policy.policy_id}`,
      },
      UpdateExpression: 'SET current_version_number = :vn, updated_at = :now',
      ExpressionAttributeValues: {
        ':vn': versionNumber,
        ':now': now,
      },
    })
  );

  // Publish SitePolicyPublished event
  await publishEvent({
    event_type: EventTypes.SITE_POLICY_PUBLISHED,
    source_service: 'policy-service',
    tenant_id: policy.tenant_id,
    payload: {
      policy_id: policy.policy_id,
      policy_version_id: versionId,
      site_id: policy.site_id,
      effective_from: input.effective_from,
      published_by: publishedBy,
      version_number: versionNumber,
    },
  });

  return { version };
}

/**
 * Validates that a version can be modified (not used in any decisions).
 * Returns an error message if immutable, or null if modification is allowed.
 * Requirement 2.7: Reject modification of versions used in DecisionRecords.
 */
export async function validateVersionMutable(versionId: string): Promise<string | null> {
  const usedInDecisions = await isVersionUsedInDecisions(versionId);
  if (usedInDecisions) {
    return 'This policy version is immutable because it has been used in compliance decisions and cannot be modified';
  }
  return null;
}

/**
 * Updates a policy version's metadata (change_summary, effective_to).
 * Enforces immutability: rejects modification if version has been used in decisions.
 * Requirement 2.7.
 */
export async function updatePolicyVersion(
  policyId: string,
  versionId: string,
  updates: { change_summary?: string; effective_to?: string }
): Promise<{ version?: PolicyVersion; error?: string }> {
  // Check immutability
  const immutabilityError = await validateVersionMutable(versionId);
  if (immutabilityError) {
    return { error: immutabilityError };
  }

  // Validate change_summary if provided
  if (updates.change_summary !== undefined) {
    if (updates.change_summary.trim().length === 0) {
      return { error: 'change_summary cannot be empty' };
    }
    if (updates.change_summary.length > 1000) {
      return { error: 'change_summary must be at most 1000 characters' };
    }
  }

  // Validate effective_to format if provided
  if (updates.effective_to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(updates.effective_to)) {
    return { error: 'effective_to must be in YYYY-MM-DD format' };
  }

  // Get the current version
  const version = await getVersionById(policyId, versionId);
  if (!version) {
    return { error: 'Policy version not found' };
  }

  // Validate effective_to is after effective_from
  if (updates.effective_to && updates.effective_to <= version.effective_from) {
    return { error: 'effective_to must be after effective_from' };
  }

  // If updating effective_to, check for overlaps with other versions
  if (updates.effective_to) {
    const existingVersions = await getVersionsForPolicy(policyId);
    const otherVersions = existingVersions.filter(
      (v) => v.policy_version_id !== versionId
    );
    const overlap = findDateOverlap(
      otherVersions,
      version.effective_from,
      updates.effective_to
    );
    if (overlap) {
      return {
        error: `Date range overlaps with version ${overlap.conflicting_version_number} (effective from ${overlap.conflicting_effective_from}${overlap.conflicting_effective_to ? ` to ${overlap.conflicting_effective_to}` : ' onwards'})`,
      };
    }
  }

  // Build update expression
  const updateExprParts: string[] = [];
  const exprAttrValues: Record<string, unknown> = {};

  if (updates.change_summary !== undefined) {
    updateExprParts.push('change_summary = :cs');
    exprAttrValues[':cs'] = updates.change_summary;
  }
  if (updates.effective_to !== undefined) {
    updateExprParts.push('effective_to = :et');
    exprAttrValues[':et'] = updates.effective_to;
  }

  if (updateExprParts.length === 0) {
    return { version };
  }

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('PolicyVersions'),
      Key: {
        PK: `POLICY#${policyId}`,
        SK: `VERSION#${versionId}`,
      },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeValues: exprAttrValues,
    })
  );

  // Return updated version
  const updatedVersion = await getVersionById(policyId, versionId);
  return { version: updatedVersion ?? version };
}

/**
 * Gets the active policy version for a specific date.
 * Requirement 2.8: Return error if no active version exists for the requested date.
 */
export async function getActiveVersionForDate(
  policyId: string,
  date: string
): Promise<{ version?: PolicyVersion; error?: string }> {
  const versions = await getVersionsForPolicy(policyId);

  const targetDate = new Date(date);

  for (const version of versions) {
    if (!version.is_active) continue;

    const effectiveFrom = new Date(version.effective_from);
    const effectiveTo = version.effective_to ? new Date(version.effective_to) : null;

    if (effectiveFrom <= targetDate && (effectiveTo === null || effectiveTo >= targetDate)) {
      return { version };
    }
  }

  return {
    error: `No active policy version exists for policy ${policyId} on date ${date}`,
  };
}

/**
 * Maps a DynamoDB item to a PolicyVersion object.
 */
function mapItemToVersion(item: Record<string, unknown>): PolicyVersion {
  return {
    policy_version_id: item['policy_version_id'] as string,
    policy_id: item['policy_id'] as string,
    tenant_id: item['tenant_id'] as string,
    version_number: item['version_number'] as number,
    effective_from: item['effective_from'] as string,
    effective_to: item['effective_to'] as string | undefined,
    rules: item['rules'] as PolicyVersion['rules'],
    rule_snapshot_json: item['rule_snapshot_json'] as string,
    change_summary: item['change_summary'] as string,
    published_by: item['published_by'] as string,
    published_at: item['published_at'] as string,
    is_active: item['is_active'] as boolean,
    used_in_decisions: item['used_in_decisions'] as boolean,
  };
}
