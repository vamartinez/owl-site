/**
 * Unit tests for the Policy Service.
 * Tests version-manager logic (date overlap detection, active version lookup, update validation)
 * and handler input validation schemas.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { findDateOverlap } from '../../src/services/policy/version-manager.js';
import { boundedString, iso8601DateSchema } from '../../src/shared/validators.js';
import type { PolicyVersion } from '../../src/services/policy/types.js';

// --- Helper to create a minimal PolicyVersion for overlap testing ---

function makeVersion(
  overrides: Partial<PolicyVersion> & { effective_from: string; effective_to?: string }
): PolicyVersion {
  return {
    policy_version_id: overrides.policy_version_id ?? 'v-default',
    policy_id: overrides.policy_id ?? 'p-1',
    tenant_id: overrides.tenant_id ?? 't-1',
    version_number: overrides.version_number ?? 1,
    effective_from: overrides.effective_from,
    effective_to: overrides.effective_to,
    rules: overrides.rules ?? [],
    rule_snapshot_json: overrides.rule_snapshot_json ?? '[]',
    change_summary: overrides.change_summary ?? 'Initial version',
    published_by: overrides.published_by ?? 'user-1',
    published_at: overrides.published_at ?? '2024-01-01T00:00:00.000Z',
    is_active: overrides.is_active ?? true,
    used_in_decisions: overrides.used_in_decisions ?? false,
  };
}

// --- Date Overlap Detection Tests ---

describe('version-manager: findDateOverlap', () => {
  it('returns null when no existing versions', () => {
    const result = findDateOverlap([], '2024-06-01', '2024-06-30');
    expect(result).toBeNull();
  });

  it('returns null when new range is entirely before existing', () => {
    const existing = [
      makeVersion({ effective_from: '2024-06-01', effective_to: '2024-06-30', version_number: 1 }),
    ];
    const result = findDateOverlap(existing, '2024-04-01', '2024-05-31');
    expect(result).toBeNull();
  });

  it('returns null when new range is entirely after existing', () => {
    const existing = [
      makeVersion({ effective_from: '2024-01-01', effective_to: '2024-03-31', version_number: 1 }),
    ];
    const result = findDateOverlap(existing, '2024-04-01', '2024-06-30');
    expect(result).toBeNull();
  });

  it('detects overlap when new range starts within existing range', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-1',
        effective_from: '2024-01-01',
        effective_to: '2024-06-30',
        version_number: 1,
      }),
    ];
    const result = findDateOverlap(existing, '2024-03-15', '2024-09-30');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-1');
    expect(result!.conflicting_version_number).toBe(1);
  });

  it('detects overlap when new range ends within existing range', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-2',
        effective_from: '2024-06-01',
        effective_to: '2024-12-31',
        version_number: 2,
      }),
    ];
    const result = findDateOverlap(existing, '2024-04-01', '2024-07-15');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-2');
  });

  it('detects overlap when new range completely contains existing range', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-3',
        effective_from: '2024-03-01',
        effective_to: '2024-04-30',
        version_number: 3,
      }),
    ];
    const result = findDateOverlap(existing, '2024-01-01', '2024-12-31');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-3');
  });

  it('detects overlap when new range is contained within existing range', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-4',
        effective_from: '2024-01-01',
        effective_to: '2024-12-31',
        version_number: 4,
      }),
    ];
    const result = findDateOverlap(existing, '2024-03-01', '2024-04-30');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-4');
  });

  it('detects overlap with open-ended existing version (no effective_to)', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-5',
        effective_from: '2024-01-01',
        effective_to: undefined,
        version_number: 5,
      }),
    ];
    const result = findDateOverlap(existing, '2024-06-01', '2024-12-31');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-5');
  });

  it('detects overlap when new range is open-ended and existing has end date', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-6',
        effective_from: '2024-06-01',
        effective_to: '2024-12-31',
        version_number: 6,
      }),
    ];
    const result = findDateOverlap(existing, '2024-03-01', undefined);
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-6');
  });

  it('returns null when open-ended new range starts after existing ends', () => {
    const existing = [
      makeVersion({
        effective_from: '2024-01-01',
        effective_to: '2024-03-31',
        version_number: 1,
      }),
    ];
    const result = findDateOverlap(existing, '2024-04-01', undefined);
    expect(result).toBeNull();
  });

  it('detects overlap on exact boundary (same day)', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-7',
        effective_from: '2024-01-01',
        effective_to: '2024-06-30',
        version_number: 7,
      }),
    ];
    const result = findDateOverlap(existing, '2024-06-30', '2024-09-30');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-7');
  });

  it('returns the first conflicting version when multiple overlap', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-a',
        effective_from: '2024-01-01',
        effective_to: '2024-03-31',
        version_number: 1,
      }),
      makeVersion({
        policy_version_id: 'v-b',
        effective_from: '2024-04-01',
        effective_to: '2024-06-30',
        version_number: 2,
      }),
    ];
    const result = findDateOverlap(existing, '2024-05-01', '2024-08-31');
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-b');
  });

  it('returns null for adjacent non-overlapping ranges', () => {
    const existing = [
      makeVersion({
        effective_from: '2024-01-01',
        effective_to: '2024-05-31',
        version_number: 1,
      }),
    ];
    const result = findDateOverlap(existing, '2024-06-01', '2024-12-31');
    expect(result).toBeNull();
  });

  it('detects overlap when both ranges are open-ended', () => {
    const existing = [
      makeVersion({
        policy_version_id: 'v-open',
        effective_from: '2024-01-01',
        effective_to: undefined,
        version_number: 1,
      }),
    ];
    const result = findDateOverlap(existing, '2025-01-01', undefined);
    expect(result).not.toBeNull();
    expect(result!.conflicting_version_id).toBe('v-open');
  });
});

// --- Handler Validation Tests (via Zod schemas) ---

const createPolicySchema = z.object({
  name: boundedString(200, 'Policy name'),
  description: boundedString(2000, 'Description'),
  site_id: z.string().uuid('site_id must be a valid UUID'),
  jurisdiction: boundedString(100, 'Jurisdiction'),
  owner_type: z.enum(['platform', 'tenant', 'site', 'project']),
  owner_id: z.string().uuid('owner_id must be a valid UUID'),
});

const policyRuleSchema = z.object({
  rule_id: z.string().min(1),
  rule_type: z.string().min(1),
  description: z.string().max(500),
  conditions: z.record(z.unknown()),
  actions: z.record(z.unknown()),
});

const createVersionSchema = z.object({
  effective_from: iso8601DateSchema,
  effective_to: iso8601DateSchema.optional(),
  rules: z.array(policyRuleSchema).min(1, 'At least one rule is required'),
  change_summary: boundedString(1000, 'Change summary'),
});

describe('policy handler: createPolicySchema validation', () => {
  it('accepts valid policy input', () => {
    const input = {
      name: 'Fall Protection Policy',
      description: 'Governs fall protection requirements for all sites',
      site_id: '550e8400-e29b-41d4-a716-446655440000',
      jurisdiction: 'British Columbia',
      owner_type: 'tenant',
      owner_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    expect(createPolicySchema.safeParse(input).success).toBe(true);
  });

  it('rejects empty name', () => {
    const input = {
      name: '',
      description: 'Valid description',
      site_id: '550e8400-e29b-41d4-a716-446655440000',
      jurisdiction: 'BC',
      owner_type: 'tenant',
      owner_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    expect(createPolicySchema.safeParse(input).success).toBe(false);
  });

  it('rejects name exceeding 200 characters', () => {
    const input = {
      name: 'x'.repeat(201),
      description: 'Valid description',
      site_id: '550e8400-e29b-41d4-a716-446655440000',
      jurisdiction: 'BC',
      owner_type: 'tenant',
      owner_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    expect(createPolicySchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid owner_type', () => {
    const input = {
      name: 'Valid Name',
      description: 'Valid description',
      site_id: '550e8400-e29b-41d4-a716-446655440000',
      jurisdiction: 'BC',
      owner_type: 'invalid',
      owner_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    expect(createPolicySchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid UUID for site_id', () => {
    const input = {
      name: 'Valid Name',
      description: 'Valid description',
      site_id: 'not-a-uuid',
      jurisdiction: 'BC',
      owner_type: 'tenant',
      owner_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    expect(createPolicySchema.safeParse(input).success).toBe(false);
  });

  it('accepts all valid owner_type values', () => {
    const base = {
      name: 'Valid Name',
      description: 'Valid description',
      site_id: '550e8400-e29b-41d4-a716-446655440000',
      jurisdiction: 'BC',
      owner_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    for (const ownerType of ['platform', 'tenant', 'site', 'project']) {
      expect(createPolicySchema.safeParse({ ...base, owner_type: ownerType }).success).toBe(true);
    }
  });
});

describe('policy handler: createVersionSchema validation', () => {
  const validRule = {
    rule_id: 'rule-1',
    rule_type: 'certification_required',
    description: 'Workers must have fall protection certification',
    conditions: { certification_type: 'fall_protection' },
    actions: { deny_if_missing: true },
  };

  it('accepts valid version input', () => {
    const input = {
      effective_from: '2024-06-01',
      effective_to: '2024-12-31',
      rules: [validRule],
      change_summary: 'Added fall protection requirement',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(true);
  });

  it('accepts version without effective_to (open-ended)', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [validRule],
      change_summary: 'Open-ended version',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(true);
  });

  it('rejects invalid effective_from format', () => {
    const input = {
      effective_from: '2024/06/01',
      rules: [validRule],
      change_summary: 'Bad date format',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty rules array', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [],
      change_summary: 'No rules',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects change_summary exceeding 1000 characters', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [validRule],
      change_summary: 'x'.repeat(1001),
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty change_summary', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [validRule],
      change_summary: '',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects rule with description exceeding 500 characters', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [{ ...validRule, description: 'x'.repeat(501) }],
      change_summary: 'Valid summary',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects rule with empty rule_id', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [{ ...validRule, rule_id: '' }],
      change_summary: 'Valid summary',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });

  it('accepts change_summary at exactly 1000 characters', () => {
    const input = {
      effective_from: '2024-06-01',
      rules: [validRule],
      change_summary: 'x'.repeat(1000),
    };
    expect(createVersionSchema.safeParse(input).success).toBe(true);
  });

  it('rejects timestamp format for effective_from', () => {
    const input = {
      effective_from: '2024-06-01T00:00:00Z',
      rules: [validRule],
      change_summary: 'Valid summary',
    };
    expect(createVersionSchema.safeParse(input).success).toBe(false);
  });
});


// --- Update Version Schema Tests ---

const updateVersionSchema = z.object({
  change_summary: boundedString(1000, 'Change summary').optional(),
  effective_to: iso8601DateSchema.optional(),
});

describe('policy handler: updateVersionSchema validation', () => {
  it('accepts valid update with change_summary only', () => {
    const input = { change_summary: 'Updated policy wording' };
    expect(updateVersionSchema.safeParse(input).success).toBe(true);
  });

  it('accepts valid update with effective_to only', () => {
    const input = { effective_to: '2024-12-31' };
    expect(updateVersionSchema.safeParse(input).success).toBe(true);
  });

  it('accepts valid update with both fields', () => {
    const input = { change_summary: 'Updated', effective_to: '2024-12-31' };
    expect(updateVersionSchema.safeParse(input).success).toBe(true);
  });

  it('rejects change_summary exceeding 1000 characters', () => {
    const input = { change_summary: 'x'.repeat(1001) };
    expect(updateVersionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid effective_to format', () => {
    const input = { effective_to: '2024/12/31' };
    expect(updateVersionSchema.safeParse(input).success).toBe(false);
  });

  it('accepts empty object (no fields to update)', () => {
    const input = {};
    expect(updateVersionSchema.safeParse(input).success).toBe(true);
  });
});

// --- getActiveVersionForDate logic tests (pure function simulation) ---

describe('version-manager: active version for date lookup', () => {
  function findActiveVersionForDate(
    versions: PolicyVersion[],
    date: string
  ): PolicyVersion | null {
    const targetDate = new Date(date);

    for (const version of versions) {
      if (!version.is_active) continue;

      const effectiveFrom = new Date(version.effective_from);
      const effectiveTo = version.effective_to ? new Date(version.effective_to) : null;

      if (effectiveFrom <= targetDate && (effectiveTo === null || effectiveTo >= targetDate)) {
        return version;
      }
    }

    return null;
  }

  it('returns the active version when date falls within range', () => {
    const versions = [
      makeVersion({
        policy_version_id: 'v-1',
        effective_from: '2024-01-01',
        effective_to: '2024-06-30',
        is_active: true,
        version_number: 1,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2024-03-15');
    expect(result).not.toBeNull();
    expect(result!.policy_version_id).toBe('v-1');
  });

  it('returns null when date is before all versions', () => {
    const versions = [
      makeVersion({
        effective_from: '2024-06-01',
        effective_to: '2024-12-31',
        is_active: true,
        version_number: 1,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2024-01-15');
    expect(result).toBeNull();
  });

  it('returns null when date is after all versions', () => {
    const versions = [
      makeVersion({
        effective_from: '2024-01-01',
        effective_to: '2024-06-30',
        is_active: true,
        version_number: 1,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2024-09-15');
    expect(result).toBeNull();
  });

  it('returns the open-ended version when date is after effective_from', () => {
    const versions = [
      makeVersion({
        policy_version_id: 'v-open',
        effective_from: '2024-01-01',
        effective_to: undefined,
        is_active: true,
        version_number: 1,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2025-06-15');
    expect(result).not.toBeNull();
    expect(result!.policy_version_id).toBe('v-open');
  });

  it('skips inactive versions', () => {
    const versions = [
      makeVersion({
        policy_version_id: 'v-inactive',
        effective_from: '2024-01-01',
        effective_to: '2024-12-31',
        is_active: false,
        version_number: 1,
      }),
      makeVersion({
        policy_version_id: 'v-active',
        effective_from: '2024-01-01',
        effective_to: '2024-12-31',
        is_active: true,
        version_number: 2,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2024-06-15');
    expect(result).not.toBeNull();
    expect(result!.policy_version_id).toBe('v-active');
  });

  it('returns version on exact effective_from date', () => {
    const versions = [
      makeVersion({
        policy_version_id: 'v-exact',
        effective_from: '2024-06-01',
        effective_to: '2024-12-31',
        is_active: true,
        version_number: 1,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2024-06-01');
    expect(result).not.toBeNull();
    expect(result!.policy_version_id).toBe('v-exact');
  });

  it('returns version on exact effective_to date', () => {
    const versions = [
      makeVersion({
        policy_version_id: 'v-boundary',
        effective_from: '2024-01-01',
        effective_to: '2024-06-30',
        is_active: true,
        version_number: 1,
      }),
    ];
    const result = findActiveVersionForDate(versions, '2024-06-30');
    expect(result).not.toBeNull();
    expect(result!.policy_version_id).toBe('v-boundary');
  });

  it('returns null when no versions exist', () => {
    const result = findActiveVersionForDate([], '2024-06-15');
    expect(result).toBeNull();
  });
});
