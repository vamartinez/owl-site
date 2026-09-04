/**
 * Auth middleware mock for unit tests.
 * Allows toggling between authenticated and unauthenticated states
 * without needing real JWT tokens or Cognito authorizer claims.
 *
 * Usage:
 *   import { mockAuthSuccess, mockAuthFailure, resetAuthMock } from '../helpers/mock-auth';
 *
 *   beforeEach(() => resetAuthMock());
 *   // In a test:
 *   mockAuthSuccess({ role: Role.SITE_ADMIN });
 *   // or:
 *   mockAuthFailure();
 */

import { vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/auth-middleware.js';
import { Role } from '../../src/shared/types/common.js';

const DEFAULT_USER: AuthenticatedUser = {
  user_id: 'user-test-001',
  tenant_id: 'tenant-test',
  role: Role.TENANT_ADMIN,
  email: 'admin@tenant-test.com',
  assigned_sites: undefined,
};

let authState: 'success' | 'failure' = 'success';
let currentUser: AuthenticatedUser = { ...DEFAULT_USER };

/**
 * Configures the auth mock to return a successful authentication result.
 * Merges the provided partial user with default values.
 */
export function mockAuthSuccess(user?: Partial<AuthenticatedUser>): void {
  authState = 'success';
  currentUser = { ...DEFAULT_USER, ...user };
}

/**
 * Configures the auth mock to return a 401 Unauthorized response.
 */
export function mockAuthFailure(): void {
  authState = 'failure';
}

/**
 * Resets the auth mock to its default state (authenticated as tenant_admin).
 */
export function resetAuthMock(): void {
  authState = 'success';
  currentUser = { ...DEFAULT_USER };
}

/**
 * Returns a mock implementation of `authenticateRequest` that respects the
 * current auth state set by mockAuthSuccess/mockAuthFailure.
 *
 * Use this with vi.mock to replace the real auth-middleware module:
 *
 * ```ts
 * vi.mock('../../src/shared/auth-middleware.js', () => ({
 *   authenticateRequest: vi.fn(() => getAuthMockImplementation()()),
 * }));
 * ```
 *
 * Or apply it to an existing mock:
 *
 * ```ts
 * const mockAuth = vi.mocked(authenticateRequest);
 * mockAuth.mockImplementation(getAuthMockImplementation());
 * ```
 */
export function getAuthMockImplementation() {
  return () => {
    if (authState === 'failure') {
      return {
        error: {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid Authorization header',
            request_id: 'mock-request-id',
            timestamp: new Date().toISOString(),
          }),
        },
      };
    }
    return { user: { ...currentUser } };
  };
}

/**
 * Creates a vi.fn() mock for authenticateRequest that is pre-configured
 * to use the togglable auth state. Useful as a direct drop-in for vi.mock factory.
 */
export function createAuthMock() {
  return vi.fn(() => getAuthMockImplementation()());
}
