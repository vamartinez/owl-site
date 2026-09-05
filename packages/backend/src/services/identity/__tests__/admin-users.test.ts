/**
 * Unit tests for the admin-users module.
 * Tests the GET /admin/users endpoint handler logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AdminUser } from '../admin-users.js';

// Mock the Cognito client
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: mockSend })),
  ListUsersCommand: vi.fn((input) => ({ input, __type: 'ListUsers' })),
  AdminListGroupsForUserCommand: vi.fn((input) => ({ input, __type: 'AdminListGroupsForUser' })),
}));

describe('admin-users: listAdminUsers', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    process.env['USER_POOL_ID'] = 'us-east-1_TestPool';
  });

  afterEach(() => {
    delete process.env['USER_POOL_ID'];
  });

  async function getListAdminUsers() {
    const mod = await import('../admin-users.js');
    return mod.listAdminUsers;
  }

  it('returns empty array when USER_POOL_ID is not set', async () => {
    delete process.env['USER_POOL_ID'];
    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');
    expect(result).toEqual({ users: [], total: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns mapped users from Cognito', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'user1',
          Attributes: [
            { Name: 'sub', Value: 'user-id-1' },
            { Name: 'email', Value: 'admin@example.com' },
            { Name: 'name', Value: 'Admin User' },
            { Name: 'custom:role', Value: 'platform_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date('2024-01-15T10:00:00Z'),
          UserLastModifiedDate: new Date('2024-06-01T14:30:00Z'),
        },
        {
          Username: 'user2',
          Attributes: [
            { Name: 'sub', Value: 'user-id-2' },
            { Name: 'email', Value: 'site@example.com' },
            { Name: 'name', Value: 'Site Admin' },
            { Name: 'custom:role', Value: 'site_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date('2024-02-20T08:00:00Z'),
          UserLastModifiedDate: new Date('2024-05-15T09:00:00Z'),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(2);

    const user1 = result.users[0]!;
    expect(user1.id).toBe('user-id-1');
    expect(user1.name).toBe('Admin User');
    expect(user1.email).toBe('admin@example.com');
    expect(user1.role).toBe('platform_admin');
    expect(user1.status).toBe('active');
    expect(user1.createdAt).toBe('2024-01-15T10:00:00.000Z');
    expect(user1.lastLogin).toBe('2024-06-01T14:30:00.000Z');

    const user2 = result.users[1]!;
    expect(user2.id).toBe('user-id-2');
    expect(user2.role).toBe('site_admin');
  });

  it('maps FORCE_CHANGE_PASSWORD status to "invited"', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'newuser',
          Attributes: [
            { Name: 'sub', Value: 'user-id-new' },
            { Name: 'email', Value: 'new@example.com' },
            { Name: 'name', Value: 'New User' },
            { Name: 'custom:role', Value: 'supervisor' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'FORCE_CHANGE_PASSWORD',
          Enabled: true,
          UserCreateDate: new Date('2024-06-01T10:00:00Z'),
          UserLastModifiedDate: new Date('2024-06-01T10:00:00Z'),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.users[0]!.status).toBe('invited');
  });

  it('maps disabled users to "inactive" status', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'disabled-user',
          Attributes: [
            { Name: 'sub', Value: 'user-id-disabled' },
            { Name: 'email', Value: 'disabled@example.com' },
            { Name: 'name', Value: 'Disabled User' },
            { Name: 'custom:role', Value: 'worker' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: false,
          UserCreateDate: new Date('2024-01-01T00:00:00Z'),
          UserLastModifiedDate: new Date('2024-03-01T00:00:00Z'),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.users[0]!.status).toBe('inactive');
  });

  it('filters users by search term (name)', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'u1',
          Attributes: [
            { Name: 'sub', Value: 'id-1' },
            { Name: 'email', Value: 'alice@example.com' },
            { Name: 'name', Value: 'Alice Johnson' },
            { Name: 'custom:role', Value: 'site_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
        {
          Username: 'u2',
          Attributes: [
            { Name: 'sub', Value: 'id-2' },
            { Name: 'email', Value: 'bob@example.com' },
            { Name: 'name', Value: 'Bob Smith' },
            { Name: 'custom:role', Value: 'supervisor' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001', 'alice');

    expect(result.total).toBe(1);
    expect(result.users[0]!.name).toBe('Alice Johnson');
  });

  it('filters users by search term (email)', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'u1',
          Attributes: [
            { Name: 'sub', Value: 'id-1' },
            { Name: 'email', Value: 'alice@example.com' },
            { Name: 'name', Value: 'Alice Johnson' },
            { Name: 'custom:role', Value: 'site_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
        {
          Username: 'u2',
          Attributes: [
            { Name: 'sub', Value: 'id-2' },
            { Name: 'email', Value: 'bob@corp.com' },
            { Name: 'name', Value: 'Bob Smith' },
            { Name: 'custom:role', Value: 'supervisor' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001', 'corp.com');

    expect(result.total).toBe(1);
    expect(result.users[0]!.name).toBe('Bob Smith');
  });

  it('defaults role to "worker" when custom:role attribute is missing and user has no groups', async () => {
    mockSend
      .mockResolvedValueOnce({
        Users: [
          {
            Username: 'norole',
            Attributes: [
              { Name: 'sub', Value: 'id-norole' },
              { Name: 'email', Value: 'norole@example.com' },
              { Name: 'name', Value: 'No Role User' },
              { Name: 'custom:tenant_id', Value: 'tenant-001' },
            ],
            UserStatus: 'CONFIRMED',
            Enabled: true,
            UserCreateDate: new Date(),
            UserLastModifiedDate: new Date(),
          },
        ],
        PaginationToken: undefined,
      })
      .mockResolvedValueOnce({ Groups: [] });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.users[0]!.role).toBe('worker');
  });

  it('falls back to Cognito Group membership when custom:role attribute is missing', async () => {
    // Reproduces the reported bug: a user assigned a role via a Cognito Group
    // (not the custom:role attribute) showed as "worker" in this list while
    // the app header — which reads cognito:groups from the JWT — showed their
    // real role correctly for the same session.
    mockSend
      .mockResolvedValueOnce({
        Users: [
          {
            Username: 'group-assigned',
            Attributes: [
              { Name: 'sub', Value: 'id-group-assigned' },
              { Name: 'email', Value: 'vic@example.com' },
              { Name: 'name', Value: 'Vic' },
              { Name: 'custom:tenant_id', Value: 'tenant-001' },
            ],
            UserStatus: 'CONFIRMED',
            Enabled: true,
            UserCreateDate: new Date(),
            UserLastModifiedDate: new Date(),
          },
        ],
        PaginationToken: undefined,
      })
      .mockResolvedValueOnce({ Groups: [{ GroupName: 'platform_admin' }] });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.users[0]!.role).toBe('platform_admin');
    expect(mockSend).toHaveBeenCalledTimes(2);
    const groupsCall = mockSend.mock.calls[1]![0] as { input: Record<string, unknown> };
    expect(groupsCall.input['Username']).toBe('group-assigned');
    expect(groupsCall.input['UserPoolId']).toBe('us-east-1_TestPool');
  });

  it('does not call AdminListGroupsForUser when custom:role attribute is present', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'has-role',
          Attributes: [
            { Name: 'sub', Value: 'id-has-role' },
            { Name: 'email', Value: 'has-role@example.com' },
            { Name: 'name', Value: 'Has Role' },
            { Name: 'custom:role', Value: 'site_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.users[0]!.role).toBe('site_admin');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('paginates through multiple Cognito responses', async () => {
    mockSend
      .mockResolvedValueOnce({
        Users: [
          {
            Username: 'u1',
            Attributes: [
              { Name: 'sub', Value: 'id-1' },
              { Name: 'email', Value: 'first@example.com' },
              { Name: 'name', Value: 'First User' },
              { Name: 'custom:role', Value: 'site_admin' },
              { Name: 'custom:tenant_id', Value: 'tenant-001' },
            ],
            UserStatus: 'CONFIRMED',
            Enabled: true,
            UserCreateDate: new Date(),
            UserLastModifiedDate: new Date(),
          },
        ],
        PaginationToken: 'next-page-token',
      })
      .mockResolvedValueOnce({
        Users: [
          {
            Username: 'u2',
            Attributes: [
              { Name: 'sub', Value: 'id-2' },
              { Name: 'email', Value: 'second@example.com' },
              { Name: 'name', Value: 'Second User' },
              { Name: 'custom:role', Value: 'supervisor' },
              { Name: 'custom:tenant_id', Value: 'tenant-001' },
            ],
            UserStatus: 'CONFIRMED',
            Enabled: true,
            UserCreateDate: new Date(),
            UserLastModifiedDate: new Date(),
          },
        ],
        PaginationToken: undefined,
      });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not pass an unsupported custom-attribute Filter to Cognito ListUsers', async () => {
    mockSend.mockResolvedValueOnce({ Users: [], PaginationToken: undefined });

    const listAdminUsers = await getListAdminUsers();
    await listAdminUsers('tenant-001');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input).not.toHaveProperty('Filter');
    expect(command.input['UserPoolId']).toBe('us-east-1_TestPool');
  });

  it('filters out users belonging to other tenants in application code', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'in-tenant',
          Attributes: [
            { Name: 'sub', Value: 'id-in' },
            { Name: 'email', Value: 'in@example.com' },
            { Name: 'name', Value: 'In Tenant' },
            { Name: 'custom:role', Value: 'site_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
        {
          Username: 'other-tenant',
          Attributes: [
            { Name: 'sub', Value: 'id-other' },
            { Name: 'email', Value: 'other@example.com' },
            { Name: 'name', Value: 'Other Tenant' },
            { Name: 'custom:role', Value: 'site_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-999' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
        {
          Username: 'no-tenant',
          Attributes: [
            { Name: 'sub', Value: 'id-none' },
            { Name: 'email', Value: 'none@example.com' },
            { Name: 'name', Value: 'No Tenant' },
            { Name: 'custom:role', Value: 'worker' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date(),
          UserLastModifiedDate: new Date(),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    expect(result.total).toBe(1);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.id).toBe('id-in');
  });

  it('returns response matching UsersResponse interface expected by frontend', async () => {
    mockSend.mockResolvedValueOnce({
      Users: [
        {
          Username: 'u1',
          Attributes: [
            { Name: 'sub', Value: 'user-id-1' },
            { Name: 'email', Value: 'test@example.com' },
            { Name: 'name', Value: 'Test User' },
            { Name: 'custom:role', Value: 'tenant_admin' },
            { Name: 'custom:tenant_id', Value: 'tenant-001' },
          ],
          UserStatus: 'CONFIRMED',
          Enabled: true,
          UserCreateDate: new Date('2024-01-01T00:00:00Z'),
          UserLastModifiedDate: new Date('2024-06-01T12:00:00Z'),
        },
      ],
      PaginationToken: undefined,
    });

    const listAdminUsers = await getListAdminUsers();
    const result = await listAdminUsers('tenant-001');

    // Verify the shape matches frontend's UsersResponse interface
    expect(result).toHaveProperty('users');
    expect(result).toHaveProperty('total');
    expect(typeof result.total).toBe('number');
    expect(Array.isArray(result.users)).toBe(true);

    const user = result.users[0]!;
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('role');
    expect(user).toHaveProperty('status');
    expect(user).toHaveProperty('lastLogin');
    expect(user).toHaveProperty('createdAt');
    expect(['active', 'inactive', 'invited']).toContain(user.status);
  });
});
