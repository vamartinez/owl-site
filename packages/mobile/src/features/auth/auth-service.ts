/**
 * Cognito authentication service (React Native).
 *
 * Mirrors the admin-portal auth-service: authenticates directly with the
 * Cognito User Pool via amazon-cognito-identity-js (no API Gateway hop),
 * extracts the app user from the id token's claims and groups.
 *
 * The Cognito SDK needs `global.crypto` and `global.Buffer` — those are
 * installed by src/polyfills.ts, which the root layout imports first.
 */
import {
  CognitoUserPool,
  CognitoUser as CognitoUserSDK,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { config, assertCognitoConfigured } from '../../lib/config';
import type { AppUser, AuthTokens, UserRole } from './types';

let poolCache: CognitoUserPool | null = null;

function getPool(): CognitoUserPool {
  assertCognitoConfigured();
  if (!poolCache) {
    poolCache = new CognitoUserPool({
      UserPoolId: config.cognitoUserPoolId,
      ClientId: config.cognitoClientId,
    });
  }
  return poolCache;
}

function extractUser(session: CognitoUserSession, email: string): AppUser {
  const payload = session.getIdToken().decodePayload();
  const groups = (payload['cognito:groups'] as string[]) || [];
  const role = (groups.length > 0 ? groups[0]! : 'worker') as UserRole;

  return {
    id: payload['sub'] as string,
    email: (payload['email'] as string) || email,
    name: (payload['name'] as string) || (payload['email'] as string) || email,
    role,
    tenantId:
      (payload['custom:tenant_id'] as string) || (payload['tenant_id'] as string) || '',
    assignedSites: (
      (payload['custom:assigned_sites'] as string) ||
      (payload['assigned_sites'] as string) ||
      ''
    )
      .split(',')
      .filter(Boolean),
  };
}

function extractTokens(session: CognitoUserSession): AuthTokens {
  const accessToken = session.getAccessToken();
  return {
    accessToken: accessToken.getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    idToken: session.getIdToken().getJwtToken(),
    expiresAt: accessToken.getExpiration() * 1000,
  };
}

export const authService = {
  async login(
    email: string,
    password: string
  ): Promise<{ user: AppUser; tokens: AuthTokens }> {
    const pool = getPool();
    const cognitoUser = new CognitoUserSDK({ Username: email, Pool: pool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    return new Promise((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          resolve({ user: extractUser(session, email), tokens: extractTokens(session) });
        },
        onFailure: (err) => {
          const code = err.code || err.name || '';
          if (code === 'UserNotFoundException') {
            reject(new Error('User not found. Please check your email address.'));
          } else if (code === 'NotAuthorizedException') {
            reject(new Error('Incorrect email or password.'));
          } else if (code === 'UserNotConfirmedException') {
            reject(new Error('Your account has not been confirmed yet.'));
          } else if (code === 'PasswordResetRequiredException') {
            reject(new Error('You must reset your password before signing in.'));
          } else if (code === 'TooManyRequestsException') {
            reject(new Error('Too many attempts. Please wait a few minutes.'));
          } else {
            reject(new Error(err.message || 'Authentication error.'));
          }
        },
        newPasswordRequired: () => {
          reject(new Error('You must change your temporary password from the web portal.'));
        },
      });
    });
  },

  logout(): void {
    const current = getPool().getCurrentUser();
    if (current) current.signOut();
  },

  async refreshTokens(): Promise<AuthTokens> {
    const current = getPool().getCurrentUser();
    if (!current) throw new Error('No active session');
    return new Promise((resolve, reject) => {
      current.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          reject(new Error('Could not refresh session'));
          return;
        }
        resolve(extractTokens(session));
      });
    });
  },
};
