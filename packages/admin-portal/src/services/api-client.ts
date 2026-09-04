import { useAuthStore } from '@/store/auth-store';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    // Use userMessage from details if available, otherwise generic message
    const userMessage = details?.userMessage as string | undefined;
    super(userMessage || `API Error [${status}]: ${code}`);
    this.name = 'ApiClientError';
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const state = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (state?.tokens?.idToken) {
    headers['Authorization'] = state.tokens.idToken;
  }

  if (state?.tenantId) {
    headers['X-Tenant-Id'] = state.tenantId;
  }

  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  // Gateway errors (502, 503, 504) — API infrastructure issue
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    const statusMessages: Record<number, string> = {
      502: 'El servidor no está disponible. Puede ser un problema temporal o de autenticación. Intenta cerrar sesión y volver a entrar.',
      503: 'El servicio no está disponible temporalmente. Intenta de nuevo en unos segundos.',
      504: 'La solicitud tardó demasiado. Intenta de nuevo.',
    };
    throw new ApiClientError(
      response.status,
      'GATEWAY_ERROR',
      { userMessage: statusMessages[response.status] }
    );
  }

  if (response.status === 401) {
    // Token expired — attempt refresh
    const state = useAuthStore.getState();
    if (state?.refreshSession) {
      try {
        await state.refreshSession();
        // Retry would go here in a more advanced implementation
      } catch {
        // Refresh failed — redirect to login
        const currentPath = window.location.pathname;
        if (currentPath !== '/login') {
          sessionStorage.setItem('intendedDestination', currentPath);
        }
        state.logout();
        window.location.href = '/login';
      }
    }
    throw new ApiClientError(401, 'SESSION_EXPIRED', {
      userMessage: 'Tu sesión expiró. Por favor inicia sesión de nuevo.',
    });
  }

  if (response.status === 403) {
    throw new ApiClientError(403, 'FORBIDDEN', {
      userMessage: 'No tienes permisos para realizar esta acción.',
    });
  }

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      const text = await response.text();
      body = JSON.parse(text);
    } catch {
      // Response is not JSON (e.g., HTML error page from API Gateway)
      body = { code: 'UNKNOWN_ERROR', message: `HTTP ${response.status}` };
    }
    throw new ApiClientError(
      response.status,
      (body.code as string) || 'UNKNOWN_ERROR',
      body.details as Record<string, unknown> | undefined
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const apiClient = {
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const headers = await getAuthHeaders();
    let response = await fetch(url.toString(), { headers });

    // Retry once on 502 (gateway errors are often transient)
    if (response.status === 502) {
      await new Promise((r) => setTimeout(r, 1000));
      const freshHeaders = await getAuthHeaders();
      response = await fetch(url.toString(), { headers: freshHeaders });
    }

    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(path: string, body: unknown): Promise<T> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'DELETE',
      headers,
    });
    return handleResponse<T>(response);
  },
};
