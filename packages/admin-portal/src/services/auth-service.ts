/**
 * Cognito authentication service.
 * Uses amazon-cognito-identity-js to authenticate directly with Cognito
 * without going through the API Gateway.
 */

import {
  CognitoUserPool,
  CognitoUser as CognitoUserSDK,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '';

const userPool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: CLIENT_ID,
});

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number; // Unix timestamp in ms
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  assignedSites: string[];
}

function extractUserFromSession(session: CognitoUserSession, email: string): AppUser {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload();

  // Cognito groups come as an array in the token (e.g., ["platform_admin"])
  const groups = (payload['cognito:groups'] as string[]) || [];
  const role: string = (groups.length > 0 ? groups[0]! : 'worker');

  return {
    id: payload['sub'] as string,
    email: (payload['email'] as string) || email,
    name: (payload['name'] as string) || (payload['email'] as string) || email,
    role,
    tenantId: (payload['custom:tenant_id'] as string) || (payload['tenant_id'] as string) || '',
    assignedSites: ((payload['custom:assigned_sites'] as string) || (payload['assigned_sites'] as string) || '').split(',').filter(Boolean),
  };
}

function extractTokensFromSession(session: CognitoUserSession): AuthTokens {
  const accessToken = session.getAccessToken();
  return {
    accessToken: accessToken.getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    idToken: session.getIdToken().getJwtToken(),
    expiresAt: accessToken.getExpiration() * 1000, // Convert to ms
  };
}

export const authService = {
  async login(email: string, password: string): Promise<{ user: AppUser; tokens: AuthTokens }> {
    if (!USER_POOL_ID || !CLIENT_ID) {
      throw new Error('Cognito not configured. Add VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID to .env.local');
    }

    const cognitoUser = new CognitoUserSDK({
      Username: email,
      Pool: userPool,
    });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    return new Promise((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          const user = extractUserFromSession(session, email);
          const tokens = extractTokensFromSession(session);
          resolve({ user, tokens });
        },
        onFailure: (err) => {
          const code = err.code || err.name || '';
          
          if (code === 'UserNotFoundException' || code === 'UserNotFoundError') {
            reject(new Error('User not found. Please check your email address.'));
          } else if (code === 'NotAuthorizedException') {
            reject(new Error('Incorrect password. Please try again.'));
          } else if (code === 'UserNotConfirmedException') {
            reject(new Error('Your account has not been confirmed. Check your email for the confirmation link.'));
          } else if (code === 'PasswordResetRequiredException') {
            reject(new Error('You must reset your password before signing in.'));
          } else if (code === 'TooManyRequestsException') {
            reject(new Error('Too many attempts. Please wait a few minutes.'));
          } else if (code === 'NetworkError' || err.message?.includes('fetch')) {
            reject(new Error('Could not connect to the authentication server.'));
          } else {
            reject(new Error(err.message || 'Authentication error. Please check your credentials.'));
          }
        },
        newPasswordRequired: () => {
          reject(new Error('You must change your temporary password. Use "Forgot password?" to reset it.'));
        },
      });
    });
  },

  async logout(refreshToken: string): Promise<void> {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
  },

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      throw new Error('No active session');
    }

    return new Promise((resolve, reject) => {
      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          reject(new Error('Could not refresh session'));
          return;
        }
        resolve(extractTokensFromSession(session));
      });
    });
  },

  async forgotPassword(email: string): Promise<void> {
    if (!USER_POOL_ID || !CLIENT_ID) {
      throw new Error('Cognito not configured.');
    }

    const cognitoUser = new CognitoUserSDK({
      Username: email,
      Pool: userPool,
    });

    return new Promise((resolve, reject) => {
      cognitoUser.forgotPassword({
        onSuccess: () => resolve(),
        onFailure: (err: any) => {
          if (err.code === 'UserNotFoundException') {
            reject(new Error('User not found. Please check your email address.'));
          } else if (err.code === 'LimitExceededException') {
            reject(new Error('Too many attempts. Please wait before trying again.'));
          } else {
            reject(new Error(err.message || 'Error sending recovery code.'));
          }
        },
      });
    });
  },

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    const cognitoUser = new CognitoUserSDK({
      Username: email,
      Pool: userPool,
    });

    return new Promise((resolve, reject) => {
      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => resolve(),
        onFailure: (err: any) => {
          if (err.code === 'CodeMismatchException') {
            reject(new Error('Incorrect verification code.'));
          } else if (err.code === 'ExpiredCodeException') {
            reject(new Error('The code has expired. Please request a new one.'));
          } else if (err.code === 'InvalidPasswordException') {
            reject(new Error('Password does not meet requirements (min 8 characters, uppercase, lowercase, number).'));
          } else {
            reject(new Error(err.message || 'Error changing password.'));
          }
        },
      });
    });
  },
};

// Re-export AppUser as CognitoUser for backward compatibility with auth-store
export type { AppUser as CognitoUser };
