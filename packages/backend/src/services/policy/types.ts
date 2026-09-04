/**
 * Policy Service domain types.
 * Defines Policy and PolicyVersion interfaces for the versioned policy management system.
 */

export interface Policy {
  policy_id: string;
  tenant_id: string;
  site_id: string;
  name: string;
  description: string;
  jurisdiction: string;
  owner_type: 'platform' | 'tenant' | 'site' | 'project';
  owner_id: string;
  current_version_number: number;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface PolicyVersion {
  policy_version_id: string;
  policy_id: string;
  tenant_id: string;
  version_number: number;
  effective_from: string; // YYYY-MM-DD (day precision)
  effective_to?: string; // YYYY-MM-DD (day precision), optional for open-ended
  rules: PolicyRule[];
  rule_snapshot_json: string;
  change_summary: string; // max 1000 characters
  published_by: string;
  published_at: string;
  is_active: boolean;
  used_in_decisions: boolean;
}

export interface PolicyRule {
  rule_id: string;
  rule_type: string;
  description: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
}

export interface CreatePolicyInput {
  name: string;
  description: string;
  site_id: string;
  jurisdiction: string;
  owner_type: 'platform' | 'tenant' | 'site' | 'project';
  owner_id: string;
}

export interface CreatePolicyVersionInput {
  effective_from: string; // YYYY-MM-DD
  effective_to?: string; // YYYY-MM-DD
  rules: PolicyRule[];
  change_summary: string;
}

export interface PolicyWithVersions extends Policy {
  versions: PolicyVersion[];
}
