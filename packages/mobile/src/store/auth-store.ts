/**
 * Auth store (zustand) — the RN counterpart of the portal's auth-store.
 * Persists to SecureStore instead of localStorage, schedules a token refresh
 * ahead of expiry, and hydrates on app start.
 */
import { create } from 'zustand';
import { authService } from '../features/auth/auth-service';
import { authStorage } from '../lib/auth-storage';
import type { AppUser, AuthTokens, UserRole } from '../features/auth/types';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

interface AuthState {
  user: AppUser | null;
  tokens: AuthTokens | null;
  tenantId: string | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  refreshTimer: ReturnType<typeof setTimeout> | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tokens: null,
  tenantId: null,
  role: null,
  isAuthenticated: false,
  isHydrating: true,
  refreshTimer: null,

  login: async (email, password) => {
    const { user, tokens } = await authService.login(email, password);
    await authStorage.saveSession(tokens, user);
    set({
      user,
      tokens,
      tenantId: user.tenantId,
      role: user.role,
      isAuthenticated: true,
    });
    scheduleRefresh(tokens, get, set);
  },

  logout: async () => {
    const { refreshTimer } = get();
    if (refreshTimer) clearTimeout(refreshTimer);
    authService.logout();
    await authStorage.clear();
    set({
      user: null,
      tokens: null,
      tenantId: null,
      role: null,
      isAuthenticated: false,
      refreshTimer: null,
    });
  },

  refreshSession: async () => {
    const newTokens = await authService.refreshTokens();
    await authStorage.saveTokens(newTokens);
    set({ tokens: newTokens });
    scheduleRefresh(newTokens, get, set);
  },

  hydrate: async () => {
    const session = await authStorage.loadSession();
    if (!session) {
      set({ isHydrating: false });
      return;
    }
    const { tokens, user } = session;
    try {
      if (tokens.expiresAt < Date.now()) {
        const fresh = await authService.refreshTokens();
        await authStorage.saveTokens(fresh);
        set({
          user,
          tokens: fresh,
          tenantId: user.tenantId,
          role: user.role,
          isAuthenticated: true,
          isHydrating: false,
        });
        scheduleRefresh(fresh, get, set);
      } else {
        set({
          user,
          tokens,
          tenantId: user.tenantId,
          role: user.role,
          isAuthenticated: true,
          isHydrating: false,
        });
        scheduleRefresh(tokens, get, set);
      }
    } catch {
      await authStorage.clear();
      set({ isHydrating: false });
    }
  },
}));

function scheduleRefresh(
  tokens: AuthTokens,
  get: () => AuthState,
  set: (partial: Partial<AuthState>) => void
) {
  const { refreshTimer } = get();
  if (refreshTimer) clearTimeout(refreshTimer);

  const refreshIn = Math.max(tokens.expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS, 0);
  const timer = setTimeout(() => {
    void get()
      .refreshSession()
      .catch(() => {
        void get().logout();
      });
  }, refreshIn);
  set({ refreshTimer: timer });
}
