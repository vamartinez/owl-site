/**
 * Unit tests for the mock-auth helper.
 * Verifies that toggling between success/failure states works correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mockAuthSuccess,
  mockAuthFailure,
  resetAuthMock,
  getAuthMockImplementation,
  createAuthMock,
} from './mock-auth.js';
import { Role } from '../../src/shared/types/common.js';

describe('mock-auth helper', () => {
  beforeEach(() => {
    resetAuthMock();
  });

  describe('mockAuthSuccess', () => {
    it('returns a user object with default values', () => {
      mockAuthSuccess();
      const impl = getAuthMockImplementation();
      const result = impl();

      expect(result).toHaveProperty('user');
      expect(result).not.toHaveProperty('error');
      const { user } = result as { user: Record<string, unknown> };
      expect(user.user_id).toBe('user-test-001');
      expect(user.tenant_id).toBe('tenant-test');
      expect(user.role).toBe(Role.TENANT_ADMIN);
      expect(user.email).toBe('admin@tenant-test.com');
    });

    it('merges partial user with defaults', () => {
      mockAuthSuccess({ role: Role.SITE_ADMIN, tenant_id: 'tenant-custom' });
      const impl = getAuthMockImplementation();
      const result = impl();

      const { user } = result as { user: Record<string, unknown> };
      expect(user.role).toBe(Role.SITE_ADMIN);
      expect(user.tenant_id).toBe('tenant-custom');
      expect(user.user_id).toBe('user-test-001'); // default preserved
    });

    it('supports assigned_sites override', () => {
      mockAuthSuccess({ assigned_sites: ['site-a', 'site-b'] });
      const impl = getAuthMockImplementation();
      const result = impl();

      const { user } = result as { user: Record<string, unknown> };
      expect(user.assigned_sites).toEqual(['site-a', 'site-b']);
    });
  });

  describe('mockAuthFailure', () => {
    it('returns an error response with 401 status', () => {
      mockAuthFailure();
      const impl = getAuthMockImplementation();
      const result = impl();

      expect(result).toHaveProperty('error');
      expect(result).not.toHaveProperty('user');
      const { error } = result as { error: Record<string, unknown> };
      expect(error.statusCode).toBe(401);
    });

    it('returns a JSON body with UNAUTHORIZED code', () => {
      mockAuthFailure();
      const impl = getAuthMockImplementation();
      const result = impl();

      const { error } = result as { error: { body: string } };
      const body = JSON.parse(error.body);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBeDefined();
      expect(body.request_id).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('resetAuthMock', () => {
    it('restores default authenticated state after failure', () => {
      mockAuthFailure();
      resetAuthMock();
      const impl = getAuthMockImplementation();
      const result = impl();

      expect(result).toHaveProperty('user');
      expect(result).not.toHaveProperty('error');
    });

    it('restores default user after custom user', () => {
      mockAuthSuccess({ role: Role.WORKER, user_id: 'custom-id' });
      resetAuthMock();
      const impl = getAuthMockImplementation();
      const result = impl();

      const { user } = result as { user: Record<string, unknown> };
      expect(user.user_id).toBe('user-test-001');
      expect(user.role).toBe(Role.TENANT_ADMIN);
    });
  });

  describe('createAuthMock', () => {
    it('creates a vi.fn that respects auth state', () => {
      const mockFn = createAuthMock();

      // Default: authenticated
      let result = mockFn();
      expect(result).toHaveProperty('user');

      // Toggle to failure
      mockAuthFailure();
      result = mockFn();
      expect(result).toHaveProperty('error');

      // Toggle back to success
      mockAuthSuccess({ role: Role.PLATFORM_ADMIN });
      result = mockFn();
      const { user } = result as { user: Record<string, unknown> };
      expect(user.role).toBe(Role.PLATFORM_ADMIN);
    });
  });
});
