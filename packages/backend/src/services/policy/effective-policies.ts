/**
 * Effective Policies Module.
 * Aggregates all active policies assigned to a specific site.
 *
 * An "effective policy" is one that:
 * 1. Is assigned to the requested site (via site_id / GSI1PK)
 * 2. Has at least one version with is_active = true
 *
 * Requirement 3.4: All active policies assigned to site are aggregated correctly.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { Policy } from './types.js';

export interface EffectivePolicy {
  policy_id: string;
  name: string;
  description: string;
  jurisdiction: string;
  owner_type: string;
  site_id: string;
  status: string;
  current_version_number: number;
}

/**
 * Gets all policies assigned to a site, then filters to only those with status 'active'.
 *
 * Policies are stored with GSI1PK = SITE#<site_id>, allowing efficient lookup by site.
 * Only policies with status = 'active' are returned as effective policies.
 */
export async function getEffectivePolicies(
  siteId: string,
  tenantId: string
): Promise<EffectivePolicy[]> {
  // Query all policies assigned to this site using the GSI
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Policies'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  // Filter only active policies and map to EffectivePolicy shape
  const effectivePolicies: EffectivePolicy[] = [];

  for (const item of result.Items) {
    const record = item as Record<string, unknown>;
    const status = record['status'] as string | undefined;

    // Only include policies with status 'active'
    if (status !== 'active') {
      continue;
    }

    // Ensure the policy belongs to the correct tenant
    if (record['tenant_id'] !== tenantId) {
      continue;
    }

    effectivePolicies.push({
      policy_id: record['policy_id'] as string,
      name: record['name'] as string,
      description: record['description'] as string,
      jurisdiction: record['jurisdiction'] as string,
      owner_type: record['owner_type'] as string,
      site_id: record['site_id'] as string,
      status: status,
      current_version_number: record['current_version_number'] as number,
    });
  }

  return effectivePolicies;
}
