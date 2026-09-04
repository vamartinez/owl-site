import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock amazon-cognito-identity-js
const mockAuthenticateUser = vi.fn();

vi.mock('amazon-cognito-identity-js', () => {
  return {
    CognitoUserPool: vi.fn().mockImplementation(() => ({
      getCurrentUser: vi.fn(),
    })),
    CognitoUser: vi.fn().mockImplementation(() => ({
      authenticateUser: mockAuthenticateUser,
    })),
    AuthenticationDetails: vi.fn().mockImplementation((details) => details),
  };
});

// Mock import.meta.env
vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'us-east-1_TestPool');
vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client-id');

// Import after mocks
const { authService } = await import('../src/services/auth-service');

describe('authService.login — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows connection error when Cognito SDK throws NetworkError', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('Failed to fetch') as Error & { code?: string };
      err.code = 'NetworkError';
      callbacks.onFailure(err);
    });

    await expect(authService.login('test@test.com', 'password123'))
      .rejects.toThrow('Could not connect to the authentication server');
  });

  it('shows "User not found" for UserNotFoundException', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('User does not exist.') as Error & { code?: string };
      err.code = 'UserNotFoundException';
      callbacks.onFailure(err);
    });

    await expect(authService.login('noexiste@test.com', 'password123'))
      .rejects.toThrow('User not found');
  });

  it('shows "Incorrect password" for NotAuthorizedException', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('Incorrect username or password.') as Error & { code?: string };
      err.code = 'NotAuthorizedException';
      callbacks.onFailure(err);
    });

    await expect(authService.login('user@test.com', 'wrongpassword'))
      .rejects.toThrow('Incorrect password');
  });

  it('shows "not been confirmed" for UserNotConfirmedException', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('User is not confirmed.') as Error & { code?: string };
      err.code = 'UserNotConfirmedException';
      callbacks.onFailure(err);
    });

    await expect(authService.login('unconfirmed@test.com', 'password123'))
      .rejects.toThrow('not been confirmed');
  });

  it('shows "must reset your password" for PasswordResetRequiredException', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('Password reset required.') as Error & { code?: string };
      err.code = 'PasswordResetRequiredException';
      callbacks.onFailure(err);
    });

    await expect(authService.login('user@test.com', 'oldpassword'))
      .rejects.toThrow('must reset your password');
  });

  it('shows "Too many attempts" for TooManyRequestsException', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('Too many requests.') as Error & { code?: string };
      err.code = 'TooManyRequestsException';
      callbacks.onFailure(err);
    });

    await expect(authService.login('user@test.com', 'password123'))
      .rejects.toThrow('Too many attempts');
  });

  it('shows generic error message for unknown error codes', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('Something went wrong') as Error & { code?: string };
      err.code = 'UnknownError';
      callbacks.onFailure(err);
    });

    await expect(authService.login('user@test.com', 'password123'))
      .rejects.toThrow('Something went wrong');
  });

  it('shows fallback message when error has no message', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: Error & { code?: string }) => void }) => {
      const err = new Error('') as Error & { code?: string; message: string };
      err.code = 'UnknownError';
      err.message = '';
      callbacks.onFailure(err);
    });

    await expect(authService.login('user@test.com', 'password123'))
      .rejects.toThrow('Authentication error');
  });

  it('handles newPasswordRequired challenge', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { newPasswordRequired: () => void }) => {
      callbacks.newPasswordRequired();
    });

    await expect(authService.login('user@test.com', 'temppassword'))
      .rejects.toThrow('must change your temporary password');
  });

  it('successful login returns user and tokens', async () => {
    const mockSession = {
      getIdToken: () => ({
        getJwtToken: () => 'id-token-789',
        decodePayload: () => ({
          sub: 'user-1',
          email: 'admin@test.com',
          name: 'Admin User',
          'cognito:groups': ['tenant_admin'],
          'custom:tenant_id': 'tenant-1',
          'custom:assigned_sites': 'site-1,site-2',
        }),
      }),
      getAccessToken: () => ({
        getJwtToken: () => 'access-token-123',
        getExpiration: () => Math.floor(Date.now() / 1000) + 3600,
      }),
      getRefreshToken: () => ({
        getToken: () => 'refresh-token-456',
      }),
    };

    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onSuccess: (session: typeof mockSession) => void }) => {
      callbacks.onSuccess(mockSession);
    });

    const result = await authService.login('admin@test.com', 'correctpassword');

    expect(result.user.email).toBe('admin@test.com');
    expect(result.user.tenantId).toBe('tenant-1');
    expect(result.user.role).toBe('tenant_admin');
    expect(result.user.assignedSites).toEqual(['site-1', 'site-2']);
    expect(result.tokens.accessToken).toBe('access-token-123');
    expect(result.tokens.refreshToken).toBe('refresh-token-456');
    expect(result.tokens.idToken).toBe('id-token-789');
  });

  it('successful login with no groups defaults role to worker', async () => {
    const mockSession = {
      getIdToken: () => ({
        getJwtToken: () => 'id-token-abc',
        decodePayload: () => ({
          sub: 'user-2',
          email: 'worker@test.com',
          name: 'Worker User',
          'cognito:groups': [],
          'custom:tenant_id': 'tenant-2',
        }),
      }),
      getAccessToken: () => ({
        getJwtToken: () => 'access-token-abc',
        getExpiration: () => Math.floor(Date.now() / 1000) + 3600,
      }),
      getRefreshToken: () => ({
        getToken: () => 'refresh-token-abc',
      }),
    };

    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onSuccess: (session: typeof mockSession) => void }) => {
      callbacks.onSuccess(mockSession);
    });

    const result = await authService.login('worker@test.com', 'password123');

    expect(result.user.role).toBe('worker');
  });

  it('throws configuration error when Cognito env vars are missing', async () => {
    // Re-import with empty env vars
    vi.stubEnv('VITE_COGNITO_USER_POOL_ID', '');
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '');

    // Need to re-import to pick up new env values
    vi.resetModules();

    // Re-mock the module
    vi.doMock('amazon-cognito-identity-js', () => ({
      CognitoUserPool: vi.fn().mockImplementation(() => ({
        getCurrentUser: vi.fn(),
      })),
      CognitoUser: vi.fn().mockImplementation(() => ({
        authenticateUser: mockAuthenticateUser,
      })),
      AuthenticationDetails: vi.fn().mockImplementation((details: unknown) => details),
    }));

    const { authService: freshAuthService } = await import('../src/services/auth-service');

    await expect(freshAuthService.login('user@test.com', 'password'))
      .rejects.toThrow('Cognito not configured');
  });
});
