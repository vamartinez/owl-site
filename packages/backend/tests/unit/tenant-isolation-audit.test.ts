/**
 * Unit tests for Tenant Isolation and Audit Trail.
 *
 * Requirements: 14.1, 14.2, 14.7, 14.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../src/shared/types/common.js';

describe('tenant-isolation: validateTenantAccess', () => {
  let validateTenantAccess: typeof import('../../src/shared/tenant-isolation.js').validateTenantAccess;
  let verifyResourceOwnership: typeof import('../../src/shared/tenant-isolation.js').verifyResourceOwnership;
  let tenantScopedPK: typeof import('../../src/shared/tenant-isolation.js').tenantScopedPK;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn() }) },
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const mod = await import('../../src/shared/tenant-isolation.js');
    validateTenantAccess = mod.validateTenantAccess;
    verifyResourceOwnership = mod.verifyResourceOwnership;
    tenantScopedPK = mod.tenantScopedPK;
  });

  it('allows access when user tenant matches resource tenant (Req 14.1)', () => {
    const user = {
      user_id: 'u1',
      tenant_id: 'tenant-1',
      role: Role.TENANT_ADMIN,
    };

    const result = validateTenantAccess(user, 'tenant-1');
    expect(result).toBeNull();
  });

  it('denies access when user tenant does not match resource tenant (Req 14.2)', () => {
    const user = {
      user_id: 'u1',
      tenant_id: 'tenant-1',
      role: Role.TENANT_ADMIN,
    };

    const result = validateTenantAccess(user, 'tenant-2');
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(403);

    // Should NOT reveal resource existence
    const body = JSON.parse(result!.body);
    expect(body.message).toBe('Access denied');
    expect(body.message).not.toContain('tenant-2');
    expect(body.message).not.toContain('resource');
  });

  it('allows platform_admin to access any tenant', () => {
    const user = {
      user_id: 'u1',
      tenant_id: 'platform-tenant',
      role: Role.PLATFORM_ADMIN,
    };

    const result = validateTenantAccess(user, 'tenant-2');
    expect(result).toBeNull();
  });

  it('denies cross-tenant access for all non-platform-admin roles', () => {
    const roles = [
      Role.TENANT_ADMIN,
      Role.SITE_ADMIN,
      Role.SUPERVISOR,
      Role.CSO,
      Role.GATE_OPERATOR,
      Role.WORKER,
    ];

    for (const role of roles) {
      const user = { user_id: 'u1', tenant_id: 'tenant-1', role };
      const result = validateTenantAccess(user, 'tenant-2');
      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(403);
    }
  });

  it('verifyResourceOwnership returns true when tenant matches', () => {
    const resource = { tenant_id: 'tenant-1', name: 'test' };
    expect(verifyResourceOwnership(resource, 'tenant-1')).toBe(true);
  });

  it('verifyResourceOwnership returns false when tenant does not match', () => {
    const resource = { tenant_id: 'tenant-1', name: 'test' };
    expect(verifyResourceOwnership(resource, 'tenant-2')).toBe(false);
  });

  it('tenantScopedPK builds correct partition key', () => {
    expect(tenantScopedPK('tenant-1')).toBe('TENANT#tenant-1');
    expect(tenantScopedPK('tenant-1', 'SITE#s1')).toBe('TENANT#tenant-1#SITE#s1');
  });
});

describe('audit-trail: recordAuditEntry', () => {
  let recordAuditEntry: typeof import('../../src/shared/audit-trail.js').recordAuditEntry;
  let queryAuditTrail: typeof import('../../src/shared/audit-trail.js').queryAuditTrail;
  let AUDIT_RETENTION_DAYS: typeof import('../../src/shared/audit-trail.js').AUDIT_RETENTION_DAYS;
  const mockSend = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();

    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const mod = await import('../../src/shared/audit-trail.js');
    recordAuditEntry = mod.recordAuditEntry;
    queryAuditTrail = mod.queryAuditTrail;
    AUDIT_RETENTION_DAYS = mod.AUDIT_RETENTION_DAYS;
  });

  it('records audit entry with all required fields (Req 14.7)', async () => {
    mockSend.mockResolvedValueOnce({});

    const entry = await recordAuditEntry({
      tenant_id: 'tenant-1',
      acting_user: 'admin-user-1',
      action: 'role_assignment',
      target_resource: 'user-2',
      target_resource_type: 'user',
      details: { new_role: 'site_admin' },
    });

    expect(entry.audit_id).toBeDefined();
    expect(entry.tenant_id).toBe('tenant-1');
    expect(entry.acting_user).toBe('admin-user-1');
    expect(entry.action).toBe('role_assignment');
    expect(entry.target_resource).toBe('user-2');
    expect(entry.target_resource_type).toBe('user');
    expect(entry.timestamp).toBeDefined();
    expect(entry.details).toEqual({ new_role: 'site_admin' });
  });

  it('sets TTL to minimum 90 days from creation (Req 14.8)', async () => {
    mockSend.mockResolvedValueOnce({});

    const beforeTime = Math.floor(Date.now() / 1000);

    const entry = await recordAuditEntry({
      tenant_id: 'tenant-1',
      acting_user: 'admin-user-1',
      action: 'policy_version_published',
      target_resource: 'policy-1',
      target_resource_type: 'policy',
    });

    const afterTime = Math.floor(Date.now() / 1000);
    const minTtl = beforeTime + AUDIT_RETENTION_DAYS * 24 * 60 * 60;
    const maxTtl = afterTime + AUDIT_RETENTION_DAYS * 24 * 60 * 60;

    expect(entry.ttl).toBeDefined();
    expect(entry.ttl!).toBeGreaterThanOrEqual(minTtl);
    expect(entry.ttl!).toBeLessThanOrEqual(maxTtl);
  });

  it('AUDIT_RETENTION_DAYS is at least 90', () => {
    expect(AUDIT_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
  });

  it('records policy change audit entries', async () => {
    mockSend.mockResolvedValueOnce({});

    const entry = await recordAuditEntry({
      tenant_id: 'tenant-1',
      acting_user: 'admin-1',
      action: 'policy_version_published',
      target_resource: 'policy-version-123',
      target_resource_type: 'policy_version',
      details: { policy_id: 'pol-1', version_number: 3 },
    });

    expect(entry.action).toBe('policy_version_published');
    expect(entry.target_resource_type).toBe('policy_version');
  });

  it('records override approval audit entries', async () => {
    mockSend.mockResolvedValueOnce({});

    const entry = await recordAuditEntry({
      tenant_id: 'tenant-1',
      acting_user: 'cso-1',
      action: 'override_approved',
      target_resource: 'override-req-456',
      target_resource_type: 'override_request',
      details: { decision_id: 'dec-1', expiration: '2024-09-15' },
    });

    expect(entry.action).toBe('override_approved');
  });

  it('queries audit trail entries', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          audit_id: 'a1',
          tenant_id: 'tenant-1',
          acting_user: 'admin-1',
          action: 'role_assignment',
          target_resource: 'user-2',
          target_resource_type: 'user',
          timestamp: '2024-06-15T10:00:00Z',
        },
      ],
    });

    const result = await queryAuditTrail('tenant-1');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].action).toBe('role_assignment');
  });
});
