import { create } from 'zustand';
import { authService, type AuthTokens, type CognitoUser } from '@/services/auth-service';

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

export type UserRole =
  | 'platform_admin'
  | 'tenant_admin'
  | 'site_admin'
  | 'supervisor'
  | 'cso'
  | 'gate_operator'
  | 'worker';

interface AuthState {
  user: CognitoUser | null;
  tokens: AuthTokens | null;
  tenantId: string | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  lastActivity: number;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  updateActivity: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tokens: null,
  tenantId: null,
  role: null,
  isAuthenticated: false,
  isLoading: true,
  lastActivity: Date.now(),
  inactivityTimer: null,
  refreshTimer: null,

  login: async (email: string, password: string) => {
    const { user, tokens } = await authService.login(email, password);

    set({
      user,
      tokens,
      tenantId: user.tenantId,
      role: user.role as UserRole,
      isAuthenticated: true,
      isLoading: false,
      lastActivity: Date.now(),
    });

    // Persist tokens
    localStorage.setItem('auth_tokens', JSON.stringify(tokens));
    localStorage.setItem('auth_user', JSON.stringify(user));

    // Start timers
    get().updateActivity();
    scheduleTokenRefresh(tokens, get);
  },

  logout: () => {
    const { tokens, inactivityTimer, refreshTimer } = get();

    // Clear timers
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (refreshTimer) clearTimeout(refreshTimer);

    // Best-effort server logout
    if (tokens?.refreshToken) {
      authService.logout(tokens.refreshToken);
    }

    // Clear state
    set({
      user: null,
      tokens: null,
      tenantId: null,
      role: null,
      isAuthenticated: false,
      isLoading: false,
      inactivityTimer: null,
      refreshTimer: null,
    });

    // Clear storage
    localStorage.removeItem('auth_tokens');
    localStorage.removeItem('auth_user');
  },

  refreshSession: async () => {
    const { tokens } = get();
    if (!tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const newTokens = await authService.refreshTokens(tokens.refreshToken);
    set({ tokens: newTokens });
    localStorage.setItem('auth_tokens', JSON.stringify(newTokens));
    scheduleTokenRefresh(newTokens, get);
  },

  updateActivity: () => {
    const { inactivityTimer } = get();
    if (inactivityTimer) clearTimeout(inactivityTimer);

    const timer = setTimeout(() => {
      // Inactivity timeout reached — terminate session
      const { logout } = get();
      logout();
      sessionStorage.setItem('session_message', 'Your session expired due to inactivity.');
      window.location.href = '/login';
    }, INACTIVITY_TIMEOUT_MS);

    set({ lastActivity: Date.now(), inactivityTimer: timer });
  },

  initialize: async () => {
    const storedTokens = localStorage.getItem('auth_tokens');
    const storedUser = localStorage.getItem('auth_user');

    if (!storedTokens || !storedUser) {
      set({ isLoading: false });
      return;
    }

    try {
      const tokens: AuthTokens = JSON.parse(storedTokens);
      const user: CognitoUser = JSON.parse(storedUser);

      // Validate parsed data has required fields
      if (!user?.tenantId || !user?.role || !tokens?.accessToken) {
        throw new Error('Invalid stored auth data');
      }
      if (tokens.expiresAt < Date.now()) {
        // Try to refresh
        const newTokens = await authService.refreshTokens(tokens.refreshToken);
        set({
          user,
          tokens: newTokens,
          tenantId: user.tenantId,
          role: user.role as UserRole,
          isAuthenticated: true,
          isLoading: false,
        });
        localStorage.setItem('auth_tokens', JSON.stringify(newTokens));
        scheduleTokenRefresh(newTokens, get);
      } else {
        set({
          user,
          tokens,
          tenantId: user.tenantId,
          role: user.role as UserRole,
          isAuthenticated: true,
          isLoading: false,
        });
        scheduleTokenRefresh(tokens, get);
      }

      get().updateActivity();
    } catch {
      // Invalid stored data — clear and require login
      localStorage.removeItem('auth_tokens');
      localStorage.removeItem('auth_user');
      set({ isLoading: false });
    }
  },
}));

function scheduleTokenRefresh(
  tokens: AuthTokens,
  get: () => AuthState
) {
  const { refreshTimer } = get();
  if (refreshTimer) clearTimeout(refreshTimer);

  const timeUntilExpiry = tokens.expiresAt - Date.now();
  const refreshIn = Math.max(timeUntilExpiry - TOKEN_REFRESH_BUFFER_MS, 0);

  const timer = setTimeout(async () => {
    try {
      await get().refreshSession();
    } catch {
      get().logout();
      window.location.href = '/login';
    }
  }, refreshIn);

  useAuthStore.setState({ refreshTimer: timer });
}
