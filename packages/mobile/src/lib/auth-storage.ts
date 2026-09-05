/**
 * Persistent auth storage backed by expo-secure-store (Keychain / Keystore),
 * the RN replacement for the portal's localStorage. Tokens are the login, so
 * they live in the OS secure enclave, never AsyncStorage.
 */
import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, AppUser } from '../features/auth/types';

const TOKENS_KEY = 'auth_tokens';
const USER_KEY = 'auth_user';

export const authStorage = {
  async saveSession(tokens: AuthTokens, user: AppUser): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens)),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ]);
  },

  async loadSession(): Promise<{ tokens: AuthTokens; user: AppUser } | null> {
    const [rawTokens, rawUser] = await Promise.all([
      SecureStore.getItemAsync(TOKENS_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!rawTokens || !rawUser) return null;
    try {
      const tokens: AuthTokens = JSON.parse(rawTokens);
      const user: AppUser = JSON.parse(rawUser);
      if (!tokens?.accessToken || !user?.tenantId || !user?.role) return null;
      return { tokens, user };
    } catch {
      return null;
    }
  },

  async saveTokens(tokens: AuthTokens): Promise<void> {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKENS_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  },
};
